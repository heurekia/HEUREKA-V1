import { describe, it, expect } from "vitest";
import { partitionPagesByZone, chunkPages, assertTocCoverage, parseTocFromNativeText } from "./pluImport.ts";

describe("partitionPagesByZone", () => {
  it("découpe les zones en plages fermées [start, end] selon la zone suivante", () => {
    // Cas Tours (extrait simplifié) : UA p.7, UC p.33, UL p.67, AUs p.160,
    // A p.171, N p.180, totalPages = 217.
    const ranges = partitionPagesByZone(
      [
        { code: "UA", label: "UA", type: "U", startPage: 7 },
        { code: "UC", label: "UC", type: "U", startPage: 33 },
        { code: "UL", label: "UL", type: "U", startPage: 67 },
        { code: "AUs", label: "AUs", type: "AU", startPage: 160 },
        { code: "A", label: "A", type: "A", startPage: 171 },
        { code: "N", label: "N", type: "N", startPage: 180 },
      ],
      217,
    );
    expect(ranges.map((r) => [r.code, r.startPage, r.endPage])).toEqual([
      ["UA", 7, 32],
      ["UC", 33, 66],
      ["UL", 67, 159],
      ["AUs", 160, 170],
      ["A", 171, 179],
      ["N", 180, 217],
    ]);
  });

  it("trie par startPage même si le sommaire est en désordre", () => {
    const ranges = partitionPagesByZone(
      [
        { code: "N", label: "N", type: "N", startPage: 30 },
        { code: "UA", label: "UA", type: "U", startPage: 5 },
      ],
      50,
    );
    expect(ranges.map((r) => r.code)).toEqual(["UA", "N"]);
    expect(ranges[1]!.endPage).toBe(50);
  });

  it("ignore les ancres hors bornes et les doublons", () => {
    const ranges = partitionPagesByZone(
      [
        { code: "A", label: "A", type: "A", startPage: 0 }, // < 1
        { code: "B", label: "B", type: "U", startPage: 5 },
        { code: "C", label: "C", type: "U", startPage: 5 }, // doublon page
        { code: "D", label: "D", type: "U", startPage: 999 }, // > total
      ],
      50,
    );
    expect(ranges.map((r) => r.code)).toEqual(["B"]);
    expect(ranges[0]!.endPage).toBe(50);
  });
});

describe("chunkPages", () => {
  it("découpe une plage en lots de batchSize pages", () => {
    expect(chunkPages(67, 159, 8)).toEqual([
      [67, 74], [75, 82], [83, 90], [91, 98], [99, 106],
      [107, 114], [115, 122], [123, 130], [131, 138],
      [139, 146], [147, 154], [155, 159],
    ]);
  });

  it("renvoie un seul lot quand la plage tient dans batchSize", () => {
    expect(chunkPages(160, 170, 8)).toEqual([[160, 167], [168, 170]]);
    expect(chunkPages(180, 180, 8)).toEqual([[180, 180]]);
  });

  it("renvoie [] si end < start", () => {
    expect(chunkPages(10, 5, 8)).toEqual([]);
  });

  it("rejette batchSize ≤ 0", () => {
    expect(() => chunkPages(1, 10, 0)).toThrow();
  });
});

describe("assertTocCoverage", () => {
  const toursToc = [
    { code: "UA", label: "UA", type: "U", startPage: 7 },
    { code: "UC", label: "UC", type: "U", startPage: 33 },
    { code: "UJ", label: "UJ", type: "U", startPage: 45 },
    { code: "UL", label: "UL", type: "U", startPage: 67 },
    { code: "UM", label: "UM", type: "U", startPage: 90 },
    { code: "UP", label: "UP", type: "U", startPage: 110 },
    { code: "UX", label: "UX", type: "U", startPage: 140 },
    { code: "AUs", label: "AUs", type: "AU", startPage: 160 },
    { code: "A", label: "A", type: "A", startPage: 171 },
    { code: "N", label: "N", type: "N", startPage: 180 },
  ];

  it("passe si toutes les zones du TOC ont au moins une règle", () => {
    expect(() =>
      assertTocCoverage(
        toursToc,
        toursToc.map((z) => ({ code: z.code, ruleCount: 5 })),
      ),
    ).not.toThrow();
  });

  it("lève si seulement 2 zones sur 10 ont des règles (bug actuel)", () => {
    expect(() =>
      assertTocCoverage(toursToc, [
        { code: "UA", ruleCount: 12 },
        { code: "UC", ruleCount: 8 },
      ]),
    ).toThrow(/2\/10 zones/);
  });

  it("liste explicitement les zones manquantes pour aider l'instructeur", () => {
    try {
      assertTocCoverage(toursToc, [
        { code: "UA", ruleCount: 5 },
        { code: "UC", ruleCount: 5 },
      ]);
      throw new Error("aurait dû lever");
    } catch (e) {
      const msg = (e as Error).message;
      // UL et AUs explicitement nommés : ce sont les zones où le bug a été détecté.
      expect(msg).toContain("UL");
      expect(msg).toContain("AUs");
      expect(msg).toContain("référentiel existant n'a pas été modifié");
    }
  });

  it("lève si le sommaire est vide", () => {
    expect(() => assertTocCoverage([], [])).toThrow(/Sommaire vide/);
  });

  it("seuil ajustable : passe à 50 % si demandé explicitement", () => {
    expect(() =>
      assertTocCoverage(
        toursToc,
        toursToc.slice(0, 5).map((z) => ({ code: z.code, ruleCount: 1 })),
        0.5,
      ),
    ).not.toThrow();
  });
});

