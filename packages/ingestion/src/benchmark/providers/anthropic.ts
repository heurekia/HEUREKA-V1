/**
 * Provider Anthropic — soit API directe (US), soit via AWS Bedrock (UE).
 * Sélection par variable d'environnement AI_PROVIDER (cohérent avec
 * apps/api/src/services/aiUsage.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import type { BenchmarkProvider, PieceFixture, ProviderResponse } from "../types.js";
import { SYSTEM_ANALYZE, SYSTEM_EXTRACT, buildContextText, extractFirstJson } from "../prompts.js";

const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
};

const BEDROCK_MAP: Record<string, string> = {
  "claude-haiku-4-5-20251001": "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  "claude-sonnet-4-6": "eu.anthropic.claude-sonnet-4-6-v1:0",
};

const USD_TO_EUR = Number(process.env.AI_USD_TO_EUR ?? "0.93");

export class AnthropicProvider implements BenchmarkProvider {
  name: string;
  region: string;
  country: string;
  model: string;
  private client: Anthropic;
  private useBedrock: boolean;

  constructor(model: "claude-haiku-4-5-20251001" | "claude-sonnet-4-6") {
    this.model = model;
    this.useBedrock = (process.env.AI_PROVIDER ?? "").toLowerCase() === "bedrock";
    if (this.useBedrock) {
      const region = process.env.AWS_REGION ?? "eu-central-1";
      this.client = new AnthropicBedrock({ awsRegion: region }) as unknown as Anthropic;
      this.name = `Anthropic ${model} via Bedrock`;
      this.region = region;
      this.country = "🇪🇺 UE";
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY requis pour le benchmark Anthropic direct");
      this.client = new Anthropic({ apiKey });
      this.name = `Anthropic ${model} (API directe)`;
      this.region = "us-east";
      this.country = "🇺🇸 USA (DPA + SCC)";
    }
  }

  private resolvedModel(): string {
    return this.useBedrock ? BEDROCK_MAP[this.model] ?? this.model : this.model;
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
    const base64 = fileBuffer.toString("base64");
    const isPdf = piece.mime === "application/pdf";
    const docBlock = isPdf
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: piece.mime as "image/jpeg" | "image/png" | "image/webp", data: base64 } };

    const userText = [
      `Pièce demandée : ${piece.label}`,
      buildContextText(piece),
    ].filter(Boolean).join("\n\n");

    const start = Date.now();
    try {
      const msg = await this.client.messages.create({
        model: this.resolvedModel(),
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: [docBlock, { type: "text", text: userText }] }],
      });
      const durationMs = Date.now() - start;
      const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
      const parsed = extractFirstJson(raw);
      const pricing = ANTHROPIC_PRICING[this.model] ?? { input: 3.0, output: 15.0 };
      const inT = msg.usage?.input_tokens ?? 0;
      const outT = msg.usage?.output_tokens ?? 0;
      const usd = (inT * pricing.input + outT * pricing.output) / 1_000_000;
      return {
        parsed,
        raw_text: raw,
        input_tokens: inT,
        output_tokens: outT,
        cost_eur: usd * USD_TO_EUR,
        duration_ms: durationMs,
        model_id: this.resolvedModel(),
        error: parsed === null ? "JSON parse failed" : null,
      };
    } catch (err) {
      return {
        parsed: null,
        raw_text: "",
        input_tokens: 0,
        output_tokens: 0,
        cost_eur: 0,
        duration_ms: Date.now() - start,
        model_id: this.resolvedModel(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
