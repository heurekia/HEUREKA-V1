import { describe, it, expect } from "vitest";
import { evaluateHauteur } from "./hauteur.ts";
import type { EvaluableRule } from "./types.ts";
import type { DossierFact, InstructionContext } from "../context/types.ts";

function rule(overrides: Partial<EvaluableRule> & { rule_id: string }): EvaluableRule {
  return {
    rule_id: overrides.rule_id,
    zone_id: overrides.zone_id ?? "zone-uuid",
    zone_code: overrides.zone_code ?? "UA",
    topic: overrides.topic ?? "hauteur",
    sub_theme: overrides.sub_theme ?? null,
    article_number: overrides.article_number ?? 10,
    article_title: overrides.article_title ?? "Hauteur des constructions",
    applies_if: overrides.applies_if ?? [],
    validation_status: overrides.validation_status ?? "valide",
    rule_text: overrides.rule_text ?? "La hauteur des constructions ne peut excéder 9 mètres.",
    summary: overrides.summary ?? null,
    conditions: overrides.conditions ?? null,
    exceptions: overrides.exceptions ?? null,
    value_min: overrides.value_min ?? null,
    value_max: overrides.value_max ?? null,
    value_exact: overrides.value_exact ?? null,
    unit: overrides.unit ?? "m",
    cases: overrides.cases ?? [],
    citizen_title: overrides.citizen_title ?? null,
    citizen_summary: overrides.citizen_summary ?? null,
    citizen_relevant: overrides.citizen_relevant ?? true,
    instructor_note: overrides.instructor_note ?? null,
  };
}

function ctx(facts: DossierFact[]): InstructionContext {
  return {
    dossier: {
      id: "dossier-uuid",
      numero: "PC-001",
      type: "permis_de_construire",
      status: "en_instruction",
    },
    parcelle: { zonage_plu: ["UA"] },
    projet: {},
    facts,
    applicability_tags: [],
    candidate_rule_ids: [],
    missing_facts: [],
    built_at: new Date().toISOString(),
    engine_version: "0.0.0-test",
  };
}

const fact = (overrides: Partial<DossierFact> & { key: string; value: unknown; source: DossierFact["source"] }): DossierFact => ({
  key: overrides.key,
  value: overrides.value,
  source: overrides.source,
  unit: overrides.unit,
  confidence: overrides.confidence,
});

