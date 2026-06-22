import type { InstructionContext } from "../context/types.js";
import type { RegulatoryFinding } from "../findings/types.js";
import {
  articleLabel,
  buildRuleSource,
  buildSourceRefs,
  coerceNumeric,
  formatNumber,
  formatThresholds,
  stringifyFact,
} from "./common.js";
import type { EvaluableRule } from "./types.js";

// Tolérance numérique : 0,01 m² sur les surfaces, 0,001 sur les ratios.
// Évite qu'un arrondi de lecture produise un faux non-conforme.
const AREA_TOLERANCE_M2 = 0.01;
const RATIO_TOLERANCE = 0.001;

const FACT_KEY = "emprise";
const FACT_TERRAIN_KEY = "surface_terrain";

// Évalue une règle d'emprise au sol.
//
// Deux formes de règles supportées :
//   1. Limite absolue en m² (unit="m2", value_max=250 par exemple).
//      Comparaison directe entre fact 'emprise' et value_max.
//   2. Ratio ou pourcentage (unit="ratio" / "%" / vide avec valeur ≤ 1
//      pour ratio, > 1 et ≤ 100 pour pourcentage). Comparaison entre
//      fact 'emprise' / fact 'surface_terrain' et le seuil. Si
//      surface_terrain manque → incertain (on ne devine pas la
//      surface de la parcelle).
//
// Politique de confiance identique à hauteur : un écart sourcé sur
// citizen_declaration ne fonde pas un non_conforme — on rétrograde et
// on demande la pièce.
export function evaluateEmprise(
  rule: EvaluableRule,
  context: InstructionContext,
): RegulatoryFinding | null {
  if (rule.topic !== "emprise_sol") return null;

  const dossier_id = context.dossier.id;
  const ruleSource = buildRuleSource(rule);
  // Sources du finding : règle de zone + passage source (segment/page/verbatim)
  // si la provenance fine a été gravée à l'ingestion.
  const sourceRefs = buildSourceRefs(rule);
  const baseFields = {
    dossier_id,
    rule_id: rule.rule_id,
    topic: "emprise_sol",
    legal_basis: sourceRefs,
    source_refs: sourceRefs,
  } satisfies Pick<RegulatoryFinding, "dossier_id" | "rule_id" | "topic" | "legal_basis" | "source_refs">;

  // ── Cas conditionnels non auto-évalués ────────────────────────────
  if (rule.cases && rule.cases.length > 0) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Emprise : cas conditionnels à examiner",
      explanation: `${articleLabel(rule)} comporte ${rule.cases.length} cas conditionnel(s). Évaluation manuelle requise.`,
      facts_used: [],
      missing_facts: [],
      recommended_action: {
        action_type: "valider_point",
        label: "Identifier le cas applicable et vérifier la conformité",
        priority: "moyenne",
      },
    };
  }

  // ── Règle purement qualitative ────────────────────────────────────
  if (rule.value_min == null && rule.value_max == null && rule.value_exact == null) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Emprise : règle qualitative à apprécier",
      explanation: `${articleLabel(rule)} encadre l'emprise sans fixer de seuil chiffré.`,
      facts_used: [],
      missing_facts: [],
    };
  }

  const emprise = context.facts.find((f) => f.key === FACT_KEY);
  const mode = detectMode(rule);

  // ── Mode ratio ────────────────────────────────────────────────────
  if (mode === "ratio") {
    const terrain = context.facts.find((f) => f.key === FACT_TERRAIN_KEY);
    if (!emprise || !terrain) {
      const missing = [...(emprise ? [] : [FACT_KEY]), ...(terrain ? [] : [FACT_TERRAIN_KEY])];
      return {
        ...baseFields,
        status: "incertain",
        severity: "info",
        title: "Emprise au sol : ratio à vérifier",
        explanation: `${articleLabel(rule)} limite l'emprise en proportion du terrain. Éléments manquants pour conclure : ${missing.join(", ")}.`,
        facts_used: emprise ? [FACT_KEY] : terrain ? [FACT_TERRAIN_KEY] : [],
        missing_facts: missing,
        recommended_action: {
          action_type: "demander_piece",
          label: missing.includes(FACT_TERRAIN_KEY)
            ? "Demander un plan de masse coté avec surface de terrain"
            : "Demander un plan de masse coté avec emprise au sol",
          priority: "haute",
          legal_basis: [ruleSource],
        },
      };
    }
    const empriseM2 = coerceNumeric(emprise.value, emprise.unit, "m2");
    const terrainM2 = coerceNumeric(terrain.value, terrain.unit, "m2");
    if (empriseM2 == null || terrainM2 == null || terrainM2 <= 0) {
      return illisible(baseFields, emprise.value, emprise.unit, [FACT_KEY, FACT_TERRAIN_KEY]);
    }
    const observed = empriseM2 / terrainM2;
    const threshold = ratioThreshold(rule);
    const breach = compareRatio(observed, threshold);
    if (!breach) {
      return {
        ...baseFields,
        status: "conforme",
        severity: "info",
        title: `Emprise conforme (${formatPct(observed)} du terrain)`,
        explanation: `${articleLabel(rule)} : ${formatThresholds(rule)}. Emprise ${formatNumber(empriseM2, "m²")} / ${formatNumber(terrainM2, "m²")} = ${formatPct(observed)}.`,
        facts_used: [FACT_KEY, FACT_TERRAIN_KEY],
        missing_facts: [],
      };
    }
    return nonConforme(baseFields, rule, ruleSource, breach, emprise.source, [FACT_KEY, FACT_TERRAIN_KEY], `Emprise non conforme (${formatPct(observed)} du terrain)`);
  }

  // ── Mode m² absolu ────────────────────────────────────────────────
  if (!emprise) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Emprise au sol à mesurer",
      explanation: `${articleLabel(rule)} fixe ${formatThresholds(rule)}, mais le dossier ne déclare pas l'emprise projetée.`,
      facts_used: [],
      missing_facts: [FACT_KEY],
      recommended_action: {
        action_type: "demander_piece",
        label: "Demander un plan de masse coté avec emprise au sol",
        reason: "L'emprise projetée n'est pas connue alors qu'une règle PLU la plafonne.",
        priority: "haute",
        legal_basis: [ruleSource],
      },
    };
  }
  const observedM2 = coerceNumeric(emprise.value, emprise.unit, "m2");
  if (observedM2 == null) {
    return illisible(baseFields, emprise.value, emprise.unit, [FACT_KEY]);
  }
  const breaches: string[] = [];
  if (rule.value_max != null && observedM2 > rule.value_max + AREA_TOLERANCE_M2) {
    breaches.push(`emprise ${formatNumber(observedM2, "m²")} > ${formatNumber(rule.value_max, "m²")} (max)`);
  }
  if (rule.value_min != null && observedM2 < rule.value_min - AREA_TOLERANCE_M2) {
    breaches.push(`emprise ${formatNumber(observedM2, "m²")} < ${formatNumber(rule.value_min, "m²")} (min)`);
  }
  if (rule.value_exact != null && Math.abs(observedM2 - rule.value_exact) > AREA_TOLERANCE_M2) {
    breaches.push(`emprise ${formatNumber(observedM2, "m²")} ≠ ${formatNumber(rule.value_exact, "m²")} (exact)`);
  }
  if (breaches.length === 0) {
    return {
      ...baseFields,
      status: "conforme",
      severity: "info",
      title: `Emprise conforme (${formatNumber(observedM2, "m²")})`,
      explanation: `${articleLabel(rule)} : ${formatThresholds(rule)}. Emprise projetée : ${formatNumber(observedM2, "m²")}.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
    };
  }
  return nonConforme(baseFields, rule, ruleSource, breaches.join(" ; "), emprise.source, [FACT_KEY], `Emprise non conforme (${formatNumber(observedM2, "m²")})`);
}

// ─── Helpers spécifiques à emprise ───────────────────────────────────

function detectMode(rule: EvaluableRule): "ratio" | "m2" {
  const u = rule.unit?.toLowerCase().trim();
  if (u === "ratio" || u === "%" || u === "pct") return "ratio";
  // Heuristique défensive : si l'unité est vide mais value_max ≤ 1, on
  // suppose un ratio. C'est conservateur : un PLU qui plafonne à
  // "emprise ≤ 1 m²" est extrêmement rare et l'instructeur pourra
  // corriger via une saisie manuelle si besoin.
  if (!u && rule.value_max != null && rule.value_max <= 1) return "ratio";
  return "m2";
}

// Convertit la valeur seuil d'une règle ratio en ratio normalisé [0..1].
function ratioThreshold(rule: EvaluableRule): {
  max?: number;
  min?: number;
  exact?: number;
} {
  const norm = (v: number | null) => {
    if (v == null) return undefined;
    const u = rule.unit?.toLowerCase().trim();
    if (u === "%" || u === "pct") return v / 100;
    // unit empty ou "ratio" : déjà normalisé.
    return v;
  };
  return { max: norm(rule.value_max), min: norm(rule.value_min), exact: norm(rule.value_exact) };
}

function compareRatio(
  observed: number,
  t: { max?: number; min?: number; exact?: number },
): string | null {
  const breaches: string[] = [];
  if (t.max != null && observed > t.max + RATIO_TOLERANCE) {
    breaches.push(`ratio ${formatPct(observed)} > ${formatPct(t.max)} (max)`);
  }
  if (t.min != null && observed < t.min - RATIO_TOLERANCE) {
    breaches.push(`ratio ${formatPct(observed)} < ${formatPct(t.min)} (min)`);
  }
  if (t.exact != null && Math.abs(observed - t.exact) > RATIO_TOLERANCE) {
    breaches.push(`ratio ${formatPct(observed)} ≠ ${formatPct(t.exact)} (exact)`);
  }
  return breaches.length ? breaches.join(" ; ") : null;
}

function formatPct(ratio: number): string {
  const pct = ratio * 100;
  const rounded = Math.round(pct * 10) / 10;
  const isInt = Number.isInteger(rounded);
  return `${isInt ? rounded : rounded.toFixed(1).replace(".", ",")} %`;
}

function illisible(
  baseFields: Pick<RegulatoryFinding, "dossier_id" | "rule_id" | "topic" | "legal_basis" | "source_refs">,
  value: unknown,
  unit: string | undefined,
  facts_used: string[],
): RegulatoryFinding {
  return {
    ...baseFields,
    status: "incertain",
    severity: "info",
    title: "Emprise : valeur illisible",
    explanation: `Valeur ou unité non exploitable (valeur=${stringifyFact(value)}, unité=${unit ?? "n.c."}).`,
    facts_used,
    missing_facts: [],
    recommended_action: {
      action_type: "clarifier_fait",
      label: "Vérifier la valeur de l'emprise et son unité",
      priority: "moyenne",
    },
  };
}

function nonConforme(
  baseFields: Pick<RegulatoryFinding, "dossier_id" | "rule_id" | "topic" | "legal_basis" | "source_refs">,
  rule: EvaluableRule,
  ruleSource: ReturnType<typeof buildRuleSource>,
  breachText: string,
  factSource: string,
  facts_used: string[],
  title: string,
): RegulatoryFinding {
  if (factSource === "citizen_declaration") {
    return {
      ...baseFields,
      status: "incertain",
      severity: "alerte",
      title: "Emprise : écart déclaré à confirmer sur pièce",
      explanation: `Sur la base d'une déclaration citoyenne : ${breachText}. À confirmer sur le plan de masse.`,
      facts_used,
      missing_facts: [],
      recommended_action: {
        action_type: "demander_piece",
        label: "Demander le plan de masse pour confirmer l'emprise",
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
    title,
    explanation: breachText + (hasException ? ` (exceptions au PLU : ${rule.exceptions})` : ""),
    facts_used,
    missing_facts: [],
    recommended_action: hasException
      ? {
          action_type: "prescription_arrete",
          label: "Examiner si une prescription peut régulariser l'écart d'emprise",
          priority: "haute",
          legal_basis: [ruleSource],
        }
      : {
          action_type: "motif_refus",
          label: "Motif de refus : emprise au sol hors seuil",
          priority: "haute",
          legal_basis: [ruleSource],
        },
  };
}
