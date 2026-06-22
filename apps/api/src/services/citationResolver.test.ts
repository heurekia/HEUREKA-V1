import { describe, it, expect } from "vitest";
import { normalizeForMatch, quoteFoundIn, docTypeForViewer, pickBestHit } from "./citationResolver.ts";
import type { SearchHit } from "@heureka-v1/ingestion/rag";

// Construit un SearchHit minimal — seuls text/segment_id/page/doc_type sont
// lus par la logique testée.
const hit = (over: Partial<SearchHit> & { segment_id: string; text: string }): SearchHit =>
  ({
    doc_type: "plu_reglement",
    doc_source_file: null,
    doc_version: null,
    page: null,
    source_id: null,
    distance: 0.1,
    metadata: {},
    annotations: [],
    ...over,
  }) as SearchHit;

describe("normalizeForMatch", () => {
  it("écrase casse et espaces multiples", () => {
    expect(normalizeForMatch("  La  HAUTEUR\n max ")).toBe("la hauteur max");
  });
});

describe("quoteFoundIn", () => {
  it("matche un verbatim contenu dans le passage (insensible casse/espaces)", () => {
    const quote = "La hauteur des constructions ne peut excéder 9 mètres.";
    const text = "Article 10 — Hauteur.\nLa  hauteur des constructions  ne peut excéder 9 mètres. Au-delà…";
    expect(quoteFoundIn(quote, text)).toBe(true);
  });

  it("matche aussi quand le passage est inclus dans la règle (bidirectionnel)", () => {
    expect(quoteFoundIn("la hauteur ne peut excéder 9 mètres au faîtage", "ne peut excéder 9 mètres")).toBe(true);
  });

  it("rejette un verbatim absent (pas de lien fabriqué)", () => {
    expect(quoteFoundIn("emprise au sol limitée à 40 %", "La hauteur ne peut excéder 9 mètres.")).toBe(false);
  });

  it("rejette les verbatims trop courts (non discriminants)", () => {
    expect(quoteFoundIn("3 m", "recul minimal de 3 m par rapport à la voie")).toBe(false);
  });
});

describe("docTypeForViewer", () => {
  it("réduit le doc_type RAG au type matchable par le viewer", () => {
    expect(docTypeForViewer("plu_reglement")).toBe("plu");
    expect(docTypeForViewer("plui_reglement")).toBe("plui");
    expect(docTypeForViewer("ppri")).toBe("ppri");
    expect(docTypeForViewer("OAP")).toBe("oap");
  });
});

describe("pickBestHit", () => {
  const quote = "La hauteur des constructions ne peut excéder 9 mètres.";

  it("retient le premier passage (plus proche) qui contient le verbatim", () => {
    const hits = [
      hit({ segment_id: "doc_CHUNK_0001", text: "Dispositions générales sans rapport." }),
      hit({ segment_id: "doc_CHUNK_0007", text: "Art. 10 : la hauteur des constructions ne peut excéder 9 mètres.", page: 12 }),
    ];
    const best = pickBestHit(quote, hits);
    expect(best?.segment_id).toBe("doc_CHUNK_0007");
    expect(best?.page).toBe(12);
  });

  it("renvoie null si aucun passage ne contient le verbatim", () => {
    const hits = [hit({ segment_id: "doc_CHUNK_0001", text: "Texte sans rapport aucun avec la règle." })];
    expect(pickBestHit(quote, hits)).toBeNull();
  });
});