describe("evaluateHauteur", () => {
  it("returns null when rule topic is not hauteur", () => {
    const finding = evaluateHauteur(rule({ rule_id: "r1", topic: "emprise_sol" }), ctx([]));
    expect(finding).toBeNull();
  });

  describe("missing fact", () => {
    it("produces an 'incertain' with missing_facts=['hauteur'] and asks for the plan de coupe", () => {
      const finding = evaluateHauteur(rule({ rule_id: "r1", value_max: 9 }), ctx([]))!;
      expect(finding.status).toBe("incertain");
      expect(finding.missing_facts).toEqual(["hauteur"]);
      expect(finding.facts_used).toEqual([]);
      expect(finding.recommended_action?.action_type).toBe("demander_piece");
      expect(finding.recommended_action?.priority).toBe("haute");
    });

    it("cites the rule as legal_basis even when the fact is missing", () => {
      const finding = evaluateHauteur(rule({ rule_id: "r1", value_max: 9 }), ctx([]))!;
      expect(finding.legal_basis).toEqual([{ type: "zone_rule", rule_id: "r1", article: "Art. 10" }]);
    });
  });

  describe("conforme", () => {
    it("returns 'conforme' when observed hauteur is below value_max", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: 7.5, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("conforme");
      expect(finding.severity).toBe("info");
      expect(finding.facts_used).toEqual(["hauteur"]);
      expect(finding.missing_facts).toEqual([]);
      expect(finding.recommended_action).toBeUndefined();
    });

    it("accepts the value exactly at the threshold (no false positive)", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: 9, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("conforme");
    });

    it("tolerates a 1 cm rounding overshoot", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: 9.005, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("conforme");
    });
  });

  describe("non_conforme", () => {
    it("returns 'non_conforme' and 'bloquant' when overshoot is clear and source is verifiable", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: 10.2, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("non_conforme");
      expect(finding.severity).toBe("bloquant");
      expect(finding.recommended_action?.action_type).toBe("motif_refus");
    });

    it("suggests prescription instead of refus when the rule declares exceptions", () => {
      const finding = evaluateHauteur(
        rule({
          rule_id: "r1",
          value_max: 9,
          exceptions: "Une dérogation est possible pour les bâtiments d'intérêt collectif.",
        }),
        ctx([fact({ key: "hauteur", value: 10.2, source: "instructor_entry" })]),
      )!;
      expect(finding.status).toBe("non_conforme");
      expect(finding.recommended_action?.action_type).toBe("prescription_arrete");
    });
  });

  describe("garde-fou extraction aberrante", () => {
    it("rétrograde en 'incertain'/alerte une hauteur extraite ≥ 2× le seuil (15,56 m vs 6,5 m)", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 6.5 }),
        ctx([fact({ key: "hauteur", value: 15.56, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("incertain");
      expect(finding.severity).toBe("alerte");
      expect(finding.recommended_action?.action_type).toBe("clarifier_fait");
      expect(finding.title).toMatch(/incohérente|vérifier/i);
    });

    it("fire sur le plafond absolu (≥ 30 m) même proche du seuil relatif", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 18 }),
        ctx([fact({ key: "hauteur", value: 35, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("incertain");
      expect(finding.title).toMatch(/incohérente|vérifier/i);
    });

    it("considère la plus petite valeur de cas comme seuil (règle à cas conditionnels)", () => {
      const finding = evaluateHauteur(
        rule({
          rule_id: "r1",
          value_max: null,
          cases: [{ condition: "Toiture-terrasse (acrotère)", value: 6.5, unit: "m" }],
        }),
        ctx([fact({ key: "hauteur", value: 15.56, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("incertain");
      expect(finding.title).toMatch(/incohérente|vérifier/i);
    });

    it("NE rétrograde PAS une non-conformité modérée (11 m vs 5 m : < 12 m absolu)", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 5 }),
        ctx([fact({ key: "hauteur", value: 11, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("non_conforme");
    });

    it("ne s'applique pas à une saisie instructeur (35 m saisi → non_conforme bloquant)", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: 35, source: "instructor_entry" })]),
      )!;
      expect(finding.status).toBe("non_conforme");
      expect(finding.severity).toBe("bloquant");
    });
  });

  describe("confidence policy", () => {
    it("does NOT ground a non_conforme on a citizen declaration — downgrades to incertain", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: 12, source: "citizen_declaration" })]),
      )!;
      expect(finding.status).toBe("incertain");
      expect(finding.severity).toBe("alerte");
      expect(finding.recommended_action?.action_type).toBe("demander_piece");
    });

    it("still grounds a non_conforme when the citizen-declared value is within threshold (no downgrade needed)", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: 8.5, source: "citizen_declaration" })]),
      )!;
      expect(finding.status).toBe("conforme");
    });
  });

  describe("ambiguous fact value", () => {
    it("returns 'incertain' when the value is not numeric", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: "environ neuf metres", source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("incertain");
      expect(finding.title).toMatch(/illisible/i);
    });

    it("parses '9,5' (French decimal) correctly", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: "9,5", source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("non_conforme");
    });

    it("converts cm to m", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: 750, unit: "cm", source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("conforme");
    });

    it("refuses to compare a raw NGF (cote altimetrique != hauteur)", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_max: 9 }),
        ctx([fact({ key: "hauteur", value: 47.5, unit: "NGF", source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("incertain");
      expect(finding.title).toMatch(/illisible/i);
    });
  });

  describe("conditional cases", () => {
    it("does NOT auto-evaluate a rule with conditional cases — returns 'incertain' with explicit reason", () => {
      const finding = evaluateHauteur(
        rule({
          rule_id: "r1",
          value_max: 13,
          cases: [
            { condition: "voie à sens unique", value: 10, unit: "m", kind: "parametre" },
            { condition: "voie à double sens", value: 13, unit: "m", kind: "parametre" },
          ],
        }),
        ctx([fact({ key: "hauteur", value: 11, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("incertain");
      expect(finding.title).toMatch(/cas conditionnels/i);
      expect(finding.explanation).toContain("voie à sens unique");
      expect(finding.recommended_action?.action_type).toBe("valider_point");
    });
  });

  describe("qualitative rule", () => {
    it("returns 'incertain' when the rule has no numeric threshold", () => {
      const finding = evaluateHauteur(
        rule({
          rule_id: "r1",
          value_max: null,
          value_min: null,
          value_exact: null,
          rule_text: "La hauteur doit s'inscrire harmonieusement dans le bâti existant.",
        }),
        ctx([fact({ key: "hauteur", value: 7.5, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("incertain");
      expect(finding.title).toMatch(/qualitative/i);
    });
  });

  describe("value_min", () => {
    it("flags non_conforme when observed is below the minimum", () => {
      const finding = evaluateHauteur(
        rule({ rule_id: "r1", value_min: 3 }),
        ctx([fact({ key: "hauteur", value: 2.5, source: "document_extraction" })]),
      )!;
      expect(finding.status).toBe("non_conforme");
      expect(finding.explanation).toMatch(/min/i);
    });
  });
});
