/**
 * Search RAG sur document_segments via pgvector.
 *
 * Recherche cosine. Filtres usuels : commune (insee) et types de document.
 * Renvoie les top-k segments avec leur métadonnée (page, source_id) pour
 * que l'appelant produise une citation traçable type
 * "PPRI Vallée Cher, p. 23 : <extrait>".
 */
import { db, document_segments, document_segment_annotations } from "@heureka-v1/db";
import { sql, eq, and, inArray } from "drizzle-orm";
import { embedTexts, type EmbedOptions } from "../db/embedder.ts";

export interface SearchParams {
  query: string;
  insee: string;
  /** Filtre optionnel sur les types de document (PLU_REGLEMENT, PPRI…). */
  doc_types?: string[];
  /** Nombre de résultats à retourner. Défaut 5. */
  top_k?: number;
  /** Distance cosine maximale (1 - similarité). 0 = identique, 1 = orthogonal. */
  max_distance?: number;
  /** Callback injecté par l'appelant pour tracer l'embedding de la requête. */
  embed_options?: EmbedOptions;
}

export interface AnnotationHit {
  id: string;
  kind: string;
  note: string;
  applies_if: string[];
  validated_at: Date | null;
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
  /** Annotations VALIDÉES attachées à ce chunk — à injecter à côté du texte
   * dans le prompt LLM pour que l'IA voie les nuances métier. */
  annotations: AnnotationHit[];
}

export async function searchSegments(p: SearchParams): Promise<SearchHit[]> {
  const topK = p.top_k ?? 5;

  // 1. Embedding de la requête. Mistral n'a qu'un seul espace (pas de
  // dual-space document/query comme Voyage), même fonction des deux côtés.
  const [queryEmbedding] = await embedTexts([p.query], p.embed_options);
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

  const filtered = rows.filter((r) => p.max_distance === undefined || r.distance <= p.max_distance);

  // 3. Récupération des annotations pour les chunks retenus, en un seul
  // SELECT. Deux gates cumulatifs côté DB :
  //   - validation_status = 'valide'  → gate juridique (relue par un humain)
  //   - visibility = 'shared'         → consentement explicite de l'auteur
  //                                     à alimenter l'IA (vs note de travail)
  // Les `note_perso` privées ne contaminent jamais un verdict.
  const segmentIds = filtered.map((r) => r.id);
  const annotationsBySegment = new Map<string, AnnotationHit[]>();
  if (segmentIds.length > 0) {
    const annRows = await db
      .select({
        id: document_segment_annotations.id,
        segment_id: document_segment_annotations.segment_id,
        kind: document_segment_annotations.kind,
        note: document_segment_annotations.note,
        applies_if: document_segment_annotations.applies_if,
        validated_at: document_segment_annotations.validated_at,
      })
      .from(document_segment_annotations)
      .where(and(
        inArray(document_segment_annotations.segment_id, segmentIds),
        eq(document_segment_annotations.validation_status, "valide"),
        eq(document_segment_annotations.visibility, "shared"),
      ));
    for (const a of annRows) {
      // 3.C.3 : les annotations PDF-level (segment_id null) ne sont pas
      // routées au LLM via ce path — un matching texte/page sera ajouté
      // plus tard pour les retrouver à côté du bon chunk. Le filtre
      // inArray ci-dessus exclut déjà ces lignes côté SQL ; ce guard sert
      // de garde-fou côté TS et reflète l'intention.
      if (!a.segment_id) continue;
      const arr = annotationsBySegment.get(a.segment_id) ?? [];
      arr.push({
        id: a.id,
        kind: a.kind,
        note: a.note,
        applies_if: Array.isArray(a.applies_if) ? (a.applies_if as string[]) : [],
        validated_at: a.validated_at,
      });
      annotationsBySegment.set(a.segment_id, arr);
    }
  }

  return filtered.map((r) => {
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
      annotations: annotationsBySegment.get(r.id) ?? [],
    };
  });
}

/**
 * Formate un SearchHit en bloc texte prêt à injecter dans un prompt LLM.
 * L'IA voit le passage du PDF + les annotations humaines validées clairement
 * étiquetées. C'est ce qui rend l'audit juridique possible : on peut citer
 * à la fois la source officielle et la nuance ajoutée par l'instructeur.
 */
export function formatHitForPrompt(hit: SearchHit): string {
  const header = `[${hit.doc_type}${hit.page != null ? `, p. ${hit.page}` : ""}${hit.doc_source_file ? ` — ${hit.doc_source_file}` : ""}]`;
  let out = `${header}\n${hit.text}`;
  for (const a of hit.annotations) {
    const tag = a.kind.toUpperCase();
    out += `\n\n⚠ ${tag} — note instructeur validée${a.validated_at ? ` le ${a.validated_at.toISOString().slice(0, 10)}` : ""} :\n${a.note}`;
  }
  return out;
}
