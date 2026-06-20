/**
 * Inférence IA — Mistral La Plateforme (direct, Paris, France).
 *
 * Décision juin 2026 : on bascule l'intégralité des appels IA de HEUREKA
 * (citoyen + mairie) sur Mistral La Plateforme en accès direct. Raisons :
 *   - Vision requise (CERFA, plans, photos) → Pixtral, non disponible sur
 *     AWS Bedrock à ce jour.
 *   - Souveraineté : entité Mistral SA Paris, droit français applicable.
 *   - Latence (~15 ms depuis Tours) et tarif natif EUR.
 *
 * Cette refonte retire entièrement les chemins Anthropic + Bedrock :
 * variables d'env (AI_PROVIDER, AWS_*), SDK (@anthropic-ai/sdk, @anthropic-ai/
 * bedrock-sdk), types Claude. Le tracking ai_usage_events reste identique
 * — seul le `model` stocké change (pixtral-large-latest plutôt que claude-*).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../db.js";
import { ai_usage_events } from "@heureka-v1/db";
import { maybeNotify } from "./aiAlerts.js";

const MISTRAL_API_BASE = process.env.MISTRAL_API_BASE ?? "https://api.mistral.ai/v1";

// ── Tarifs Mistral La Plateforme (EUR par million de tokens) ────────────────
// Mistral facture en EUR-natif, pas de conversion USD→EUR. Aucun équivalent
// prompt caching à ce jour côté Mistral → cache_*_input_tokens toujours à 0
// dans ai_usage_events.
interface MistralPricing { input_eur: number; output_eur: number; }
const MISTRAL_PRICING: Record<string, MistralPricing> = {
  "pixtral-12b-2409":     { input_eur: 0.15, output_eur: 0.15 },
  "pixtral-large-latest": { input_eur: 2.0,  output_eur: 6.0 },
  "mistral-large-latest": { input_eur: 1.8,  output_eur: 5.4 },
  "mistral-small-latest": { input_eur: 0.2,  output_eur: 0.6 },
};
const DEFAULT_PRICING: MistralPricing = MISTRAL_PRICING["pixtral-large-latest"]!;

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

function computeCostEur(model: string, prompt_tokens: number, completion_tokens: number): number {
  const p = MISTRAL_PRICING[model] ?? DEFAULT_PRICING;
  const eur = (prompt_tokens * p.input_eur + completion_tokens * p.output_eur) / 1_000_000;
  return Math.round(eur * 1_000_000) / 1_000_000;
}

function getMistralKey(): string {
  const k = process.env.MISTRAL_API_KEY;
  if (!k) throw new Error("MISTRAL_API_KEY non configurée");
  return k;
}

export function aiProviderInfo(): { provider: string; region: string } {
  return { provider: "mistral", region: "fr-paris" };
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
      // trace cryptique. Le déploiement Railway installe poppler-utils via
      // nixpacks.toml ; en local : `apt install poppler-utils` (Debian/
      // Ubuntu), `brew install poppler` (macOS), ou `nix-shell -p
      // poppler_utils`. Cf. apps/api/.env.example.
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") {
        throw new Error(
          "pdftoppm introuvable (paquet poppler-utils). Installer : `apt install poppler-utils` (Linux), `brew install poppler` (macOS). En prod Railway : redéployer pour appliquer nixpacks.toml.",
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
    console.log("[aiUsage] 🇫🇷 Fournisseur d'inférence : Mistral La Plateforme (fr-paris). Souveraineté française, vision native (Pixtral).");
  } catch (err) {
    console.error("[aiUsage] probe échoué:", err instanceof Error ? err.message : err);
  }
}

// ── Helpers de tracking (factorisés entre callAi et streamAi) ───────────────

function trackUsage(
  ctx: CallAiContext,
  model: string,
  promptTokens: number,
  completionTokens: number,
  durationMs: number,
  label: "call" | "stream",
): void {
  const cost = computeCostEur(model, promptTokens, completionTokens);
  void db.insert(ai_usage_events).values({
    dossier_id: ctx.dossierId ?? null,
    commune_id: ctx.communeId ?? null,
    user_id: ctx.userId ?? null,
    purpose: ctx.purpose,
    model,
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
      model,
      cost_eur: cost,
      dossier_id: ctx.dossierId ?? null,
      commune_id: ctx.communeId ?? null,
    });
  }).catch((err) => {
    console.error(
      `[aiUsage] ⚠️  INSERT ÉCHOUÉ (${label}) — événement payant non tracé (purpose=${ctx.purpose}, model=${model}, cost=${cost}€).`,
      err instanceof Error ? err.message : err,
    );
  });
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
 * Streaming SSE Mistral. Renvoie un objet qui s'itère comme un stream
 * Anthropic (event.type === "content_block_delta") pour minimiser la
 * réécriture des routes mairie/reglementation. Le tracking ai_usage_events
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
