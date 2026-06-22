/**
 * Calibration de l'extraction PLU — exemple de référence « few-shot ».
 *
 * Problème : chaque commune rédige son règlement différemment. Pour que TOUTES
 * les zones importées sortent au MÊME niveau de structuration (découpage en
 * sous-règles, sémantique min/max, `cases` condition vs parametre, `exceptions`
 * isolées, `applies_if`, version citoyen), on montre au modèle UN exemple réel
 * déjà validé à la main : la zone UC du PLU de Ballan-Miré.
 *
 * Cet exemple est injecté dans les prompts d'extraction (production + CLI) via
 * `calibrationFewShot()`. Il sert de POINT DE RÉFÉRENCE — le modèle doit
 * reproduire le NIVEAU DE QUALITÉ, jamais recopier les valeurs (propres à cette
 * commune).
 *
 * Garde-fou : `calibration.test.ts` valide chaque règle contre le schéma du
 * structurer ET contre le schéma canonique → l'exemple ne peut pas dériver vers
 * une sortie que le parser rejetterait.
 */

/** Forme de sortie attendue d'une (sous-)règle, telle que les prompts la décrivent. */
export interface CalibrationExampleRule {
  sub_theme: string;
  article_number: number | null;
  article_title: string;
  topic: string;
  rule_text: string;
  value_min: number | null;
  value_max: number | null;
  value_exact: number | null;
  unit: string | null;
  conditions: string | null;
  exceptions: string | null;
  summary: string;
  cases: Array<{ condition: string; value: number | null; unit: string | null; kind: "condition" | "parametre" }>;
  applies_if: string[];
  citizen_title: string;
  citizen_summary: string;
  citizen_relevant: boolean;
}

export const CALIBRATION_SOURCE = "PLU de Ballan-Miré (37) — zone UC, modification n°5 (exemple validé à la main)";

/** Texte d'articles donné en entrée de l'exemple (fidèle, condensé). */
export const CALIBRATION_INPUT_TEXT = `Zone UC (quartiers pavillonnaires). Extrait du règlement.

UC-ARTICLE 6 — Implantation par rapport aux voies et emprises publiques :
Les constructions doivent être implantées soit avec un recul minimal de 3 mètres, soit en s'alignant sur une construction voisine sur le terrain ou sur un terrain contigu. Le long de la RD751, le recul minimal est de 40 mètres par rapport à l'axe de la voie. Les ouvrages nécessaires au fonctionnement des services publics peuvent, pour raisons techniques justifiées, ne pas respecter cette règle.

UC-ARTICLE 10 — Hauteur maximale des constructions :
La hauteur maximale des constructions est de 6,5 mètres à l'égout de toiture ou à l'acrotère, et de 9 mètres au faîtage. La hauteur des constructions en cœur d'îlot est limitée à celle de la construction voisine la plus proche. Il n'est pas fixé de hauteur maximale pour les constructions et installations nécessaires aux services publics ou d'intérêt collectif.

UC-ARTICLE 12 — Stationnement (extrait du tableau) :
Logements non aidés : 2 places par logement. Logements locatifs financés par l'État : 1 place par logement construit (aucune place exigée pour la transformation ou l'amélioration de logements locatifs aidés).

UC-ARTICLE 13 — Espaces libres et plantations :
Tout terrain recevant une construction doit comporter au moins 40 % d'espaces libres en pleine terre. Cette règle ne s'applique pas aux extensions des constructions présentes sur le terrain à la date du 2 juillet 2015. Les espaces libres sont plantés à raison d'un arbre de haute tige pour 100 m², les parkings à raison d'un arbre pour 50 m².

UC-ARTICLE 2 — Occupations soumises à conditions (secteur inondable UCi) :
Dans le secteur UCi, les constructions nouvelles à usage d'habitation doivent comporter un premier niveau de plancher à 0,50 m au moins au-dessus du terrain naturel et un étage habitable au-dessus des plus hautes eaux connues, dans le respect du PPRI.`;

