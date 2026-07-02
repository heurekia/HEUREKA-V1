import { describe, it, expect } from "vitest";
import { parseSprSecteurs, slugifySecteurCode, SPR_ZONE_TYPE } from "./sprImport.ts";
import { partitionPagesByZone } from "./pluImport.ts";

describe("slugifySecteurCode", () => {
  it("préfixe SPR-, retire accents et mots-outils", () => {
    expect(slugifySecteurCode("Secteur de la vallée de Vaufoynard")).toBe("SPR-VALLEE-VAUFOYNARD");
    expect(slugifySecteurCode("Secteur du plateau viticole")).toBe("SPR-PLATEAU-VITICOLE");
  });

  it("distingue les trois secteurs mentionnant la Bédoire", () => {
    const codes = [
      "Secteur du vallon secondaire de la Bédoire",
      "Secteur de la vallée de la Bédoire habitée",
      "Secteur de la vallée de la Bédoire confidentielle",
    ].map(slugifySecteurCode);
    expect(new Set(codes).size).toBe(3);
    expect(codes).toEqual([
      "SPR-VALLON-SECONDAIRE-BEDOIRE",
      "SPR-VALLEE-BEDOIRE-HABITEE",
      "SPR-VALLEE-BEDOIRE-CONFIDENTIELLE",
    ]);
  });
});

describe("parseSprSecteurs", () => {
  // Fabrique un document paginé : chaque secteur occupe `span` pages qui portent
  // toutes son en-tête courant « Chapitre N - <label> » (comme le vrai PDF).
  const buildDoc = (sections: Array<{ chap: number; label: string; span: number }>): string[] => {
    const pages: string[] = [];
    for (const s of sections) {
      for (let k = 0; k < s.span; k++) {
        pages.push(`Chapitre ${s.chap} - ${s.label}\nRèglement SPR — contenu page ${k + 1}`);
      }
    }
    return pages;
  };

  const LIVRET2 = [
    { chap: 1, label: "Dispositions communes à tous les secteurs", span: 3 },
    { chap: 2, label: "Secteur de la vallée de Vaufoynard", span: 4 },
    { chap: 3, label: "Secteur du vallon secondaire de la Bédoire", span: 4 },
    { chap: 4, label: "Secteur du plateau viticole", span: 4 },
  ];

  it("détecte le socle commun + les secteurs avec leurs pages de début", () => {
    const pages = buildDoc(LIVRET2);
    const toc = parseSprSecteurs(pages);
    expect(toc.map((t) => t.code)).toEqual([
      "SPR-COMMUN",
      "SPR-VALLEE-VAUFOYNARD",
      "SPR-VALLON-SECONDAIRE-BEDOIRE",
      "SPR-PLATEAU-VITICOLE",
    ]);
    expect(toc.every((t) => t.type === SPR_ZONE_TYPE)).toBe(true);
    // 3 pages de commun → Vaufoynard démarre page 4, etc.
    expect(toc.find((t) => t.code === "SPR-VALLEE-VAUFOYNARD")!.startPage).toBe(4);
    expect(toc.find((t) => t.code === "SPR-PLATEAU-VITICOLE")!.startPage).toBe(12);
  });

  it("découpe en plages contiguës via partitionPagesByZone", () => {
    const pages = buildDoc(LIVRET2);
    const ranges = partitionPagesByZone(parseSprSecteurs(pages), pages.length);
    expect(ranges.map((r) => [r.code, r.startPage, r.endPage])).toEqual([
      ["SPR-COMMUN", 1, 3],
      ["SPR-VALLEE-VAUFOYNARD", 4, 7],
      ["SPR-VALLON-SECONDAIRE-BEDOIRE", 8, 11],
      ["SPR-PLATEAU-VITICOLE", 12, 15],
    ]);
  });

  it("déduplique le gros titre en capitales tronqué et l'en-tête courant (même chapitre)", () => {
    // 1re page du secteur : le gros titre wrappé en CAPITALES + l'en-tête courant
    // complet cohabitent → un SEUL secteur, libellé complet retenu.
    const pages = [
      "Chapitre 2 - Secteur de la vallée de Vaufoynard\nintro",
      "Chapitre 3 - SECTEUR DU VALLON SECONDAIRE DE LA\nChapitre 3 - Secteur du vallon secondaire de la Bédoire\ncontenu",
      "Chapitre 3 - Secteur du vallon secondaire de la Bédoire\nsuite",
      "Chapitre 4 - Secteur du plateau viticole\nintro",
    ];
    const toc = parseSprSecteurs(pages);
    expect(toc.map((t) => t.code)).toEqual([
      "SPR-VALLEE-VAUFOYNARD",
      "SPR-VALLON-SECONDAIRE-BEDOIRE",
      "SPR-PLATEAU-VITICOLE",
    ]);
    expect(toc.find((t) => t.code === "SPR-VALLON-SECONDAIRE-BEDOIRE")!.startPage).toBe(2);
  });

  it("écarte la page de sommaire (≥ 3 chapitres regroupés) comme source d'ancre", () => {
    const sommaire =
      "SOMMAIRE\n" +
      "Chapitre 2 - Secteur de la vallée de Vaufoynard ........... 164\n" +
      "Chapitre 3 - Secteur du vallon secondaire de la Bédoire ... 186\n" +
      "Chapitre 4 - Secteur du plateau viticole ................. 318\n";
    const pages = [sommaire, ...buildDoc(LIVRET2)];
    const toc = parseSprSecteurs(pages);
    // Vaufoynard démarre en corps (page 5 = sommaire + 3 pages commun + 1), pas page 1.
    expect(toc.find((t) => t.code === "SPR-VALLEE-VAUFOYNARD")!.startPage).toBe(5);
  });

  it("renvoie [] sous le seuil de secteurs (socle commun seul ne suffit pas)", () => {
    const pages = buildDoc([
      { chap: 1, label: "Dispositions communes à tous les secteurs", span: 2 },
      { chap: 2, label: "Secteur de la vallée de Vaufoynard", span: 2 },
    ]);
    expect(parseSprSecteurs(pages, 3)).toEqual([]);
    expect(parseSprSecteurs(pages, 1).map((t) => t.code)).toContain("SPR-VALLEE-VAUFOYNARD");
  });

  it("n'attrape pas les chapitres du Livret 1 (catégories de bâti, sans « Secteur »)", () => {
    const pages = buildDoc([
      { chap: 1, label: "Immeuble ou ensemble d'immeubles remarquables", span: 3 },
      { chap: 2, label: "Immeuble ancien", span: 3 },
      { chap: 3, label: "Secteur de la vallée de Vaufoynard", span: 3 },
      { chap: 4, label: "Secteur du plateau viticole", span: 3 },
      { chap: 5, label: "Secteur du coteau arboré et habité", span: 3 },
    ]);
    const toc = parseSprSecteurs(pages);
    expect(toc.map((t) => t.code)).toEqual([
      "SPR-VALLEE-VAUFOYNARD",
      "SPR-PLATEAU-VITICOLE",
      "SPR-COTEAU-ARBORE-HABITE",
    ]);
  });
});
