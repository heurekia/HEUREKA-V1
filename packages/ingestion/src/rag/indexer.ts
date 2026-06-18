/**
 * Indexer générique pour documents réglementaires hétérogènes.
 *
 * Prend des pages de texte (déjà extraites du PDF par l'appelant) + des
 * métadonnées d'identité, chunk, embed et upsert dans `document_segments`.
 *
 * Idempotent : un même `source_id` réécrit ses segments en place. Re-indexer
 * un document est sûr (utilisé après mise à jour de la synthèse, changement
 * de version, etc.).
 */
import { db, document_segments } from "@heureka-v1/db";
import { sql, eq } from "drizzle-orm";
import { chunkPages, type ChunkOptions } from "./chunker.ts";
import { embedTexts } from "../db/embedder.ts";

export interface IndexParams {
  /**
   * Identifiant stable de la SOURCE (= un row regulatory_documents par exemple).
   * Sert à idempotenter : tous les chunks portent un id préfixé par ce
   * source_id, et on supprime d'abord tout ce qui était indexé sous ce
   * source_id avant de réinsérer.
   */
  source_id: string;
  insee: string;
  commune_name: string;
  /** Ex: "PPRI", "OAP", "PLU_REGLEMENT" — libre, sert au filtrage. */
  doc_type: string;
  /** Ex: "reglement_ppri" — libre, optionnel. */
  doc_subtype?: string;
  /** Ex: "M5_20180129" — libre, optionnel. */
  doc_version?: string;
  /** Nom du fichier source pour affichage côté UI. */
  doc_source_file: string;
  /** Pages déjà extraites (1 string par page PDF). */
  pages: string[];
  /** Métadonnées libres ajoutées à chaque segment (pour affichage / filtres). */
  extra_metadata?: Record<string, unknown>;
  chunk_options?: ChunkOptions;
}

export interface IndexResult {
  source_id: string;
  chunks: number;
  embedded: number;
  dropped_pages: number;
}

const SEGMENT_ID = (sourceId: string, chunkIndex: number) =>
  `${sourceId}_CHUNK_${chunkIndex.toString().padStart(4, "0")}`;

/**
 * Indexe un document complet. Effectue dans cet ordre :
 *  1. chunk_pages (pure)
 *  2. delete des anciens segments de ce source_id (idempotence)
 *  3. embed Mistral `mistral-embed` par lots
 *  4. upsert pgvector
 */
export async function indexDocument(p: IndexParams): Promise<IndexResult> {
  const chunks = chunkPages(p.pages, p.chunk_options);
  const droppedPages = p.pages.length - new Set(chunks.map((c) => c.page)).size;

  if (chunks.length === 0) {
    // Document vide après chunking (sommaire seul / pages blanches). On
    // efface tout résidu et on rend 0 — l'appelant décidera comment alerter.
    await deleteIndexFor(p.source_id);
    return { source_id: p.source_id, chunks: 0, embedded: 0, dropped_pages: droppedPages };
  }

  // Effacer les anciens segments AVANT d'embedder : si l'embedding échoue
  // on n'aura pas un état moitié-vieux moitié-neuf en base.
  await deleteIndexFor(p.source_id);

  // Embeddings par lots (le batcher interne de embedTexts gère MAX_BATCH=128).
  const embeddings = await embedTexts(chunks.map((c) => c.text));

  const rows = chunks.map((c, j) => ({
    id: SEGMENT_ID(p.source_id, c.index),
    insee: p.insee,
    commune_name: p.commune_name,
    doc_type: p.doc_type,
    doc_subtype: p.doc_subtype ?? null,
    doc_version: p.doc_version ?? null,
    doc_source_file: p.doc_source_file,
    segment_code: `CHUNK_${c.index.toString().padStart(4, "0")}`,
    segment_type: "chunk",
    parent_code: null,
    title: null,
    raw_text: c.text,
    embedding_text: c.text,
    embedding: embeddings[j] ?? null,
    metadata: {
      page: c.page,
      char_count: c.char_count,
      source_id: p.source_id,
      ...(p.extra_metadata ?? {}),
    },
    char_count: c.char_count,
    updated_at: new Date(),
  }));

  // Insert simple : on a déjà supprimé l'ancien index. Pas besoin de
  // ON CONFLICT, ce qui simplifie et évite des bugs sur les colonnes
  // par défaut.
  await db.insert(document_segments).values(rows);

  return {
    source_id: p.source_id,
    chunks: chunks.length,
    embedded: embeddings.length,
    dropped_pages: droppedPages,
  };
}

/** Supprime tous les segments indexés pour un source_id donné. */
export async function deleteIndexFor(sourceId: string): Promise<number> {
  const result = await db
    .delete(document_segments)
    .where(sql`${document_segments.metadata}->>'source_id' = ${sourceId}`)
    .returning({ id: document_segments.id });
  return result.length;
}

/** Renvoie le nombre de segments actuellement indexés pour un source_id. */
export async function countSegmentsFor(sourceId: string): Promise<number> {
  const result = await db
    .select({ id: document_segments.id })
    .from(document_segments)
    .where(sql`${document_segments.metadata}->>'source_id' = ${sourceId}`);
  return result.length;
}

// Re-export pour confort côté API : utiliser eq depuis ici si besoin.
export { eq };
