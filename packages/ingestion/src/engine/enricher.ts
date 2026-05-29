/**
 * Enricher — fills per-segment enrichments using the adapter:
 *  - secteur overrides / exceptions found inline,
 *  - cross-references to other articles/schemas/docs,
 *  - embedding_text (context-prefixed text optimised for retrieval),
 *  - metadata (secteurs touched, counts).
 */
import type { DocumentAdapter, Segment } from "../adapters/interface.ts";

export function enrich(segments: Segment[], adapter: DocumentAdapter): Segment[] {
  return segments.map((seg) => {
    const overrides = adapter.detectOverrides?.(seg.raw_text) ?? [];
    const cross_refs = adapter.detectCrossRefs?.(seg.raw_text) ?? [];

    // Context prefix helps semantic retrieval ("UA article 7 implantation …").
    const context = `[${seg.commune_name} · ${seg.doc_subtype} · ${seg.segment_code}]`;
    const embedding_text = `${context} ${seg.title}\n${seg.raw_text}`.trim();

    const secteurs = [...new Set(overrides.flatMap((o) => o.scope))];

    return {
      ...seg,
      overrides,
      cross_refs,
      embedding_text,
      metadata: {
        ...seg.metadata,
        secteurs,
        n_subsections: seg.subsections.length,
        n_overrides: overrides.length,
        n_cross_refs: cross_refs.length,
      },
    };
  });
}
