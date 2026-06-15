import type { InstructionContext } from "../context/types.js";
import type { RegulatoryFinding } from "../findings/types.js";
import {
  articleLabel,
  buildRuleSource,
  coerceNumeric,
  formatNumber,
  formatThresholds,
  stringifyFact,
} from "./common.js";
import type { EvaluableRule } from "./types.js";

const DISTANCE_TOLERANCE_M = 0.01;
const FACT_KEY = "recul_voie";

// Évalue le recul minimal par rapport à la voie. Sémantique habituelle des
// règles PLU : `value_min` fixé (ex: ≥ 4 m), exact rare, value_max
// improbable (un PLU ne plafonne quasi jamais un recul). Le code gère
// néanmoins les trois cas pour rester aligné avec le schéma canonique.
export function evaluateReculVoie(
  rule: EvaluableRule,
  context: InstructionContext,
): RegulatoryFinding | null {
  if (rule.topic !== "recul_voie") return null;

  const dossier_id = context.dossier.id;
  const ruleSource = buildRuleSource(rule);
  const baseFields = {
    dossier_id,
    rule_id: rule.rule_id,
    topic: "recul_voie",
    legal_basis: [ruleSource],
    source_refs: [ruleSource],
  } satisfies Pick<RegulatoryFinding, "dossier_id" | "rule_id" | "topic" | "legal_basis" | "source_refs">;

  if (rule.cases && rule.cases.length > 0) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Recul à la voie : cas conditionnels à examiner",
      explanation: `${articleLabel(rule)} comporte ${rule.cases.length} cas conditionnel(s). Évaluation manuelle requise.`,
      facts_used: [],
      missing_facts: [],
      recommended_action: { action_type: "valider_point", label: "Identifier le cas applicable", priority: "moyenne" },
    };
  }

  if (rule.value_min == null && rule.value_max == null && rule.value_exact == null) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Recul à la voie : règle qualitative à apprécier",
      explanation: `${articleLabel(rule)} encadre le recul sans fixer de seuil chiffré.`,
      facts_used: [],
      missing_facts: [],
    };
  }

  const fact = context.facts.find((f) => f.key === FACT_KEY);
  if (!fact) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Recul à la voie à mesurer",
      explanation: `${articleLabel(rule)} fixe ${formatThresholds(rule)}, mais le dossier ne déclare pas de recul à la voie.`,
      facts_used: [],
      missing_facts: [FACT_KEY],
      recommended_action: {
        action_type: "demander_piece",
        label: "Demander un plan de masse coté avec le recul à la voie",
        priority: "haute",
        legal_basis: [ruleSource],
      },
    };
  }

  const observed = coerceNumeric(fact.value, fact.unit, "m");
  if (observed == null) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Recul à la voie : valeur illisible",
      explanation: `Valeur ou unité non exploitable (valeur=${stringifyFact(fact.value)}, unité=${fact.unit ?? "n.c."}).`,
      facts_used: [FACT_KEY],
      missing_facts: [],
      recommended_action: { action_type: "clarifier_fait", label: "Vérifier la cote de recul et son unité", priority: "moyenne" },
    };
  }

  const breaches: string[] = [];
  if (rule.value_min != null && observed < rule.value_min - DISTANCE_TOLERANCE_M) {
    breaches.push(`recul observé ${formatNumber(observed, "m")} < ${formatNumber(rule.value_min, "m")} (min)`);
  }
  if (rule.value_max != null && observed > rule.value_max + DISTANCE_TOLERANCE_M) {
    breaches.push(`recul observé ${formatNumber(observed, "m")} > ${formatNumber(rule.value_max, "m")} (max)`);
  }
  if (rule.value_exact != null && Math.abs(observed - rule.value_exact) > DISTANCE_TOLERANCE_M) {
    breaches.push(`recul observé ${formatNumber(observed, "m")} ≠ ${formatNumber(rule.value_exact, "m")} (exact)`);
  }

  if (breaches.length === 0) {
    return {
      ...baseFields,
      status: "conforme",
      severity: "info",
      title: `Recul à la voie conforme (${formatNumber(observed, "m")})`,
      explanation: `${articleLabel(rule)} : ${formatThresholds(rule)}. Recul projeté : ${formatNumber(observed, "m")}.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
    };
  }

  if (fact.source === "citizen_declaration") {
    return {
      ...baseFields,
      status: "incertain",
      severity: "alerte",
      title: "Recul à la voie : écart déclaré à confirmer",
      explanation: `Sur la base d'une déclaration citoyenne : ${breaches.join(" ; ")}. À confirmer sur le plan de masse.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
      recommended_action: {
        action_type: "demander_piece",
        label: "Demander le plan de masse pour confirmer le recul",
        priority: "haute",
        legal_basis: [ruleSource],
      },
    };
  }

  const hasException = (rule.exceptions ?? "").trim().length > 0;
  return {
    ...baseFields,
    status: "non_conforme",
    severity: "bloquant",
    title: `Recul à la voie non conforme (${formatNumber(observed, "m")})`,
    explanation: breaches.join(" ; ") + (hasException ? ` (exceptions au PLU : ${rule.exceptions})` : ""),
    facts_used: [FACT_KEY],
    missing_facts: [],
    recommended_action: hasException
      ? { action_type: "prescription_arrete", label: "Examiner si une prescription peut régulariser le recul", priority: "haute", legal_basis: [ruleSource] }
      : { action_type: "motif_refus", label: "Motif de refus : recul à la voie insuffisant", priority: "haute", legal_basis: [ruleSource] },
  };
}
