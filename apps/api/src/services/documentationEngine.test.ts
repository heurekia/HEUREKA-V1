import { describe, it, expect } from "vitest";
import {
  PIECE_TOPICS,
  PIECE_LABELS,
  topicsForPieceCode,
  libelleServitude,
} from "./documentationEngine.js";

describe("topicsForPieceCode", () => {
  it("renvoie les topics du plan de masse (DP2) — recul, emprise, stationnement", () => {
    const topics = topicsForPieceCode("DP2");
    expect(topics).toContain("recul_voie");
    expect(topics).toContain("recul_limite");
    expect(topics).toContain("emprise_sol");
    expect(topics).toContain("stationnement");
  });

  it("renvoie les topics des façades (DP5) — aspect, hauteur", () => {
    const topics = topicsForPieceCode("DP5");
    expect(topics).toEqual(expect.arrayContaining(["aspect", "hauteur"]));
  });

  it("retombe sur DEFAULT_TOPICS pour un code inconnu", () => {
    expect(topicsForPieceCode("UNKNOWN")).toEqual(["general"]);
  });

  it("retombe sur DEFAULT_TOPICS pour null/undefined", () => {
    expect(topicsForPieceCode(null)).toEqual(["general"]);
    expect(topicsForPieceCode(undefined)).toEqual(["general"]);
  });

  it("PIECE_TOPICS et PIECE_LABELS couvrent les DP/PC principaux", () => {
    for (const code of ["DP1", "DP2", "DP3", "DP4", "DP5", "DP6", "DP7", "PC1", "PC2", "PC3", "PC4", "PC5"]) {
      expect(PIECE_TOPICS[code]).toBeDefined();
      expect(PIECE_LABELS[code]).toBeDefined();
    }
  });
});

describe("libelleServitude", () => {
  it("résout les codes AC vers Monuments historiques", () => {
    expect(libelleServitude("AC1")).toMatch(/Monuments historiques/i);
    expect(libelleServitude("ac1")).toMatch(/Monuments historiques/i); // case-insensitive
  });

  it("résout PM1 vers PPRN/PPRI (risques naturels)", () => {
    expect(libelleServitude("PM1")).toMatch(/PPRN|PPRI|risques naturels/i);
  });

  it("retourne le fallback fourni si catégorie nulle", () => {
    expect(libelleServitude(null, "Custom label")).toBe("Custom label");
    expect(libelleServitude(undefined)).toBe("Servitude");
  });

  it("compose un libellé générique pour une catégorie inconnue", () => {
    expect(libelleServitude("ZZ9")).toMatch(/Servitude ZZ9/);
  });
});
