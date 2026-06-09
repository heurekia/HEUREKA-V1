import { describe, expect, it } from "vitest";
import { flatten, valueMatches, scoreExtraction, scoreAnalysis, median, p95 } from "./scoring.js";
import type { PieceFixture, ProviderResponse } from "./types.js";

describe("valueMatches", () => {
  it("matche les nombres dans la tolérance par défaut (10%)", () => {
    expect(valueMatches(5.0, 5.3)).toBe(true);   // 6% écart
    expect(valueMatches(5.0, 5.6)).toBe(false);  // 12% écart
  });

  it("respecte une tolérance custom", () => {
    expect(valueMatches(10.0, 10.5, 0.06)).toBe(true);  // 5% écart, tol 6%
    expect(valueMatches(10.0, 10.7, 0.06)).toBe(false); // 7% écart, tol 6%
  });

  it("compare les strings en case-insensitive", () => {
    expect(valueMatches("Habitation", "habitation")).toBe(true);
    expect(valueMatches("Commerce", "Habitation")).toBe(false);
  });

  it("compare les booleans strictement", () => {
    expect(valueMatches(true, true)).toBe(true);
    expect(valueMatches(true, false)).toBe(false);
  });

  it("retourne false si le type ne correspond pas", () => {
    expect(valueMatches(5.0, "5.0")).toBe(false);
  });

  it("gère le 0 sans diviser par zéro", () => {
    expect(valueMatches(0, 0)).toBe(true);
    expect(valueMatches(0, 0.005)).toBe(true);
    expect(valueMatches(0, 1)).toBe(false);
  });
});

describe("flatten", () => {
  it("aplatit un objet imbriqué", () => {
    expect(flatten({ a: { b: 1, c: 2 } })).toEqual({ "a.b": 1, "a.c": 2 });
  });

  it("ignore les null/undefined", () => {
    expect(flatten({ a: 1, b: null, c: undefined })).toEqual({ a: 1 });
  });

  it("garde les tableaux comme valeurs feuilles", () => {
    expect(flatten({ a: [1, 2, 3] })).toEqual({ a: [1, 2, 3] });
  });
});

const FIXTURE: PieceFixture = {
  id: "plan-masse-test",
  file: "fake.pdf",
  mime: "application/pdf",
  label: "Plan de masse test",
  context: { zone: "UB", commune: "Tours" },
  golden: {
    piece_type: "plan_masse",
    expected_quality: "lisible",
    expected_score: "conforme",
    expected_values: {
      "plan_masse.recul_voie_m": 4.2,
      "plan_masse.emprise_au_sol_m2": 80,
      "echelle": "1/200",
    },
    expected_missing: [],
    expected_non_conformites: [],
  },
};

function mkResp(parsed: Record<string, unknown> | null): ProviderResponse {
  return {
    parsed,
    raw_text: JSON.stringify(parsed ?? {}),
    input_tokens: 100,
    output_tokens: 50,
    cost_eur: 0.01,
    duration_ms: 1500,
    model_id: "test",
    error: null,
  };
}

describe("scoreExtraction", () => {
  it("score parfait quand tout matche", () => {
    const resp = mkResp({
      piece_type: "plan_masse",
      echelle: "1/200",
      plan_masse: { recul_voie_m: 4.2, emprise_au_sol_m2: 80 },
    });
    const s = scoreExtraction(resp, FIXTURE);
    expect(s.type_match).toBe(true);
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.f1).toBe(1);
    expect(s.missing).toEqual([]);
    expect(s.wrong_values).toEqual([]);
  });

  it("type incorrect → type_match=false mais valeurs encore évaluées", () => {
    const resp = mkResp({
      piece_type: "plan_coupe",
      echelle: "1/200",
      plan_masse: { recul_voie_m: 4.2, emprise_au_sol_m2: 80 },
    });
    const s = scoreExtraction(resp, FIXTURE);
    expect(s.type_match).toBe(false);
    expect(s.precision).toBe(1);
  });

  it("valeur dans la tolérance → match", () => {
    const resp = mkResp({
      piece_type: "plan_masse",
      echelle: "1/200",
      plan_masse: { recul_voie_m: 4.4, emprise_au_sol_m2: 80 }, // recul +4.7%
    });
    const s = scoreExtraction(resp, FIXTURE);
    expect(s.wrong_values).toEqual([]);
    expect(s.precision).toBe(1);
  });

  it("valeur hors tolérance → wrong_value, précision dégradée", () => {
    const resp = mkResp({
      piece_type: "plan_masse",
      echelle: "1/200",
      plan_masse: { recul_voie_m: 6.0, emprise_au_sol_m2: 80 }, // +43%
    });
    const s = scoreExtraction(resp, FIXTURE);
    expect(s.wrong_values.length).toBe(1);
    expect(s.precision).toBeCloseTo(2 / 3, 3);
  });

  it("valeur manquante → missing, rappel dégradé", () => {
    const resp = mkResp({
      piece_type: "plan_masse",
      echelle: "1/200",
      plan_masse: { recul_voie_m: 4.2 },
    });
    const s = scoreExtraction(resp, FIXTURE);
    expect(s.missing).toContain("plan_masse.emprise_au_sol_m2");
    expect(s.recall).toBeCloseTo(2 / 3, 3);
  });

  it("JSON invalide → score nul + valid_json=false", () => {
    const s = scoreExtraction(mkResp(null), FIXTURE);
    expect(s.valid_json).toBe(false);
    expect(s.f1).toBe(0);
    expect(s.missing.length).toBeGreaterThan(0);
  });

  it("détecte les hallucinations sur champs hors golden", () => {
    const resp = mkResp({
      piece_type: "plan_masse",
      echelle: "1/200",
      plan_masse: {
        recul_voie_m: 4.2,
        emprise_au_sol_m2: 80,
        longueur_batiment_m: 12.5,  // hallucination : pas dans golden
      },
    });
    const s = scoreExtraction(resp, FIXTURE);
    expect(s.hallucinations).toContain("plan_masse.longueur_batiment_m");
  });
});

describe("scoreAnalysis", () => {
  it("score qualitatif correct", () => {
    const resp = mkResp({ score: "conforme", commentaire: "ok", suggestions: [] });
    const s = scoreAnalysis(resp, FIXTURE);
    expect(s.score_match).toBe(true);
    expect(s.valid_json).toBe(true);
  });

  it("score qualitatif incorrect", () => {
    const resp = mkResp({ score: "incomplet", commentaire: "...", suggestions: [] });
    const s = scoreAnalysis(resp, FIXTURE);
    expect(s.score_match).toBe(false);
  });

  it("non-conformités attendues détectées par concordance partielle", () => {
    const fxt: PieceFixture = {
      ...FIXTURE,
      golden: { ...FIXTURE.golden, expected_non_conformites: ["recul voie insuffisant"] },
    };
    const resp = mkResp({
      score: "incomplet",
      commentaire: "...",
      suggestions: [],
      non_conformites: [{ regle: "Recul voie insuffisant — 3.5m vs 5m attendus" }],
    });
    const s = scoreAnalysis(resp, fxt);
    expect(s.recall).toBe(1);
  });
});

describe("statistiques", () => {
  it("median sur série paire", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("median sur série impaire", () => {
    expect(median([1, 2, 3])).toBe(2);
  });
  it("p95 sur 20 valeurs", () => {
    const vals = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    expect(p95(vals)).toBe(19);
  });
});