/** Sortie attendue — référence. Couvre tous les patterns durs du format. */
export const CALIBRATION_RULES: CalibrationExampleRule[] = [
  {
    sub_theme: "6.1 Recul par rapport aux voies",
    article_number: 6,
    article_title: "Implantation des constructions par rapport aux voies et emprises publiques",
    topic: "recul_voie",
    rule_text:
      "Les constructions doivent être implantées avec un recul minimal de 3 m, ou en s'alignant sur une construction voisine. Le long de la RD751, le recul minimal est de 40 m par rapport à l'axe de la voie.",
    value_min: 3,
    value_max: null,
    value_exact: null,
    unit: "m",
    conditions: "Alignement possible sur une construction voisine du terrain ou contiguë.",
    exceptions: "Ouvrages nécessaires au fonctionnement des services publics, pour raisons techniques justifiées.",
    summary: "Recul ≥ 3 m de la voie ; 40 m le long de la RD751.",
    cases: [{ condition: "Le long de la RD751 (par rapport à l'axe)", value: 40, unit: "m", kind: "condition" }],
    applies_if: [],
    citizen_title: "Distance avec la rue",
    citizen_summary:
      "Votre construction doit être à au moins 3 mètres de la voie (ou alignée sur une maison voisine). Le long de la RD751, ce recul passe à 40 mètres.",
    citizen_relevant: true,
  },
  {
    sub_theme: "10.1 Hauteur maximale",
    article_number: 10,
    article_title: "Hauteur maximale des constructions",
    topic: "hauteur",
    rule_text:
      "La hauteur maximale des constructions est de 6,5 m à l'égout de toiture ou à l'acrotère, et de 9 m au faîtage. En cœur d'îlot, elle est limitée à celle de la construction voisine la plus proche.",
    value_min: null,
    value_max: 9,
    value_exact: null,
    unit: "m",
    conditions: "En cœur d'îlot : hauteur plafonnée à la construction voisine la plus proche.",
    exceptions:
      "Pas de hauteur maximale pour les constructions et installations nécessaires aux services publics ou d'intérêt collectif.",
    summary: "6,5 m à l'égout / 9 m au faîtage.",
    cases: [
      { condition: "À l'égout de toiture ou à l'acrotère", value: 6.5, unit: "m", kind: "condition" },
      { condition: "Au faîtage", value: 9, unit: "m", kind: "condition" },
    ],
    applies_if: [],
    citizen_title: "Hauteur des maisons",
    citizen_summary: "Votre maison peut monter jusqu'à 9 mètres au sommet du toit (ou 6,5 mètres si le toit est plat).",
    citizen_relevant: true,
  },
  {
    sub_theme: "12.1 Logements non aidés",
    article_number: 12,
    article_title: "Obligations en matière d'aires de stationnement",
    topic: "stationnement",
    rule_text: "Pour les logements non aidés : 2 places de stationnement par logement.",
    value_min: null,
    value_max: null,
    value_exact: 2,
    unit: "places",
    conditions: null,
    exceptions: null,
    summary: "2 places par logement non aidé.",
    cases: [],
    applies_if: [],
    citizen_title: "Places de parking",
    citizen_summary: "Vous devez prévoir 2 places de stationnement par logement.",
    citizen_relevant: true,
  },
  {
    sub_theme: "12.2 Logements locatifs aidés par l'État",
    article_number: 12,
    article_title: "Obligations en matière d'aires de stationnement",
    topic: "stationnement",
    rule_text: "Pour les logements locatifs financés par l'État : 1 place par logement construit.",
    value_min: null,
    value_max: null,
    value_exact: 1,
    unit: "places",
    conditions: null,
    exceptions: "Aucune place exigée pour la transformation ou l'amélioration de logements locatifs aidés.",
    summary: "1 place par logement locatif aidé.",
    cases: [],
    applies_if: [],
    citizen_title: "Parking (logement social)",
    citizen_summary: "Pour un logement locatif aidé par l'État, une seule place de stationnement est demandée.",
    citizen_relevant: true,
  },
  {
    sub_theme: "13.1 Espaces libres en pleine terre",
    article_number: 13,
    article_title: "Espaces libres, aires de jeux et plantations",
    topic: "espaces_verts",
    rule_text:
      "Tout terrain recevant une construction doit comporter au moins 40 % d'espaces libres en pleine terre. Les espaces libres sont plantés à raison d'un arbre de haute tige pour 100 m², les parkings d'un arbre pour 50 m².",
    value_min: 40,
    value_max: null,
    value_exact: null,
    unit: "%",
    conditions: null,
    exceptions:
      "Ne s'applique pas aux extensions des constructions présentes sur le terrain à la date du 2 juillet 2015.",
    summary: "40 % de pleine terre min. ; 1 arbre / 100 m².",
    cases: [
      { condition: "Arbres de haute tige sur les espaces libres (1 pour 100 m²)", value: 1, unit: null, kind: "parametre" },
      { condition: "Arbres de haute tige sur les parkings (1 pour 50 m²)", value: 1, unit: null, kind: "parametre" },
    ],
    applies_if: [],
    citizen_title: "Jardin et plantations",
    citizen_summary:
      "Au moins 40 % de votre terrain doit rester en pleine terre (jardin), avec un arbre de haute tige planté pour 100 m².",
    citizen_relevant: true,
  },
  {
    sub_theme: "Secteur inondable UCi — niveau de plancher",
    article_number: 2,
    article_title: "Occupations et utilisations du sol soumises à conditions particulières",
    topic: "conditions",
    rule_text:
      "Dans le secteur UCi, les constructions nouvelles à usage d'habitation doivent comporter un premier niveau de plancher à 0,50 m au moins au-dessus du terrain naturel et un étage habitable au-dessus des plus hautes eaux connues.",
    value_min: 0.5,
    value_max: null,
    value_exact: null,
    unit: "m",
    conditions: "Respect des prescriptions du PPRI.",
    exceptions: null,
    summary: "UCi : plancher +0,50 m et étage refuge.",
    cases: [],
    applies_if: ["inondable"],
    citizen_title: "Terrain inondable",
    citizen_summary:
      "Si votre terrain est en secteur inondable, le plancher doit être surélevé d'au moins 50 cm et un étage refuge prévu.",
    citizen_relevant: true,
  },
];

