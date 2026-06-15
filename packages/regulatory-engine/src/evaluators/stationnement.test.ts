import { describe, it, expect } from "vitest";
import { evaluateStationnement } from "./stationnement.ts";
import type { EvaluableRule } from "./types.ts";
import type { DossierFact, InstructionContext } from "../context/types.ts";

function rule(o: Partial<EvaluableRule> & { rule_id: string }): EvaluableRule {
  return {
    rule_id: o.rule_id, zone_id: "z", zone_code: "UA",
    topic: o.topic ?? "stationnement", sub_theme: null, article_number: 12, article_title: null,
    applies_if: [], validation_status: "valide", rule_text: "≥ 2 places", summary: null,
    conditions: null, exceptions: null,
    value_min: o.value_min ?? null, value_max: null, value_exact: null,
    unit: o.unit ?? "places", cases: o.cases ?? [],
    citizen_title: null, citizen_summary: null, citizen_relevant: true, instructor_note: null,
  };
}

function ctx(facts: DossierFact[]): InstructionContext {
  return {
    dossier: { id: "d1", numero: "PC-1", type: "permis_de_construire", status: "en_instruction" },
    parcelle: {}, projet: {}, facts, applicability_tags: [], candidate_rule_ids: [],
    missing_facts: [], built_at: new Date().toISOString(), engine_version: "test",
  };
}

const fact = (k: string, v: unknown, source: DossierFact["source"]): DossierFact => ({ key: k, value: v, source });

describe("evaluateStationnement", () => {
  it("returns null for non stationnement topic", () => {
    expect(evaluateStationnement(rule({ rule_id: "r1", topic: "hauteur" }), ctx([]))).toBeNull();
  });

  it("conforme when number of places >= value_min", () => {
    const f = evaluateStationnement(rule({ rule_id: "r1", value_min: 2 }), ctx([fact("stationnement", 2, "citizen_declaration")]))!;
    expect(f.status).toBe("conforme");
  });

  it("non_conforme bloquant when source is instructor (places shortage from authoritative source)", () => {
    const f = evaluateStationnement(rule({ rule_id: "r1", value_min: 2 }), ctx([fact("stationnement", 1, "instructor_entry")]))!;
    expect(f.status).toBe("non_conforme");
    expect(f.severity).toBe("bloquant");
  });

  it("non_conforme prescription when source is citizen — regularisable via prescription", () => {
    // Special policy explained in the evaluator: citizen-declared parking
    // count is fairly reliable, so we mark it non_conforme but with a
    // softer 'prescription' severity rather than bloquant.
    const f = evaluateStationnement(rule({ rule_id: "r1", value_min: 2 }), ctx([fact("stationnement", 1, "citizen_declaration")]))!;
    expect(f.status).toBe("non_conforme");
    expect(f.severity).toBe("prescription");
    expect(f.recommended_action?.action_type).toBe("prescription_arrete");
  });

  it("incertain when the fact is missing", () => {
    const f = evaluateStationnement(rule({ rule_id: "r1", value_min: 2 }), ctx([]))!;
    expect(f.status).toBe("incertain");
    expect(f.missing_facts).toEqual(["stationnement"]);
  });

  it("incertain when the rule poses conditional cases (barème)", () => {
    const f = evaluateStationnement(
      rule({ rule_id: "r1", value_min: 1, cases: [{ condition: "par logement", value: 1, unit: "places" }, { condition: "par tranche de 80 m² SP", value: 1, unit: "places" }] }),
      ctx([fact("stationnement", 2, "citizen_declaration")]),
    )!;
    expect(f.status).toBe("incertain");
    expect(f.title).toMatch(/barème conditionnel/i);
  });

  it("rounds non-integer place counts and reports integers in messages", () => {
    // observed = 1.4 → rounds to 1, < 2 → non_conforme
    const f = evaluateStationnement(rule({ rule_id: "r1", value_min: 2 }), ctx([fact("stationnement", 1.4, "citizen_declaration")]))!;
    expect(f.status).toBe("non_conforme");
    expect(f.title).toMatch(/1 place/i);
  });
});
