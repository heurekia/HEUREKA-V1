import { db, zone_regulatory_rules, zones } from "@heureka-v1/db";
import { eq, inArray } from "drizzle-orm";
import type { EvaluableRule, RuleCase } from "./types.js";

// Hydrate les règles complètes à partir d'une liste d'IDs. Garde la même
// règle "validation_status uniquement" qu'à l'applicabilité : un fait
// rejoué doit rester sûr même si le contexte le permet.
export async function loadEvaluableRulesByIds(ids: string[]): Promise<EvaluableRule[]> {
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      rule_id: zone_regulatory_rules.id,
      zone_id: zone_regulatory_rules.zone_id,
      zone_code: zones.zone_code,
      topic: zone_regulatory_rules.topic,
      sub_theme: zone_regulatory_rules.sub_theme,
      article_number: zone_regulatory_rules.article_number,
      article_title: zone_regulatory_rules.article_title,
      applies_if: zone_regulatory_rules.applies_if,
      validation_status: zone_regulatory_rules.validation_status,
      rule_text: zone_regulatory_rules.rule_text,
      summary: zone_regulatory_rules.summary,
      conditions: zone_regulatory_rules.conditions,
      exceptions: zone_regulatory_rules.exceptions,
      value_min: zone_regulatory_rules.value_min,
      value_max: zone_regulatory_rules.value_max,
      value_exact: zone_regulatory_rules.value_exact,
      unit: zone_regulatory_rules.unit,
      cases: zone_regulatory_rules.cases,
      citizen_title: zone_regulatory_rules.citizen_title,
      citizen_summary: zone_regulatory_rules.citizen_summary,
      citizen_relevant: zone_regulatory_rules.citizen_relevant,
      instructor_note: zone_regulatory_rules.instructor_note,
      source_segment_id: zone_regulatory_rules.source_segment_id,
      source_page: zone_regulatory_rules.source_page,
      source_quote: zone_regulatory_rules.source_quote,
    })
    .from(zone_regulatory_rules)
    .innerJoin(zones, eq(zones.id, zone_regulatory_rules.zone_id))
    .where(inArray(zone_regulatory_rules.id, ids));

  return rows.map((r) => ({
    rule_id: r.rule_id,
    zone_id: r.zone_id,
    zone_code: r.zone_code,
    topic: r.topic,
    sub_theme: r.sub_theme,
    article_number: r.article_number,
    article_title: r.article_title,
    applies_if: asStringArray(r.applies_if),
    validation_status: r.validation_status,
    rule_text: r.rule_text,
    summary: r.summary,
    conditions: r.conditions,
    exceptions: r.exceptions,
    value_min: r.value_min,
    value_max: r.value_max,
    value_exact: r.value_exact,
    unit: r.unit,
    cases: asRuleCases(r.cases),
    citizen_title: r.citizen_title,
    citizen_summary: r.citizen_summary,
    citizen_relevant: r.citizen_relevant,
    instructor_note: r.instructor_note,
    source_segment_id: r.source_segment_id,
    source_page: r.source_page,
    source_quote: r.source_quote,
  }));
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asRuleCases(v: unknown): RuleCase[] {
  if (!Array.isArray(v)) return [];
  const out: RuleCase[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const condition = typeof o.condition === "string" ? o.condition : null;
    if (!condition) continue;
    out.push({
      condition,
      value: typeof o.value === "number" && Number.isFinite(o.value) ? o.value : null,
      unit: typeof o.unit === "string" ? o.unit : null,
      kind: typeof o.kind === "string" ? o.kind : undefined,
    });
  }
  return out;
}
