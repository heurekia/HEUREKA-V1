import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
// AI_PROVIDER=mistral  → Mistral La Plateforme (Paris, souveraineté française).
//   • Demande MISTRAL_API_KEY. Étape 1 du portage : couvre les appels
//     non-streaming (pieceAnalyzer, pieceExtractor, ruleVerdicts, dossiers).
//     Les routes streaming (mairie/reglementation) restent sur Anthropic
//     tant que la couche SSE Mistral n'est pas livrée (étape 2).
const AI_PROVIDER = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
const USE_BEDROCK = AI_PROVIDER === "bedrock";
const USE_MISTRAL = AI_PROVIDER === "mistral";
const BEDROCK_REGION = process.env.AWS_REGION ?? "eu-central-1";
const MISTRAL_API_BASE = process.env.MISTRAL_API_BASE ?? "https://api.mistral.ai/v1";

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
  if (USE_MISTRAL) {
    // Étape 1 ne couvre pas le streaming Mistral. Garde-fou explicite :
    // les routes mairie/reglementation doivent rester sur Anthropic tant
    // que la couche SSE Mistral n'est pas livrée (étape 2).
    throw new Error(
      "[aiUsage] AI_PROVIDER=mistral : les routes streaming (mairie/reglementation) ne sont pas encore portées sur Mistral. Repasser AI_PROVIDER=anthropic ou =bedrock pour ces routes, ou attendre l'étape 2 du portage.",
    );
  }
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

// ── Tarifs Mistral La Plateforme (EUR par million de tokens) ────────────────
// Tarifs publics Mistral. Mistral facture directement en EUR, pas de
// conversion. Pas de prompt caching côté Mistral aujourd'hui (cache_*=0).
interface MistralPricing { input_eur: number; output_eur: number; }
const MISTRAL_PRICING: Record<string, MistralPricing> = {
  "pixtral-12b-2409":     { input_eur: 0.15, output_eur: 0.15 },
  "pixtral-large-latest": { input_eur: 2.0,  output_eur: 6.0 },
  "mistral-large-latest": { input_eur: 1.8,  output_eur: 5.4 },
  "mistral-small-latest": { input_eur: 0.2,  output_eur: 0.6 },
};
const MISTRAL_DEFAULT_PRICING: MistralPricing = MISTRAL_PRICING["pixtral-large-latest"]!;

// Mapping canonique Anthropic → modèle Mistral utilisé en production.
// Par défaut, on cible Pixtral Large partout : qualité maximale tant que le
// benchmark exploratoire n'a pas validé une descente sur des modèles plus
// petits/moins chers. À ré-affiner après benchmark
// (cf. packages/ingestion/benchmark-fixtures/RUN-BENCHMARK.md).
const MISTRAL_MODEL_MAP: Record<string, string> = {
  "claude-haiku-4-5-20251001": "pixtral-large-latest",
  "claude-haiku-4-5":          "pixtral-large-latest",
  "claude-sonnet-4-6":         "pixtral-large-latest",
  "claude-sonnet-4-5":         "pixtral-large-latest",
  "claude-opus-4-8":           "pixtral-large-latest",
  "claude-opus-4-7":           "pixtral-large-latest",
};

function mistralModelId(canonical: string): string {
  return MISTRAL_MODEL_MAP[canonical] ?? "pixtral-large-latest";
}

function computeMistralCostEur(model: string, prompt_tokens: number, completion_tokens: number): number {
  const p = MISTRAL_PRICING[model] ?? MISTRAL_DEFAULT_PRICING;
  const eur = (prompt_tokens * p.input_eur + completion_tokens * p.output_eur) / 1_000_000;
  return Math.round(eur * 1_000_000) / 1_000_000;
}

