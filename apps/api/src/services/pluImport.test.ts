import { describe, it, expect } from "vitest";
import { partitionPagesByZone, chunkPages, assertTocCoverage, parseTocFromNativeText, parseTocFromHeadings, realignTocToPhysicalPages, toArticleInt, isUsableRule, dedupeRules, mergeRulesByZoneCode, normalizeZoneCode, zoneTypeFromCode } from "./pluImport.ts";

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

  it("détecte les zones à urbaniser 3AU/4AU (cas Rochecorbon)", () => {
    // Régression : la regex `[12]?AU` perdait 3AU/4AU → 8 zones au lieu de 9.
    const text = `
      REGLEMENT DE LA ZONE 1AU                                          25
      REGLEMENT DE LA ZONE 2AU                                          33
      REGLEMENT DE LA ZONE 3AU                                          41
      REGLEMENT DE LA ZONE AU                                           49
    `;
    const toc = parseTocFromNativeText(text);
    expect(toc.map(z => z.code)).toEqual(["1AU", "2AU", "3AU", "AU"]);
    expect(toc.find(z => z.code === "3AU")!.type).toBe("AU");
  });
});

describe("realignTocToPhysicalPages", () => {
  // Reproduit Rochecorbon : sommaire en pages IMPRIMÉES (UA=1…), corps décalé
  // de +4 (2 couvertures + sommaire + page de titre) avec un titre de chapitre
  // « Règlement de la zone X : … » en tête de chaque section.
  const toc = [
    { code: "UA", label: "Zone UA", type: "U", startPage: 1 },
    { code: "UB", label: "Zone UB", type: "U", startPage: 9 },
    { code: "3AU", label: "Zone 3AU", type: "AU", startPage: 41 },
    { code: "N", label: "Zone N", type: "N", startPage: 65 },
  ];
  const bodyPages = (starts: Record<string, number>, total: number): string[] => {
    const pages = Array.from({ length: total }, () => "Règlement — page de corps quelconque");
    for (const [code, p] of Object.entries(starts)) {
      pages[p - 1] = `Règlement                    Zone ${code}\nRèglement de la zone ${code} : intitulé`;
    }
    return pages;
  };

  it("réaligne les ancres imprimées sur les pages physiques (+4)", () => {
    const pages = bodyPages({ UA: 5, UB: 13, "3AU": 45, N: 69 }, 79);
    const fixed = realignTocToPhysicalPages(toc, pages);
    expect(fixed.map(z => [z.code, z.startPage])).toEqual([
      ["UA", 5], ["UB", 13], ["3AU", 45], ["N", 69],
    ]);
  });

  it("no-op quand la numérotation imprimée == physique (ex. Tours)", () => {
    const pages = bodyPages({ UA: 1, UB: 9, "3AU": 41, N: 65 }, 80);
    expect(realignTocToPhysicalPages(toc, pages)).toEqual(toc);
  });

  it("no-op quand aucun titre de chapitre n'est reconnu dans le corps", () => {
    const pages = Array.from({ length: 80 }, () => "texte sans titre de chapitre de zone");
    expect(realignTocToPhysicalPages(toc, pages)).toEqual(toc);
  });

  it("ignore les pages de sommaire (≥ 3 titres regroupés) comme source d'ancre", () => {
    const pages = Array.from({ length: 79 }, () => "corps");
    // Fausse page « sommaire » avec tous les titres regroupés → ne doit PAS
    // servir d'ancre (sinon décalage aberrant).
    pages[2] = toc.map(z => `Règlement de la zone ${z.code} : x`).join("\n");
    // Vrais débuts de chapitre, décalage +4.
    for (const [code, p] of Object.entries({ UA: 5, UB: 13, "3AU": 45, N: 69 })) {
      pages[p - 1] = `Règlement de la zone ${code} : intitulé`;
    }
    const fixed = realignTocToPhysicalPages(toc, pages);
    expect(fixed.find(z => z.code === "UA")!.startPage).toBe(5);
  });
});

