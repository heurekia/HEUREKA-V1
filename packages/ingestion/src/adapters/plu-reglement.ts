/**
 * Adapter 1 — PLU_REGLEMENT (règlement littéral).
 *
 * Municipality-agnostic: French PLU règlements follow the same national
 * structure (Code de l'Urbanisme R.151-x), so the boundary wording
 * ("DISPOSITIONS APPLICABLES À LA ZONE …") and the 14-article layout match any
 * commune. Per-commune quirks, if any, go in a `adapters/<insee>/` override.
 */
import type {
  DocumentAdapter,
  SegmentBoundary,
  SubsectionBoundary,
  Override,
  CrossRef,
} from "./interface.ts";
import { findMatches, extractSecteurOverrides, extractCrossRefs } from "../engine/matchers.ts";

// Zone codes: U, UA, UCa, 1AU, 2AUz, A, Ah, N, Ni… (optional leading digit,
// 1-3 uppercase letters, optional lowercase/digit suffix).
const ZONE_CODE = "[0-9]?[A-Z]{1,3}[a-z0-9]*";

const ZONE_RE = new RegExp(`^DISPOSITIONS APPLICABLES [AÀ] LA ZONE (${ZONE_CODE})\\s*$`);
// "UA-ARTICLE 7 : Implantation…" and "UM ARTICLE 12 - …" (space + dash variants)
const ARTICLE_RE = new RegExp(
  `^(${ZONE_CODE})\\s*[-\\s]\\s*ARTICLE\\s+(\\d+)\\s*(?:[:\\-–]\\s*(.+))?$`,
);

export const PLUReglementAdapter: DocumentAdapter = {
  doc_type: "PLU_REGLEMENT",
  doc_subtype: "reglement_litteral",

  noise_patterns: [
    /^PLU\b.*$/i,
    /^VILLE DE .+$/i,
    /^COMMUNE DE .+$/i,
    /^\d{1,4}$/, // bare page numbers
    /^R[ÉÈE]GLEMENT$/i,
    /^ZONE [0-9]?[A-Z]+[a-z]?$/, // running header "ZONE UA"
    /^page \d+(\s*\/\s*\d+)?$/i,
  ],

  detectSegments(lines: string[]): SegmentBoundary[] {
    return findMatches(lines, ZONE_RE).map((m) => ({
      code: m.groups[0] ?? "",
      title: (lines[m.lineIndex] ?? "").trim(),
      start_line: m.lineIndex,
    }));
  },

  detectSubsections(lines: string[]): SubsectionBoundary[] {
    return findMatches(lines, ARTICLE_RE).map((m) => {
      const parent = m.groups[0] ?? "";
      const number = m.groups[1] ?? "";
      const title = (m.groups[2] ?? "").trim();
      return {
        parent_code: parent,
        code: `${parent}_ART_${number}`,
        number,
        title: title || `Article ${number}`,
        start_line: m.lineIndex,
      };
    });
  },

  detectOverrides(text: string): Override[] {
    return extractSecteurOverrides(text, [
      /Dans le secteur ([A-Z]+[a-z0-9]+)/g,
      /Dans les secteurs ([A-Z]+[a-z0-9]+(?:,\s*[A-Z]+[a-z0-9]+)*(?:\s+et\s+[A-Z]+[a-z0-9]+)?)/g,
      /[ÀA] l'exception du secteur ([A-Z]+[a-z0-9]+)/g,
    ]);
  },

  detectCrossRefs(text: string): CrossRef[] {
    return extractCrossRefs(text, [
      /cf\.?\s*article\s+([A-Z0-9]+-\d+(?:\.\d+)*)/gi,
      /cf\.?\s*sch[ée]ma\s+n[°o]\s*(\d+)/gi,
      /cf\.?\s*annexe\s+(\d+)/gi,
      /article\s+L\.?\s*(\d+-\d+)/gi, // Code de l'Urbanisme
    ]);
  },

  validationRules: [
    { type: "zone_count", expected: null }, // flexible: logged, not asserted
    { type: "article_count_per_zone", expected: 14 },
    { type: "no_empty_segments", fields: ["raw_text", "title"] },
    { type: "known_zone_codes", pattern: /^(U[A-Z]*[a-z0-9]*|[0-9]?AU[a-z0-9]*|A[a-z0-9]*|N[a-z0-9]*)$/ },
  ],
};
