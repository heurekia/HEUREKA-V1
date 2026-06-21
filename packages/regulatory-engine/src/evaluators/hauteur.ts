import type { DossierFact, InstructionContext } from "../context/types.js";
import type { RegulatoryFinding, SourceRef } from "../findings/types.js";
import type { EvaluableRule } from "./types.js";

// Tolérance numérique pour les comparaisons. 1 cm de marge évite qu'un
// arrondi de lecture (cote 9,00 m sur plan vs 9 m dans la règle) produise
// un faux non-conforme. Ce n'est PAS une marge réglementaire — c'est un
// epsilon de représentation. L'instructeur reste seul juge des arrondis.
const HEIGHT_TOLERANCE_M = 0.01;

const FACT_KEY = "hauteur";

// ── Garde-fou anti-extraction aberrante ──────────────────────────────
// Une hauteur "extraite" d'une pièce qui dépasse un plafond absolu, ou qui
// dépasse très largement le seuil PLU, trahit le plus souvent une erreur de
// lecture (cote NGF altimétrique prise pour une hauteur, échelle mal
// interprétée) plutôt qu'un projet réellement hors-norme. On ne fonde JAMAIS
// un refus sur une telle valeur : on remonte un point de vérification ciblé.
//
// Réglages volontairement conservateurs pour ne pas re-qualifier de vraies
// non-conformités modérées :
//   - plafond absolu : ≥ 30 m (immeuble de grande hauteur — toujours revu) ;
//   - dépassement extrême : ≥ 2× le seuil ET ≥ 12 m en absolu.
const IMPLAUSIBLE_ABSOLUTE_M = 30;
const IMPLAUSIBLE_FACTOR = 2;
const IMPLAUSIBLE_MIN_M = 12;

// Seuil de référence pour le test de dépassement : le plus petit seuil
// chiffré positif que porte la règle (value_max, value_exact, ou la plus
// petite valeur de cas). null si la règle ne chiffre rien.
function referenceMaxForPlausibility(rule: EvaluableRule): number | null {
  const candidates: number[] = [];
  if (rule.value_max != null) candidates.push(rule.value_max);
  if (rule.value_exact != null) candidates.push(rule.value_exact);
  for (const c of rule.cases ?? []) {
    if (typeof c.value === "number" && c.value > 0) candidates.push(c.value);
  }
  const positives = candidates.filter((v) => v > 0);
  return positives.length ? Math.min(...positives) : null;
}

function isImplausibleExtractedHeight(observed: number, rule: EvaluableRule): boolean {
  if (observed >= IMPLAUSIBLE_ABSOLUTE_M) return true;
  const ref = referenceMaxForPlausibility(rule);
  return ref != null && observed >= ref * IMPLAUSIBLE_FACTOR && observed >= IMPLAUSIBLE_MIN_M;
}

