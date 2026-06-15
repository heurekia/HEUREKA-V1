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

const FACT_KEY = "stationnement";

// Évalue le nombre de places de stationnement.
//
// Sémantique de PLU fréquente :
//   - "≥ 2 places par logement individuel" — exprimé via cases (par
//     logement, par tranche de surface…). On NE résout PAS les cases ici :
//     incertain explicite, instructeur tranche.
//   - "≥ N places" (total absolu) — value_min posé, on compare au fait
//     'stationnement'.
//   - Règles qualitatives type "stationnement adapté à l'usage" — value_*
//     null → incertain qualitatif.
//
// La politique de confiance ne s'applique pas exactement comme pour la
// hauteur : le nombre de places projetées vient quasi toujours du CERFA
// (citizen_declaration). On ne rétrograde donc PAS automatiquement en
// 'alerte' si l'écart vient du CERFA — un manque de places déclaré par
// le pétitionnaire est un signal fiable de non-conformité, contrairement
// à une hauteur déclarée qui peut être imprécise. On garde néanmoins le
// fait que la valeur peut être contestée et propose à l'instructeur un
// avertissement plutôt qu'un motif de refus automatique.
export function evaluateStationnement(
  rule: EvaluableRule,
  context: InstructionContext,
): RegulatoryFinding | null {
  if (rule.topic !== "stationnement") return null;

  const dossier_id = context.dossier.id;
  const ruleSource = buildRuleSource(rule);
  const baseFields = {
    dossier_id,
    rule_id: rule.rule_id,
    topic: "stationnement",
    legal_basis: [ruleSource],
    source_refs: [ruleSource],
  } satisfies Pick<RegulatoryFinding, "dossier_id" | "rule_id" | "topic" | "legal_basis" | "source_refs">;

  if (rule.cases && rule.cases.length > 0) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Stationnement : barème conditionnel à instruire",
      explanation: `${articleLabel(rule)} pose un barème conditionnel (${rule.cases.length} cas, ex. par logement / par tranche de SP). À évaluer manuellement contre la composition du projet.`,
      facts_used: [],
      missing_facts: [],
      recommended_action: {
        action_type: "valider_point",
        label: "Calculer manuellement le nombre de places requis et confronter au projet",
        priority: "moyenne",
      },
    };
  }

  if (rule.value_min == null && rule.value_max == null && rule.value_exact == null) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Stationnement : règle qualitative à apprécier",
      explanation: `${articleLabel(rule)} encadre le stationnement sans fixer de seuil chiffré.`,
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
      title: "Stationnement : nombre de places à déclarer",
      explanation: `${articleLabel(rule)} impose ${formatThresholds(rule, "places")}, mais le dossier ne déclare pas le nombre de places projetées.`,
      facts_used: [],
      missing_facts: [FACT_KEY],
      recommended_action: {
        action_type: "demander_piece",
        label: "Demander la déclaration du nombre de places de stationnement",
        priority: "haute",
        legal_basis: [ruleSource],
      },
    };
  }

  const observed = coerceNumeric(fact.value, fact.unit, "places");
  if (observed == null) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Stationnement : valeur illisible",
      explanation: `Valeur non exploitable (valeur=${stringifyFact(fact.value)}, unité=${fact.unit ?? "n.c."}).`,
      facts_used: [FACT_KEY],
      missing_facts: [],
      recommended_action: { action_type: "clarifier_fait", label: "Vérifier le nombre de places de stationnement", priority: "moyenne" },
    };
  }

  // Le nombre de places est un entier — on tolère 0,5 d'arrondi mais on
  // affiche en entier dans les messages.
  const observedInt = Math.round(observed);
  const breaches: string[] = [];
  if (rule.value_min != null && observedInt < rule.value_min) {
    breaches.push(`${observedInt} place(s) < ${rule.value_min} (min)`);
  }
  if (rule.value_max != null && observedInt > rule.value_max) {
    breaches.push(`${observedInt} place(s) > ${rule.value_max} (max)`);
  }
  if (rule.value_exact != null && observedInt !== rule.value_exact) {
    breaches.push(`${observedInt} place(s) ≠ ${rule.value_exact} (exact)`);
  }

  if (breaches.length === 0) {
    return {
      ...baseFields,
      status: "conforme",
      severity: "info",
      title: `Stationnement conforme (${observedInt} place${observedInt > 1 ? "s" : ""})`,
      explanation: `${articleLabel(rule)} : ${formatThresholds(rule, "places")}. Projet : ${observedInt} places.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
    };
  }

  // Pour le stationnement, la déclaration citoyenne est généralement
  // fiable (le citoyen sait combien de places il prévoit). On qualifie
  // l'écart en "non_conforme" même sur source citizen, mais en
  // sévérité 'prescription' (régularisable par dépôt d'une mise à jour
  // du CERFA) plutôt que 'bloquant' direct.
  const isCitizen = fact.source === "citizen_declaration";
  const hasException = (rule.exceptions ?? "").trim().length > 0;
  return {
    ...baseFields,
    status: "non_conforme",
    severity: isCitizen ? "prescription" : "bloquant",
    title: `Stationnement insuffisant (${observedInt} place${observedInt > 1 ? "s" : ""})`,
    explanation: breaches.join(" ; ") + (hasException ? ` (exceptions au PLU : ${rule.exceptions})` : ""),
    facts_used: [FACT_KEY],
    missing_facts: [],
    recommended_action: isCitizen
      ? {
          action_type: "prescription_arrete",
          label: "Demander une mise à jour du CERFA ou prescrire le bon nombre de places",
          priority: "haute",
          legal_basis: [ruleSource],
        }
      : hasException
        ? { action_type: "prescription_arrete", label: "Examiner si une prescription peut régulariser le stationnement", priority: "haute", legal_basis: [ruleSource] }
        : { action_type: "motif_refus", label: "Motif de refus : nombre de places insuffisant", priority: "haute", legal_basis: [ruleSource] },
  };
}

export const _stationnement_internals = { FACT_KEY };
