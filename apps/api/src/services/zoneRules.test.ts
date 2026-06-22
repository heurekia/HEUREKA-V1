import { describe, it, expect } from "vitest";
import {
  deriveParentZoneCode,
  walkZoneAncestry,
  mergeRulesDeepestWins,
  stripSiblingSecteurMentions,
  applyParcelSecteurContext,
  isRuleSiblingOnly,
  pickMostSpecificRule,
  resolveDossierZoneCode,
} from "./zoneRules.js";

describe("resolveDossierZoneCode", () => {
  it("privilégie la zone géolocalisée de parcel_analysis", () => {
    const meta = {
      zone: "UB", // snapshot dépôt (obsolète)
      parcel_analysis: { plu_zone: { zone_code: "UD" } },
    };
    expect(resolveDossierZoneCode(meta)).toBe("UD");
  });

  it("retombe sur db_zone.code quand plu_zone est absente", () => {
    const meta = { parcel_analysis: { db_zone: { code: "UDa" } } };
    expect(resolveDossierZoneCode(meta)).toBe("UDa");
  });

  it("retombe sur metadata.zone sans analyse parcellaire", () => {
    expect(resolveDossierZoneCode({ zone: "UC" })).toBe("UC");
  });

  it("retombe sur l'ancienne clé zone_plu en dernier recours", () => {
    expect(resolveDossierZoneCode({ zone_plu: "A" })).toBe("A");
  });

  it("renvoie null quand rien n'est résolu", () => {
    expect(resolveDossierZoneCode({})).toBeNull();
    expect(resolveDossierZoneCode({ zone: "  " })).toBeNull();
  });
});

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

describe("isRuleSiblingOnly", () => {
  it("drops a rule whose title mentions only a sibling sector", () => {
    const rule = { citizen_title: "Espaces verts obligatoires (UBa)", sub_theme: null };
    expect(isRuleSiblingOnly(rule, ["UBb", "UB"])).toBe(true);
  });

  it("keeps a rule mentioning the parent zone explicitly (UB/UBd)", () => {
    const rule = { citizen_title: "Espaces verts obligatoires (UB/UBd)", sub_theme: null };
    expect(isRuleSiblingOnly(rule, ["UBb", "UB"])).toBe(false);
  });

  it("keeps a rule mentioning the parcel's own sector (UBb/UBc)", () => {
    const rule = { citizen_title: "Espaces verts obligatoires (UBb/UBc)", sub_theme: null };
    expect(isRuleSiblingOnly(rule, ["UBb", "UB"])).toBe(false);
  });

  it("keeps a fully generic rule (no sector mention)", () => {
    const rule = { citizen_title: "Hauteur des constructions", sub_theme: "10.1" };
    expect(isRuleSiblingOnly(rule, ["UBb", "UB"])).toBe(false);
  });

  it("inspects sub_theme as well as citizen_title", () => {
    const rule = { citizen_title: null, sub_theme: "13.2 UBai uniquement" };
    expect(isRuleSiblingOnly(rule, ["UBb", "UB"])).toBe(true);
  });

  it("does not act when parent is a single letter (safety)", () => {
    const rule = { citizen_title: "Truc (Ap)", sub_theme: null };
    expect(isRuleSiblingOnly(rule, ["A"])).toBe(false);
  });
});

