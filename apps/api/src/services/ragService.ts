/**
 * Service RAG côté API.
 *
 *  - extractPdfPages : tire le texte d'un PDF base64 page par page via unpdf
 *    (pur Node, pas de poppler ni de canvas natif requis au runtime).
 *  - indexCommuneDocument : extrait + chunk + embed + upsert dans
 *    document_segments. Idempotent par source_id (le regulatory_documents.id).
 *  - searchInCommune : enrobage léger de searchSegments pour la commune
 *    courante.
 *
 * Le coût Mistral `mistral-embed` est négligeable : indexer un PLU de
 * 200 pages coûte ~0,005 € une fois. À comparer aux ~0,3 €/dossier qu'on
 * paierait à envoyer le PDF complet à chaque verdict.
 */
import { extractText as extractPdfText } from "unpdf";
import { indexDocument, searchSegments, deleteIndexFor, countSegmentsFor, type SearchHit, type IndexResult } from "@heureka-v1/ingestion/rag";
import { trackExternalMistralUsage, type CallAiContext } from "./aiUsage.js";

/**
 * Construit le callback `onUsage` consommé par embedTexts() pour tracer
 * chaque batch d'embeddings dans `ai_usage_events`. Le contexte (purpose,
 * dossierId, communeId) est fourni par l'appelant — sinon on tombe sur
 * un purpose générique pour ne pas perdre la trace côté facture estimée.
 */
function embedTracker(ctx?: Partial<CallAiContext> & { purpose?: string }) {
  return {
    onUsage: (u: { model: string; prompt_tokens: number; duration_ms: number }) => {
      trackExternalMistralUsage(
        {
          purpose: ctx?.purpose ?? "embedding",
          dossierId: ctx?.dossierId ?? null,
          communeId: ctx?.communeId ?? null,
          userId: ctx?.userId ?? null,
          fileHash: ctx?.fileHash ?? null,
        },
        u.model,
        u.prompt_tokens,
        0,
        u.duration_ms,
        "embedding",
      );
    },
  };
}

/** Extrait le texte d'un PDF base64 page par page. unpdf ne dépend que de Node. */
export async function extractPdfPages(base64: string): Promise<string[]> {
  const buf = Buffer.from(base64, "base64");
  const { text } = await extractPdfText(new Uint8Array(buf), { mergePages: false });
  if (Array.isArray(text)) return text;
  // Repli défensif : certaines versions de unpdf renvoient un seul string.
  return typeof text === "string" ? [text] : [];
}

export interface IndexCommuneDocumentParams {
  /** UUID du row regulatory_documents — utilisé comme source_id stable. */
  document_id: string;
  insee: string;
  commune_name: string;
  /** Ex: "PPRI", "OAP", "PEB"… */
  doc_type: string;
  /** Nom utilisateur (ex: "PPRI Vallée du Cher 2018"). */
  document_name: string;
  original_filename: string;
  pdf_base64: string;
  /** Optionnel : pour attribuer le coût embeddings à une commune dans ai_usage_events. */
  commune_id?: string | null;
  user_id?: string | null;
}

/**
 * Indexe un commune_document. Une seule entrée par chunk, idempotent : ré-
 * indexer le même document_id remplace les anciens segments. Loggue tout
 * (utile pour debug en prod).
 */
export async function indexCommuneDocument(
  p: IndexCommuneDocumentParams,
): Promise<IndexResult & { extracted_pages: number }> {
  const startedAt = Date.now();
  const pages = await extractPdfPages(p.pdf_base64);
  const result = await indexDocument({
    source_id: p.document_id,
    insee: p.insee,
    commune_name: p.commune_name,
    doc_type: p.doc_type.toUpperCase(),
    doc_source_file: p.original_filename,
    pages,
    extra_metadata: {
      document_name: p.document_name,
    },
    embed_options: embedTracker({
      purpose: `rag_index_${p.doc_type.toLowerCase()}`,
      communeId: p.commune_id ?? null,
      userId: p.user_id ?? null,
    }),
  });
  console.log(
    `[rag] indexé doc=${p.document_id} (${p.doc_type.toUpperCase()}) : ${pages.length} pages, ${result.chunks} chunks, ${Date.now() - startedAt} ms`,
  );
  return { ...result, extracted_pages: pages.length };
}

export interface SearchInCommuneParams {
  query: string;
  insee: string;
  doc_types?: string[];
  top_k?: number;
  /** Contexte de tracking. Sans, le coût d'embedding de la requête reste tracé en purpose=rag_search sans dossier/commune. */
  tracking?: {
    purpose?: string;
    dossierId?: string | null;
    communeId?: string | null;
    userId?: string | null;
  };
}

export async function searchInCommune(p: SearchInCommuneParams): Promise<SearchHit[]> {
  return searchSegments({
    query: p.query,
    insee: p.insee,
    doc_types: p.doc_types,
    top_k: p.top_k ?? 5,
    embed_options: embedTracker({
      purpose: p.tracking?.purpose ?? "rag_search",
      dossierId: p.tracking?.dossierId ?? null,
      communeId: p.tracking?.communeId ?? null,
      userId: p.tracking?.userId ?? null,
    }),
  });
}

export { deleteIndexFor, countSegmentsFor };
