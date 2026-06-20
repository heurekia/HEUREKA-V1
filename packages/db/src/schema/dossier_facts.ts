import { pgTable, text, timestamp, doublePrecision, jsonb, boolean, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";
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
// Cycle de vie :
//   - superseded_at : marque l'éviction historique (correction instructeur,
//     ré-extraction). Une ligne superseded reste lisible pour l'audit, mais
//     n'entre plus dans aucun calcul.
//   - is_winner     : (Phase 1) parmi les candidats encore actifs pour une
//     même (dossier_id, key), un seul porte is_winner=true. Les non-gagnants
//     sont conservés pour permettre au moteur de contradictions (Phase 3) de
//     reconstruire les divergences sans relancer l'extraction.
//   - conflict_group_id : (Phase 1) renseigné quand ≥ 2 candidats actifs ont
//     des valeurs DISTINCTES après normalisation. Tous les candidats du même
//     conflit partagent le même UUID — sert d'index naturel pour l'UI
//     "divergences".
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
    // Phase 1 — gestion explicite des candidats.
    is_winner: boolean("is_winner").notNull().default(true),
    conflict_group_id: uuid("conflict_group_id"),
    // Valeur lue avant normalisation (ex: « Haute Landes » brut). null si pas
    // de normalisation appliquée. `value` peut alors être identique à
    // `raw_value` ou refléter la suggestion normalisée acceptée.
    raw_value: jsonb("raw_value"),
    // Valeur normalisée suggérée par une source externe (BAN/cadastre/GPU).
    // L'instructeur arbitre : accepter (devient `value`) ou conserver `raw_value`.
    normalized_value: jsonb("normalized_value"),
    // Méthode utilisée : "ban", "cadastre", "manual", null si non concerné.
    normalization_method: text("normalization_method"),
    validated_by: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
    validated_at: timestamp("validated_at"),
    superseded_at: timestamp("superseded_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Un seul fait GAGNANT actif par (dossier, clé). Les autres candidats
    // (is_winner=false) cohabitent et alimentent le moteur de contradictions.
    activeWinnerKey: uniqueIndex("uniq_dossier_facts_active_winner_key")
      .on(t.dossier_id, t.key)
      .where(sql`${t.superseded_at} IS NULL AND ${t.is_winner} = true`),
    conflictGroup: index("idx_dossier_facts_conflict_group")
      .on(t.conflict_group_id)
      .where(sql`${t.conflict_group_id} IS NOT NULL`),
  }),
);