describe("pickMostSpecificRule", () => {
  const r = (topic: string, citizen_title: string, value_min: number | null) =>
    ({ topic, citizen_title, sub_theme: null, value_min });

  it("returns the rule mentioning the deepest ancestor code", () => {
    const rules = [
      r("espaces_verts", "Espaces verts (UB/UBd)", 30),
      r("espaces_verts", "Espaces verts (UBb/UBc)", 60),
      r("hauteur", "Hauteur (UB)", 9),
    ];
    const pick = pickMostSpecificRule(rules, "espaces_verts", ["UBb", "UB"]);
    expect(pick?.value_min).toBe(60);
  });

  it("falls back to the parent rule when no specific match exists", () => {
    const rules = [r("espaces_verts", "Espaces verts (UB)", 30)];
    const pick = pickMostSpecificRule(rules, "espaces_verts", ["UBb", "UB"]);
    expect(pick?.value_min).toBe(30);
  });

  it("falls back to the first candidate when neither ancestry mentions match", () => {
    const rules = [
      r("espaces_verts", "Espaces verts généraux", 30),
      r("espaces_verts", "Espaces verts complément", 50),
    ];
    const pick = pickMostSpecificRule(rules, "espaces_verts", ["UBb", "UB"]);
    expect(pick?.value_min).toBe(30);
  });

  it("returns null when no rule matches the topic", () => {
    expect(pickMostSpecificRule([r("hauteur", "x", 9)], "espaces_verts", ["UB"])).toBeNull();
  });

  it("picks the rule whose RULE_TEXT mentions the deepest ancestor (generic title)", () => {
    // Real-world Ballan-Miré case : the « 8 m UBa/UBb/UBc » rule was ingested
    // with a generic citizen_title but its body explicitly names the secteurs.
    const rules = [
      {
        topic: "hauteur", citizen_title: "Hauteur des constructions",
        sub_theme: "10.1", rule_text: "Hauteur maximale : 12 m en zone UB.",
        value_max: 12,
      },
      {
        topic: "hauteur", citizen_title: "Hauteur des constructions",
        sub_theme: "10.2",
        rule_text: "Dans les secteurs UBa, UBb, UBc : la hauteur est de R+1 ou R+combles maximum, dans la limite de 8 m.",
        value_max: 8,
      },
    ];
    const pick = pickMostSpecificRule(rules, "hauteur", ["UBb", "UB"]);
    expect(pick?.value_max).toBe(8);
  });

  it("isRuleSiblingOnly drops a rule whose rule_text mentions only siblings", () => {
    const rule = {
      citizen_title: "Hauteur des constructions",
      sub_theme: "10.3",
      rule_text: "Dans les secteurs UBai, UBd : la hauteur est limitée à 7 m.",
    };
    expect(isRuleSiblingOnly(rule, ["UBb", "UB"])).toBe(true);
  });

  it("isRuleSiblingOnly keeps a rule whose rule_text mentions UBb among siblings", () => {
    const rule = {
      citizen_title: "Hauteur",
      sub_theme: null,
      rule_text: "Dans les secteurs UBa, UBb, UBc : limite à 8 m.",
    };
    expect(isRuleSiblingOnly(rule, ["UBb", "UB"])).toBe(false);
  });

  it("isRuleSiblingOnly keeps EVERY sub-sector rule when no sub-sector is identified", () => {
    // Real case Ballan-Miré : GPU returns just « UB » for the parcel, no sub-
    // sector. We must not drop the sub-sector variant rules — they're the only
    // way for the citizen to know which limit applies to their precise location.
    const ruleUBa = { citizen_title: "Hauteur (UBa)", sub_theme: null, rule_text: "Dans le secteur UBa : 12 m." };
    const ruleUBaUBbUBc = { citizen_title: "Hauteur", sub_theme: "10.4", rule_text: "Dans les secteurs UBa, UBb, UBc : 8 m." };
    const ruleUBd = { citizen_title: "Hauteur (UBd)", sub_theme: null, rule_text: "Dans le secteur UBd : 7 m." };
    expect(isRuleSiblingOnly(ruleUBa, ["UB"])).toBe(false);
    expect(isRuleSiblingOnly(ruleUBaUBbUBc, ["UB"])).toBe(false);
    expect(isRuleSiblingOnly(ruleUBd, ["UB"])).toBe(false);
  });

  it("stripSiblingSecteurMentions keeps everything when no sub-sector context", () => {
    const text = "Hauteur : 12 m en UB. En UBa : 12 m. En UBb : 8 m.";
    expect(stripSiblingSecteurMentions(text, ["UB"])).toBe(text);
  });
});

