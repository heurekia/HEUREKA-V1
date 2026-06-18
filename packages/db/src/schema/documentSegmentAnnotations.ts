import { pgTable, text, timestamp, uuid, jsonb, integer, index } from "drizzle-orm/pg-core";

/**
 * Annotations sur les documents réglementaires indexés.
 *
 * Deux modes d'attachement, non-exclusifs :
 *
 *  - **Chunk-level (historique)** : `segment_id` pointe vers un chunk RAG.
 *    Utilisé par les anciens flux. L'IA reçoit l'annotation à côté du
 *    chunk au moment du search.
 *  - **PDF-level (3.C.3)** : `segment_id` est null, `source_id` (= document)
 *    + `page` + `quote` + `highlight_rects` portent la position visuelle
 *    de la surlignée dans le PDF. Le RAG matche par chevauchement texte
 *    au moment du search pour associer à un chunk.
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
    /** Nullable depuis 3.C.3 : les annotations PDF-level sont attachées au
     *  document entier + page, pas à un chunk RAG précis. */
    segment_id: text("segment_id"),
    /** Source du segment (= regulatory_documents.id). Permet de lister toutes les annotations d'un document sans jointure.
     *  Pour les annotations PDF-level, c'est le seul lien vers le document. */
    source_id: text("source_id").notNull(),
    /** Page du PDF où vit la surlignée (PDF-level uniquement). */
    page: integer("page"),
    /** Texte cité (PDF-level). Sert au RAG pour retrouver le chunk associé
     *  et aux fallbacks visuels si les coordonnées deviennent invalides
     *  (PDF réuploadé / réindexé). */
    quote: text("quote"),
    /** Rectangles de surlignage dans le PDF (PDF-level). Format :
     *  `[{page, x, y, w, h, color?}]` avec coordonnées en pourcentage de
     *  la page (0-100) pour rester robuste au zoom. */
    highlight_rects: jsonb("highlight_rects").notNull().default([]),
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

/** Rectangle de surlignage dans le PDF — coordonnées en pourcentage de la
 *  page pour rester robuste au zoom et au redimensionnement du viewer. */
export interface HighlightRect {
  page: number;
  x: number;       // 0-100 (%)
  y: number;       // 0-100 (%)
  width: number;   // 0-100 (%)
  height: number;  // 0-100 (%)
}
