import { describe, it, expect } from "vitest";
import { classifyHeightRule, scanHeightRules, flattenRules, type ScannableRule } from "./scan-heights.ts";

const h = (rule_text: string, extra: Partial<ScannableRule> = {}): ScannableRule => ({
  topic: "hauteur",
  rule_text,
  value_max: 9,
  unit: "m",
  ...extra,
});

describe("classifyHeightRule", () => {
  it("relative_guarded : formulation relative captée par le garde-fou", () => {
    // value_max null car le garde-fou niveau 1 l'a déjà neutralisé.
    const c = classifyHeightRule(
      h("Le faîtage ne peut dépasser de plus de 4 mètres la hauteur de la construction autorisée.", { value_max: null }),
    );
    expect(c.category).toBe("relative_guarded");
  });

  it("relative_suspect : relatif NON couvert avec un seuil chiffré encore présent", () => {
    expect(classifyHeightRule(h("Hauteur appréciée par rapport à la construction voisine, max 9 m.")).category).toBe(
      "relative_suspect",
    );
    expect(classifyHeightRule(h("La hauteur est mesurée au-dessus du sol, 12 m max.")).category).toBe(
      "relative_suspect",
    );
  });

  it("ne signale pas relative_suspect si aucun seuil chiffré n'est en jeu", () => {
    const c = classifyHeightRule(
      h("Hauteur appréciée par rapport à la construction voisine.", { value_max: null, value_min: null, value_exact: null }),
    );
    expect(c.category).not.toBe("relative_suspect");
  });

  it("egout_faitage_conflation : égout ET faîtage cités ensemble", () => {
    expect(classifyHeightRule(h("Hauteur maximale : 9 m à l'égout et 12 m au faîtage.")).category).toBe(
      "egout_faitage_conflation",
    );
  });

  it("ngf : cote altimétrique", () => {
    expect(classifyHeightRule(h("La cote de faîtage ne dépasse pas 35 NGF.")).category).toBe("ngf");
    expect(classifyHeightRule(h("Hauteur plafonnée.", { unit: "NGF" })).category).toBe("ngf");
  });

  it("terrain_naturel : compté depuis un point de référence", () => {
    expect(classifyHeightRule(h("Hauteur mesurée depuis le terrain naturel, 9 m.")).category).toBe("terrain_naturel");
    expect(classifyHeightRule(h("9 m au point le plus bas du sol.")).category).toBe("terrain_naturel");
  });

  it("absolute_ok : plafond absolu simple", () => {
    expect(classifyHeightRule(h("La hauteur maximale des constructions est de 9 m à l'égout du toit.")).category).toBe(
      "absolute_ok",
    );
  });
});

describe("scanHeightRules", () => {
  it("agrège les compteurs et n'examine que le topic hauteur", () => {
    const rules: ScannableRule[] = [
      h("Le faîtage ne peut dépasser de plus de 4 m la hauteur autorisée.", { value_max: null }),
      h("Hauteur par rapport à la construction voisine, 9 m."),
      h("9 m à l'égout et 12 m au faîtage."),
      h("Hauteur maximale 9 m."),
      { topic: "recul_limite", rule_text: "H/2 min 3 m.", value_min: 3, unit: "m" }, // ignoré
    ];
    const report = scanHeightRules(rules);
    expect(report.total_rules).toBe(5);
    expect(report.height_rules).toBe(4);
    expect(report.counts.relative_guarded).toBe(1);
    expect(report.counts.relative_suspect).toBe(1);
    expect(report.counts.egout_faitage_conflation).toBe(1);
    expect(report.counts.absolute_ok).toBe(1);
  });
});

describe("flattenRules", () => {
  it("aplatit le format PLU canonique (zones[].rules[])", () => {
    const canonical = { zones: [{ rules: [h("a"), h("b")] }, { rules: [h("c")] }] };
    expect(flattenRules(canonical)).toHaveLength(3);
  });

  it("aplatit un ZoneRules[] et un dump de règles plat", () => {
    expect(flattenRules([{ rules: [h("a")] }, { rules: [h("b")] }])).toHaveLength(2);
    expect(flattenRules([h("a"), h("b"), h("c")])).toHaveLength(3);
  });
});
