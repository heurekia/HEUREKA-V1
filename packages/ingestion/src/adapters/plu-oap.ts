/**
 * Adapter 2 — PLU_OAP (orientations d'aménagement et de programmation).
 *
 * STUB. OAPs have no nationally standardised structure (sectored by named
 * perimeters, not 14 articles), so segmentation logic is defined once a real
 * OAP is analysed. The adapter pattern lets this differ completely from the
 * règlement adapter without touching the engine.
 */
import type { DocumentAdapter } from "./interface.ts";

export const PLUOAPAdapter: DocumentAdapter = {
  doc_type: "PLU_OAP",
  doc_subtype: "orientation_amenagement",

  noise_patterns: [/^PLU\b.*$/i, /^\d{1,4}$/, /^page \d+/i],

  // TODO: boundary = "OAP <nom>" / "Secteur <nom>" / numbered "1. <titre>".
  detectSegments() {
    return [];
  },

  // OAPs have no standardised subsections.
  detectSubsections() {
    return [];
  },

  validationRules: [{ type: "no_empty_segments", fields: ["raw_text", "title"] }],
};
