import { describe, it, expect } from "vitest";
import { PLU_SAVE_RULE_TOOL, PLU_EXTRACTION_CALIBRATION, coerceCases, coerceAppliesIf } from "./pluSaveRuleTool.ts";
import { KNOWN_TOPICS, KNOWN_APPLIES_IF } from "@heureka-v1/ingestion/canonical";

const props = PLU_SAVE_RULE_TOOL.function.parameters.properties as Record<string, any>;

describe("PLU_SAVE_RULE_TOOL — alignement sur le format canonique", () => {
  it("expose les champs fins requis pour la calibration (cases, applies_if, sub_theme, exceptions)", () => {
    expect(props.cases?.type).toBe("array");
    expect(props.cases?.items?.properties?.kind?.enum).toEqual(["condition", "parametre"]);
    expect(props.applies_if?.type).toBe("array");
    expect(props.sub_theme?.type).toBe("string");
    expect(props.exceptions?.type).toBe("string");
  });

  it("partage exactement le vocabulaire topic / applies_if du format canonique", () => {
    // Le PDF complet doit pouvoir produire les MÊMES topics que le collage
    // d'article (interdictions, conditions, desserte_*…), sinon art. 1/2/3/4
    // retombent en « general ».
    expect(props.topic.enum).toEqual([...KNOWN_TOPICS]);
    expect(props.applies_if.items.enum).toEqual([...KNOWN_APPLIES_IF]);
    expect(props.topic.enum).toContain("interdictions");
    expect(props.topic.enum).toContain("conditions");
  });
});

describe("coerceCases", () => {
  it("jette les cas sans valeur chiffrée et normalise kind", () => {
    const out = coerceCases([
      { condition: "à l'égout", value: 6.5, unit: "m", kind: "condition" },
      { condition: "liste qualitative", value: null, unit: null, kind: "x" }, // jeté (pas de valeur)
      { condition: "", value: 3, unit: "m", kind: "parametre" },              // jeté (pas de libellé)
      { condition: "au-delà", value: 1, unit: null, kind: "weird" },          // kind inconnu → parametre
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ condition: "à l'égout", value: 6.5, unit: "m", kind: "condition" });
    expect(out[1]!.kind).toBe("parametre");
  });
  it("renvoie [] sur entrée non-tableau", () => {
    expect(coerceCases(undefined)).toEqual([]);
    expect(coerceCases("nope")).toEqual([]);
  });
});

describe("coerceAppliesIf", () => {
  it("ne garde que les tags connus", () => {
    expect(coerceAppliesIf(["inondable", "abf", "inventé", 42])).toEqual(["inondable", "abf"]);
    expect(coerceAppliesIf(null)).toEqual([]);
  });
});

describe("PLU_EXTRACTION_CALIBRATION", () => {
  it("contient l'exemple de calibration et la consigne anti-recopie", () => {
    expect(PLU_EXTRACTION_CALIBRATION).toContain("EXEMPLE DE RÉFÉRENCE");
    expect(PLU_EXTRACTION_CALIBRATION).toMatch(/NE RECOPIE PAS/i);
    expect(PLU_EXTRACTION_CALIBRATION).toContain("save_rule");
  });
});
