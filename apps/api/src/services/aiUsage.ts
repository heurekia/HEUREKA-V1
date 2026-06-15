import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import fs from "fs";
import { db } from "../db.js";
import { ai_usage_events } from "@heureka-v1/db";
import { maybeNotify } from "./aiAlerts.js";

// ── RGPD : choix du fournisseur d'inférence ─────────────────────────────────
// AI_PROVIDER=bedrock  → utilise AWS Bedrock (Anthropic Claude hébergé en UE).
//   • Supprime juridiquement le transfert hors UE (art. 44 RGPD).
//   • Demande AWS_REGION (par défaut eu-central-1 / Francfort) + credentials
//     AWS standards (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, …).
// AI_PROVIDER=anthropic (défaut) → API Anthropic directe (États-Unis, sous DPA + SCC).
const AI_PROVIDER = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
const USE_BEDROCK = AI_PROVIDER === "bedrock";
const BEDROCK_REGION = process.env.AWS_REGION ?? "eu-central-1";

// Bedrock utilise des "inference profile IDs" préfixés par la région
// (eu.* = profil cross-region UE qui route entre Francfort / Irlande / Paris
// pour la disponibilité, sans transfert hors UE).
// IDs confirmés depuis la console Bedrock eu-central-1 (Francfort) :
//   - Haiku 4.5 garde le suffixe -v1:0
//   - Sonnet 4.6 N'A PAS le suffixe -v1:0 (différence de convention AWS sur
//     les modèles les plus récents). À re-vérifier dans la console à chaque
//     ajout de modèle, AWS change parfois la convention.
// Si un modèle n'a pas encore d'équivalent Bedrock, on échoue explicitement
// plutôt que de basculer silencieusement sur la mauvaise région.
const BEDROCK_MODEL_MAP: Record<string, string> = {
  "claude-haiku-4-5-20251001": "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  "claude-haiku-4-5":          "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  "claude-sonnet-4-6":          "eu.anthropic.claude-sonnet-4-6",
  "claude-sonnet-4-5":          "eu.anthropic.claude-sonnet-4-5",
  "claude-opus-4-8":             "eu.anthropic.claude-opus-4-8",
  "claude-opus-4-7":             "eu.anthropic.claude-opus-4-7",
};

// Mapping inverse : depuis un modelId Bedrock vu dans la réponse, retrouver
// le nom canonique Anthropic pour rester cohérent dans les tarifs et les
// logs ai_usage_events.
function canonicalModelName(modelId: string): string {
  if (!USE_BEDROCK) return modelId;
  for (const [canon, bedrock] of Object.entries(BEDROCK_MODEL_MAP)) {
    if (bedrock === modelId) return canon;
  }
  return modelId;
}

function bedrockModelId(canonical: string): string {
  const mapped = BEDROCK_MODEL_MAP[canonical];
  if (!mapped) {
    throw new Error(`[aiUsage] Aucun mapping Bedrock pour le modèle "${canonical}". Mettez à jour BEDROCK_MODEL_MAP.`);
  }
  return mapped;
}

// Pour les appels streaming qui appellent client.messages.stream() directement
// (sans passer par callClaude). On garde le nom canonique dans le code applicatif
// et on traduit ici juste avant l'envoi à Bedrock — sinon Bedrock répond
// « 400 The provided model identifier is invalid ».
export function resolveModelForProvider(canonical: string): string {
  return USE_BEDROCK ? bedrockModelId(canonical) : canonical;
}

// ── Tarifs Anthropic (USD par million de tokens) ────────────────────────────
// Mis à jour à partir des prix publics. Si un modèle inconnu est utilisé, on
// retombe sur les tarifs Sonnet pour ne pas sous-estimer le coût.
interface ModelPricing {
  input: number;          // USD / 1M tokens
  output: number;         // USD / 1M tokens
  cache_read: number;     // USD / 1M tokens
  cache_creation: number; // USD / 1M tokens (cache 5 min)
}

const PRICING: Record<string, ModelPricing> = {
  // Haiku 4.5
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cache_read: 0.1, cache_creation: 1.25 },
  "claude-haiku-4-5":          { input: 1.0, output: 5.0, cache_read: 0.1, cache_creation: 1.25 },
  // Sonnet 4.6 / 4.5 / 4
  "claude-sonnet-4-6":          { input: 3.0, output: 15.0, cache_read: 0.3, cache_creation: 3.75 },
  "claude-sonnet-4-5":          { input: 3.0, output: 15.0, cache_read: 0.3, cache_creation: 3.75 },
  // Opus 4.x (fallback large)
  "claude-opus-4-8":             { input: 15.0, output: 75.0, cache_read: 1.5, cache_creation: 18.75 },
  "claude-opus-4-7":             { input: 15.0, output: 75.0, cache_read: 1.5, cache_creation: 18.75 },
};

const DEFAULT_PRICING: ModelPricing = PRICING["claude-sonnet-4-6"]!;

