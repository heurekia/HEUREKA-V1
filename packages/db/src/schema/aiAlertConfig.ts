import { pgTable, integer, text, timestamp, doublePrecision } from "drizzle-orm/pg-core";

// Configuration singleton des alertes Slack sur les coûts IA.
// Une seule ligne (id = 1) — on n'utilise pas de PK uuid pour pouvoir s'assurer
// avec un CHECK qu'il n'y en aura qu'une.
export const ai_alert_config = pgTable("ai_alert_config", {
  id: integer("id").primaryKey().default(1),
  slack_webhook_url: text("slack_webhook_url"),
  // Seuil en euros sur le coût d'UN appel : si dépassé, ping immédiat.
  // null = désactivé.
  per_call_threshold_eur: doublePrecision("per_call_threshold_eur"),
  // Seuil en euros sur le cumul du jour (00h00 local) : ping une fois quand
  // dépassé, puis on attend le lendemain. null = désactivé.
  daily_threshold_eur: doublePrecision("daily_threshold_eur"),
  // Date du dernier ping journalier (pour éviter de re-ping toutes les 30 s).
  daily_last_notified_at: timestamp("daily_last_notified_at"),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
