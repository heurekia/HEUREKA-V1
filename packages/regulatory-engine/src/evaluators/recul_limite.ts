import type { InstructionContext } from "../context/types.js";
import type { RegulatoryFinding } from "../findings/types.js";
import {
  articleLabel,
  buildRuleSource,
  formatNumber,
  formatThresholds,
} from "./common.js";
import type { EvaluableRule } from "./types.js";

const DISTANCE_TOLERANCE_M = 0.01;
const FACT_KEY = "reculs_limites";

// Évalue les reculs par rapport aux limites séparatives. Spécificité par
// rapport au recul à la voie : on lit un TABLEAU de cotes (une par limite),
// et toute cote sous le seuil produit un non_conforme. On ne conclut au
// conforme que si la cote MINIMALE du tableau respecte la règle.
//
// Le tableau peut contenir 1 à 4 cotes typiquement (4 si limite gauche /
// droite / fond / 2e limite gauche en angle). On ne traite pas les règles
// du type "L = H / 2" : ce sont des cases conditionnels qui dépendent de
// la hauteur, à instruire manuellement pour l'instant.
export function evaluateReculLimite(
  rule: EvaluableRule,
  context: InstructionContext,
): RegulatoryFinding | null {
  if (rule.topic !== "recul_limite") return null;

  const dossier_id = context.dossier.id;
  const ruleSource = buildRuleSource(rule);
  const baseFields = {
    dossier_id,
    rule_id: rule.rule_id,
    topic: "recul_limite",
    legal_basis: [ruleSource],
    source_refs: [ruleSource],
  } satisfies Pick<RegulatoryFinding, "dossier_id" | "rule_id" | "topic" | "legal_basis" | "source_refs">;

  if (rule.cases && rule.cases.length > 0) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Recul aux limites : cas conditionnels à examiner",
      explanation: `${articleLabel(rule)} comporte ${rule.cases.length} cas conditionnel(s) (par ex. L=H/2). Évaluation manuelle requise.`,
      facts_used: [],
      missing_facts: [],
      recommended_action: { action_type: "valider_point", label: "Identifier le cas applicable et le seuil correspondant", priority: "moyenne" },
    };
  }

  if (rule.value_min == null && rule.value_max == null && rule.value_exact == null) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Recul aux limites : règle qualitative à apprécier",
      explanation: `${articleLabel(rule)} encadre le recul aux limites sans fixer de seuil chiffré.`,
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
      title: "Reculs aux limites à mesurer",
      explanation: `${articleLabel(rule)} fixe ${formatThresholds(rule)} pour chaque limite séparative, mais aucune cote n'a été extraite.`,
      facts_used: [],
      missing_facts: [FACT_KEY],
      recommended_action: {
        action_type: "demander_piece",
        label: "Demander un plan de masse coté avec les distances aux limites séparatives",
        priority: "haute",
        legal_basis: [ruleSource],
      },
    };
  }

  const recoils = parseDistances(fact.value);
  if (recoils == null || recoils.length === 0) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Reculs aux limites : valeurs illisibles",
      explanation: `Les cotes de recul extraites ne sont pas exploitables (${JSON.stringify(fact.value)}).`,
      facts_used: [FACT_KEY],
      missing_facts: [],
      recommended_action: { action_type: "clarifier_fait", label: "Vérifier les cotes de recul aux limites", priority: "moyenne" },
    };
  }

  const min = Math.min(...recoils);
  const offendingIdx: number[] = [];
  if (rule.value_min != null) {
    recoils.forEach((r, i) => {
      if (r < rule.value_min! - DISTANCE_TOLERANCE_M) offendingIdx.push(i);
    });
  }

  if (offendingIdx.length === 0 && rule.value_min != null) {
    return {
      ...baseFields,
      status: "conforme",
      severity: "info",
      title: `Reculs aux limites conformes (min observé ${formatNumber(min, "m")})`,
      explanation: `${articleLabel(rule)} : ${formatThresholds(rule)}. Cotes : [${recoils.map((r) => formatNumber(r, "m")).join(", ")}].`,
      facts_used: [FACT_KEY],
      missing_facts: [],
    };
  }

  // Au moins une cote en dessous du minimum (ou règle sans min, traité
  // comme info — improbable mais cadré).
  if (rule.value_min == null) {
    return {
      ...baseFields,
      status: "conforme",
      severity: "info",
      title: "Reculs aux limites : règle sans minimum chiffré",
      explanation: `${articleLabel(rule)} : ${formatThresholds(rule)}.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
    };
  }

  const detail = offendingIdx
    .map((i) => `limite n°${i + 1} : ${formatNumber(recoils[i]!, "m")} < ${formatNumber(rule.value_min!, "m")}`)
    .join(" ; ");

  if (fact.source === "citizen_declaration") {
    return {
      ...baseFields,
      status: "incertain",
      severity: "alerte",
      title: "Reculs aux limites : écart déclaré à confirmer",
      explanation: `Sur la base d'une déclaration citoyenne : ${detail}. À confirmer sur le plan de masse.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
      recommended_action: {
        action_type: "demander_piece",
        label: "Demander le plan de masse pour confirmer les distances aux limites",
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
    title: `Reculs aux limites non conformes (${offendingIdx.length} cote${offendingIdx.length > 1 ? "s" : ""} hors seuil)`,
    explanation: detail + (hasException ? ` (exceptions au PLU : ${rule.exceptions})` : ""),
    facts_used: [FACT_KEY],
    missing_facts: [],
    recommended_action: hasException
      ? { action_type: "prescription_arrete", label: "Examiner si une prescription peut régulariser les reculs", priority: "haute", legal_basis: [ruleSource] }
      : { action_type: "motif_refus", label: "Motif de refus : distance aux limites séparatives insuffisante", priority: "haute", legal_basis: [ruleSource] },
  };
}

// Parse le tableau de cotes. Tolère :
//   - un tableau de nombres : [4.2, 3.1, 5.0]
//   - un tableau de chaînes : ["4,2", "3.1"]
//   - une valeur scalaire (interprétée comme une cote unique)
// Renvoie null si aucune valeur exploitable.
function parseDistances(v: unknown): number[] | null {
  const asNum = (x: unknown): number | null => {
    if (typeof x === "number" && Number.isFinite(x)) return x;
    if (typeof x === "string") {
      const n = Number(x.trim().replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  if (Array.isArray(v)) {
    const out: number[] = [];
    for (const x of v) {
      const n = asNum(x);
      if (n != null) out.push(n);
    }
    return out;
  }
  const single = asNum(v);
  return single != null ? [single] : null;
}
