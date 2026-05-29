/**
 * Adapter 3 — PPRI (plan de prévention des risques inondation).
 *
 * STUB. PPRI règlements are organised by risk zone (zone rouge, bleue…) rather
 * than PLU zones. Boundary detection to be defined once a real PPRI is analysed.
 */
import type { DocumentAdapter } from "./interface.ts";

export const PPRIAdapter: DocumentAdapter = {
  doc_type: "PPRI",
  doc_subtype: "reglement_ppri",

  noise_patterns: [/^\d{1,4}$/, /^page \d+/i],

  // TODO: boundary = "Zone <rouge|bleue|…>" / "Titre <n>".
  detectSegments() {
    return [];
  },

  detectSubsections() {
    return [];
  },

  validationRules: [{ type: "no_empty_segments", fields: ["raw_text", "title"] }],
};