describe("parseTocFromHeadings", () => {
  // Reproduit le cas réel signalé : sommaire SANS numéros de page, aplati sur
  // une seule ligne par l'extraction texte → la voie sommaire renvoie [].
  // Le règlement, lui, porte un en-tête de chapitre par zone dans son corps.
  const sommaireSansPages =
    "SOMMAIRE\n" +
    "DÉFINITIONS ---- CHAPITRE UA - DISPOSITIONS APPLICABLES A LA ZONE UA ---- " +
    "CHAPITRE UB - DISPOSITIONS APPLICABLES A LA ZONE UB ---- " +
    "CHAPITRE UC - DISPOSITIONS APPLICABLES A LA ZONE UC ---- " +
    "CHAPITRE UD - DISPOSITIONS APPLICABLES A LA ZONE UD ---- " +
    "CHAPITRE UY - DISPOSITIONS APPLICABLES A LA ZONE UY ---- " +
    "CHAPITRE I AU - DISPOSITIONS APPLICABLES A LA ZONE I AU ---- " +
    "CHAPITRE II AU - DISPOSITIONS APPLICABLES A LA ZONE II AU ---- " +
    "CHAPITRE N - DISPOSITIONS APPLICABLES A LA ZONE N ----";

  it("la voie sommaire échoue sur ce PDF (aucune page indiquée)", () => {
    // Pré-condition du repli : parseTocFromNativeText ne sait rien en tirer.
    expect(parseTocFromNativeText(sommaireSansPages)).toEqual([]);
  });

  it("récupère les 8 zones + pages via les en-têtes du corps, sommaire exclu", () => {
    const pages = [
      sommaireSansPages,                                          // p1 : sommaire (8 en-têtes → exclu)
      "DISPOSITIONS GENERALES\nChamp d'application…",             // p2
      "CHAPITRE UA - DISPOSITIONS APPLICABLES A LA ZONE UA\nArticle UA 1", // p3
      "suite de la zone UA…",                                     // p4
      "CHAPITRE UB - DISPOSITIONS APPLICABLES A LA ZONE UB",      // p5
      "CHAPITRE UC - DISPOSITIONS APPLICABLES A LA ZONE UC",      // p6
      "CHAPITRE UD - DISPOSITIONS APPLICABLES A LA ZONE UD",      // p7
      "CHAPITRE UY - DISPOSITIONS APPLICABLES A LA ZONE UY",      // p8
      "CHAPITRE I AU - DISPOSITIONS APPLICABLES A LA ZONE I AU",  // p9
      "CHAPITRE II AU - DISPOSITIONS APPLICABLES A LA ZONE II AU",// p10
      "CHAPITRE N - DISPOSITIONS APPLICABLES A LA ZONE N",        // p11
    ];
    const toc = parseTocFromHeadings(pages);
    expect(toc.map((z) => [z.code, z.startPage])).toEqual([
      ["UA", 3], ["UB", 5], ["UC", 6], ["UD", 7], ["UY", 8], ["1AU", 9], ["2AU", 10], ["N", 11],
    ]);
    // Codes AU en chiffres romains → normalisés en 1AU/2AU, type AU.
    expect(toc.find((z) => z.code === "1AU")!.type).toBe("AU");
    expect(toc.find((z) => z.code === "N")!.type).toBe("N");
  });

  it("retient la PREMIÈRE page de corps quand un en-tête réapparaît", () => {
    const pages = [
      "CHAPITRE UA - DISPOSITIONS APPLICABLES A LA ZONE UA",          // p1
      "rappel : DISPOSITIONS APPLICABLES A LA ZONE UA (suite)",       // p2 — ne doit pas écraser
      "CHAPITRE UB - DISPOSITIONS APPLICABLES A LA ZONE UB",          // p3
      "CHAPITRE N - DISPOSITIONS APPLICABLES A LA ZONE N",            // p4
    ];
    const toc = parseTocFromHeadings(pages);
    expect(toc.find((z) => z.code === "UA")!.startPage).toBe(1);
    expect(toc.map((z) => z.code)).toEqual(["UA", "UB", "N"]);
  });

  it("renvoie [] si moins de minZones en-têtes trouvés", () => {
    const pages = [
      "CHAPITRE UA - DISPOSITIONS APPLICABLES A LA ZONE UA",
      "CHAPITRE UB - DISPOSITIONS APPLICABLES A LA ZONE UB",
    ];
    expect(parseTocFromHeadings(pages, 3)).toEqual([]);
    expect(parseTocFromHeadings(pages, 2)).toHaveLength(2);
  });

  it("ignore une simple référence en milieu de paragraphe (non ancrée en début de ligne)", () => {
    const pages = [
      "Le pétitionnaire se réfère aux dispositions applicables à la zone UA puis poursuit.",
      "CHAPITRE UB - DISPOSITIONS APPLICABLES A LA ZONE UB",
      "CHAPITRE UC - DISPOSITIONS APPLICABLES A LA ZONE UC",
      "CHAPITRE N - DISPOSITIONS APPLICABLES A LA ZONE N",
    ];
    const toc = parseTocFromHeadings(pages);
    // La mention noyée p1 (pas en début de ligne, pas un en-tête « CHAPITRE … - »)
    // n'est pas captée comme ancre de début de zone.
    expect(toc.map((z) => z.code)).toEqual(["UB", "UC", "N"]);
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

describe("mergeRulesByZoneCode", () => {
  it("garde les zones autonomes quand les codes sont disjoints entre PDF (découpage par type de zone)", () => {
    // Cas typique : PLUi livré en 4 PDF (U / AU / A / N), chacun son sommaire.
    const groups = mergeRulesByZoneCode([
      { code: "UA", label: "Zone UA", type: "U", rules: [{ rule_text: "r1" }] },
      { code: "UC", label: "Zone UC", type: "U", rules: [{ rule_text: "r2" }] },
      { code: "A", label: "Zone A", type: "A", rules: [{ rule_text: "r3" }] },
      { code: "N", label: "Zone N", type: "N", rules: [{ rule_text: "r4" }] },
    ]);
    expect(groups.map((g) => g.zoneDef.code)).toEqual(["UA", "UC", "A", "N"]);
    expect(groups.every((g) => g.rules.length === 1)).toBe(true);
  });

  it("fusionne les règles d'un même code présent dans plusieurs PDF", () => {
    const groups = mergeRulesByZoneCode([
      { code: "UA", label: "Zone UA", type: "U", rules: [{ rule_text: "a" }, { rule_text: "b" }] },
      { code: "UA", label: "Zone UA", type: "U", rules: [{ rule_text: "c" }] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rules.map((r) => r.rule_text)).toEqual(["a", "b", "c"]);
  });

  it("retient le label le plus informatif lors d'une fusion", () => {
    const groups = mergeRulesByZoneCode([
      { code: "UA", label: "Zone UA", type: "U", rules: [] },
      { code: "UA", label: "Zone UA – Centre ancien", type: "U", rules: [] },
    ]);
    expect(groups[0]!.zoneDef.label).toBe("Zone UA – Centre ancien");
  });

  it("préserve l'ordre de première apparition des codes", () => {
    const groups = mergeRulesByZoneCode([
      { code: "N", label: "N", type: "N", rules: [] },
      { code: "UA", label: "UA", type: "U", rules: [] },
      { code: "N", label: "N", type: "N", rules: [] },
    ]);
    expect(groups.map((g) => g.zoneDef.code)).toEqual(["N", "UA"]);
  });

  it("ne mute pas les tableaux de règles source", () => {
    const src = [{ rule_text: "x" }];
    const groups = mergeRulesByZoneCode([{ code: "UA", label: "UA", type: "U", rules: src }]);
    groups[0]!.rules.push({ rule_text: "y" });
    expect(src).toHaveLength(1);
  });
});

describe("normalizeZoneCode", () => {
  it("met le préfixe à 2 lettres en majuscules quelle que soit la casse d'entrée", () => {
    expect(normalizeZoneCode("ua")).toBe("UA");
    expect(normalizeZoneCode("Ua")).toBe("UA");
    expect(normalizeZoneCode("UA")).toBe("UA");
    expect(normalizeZoneCode(" uc ")).toBe("UC");
  });

  it("garde AU majuscule et met le suffixe en minuscule", () => {
    expect(normalizeZoneCode("aus")).toBe("AUs");
    expect(normalizeZoneCode("AUS")).toBe("AUs");
    expect(normalizeZoneCode("1au")).toBe("1AU");
    expect(normalizeZoneCode("2AUb")).toBe("2AUb");
  });

  it("convertit les zones AU en chiffres romains ou espacés (I AU → 1AU)", () => {
    // Sommaire/en-têtes réels : « ZONE I AU », « ZONE II AU ».
    expect(normalizeZoneCode("I AU")).toBe("1AU");
    expect(normalizeZoneCode("II AU")).toBe("2AU");
    expect(normalizeZoneCode("III AU")).toBe("3AU");
    expect(normalizeZoneCode("1 AU")).toBe("1AU");
    expect(normalizeZoneCode("ii au")).toBe("2AU");
  });

  it("normalise les sous-zones N/A avec suffixe minuscule", () => {
    expect(normalizeZoneCode("nj")).toBe("Nj");
    expect(normalizeZoneCode("NJ")).toBe("Nj");
    expect(normalizeZoneCode("ah")).toBe("Ah");
  });

  it("rend identiques deux casses différentes issues de sources distinctes (natif vs Pixtral)", () => {
    // C'est l'invariant qui permet à mergeRulesByZoneCode de fusionner.
    expect(normalizeZoneCode("UA")).toBe(normalizeZoneCode("ua"));
    expect(normalizeZoneCode("AUs")).toBe(normalizeZoneCode("AUS"));
  });

  it("renvoie une chaîne vide pour une entrée vide", () => {
    expect(normalizeZoneCode("   ")).toBe("");
    expect(normalizeZoneCode("")).toBe("");
  });
});

describe("zoneTypeFromCode", () => {
  it("déduit le type depuis le code normalisé", () => {
    expect(zoneTypeFromCode("UA")).toBe("U");
    expect(zoneTypeFromCode("AUs")).toBe("AU");
    expect(zoneTypeFromCode("1AU")).toBe("AU");
    expect(zoneTypeFromCode("A")).toBe("A");
    expect(zoneTypeFromCode("Ah")).toBe("A");
    expect(zoneTypeFromCode("N")).toBe("N");
    expect(zoneTypeFromCode("Nj")).toBe("N");
  });
});
