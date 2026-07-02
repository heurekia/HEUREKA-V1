import { describe, it, expect } from "vitest";
import { isInForce, selectActiveDocumentIds, type CandidateDocument } from "./documentSelection.ts";

const D = (s: string) => new Date(`${s}T00:00:00Z`);

function doc(overrides: Partial<CandidateDocument> & { documentId: string; type: string }): CandidateDocument {
  return {
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: D("2020-01-01"),
    ...overrides,
  };
}

describe("isInForce", () => {
  const at = D("2026-07-01");

  it("bornes NULL des deux côtés = toujours en vigueur", () => {
    expect(isInForce(doc({ documentId: "a", type: "plu" }), at)).toBe(true);
  });

  it("effective_from futur = pas encore en vigueur", () => {
    expect(isInForce(doc({ documentId: "a", type: "plui", effectiveFrom: D("2027-01-01") }), at)).toBe(false);
  });

  it("effective_from passé = en vigueur", () => {
    expect(isInForce(doc({ documentId: "a", type: "plui", effectiveFrom: D("2025-01-01") }), at)).toBe(true);
  });

  it("effective_to passé = clôturé (hors vigueur)", () => {
    expect(isInForce(doc({ documentId: "a", type: "plu", effectiveTo: D("2026-01-01") }), at)).toBe(false);
  });

  it("effective_to est exclusif : à l'instant exact de fin, plus en vigueur", () => {
    expect(isInForce(doc({ documentId: "a", type: "plu", effectiveTo: at }), at)).toBe(false);
  });

  it("effective_to futur = encore en vigueur", () => {
    expect(isInForce(doc({ documentId: "a", type: "plu", effectiveTo: D("2027-01-01") }), at)).toBe(true);
  });
});

describe("selectActiveDocumentIds — arbitrage de substitution PLU", () => {
  const at = D("2026-07-01");

  it("conserve toutes les familles non-PLU (superposition)", () => {
    const docs = [
      doc({ documentId: "ppri", type: "ppri" }),
      doc({ documentId: "oap", type: "oap" }),
      doc({ documentId: "peb", type: "peb" }),
    ];
    expect(selectActiveDocumentIds(docs, at)).toEqual(new Set(["ppri", "oap", "peb"]));
  });

  it("un seul PLU communal non daté (legacy) est conservé", () => {
    const docs = [doc({ documentId: "plu", type: "plu" })];
    expect(selectActiveDocumentIds(docs, at)).toEqual(new Set(["plu"]));
  });

  it("un PLUi daté remplace le PLU communal historique non daté", () => {
    const docs = [
      doc({ documentId: "plu-communal", type: "plu" }), // NULL from = -∞
      doc({ documentId: "plui", type: "plui", effectiveFrom: D("2025-01-01") }),
    ];
    expect(selectActiveDocumentIds(docs, at)).toEqual(new Set(["plui"]));
  });

  it("un PLUi pas encore en vigueur laisse le PLU communal gouverner", () => {
    const docs = [
      doc({ documentId: "plu-communal", type: "plu" }),
      doc({ documentId: "plui", type: "plui", effectiveFrom: D("2027-01-01") }), // futur
    ];
    expect(selectActiveDocumentIds(docs, at)).toEqual(new Set(["plu-communal"]));
  });

  it("PLU communal clôturé + PLUi en vigueur : seul le PLUi reste", () => {
    const docs = [
      doc({ documentId: "plu-communal", type: "plu", effectiveTo: D("2025-01-01") }),
      doc({ documentId: "plui", type: "plui", effectiveFrom: D("2025-01-01") }),
    ];
    expect(selectActiveDocumentIds(docs, at)).toEqual(new Set(["plui"]));
  });

  it("PLU superposé aux annexes : garde le PLU en vigueur ET toutes les annexes", () => {
    const docs = [
      doc({ documentId: "plu-communal", type: "plu" }),
      doc({ documentId: "plui", type: "plui", effectiveFrom: D("2025-01-01") }),
      doc({ documentId: "ppri", type: "ppri" }),
      doc({ documentId: "oap", type: "oap" }),
    ];
    expect(selectActiveDocumentIds(docs, at)).toEqual(new Set(["plui", "ppri", "oap"]));
  });

  it("deux PLU non datés : départage par created_at le plus récent", () => {
    const docs = [
      doc({ documentId: "ancien", type: "plu", createdAt: D("2019-01-01") }),
      doc({ documentId: "recent", type: "plu", createdAt: D("2023-01-01") }),
    ];
    expect(selectActiveDocumentIds(docs, at)).toEqual(new Set(["recent"]));
  });

  it("deux PLUi datés en vigueur : le effective_from le plus récent l'emporte", () => {
    const docs = [
      doc({ documentId: "v1", type: "plui", effectiveFrom: D("2022-01-01") }),
      doc({ documentId: "v2", type: "plui", effectiveFrom: D("2025-01-01") }),
    ];
    expect(selectActiveDocumentIds(docs, at)).toEqual(new Set(["v2"]));
  });

  it("aucun PLU en vigueur à la date : aucune règle PLU, mais les annexes restent", () => {
    const docs = [
      doc({ documentId: "plu", type: "plu", effectiveTo: D("2025-01-01") }), // clôturé
      doc({ documentId: "ppri", type: "ppri" }),
    ];
    expect(selectActiveDocumentIds(docs, at)).toEqual(new Set(["ppri"]));
  });

  it("plum (PLU métropolitain) est traité comme la famille PLU", () => {
    const docs = [
      doc({ documentId: "plu-communal", type: "plu" }),
      doc({ documentId: "plum", type: "plum", effectiveFrom: D("2025-01-01") }),
    ];
    expect(selectActiveDocumentIds(docs, at)).toEqual(new Set(["plum"]));
  });

  it("ensemble vide → ensemble vide", () => {
    expect(selectActiveDocumentIds([], at)).toEqual(new Set());
  });
});
