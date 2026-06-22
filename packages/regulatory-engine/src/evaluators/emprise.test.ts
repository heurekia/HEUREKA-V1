import { describe, it, expect } from "vitest";
import { evaluateEmprise } from "./emprise.ts";
import type { EvaluableRule } from "./types.ts";
import type { DossierFact, InstructionContext } from "../context/types.ts";

function rule(overrides: Partial<EvaluableRule> & { rule_id: string }): EvaluableRule {
  return {
    rule_id: overrides.rule_id,
    zone_id: overrides.zone_id ?? "z",
    zone_code: overrides.zone_code ?? "UA",
    topic: overrides.topic ?? "emprise_sol",
    sub_theme: overrides.sub_theme ?? null,
    article_number: overrides.article_number ?? 9,
    article_title: overrides.article_title ?? null,
    applies_if: overrides.applies_if ?? [],
    validation_status: overrides.validation_status ?? "valide",
    rule_text: overrides.rule_text ?? "Emprise au sol limitée",
    summary: overrides.summary ?? null,
    conditions: overrides.conditions ?? null,
    exceptions: overrides.exceptions ?? null,
    value_min: overrides.value_min ?? null,
    value_max: overrides.value_max ?? null,
    value_exact: overrides.value_exact ?? null,
    // Distinguer "non fourni" de "explicitement null" : `??` collapserait
    // null vers la valeur par défaut, ce qui empêche de tester le mode
    // ratio sans unité.
    unit: "unit" in overrides ? overrides.unit ?? null : "m2",
    cases: overrides.cases ?? [],
    citizen_title: overrides.citizen_title ?? null,
    citizen_summary: overrides.citizen_summary ?? null,
    citizen_relevant: overrides.citizen_relevant ?? true,
    instructor_note: overrides.instructor_note ?? null,
    source_segment_id: overrides.source_segment_id ?? null,
    source_page: overrides.source_page ?? null,
    source_quote: overrides.source_quote ?? null,
  };
}

function ctx(facts: DossierFact[]): InstructionContext {
  return {
    dossier: { id: "d1", numero: "PC-1", type: "permis_de_construire", status: "en_instruction" },
    parcelle: {},
    projet: {},
    facts,
    applicability_tags: [],
    candidate_rule_ids: [],
    missing_facts: [],
    built_at: new Date().toISOString(),
    engine_version: "test",
  };
}

const fact = (k: string, v: unknown, source: DossierFact["source"], unit?: string): DossierFact => ({
  key: k, value: v, source, unit,
});

describe("evaluateEmprise", () => {
  it("returns null when topic is not emprise_sol", () => {
    expect(evaluateEmprise(rule({ rule_id: "r1", topic: "hauteur" }), ctx([]))).toBeNull();
  });

  describe("mode m² absolu", () => {
    it("conforme below the absolute m² threshold", () => {
      const f = evaluateEmprise(rule({ rule_id: "r1", value_max: 250 }), ctx([fact("emprise", 180, "document_extraction", "m2")]))!;
      expect(f.status).toBe("conforme");
    });

    it("non_conforme above the absolute m² threshold from a plan", () => {
      const f = evaluateEmprise(rule({ rule_id: "r1", value_max: 250 }), ctx([fact("emprise", 320, "document_extraction", "m2")]))!;
      expect(f.status).toBe("non_conforme");
      expect(f.severity).toBe("bloquant");
      expect(f.recommended_action?.action_type).toBe("motif_refus");
    });

    it("incertain when the fact is missing", () => {
      const f = evaluateEmprise(rule({ rule_id: "r1", value_max: 250 }), ctx([]))!;
      expect(f.status).toBe("incertain");
      expect(f.missing_facts).toEqual(["emprise"]);
      expect(f.recommended_action?.action_type).toBe("demander_piece");
    });

    it("downgrades non_conforme on citizen_declaration", () => {
      const f = evaluateEmprise(rule({ rule_id: "r1", value_max: 250 }), ctx([fact("emprise", 320, "citizen_declaration", "m2")]))!;
      expect(f.status).toBe("incertain");
      expect(f.severity).toBe("alerte");
    });
  });

  describe("mode ratio / %", () => {
    it("computes ratio from emprise / surface_terrain and flags non_conforme over 40 %", () => {
      const f = evaluateEmprise(
        rule({ rule_id: "r1", value_max: 40, unit: "%" }),
        ctx([
          fact("emprise", 250, "document_extraction", "m2"),
          fact("surface_terrain", 500, "document_extraction", "m2"),
        ]),
      )!;
      expect(f.status).toBe("non_conforme"); // 250/500 = 50 % > 40 %
    });

    it("conforme when ratio is within the threshold", () => {
      const f = evaluateEmprise(
        rule({ rule_id: "r1", value_max: 40, unit: "%" }),
        ctx([
          fact("emprise", 150, "document_extraction", "m2"),
          fact("surface_terrain", 500, "document_extraction", "m2"),
        ]),
      )!;
      expect(f.status).toBe("conforme"); // 30 %
    });

    it("incertain when surface_terrain is missing in ratio mode", () => {
      const f = evaluateEmprise(
        rule({ rule_id: "r1", value_max: 0.4, unit: "ratio" }),
        ctx([fact("emprise", 200, "document_extraction", "m2")]),
      )!;
      expect(f.status).toBe("incertain");
      expect(f.missing_facts).toContain("surface_terrain");
    });

    it("treats unit-less value <= 1 as a ratio (heuristic)", () => {
      const f = evaluateEmprise(
        rule({ rule_id: "r1", value_max: 0.4, unit: null }),
        ctx([
          fact("emprise", 200, "document_extraction", "m2"),
          fact("surface_terrain", 500, "document_extraction", "m2"),
        ]),
      )!;
      // 200/500 = 0.4 → exactly at threshold, within tolerance → conforme
      expect(f.status).toBe("conforme");
    });
  });

  describe("cases & qualitative", () => {
    it("returns incertain when the rule has conditional cases", () => {
      const f = evaluateEmprise(
        rule({ rule_id: "r1", value_max: 250, cases: [{ condition: "si terrain > 1000 m²", value: 200, unit: "m2" }] }),
        ctx([fact("emprise", 180, "document_extraction", "m2")]),
      )!;
      expect(f.status).toBe("incertain");
      expect(f.title).toMatch(/cas conditionnels/i);
    });

    it("returns incertain when the rule is purely qualitative", () => {
      const f = evaluateEmprise(
        rule({ rule_id: "r1", value_max: null }),
        ctx([fact("emprise", 180, "document_extraction", "m2")]),
      )!;
      expect(f.status).toBe("incertain");
    });
  });
});
