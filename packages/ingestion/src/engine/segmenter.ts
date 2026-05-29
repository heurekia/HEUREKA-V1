/**
 * Segmenter — turns cleaned lines into Segments using an adapter's boundary
 * detection. Produces one Segment per zone AND one per article (the article is
 * the primary embedding unit; the zone provides context). Pure / testable.
 */
import type { DocumentAdapter, Segment, Subsection } from "../adapters/interface.ts";

export interface SegmentContext {
  insee: string;
  commune_name: string;
  doc_version: string;
  doc_source_file: string;
}

const DOC_CODE: Record<string, string> = {
  PLU_REGLEMENT: "PLU_REG",
  PLU_OAP: "PLU_OAP",
  PLU_ANNEXE_GRAPHIQUE: "PLU_GRA",
  PPRI: "PPRI",
  PEB: "PEB",
  PSMV: "PSMV",
  SCOT: "SCOT",
  CERFA_DAU: "DAU",
  ARRETE_MUNICIPAL: "ARR",
};

export function segment(lines: string[], adapter: DocumentAdapter, ctx: SegmentContext): Segment[] {
  const docCode = DOC_CODE[adapter.doc_type] ?? adapter.doc_type;
  const baseId = (code: string) => `${ctx.insee}_${docCode}_${code}`;

  const zones = [...adapter.detectSegments(lines)].sort((a, b) => a.start_line - b.start_line);
  const articles = [...adapter.detectSubsections(lines)].sort((a, b) => a.start_line - b.start_line);

  const mkSegment = (
    code: string,
    type: Segment["segment_type"],
    parent_code: string | null,
    title: string,
    raw_text: string,
    subsections: Subsection[],
  ): Segment => ({
    id: baseId(code),
    insee: ctx.insee,
    commune_name: ctx.commune_name,
    doc_type: adapter.doc_type,
    doc_subtype: adapter.doc_subtype,
    doc_version: ctx.doc_version,
    doc_source_file: ctx.doc_source_file,
    segment_code: code,
    segment_type: type,
    parent_code,
    title,
    raw_text,
    char_count: raw_text.length,
    subsections,
    overrides: [],
    cross_refs: [],
    embedding_text: raw_text,
    metadata: {},
  });

  const segments: Segment[] = [];

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i]!;
    const zoneEnd = zones[i + 1]?.start_line ?? lines.length;
    const zoneText = lines.slice(zone.start_line, zoneEnd).join("\n").trim();

    const zoneArticles = articles.filter((a) => a.start_line >= zone.start_line && a.start_line < zoneEnd);

    const subsections: Subsection[] = [];
    for (let j = 0; j < zoneArticles.length; j++) {
      const art = zoneArticles[j]!;
      const artEnd = zoneArticles[j + 1]?.start_line ?? zoneEnd;
      const artText = lines.slice(art.start_line, artEnd).join("\n").trim();

      subsections.push({ code: art.code, number: art.number, title: art.title, raw_text: artText });
      segments.push(mkSegment(art.code, "article", zone.code, art.title, artText, []));
    }

    segments.push(mkSegment(zone.code, "zone", null, zone.title, zoneText, subsections));
  }

  return segments;
}