describe("parseTocFromNativeText", () => {
  it("extrait 10 zones d'un sommaire de type Tours", () => {
    // Sommaire synthétique d'un PLU Tours, mise en page typique pdftotext -layout
    const text = `
      RÈGLEMENT - PIÈCE 4
                                                                       SOMMAIRE
      Chapitre I  - Dispositions applicables à la zone UA  ........................... 7
      Chapitre II - Dispositions applicables à la zone UC  ........................... 33
      Chapitre III- Dispositions applicables à la zone UJ  ........................... 45
      Chapitre IV - Dispositions applicables à la zone UL  ........................... 67
      Chapitre V  - Dispositions applicables à la zone UM  ........................... 90
      Chapitre VI - Dispositions applicables à la zone UP  ........................... 110
      Chapitre VII- Dispositions applicables à la zone UX  ........................... 140
      Chapitre VIII-Dispositions applicables à la zone AUs ........................... 160
      Chapitre IX - Dispositions applicables à la zone A   ........................... 171
      Chapitre X  - Dispositions applicables à la zone N   ........................... 180
    `;
    const toc = parseTocFromNativeText(text);
    expect(toc.map(z => z.code)).toEqual(["UA","UC","UJ","UL","UM","UP","UX","AUs","A","N"]);
    expect(toc.find(z => z.code === "UL")!.startPage).toBe(67);
    expect(toc.find(z => z.code === "AUs")!.startPage).toBe(160);
    expect(toc.find(z => z.code === "AUs")!.type).toBe("AU");
    expect(toc.find(z => z.code === "A")!.type).toBe("A");
    expect(toc.find(z => z.code === "N")!.type).toBe("N");
  });

  it("accepte le suffixe 'p.' ou 'page'", () => {
    const text = `
      Zone UA — Centre ancien ............ p. 7
      Zone UB — Faubourgs ................ page 18
      Zone N  — Espaces naturels ......... p. 50
    `;
    const toc = parseTocFromNativeText(text);
    expect(toc.map(z => [z.code, z.startPage])).toEqual([["UA", 7], ["UB", 18], ["N", 50]]);
  });

  it("ignore les mentions sans page (titres pleine page hors sommaire)", () => {
    const text = `
      Zone UA — Centre ancien ............ 7
      DISPOSITIONS APPLICABLES À LA ZONE UA
      Article UA 1 - Occupations autorisées
      Zone UB ........................ 18
    `;
    // minZones=2 car le test focalise sur le filtrage des titres pleine page.
    const toc = parseTocFromNativeText(text, 2);
    expect(toc.map(z => z.code)).toEqual(["UA", "UB"]);
  });

  it("renvoie [] si moins de minZones (signal pour basculer sur Pixtral)", () => {
    const text = "Zone UA ........... 7\nZone UB ......... 12\n";
    expect(parseTocFromNativeText(text, 3)).toEqual([]);
    expect(parseTocFromNativeText(text, 2)).toHaveLength(2);
  });

  it("trie par page croissante même si le sommaire est en désordre", () => {
    const text = `
      Zone N  — Espaces naturels ........ 180
      Zone UA — Centre .................. 7
      Zone UC — Faubourgs ............... 33
    `;
    const toc = parseTocFromNativeText(text);
    expect(toc.map(z => z.code)).toEqual(["UA", "UC", "N"]);
  });

  it("ignore le texte vide / sans 'zone'", () => {
    expect(parseTocFromNativeText("")).toEqual([]);
    expect(parseTocFromNativeText("Article 1 - Occupations ........... 7")).toEqual([]);
  });
});
