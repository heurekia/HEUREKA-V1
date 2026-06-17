/**
 * Loader — upserts Segments into document_segments with their Mistral embedding.
 * Idempotent on `id` (re-running replaces a segment in place). pgvector + the
 * table must exist (run `pnpm --filter @heureka-v1/db migrate` first).
 */
import { db, document_segments } from "@heureka-v1/db";
import { sql } from "drizzle-orm";
import type { Segment } from "../adapters/interface.ts";
import { embedTexts } from "./embedder.ts";

export interface LoadResult {
  upserted: number;
}

export async function loadSegments(segments: Segment[], opts: { batchSize?: number } = {}): Promise<LoadResult> {
  const batchSize = opts.batchSize ?? 64;
  let upserted = 0;

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const embeddings = await embedTexts(batch.map((s) => s.embedding_text));

    const rows = batch.map((s, j) => ({
      id: s.id,
      insee: s.insee,
      commune_name: s.commune_name,
      doc_type: s.doc_type,
      doc_subtype: s.doc_subtype,
      doc_version: s.doc_version,
      doc_source_file: s.doc_source_file,
      segment_code: s.segment_code,
      segment_type: s.segment_type,
      parent_code: s.parent_code,
      title: s.title,
      raw_text: s.raw_text,
      embedding_text: s.embedding_text,
      embedding: embeddings[j] ?? null,
      metadata: s.metadata,
      char_count: s.char_count,
      updated_at: new Date(),
    }));

    await db
      .insert(document_segments)
      .values(rows)
      .onConflictDoUpdate({
        target: document_segments.id,
        set: {
          insee: sql`excluded.insee`,
          commune_name: sql`excluded.commune_name`,
          doc_type: sql`excluded.doc_type`,
          doc_subtype: sql`excluded.doc_subtype`,
          doc_version: sql`excluded.doc_version`,
          doc_source_file: sql`excluded.doc_source_file`,
          segment_code: sql`excluded.segment_code`,
          segment_type: sql`excluded.segment_type`,
          parent_code: sql`excluded.parent_code`,
          title: sql`excluded.title`,
          raw_text: sql`excluded.raw_text`,
          embedding_text: sql`excluded.embedding_text`,
          embedding: sql`excluded.embedding`,
          metadata: sql`excluded.metadata`,
          char_count: sql`excluded.char_count`,
          updated_at: sql`excluded.updated_at`,
        },
      });

    upserted += rows.length;
  }

  return { upserted };
}