/**
 * Bloc « few-shot » à concaténer au prompt système d'extraction. Compact et
 * auto-suffisant ; insiste sur « reproduire le niveau, pas recopier les valeurs ».
 */
export function calibrationFewShot(): string {
  return [
    "",
    "==================== EXEMPLE DE RÉFÉRENCE (calibration) ====================",
    `L'exemple ci-dessous provient d'un règlement réel déjà validé (${CALIBRATION_SOURCE}). Il fixe le NIVEAU DE STRUCTURATION ATTENDU : découpage en sous-règles, sémantique min/max, "cases" (condition = alternative exclusive, ex. 6,5 m à l'égout / 9 m au faîtage ; parametre = valeur cumulative, ex. 1 arbre / 100 m²), "exceptions" isolées du rule_text, "applies_if" pour le contexte parcellaire (ex. inondable), et version citoyen claire.`,
    `IMPÉRATIF : reproduis ce NIVEAU DE QUALITÉ, mais NE RECOPIE PAS ces valeurs ni ces libellés — ils sont propres à cette commune. Extrais UNIQUEMENT le contenu du texte qu'on te donne ensuite.`,
    "",
    "ENTRÉE (texte d'articles) :",
    CALIBRATION_INPUT_TEXT,
    "",
    "SORTIE ATTENDUE (tableau JSON) :",
    JSON.stringify(CALIBRATION_RULES),
    "==================== FIN DE L'EXEMPLE ====================",
    "",
  ].join("\n");
}
