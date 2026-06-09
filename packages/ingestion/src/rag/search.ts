/**
 * Search RAG sur document_segments via pgvector.
 *
 * Recherche cosine. Filtres usuels : commune (insee) et types de document.
 * Renvoie les top-k segments avec leur métadonnée (page, source_id) pour
 * que l'appelant produise une citation traçable type
 * "PPRI Vallée Cher, p. 23 : <extrait>".
 */
import { db, document_segments } from "@heureka-v1/db";
import { sql, eq, and, inArray } from "drizzle-orm";
import { embedTexts } from "../db/embedder.ts";

export interface SearchParams {
  query: string;
  insee: string;
  /** Filtre optionnel sur les types de document (PLU_REGLEMENT, PPRI…). */
  doc_types?: string[];
  /** Nombre de résultats à retourner. Défaut 5. */
  top_k?: number;
  /** Distance cosine maximale (1 - similarité). 0 = identique, 1 = orthogonal. */
  max_distance?: number;
}

export interface SearchHit {
  segment_id: string;
  doc_type: string;
  doc_source_file: string | null;
  doc_version: string | null;
  page: number | null;
  source_id: string | null;
  text: string;
  /** Distance cosine — plus c'est petit, plus c'est proche. */
  distance: number;
  /** Métadonnées additionnelles (depuis metadata jsonb). */
  metadata: Record<string, unknown>;
}

export async function searchSegments(p: SearchParams): Promise<SearchHit[]> {
  const topK = p.top_k ?? 5;

  // 1. Embedding de la requête (input_type "query" — important : Voyage-3
  // a deux espaces différents pour les documents et les requêtes).
  const [queryEmbedding] = await embedTexts([p.query], "query");
  if (!queryEmbedding) return [];

  // 2. Recherche cosine en SQL. L'opérateur <=> de pgvector renvoie la
  // distance cosine (0 = identique, 2 = opposé). On filtre par insee.
  const embeddingLiteral = `[${queryEmbedding.join(",")}]`;
  const conditions = [eq(document_segments.insee, p.insee)];
  if (p.doc_types && p.doc_types.length > 0) {
    conditions.push(inArray(document_segments.doc_type, p.doc_types));
  }

  const rows = await db
    .select({
      id: document_segments.id,
      doc_type: document_segments.doc_type,
      doc_source_file: document_segments.doc_source_file,
      doc_version: document_segments.doc_version,
      raw_text: document_segments.raw_text,
      metadata: document_segments.metadata,
      distance: sql<number>`${document_segments.embedding} <=> ${embeddingLiteral}::vector`,
    })
    .from(document_segments)
    .where(and(...conditions))
    .orderBy(sql`${document_segments.embedding} <=> ${embeddingLiteral}::vector`)
    .limit(topK);

  return rows
    .filter((r) => p.max_distance === undefined || r.distance <= p.max_distance)
    .map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        segment_id: r.id,
        doc_type: r.doc_type,
        doc_source_file: r.doc_source_file,
        doc_version: r.doc_version,
        page: typeof meta.page === "number" ? meta.page : null,
        source_id: typeof meta.source_id === "string" ? meta.source_id : null,
        text: r.raw_text,
        distance: r.distance,
        metadata: meta,
      };
    });
}
