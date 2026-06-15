import { pgTable, text, timestamp, doublePrecision, jsonb, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { dossiers } from "./dossiers.js";
import { users } from "./users.js";

// Faits d'instruction : source unique de vérité, par dossier, des données
// utilisées par le moteur réglementaire. Quatre origines distinctes — la
// confiance et la traçabilité dépendent de l'origine.
//
//   - citizen_declaration : déclaration du citoyen dans le CERFA
//   - document_extraction : extraction IA d'une pièce jointe
//   - instructor_entry    : saisie ou correction humaine d'un instructeur
//   - external_data       : cadastre, GPU, IGN, etc.
//
// Un fait est "actif" tant que superseded_at IS NULL. Une correction
// instructeur n'écrase pas l'historique : elle marque superseded_at sur le
// fait précédent et insère un nouveau fait actif.
export const dossier_facts = pgTable(
  "dossier_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    unit: text("unit"),
    source: text("source").notNull(),
    source_ref: jsonb("source_ref"),
    confidence: doublePrecision("confidence"),
    validated_by: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
    validated_at: timestamp("validated_at"),
    superseded_at: timestamp("superseded_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Un seul fait actif par (dossier, clé). Garantie applicative + base.
    activeKey: uniqueIndex("uniq_dossier_facts_active_key")
      .on(t.dossier_id, t.key)
      .where(sql`${t.superseded_at} IS NULL`),
  }),
);
