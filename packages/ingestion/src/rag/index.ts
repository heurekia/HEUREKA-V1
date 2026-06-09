/**
 * Barrel RAG — consommable depuis @heureka-v1/api via le subpath
 * "@heureka-v1/ingestion/rag".
 */
export { chunkPages, type Chunk, type ChunkOptions } from "./chunker.ts";
export { indexDocument, deleteIndexFor, countSegmentsFor, type IndexParams, type IndexResult } from "./indexer.ts";
export { searchSegments, formatHitForPrompt, type SearchParams, type SearchHit, type AnnotationHit } from "./search.ts";
