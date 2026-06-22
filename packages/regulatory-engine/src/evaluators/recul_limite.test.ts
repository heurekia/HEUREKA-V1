import { describe, it, expect } from "vitest";
import { evaluateReculLimite } from "./recul_limite.ts";
import type { EvaluableRule } from "./types.ts";
import type { DossierFact, InstructionContext } from "../context/types.ts";

function rule(o: Partial<EvaluableRule> & { rule_id: string }): EvaluableRule {
  return {
    rule_id: o.rule_id, zone_id: "z", zone_code: "UA",
    topic: o.topic ?? "recul_limite", sub_theme: null, article_number: 7, article_title: null,
    applies_if: [], validation_status: "valide", rule_text: "L≥3 m", summary: null,
    conditions: null, exceptions: null,
    value_min: o.value_min ?? null, value_max: null, value_exact: null,
    unit: "m", cases: o.cases ?? [],
    citizen_title: null, citizen_summary: null, citizen_relevant: true, instructor_note: null,
    source_segment_id: o.source_segment_id ?? null, source_page: o.source_page ?? null, source_quote: o.source_quote ?? null,
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

describe("evaluateReculLimite", () => {
  it("returns null for non recul_limite topic", () => {
    expect(evaluateReculLimite(rule({ rule_id: "r1", topic: "hauteur" }), ctx([]))).toBeNull();
  });

  it("conforme when ALL distances ≥ value_min", () => {
    const f = evaluateReculLimite(rule({ rule_id: "r1", value_min: 3 }), ctx([fact("reculs_limites", [4.2, 3.0, 5.1], "document_extraction")]))!;
    expect(f.status).toBe("conforme");
  });

  it("non_conforme as soon as one distance is below value_min", () => {
    const f = evaluateReculLimite(rule({ rule_id: "r1", value_min: 3 }), ctx([fact("reculs_limites", [4.2, 2.5, 5.1], "document_extraction")]))!;
    expect(f.status).toBe("non_conforme");
    expect(f.explanation).toContain("limite n°2");
  });

  it("downgrades when source is citizen_declaration", () => {
    const f = evaluateReculLimite(rule({ rule_id: "r1", value_min: 3 }), ctx([fact("reculs_limites", [2.5], "citizen_declaration")]))!;
    expect(f.status).toBe("incertain");
    expect(f.severity).toBe("alerte");
  });

  it("incertain when reculs_limites is missing", () => {
    const f = evaluateReculLimite(rule({ rule_id: "r1", value_min: 3 }), ctx([]))!;
    expect(f.status).toBe("incertain");
    expect(f.missing_facts).toEqual(["reculs_limites"]);
  });

  it("accepts a scalar fact value as a single-distance array", () => {
    const f = evaluateReculLimite(rule({ rule_id: "r1", value_min: 3 }), ctx([fact("reculs_limites", 4, "document_extraction")]))!;
    expect(f.status).toBe("conforme");
  });

  it("parses French decimal strings", () => {
    const f = evaluateReculLimite(rule({ rule_id: "r1", value_min: 3 }), ctx([fact("reculs_limites", ["3,5", "4,1"], "document_extraction")]))!;
    expect(f.status).toBe("conforme");
  });

  it("returns incertain on conditional cases (e.g. L = H/2)", () => {
    const f = evaluateReculLimite(
      rule({ rule_id: "r1", value_min: 3, cases: [{ condition: "L ≥ H/2", value: null, unit: "m" }] }),
      ctx([fact("reculs_limites", [4], "document_extraction")]),
    )!;
    expect(f.status).toBe("incertain");
  });
});
