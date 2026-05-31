import { describe, it, expect } from "vitest";
import { deriveParentZoneCode, walkZoneAncestry, mergeRulesDeepestWins } from "./zoneRules.js";

describe("deriveParentZoneCode", () => {
  it("strips a trailing lowercase suffix", () => {
    expect(deriveParentZoneCode("UBai")).toBe("UBa");
    expect(deriveParentZoneCode("UBa")).toBe("UB");
    expect(deriveParentZoneCode("1AUh")).toBe("1AU");
    expect(deriveParentZoneCode("Ap")).toBe("A");
  });

  it("returns null for top-level codes", () => {
    expect(deriveParentZoneCode("UB")).toBeNull();
    expect(deriveParentZoneCode("UA")).toBeNull();
    expect(deriveParentZoneCode("N")).toBeNull();
    expect(deriveParentZoneCode("1AU")).toBeNull();
  });

  it("returns null on short codes", () => {
    expect(deriveParentZoneCode("A")).toBeNull();
    expect(deriveParentZoneCode("")).toBeNull();
  });
});

describe("walkZoneAncestry", () => {
  it("walks down to the top-level zone", () => {
    expect(walkZoneAncestry("UBai")).toEqual(["UBai", "UBa", "UB"]);
    expect(walkZoneAncestry("UBa")).toEqual(["UBa", "UB"]);
    expect(walkZoneAncestry("UB")).toEqual(["UB"]);
  });

  it("handles à-urbaniser codes", () => {
    expect(walkZoneAncestry("1AUh")).toEqual(["1AUh", "1AU"]);
  });

  it("never produces an empty chain", () => {
    expect(walkZoneAncestry("A")).toEqual(["A"]);
  });
});

describe("mergeRulesDeepestWins", () => {
  it("keeps the deepest rule when keys collide", () => {
    // Deepest first : UBai overrides UB on the same article + topic.
    const deepest = [
      { article_number: 9, topic: "emprise_sol", sub_theme: null, value_max: 40 },
    ];
    const parent = [
      { article_number: 9, topic: "emprise_sol", sub_theme: null, value_max: 60 },
      { article_number: 10, topic: "hauteur", sub_theme: null, value_max: 9 },
    ];
    const merged = mergeRulesDeepestWins([deepest, parent]);
    // Article 9 → UBai's 40 % wins ; article 10 → inherited from UB
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.article_number === 9)?.value_max).toBe(40);
    expect(merged.find((r) => r.article_number === 10)?.value_max).toBe(9);
  });

  it("differentiates rules by sub_theme", () => {
    const a = [{ article_number: 11, topic: "aspect", sub_theme: "toiture" }];
    const b = [
      { article_number: 11, topic: "aspect", sub_theme: "toiture" },
      { article_number: 11, topic: "aspect", sub_theme: "facade" },
    ];
    const merged = mergeRulesDeepestWins([a, b]);
    // Same article+topic+sub_theme → deduped ; different sub_theme → kept
    expect(merged).toHaveLength(2);
  });

  it("returns an empty array when no rules", () => {
    expect(mergeRulesDeepestWins([])).toEqual([]);
    expect(mergeRulesDeepestWins([[], []])).toEqual([]);
  });

  it("handles rules without article_number (treated as 'general')", () => {
    const a = [{ article_number: null, topic: "destinations", sub_theme: null, summary: "spec" }];
    const b = [{ article_number: null, topic: "destinations", sub_theme: null, summary: "general" }];
    const merged = mergeRulesDeepestWins([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.summary).toBe("spec");
  });
});
