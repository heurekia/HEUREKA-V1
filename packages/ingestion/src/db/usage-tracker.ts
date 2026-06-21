/**
 * Tracking pour les appels Mistral effectués depuis le CLI d'ingestion.
 * Insère dans `ai_usage_events` avec le coût estimé à partir de la table
 * `ai_pricing` (même source de vérité que côté apps/api).
 *
 * Pourquoi pas réutiliser apps/api/src/services/aiUsage.ts ? Parce que
 * packages/ingestion est indépendant : il ne doit pas dépendre d'apps/api.
 * On lit donc directement `ai_pricing` ici. Cohérent par construction
 * avec l'estimation côté API (même formule, même tarif).
 */
import { db, ai_usage_events, ai_pricing } from "@heureka-v1/db";
import { eq } from "drizzle-orm";

export interface IngestionUsageEvent {
  purpose: string;
  model: string;
  endpoint: "chat" | "embedding";
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
}

async function lookupPricing(model: string): Promise<{ input: number; output: number }> {
  try {
    const [row] = await db
      .select({ input: ai_pricing.input_eur_per_m, output: ai_pricing.output_eur_per_m })
      .from(ai_pricing)
      .where(eq(ai_pricing.model, model))
      .limit(1);
    if (row) return { input: Number(row.input), output: Number(row.output) };
  } catch {
    /* fallback ci-dessous */
  }
  return { input: 0, output: 0 };
}

export function trackIngestionUsage(ev: IngestionUsageEvent): void {
  void (async () => {
    const { input, output } = await lookupPricing(ev.model);
    const cost = (ev.input_tokens * input + ev.output_tokens * output) / 1_000_000;
    try {
      await db.insert(ai_usage_events).values({
        purpose: ev.purpose,
        model: ev.model,
        input_tokens: ev.input_tokens,
        output_tokens: ev.output_tokens,
        cost_eur: Math.round(cost * 1_000_000) / 1_000_000,
        input_rate_eur_per_m: input,
        output_rate_eur_per_m: output,
        endpoint: ev.endpoint,
        duration_ms: ev.duration_ms,
      });
    } catch (err) {
      console.warn("[ingestion-tracker] insert échoué :", err instanceof Error ? err.message : err);
    }
  })();
}
