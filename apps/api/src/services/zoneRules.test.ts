import { describe, it, expect } from "vitest";
import {
  deriveParentZoneCode,
  walkZoneAncestry,
  mergeRulesDeepestWins,
  stripSiblingSecteurMentions,
  applyParcelSecteurContext,
} from "./zoneRules.js";

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

describe("stripSiblingSecteurMentions", () => {
  it("removes explicit « En <sibling> : value » declarations", () => {
    const text = "Hauteur max : 9 m. Toutefois, en UBa : 12 m ; en UBai : 7 m.";
    const cleaned = stripSiblingSecteurMentions(text, ["UBb", "UB"]);
    expect(cleaned).toBe("Hauteur max : 9 m.");
  });

  it("keeps the generic value when a sibling appears inline (no info loss)", () => {
    // « 9 m sauf UBa 12 m » → the 9 m applies to UBb, must NOT be dropped.
    const text = "9 m sauf UBa 12 m.";
    const cleaned = stripSiblingSecteurMentions(text, ["UBb", "UB"]);
    expect(cleaned).toBe(text);
  });

  it("keeps a sentence mentioning a sibling mid-clause with real info", () => {
    const text = "La règle UB s'applique, hormis UBa qui dispose d'une variante.";
    const cleaned = stripSiblingSecteurMentions(text, ["UBb", "UB"]);
    expect(cleaned).toBe(text);
  });

  it("keeps sentences mentioning the parcel's own sector", () => {
    const text = "En UBb la hauteur est de 12 m. En UBa : 9 m.";
    const cleaned = stripSiblingSecteurMentions(text, ["UBb", "UB"]);
    expect(cleaned).toBe("En UBb la hauteur est de 12 m.");
  });

  it("returns the original text when nothing was filtered", () => {
    const text = "Hauteur maximale : 9 mètres.";
    expect(stripSiblingSecteurMentions(text, ["UBb", "UB"])).toBe(text);
  });

  it("returns null for null / empty input", () => {
    expect(stripSiblingSecteurMentions(null, ["UBb", "UB"])).toBeNull();
    expect(stripSiblingSecteurMentions("", ["UBb", "UB"])).toBeNull();
  });

  it("does NOT filter when parent is a single letter (would over-match words)", () => {
    const text = "Une construction en zone A est autorisée. En Ap : interdit.";
    // parent "A" length < 2 → no scrubbing at all
    expect(stripSiblingSecteurMentions(text, ["A"])).toBe(text);
  });

  it("handles multi-letter parents like 1AU", () => {
    const text = "En 1AU : 9 m. En 1AUh : 12 m. En 1AUe : 7 m.";
    const cleaned = stripSiblingSecteurMentions(text, ["1AUh", "1AU"]);
    expect(cleaned).toBe("En 1AU : 9 m. En 1AUh : 12 m.");
  });

  it("drops all when every sentence is sibling-only (returns null)", () => {
    const text = "En UBa : 9 m. En UBai : 7 m.";
    expect(stripSiblingSecteurMentions(text, ["UBb", "UB"])).toBeNull();
  });

  it("recognises bullet-prefixed sibling declarations", () => {
    const text = "- En UBa : 12 m\n- En UBb : 10 m\n- En UBai : 7 m";
    const cleaned = stripSiblingSecteurMentions(text, ["UBb", "UB"]);
    expect(cleaned).toBe("- En UBb : 10 m");
  });

  it("recognises « Dans le secteur X » lead-in", () => {
    const text = "Dans le secteur UBa, la hauteur est de 12 m.";
    expect(stripSiblingSecteurMentions(text, ["UBb", "UB"])).toBeNull();
  });

  it("does NOT drop a long descriptive sentence mentioning a sibling mid-text", () => {
    const text = "La hauteur autorisée est de 9 m sur l'ensemble de la zone UB, exception faite des constructions en UBa où elle peut atteindre 12 m sous conditions.";
    // Mid-text mention, not a leading declaration → conservative: keep
    expect(stripSiblingSecteurMentions(text, ["UBb", "UB"])).toBe(text);
  });
});

describe("applyParcelSecteurContext", () => {
  it("scrubs ONLY citizen-facing fields, never the technical ones", () => {
    const rule = {
      conditions: "UBa: 12m ; UBb: 10m",
      exceptions: "Sauf en UBai : 7m",
      citizen_summary: "Votre maison doit faire 9 m. En UBa : 12 m.",
      citizen_title: "Hauteur",
      summary: "9 m max. En UBa : 12 m. En UBb : 10 m.",
    };
    const out = applyParcelSecteurContext(rule, ["UBb", "UB"]);
    // Technical fields preserved intact for the instructeur
    expect(out.conditions).toBe("UBa: 12m ; UBb: 10m");
    expect(out.exceptions).toBe("Sauf en UBai : 7m");
    expect(out.summary).toBe("9 m max. En UBa : 12 m. En UBb : 10 m.");
    // Citizen fields cleaned
    expect(out.citizen_summary).toBe("Votre maison doit faire 9 m.");
    expect(out.citizen_title).toBe("Hauteur");
  });

  it("returns the rule unchanged when nothing matches the strict pattern", () => {
    const rule = { citizen_summary: "La hauteur max est de 9 m.", citizen_title: "Hauteur" };
    const out = applyParcelSecteurContext(rule, ["UBb", "UB"]);
    expect(out).toEqual({ citizen_summary: "La hauteur max est de 9 m.", citizen_title: "Hauteur" });
  });
});
