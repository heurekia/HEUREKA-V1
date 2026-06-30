import { pgTable, text, integer, timestamp, doublePrecision, uuid, jsonb, boolean } from "drizzle-orm/pg-core";
import { zones } from "./zones.js";
import { regulatory_documents } from "./regulatoryDocuments.js";
import { document_segments } from "./documentSegments.js";

export const zone_regulatory_rules = pgTable("zone_regulatory_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  zone_id: uuid("zone_id").notNull().references(() => zones.id, { onDelete: "cascade" }),
  // Document réglementaire d'origine (PLU communal, PLUi, PPRI…). Nullable :
  // permet aux règles saisies manuellement sans source documentaire d'exister,
  // et préserve la règle si son document est supprimé (ON DELETE SET NULL).
  source_document_id: uuid("source_document_id").references(() => regulatory_documents.id, { onDelete: "set null" }),
  // Provenance fine de la règle dans le document source — permet de retracer
  // le passage exact (et non plus seulement le document). Renseignés à
  // l'ingestion automatique (cf. structurer/rules-loader) ; NULL pour les
  // règles saisies manuellement.
  //   source_segment_id : FK vers le segment RAG (document_segments) d'origine
  //                       → donne accès au texte du passage + à la page.
  //   source_page       : n° de page (1-based) si connu à l'extraction.
  //   source_quote      : extrait verbatim de la règle (= rule_text fidèle),
  //                       citable tel quel dans l'instruction.
  // ON DELETE SET NULL : réindexer le RAG ne doit jamais casser une règle.
  source_segment_id: text("source_segment_id").references(() => document_segments.id, { onDelete: "set null" }),
  source_page: integer("source_page"),
  source_quote: text("source_quote"),
  // double precision (pas integer) : les PLU modernisés numérotent en
  // décimal (« 12.1 », « 12.2 »…). Une colonne integer faisait planter
  // l'ingestion sur ces articles (invalid input syntax for type integer).
  article_number: doublePrecision("article_number"),
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
  // Spécification hauteur structurée (niveau 2) : { egout, faitage, relative_to,
  // max_delta } en mètres. Porte deux plafonds distincts (égout/faîtage) et/ou
  // une contrainte relative, sans écraser value_max. null hors hauteur.
  height_spec: jsonb("height_spec"),
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
