import { db, zone_regulatory_rules, zones } from "@heureka-v1/db";
import { eq, inArray } from "drizzle-orm";
import type { InstructionContext } from "../context/types.js";
import { evaluateApplicability } from "./engine.js";
import type { ApplicabilityResult, RuleForApplicability } from "./types.js";

// Charge les règles candidates listées dans le contexte puis évalue leur
// applicabilité. Sépare le chargement DB de la logique d'évaluation pour
// que cette dernière reste testable hors base.
//
// Si `context.candidate_rule_ids` est vide (commune non résolue par le
// builder, par exemple), le résultat est vide avec un warning.
export async function loadAndEvaluateApplicability(
  context: InstructionContext,
): Promise<ApplicabilityResult> {
  if (context.candidate_rule_ids.length === 0) {
    return {
      applicable: [],
      excluded: [],
      warnings: [
        "Aucune règle candidate : commune non résolue ou commune sans règles validées.",
      ],
    };
  }

  const rows = await db
    .select({
      rule_id: zone_regulatory_rules.id,
      zone_id: zone_regulatory_rules.zone_id,
      zone_code: zones.zone_code,
      topic: zone_regulatory_rules.topic,
      sub_theme: zone_regulatory_rules.sub_theme,
      article_number: zone_regulatory_rules.article_number,
      applies_if: zone_regulatory_rules.applies_if,
      validation_status: zone_regulatory_rules.validation_status,
    })
    .from(zone_regulatory_rules)
    .innerJoin(zones, eq(zones.id, zone_regulatory_rules.zone_id))
    .where(inArray(zone_regulatory_rules.id, context.candidate_rule_ids));

  const rules: RuleForApplicability[] = rows.map((r) => ({
    rule_id: r.rule_id,
    zone_id: r.zone_id,
    zone_code: r.zone_code,
    topic: r.topic,
    sub_theme: r.sub_theme,
    article_number: r.article_number,
    applies_if: asStringArray(r.applies_if),
    validation_status: r.validation_status,
  }));

  return evaluateApplicability(rules, context);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
