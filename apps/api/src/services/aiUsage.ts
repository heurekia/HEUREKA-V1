/**
 * Inférence IA — Mistral La Plateforme (direct, Paris, France).
 *
 * Choix Mistral :
 *   - Vision native (CERFA, plans, photos) avec Pixtral.
 *   - Souveraineté : entité Mistral AI SAS Paris, droit français applicable,
 *     inférence sur datacenters UE — pas de transfert hors UE, pas de SCC.
 *   - Tarif natif EUR.
 *
 * Tous les appels IA passent par `callAi` / `streamAi` ci-dessous, qui
 * alimentent `ai_usage_events` (page admin « Coûts IA »). Le `model` stocké
 * est l'id Mistral natif (ex. `pixtral-large-latest`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../db.js";
import { ai_usage_events, ai_pricing } from "@heureka-v1/db";
import { maybeNotify } from "./aiAlerts.js";

const MISTRAL_API_BASE = process.env.MISTRAL_API_BASE ?? "https://api.mistral.ai/v1";

// ── Tarifs Mistral La Plateforme (EUR par million de tokens) ────────────────
// La grille est désormais lue depuis la table `ai_pricing`, éditable depuis
// l'onglet "Coûts IA" du back-office. On garde un cache mémoire 60 s pour ne
// pas requêter la DB à chaque appel LLM. Le fallback `DEFAULT_PRICING` n'est
// utilisé que si (1) la DB n'a pas encore la ligne pour ce modèle ET (2) le
// cache n'a jamais été chargé — typiquement au boot avant le premier appel.
interface MistralPricing { input_eur: number; output_eur: number; kind: "chat" | "embedding"; }
const FALLBACK_PRICING: Record<string, MistralPricing> = {
  "pixtral-12b-2409":     { input_eur: 0.15, output_eur: 0.15, kind: "chat" },
  "pixtral-large-latest": { input_eur: 2.0,  output_eur: 6.0,  kind: "chat" },
  "mistral-large-latest": { input_eur: 1.8,  output_eur: 5.4,  kind: "chat" },
  "mistral-large-3":      { input_eur: 0.46, output_eur: 1.38, kind: "chat" },
  "mistral-small-latest": { input_eur: 0.2,  output_eur: 0.6,  kind: "chat" },
  "mistral-small-4":      { input_eur: 0.09, output_eur: 0.28, kind: "chat" },
  "mistral-embed":        { input_eur: 0.09, output_eur: 0,    kind: "embedding" },
};
const DEFAULT_PRICING: MistralPricing = FALLBACK_PRICING["pixtral-large-latest"]!;

// Cache mémoire de la grille tarifaire. Rafraîchi à la demande (TTL 60 s) ou
// invalidé explicitement par la route PUT /admin/ai-cost/pricing.
const PRICING_TTL_MS = 60_000;
let pricingCache: { at: number; map: Record<string, MistralPricing> } | null = null;

async function loadPricing(): Promise<Record<string, MistralPricing>> {
  const now = Date.now();
  if (pricingCache && now - pricingCache.at < PRICING_TTL_MS) return pricingCache.map;
  try {
    const rows = await db
      .select({
        model: ai_pricing.model,
        kind: ai_pricing.kind,
        input_eur_per_m: ai_pricing.input_eur_per_m,
        output_eur_per_m: ai_pricing.output_eur_per_m,
      })
      .from(ai_pricing);
    const map: Record<string, MistralPricing> = { ...FALLBACK_PRICING };
    for (const r of rows) {
      map[r.model] = {
        input_eur: Number(r.input_eur_per_m),
        output_eur: Number(r.output_eur_per_m),
        kind: (r.kind === "embedding" ? "embedding" : "chat") as "chat" | "embedding",
      };
    }
    pricingCache = { at: now, map };
    return map;
  } catch (err) {
    // Si la DB est indisponible, on retombe sur la grille en dur — préférable
    // à un cost_eur=0 qui maquillerait la facture estimée.
    console.warn("[aiUsage] loadPricing fallback (DB unreachable):", err instanceof Error ? err.message : err);
    return FALLBACK_PRICING;
  }
}

/** Invalidation explicite du cache (après PUT /admin/ai-cost/pricing). */
export function invalidatePricingCache(): void {
  pricingCache = null;
}

