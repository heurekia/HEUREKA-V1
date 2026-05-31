import { describe, it, expect } from "vitest";
import { extractFirstJson, normalizeScore, parsePieceAnalysis } from "./pieceAnalyzer.js";

describe("extractFirstJson", () => {
  it("parses a clean JSON object", () => {
    expect(extractFirstJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("extracts a JSON object embedded after prose", () => {
    expect(extractFirstJson('Voici ma réponse : {"score":"conforme"} merci')).toEqual({ score: "conforme" });
  });

  it("handles nested objects correctly", () => {
    expect(extractFirstJson('{"a":{"b":2},"c":[1,2,{"d":3}]}')).toEqual({ a: { b: 2 }, c: [1, 2, { d: 3 }] });
  });

  it("ignores braces inside strings", () => {
    expect(extractFirstJson('{"s":"hello { world }","n":1}')).toEqual({ s: "hello { world }", n: 1 });
  });

  it("returns null when no JSON object found", () => {
    expect(extractFirstJson("aucun JSON ici")).toBeNull();
  });

  it("returns null for unbalanced braces", () => {
    expect(extractFirstJson('{"a":1,"b":2')).toBeNull();
  });
});

describe("normalizeScore", () => {
  it("normalizes known scores", () => {
    expect(normalizeScore("conforme")).toBe("conforme");
    expect(normalizeScore("CONFORME")).toBe("conforme");
    expect(normalizeScore(" acceptable ")).toBe("acceptable");
    expect(normalizeScore("non_conforme")).toBe("non_conforme");
    expect(normalizeScore("non conforme")).toBe("non_conforme");
    expect(normalizeScore("incomplet")).toBe("incomplet");
    expect(normalizeScore("incomplete")).toBe("incomplet");
  });

  it("falls back to acceptable for unknown values", () => {
    expect(normalizeScore("foo")).toBe("acceptable");
    expect(normalizeScore(null)).toBe("acceptable");
    expect(normalizeScore(undefined)).toBe("acceptable");
  });
});

describe("parsePieceAnalysis", () => {
  it("parses a complete response", () => {
    const text = JSON.stringify({
      score: "incomplet",
      commentaire: "Cotes manquantes.",
      suggestions: ["Ajouter les cotes au plan."],
      non_conformites: [
        {
          regle: "Recul minimum 3 m des limites séparatives",
          article: "UB 7",
          constate: "Recul de 1,8 m visible sur le plan",
          attendu: "≥ 3 m",
          gravite: "majeure",
        },
      ],
    });
    const r = parsePieceAnalysis(text);
    expect(r.score).toBe("incomplet");
    expect(r.commentaire).toBe("Cotes manquantes.");
    expect(r.suggestions).toEqual(["Ajouter les cotes au plan."]);
    expect(r.non_conformites).toHaveLength(1);
    expect(r.non_conformites![0]!.gravite).toBe("majeure");
    expect(r.non_conformites![0]!.article).toBe("UB 7");
  });

  it("returns a default analysis on garbage input", () => {
    const r = parsePieceAnalysis("not json at all");
    expect(r.score).toBe("acceptable");
    expect(r.suggestions).toEqual([]);
    expect(r.non_conformites).toBeUndefined();
  });

  it("filters out non-conformities without a 'regle' field", () => {
    const text = JSON.stringify({
      score: "acceptable",
      commentaire: "OK",
      non_conformites: [
        { regle: "", attendu: "x", constate: "y" },
        { attendu: "x" },
        { regle: "Vraie règle", constate: "c", attendu: "a" },
      ],
    });
    const r = parsePieceAnalysis(text);
    expect(r.non_conformites).toHaveLength(1);
    expect(r.non_conformites![0]!.regle).toBe("Vraie règle");
  });

  it("normalizes unknown gravite to 'info'", () => {
    const text = JSON.stringify({
      score: "acceptable",
      commentaire: "OK",
      non_conformites: [{ regle: "X", constate: "c", attendu: "a", gravite: "critique" }],
    });
    const r = parsePieceAnalysis(text);
    expect(r.non_conformites![0]!.gravite).toBe("info");
  });

  it("preserves commentaire trimmed; defaults when empty", () => {
    const r = parsePieceAnalysis(JSON.stringify({ score: "conforme", commentaire: "  " }));
    expect(r.commentaire).toBe("Analyse effectuée.");
  });
});
