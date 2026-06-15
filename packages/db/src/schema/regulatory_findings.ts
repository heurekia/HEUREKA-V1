import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";
import { users } from "./users.js";
import { regulatory_analyses } from "./regulatory_analyses.js";
import { zone_regulatory_rules } from "./zone_regulatory_rules.js";

// Constat réglementaire unitaire produit par une analyse.
//
//   status   : 'conforme' | 'non_conforme' | 'incertain' | 'non_applicable'
//   severity : 'bloquant' | 'prescription' | 'alerte' | 'info'
//
// Règle d'or : un finding non-déterministe (issu uniquement du RAG ou d'une
// reformulation IA) ne doit jamais avoir status='non_conforme' tant qu'un
// instructeur ne l'a pas confirmé. Voir RagLegalAssistant.
//
// instructor_decision : 'accepted' | 'corrected' | 'ignored'. Sert d'audit
// trail et alimentera la boucle d'amélioration métier (palier 5).
export const regulatory_findings = pgTable("regulatory_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  analysis_id: uuid("analysis_id").notNull().references(() => regulatory_analyses.id, { onDelete: "cascade" }),
  dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  status: text("status").notNull(),
  severity: text("severity").notNull().default("info"),
  title: text("title").notNull(),
  explanation: text("explanation"),
  legal_basis: jsonb("legal_basis").notNull().default([]),
  source_refs: jsonb("source_refs").notNull().default([]),
  facts_used: jsonb("facts_used").notNull().default([]),
  missing_facts: jsonb("missing_facts").notNull().default([]),
  recommended_action: jsonb("recommended_action"),
  citizen_summary: text("citizen_summary"),
  rule_id: uuid("rule_id").references(() => zone_regulatory_rules.id, { onDelete: "set null" }),
  instructor_decision: text("instructor_decision"),
  instructor_comment: text("instructor_comment"),
  instructor_decided_by: uuid("instructor_decided_by").references(() => users.id, { onDelete: "set null" }),
  instructor_decided_at: timestamp("instructor_decided_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
