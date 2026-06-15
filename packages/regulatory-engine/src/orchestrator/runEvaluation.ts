import type { InstructionContext } from "../context/types.js";
import { evaluateApplicability, resolveSpecificity } from "../applicability/engine.js";
import type { ApplicableRule, RuleForApplicability } from "../applicability/types.js";
import { listSupportedTopics, runEvaluatorsOnRule } from "../evaluators/registry.js";
import type { EvaluableRule } from "../evaluators/types.js";
import type { RegulatoryFinding } from "../findings/types.js";
import {
  EMPTY_SEVERITY_COUNTS,
  EMPTY_STATUS_COUNTS,
  type AnalysisSummary,
  type EvaluationRun,
} from "./types.js";

// Exécution pure du moteur — aucune I/O. À context + règles identiques,
// résultat identique. Sert de cœur testable, et de base pour rejouer une
// analyse archivée à partir d'un context_snapshot.
//
// Étapes :
//
//   1. evaluateApplicability(rules, context) — sélection brute.
//   2. resolveSpecificity(applicable) — règle spéciale > règle générale
//      sur un même (zone, topic, sub_theme). Les règles évincées sont
//      reportées dans summary.superseded_rule_ids (visibles pour l'audit,
//      pas évaluées pour éviter le double verdict).
//   3. Pour chaque règle gagnante, dispatch aux évaluateurs du registre.
//      Une règle dont le topic n'a pas d'évaluateur est reportée dans
//      summary.rules_without_evaluator — l'instructeur sait ainsi ce que
//      le moteur n'a pas regardé.
export function runEvaluation(
  context: InstructionContext,
  rules: EvaluableRule[],
): EvaluationRun {
  const startedAt = Date.now();

  const applicability = evaluateApplicability(rules, context);
  const fullRulesById = new Map(rules.map((r) => [r.rule_id, r]));

  const winners = resolveSpecificity(applicability.applicable);
  const winnersIds = new Set(winners.map((w) => w.rule.rule_id));
  const superseded_rule_ids = applicability.applicable
    .filter((a) => !winnersIds.has(a.rule.rule_id))
    .map((a) => a.rule.rule_id);

  const findings: RegulatoryFinding[] = [];
  const rules_without_evaluator: Array<{ rule_id: string; topic: string }> = [];
  const supportedTopics = new Set(listSupportedTopics());

  for (const applicable of winners) {
    const rule = fullRulesById.get(applicable.rule.rule_id);
    if (!rule) continue;
    const ruleFindings = runEvaluatorsOnRule(rule, context);
    if (ruleFindings.length === 0 && !supportedTopics.has(rule.topic)) {
      rules_without_evaluator.push({ rule_id: rule.rule_id, topic: rule.topic });
    }
    findings.push(...ruleFindings);
  }

  const summary: AnalysisSummary = {
    counts_by_status: countBy(findings, (f) => f.status, EMPTY_STATUS_COUNTS),
    counts_by_severity: countBy(findings, (f) => f.severity, EMPTY_SEVERITY_COUNTS),
    applicable_rules_count: applicability.applicable.length,
    excluded_rules_count: applicability.excluded.length,
    superseded_rule_ids,
    rules_without_evaluator,
    supported_topics: [...supportedTopics].sort(),
    warnings: applicability.warnings,
    duration_ms: Date.now() - startedAt,
  };

  return { context, applicability, findings, summary };
}

function countBy<T, K extends string>(
  items: T[],
  keyFn: (item: T) => K,
  template: Record<K, number>,
): Record<K, number> {
  const out = { ...template };
  for (const item of items) {
    const k = keyFn(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
