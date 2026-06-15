import { describe, it, expect } from "vitest";
import { evaluateApplicability, resolveSpecificity } from "./engine.ts";
import type { RuleForApplicability } from "./types.ts";
import type { InstructionContext } from "../context/types.ts";

function rule(overrides: Partial<RuleForApplicability> & { rule_id: string }): RuleForApplicability {
  return {
    rule_id: overrides.rule_id,
    zone_id: overrides.zone_id ?? "zone-uuid",
    zone_code: overrides.zone_code ?? "UA",
    topic: overrides.topic ?? "hauteur",
    sub_theme: overrides.sub_theme ?? null,
    article_number: overrides.article_number ?? null,
    applies_if: overrides.applies_if ?? [],
    validation_status: overrides.validation_status ?? "valide",
  };
}

function ctx(
  zonage: string[] | undefined,
  tags: string[],
): InstructionContext {
  return {
    dossier: {
      id: "dossier-uuid",
      numero: "PC-001",
      type: "permis_de_construire",
      status: "soumis",
    },
    parcelle: { zonage_plu: zonage },
    projet: {},
    facts: [],
    applicability_tags: tags,
    candidate_rule_ids: [],
    missing_facts: [],
    built_at: new Date().toISOString(),
    engine_version: "0.0.0-test",
  };
}

describe("evaluateApplicability", () => {
  it("includes a general rule when zone matches and no applies_if", () => {
    const result = evaluateApplicability(
      [rule({ rule_id: "r1", zone_code: "UA" })],
      ctx(["UA"], []),
    );
    expect(result.applicable).toHaveLength(1);
    expect(result.applicable[0]!.reason).toMatchObject({
      zone_matched: true,
      zone_unknown: false,
      specificity_score: 0,
    });
    expect(result.excluded).toHaveLength(0);
  });

  it("excludes rules whose zone does not match", () => {
    const result = evaluateApplicability(
      [
        rule({ rule_id: "r1", zone_code: "UA" }),
        rule({ rule_id: "r2", zone_code: "UB" }),
      ],
      ctx(["UA"], []),
    );
    expect(result.applicable.map((a) => a.rule.rule_id)).toEqual(["r1"]);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]!.reason).toBe("zone_mismatch");
  });

  it("never includes non-valide rules even if zone matches", () => {
    const result = evaluateApplicability(
      [
        rule({ rule_id: "draft", zone_code: "UA", validation_status: "brouillon" }),
        rule({ rule_id: "rejected", zone_code: "UA", validation_status: "rejete" }),
      ],
      ctx(["UA"], []),
    );
    expect(result.applicable).toHaveLength(0);
    expect(result.excluded.map((e) => ({ id: e.rule.rule_id, reason: e.reason }))).toEqual([
      { id: "draft", reason: "not_validated" },
      { id: "rejected", reason: "not_validated" },
    ]);
  });

  it("requires ALL applies_if tags to be present (conjunction)", () => {
    const result = evaluateApplicability(
      [
        rule({ rule_id: "r_partial", applies_if: ["cloture_sur_rue", "abf"] }),
        rule({ rule_id: "r_full", applies_if: ["cloture_sur_rue"] }),
      ],
      ctx(["UA"], ["cloture_sur_rue"]),
    );
    expect(result.applicable.map((a) => a.rule.rule_id)).toEqual(["r_full"]);
    const excluded = result.excluded[0]!;
    expect(excluded.rule.rule_id).toBe("r_partial");
    expect(excluded.reason).toBe("applies_if_unsatisfied");
    expect(excluded.detail).toContain("abf");
  });

  it("includes everything matching validation+applies_if when zone is unknown, with a warning", () => {
    const result = evaluateApplicability(
      [
        rule({ rule_id: "ua", zone_code: "UA" }),
        rule({ rule_id: "ub", zone_code: "UB" }),
      ],
      ctx(undefined, []),
    );
    expect(result.applicable.map((a) => a.rule.rule_id).sort()).toEqual(["ua", "ub"]);
    expect(result.applicable.every((a) => a.reason.zone_unknown)).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/zone plu non résolue/i);
  });

  it("computes specificity_score equal to the number of matched applies_if tags", () => {
    const result = evaluateApplicability(
      [
        rule({ rule_id: "general", applies_if: [] }),
        rule({ rule_id: "specifique", applies_if: ["abf", "extension"] }),
      ],
      ctx(["UA"], ["abf", "extension"]),
    );
    const scoreById = new Map(result.applicable.map((a) => [a.rule.rule_id, a.reason.specificity_score]));
    expect(scoreById.get("general")).toBe(0);
    expect(scoreById.get("specifique")).toBe(2);
  });

  it("emits a warning when no rule is applicable but rules were provided", () => {
    const result = evaluateApplicability(
      [rule({ rule_id: "r1", zone_code: "UB" })],
      ctx(["UA"], []),
    );
    expect(result.applicable).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/aucune règle/i);
  });

  it("returns an empty result with no warning when no rules are provided", () => {
    const result = evaluateApplicability([], ctx(["UA"], []));
    expect(result.applicable).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
    expect(result.warnings).toEqual([]);
  });
});

describe("resolveSpecificity", () => {
  it("keeps the most specific rule for a given (zone, topic, sub_theme)", () => {
    const result = evaluateApplicability(
      [
        rule({ rule_id: "general", topic: "hauteur", applies_if: [] }),
        rule({ rule_id: "abf", topic: "hauteur", applies_if: ["abf"] }),
      ],
      ctx(["UA"], ["abf"]),
    );
    const winners = resolveSpecificity(result.applicable);
    expect(winners.map((w) => w.rule.rule_id)).toEqual(["abf"]);
  });

  it("keeps all rules tied at the highest specificity (no arbitrary tiebreak)", () => {
    const result = evaluateApplicability(
      [
        rule({ rule_id: "a", topic: "hauteur", applies_if: ["abf"] }),
        rule({ rule_id: "b", topic: "hauteur", applies_if: ["extension"] }),
        rule({ rule_id: "general", topic: "hauteur", applies_if: [] }),
      ],
      ctx(["UA"], ["abf", "extension"]),
    );
    const winners = resolveSpecificity(result.applicable);
    expect(winners.map((w) => w.rule.rule_id).sort()).toEqual(["a", "b"]);
  });

  it("groups by sub_theme — a rule with sub_theme does not compete with one without", () => {
    const result = evaluateApplicability(
      [
        rule({ rule_id: "global", topic: "aspect", sub_theme: null }),
        rule({ rule_id: "toiture", topic: "aspect", sub_theme: "Toitures" }),
      ],
      ctx(["UA"], []),
    );
    const winners = resolveSpecificity(result.applicable);
    expect(winners.map((w) => w.rule.rule_id).sort()).toEqual(["global", "toiture"]);
  });
});
