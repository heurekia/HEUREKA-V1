/**
 * Canonical loader — pousse un CanonicalPLU directement en DB.
 *
 * Délègue à `loadRules` (rules-loader.ts) qui :
 *  - upserte la commune
 *  - purge zones + règles existantes pour cette commune (transaction)
 *  - réinsère zones + règles avec validation_status = "brouillon"
 *
 * Le bypass LLM est total : ce qu'on lit dans le JSON est CE qui finit en DB.
 */
import type { CanonicalPLU } from "./schema.ts";
import { loadRules, type LoadRulesResult } from "../db/rules-loader.ts";
import type { ZoneRules, StructuredRule } from "../structure/structurer.ts";

/**
 * Convertit le format canonique vers le format interne consommé par loadRules.
 * Pure / testable sans DB.
 */
export function canonicalToZoneRules(plu: CanonicalPLU): ZoneRules[] {
  return plu.zones.map((zone) => ({
    zone_code: zone.code,
    zone_label: zone.label,
    zone_type: zone.type,
    rules: zone.rules.map((r): StructuredRule => ({
      article_number: r.article_number,
      article_title: r.article_title,
      topic: r.topic,
      rule_text: r.rule_text,
      value_min: r.value_min,
      value_max: r.value_max,
      value_exact: r.value_exact,
      unit: r.unit,
      conditions: r.conditions,
      summary: r.summary,
      instructor_note: r.instructor_note,
      cases: r.cases.map((c) => ({
        condition: c.condition,
        value: c.value,
        unit: c.unit,
        kind: c.kind,
      })),
      sub_theme: r.sub_theme,
      applies_if: r.applies_if,
      // Spécification hauteur structurée (niveau 2) si fournie par l'outil tiers.
      height_spec: r.height_spec ?? null,
      // Traçabilité : le canonique porte déjà un bloc `source` (document, page,
      // paragraph). On le mappe vers la provenance fine. Pas de segment RAG ici
      // (le canonique ne référence pas les document_segments) → source_segment_id
      // reste null ; page et verbatim suffisent à citer "PLU X, p. 42".
      source_segment_id: null,
      source_page: r.source?.page ?? null,
      source_quote: r.source?.paragraph ?? r.rule_text ?? null,
    })),
  }));
}

export interface ImportCanonicalResult extends LoadRulesResult {
  schema_version: number;
  commune_name: string;
  insee: string;
  doc_version: string;
}

/**
 * Ingère un CanonicalPLU validé. À appeler APRÈS parseCanonical() pour
 * garantir la cohérence du payload.
 */
export async function importCanonical(plu: CanonicalPLU): Promise<ImportCanonicalResult> {
  const zoneRules = canonicalToZoneRules(plu);
  const result = await loadRules(plu._meta.insee, plu._meta.commune, zoneRules, {
    zipCode: plu._meta.zip_code,
  });
  return {
    ...result,
    schema_version: plu.schema_version,
    commune_name: plu._meta.commune,
    insee: plu._meta.insee,
    doc_version: plu._meta.doc_version,
  };
}