// Conversion USD → EUR. Surchargeable par AI_USD_TO_EUR si besoin.
const USD_TO_EUR = Number(process.env.AI_USD_TO_EUR ?? "0.93");

export function computeCostEur(
  model: string,
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number },
): number {
  const p = PRICING[model] ?? DEFAULT_PRICING;
  const inT = usage.input_tokens ?? 0;
  const outT = usage.output_tokens ?? 0;
  const cReadT = usage.cache_read_input_tokens ?? 0;
  const cCreateT = usage.cache_creation_input_tokens ?? 0;
  const usd =
    (inT * p.input + outT * p.output + cReadT * p.cache_read + cCreateT * p.cache_creation) / 1_000_000;
  return Math.round(usd * USD_TO_EUR * 1_000_000) / 1_000_000;
}

// ── Clé API Anthropic ───────────────────────────────────────────────────────
// Mêmes sources que dans pieceAnalyzer.ts (env, puis fichier session).
// N'est lue que quand AI_PROVIDER!=bedrock — sur Bedrock, ce sont les
// credentials AWS standards (AWS_ACCESS_KEY_ID, …) qui sont utilisés.
function getAnthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const candidates = [
    process.env.CLAUDE_SESSION_INGRESS_TOKEN_FILE,
    "/home/claude/.claude/remote/.session_ingress_token",
  ];
  for (const p of candidates) {
    if (!p) continue;
    try { return fs.readFileSync(p, "utf8").trim(); } catch { /* try next */ }
  }
  throw new Error("ANTHROPIC_API_KEY non configurée");
}

let _client: Anthropic | null = null;
function newClient(opts?: { maxRetries?: number; timeout?: number }): Anthropic {
  if (USE_BEDROCK) {
    // AnthropicBedrock étend Anthropic — même API messages.create(). Les
    // credentials AWS sont lus depuis l'environnement standard (AWS_ACCESS_KEY_ID,
    // AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_PROFILE, IAM role…).
    return new AnthropicBedrock({ awsRegion: BEDROCK_REGION, ...opts }) as unknown as Anthropic;
  }
  return new Anthropic({ apiKey: getAnthropicKey(), ...opts });
}

export function anthropicClient(opts?: { maxRetries?: number; timeout?: number }): Anthropic {
  // Permet de surcharger maxRetries/timeout par appel sans recréer un client à
  // chaque fois pour le cas par défaut.
  if (opts) return newClient(opts);
  if (!_client) _client = newClient();
  return _client;
}

// Étiquette informationnelle pour les logs au boot (cf. probe).
export function aiProviderInfo(): { provider: string; region?: string } {
  return USE_BEDROCK
    ? { provider: "bedrock", region: BEDROCK_REGION }
    : { provider: "anthropic" };
}

// ── Probe de démarrage ──────────────────────────────────────────────────────
// Vérifie au boot que la table `ai_usage_events` existe ET porte les colonnes
// attendues (commune_id, en particulier). Loggue UN message clair plutôt que
// de laisser le serveur insérer dans le vide pendant des semaines.
const REQUIRED_COLUMNS = [
  "id", "dossier_id", "commune_id", "user_id", "purpose", "model",
  "input_tokens", "output_tokens", "cache_read_input_tokens",
  "cache_creation_input_tokens", "cost_eur", "duration_ms", "created_at",
] as const;

export async function probeAiUsageTable(): Promise<void> {
  try {
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage_events'`,
    );
    const cols = new Set((rows as unknown as { column_name: string }[]).map((r) => r.column_name));
    if (cols.size === 0) {
      console.error("[aiUsage] ⚠️  Table ai_usage_events INTROUVABLE — relance la migration : pnpm --filter @heureka-v1/db migrate");
      return;
    }
    const missing = REQUIRED_COLUMNS.filter((c) => !cols.has(c));
    if (missing.length > 0) {
      console.error(`[aiUsage] ⚠️  Colonnes manquantes sur ai_usage_events: ${missing.join(", ")} — relance la migration.`);
      return;
    }
    console.log("[aiUsage] ✅ Table ai_usage_events OK, suivi des coûts actif.");
    const info = aiProviderInfo();
    if (info.provider === "bedrock") {
      console.log(`[aiUsage] 🇪🇺 Fournisseur d'inférence : AWS Bedrock (région ${info.region}). Aucun transfert hors UE (RGPD art. 44).`);
    } else {
      console.log("[aiUsage] 🇺🇸 Fournisseur d'inférence : Anthropic API directe (USA, sous DPA + SCC). Pour basculer en UE : AI_PROVIDER=bedrock.");
    }
  } catch (err) {
    console.error("[aiUsage] probe échoué:", err instanceof Error ? err.message : err);
  }
}

// ── Wrapper de tracking ─────────────────────────────────────────────────────

