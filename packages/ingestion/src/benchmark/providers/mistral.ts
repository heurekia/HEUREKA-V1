/**
 * Provider Mistral La Plateforme (Pixtral) — option souveraineté française.
 *
 * Pas de SDK ajouté en dépendance pour ne pas alourdir l'image en
 * production : on appelle l'API REST directement. La Plateforme expose
 * un format compatible OpenAI Chat Completions avec support d'images.
 *
 * Doc : https://docs.mistral.ai/capabilities/vision/
 *
 * Limites connues à valider par le benchmark :
 * - Pixtral 12B et Pixtral Large acceptent les images JPG/PNG mais PAS
 *   les PDF nativement → on doit pdf-to-image au préalable pour les CERFA
 *   et plans en PDF (à ajouter si besoin, ici on lève une erreur claire).
 */
import type { BenchmarkProvider, PieceFixture, ProviderResponse } from "../types.js";
import { SYSTEM_ANALYZE, SYSTEM_EXTRACT, buildContextText, extractFirstJson } from "../prompts.js";

const PRICING: Record<string, { input: number; output: number }> = {
  // EUR / 1M tokens — tarifs publics Mistral (à vérifier au moment du benchmark).
  "pixtral-12b-2409":    { input: 0.15, output: 0.15 },
  "pixtral-large-latest": { input: 2.0,  output: 6.0 },
};

export class MistralProvider implements BenchmarkProvider {
  name: string;
  region = "fr-paris";
  country = "🇫🇷 France (Mistral La Plateforme)";
  model: string;
  private apiKey: string;

  constructor(model: "pixtral-12b-2409" | "pixtral-large-latest") {
    this.model = model;
    this.name = `Mistral ${model}`;
    const key = process.env.MISTRAL_API_KEY;
    if (!key) throw new Error("MISTRAL_API_KEY requis pour le benchmark Mistral");
    this.apiKey = key;
  }

  async analyze(piece: PieceFixture, fileBuffer: Buffer): Promise<ProviderResponse> {
    return this.run(piece, fileBuffer, SYSTEM_ANALYZE, 500);
  }

  async extract(piece: PieceFixture, fileBuffer: Buffer): Promise<ProviderResponse> {
    return this.run(piece, fileBuffer, SYSTEM_EXTRACT, 2500);
  }

  private async run(
    piece: PieceFixture,
    fileBuffer: Buffer,
    system: string,
    maxTokens: number,
  ): Promise<ProviderResponse> {
    if (piece.mime === "application/pdf") {
      return {
        parsed: null, raw_text: "", input_tokens: 0, output_tokens: 0,
        cost_eur: 0, duration_ms: 0, model_id: this.model,
        error: "Mistral Pixtral n'accepte pas les PDF nativement — convertir en PNG avant benchmark.",
      };
    }
    const dataUrl = `data:${piece.mime};base64,${fileBuffer.toString("base64")}`;
    const userText = [`Pièce demandée : ${piece.label}`, buildContextText(piece)].filter(Boolean).join("\n\n");
    const body = {
      model: this.model,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: userText },
          ],
        },
      ],
    };

    const start = Date.now();
    try {
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
          "Accept": "application/json",
        },
        body: JSON.stringify(body),
      });
      const durationMs = Date.now() - start;
      if (!res.ok) {
        const txt = await res.text();
        return {
          parsed: null, raw_text: txt, input_tokens: 0, output_tokens: 0,
          cost_eur: 0, duration_ms: durationMs, model_id: this.model,
          error: `HTTP ${res.status}: ${txt.slice(0, 200)}`,
        };
      }
      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const raw = data.choices?.[0]?.message?.content ?? "";
      const parsed = extractFirstJson(raw);
      const inT = data.usage?.prompt_tokens ?? 0;
      const outT = data.usage?.completion_tokens ?? 0;
      const pricing = PRICING[this.model] ?? { input: 1, output: 3 };
      const eur = (inT * pricing.input + outT * pricing.output) / 1_000_000;
      return {
        parsed, raw_text: raw,
        input_tokens: inT, output_tokens: outT,
        cost_eur: eur, duration_ms: durationMs,
        model_id: this.model,
        error: parsed === null ? "JSON parse failed" : null,
      };
    } catch (err) {
      return {
        parsed: null, raw_text: "", input_tokens: 0, output_tokens: 0,
        cost_eur: 0, duration_ms: Date.now() - start, model_id: this.model,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