function getMistralKey(): string {
  const k = process.env.MISTRAL_API_KEY;
  if (!k) throw new Error("MISTRAL_API_KEY non configurée (AI_PROVIDER=mistral)");
  return k;
}

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
  if (USE_MISTRAL) {
    // Même garde-fou que resolveModelForProvider : les appelants streaming
    // qui dépendent encore du client Anthropic doivent rester sur Anthropic
    // tant que l'étape 2 (streaming Mistral) n'est pas livrée.
    throw new Error(
      "[aiUsage] AI_PROVIDER=mistral : anthropicClient() appelé. Les routes streaming (mairie/reglementation) ne sont pas portées. Repasser AI_PROVIDER=anthropic|bedrock pour ces routes.",
    );
  }
  // Permet de surcharger maxRetries/timeout par appel sans recréer un client à
  // chaque fois pour le cas par défaut.
  if (opts) return newClient(opts);
  if (!_client) _client = newClient();
  return _client;
}

// Étiquette informationnelle pour les logs au boot (cf. probe).
export function aiProviderInfo(): { provider: string; region?: string } {
  if (USE_MISTRAL) return { provider: "mistral", region: "fr-paris" };
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
    if (info.provider === "mistral") {
      console.log(`[aiUsage] 🇫🇷 Fournisseur d'inférence : Mistral La Plateforme (région ${info.region}). Souveraineté française. ⚠️  Étape 1 — streaming mairie/reglementation non encore porté.`);
    } else if (info.provider === "bedrock") {
      console.log(`[aiUsage] 🇪🇺 Fournisseur d'inférence : AWS Bedrock (région ${info.region}). Aucun transfert hors UE (RGPD art. 44).`);
    } else {
      console.log("[aiUsage] 🇺🇸 Fournisseur d'inférence : Anthropic API directe (USA, sous DPA + SCC). Pour basculer : AI_PROVIDER=bedrock (UE) ou AI_PROVIDER=mistral (France).");
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
  // Mistral : dispatch hors du chemin Anthropic. La signature publique
  // (request typée Anthropic.MessageCreateParamsNonStreaming, retour
  // Anthropic.Message) est conservée pour que les 4 services appelants
  // restent intacts pendant la transition (canary par AI_PROVIDER).
  if (USE_MISTRAL) return callMistral(ctx, request);

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

// ── Adapter Mistral ─────────────────────────────────────────────────────────
// Étape 1 du portage Anthropic → Mistral : traduit une requête au format
// Anthropic Messages vers le format chat completions (OpenAI-compatible) de
// Mistral La Plateforme, et reconstruit une `Anthropic.Message` côté retour
// pour préserver l'interface des appelants (pieceAnalyzer, pieceExtractor,
// ruleVerdicts, dossiers.ts).
//
// Limites volontaires (livraison étape 1) :
//   - Pas de streaming (cf. trackClaudeStreamUsage : laissée intacte sur
//     Anthropic, les routes mairie/reglementation jetteront une erreur claire
//     si AI_PROVIDER=mistral — voir aiProviderInfo et resolveModelForProvider).
//   - Pas de prompt caching (Mistral n'expose pas d'équivalent à ce jour).
//   - PDF converti en PNG (première page) via pdftoppm — poppler-utils requis.

interface MistralChatBlock {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}
interface MistralChatMessage {
  role: "system" | "user" | "assistant";
  content: string | MistralChatBlock[];
}

function convertPdfFirstPageToPng(pdf: Buffer): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "heureka-mistral-"));
  try {
    const pdfPath = path.join(dir, "in.pdf");
    const outPrefix = path.join(dir, "out");
    writeFileSync(pdfPath, pdf);
    execFileSync("pdftoppm", ["-png", "-r", "200", "-f", "1", "-l", "1", pdfPath, outPrefix], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    return readFileSync(`${outPrefix}-1.png`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Traduit le `messages: [...]` d'une requête Anthropic en messages Mistral.
 * - Le `system` top-level Anthropic devient un message `{ role: "system" }`.
 * - Les blocs `image` (base64) deviennent des `image_url` data-URI.
 * - Les blocs `document` (PDF base64) sont convertis en PNG via pdftoppm.
 * - Les blocs `text` restent des `text`.
 */
function translateAnthropicMessagesForMistral(
  request: Anthropic.MessageCreateParamsNonStreaming,
): MistralChatMessage[] {
  const out: MistralChatMessage[] = [];

  // Le `system` Anthropic peut être string OU array de TextBlockParam.
  if (request.system) {
    const sys = typeof request.system === "string"
      ? request.system
      : request.system.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    out.push({ role: "system", content: sys });
  }

  for (const m of request.messages) {
    const role = m.role; // "user" | "assistant"
    if (typeof m.content === "string") {
      out.push({ role, content: m.content });
      continue;
    }
    const blocks: MistralChatBlock[] = [];
    for (const b of m.content) {
      if (b.type === "text") {
        blocks.push({ type: "text", text: b.text });
      } else if (b.type === "image") {
        const src = b.source as { type: "base64"; media_type: string; data: string };
        blocks.push({ type: "image_url", image_url: { url: `data:${src.media_type};base64,${src.data}` } });
      } else if (b.type === "document") {
        const src = b.source as { type: "base64"; media_type: string; data: string };
        if (src.media_type === "application/pdf") {
          const png = convertPdfFirstPageToPng(Buffer.from(src.data, "base64"));
          blocks.push({ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } });
        } else {
          // Autres formats document : non supportés par Mistral, on les
          // sérialise en texte pour ne pas faire échouer l'appel.
          blocks.push({ type: "text", text: `[document ${src.media_type} non rendu visuellement]` });
        }
      }
      // Les autres types (tool_use, tool_result, thinking…) ne sont pas
      // utilisés dans les 4 services portés à l'étape 1.
    }
    out.push({ role, content: blocks });
  }
  return out;
}

interface MistralChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { role?: string; content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

async function callMistral(
  ctx: CallClaudeContext,
  request: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const canonicalModel = request.model;
  const mistralModel = mistralModelId(canonicalModel);
  const messages = translateAnthropicMessagesForMistral(request);

  const body = {
    model: mistralModel,
    max_tokens: request.max_tokens,
    temperature: request.temperature,
    response_format: { type: "json_object" as const },
    messages,
  };

  const startedAt = Date.now();
  const res = await fetch(`${MISTRAL_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getMistralKey()}`,
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });
  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mistral HTTP ${res.status} : ${txt.slice(0, 300)}`);
  }
  const data = await res.json() as MistralChatResponse;
  const text = data.choices?.[0]?.message?.content ?? "";
  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;
  const cost = computeMistralCostEur(mistralModel, promptTokens, completionTokens);

  // On stocke le nom RÉEL du modèle Mistral utilisé (pas le canonique Claude)
  // pour que les dashboards reflètent ce qui a vraiment tourné et permettent
  // une comparaison Anthropic vs Mistral à coût comparable.
  void db.insert(ai_usage_events).values({
    dossier_id: ctx.dossierId ?? null,
    commune_id: ctx.communeId ?? null,
    user_id: ctx.userId ?? null,
    purpose: ctx.purpose,
    model: mistralModel,
    input_tokens: promptTokens,
    output_tokens: completionTokens,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cost_eur: cost,
    duration_ms: durationMs,
    file_hash: ctx.fileHash ?? null,
  }).then(() => {
    void maybeNotify({
      purpose: ctx.purpose,
      model: mistralModel,
      cost_eur: cost,
      dossier_id: ctx.dossierId ?? null,
      commune_id: ctx.communeId ?? null,
    });
  }).catch((err) => {
    console.error(
      `[aiUsage] ⚠️  INSERT ÉCHOUÉ (mistral) — événement payant non tracé (purpose=${ctx.purpose}, model=${mistralModel}, cost=${cost}€).`,
      err instanceof Error ? err.message : err,
    );
  });

  // Reconstruit une Anthropic.Message minimaliste — suffisant pour les
  // appelants qui ne lisent que `content[0].text` et `usage`.
  return {
    id: data.id ?? `mistral_${Date.now()}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text, citations: null }],
    model: mistralModel,
    stop_reason: (data.choices?.[0]?.finish_reason as Anthropic.Message["stop_reason"]) ?? "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: promptTokens,
      output_tokens: completionTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: null,
      service_tier: null,
    },
  } as unknown as Anthropic.Message;
}