export interface CallClaudeContext {
  purpose: string;
  dossierId?: string | null;
  communeId?: string | null;
  userId?: string | null;
  // RGPD : SHA-256 hex du fichier envoyé à l'IA (pour les appels qui
  // intègrent un contenu utilisateur). Tracé en clair dans
  // `ai_usage_events.file_hash` pour audit.
  fileHash?: string | null;
}

/**
 * Appelle `client.messages.create(request)` en mesurant la durée, en lisant
 * `msg.usage` retourné par l'API et en persistant un événement
 * `ai_usage_events` avec le coût en EUR. La persistance est best-effort : une
 * erreur d'écriture en base ne fait pas échouer la requête métier.
 */
export async function callClaude(
  ctx: CallClaudeContext,
  request: Anthropic.MessageCreateParamsNonStreaming,
  client?: Anthropic,
): Promise<Anthropic.Message> {
  const c = client ?? anthropicClient();
  // RGPD : si l'on est sur Bedrock UE, traduire le modèle canonique en
  // inference profile Bedrock. Le code applicatif continue d'utiliser les
  // noms Anthropic canoniques partout — la conversion est centralisée ici.
  const finalRequest = USE_BEDROCK
    ? { ...request, model: bedrockModelId(request.model) }
    : request;
  const canonicalModel = request.model;

  const startedAt = Date.now();
  const msg = await c.messages.create(finalRequest);
  const durationMs = Date.now() - startedAt;

  const usage = msg.usage ?? { input_tokens: 0, output_tokens: 0 };
  const cacheRead = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cacheCreate = (usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;
  const cost = computeCostEur(canonicalModel, {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate,
  });

  void db.insert(ai_usage_events).values({
    dossier_id: ctx.dossierId ?? null,
    commune_id: ctx.communeId ?? null,
    user_id: ctx.userId ?? null,
    purpose: ctx.purpose,
    // On stocke TOUJOURS le nom canonique (cohérence des tarifs + des
    // tableaux de bord d'admin, qu'on soit sur Anthropic direct ou Bedrock).
    model: canonicalModel,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate,
    cost_eur: cost,
    duration_ms: durationMs,
    file_hash: ctx.fileHash ?? null,
  }).then(() => {
    // Alertes Slack en arrière-plan (non bloquant).
    void maybeNotify({
      purpose: ctx.purpose,
      model: request.model,
      cost_eur: cost,
      dossier_id: ctx.dossierId ?? null,
      commune_id: ctx.communeId ?? null,
    });
  }).catch((err) => {
    // Bien visible : on a payé l'appel mais on a perdu la trace. Cas typique :
    // migration `ai_usage_events` non appliquée ou colonne manquante.
    console.error(
      `[aiUsage] ⚠️  INSERT ÉCHOUÉ — événement payant non tracé (purpose=${ctx.purpose}, model=${request.model}, cost=${cost}€). Vérifier la migration ai_usage_events.`,
      err instanceof Error ? err.message : err,
    );
  });

  return msg;
}

/**
 * Variante streaming : tracking idempotent à partir du `finalMessage` d'un
 * stream Anthropic. Utilisée par les routes SSE (structure-article,
 * structure-zone) qui doivent forwarder les deltas vers le client en
 * heartbeats pour éviter les 502 passerelle — voir mairie.ts.
 *
 * Appel best-effort comme `callClaude` : une erreur d'écriture en DB ne
 * fait pas échouer la requête métier.
 */
export function trackClaudeStreamUsage(
  ctx: CallClaudeContext,
  finalMessage: Anthropic.Message,
  startedAt: number,
): void {
  const durationMs = Date.now() - startedAt;
  const usage = finalMessage.usage ?? { input_tokens: 0, output_tokens: 0 };
  const cacheRead = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cacheCreate = (usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;
  // Si on est sur Bedrock, le finalMessage.model contient l'inference profile
  // (eu.anthropic.claude-…) ; on le retraduit en nom canonique pour cohérence
  // des tarifs et des dashboards.
  const model = canonicalModelName(finalMessage.model);
  const cost = computeCostEur(model, {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate,
  });

  void db.insert(ai_usage_events).values({
    dossier_id: ctx.dossierId ?? null,
    commune_id: ctx.communeId ?? null,
    user_id: ctx.userId ?? null,
    purpose: ctx.purpose,
    model,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate,
    cost_eur: cost,
    duration_ms: durationMs,
    file_hash: ctx.fileHash ?? null,
  }).then(() => {
    void maybeNotify({
      purpose: ctx.purpose,
      model,
      cost_eur: cost,
      dossier_id: ctx.dossierId ?? null,
      commune_id: ctx.communeId ?? null,
    });
  }).catch((err) => {
    console.error(
      `[aiUsage] ⚠️  INSERT ÉCHOUÉ (stream) — événement payant non tracé (purpose=${ctx.purpose}, model=${model}, cost=${cost}€).`,
      err instanceof Error ? err.message : err,
    );
  });
}
