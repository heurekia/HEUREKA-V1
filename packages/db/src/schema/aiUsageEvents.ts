import { pgTable, text, timestamp, uuid, integer, doublePrecision } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { dossiers } from "./dossiers.js";
import { communes } from "./communes.js";

// Trace fine de chaque appel LLM facturable : permet de calculer le coût IA
// par dossier, par commune, par modèle, par usage métier (analyse de pièce,
// extraction, verdicts règle-par-règle, ingestion PLU, structuration d'article…).
// Inséré par les wrappers `callAi()` / `streamAi()` dans apps/api/src/services/aiUsage.ts.
export const ai_usage_events = pgTable("ai_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossier_id: uuid("dossier_id").references(() => dossiers.id, { onDelete: "set null" }),
  commune_id: uuid("commune_id").references(() => communes.id, { onDelete: "set null" }),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  // Étiquette métier ("piece_analyze", "piece_extract", "rule_verdicts",
  // "procedure_explain", "plu_zone_detect", "plu_rule_extract",
  // "plu_article_structure", "plu_zone_structure"…).
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  input_tokens: integer("input_tokens").notNull().default(0),
  output_tokens: integer("output_tokens").notNull().default(0),
  cache_read_input_tokens: integer("cache_read_input_tokens").notNull().default(0),
  cache_creation_input_tokens: integer("cache_creation_input_tokens").notNull().default(0),
  cost_eur: doublePrecision("cost_eur").notNull().default(0),
  duration_ms: integer("duration_ms"),
  // RGPD : SHA-256 du fichier soumis à l'IA (NULL pour les appels sans
  // contenu utilisateur). Permet l'audit "tel fichier a-t-il été envoyé ?"
  // sans dupliquer le contenu personnel.
  file_hash: text("file_hash"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});
