import { describe, it, expect } from "vitest";
import { computeGlobalScore, buildSynthese } from "./dossierConformity.js";

describe("computeGlobalScore", () => {
  it("returns conforme when every piece is conforme and nothing missing", () => {
    const r = computeGlobalScore(["conforme", "conforme", "conforme"], 0, 3);
    expect(r.score).toBe("conforme");
    expect(r.pct).toBe(100);
  });

  it("returns incomplet when at least one piece is missing", () => {
    const r = computeGlobalScore(["conforme", "conforme"], 1, 3);
    expect(r.score).toBe("incomplet");
    // 2 conformes / 3 attendues = ~67%
    expect(r.pct).toBe(67);
  });

  it("returns non_conforme when a piece is non_conforme even if nothing missing", () => {
    const r = computeGlobalScore(["conforme", "non_conforme", "acceptable"], 0, 3);
    expect(r.score).toBe("non_conforme");
  });

  it("returns incomplet when a piece is incomplet (no missing, no non_conforme)", () => {
    const r = computeGlobalScore(["conforme", "incomplet", "acceptable"], 0, 3);
    expect(r.score).toBe("incomplet");
  });

  it("returns acceptable when only acceptables (no missing, no incomplet, no non_conforme)", () => {
    const r = computeGlobalScore(["conforme", "acceptable", "acceptable"], 0, 3);
    expect(r.score).toBe("acceptable");
  });

  it("returns incomplet (0%) when no pieces expected (defensive)", () => {
    expect(computeGlobalScore([], 0, 0)).toEqual({ score: "incomplet", pct: 0 });
  });

  it("scores 0 percent when all pieces missing", () => {
    expect(computeGlobalScore([], 5, 5)).toEqual({ score: "incomplet", pct: 0 });
  });

  it("computes weighted percentages correctly", () => {
    // 1 conforme (1.0) + 1 acceptable (0.7) + 1 incomplet (0.4) = 2.1 / 3 = 70%
    const r = computeGlobalScore(["conforme", "acceptable", "incomplet"], 0, 3);
    expect(r.pct).toBe(70);
  });
});

describe("buildSynthese", () => {
  it("produces a conforme synthesis", () => {
    const s = buildSynthese("conforme", 100, 5, 0, 0);
    expect(s).toMatch(/conforme/i);
    expect(s).toMatch(/5 pièces/);
  });

  it("flags missing pieces", () => {
    const s = buildSynthese("incomplet", 60, 5, 2, 0);
    expect(s).toMatch(/2 pièces requises manquantes/);
  });

  it("flags major non-conformities", () => {
    const s = buildSynthese("non_conforme", 30, 5, 0, 3);
    expect(s).toMatch(/3 non-conformités majeures/);
  });
});
