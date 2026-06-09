import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { db } from "../db.js";
import { ai_usage_events } from "@heureka-v1/db";

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
export function anthropicClient(opts?: { maxRetries?: number; timeout?: number }): Anthropic {
  // Permet de surcharger maxRetries/timeout par appel sans recréer un client à
  // chaque fois pour le cas par défaut.
  if (opts) return new Anthropic({ apiKey: getAnthropicKey(), ...opts });
  if (!_client) _client = new Anthropic({ apiKey: getAnthropicKey() });
  return _client;
}

// ── Wrapper de tracking ─────────────────────────────────────────────────────

export interface CallClaudeContext {
  purpose: string;
  dossierId?: string | null;
  communeId?: string | null;
  userId?: string | null;
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
  const startedAt = Date.now();
  const msg = await c.messages.create(request);
  const durationMs = Date.now() - startedAt;

  const usage = msg.usage ?? { input_tokens: 0, output_tokens: 0 };
  const cacheRead = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cacheCreate = (usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;
  const cost = computeCostEur(request.model, {
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
    model: request.model,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate,
    cost_eur: cost,
    duration_ms: durationMs,
  }).catch((err) => {
    console.error("[aiUsage] insert failed:", err);
  });

  return msg;
}