// ── Noms abstraits d'usage (côté appelants) ─────────────────────────────────
// Les services métier déclarent leur besoin par un nom abstrait (`ai-fast`
// pour les tâches simples, `ai-smart` pour les analyses complexes) ; on
// résout ici vers le modèle Mistral réel. Permet de retuner finement le
// catalogue post-benchmark sans toucher au code applicatif.
const MODEL_MAP: Record<string, string> = {
  "ai-fast":  "pixtral-large-latest",
  "ai-smart": "pixtral-large-latest",
};

function resolveModel(canonical: string): string {
  // Si l'appelant fournit déjà un id Mistral natif, on le respecte tel quel.
  return MODEL_MAP[canonical] ?? canonical;
}

interface PricedCost {
  cost_eur: number;
  input_eur_per_m: number;
  output_eur_per_m: number;
}

async function computeCostEur(model: string, prompt_tokens: number, completion_tokens: number): Promise<PricedCost> {
  const pricing = await loadPricing();
  const p = pricing[model] ?? DEFAULT_PRICING;
  const eur = (prompt_tokens * p.input_eur + completion_tokens * p.output_eur) / 1_000_000;
  return {
    cost_eur: Math.round(eur * 1_000_000) / 1_000_000,
    input_eur_per_m: p.input_eur,
    output_eur_per_m: p.output_eur,
  };
}

function getMistralKey(): string {
  const k = process.env.MISTRAL_API_KEY;
  if (!k) throw new Error("MISTRAL_API_KEY non configurée");
  return k;
}

// ── Types AiRequest (format interne, indépendant du SDK Mistral) ────────────

export type AiContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

export interface AiToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiRequest {
  /** Nom abstrait ("ai-fast" | "ai-smart") ou id Mistral natif. */
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string | AiContentBlock[];
  }>;
  /** Function calling (format OpenAI-compatible). */
  tools?: AiToolDefinition[];
  tool_choice?: "auto" | "none" | "any" | { type: "function"; function: { name: string } };
}

