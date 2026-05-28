import { describe, it, expect } from "vitest";
import { calculateBuildability, type BuildabilityInput } from "./buildability.js";

const noRules: BuildabilityInput["calculationVariables"] = {
  maxFootprintRatio: null,
  maxHeightM: null,
  minSetbackFromRoadM: null,
  minSetbackFromBoundariesM: null,
  parkingRules: null,
  greenSpaceRatio: null,
};

describe("calculateBuildability", () => {
  it("emprise au sol = ratio × surface parcelle", () => {
    const r = calculateBuildability({
      parcelSurfaceM2: 1000,
      existingFootprintM2: 0,
      calculationVariables: { ...noRules, maxFootprintRatio: 0.4 },
    });
    expect(r.maxFootprintM2).toBe(400);
    expect(r.remainingFootprintM2).toBe(400);
  });

  it("accepte un ratio exprimé en pourcentage (> 1) et le normalise", () => {
    const r = calculateBuildability({
      parcelSurfaceM2: 1000,
      existingFootprintM2: 0,
      calculationVariables: { ...noRules, maxFootprintRatio: 40 },
    });
    expect(r.maxFootprintM2).toBe(400);
  });

  it("déduit l'existant de la surface restante", () => {
    const r = calculateBuildability({
      parcelSurfaceM2: 1000,
      existingFootprintM2: 150,
      calculationVariables: { ...noRules, maxFootprintRatio: 0.4 },
    });
    expect(r.remainingFootprintM2).toBe(250);
  });

  it("ne renvoie jamais une surface restante négative", () => {
    const r = calculateBuildability({
      parcelSurfaceM2: 1000,
      existingFootprintM2: 800,
      calculationVariables: { ...noRules, maxFootprintRatio: 0.4 },
    });
    expect(r.remainingFootprintM2).toBe(0);
  });

  it("réserve la part d'espaces verts sur l'emprise constructible", () => {
    const r = calculateBuildability({
      parcelSurfaceM2: 1000,
      existingFootprintM2: 0,
      calculationVariables: { ...noRules, maxFootprintRatio: 0.9, greenSpaceRatio: 0.3 },
    });
    // min(0.9*1000, 1000 - 0.3*1000) = min(900, 700) = 700
    expect(r.maxFootprintM2).toBe(700);
    expect(r.greenSpaceRequiredM2).toBe(300);
  });

  it("estime le nombre d'étages (3 m par niveau)", () => {
    const r = calculateBuildability({
      parcelSurfaceM2: 500,
      existingFootprintM2: 0,
      calculationVariables: { ...noRules, maxHeightM: 9 },
    });
    expect(r.estimatedFloors).toBe(3);
  });

  it("confiance = 1 quand toutes les règles sont présentes", () => {
    const r = calculateBuildability({
      parcelSurfaceM2: 500,
      existingFootprintM2: 0,
      calculationVariables: {
        maxFootprintRatio: 0.4,
        maxHeightM: 9,
        minSetbackFromRoadM: 5,
        minSetbackFromBoundariesM: 3,
        parkingRules: "1 place / logement",
        greenSpaceRatio: 0.2,
      },
    });
    expect(r.confidence).toBe(1);
  });

  it("confiance = 0 et résumé non concluant sans aucune règle", () => {
    const r = calculateBuildability({
      parcelSurfaceM2: 500,
      existingFootprintM2: 0,
      calculationVariables: noRules,
    });
    expect(r.confidence).toBe(0);
    expect(r.maxFootprintM2).toBe(500); // fallback : surface totale
    expect(r.resultSummary).toContain("non concluante");
  });
});
