import { describe, it, expect } from "vitest";
import { runEvaluation } from "./runEvaluation.ts";
import type { EvaluableRule } from "../evaluators/types.ts";
import type { DossierFact, InstructionContext } from "../context/types.ts";

function rule(overrides: Partial<EvaluableRule> & { rule_id: string }): EvaluableRule {
  return {
    rule_id: overrides.rule_id,
    zone_id: overrides.zone_id ?? "zone-uuid",
    zone_code: overrides.zone_code ?? "UA",
    topic: overrides.topic ?? "hauteur",
    sub_theme: overrides.sub_theme ?? null,
    article_number: overrides.article_number ?? 10,
    article_title: overrides.article_title ?? null,
    applies_if: overrides.applies_if ?? [],
    validation_status: overrides.validation_status ?? "valide",
    rule_text: overrides.rule_text ?? "Hauteur max 9 m",
    summary: overrides.summary ?? null,
    conditions: overrides.conditions ?? null,
    exceptions: overrides.exceptions ?? null,
    value_min: overrides.value_min ?? null,
    value_max: overrides.value_max ?? null,
    value_exact: overrides.value_exact ?? null,
    unit: overrides.unit ?? "m",
    cases: overrides.cases ?? [],
    height_spec: overrides.height_spec ?? null,
    citizen_title: overrides.citizen_title ?? null,
    citizen_summary: overrides.citizen_summary ?? null,
    citizen_relevant: overrides.citizen_relevant ?? true,
    instructor_note: overrides.instructor_note ?? null,
    source_segment_id: overrides.source_segment_id ?? null,
    source_page: overrides.source_page ?? null,
    source_quote: overrides.source_quote ?? null,
  };
}

function ctx(opts: {
  zonage?: string[];
  tags?: string[];
  facts?: DossierFact[];
  candidateIds?: string[];
}): InstructionContext {
  return {
    dossier: {
      id: "dossier-uuid",
      numero: "PC-001",
      type: "permis_de_construire",
      status: "en_instruction",
    },
    parcelle: { zonage_plu: opts.zonage ?? ["UA"] },
    projet: {},
    facts: opts.facts ?? [],
    applicability_tags: opts.tags ?? [],
    candidate_rule_ids: opts.candidateIds ?? [],
    missing_facts: [],
    built_at: new Date().toISOString(),
    engine_version: "0.0.0-test",
  };
}

describe("runEvaluation", () => {
  it("returns empty findings and a clean summary when no rules are provided", () => {
    const run = runEvaluation(ctx({}), []);
    expect(run.findings).toEqual([]);
    expect(run.summary.applicable_rules_count).toBe(0);
    expect(run.summary.excluded_rules_count).toBe(0);
    expect(run.summary.counts_by_status).toEqual({ conforme: 0, non_conforme: 0, incertain: 0, non_applicable: 0 });
  });

  it("evaluates an applicable hauteur rule and produces one finding", () => {
    const rules = [rule({ rule_id: "r1", value_max: 9 })];
    const run = runEvaluation(
      ctx({ facts: [{ key: "hauteur", value: 7, source: "document_extraction" }] }),
      rules,
    );
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]!.status).toBe("conforme");
    expect(run.summary.counts_by_status.conforme).toBe(1);
    expect(run.summary.applicable_rules_count).toBe(1);
  });

  it("reports rules that have no evaluator in summary.rules_without_evaluator", () => {
    // 'aspect' et 'destinations' ne sont pas encore couverts par un
    // evaluator → ils doivent remonter dans rules_without_evaluator avec
    // leur rule_id + topic.
    const rules = [
      rule({ rule_id: "r1", topic: "hauteur", value_max: 9 }),
      rule({ rule_id: "r2", topic: "aspect" }),
      rule({ rule_id: "r3", topic: "destinations" }),
    ];
    const run = runEvaluation(
      ctx({ facts: [{ key: "hauteur", value: 7, source: "document_extraction" }] }),
      rules,
    );
    expect(run.summary.rules_without_evaluator).toEqual(
      expect.arrayContaining([
        { rule_id: "r2", topic: "aspect" },
        { rule_id: "r3", topic: "destinations" },
      ]),
    );
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]!.rule_id).toBe("r1");
  });

  it("supersedes a general rule when a more specific one applies (no double verdict)", () => {
    const rules = [
      rule({ rule_id: "general", value_max: 9, applies_if: [] }),
      rule({ rule_id: "specifique", value_max: 12, applies_if: ["extension"] }),
    ];
    const run = runEvaluation(
      ctx({
        tags: ["extension"],
        facts: [{ key: "hauteur", value: 10.5, source: "document_extraction" }],
      }),
      rules,
    );
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]!.rule_id).toBe("specifique");
    expect(run.findings[0]!.status).toBe("conforme");
    expect(run.summary.superseded_rule_ids).toEqual(["general"]);
  });

  it("does NOT evaluate a rule that was excluded by applicability", () => {
    const rules = [
      rule({ rule_id: "wrong_zone", zone_code: "UB", value_max: 9 }),
      rule({ rule_id: "right_zone", zone_code: "UA", value_max: 9 }),
    ];
    const run = runEvaluation(
      ctx({ zonage: ["UA"], facts: [{ key: "hauteur", value: 7, source: "document_extraction" }] }),
      rules,
    );
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]!.rule_id).toBe("right_zone");
    expect(run.summary.applicable_rules_count).toBe(1);
    expect(run.summary.excluded_rules_count).toBe(1);
  });

  it("propagates applicability warnings into summary", () => {
    const rules = [rule({ rule_id: "r1", value_max: 9 })];
    const run = runEvaluation(
      ctx({ zonage: [], facts: [{ key: "hauteur", value: 7, source: "document_extraction" }] }),
      rules,
    );
    expect(run.summary.warnings.join(" ")).toMatch(/zone plu non résolue/i);
  });

  it("counts findings by severity correctly", () => {
    const rules = [
      rule({ rule_id: "r_block", value_max: 9 }),
      rule({ rule_id: "r_missing", sub_theme: "egout", value_max: 6 }),
    ];
    const run = runEvaluation(
      ctx({ facts: [{ key: "hauteur", value: 11, source: "document_extraction" }] }),
      rules,
    );
    // r_block: non_conforme bloquant. r_missing: same fact, also non_conforme
    // bloquant — both rules apply (different sub_theme so resolveSpecificity
    // keeps them separate).
    expect(run.summary.counts_by_severity.bloquant).toBe(2);
    expect(run.findings.every((f) => f.status === "non_conforme")).toBe(true);
  });

  it("returns a stable supported_topics list for the UI", () => {
    const run = runEvaluation(ctx({}), []);
    expect(run.summary.supported_topics).toContain("hauteur");
  });
});
