import type { InstructionContext } from "../context/types.js";
import type { ApplicabilityResult } from "../applicability/types.js";
import type { RegulatoryFinding, FindingStatus, FindingSeverity } from "../findings/types.js";

// Résumé d'une exécution du moteur. Persiste dans
// regulatory_analyses.summary et alimente les indicateurs côté UI.
export interface AnalysisSummary {
  counts_by_status: Record<FindingStatus, number>;
  counts_by_severity: Record<FindingSeverity, number>;
  applicable_rules_count: number;
  excluded_rules_count: number;
  superseded_rule_ids: string[];
  rules_without_evaluator: Array<{ rule_id: string; topic: string }>;
  supported_topics: string[];
  warnings: string[];
  duration_ms: number;
}

export interface EvaluationRun {
  context: InstructionContext;
  applicability: ApplicabilityResult;
  findings: RegulatoryFinding[];
  summary: AnalysisSummary;
}

export const EMPTY_STATUS_COUNTS: Record<FindingStatus, number> = {
  conforme: 0,
  non_conforme: 0,
  incertain: 0,
  non_applicable: 0,
};

export const EMPTY_SEVERITY_COUNTS: Record<FindingSeverity, number> = {
  bloquant: 0,
  prescription: 0,
  alerte: 0,
  info: 0,
};
