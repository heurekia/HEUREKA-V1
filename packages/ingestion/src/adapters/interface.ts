/**
 * HEUREKA ingestion — core contracts.
 *
 * The engine is municipality-agnostic. Each document *type* implements a
 * DocumentAdapter that defines HOW to split and label the text; the engine
 * (cleaner → segmenter → enricher → validator → output) never changes.
 */

// ── Enums (as string unions) ──────────────────────────────────────────────────

export type DocType =
  | "PLU_REGLEMENT" // règlement littéral — first adapter
  | "PLU_OAP" // orientations d'aménagement et de programmation
  | "PLU_ANNEXE_GRAPHIQUE" // documents graphiques (zoning maps)
  | "PPRI" // plan de prévention risques inondation
  | "PEB" // plan d'exposition au bruit
  | "PSMV" // plan de sauvegarde et mise en valeur
  | "SCOT" // schéma de cohérence territoriale
  | "CERFA_DAU" // dossier DAU (permis, déclarations)
  | "ARRETE_MUNICIPAL"; // arrêtés

export type SegmentType =
  | "zone" // PLU zone (UA, UC...)
  | "article" // numbered article within a zone
  | "subsection" // numbered sub-article (7.1, 7.2.1...)
  | "oap_sector" // OAP perimeter sector
  | "risk_layer" // PPRI/PEB zone
  | "annexe" // annexe block
  | "intro"; // introduction / caractère / préambule

// ── Adapter detection outputs ─────────────────────────────────────────────────

export interface SegmentBoundary {
  code: string; // "UA"
  title: string; // human-readable title for the segment
  start_line: number; // index into the cleaned `lines` array
}

export interface SubsectionBoundary {
  parent_code: string; // zone the article belongs to, e.g. "UA"
  code: string; // "UA_ART_7"
  number: string; // "7" or "7.2.1"
  title: string;
  start_line: number;
}

export interface Override {
  scope: string[]; // secteurs the override applies to, e.g. ["UAa", "UAb"]
  kind: "secteur" | "exception"; // included sector(s) vs an exclusion
  raw: string; // the sentence that triggered the override
}

export interface CrossRef {
  kind: "article" | "schema" | "annexe" | "code_urbanisme" | "document";
  ref: string; // "UA-7.2", "3", "L.151-19", "PPRI"…
  raw: string; // the matched substring
}

export interface Subsection {
  code: string; // "UA_ART_7_2"
  number: string; // "7.2"
  title: string;
  raw_text: string;
}

// ── Universal output unit ─────────────────────────────────────────────────────

export interface Segment {
  // Identity
  id: string; // "{insee}_{doc_type}_{segment_code}"
  insee: string;
  commune_name: string;

  // Document provenance
  doc_type: DocType;
  doc_subtype: string;
  doc_version: string; // "M1_20220627" — from filename or metadata
  doc_source_file: string;

  // Segment location
  segment_code: string; // "UA", "UA_ART_7"
  segment_type: SegmentType;
  parent_code: string | null;

  // Content
  title: string;
  raw_text: string;
  char_count: number;

  // Enrichments
  subsections: Subsection[];
  overrides: Override[];
  cross_refs: CrossRef[];

  // pgvector seed fields
  embedding_text: string;
  metadata: Record<string, unknown>;
}

// ── Validation ────────────────────────────────────────────────────────────────

export type ValidationRule =
  | { type: "zone_count"; expected: number | null }
  | { type: "article_count_per_zone"; expected: number }
  | { type: "no_empty_segments"; fields: Array<keyof Segment> }
  | { type: "known_zone_codes"; pattern: RegExp };

export interface ValidationIssue {
  rule: ValidationRule["type"];
  severity: "error" | "warning";
  message: string;
  segment_id?: string;
}

// ── Adapter contract ──────────────────────────────────────────────────────────

export interface DocumentAdapter {
  doc_type: DocType;
  doc_subtype: string;

  /** Lines/patterns to drop before segmentation. */
  noise_patterns: RegExp[];

  /** Top-level segment boundaries (e.g. PLU zones). */
  detectSegments(lines: string[]): SegmentBoundary[];

  /** Sub-segments within a segment (e.g. articles). */
  detectSubsections(lines: string[]): SubsectionBoundary[];

  /** Inline secteur-specific overrides / exceptions. */
  detectOverrides?(text: string): Override[];

  /** Cross-references to other articles/schemas/docs. */
  detectCrossRefs?(text: string): CrossRef[];

  /** Assertions run after parsing. */
  validationRules: ValidationRule[];
}
