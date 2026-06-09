import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Annotations chunk-level sur les documents réglementaires indexés.
 *
 * Permet à un instructeur d'attacher une note précise à un passage du PDF
 * (correction d'erreur d'édition, jurisprudence locale, cas particulier) qui
 * sera REMONTÉE AVEC le chunk au moment de la recherche RAG. L'IA voit donc
 * le texte du PDF + l'annotation humaine validée, et peut intégrer la nuance
 * dans son verdict.
 *
 * Convention de validation_status alignée sur zone_regulatory_rules et
 * commune_documents : `brouillon | valide | rejete`. Une annotation
 * `brouillon` est INVISIBLE du search côté instruction — c'est le gate
 * juridique qui garantit qu'aucune note non-validée ne contamine un verdict.
 *
 * `applies_if` est réservé pour l'extension future (Phase 1.5 niveau C) :
 * tags de contexte parcellaire (ex: "surelevation", "cloture_sur_rue") qui
 * conditionneront l'activation de l'annotation. Vide pour l'instant = toujours
 * applicable.
 */
export const document_segment_annotations = pgTable(
  "document_segment_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** FK vers document_segments.id — cascade delete si le segment disparaît (re-indexation). */
    segment_id: text("segment_id").notNull(),
    /** Source du segment (= commune_documents.id). Permet de lister toutes les annotations d'un document sans jointure. */
    source_id: text("source_id").notNull(),
    /**
     * Catégorie d'annotation, sert à l'affichage différencié côté UI ET à
     * l'IA (qui reçoit "[CORRECTION INSTRUCTEUR]" vs "[PRÉCISION]") :
     *  - correction    : "le PDF dit X mais c'est Y" — niveau d'alerte fort
     *  - precision     : "cas particulier à connaître"
     *  - jurisprudence : "la commission a tranché ainsi" — précédent local
     *  - warning       : "attention spécifique"
     */
    kind: text("kind").notNull().default("precision"),
    note: text("note").notNull(),
    /** Tags conditionnels (Phase 1.5). Vide = toujours applicable. */
    applies_if: jsonb("applies_if").notNull().default([]),
    /** Gate juridique. Une annotation 'brouillon' est invisible du RAG. */
    validation_status: text("validation_status").notNull().default("brouillon"),
    author_user_id: uuid("author_user_id"),
    validated_by: uuid("validated_by"),
    validated_at: timestamp("validated_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    segmentIdx: index("idx_segment_annotations_segment").on(t.segment_id),
    sourceIdx: index("idx_segment_annotations_source").on(t.source_id),
  }),
);

export type AnnotationKind = "correction" | "precision" | "jurisprudence" | "warning";
export const ANNOTATION_KINDS: ReadonlyArray<AnnotationKind> = [
  "correction", "precision", "jurisprudence", "warning",
];