export type AiResponseBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export interface AiMessage {
  content: AiResponseBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

export interface CallAiContext {
  purpose: string;
  dossierId?: string | null;
  communeId?: string | null;
  userId?: string | null;
  /** SHA-256 hex du fichier envoyé à l'IA, tracé dans ai_usage_events.file_hash. */
  fileHash?: string | null;
}

// ── Conversion AiRequest → payload Mistral chat.completions ─────────────────

interface MistralChatTextBlock { type: "text"; text: string; }
interface MistralChatImageBlock { type: "image_url"; image_url: { url: string }; }
type MistralChatBlock = MistralChatTextBlock | MistralChatImageBlock;
interface MistralChatMessage {
  role: "system" | "user" | "assistant";
  content: string | MistralChatBlock[];
}

function convertPdfFirstPageToPng(pdf: Buffer): Buffer {
  return convertPdfPagesToPng(pdf, { maxPages: 1, dpi: 200 })[0]!;
}

// Rend les pages d'un PDF en PNGs via pdftoppm. Utilisé par les callers qui
// veulent envoyer plusieurs pages à Pixtral (qui n'accepte pas le PDF natif)
// — typiquement l'OCR CERFA, où des champs utiles se trouvent en pages 2-3
// (terrain, parcelle, surface de plancher, description du projet) ; et
// l'ingestion PLU qui doit rendre toutes les pages d'une zone (cf. mairie/
// admin.ts → ingest-plu-pdf) pour que Pixtral puisse réellement lire les
// tableaux (article 12, espaces verts…) au-delà de la première page.
//
// `firstPage` 1-indexé (cf. pdftoppm -f). `maxPages` non défini → toutes
// les pages restantes ; sinon on rend `maxPages` pages à partir de
// `firstPage`. `dpi` 150 par défaut : lisible pour l'OCR sans faire
// exploser la taille du payload Mistral sur un PDF multi-pages.
export function convertPdfPagesToPng(
  pdf: Buffer,
  opts: { firstPage?: number; maxPages?: number; dpi?: number } = {},
): Buffer[] {
  const dpi = opts.dpi ?? 150;
  const firstPage = Math.max(1, opts.firstPage ?? 1);
  const dir = mkdtempSync(path.join(tmpdir(), "heureka-ai-"));
  try {
    const pdfPath = path.join(dir, "in.pdf");
    const outPrefix = path.join(dir, "out");
    writeFileSync(pdfPath, pdf);
    try {
      const args = ["-png", "-r", String(dpi), "-f", String(firstPage)];
      if (opts.maxPages && opts.maxPages > 0) {
        args.push("-l", String(firstPage + opts.maxPages - 1));
      }
      args.push(pdfPath, outPrefix);
      execFileSync("pdftoppm", args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      // ENOENT = binaire absent → message actionnable plutôt que stack
      // trace cryptique. Le VPS OVH provisionne poppler-utils via le script
      // de setup ; en local : `apt install poppler-utils` (Debian/Ubuntu),
      // `brew install poppler` (macOS), ou `nix-shell -p poppler_utils`.
      // Cf. apps/api/.env.example.
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") {
        throw new Error(
          "pdftoppm introuvable (paquet poppler-utils). Installer : `apt install poppler-utils` (Linux), `brew install poppler` (macOS). En prod : ré-exécuter le provisioning du VPS.",
        );
      }
      throw err;
    }
    // Le format des noms de fichiers produits par pdftoppm dépend de la
    // version : `out-1.png`, `out-01.png`, voire `out.png` lorsqu'une seule
    // page est demandée sur certaines builds. On liste simplement le dossier
    // pour rester robuste, et on trie pour garder l'ordre des pages.
    const out = readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith(".png"))
      .sort((a, b) => {
        // Tri naturel sur les numéros de page incrustés dans le nom.
        const na = parseInt(a.match(/(\d+)\.png$/i)?.[1] ?? "0", 10);
        const nb = parseInt(b.match(/(\d+)\.png$/i)?.[1] ?? "0", 10);
        return na - nb;
      })
      .map((n) => readFileSync(path.join(dir, n)));
    if (out.length === 0) {
      throw new Error("pdftoppm n'a produit aucune page");
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Extrait le texte natif d'une plage de pages via pdftotext (poppler-utils,
// installé en même temps que pdftoppm). Utilisé par l'ingestion PLU pour lire
// le sommaire sans appel Pixtral : ~1 s au lieu de 30 s, ce qui fait passer
// /ingest-plu-pdf/start sous le timeout du proxy nginx (60 s).
//
// Renvoie `null` si pdftotext n'est pas installé (le caller bascule alors sur
// le chemin Pixtral). Renvoie une chaîne vide si le PDF n'a pas de couche
// texte (PDF scanné) — le caller bascule aussi sur Pixtral.
export function extractPdfText(
  pdf: Buffer,
  opts: { firstPage?: number; lastPage?: number } = {},
): string | null {
  const dir = mkdtempSync(path.join(tmpdir(), "heureka-pdftext-"));
  try {
    const pdfPath = path.join(dir, "in.pdf");
    writeFileSync(pdfPath, pdf);
    const args = ["-layout"];
    if (opts.firstPage) args.push("-f", String(opts.firstPage));
    if (opts.lastPage) args.push("-l", String(opts.lastPage));
    args.push(pdfPath, "-"); // "-" = stdout
    try {
      const out = execFileSync("pdftotext", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
      return out.toString("utf8");
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return null;
      throw err;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function translateMessages(request: AiRequest): MistralChatMessage[] {
  const out: MistralChatMessage[] = [];
  if (request.system) {
    out.push({ role: "system", content: request.system });
  }
  for (const m of request.messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const blocks: MistralChatBlock[] = [];
    for (const b of m.content) {
      if (b.type === "text") {
        blocks.push({ type: "text", text: b.text });
      } else if (b.type === "image") {
        blocks.push({
          type: "image_url",
          image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
        });
      } else if (b.type === "document") {
        if (b.source.media_type === "application/pdf") {
          // Pixtral n'accepte pas le PDF natif → conversion première page
          // via pdftoppm (poppler-utils). Pour les PDF multi-pages, prévoir
          // un découpage côté appelant (cf. splitPdfBase64 dans mairie/admin).
          const png = convertPdfFirstPageToPng(Buffer.from(b.source.data, "base64"));
          blocks.push({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
          });
        } else {
          // Format document non visuellement rendu (rare) → signaler en texte.
          blocks.push({ type: "text", text: `[document ${b.source.media_type} non rendu visuellement]` });
        }
      }
    }
    out.push({ role: m.role, content: blocks });
  }
  return out;
}

// ── Boot probe ──────────────────────────────────────────────────────────────
const REQUIRED_COLUMNS = [
  "id", "dossier_id", "commune_id", "user_id", "purpose", "model",
  "input_tokens", "output_tokens", "cost_eur", "duration_ms", "created_at",
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
    console.log("[aiUsage] 🇫🇷 Fournisseur d'inférence : Mistral La Plateforme (fr-paris). Souveraineté française, vision native (Pixtral).");
  } catch (err) {
    console.error("[aiUsage] probe échoué:", err instanceof Error ? err.message : err);
  }
}

// ── Boot probe : dépendance système poppler-utils ────────────────────────────
// Pixtral n'accepte pas le PDF natif. TOUTE analyse/extraction d'une pièce PDF
// (analyzePiece + extractPiece) passe donc par un rendu PDF→PNG via `pdftoppm`,
// et la segmentation des dépôts groupés lit la couche texte via `pdftotext`.
// Ces deux binaires viennent du paquet `poppler-utils`.
//
// Si `pdftoppm` manque (ou n'est pas sur le PATH du process API), CHAQUE OCR de
// pièce PDF échoue : analyzePiece ET extractPiece lèvent au rendu, la pièce est
// marquée `ocr_status = "failed"` (badge rouge « ⚠ OCR » côté instructeur) alors
// que le document est parfaitement lisible. Comme la segmentation, elle, peut
// passer par la couche texte (`pdftotext`) sans rendre d'image, on observe le
// symptôme déroutant « pièces correctement reconnues mais toutes en échec OCR ».
// On sonde au boot pour transformer cette panne silencieuse en message
// actionnable (l'install n'est documentée que dans le README, jamais vérifiée).
export function probePdfTooling(): void {
  const tools = [
    { bin: "pdftoppm", role: "rendu PDF→PNG (analyse + extraction des pièces)" },
    { bin: "pdftotext", role: "lecture de la couche texte (segmentation des dépôts groupés)" },
  ];
  const missing: string[] = [];
  for (const { bin } of tools) {
    try {
      // `-v` imprime la version et sort en code 0 quand le binaire est présent.
      execFileSync(bin, ["-v"], { stdio: ["ignore", "ignore", "ignore"] });
    } catch (err) {
      // Seul ENOENT = binaire absent. Un binaire présent qui renverrait un code
      // ≠ 0 sur `-v` reste exploitable : on ne le compte pas comme manquant.
      if ((err as { code?: string }).code === "ENOENT") missing.push(bin);
    }
  }
  if (missing.length === 0) {
    console.log("[pdf-tooling] ✅ poppler-utils présent (pdftoppm + pdftotext) — OCR des pièces PDF opérationnel.");
    return;
  }
  console.error(
    `[pdf-tooling] ⚠️  Binaire(s) manquant(s) : ${missing.join(", ")} (paquet poppler-utils). ` +
    (missing.includes("pdftoppm")
      ? "Sans pdftoppm, l'OCR de TOUTE pièce PDF échoue (ocr_status=failed, badge rouge « ⚠ OCR ») alors que les documents sont lisibles. "
      : "") +
    "Installer : `apt install poppler-utils` (Debian/Ubuntu) ou `brew install poppler` (macOS), puis redémarrer l'API.",
  );
}

// ── Helpers de tracking (factorisés entre callAi et streamAi) ───────────────

function trackUsage(
  ctx: CallAiContext,
  model: string,
  promptTokens: number,
  completionTokens: number,
  durationMs: number,
  label: "call" | "stream" | "embedding" | "external",
  endpoint: "chat" | "embedding" = "chat",
): void {
  void (async () => {
    const priced = await computeCostEur(model, promptTokens, completionTokens);
    try {
      await db.insert(ai_usage_events).values({
        dossier_id: ctx.dossierId ?? null,
        commune_id: ctx.communeId ?? null,
        user_id: ctx.userId ?? null,
        purpose: ctx.purpose,
        model,
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        cost_eur: priced.cost_eur,
        input_rate_eur_per_m: priced.input_eur_per_m,
        output_rate_eur_per_m: priced.output_eur_per_m,
        endpoint,
        duration_ms: durationMs,
        file_hash: ctx.fileHash ?? null,
      });
      void maybeNotify({
        purpose: ctx.purpose,
        model,
        cost_eur: priced.cost_eur,
        dossier_id: ctx.dossierId ?? null,
        commune_id: ctx.communeId ?? null,
      });
    } catch (err) {
      console.error(
        `[aiUsage] ⚠️  INSERT ÉCHOUÉ (${label}) — événement payant non tracé (purpose=${ctx.purpose}, model=${model}, cost=${priced.cost_eur}€).`,
        err instanceof Error ? err.message : err,
      );
    }
  })();
}

/**
 * Wrapper de tracking pour les appels Mistral qui ne passent PAS par callAi/
 * streamAi (embeddings, structuration via `mistralLlm()` côté ingestion, etc.).
 * À appeler après une réponse HTTP réussie, avec les tokens retournés par
 * Mistral et l'endpoint frappé (`chat` ou `embedding`).
 */
export function trackExternalMistralUsage(
  ctx: CallAiContext,
  model: string,
  promptTokens: number,
  completionTokens: number,
  durationMs: number,
  endpoint: "chat" | "embedding" = "chat",
): void {
  trackUsage(ctx, model, promptTokens, completionTokens, durationMs, "external", endpoint);
}

// ── callAi (non-streaming) ──────────────────────────────────────────────────
interface MistralChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Appelle Mistral chat completions et trace l'usage dans ai_usage_events.
 * Best-effort sur l'écriture DB : une erreur d'insert ne fait pas échouer
 * la requête métier (mais loggue un warning clair).
 */
export async function callAi(ctx: CallAiContext, request: AiRequest): Promise<AiMessage> {
  const mistralModel = resolveModel(request.model);
  const body: Record<string, unknown> = {
    model: mistralModel,
    max_tokens: request.max_tokens,
    messages: translateMessages(request),
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  // Mistral ne supporte pas response_format=json_object SIMULTANÉMENT avec
  // des tools — on privilégie tools si fourni, sinon mode JSON strict.
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
    if (request.tool_choice !== undefined) body.tool_choice = request.tool_choice;
  } else {
    body.response_format = { type: "json_object" };
  }

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
  const choice = data.choices?.[0];
  const text = choice?.message?.content ?? "";
  const toolCalls = choice?.message?.tool_calls ?? [];
  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;

  trackUsage(ctx, mistralModel, promptTokens, completionTokens, durationMs, "call");

  const content: AiResponseBlock[] = [];
  if (text) content.push({ type: "text", text });
  for (const tc of toolCalls) {
    if (!tc.function?.name) continue;
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(tc.function.arguments ?? "{}") as Record<string, unknown>; }
    catch { /* arguments mal formés : on remonte un input vide plutôt qu'une erreur */ }
    content.push({
      type: "tool_use",
      id: tc.id ?? `tool_${Date.now()}`,
      name: tc.function.name,
      input,
    });
  }

  return {
    content,
    stop_reason: choice?.finish_reason ?? null,
    usage: { input_tokens: promptTokens, output_tokens: completionTokens },
    model: mistralModel,
  };
}

// ── streamAi (streaming SSE) ────────────────────────────────────────────────

export interface AiStreamEvent {
  type: "content_block_delta";
  delta: { type: "text_delta"; text: string };
}

export interface AiStreamFinalMessage {
  content: Array<{ type: "text"; text: string }>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

export interface AiStream {
  [Symbol.asyncIterator](): AsyncIterator<AiStreamEvent>;
  finalMessage(): Promise<AiStreamFinalMessage>;
}

/**
 * Streaming SSE Mistral. Renvoie un objet itérable d'événements
 * `content_block_delta` / `text_delta` (forme héritée pour minimiser la
 * réécriture des routes mairie/reglementation — à plat sur Mistral, mais le
 * shape interne reste indépendant du provider). Le tracking ai_usage_events
 * est déclenché automatiquement à `finalMessage()`.
 */
export async function streamAi(ctx: CallAiContext, request: AiRequest): Promise<AiStream> {
  const mistralModel = resolveModel(request.model);
  const body: Record<string, unknown> = {
    model: mistralModel,
    max_tokens: request.max_tokens,
    stream: true,
    messages: translateMessages(request),
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
    if (request.tool_choice !== undefined) body.tool_choice = request.tool_choice;
  }

  const startedAt = Date.now();
  const res = await fetch(`${MISTRAL_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getMistralKey()}`,
      "Accept": "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Mistral HTTP ${res.status} (stream) : ${txt.slice(0, 300)}`);
  }

  let accumulated = "";
  let stopReason: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let tracked = false;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  // Generator unique partagé entre l'itération et finalMessage() — sinon le
  // body fetch ne pourrait pas être lu deux fois.
  async function* parseStream(): AsyncGenerator<AiStreamEvent, void, void> {
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          if (!data) continue;
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              accumulated += delta;
              yield { type: "content_block_delta", delta: { type: "text_delta", text: delta } };
            }
            const fr = json.choices?.[0]?.finish_reason;
            if (fr) stopReason = fr;
            if (json.usage) {
              promptTokens = json.usage.prompt_tokens ?? promptTokens;
              completionTokens = json.usage.completion_tokens ?? completionTokens;
            }
          } catch {
            // Ligne SSE non-JSON (heartbeat, commentaire) — ignorer silencieusement.
          }
        }
      }
    }
  }

  let cached: AsyncGenerator<AiStreamEvent, void, void> | null = null;
  const getIter = () => {
    if (!cached) cached = parseStream();
    return cached;
  };

  const ensureTracked = () => {
    if (tracked) return;
    tracked = true;
    trackUsage(ctx, mistralModel, promptTokens, completionTokens, Date.now() - startedAt, "stream");
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<AiStreamEvent> {
      return getIter();
    },
    async finalMessage(): Promise<AiStreamFinalMessage> {
      // Si l'appelant n'a pas drainé l'itérateur, on le draine ici pour
      // récupérer le finish_reason + l'usage du dernier chunk.
      const it = getIter();
      // eslint-disable-next-line no-empty
      while (!(await it.next()).done) {}
      ensureTracked();
      return {
        content: [{ type: "text", text: accumulated }],
        stop_reason: stopReason,
        usage: { input_tokens: promptTokens, output_tokens: completionTokens },
        model: mistralModel,
      };
    },
  };
}
