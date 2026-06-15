/**
 * Default LlmFn backed by Mistral La Plateforme (Pixtral Large par défaut).
 * Appel REST direct au format chat completions OpenAI-compatible.
 * Requiert MISTRAL_API_KEY.
 */
import type { LlmFn } from "./structurer.ts";

const MISTRAL_API_BASE = process.env.MISTRAL_API_BASE ?? "https://api.mistral.ai/v1";

export function mistralLlm(model = "pixtral-large-latest"): LlmFn {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY non configurée — requise pour la structuration des règles.");

  return async (system, user) => {
    const res = await fetch(`${MISTRAL_API_BASE}/chat/completions`, {
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
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Mistral HTTP ${res.status} : ${txt.slice(0, 300)}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "[]";
  };
}
