import { pgTable, text, timestamp, integer, doublePrecision, uuid, jsonb, boolean } from "drizzle-orm/pg-core";
import { zones } from "./zones.js";

export const zone_regulatory_rules = pgTable("zone_regulatory_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  zone_id: uuid("zone_id").notNull().references(() => zones.id, { onDelete: "cascade" }),
  article_number: integer("article_number"),
  article_title: text("article_title"),
  topic: text("topic").notNull().default("general"),
  rule_text: text("rule_text").notNull(),
  conditions: text("conditions"),
  exceptions: text("exceptions"),
  summary: text("summary"),
  value_min: doublePrecision("value_min"),
  value_max: doublePrecision("value_max"),
  value_exact: doublePrecision("value_exact"),
  unit: text("unit"),
  // Cas conditionnels structurés : [{ condition, value, unit }]
  // ex: 10 m si voie à sens unique / 13 m si double sens.
  cases: jsonb("cases").default([]),
  // Tags d'applicabilité (ex: ["protege_l151_19","unesco","cloture_sur_rue"]) —
  // permettent de filtrer les (sous-)règles selon le contexte de la parcelle.
  applies_if: jsonb("applies_if").default([]),
  // Sous-thème pour les articles décomposés (ex: "Toitures", "Clôtures sur rue").
  sub_theme: text("sub_theme"),
  // Version « citoyen » générée à l'ingestion par l'IA : titre court + une phrase
  // simple en langage courant. citizen_relevant = false pour les dispositions
  // purement administratives/procédurales sans intérêt pour un particulier.
  citizen_title: text("citizen_title"),
  citizen_summary: text("citizen_summary"),
  citizen_relevant: boolean("citizen_relevant").notNull().default(true),
  instructor_note: text("instructor_note"),
  // Convention applicative : "valide" | "brouillon" | "rejete". Une règle
  // n'est consommée par le moteur d'instruction que si statut = "valide".
  // Default "brouillon" → safe-by-default : tout insert qui oublierait de
  // poser le statut atterrit en non-validé, jamais en production.
  validation_status: text("validation_status").notNull().default("brouillon"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