// ── Scénario « gold » : parcelle en UBb ────────────────────────────────────────
// Verrouille la composition réelle de loadZoneRulesWithInheritance (sans DB) :
// une parcelle UBb hérite des règles UB, les surcharge avec ses propres règles,
// et ne voit PAS les règles propres aux secteurs frères (UBa…).
describe("héritage de secteur — parcelle UBb (gold)", () => {
  // Règles telles qu'elles existeraient en base, regroupées par zone.
  type GoldRule = {
    article_number: number; topic: string; sub_theme: string | null;
    value_max: number | null; rule_text: string;
    citizen_title: string; citizen_summary: string | null; summary: string | null;
  };
  const ubb: GoldRule[] = [
    { article_number: 10, topic: "hauteur", sub_theme: null, value_max: 9, rule_text: "Hauteur maximale : 9 m au faîtage.", citizen_title: "Hauteur des maisons", citizen_summary: null, summary: null },
  ];
  const ub: GoldRule[] = [
    { article_number: 10, topic: "hauteur", sub_theme: null, value_max: 12, rule_text: "Hauteur maximale : 12 m au faîtage.", citizen_title: "Hauteur des maisons", citizen_summary: null, summary: null },
    { article_number: 9, topic: "emprise_sol", sub_theme: null, value_max: 50, rule_text: "Emprise au sol maximale : 50 %.", citizen_title: "Emprise au sol", citizen_summary: null, summary: null },
  ];
  const uba: GoldRule[] = [
    { article_number: 11, topic: "aspect", sub_theme: null, value_max: null, rule_text: "Dans le secteur UBa, les clôtures sur rue sont limitées à 1,20 m.", citizen_title: "Clôtures (UBa)", citizen_summary: null, summary: null },
  ];

  // Reproduit l'ordonnancement de loadZoneRulesWithInheritance : ascendance la
  // plus profonde d'abord (UBb, UB), puis les frères (UBa).
  const ancestry = walkZoneAncestry("UBb");
  const ancestryCodes = ancestry; // UBb et UB présents en base
  const merged = mergeRulesDeepestWins([ubb, ub, uba]);
  const relevant = merged.filter((r) => !isRuleSiblingOnly(r, ancestryCodes));

  it("résout l'ascendance UBb → UB (du plus précis au plus général)", () => {
    expect(ancestry).toEqual(["UBb", "UB"]);
  });

  it("surcharge : la hauteur UBb (9 m) l'emporte sur celle de UB (12 m)", () => {
    expect(relevant.find((r) => r.article_number === 10)?.value_max).toBe(9);
  });

  it("héritage : l'emprise non redéfinie en UBb est reprise de UB (50 %)", () => {
    expect(relevant.find((r) => r.article_number === 9)?.value_max).toBe(50);
  });

  it("isolation : la règle propre au secteur frère UBa est écartée", () => {
    // Détectée comme « propre à un frère »…
    expect(isRuleSiblingOnly(uba[0]!, ancestryCodes)).toBe(true);
    // …donc absente de la vue finale de la parcelle UBb.
    expect(relevant.some((r) => r.topic === "aspect")).toBe(false);
  });

  it("vue finale UBb = exactement {hauteur 9 m, emprise 50 %}", () => {
    expect(relevant).toHaveLength(2);
    expect(relevant.map((r) => r.article_number).sort((a, b) => a - b)).toEqual([9, 10]);
  });

  it("nettoyage citoyen : une mention de secteur frère est retirée du texte citoyen", () => {
    const ruleUB = { citizen_summary: "Hauteur 12 m. En UBa : 15 m.", citizen_title: "Hauteur des maisons" };
    const scrubbed = applyParcelSecteurContext(ruleUB, ancestryCodes);
    expect(scrubbed.citizen_summary).not.toMatch(/UBa/);
  });
});
