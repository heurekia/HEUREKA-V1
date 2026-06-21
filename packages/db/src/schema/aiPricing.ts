import { pgTable, text, timestamp, uuid, doublePrecision } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// Grille tarifaire IA — éditable depuis l'onglet "Coûts IA" du back-office.
// Source de vérité pour `computeCostEur()` côté apps/api/src/services/aiUsage.ts :
// quand Mistral publie un nouveau tarif (cf. https://mistral.ai/pricing/), un
// admin met à jour la ligne ici, le coût estimé des nouveaux appels s'aligne
// immédiatement (les anciens événements gardent leur cost_eur historique).
//
// `kind` distingue chat completions (input + output facturés) des embeddings
// (un seul tarif input). `output_eur_per_m` est ignoré pour `kind = 'embedding'`.
export const ai_pricing = pgTable("ai_pricing", {
  model: text("model").primaryKey(),
  kind: text("kind").notNull().default("chat"),
  input_eur_per_m: doublePrecision("input_eur_per_m").notNull(),
  output_eur_per_m: doublePrecision("output_eur_per_m").notNull().default(0),
  note: text("note"),
  updated_by: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
