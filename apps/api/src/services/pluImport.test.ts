import { describe, it, expect } from "vitest";
import { partitionPagesByZone, chunkPages, assertTocCoverage, parseTocFromNativeText, toArticleInt, isUsableRule, dedupeRules } from "./pluImport.ts";

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

describe("toArticleInt", () => {
  it("renvoie null pour vide / null / undefined / non numérique", () => {
    // C'était la cause du crash : "" sur une colonne integer Postgres.
    expect(toArticleInt("")).toBeNull();
    expect(toArticleInt(null)).toBeNull();
    expect(toArticleInt(undefined)).toBeNull();
    expect(toArticleInt("abc")).toBeNull();
    expect(toArticleInt(NaN)).toBeNull();
  });

  it("tronque les sous-articles décimaux vers le numéro d'article entier", () => {
    expect(toArticleInt("12.2")).toBe(12); // article 12.2 → 12
    expect(toArticleInt(12.9)).toBe(12);
    expect(toArticleInt(7)).toBe(7);
    expect(toArticleInt("7")).toBe(7);
  });
});

describe("isUsableRule", () => {
  it("rejette les règles fantômes (topic ou rule_text vide/absent)", () => {
    expect(isUsableRule({})).toBe(false);
    expect(isUsableRule({ topic: "", rule_text: "" })).toBe(false);
    expect(isUsableRule({ topic: "hauteur", rule_text: "" })).toBe(false);
    expect(isUsableRule({ topic: "", rule_text: "9 m" })).toBe(false);
    expect(isUsableRule({ topic: "   ", rule_text: "   " })).toBe(false);
    expect(isUsableRule({ topic: undefined, rule_text: undefined })).toBe(false);
  });

  it("accepte une règle avec topic + rule_text non vides", () => {
    expect(isUsableRule({ topic: "hauteur", rule_text: "9 m au faîtage." })).toBe(true);
  });
});

describe("dedupeRules", () => {
  it("conserve les multiples règles d'un même article+topic (cas article 12 stationnement)", () => {
    // Régression : la fusion par (article, topic) ne gardait qu'UNE règle.
    // Article 12 stationnement d'un PLU porte typiquement 6+ règles
    // distinctes — toutes doivent passer.
    const rules = [
      { article_number: 12, topic: "stationnement", rule_text: "Habitation : 1 place par logement.", summary: "habitation 1pl/log" },
      { article_number: 12, topic: "stationnement", rule_text: "Commerce < 100 m² : 1 place pour 60 m² de surface de vente.", summary: "commerce 1pl/60m²" },
      { article_number: 12, topic: "stationnement", rule_text: "Bureaux : 1 place pour 40 m² de surface de plancher.", summary: "bureaux 1pl/40m²" },
      { article_number: 12, topic: "stationnement", rule_text: "Artisanat : 1 place pour 80 m² de surface de plancher.", summary: "artisanat 1pl/80m²" },
      { article_number: 12, topic: "stationnement", rule_text: "Hébergement hôtelier : 1 place par chambre.", summary: "hôtel 1pl/chambre" },
    ];
    expect(dedupeRules(rules)).toHaveLength(5);
  });

  it("déduplique les règles au texte quasi identique (chevauchement de lot)", () => {
    const rules = [
      { article_number: 10, topic: "hauteur", rule_text: "La hauteur maximale est fixée à 9 mètres au faîtage.", summary: "h<=9m" },
      { article_number: 10, topic: "hauteur", rule_text: "La hauteur maximale est fixée à 9 mètres au faîtage.", summary: "h<=9m" }, // doublon exact
      { article_number: 10, topic: "hauteur", rule_text: "  LA  HAUTEUR maximale est fixée à 9 mètres au faîtage.  ", summary: "h<=9m" }, // doublon (casse + espaces)
    ];
    const out = dedupeRules(rules);
    expect(out).toHaveLength(1);
  });

  it("garde toutes les règles dont le texte diverge réellement (cas du sous-secteur)", () => {
    // Side de sécurité : on préfère un doublon (réviseur humain peut couper)
    // à une règle perdue. Quand les rule_text divergent au-delà de la
    // normalisation, on garde les deux — c'est le cas des règles "préfixe
    // commun + précision différente" qui correspondent à des sous-secteurs.
    const rules = [
      { article_number: 7, topic: "recul_limite", rule_text: "En limite ou H/2 minimum 3 m en UA1.", summary: "UA1" },
      { article_number: 7, topic: "recul_limite", rule_text: "En limite ou H/2 minimum 5 m en UA2.", summary: "UA2" },
    ];
    expect(dedupeRules(rules)).toHaveLength(2);
  });

  it("garde la règle au rule_text le plus long quand les textes normalisés sont identiques", () => {
    const rules = [
      { article_number: 10, topic: "hauteur", rule_text: "9 m au faîtage.", summary: "..." },
      { article_number: 10, topic: "hauteur", rule_text: "9 m au faîtage.", summary: "..." },
    ];
    const out = dedupeRules(rules);
    expect(out).toHaveLength(1);
  });

  it("filtre les règles fantômes (rule_text vide) au passage", () => {
    const rules = [
      { article_number: 1, topic: "destinations", rule_text: "Sont autorisées les constructions à usage d'habitation.", summary: "habit autorisé" },
      { article_number: 1, topic: "destinations", rule_text: "", summary: "" },
      { article_number: null, topic: "", rule_text: "Texte sans topic.", summary: "" },
    ];
    const out = dedupeRules(rules);
    expect(out).toHaveLength(1);
  });
});
