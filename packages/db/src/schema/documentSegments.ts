import { pgTable, text, integer, jsonb, timestamp, vector, index } from "drizzle-orm/pg-core";

// Segments réglementaires issus du moteur d'ingestion (@heureka-v1/ingestion).
// Une ligne = un Segment (zone ou article). `id` = "{insee}_{doc}_{code}" → upsert
// idempotent. `embedding` = vecteur voyage-3 (1024 dims) pour la recherche pgvector.
export const document_segments = pgTable(
  "document_segments",
  {
    id: text("id").primaryKey(),
    insee: text("insee").notNull(),
    commune_name: text("commune_name"),
    doc_type: text("doc_type").notNull(),
    doc_subtype: text("doc_subtype"),
    doc_version: text("doc_version"),
    doc_source_file: text("doc_source_file"),
    segment_code: text("segment_code").notNull(),
    segment_type: text("segment_type").notNull(),
    parent_code: text("parent_code"),
    title: text("title"),
    raw_text: text("raw_text").notNull(),
    embedding_text: text("embedding_text").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    metadata: jsonb("metadata").default({}),
    char_count: integer("char_count"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    inseeIdx: index("idx_document_segments_insee").on(t.insee),
    docTypeIdx: index("idx_document_segments_doc_type").on(t.doc_type),
    parentIdx: index("idx_document_segments_parent").on(t.parent_code),
  }),
);
