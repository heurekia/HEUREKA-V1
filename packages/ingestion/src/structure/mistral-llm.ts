/**
 * Default LlmFn backed by Mistral La Plateforme (Pixtral Large par défaut).
 * Appel REST direct au format chat completions OpenAI-compatible.
 * Requiert MISTRAL_API_KEY.
 *
 * Tracking : un callback optionnel `onUsage` permet à l'appelant (côté API)
 * d'injecter sa propre fonction de tracking — ce package ne dépend pas de
 * apps/api. Sans callback, l'appel reste fonctionnel mais invisible côté
 * onglet "Coûts IA".
 */
import type { LlmFn } from "./structurer.ts";
import { fetchWithRetry } from "../llm-fetch.ts";

const MISTRAL_API_BASE = process.env.MISTRAL_API_BASE ?? "https://api.mistral.ai/v1";

export interface MistralLlmUsage {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  duration_ms: number;
}

export interface MistralLlmOptions {
  model?: string;
  onUsage?: (u: MistralLlmUsage) => void;
}

export function mistralLlm(opts: MistralLlmOptions | string = {}): LlmFn {
  const resolved: MistralLlmOptions = typeof opts === "string" ? { model: opts } : opts;
  const model = resolved.model ?? "pixtral-large-latest";
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY non configurée — requise pour la structuration des règles.");

  return async (system, user) => {
    const startedAt = Date.now();
    const res = await fetchWithRetry(`${MISTRAL_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    }, { timeoutMs: 90_000, retries: 3, label: "Mistral structuration" });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Mistral HTTP ${res.status} : ${txt.slice(0, 300)}`);
    }
    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (resolved.onUsage) {
      try {
        resolved.onUsage({
          model,
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0,
          duration_ms: Date.now() - startedAt,
        });
      } catch {
        /* tracking best-effort */
      }
    }
    return data.choices?.[0]?.message?.content ?? "[]";
  };
}
