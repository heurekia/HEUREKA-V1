import { describe, it, expect } from "vitest";
import { diffZones, diffArticles, evaluatePass, scores, validateGoldenShape } from "./compare.ts";
import type { Segment } from "../adapters/interface.ts";

function seg(code: string, type: "zone" | "article", parent: string | null = null): Segment {
  return {
    id: `x_${code}`,
    insee: "37000",
    commune_name: "X",
    doc_type: "PLU_REGLEMENT",
    doc_subtype: "reglement_litteral",
    doc_version: "v1",
    doc_source_file: "f.pdf",
    segment_code: code,
    segment_type: type,
    parent_code: parent,
    title: "",
    raw_text: "",
    char_count: 0,
    subsections: [],
    overrides: [],
    cross_refs: [],
    embedding_text: "",
    metadata: {},
  };
}

describe("scores()", () => {
  it("retourne précision=rappel=1 quand tout est vide (vacuously perfect)", () => {
    expect(scores(0, 0, 0)).toMatchObject({ precision: 1, recall: 1, f1: 1 });
  });
  it("calcule F1 standard", () => {
    const s = scores(8, 2, 2);
    expect(s.precision).toBeCloseTo(0.8);
    expect(s.recall).toBeCloseTo(0.8);
    expect(s.f1).toBeCloseTo(0.8);
  });
});

describe("diffZones()", () => {
  it("détecte zones trouvées, manquantes et superflues", () => {
    const segments = [seg("UA", "zone"), seg("UB", "zone"), seg("ZZ", "zone")];
    const diff = diffZones(segments, ["UA", "UB", "UC"]);
    expect(diff.missing).toEqual(["UC"]);
    expect(diff.spurious).toEqual(["ZZ"]);
    expect(diff.scores.tp).toBe(2);
    expect(diff.scores.fp).toBe(1);
    expect(diff.scores.fn).toBe(1);
  });

  it("score parfait quand tout matche", () => {
    const segments = [seg("UA", "zone"), seg("UB", "zone")];
    const diff = diffZones(segments, ["UA", "UB"]);
    expect(diff.scores.f1).toBe(1);
    expect(diff.missing).toEqual([]);
    expect(diff.spurious).toEqual([]);
  });
});

describe("diffArticles()", () => {
  it("groupe les articles par zone et compare", () => {
    const segments = [
      seg("UA", "zone"),
      seg("UA_ART_6", "article", "UA"),
      seg("UA_ART_7", "article", "UA"),
      seg("UA_ART_11", "article", "UA"),
    ];
    const diffs = diffArticles(segments, { UA: [6, 7, 10, 11] });
    expect(diffs).toHaveLength(1);
    const ua = diffs[0]!;
    expect(ua.missing).toEqual([10]);
    expect(ua.spurious).toEqual([]);
    expect(ua.scores.tp).toBe(3);
  });
});

describe("evaluatePass()", () => {
  it("passed=true quand zones parfaites et pas de seuils", () => {
    const zones = diffZones([seg("UA", "zone")], ["UA"]);
    const { passed, reasons } = evaluatePass(zones, [], undefined);
    expect(passed).toBe(true);
    expect(reasons).toEqual([]);
  });

  it("échoue sur F1 zones sous seuil sans toucher aux tolérances de comptage", () => {
    const zones = diffZones([seg("UA", "zone")], ["UA", "UB"]);
    const { passed, reasons } = evaluatePass(zones, [], {
      missing_zones_allowed: 5,
      min_zone_f1: 0.9,
    });
    expect(passed).toBe(false);
    expect(reasons.some((r) => /F1 zones/.test(r))).toBe(true);
  });

  it("autorise une zone manquante via tolerance", () => {
    const zones = diffZones([seg("UA", "zone")], ["UA", "UB"]);
    const { passed } = evaluatePass(zones, [], { missing_zones_allowed: 1 });
    expect(passed).toBe(true);
  });
});

describe("validateGoldenShape()", () => {
  it("signale l'absence de zones", () => {
    const issues = validateGoldenShape({ zones: [] });
    expect(issues.length).toBeGreaterThan(0);
  });
  it("signale une zone incohérente entre articles_per_zone et zones", () => {
    const issues = validateGoldenShape({
      zones: ["UA"],
      articles_per_zone: { UB: [1, 2] },
    });
    expect(issues.some((i) => i.includes("UB"))).toBe(true);
  });
});
