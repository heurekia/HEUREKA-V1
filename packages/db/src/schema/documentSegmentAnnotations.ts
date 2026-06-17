import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Annotations chunk-level sur les documents réglementaires indexés.
 *
 * Permet à un instructeur d'attacher une note précise à un passage du PDF
 * (correction d'erreur d'édition, jurisprudence locale, cas particulier,
 * ou simple note de travail personnelle).
 *
 * Deux gates contrôlent ce qui remonte à l'IA :
 *
 *  1. `visibility` — *contrôle utilisateur*. `private` (défaut) = note de
 *     travail personnelle, jamais envoyée au LLM. `shared` = l'instructeur
 *     accepte que sa note alimente les instructions futures.
 *  2. `validation_status` — *gate juridique*. Une annotation `shared` reste
 *     invisible du RAG tant qu'elle n'est pas explicitement validée.
 *
 * Une annotation est injectée à côté du chunk dans le prompt LLM
 * UNIQUEMENT si `visibility = 'shared'` ET `validation_status = 'valide'`.
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
     *  - note_perso    : note de travail personnelle (par convention liée à
     *    visibility=private, mais l'instructeur peut basculer la visibilité
     *    à tout moment s'il souhaite finalement partager sa note)
     */
    kind: text("kind").notNull().default("note_perso"),
    note: text("note").notNull(),
    /** Tags conditionnels (Phase 1.5). Vide = toujours applicable. */
    applies_if: jsonb("applies_if").notNull().default([]),
    /**
     * Visibilité de l'annotation :
     *  - private (défaut) : note de travail, invisible du LLM et des autres instructeurs
     *  - shared           : alimente l'IA si validation_status = 'valide'
     */
    visibility: text("visibility").notNull().default("private"),
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

export type AnnotationKind = "correction" | "precision" | "jurisprudence" | "warning" | "note_perso";
export const ANNOTATION_KINDS: ReadonlyArray<AnnotationKind> = [
  "correction", "precision", "jurisprudence", "warning", "note_perso",
];

export type AnnotationVisibility = "private" | "shared";
export const ANNOTATION_VISIBILITIES: ReadonlyArray<AnnotationVisibility> = ["private", "shared"];
