import type { RuleForApplicability } from "../applicability/types.js";

// Cas conditionnel d'une règle (ex: "10 m si voie à sens unique / 13 m si
// double sens"). Forme alignée sur le schéma canonique d'ingestion.
export interface RuleCase {
  condition: string;
  value: number | null;
  unit: string | null;
  kind?: string;
}

// Règle complète, telle qu'un évaluateur en a besoin pour produire un
// verdict. Strictement plus large que RuleForApplicability : la couche
// applicabilité travaille sur la projection slim, les évaluateurs sur la
// projection complète. Les deux types restent compatibles (héritage).
export interface EvaluableRule extends RuleForApplicability {
  article_title: string | null;
  rule_text: string;
  summary: string | null;
  conditions: string | null;
  exceptions: string | null;
  value_min: number | null;
  value_max: number | null;
  value_exact: number | null;
  unit: string | null;
  cases: RuleCase[];
  citizen_title: string | null;
  citizen_summary: string | null;
  citizen_relevant: boolean;
  instructor_note: string | null;
  // Provenance fine vers le passage source (cf. zone_regulatory_rules) :
  // permet aux findings de citer le segment + la page + le verbatim, et pas
  // seulement la règle. Null pour les règles saisies manuellement.
  source_segment_id: string | null;
  source_page: number | null;
  source_quote: string | null;
}
