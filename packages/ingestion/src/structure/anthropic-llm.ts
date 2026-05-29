/**
 * Default LlmFn backed by Claude Haiku — fast/cheap, since each call only sees
 * one zone's (short) article text, never the whole PDF. Requires ANTHROPIC_API_KEY.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { LlmFn } from "./structurer.ts";

export function anthropicLlm(model = "claude-haiku-4-5-20251001"): LlmFn {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non configurée — requise pour la structuration des règles.");
  const client = new Anthropic({ apiKey, maxRetries: 3, timeout: 60_000 });

  return async (system, user) => {
    const msg = await client.messages.create({
      model,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
    });
    return msg.content[0]?.type === "text" ? msg.content[0].text : "[]";
  };
}