// Évalue une règle de hauteur contre les faits du dossier.
//
// Renvoie null si la règle n'est pas de topic "hauteur" — permet à
// l'orchestrateur d'appeler tous les évaluateurs sans pré-filtrer.
//
// Politique de confiance : une déclaration citoyenne (source =
// "citizen_declaration") ne peut PAS fonder un verdict "non_conforme".
// Si l'écart existe, on rétrograde en "incertain" + on demande la pièce.
// Cette règle est la traduction du commentaire posé dans le schéma
// dossier_facts : "un fait 'citizen_declaration' non vérifié ne doit
// jamais fonder un verdict bloquant".
export function evaluateHauteur(
  rule: EvaluableRule,
  context: InstructionContext,
): RegulatoryFinding | null {
  if (rule.topic !== "hauteur") return null;

  const dossier_id = context.dossier.id;
  const ruleSource: SourceRef = {
    type: "zone_rule",
    rule_id: rule.rule_id,
    article: rule.article_number != null ? `Art. ${rule.article_number}` : undefined,
  };
  const baseFields = {
    dossier_id,
    rule_id: rule.rule_id,
    topic: "hauteur",
    legal_basis: [ruleSource],
    source_refs: [ruleSource],
  } satisfies Pick<RegulatoryFinding, "dossier_id" | "rule_id" | "topic" | "legal_basis" | "source_refs">;

  // ── Fait manquant ─────────────────────────────────────────────────
  const fact = context.facts.find((f) => f.key === FACT_KEY);
  if (!fact) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Hauteur du projet à mesurer",
      explanation: `${articleLabel(rule)} fixe ${formatThresholds(rule)}, mais le dossier ne déclare pas de hauteur projetée.`,
      facts_used: [],
      missing_facts: [FACT_KEY],
      recommended_action: {
        action_type: "demander_piece",
        label: "Demander le plan de coupe avec hauteurs cotées (égout / faîtage / NGF)",
        reason: "La hauteur projetée n'est pas connue alors qu'une règle PLU la plafonne.",
        priority: "haute",
        legal_basis: [ruleSource],
      },
      citizen_summary:
        rule.citizen_summary ??
        "Votre projet doit respecter une hauteur maximale fixée par le PLU. Précisez la hauteur de votre construction sur le plan de coupe.",
    };
  }

  // ── Fait illisible ────────────────────────────────────────────────
  const observed = coerceMeters(fact.value, fact.unit);
  if (observed == null) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Hauteur du projet illisible",
      explanation: `La hauteur enregistrée n'a pas pu être convertie en mètres (valeur=${stringifyFact(fact.value)}, unité=${fact.unit ?? "n.c."}).`,
      facts_used: [FACT_KEY],
      missing_facts: [],
      recommended_action: {
        action_type: "clarifier_fait",
        label: "Vérifier la hauteur extraite et son unité",
        priority: "moyenne",
      },
    };
  }

  // ── Garde-fou : valeur extraite manifestement aberrante ──────────
  // Prend le pas sur l'évaluation des seuils/cas : comparer un seuil à une
  // valeur probablement fausse n'a pas de sens. Limité aux faits issus d'une
  // extraction automatique — une saisie instructeur ou une déclaration sont
  // traitées par leurs branches dédiées.
  if (fact.source === "document_extraction" && isImplausibleExtractedHeight(observed, rule)) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "alerte",
      title: `Hauteur extraite incohérente (${formatM(observed)}) — à vérifier sur la pièce`,
      explanation: `La hauteur extraite automatiquement (${formatM(observed)}) dépasse très largement ${formatThresholds(rule)}. Une telle valeur résulte le plus souvent d'une erreur de lecture (cote NGF altimétrique prise pour une hauteur, échelle mal interprétée) plutôt que d'un projet réellement hors-norme. À confirmer sur le plan de coupe avant toute décision.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
      recommended_action: {
        action_type: "clarifier_fait",
        label: "Vérifier la hauteur sur le plan de coupe (cotes faîtage / égout vs sol naturel)",
        reason: "Valeur extraite probablement erronée — ne pas fonder de décision sans contrôle.",
        priority: "haute",
      },
    };
  }

  // ── Règle à cas conditionnels ─────────────────────────────────────
  // La résolution automatique des `cases` arrive dans un sprint suivant.
  // On ne risque PAS un verdict ici : l'instructeur doit examiner le cas
  // applicable manuellement. C'est une remontée explicite, pas un silence.
  if (rule.cases && rule.cases.length > 0) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Hauteur : cas conditionnels à examiner",
      explanation: `${articleLabel(rule)} comporte ${rule.cases.length} cas conditionnel(s) : ${rule.cases.map((c) => c.condition).join(" ; ")}. L'évaluation automatique de ces cas n'est pas encore prise en charge.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
      recommended_action: {
        action_type: "valider_point",
        label: "Identifier manuellement le cas applicable et vérifier la conformité",
        priority: "moyenne",
      },
    };
  }

  // ── Règle qualitative ─────────────────────────────────────────────
  if (rule.value_min == null && rule.value_max == null && rule.value_exact == null) {
    return {
      ...baseFields,
      status: "incertain",
      severity: "info",
      title: "Hauteur : règle qualitative à apprécier",
      explanation: `${articleLabel(rule)} encadre la hauteur sans fixer de seuil chiffré. Évaluation qualitative nécessaire.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
    };
  }

  // ── Comparaison aux seuils ────────────────────────────────────────
  const breaches: string[] = [];
  if (rule.value_max != null && observed > rule.value_max + HEIGHT_TOLERANCE_M) {
    breaches.push(`hauteur observée ${formatM(observed)} > ${formatM(rule.value_max)} (max)`);
  }
  if (rule.value_min != null && observed < rule.value_min - HEIGHT_TOLERANCE_M) {
    breaches.push(`hauteur observée ${formatM(observed)} < ${formatM(rule.value_min)} (min)`);
  }
  if (rule.value_exact != null && Math.abs(observed - rule.value_exact) > HEIGHT_TOLERANCE_M) {
    breaches.push(`hauteur observée ${formatM(observed)} ≠ ${formatM(rule.value_exact)} (exact)`);
  }

  if (breaches.length === 0) {
    return {
      ...baseFields,
      status: "conforme",
      severity: "info",
      title: `Hauteur conforme (${formatM(observed)})`,
      explanation: `${articleLabel(rule)} : ${formatThresholds(rule)}. Hauteur projetée : ${formatM(observed)}.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
    };
  }

  // ── Écart détecté ─────────────────────────────────────────────────
  // Politique de confiance : déclaration citoyenne ne fonde pas un refus.
  if (fact.source === "citizen_declaration") {
    return {
      ...baseFields,
      status: "incertain",
      severity: "alerte",
      title: "Hauteur : écart déclaré à confirmer sur pièce",
      explanation: `Sur la base d'une déclaration citoyenne : ${breaches.join(" ; ")}. À confirmer sur le plan de coupe avant de fonder une décision défavorable.`,
      facts_used: [FACT_KEY],
      missing_facts: [],
      recommended_action: {
        action_type: "demander_piece",
        label: "Demander le plan de coupe pour confirmer la hauteur",
        reason: "La hauteur déclarée dépasse le seuil PLU mais la déclaration citoyenne seule ne fonde pas un refus.",
        priority: "haute",
        legal_basis: [ruleSource],
      },
    };
  }

  // Source vérifiable (extraction pièce, saisie instructeur, donnée
  // externe) → on peut fonder un non_conforme.
  const hasException = (rule.exceptions ?? "").trim().length > 0;
  return {
    ...baseFields,
    status: "non_conforme",
    severity: "bloquant",
    title: `Hauteur non conforme (${formatM(observed)})`,
    explanation: breaches.join(" ; ") + (hasException ? ` (exceptions au PLU : ${rule.exceptions})` : ""),
    facts_used: [FACT_KEY],
    missing_facts: [],
    recommended_action: hasException
      ? {
          action_type: "prescription_arrete",
          label: "Examiner si une prescription peut régulariser l'écart",
          reason: "Le PLU prévoit une exception possible — voir le champ `exceptions` de la règle.",
          priority: "haute",
          legal_basis: [ruleSource],
        }
      : {
          action_type: "motif_refus",
          label: `Motif de refus : hauteur ${formatM(observed)} hors seuil`,
          priority: "haute",
          legal_basis: [ruleSource],
        },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function articleLabel(rule: EvaluableRule): string {
  return rule.article_number != null
    ? `Article ${rule.article_number} (zone ${rule.zone_code})`
    : `PLU zone ${rule.zone_code}`;
}

function formatThresholds(rule: EvaluableRule): string {
  const unit = rule.unit ?? "m";
  const parts: string[] = [];
  if (rule.value_max != null) parts.push(`≤ ${rule.value_max} ${unit}`);
  if (rule.value_min != null) parts.push(`≥ ${rule.value_min} ${unit}`);
  if (rule.value_exact != null) parts.push(`= ${rule.value_exact} ${unit}`);
  return parts.length ? parts.join(", ") : "(aucun seuil chiffré)";
}

function formatM(v: number): string {
  // Affiche 9 → "9 m", 9.2 → "9,20 m", 9.234 → "9,23 m". Sépareur français.
  const rounded = Math.round(v * 100) / 100;
  const isInt = Number.isInteger(rounded);
  return `${isInt ? rounded : rounded.toFixed(2).replace(".", ",")} m`;
}

function stringifyFact(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

// Convertit une valeur de fait + une unité vers des mètres. Renvoie null
// si la conversion est ambiguë (unité inconnue, valeur non numérique). On
// préfère un null explicite à un guess silencieux — l'instructeur reverra.
function coerceMeters(value: unknown, unit?: string): number | null {
  let n: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) n = value;
  else if (typeof value === "string") {
    const trimmed = value.trim().replace(",", ".");
    if (trimmed !== "") {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) n = parsed;
    }
  }
  if (n == null) return null;

  const u = unit?.toLowerCase().trim();
  if (!u || u === "m" || u === "metre" || u === "metres" || u === "mètre" || u === "mètres") {
    return n;
  }
  if (u === "cm") return n / 100;
  if (u === "mm") return n / 1000;
  // NGF, etc. : on refuse — un NGF brut n'est pas une hauteur, c'est une
  // cote altimétrique. L'évaluateur n'a pas le sol naturel pour soustraire.
  return null;
}

// Réexport pour réutilisation par d'autres modules (tests, orchestrateur).
export const _internals = { coerceMeters, HEIGHT_TOLERANCE_M, FACT_KEY };
