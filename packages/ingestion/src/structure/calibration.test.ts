import { describe, it, expect } from "vitest";
import { CALIBRATION_RULES, calibrationFewShot, CALIBRATION_INPUT_TEXT } from "./calibration.ts";
import { structuredRuleSchema, RULE_TOPICS } from "./structurer.ts";
import { CanonicalPLUSchema, KNOWN_APPLIES_IF, parseCanonical } from "../canonical/schema.ts";

const ALLOWED_UNITS = new Set(["m", "cm", "%", "m²", "places"]);

describe("exemple de calibration — conformité aux schémas réels", () => {
  it("chaque règle passe le schéma du structurer (parser de production)", () => {
    for (const r of CALIBRATION_RULES) {
      const parsed = structuredRuleSchema.safeParse(r);
      expect(parsed.success, `règle ${r.sub_theme} : ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it("l'exemple complet est un PLU canonique valide (parseCanonical ok, sans erreur)", () => {
    const doc = {
      schema_version: 1 as const,
      _meta: { commune: "Ballan-Miré", insee: "37018", doc_version: "M5_20180129" },
      zones: [
        {
          code: "UC",
          label: "Zone urbaine pavillonnaire",
          type: "U" as const,
          rules: CALIBRATION_RULES,
        },
      ],
    };
    // Valide d'abord via le schéma, puis via l'entrée d'import réelle.
    expect(CanonicalPLUSchema.safeParse(doc).success).toBe(true);
    const res = parseCanonical(doc);
    expect(res.ok).toBe(true);
    expect(res.errors ?? []).toEqual([]);
  });

  it("respecte le vocabulaire fermé (topics, unités, applies_if, cases)", () => {
    for (const r of CALIBRATION_RULES) {
      expect(RULE_TOPICS).toContain(r.topic);
      if (r.unit !== null) expect(ALLOWED_UNITS.has(r.unit), `unité ${r.unit}`).toBe(true);
      for (const t of r.applies_if) expect(KNOWN_APPLIES_IF).toContain(t);
      for (const c of r.cases) {
        // Un "case" sans valeur chiffrée serait filtré par le parser → l'exemple
        // ne doit en contenir aucun.
        expect(c.value, `case « ${c.condition} » sans valeur`).not.toBeNull();
        expect(["condition", "parametre"]).toContain(c.kind);
        if (c.unit !== null) expect(ALLOWED_UNITS.has(c.unit)).toBe(true);
      }
      // Sémantique min/max non contradictoire.
      if (r.value_min != null && r.value_max != null) expect(r.value_min).toBeLessThanOrEqual(r.value_max);
      expect(r.citizen_title.trim().length).toBeGreaterThan(0);
      expect(r.citizen_summary.trim().length).toBeGreaterThan(0);
    }
  });

  it("couvre tous les patterns durs (sinon l'exemple n'apprend pas assez)", () => {
    const cases = CALIBRATION_RULES.flatMap((r) => r.cases);
    expect(cases.some((c) => c.kind === "condition")).toBe(true);   // alternative exclusive (6,5 / 9 m)
    expect(cases.some((c) => c.kind === "parametre")).toBe(true);   // cumulatif (1 arbre / 100 m²)
    expect(CALIBRATION_RULES.some((r) => r.value_min != null)).toBe(true);
    expect(CALIBRATION_RULES.some((r) => r.value_max != null)).toBe(true);
    expect(CALIBRATION_RULES.some((r) => r.value_exact != null)).toBe(true);
    expect(CALIBRATION_RULES.some((r) => r.exceptions)).toBe(true);
    expect(CALIBRATION_RULES.some((r) => r.applies_if.includes("inondable"))).toBe(true);
  });
});

describe("calibrationFewShot()", () => {
  it("contient le marqueur, l'entrée, et un JSON de sortie ré-analysable", () => {
    const block = calibrationFewShot();
    expect(block).toContain("EXEMPLE DE RÉFÉRENCE");
    expect(block).toContain(CALIBRATION_INPUT_TEXT);
    // La consigne anti-recopie est cruciale : sans elle, le modèle pourrait
    // injecter les valeurs de Ballan-Miré dans d'autres communes.
    expect(block).toMatch(/NE RECOPIE PAS/i);
    const jsonMatch = block.match(/\[[\s\S]*\]/);
    expect(jsonMatch).not.toBeNull();
    const reparsed = JSON.parse(jsonMatch![0]);
    expect(Array.isArray(reparsed)).toBe(true);
    expect(reparsed).toHaveLength(CALIBRATION_RULES.length);
  });
});
