import type { EvaluableRule } from "./types.js";
import type { SourceRef } from "../findings/types.js";

// Helpers partagés par les évaluateurs déterministes. On garde ces
// fonctions volontairement minimes : chaque evaluator reste lisible
// verticalement, on ne factorise que ce qui est strictement identique.

export function buildRuleSource(rule: EvaluableRule): SourceRef {
  return {
    type: "zone_rule",
    rule_id: rule.rule_id,
    article: rule.article_number != null ? `Art. ${rule.article_number}` : undefined,
  };
}

// Sources citables d'un finding. Toujours la règle de zone ; et, quand la
// provenance fine existe (gravée à l'ingestion), un renvoi vers le PASSAGE
// source — segment RAG + page + extrait verbatim — pour retracer le document
// jusqu'à l'endroit exact. Les évaluateurs déterministes travaillent sur des
// règles de PLU/PLUi (R.123-9) → doc_type "plu_reglement".
export function buildSourceRefs(rule: EvaluableRule, docType = "plu_reglement"): SourceRef[] {
  const refs: SourceRef[] = [buildRuleSource(rule)];
  if (rule.source_segment_id) {
    refs.push({
      type: "document_segment",
      segment_id: rule.source_segment_id,
      doc_type: docType,
      page: rule.source_page ?? undefined,
      quote: rule.source_quote ?? undefined,
    });
  }
  return refs;
}

export function articleLabel(rule: EvaluableRule): string {
  return rule.article_number != null
    ? `Article ${rule.article_number} (zone ${rule.zone_code})`
    : `PLU zone ${rule.zone_code}`;
}

// Coercion numérique générique. Le caller indique l'unité cible attendue
// (ex: "m", "m2", "places", "ratio"). Si l'unité du fait est différente,
// on tente une conversion sûre ; sinon on renvoie null (l'evaluator
// produira un finding 'incertain' plutôt que de comparer à l'aveugle).
export function coerceNumeric(
  value: unknown,
  factUnit: string | undefined,
  target:
    | "m"
    | "m2"
    | "ratio" // sans unité ou pourcentage normalisé en [0..1]
    | "places"
    | "deg"
    | "pct",
): number | null {
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

  const u = factUnit?.toLowerCase().trim();
  switch (target) {
    case "m":
      if (!u || u === "m" || u === "metre" || u === "metres" || u === "mètre" || u === "mètres") return n;
      if (u === "cm") return n / 100;
      if (u === "mm") return n / 1000;
      return null;
    case "m2":
      if (!u || u === "m2" || u === "m²") return n;
      return null;
    case "places":
      if (!u || u === "places" || u === "place") return n;
      return null;
    case "ratio":
      if (!u || u === "ratio") return n;
      if (u === "%" || u === "pct" || u === "pourcent") return n / 100;
      return null;
    case "deg":
      if (!u || u === "deg" || u === "°") return n;
      return null;
    case "pct":
      if (!u || u === "%" || u === "pct" || u === "pourcent") return n;
      return null;
    default:
      return null;
  }
}

// Format français d'un nombre + unité. "9 m", "9,20 m", "250 m²", "40 %".
export function formatNumber(value: number, unit?: string): string {
  const rounded = Math.round(value * 100) / 100;
  const isInt = Number.isInteger(rounded);
  const num = isInt ? String(rounded) : rounded.toFixed(2).replace(".", ",");
  if (!unit) return num;
  return `${num} ${unit}`;
}

// Représente les seuils d'une règle ("≤ 9 m, ≥ 3 m, = 4 m"). Utile pour
// les explications de findings.
export function formatThresholds(rule: EvaluableRule, displayUnit?: string): string {
  const u = displayUnit ?? rule.unit ?? "";
  const parts: string[] = [];
  if (rule.value_max != null) parts.push(`≤ ${formatNumber(rule.value_max, u)}`);
  if (rule.value_min != null) parts.push(`≥ ${formatNumber(rule.value_min, u)}`);
  if (rule.value_exact != null) parts.push(`= ${formatNumber(rule.value_exact, u)}`);
  return parts.length ? parts.join(", ") : "(aucun seuil chiffré)";
}

// Représente une valeur de fait pour les messages "valeur illisible".
export function stringifyFact(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
