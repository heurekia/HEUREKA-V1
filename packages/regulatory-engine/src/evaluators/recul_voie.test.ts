import { describe, it, expect } from "vitest";
import { evaluateReculVoie } from "./recul_voie.ts";
import type { EvaluableRule } from "./types.ts";
import type { DossierFact, InstructionContext } from "../context/types.ts";

function rule(o: Partial<EvaluableRule> & { rule_id: string }): EvaluableRule {
  return {
    rule_id: o.rule_id, zone_id: "z", zone_code: o.zone_code ?? "UA",
    topic: o.topic ?? "recul_voie", sub_theme: null, article_number: 6, article_title: null,
    applies_if: [], validation_status: "valide", rule_text: "Recul min", summary: null,
    conditions: null, exceptions: o.exceptions ?? null,
    value_min: o.value_min ?? null, value_max: o.value_max ?? null, value_exact: null,
    unit: o.unit ?? "m", cases: o.cases ?? [],
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

const fact = (k: string, v: unknown, source: DossierFact["source"], unit?: string): DossierFact => ({ key: k, value: v, source, unit });

describe("evaluateReculVoie", () => {
  it("returns null for non recul_voie topic", () => {
    expect(evaluateReculVoie(rule({ rule_id: "r1", topic: "hauteur" }), ctx([]))).toBeNull();
  });

  it("conforme when recul ≥ value_min from a plan", () => {
    const f = evaluateReculVoie(rule({ rule_id: "r1", value_min: 4 }), ctx([fact("recul_voie", 4.2, "document_extraction")]))!;
    expect(f.status).toBe("conforme");
  });

  it("non_conforme when recul < value_min on a verifiable source", () => {
    const f = evaluateReculVoie(rule({ rule_id: "r1", value_min: 4 }), ctx([fact("recul_voie", 3.5, "document_extraction")]))!;
    expect(f.status).toBe("non_conforme");
    expect(f.recommended_action?.action_type).toBe("motif_refus");
  });

  it("downgrades to alerte/incertain on citizen_declaration", () => {
    const f = evaluateReculVoie(rule({ rule_id: "r1", value_min: 4 }), ctx([fact("recul_voie", 2, "citizen_declaration")]))!;
    expect(f.status).toBe("incertain");
    expect(f.severity).toBe("alerte");
  });

  it("incertain when fact is missing", () => {
    const f = evaluateReculVoie(rule({ rule_id: "r1", value_min: 4 }), ctx([]))!;
    expect(f.status).toBe("incertain");
    expect(f.missing_facts).toEqual(["recul_voie"]);
  });

  it("incertain on conditional cases", () => {
    const f = evaluateReculVoie(
      rule({ rule_id: "r1", value_min: 4, cases: [{ condition: "voie à sens unique", value: 3, unit: "m" }] }),
      ctx([fact("recul_voie", 3.5, "document_extraction")]),
    )!;
    expect(f.status).toBe("incertain");
  });

  it("suggests prescription if rule.exceptions is set", () => {
    const f = evaluateReculVoie(
      rule({ rule_id: "r1", value_min: 4, exceptions: "Bâtiments d'angle exclus" }),
      ctx([fact("recul_voie", 3, "document_extraction")]),
    )!;
    expect(f.recommended_action?.action_type).toBe("prescription_arrete");
  });
});
