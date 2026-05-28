// Pièces requises officielles par type d'autorisation
// Basé sur l'arrêté du 13 février 2020 et les bordereaux CERFA (16702*02, 13406*16, 13409*16)

export interface PiecesContext {
  natures: string[];
  surface: number;
  hasABF: boolean;
  hasModifAspect: boolean;
  hasConstruction: boolean;
  hasChangementDestination: boolean;
  amenagementType?: string;
  // Situations particulières (step 5 CERFA)
  isLotissement?: boolean;
  isERP?: boolean;
  hasDefrichement?: boolean;
  isNatura2000?: boolean;
  isClimateResilience?: boolean;
}

interface Piece {
  code: string;
  nom: string;
  requis: boolean | ((ctx: PiecesContext) => boolean);
  aide: string;
}

// ── Déclaration Préalable ─────────────────────────────────────────────────────
const PIECES_DP: Piece[] = [
  {
    code: "DP1",
    nom: "Plan de situation du terrain (DP1)",
    requis: true,
    aide: "Extrait de plan localisant le terrain dans la commune. Disponible sur Géoportail (geoportail.gouv.fr) ou le cadastre (cadastre.gouv.fr).",
  },
  {
    code: "DP2",
    nom: "Plan de masse des constructions (DP2)",
    requis: (ctx) => ctx.hasConstruction || ctx.hasChangementDestination,
    aide: "Vue de dessus à l'échelle avec les constructions existantes et projetées, leurs dimensions et distances aux limites séparatives.",
  },
  {
    code: "DP3",
    nom: "Plan en coupe du terrain et de la construction (DP3)",
    requis: (ctx) => ctx.hasConstruction || ctx.natures.includes("agrandissement"),
    aide: "Coupe verticale montrant le terrain naturel, la construction et les niveaux (sous-sol, rez-de-chaussée, étages).",
  },
  {
    code: "DP4",
    nom: "Notice descriptive du terrain et du projet (DP4)",
    requis: true,
    aide: "Description de l'état actuel du terrain, des matériaux utilisés, et de l'aspect extérieur après travaux. Format libre.",
  },
  {
    code: "DP5",
    nom: "Plans des façades et des toitures (DP5)",
    requis: (ctx) => ctx.hasModifAspect || ctx.hasConstruction || ctx.hasChangementDestination,
    aide: "Représentation de toutes les façades (avant / après travaux) avec les matériaux, couleurs et ouvertures. Inclure la toiture si modifiée.",
  },
  {
    code: "DP6",
    nom: "Document graphique d'insertion dans l'environnement (DP6)",
    requis: (ctx) => ctx.hasConstruction || ctx.hasABF || ctx.hasChangementDestination,
    aide: "Photomontage, croquis perspectif ou vue 3D montrant comment le projet s'insère dans son environnement bâti et paysager. Requis si construction visible depuis l'espace public ou terrain en périmètre protégé.",
  },
  {
    code: "DP7",
    nom: "Photographies de situation (DP7)",
    requis: (ctx) => ctx.hasConstruction || ctx.hasABF || ctx.hasChangementDestination || ctx.hasModifAspect,
    aide: "Au minimum : 1 photo depuis la rue/voie publique, 1 photo depuis le terrain vers les constructions voisines. Doit permettre de situer le terrain dans son environnement proche et lointain.",
  },
  {
    code: "DP8",
    nom: "Consultation de l'Architecte des Bâtiments de France (ABF)",
    requis: (ctx) => ctx.hasABF,
    aide: "Votre terrain est en périmètre ABF. La mairie saisit automatiquement l'ABF — vous n'avez pas à joindre son avis. Prévoyez +1 mois de délai.",
  },
  // ── Pièces situationnelles ──
  {
    code: "DPC11-2",
    nom: "Dossier d'évaluation des incidences Natura 2000 (DPC11-2)",
    requis: (ctx) => !!ctx.isNatura2000,
    aide: "Évaluation des incidences de votre projet sur un site Natura 2000, conformément à l'article R. 414-23 du Code de l'environnement. À faire établir par un bureau d'études environnement.",
  },
  {
    code: "DPC32",
    nom: "Attestation Loi Climat & Résilience — art. R.171-35 (DPC32)",
    requis: (ctx) => !!ctx.isClimateResilience && ctx.hasConstruction,
    aide: "Attestation certifiant le respect des exigences de l'article 101 de la loi n°2021-1104 du 22 août 2021 (loi Climat et Résilience). À établir par le maître d'œuvre ou l'architecte.",
  },
];

// ── Permis de Construire ──────────────────────────────────────────────────────
const PIECES_PC: Piece[] = [
  {
    code: "PC1",
    nom: "Plan de situation du terrain (PC1)",
    requis: true,
    aide: "Extrait de cadastre ou de plan topographique localisant le terrain dans la commune.",
  },
  {
    code: "PC2",
    nom: "Plan de masse coté dans les 3 dimensions (PC2)",
    requis: true,
    aide: "Vue de dessus à l'échelle avec toutes les constructions existantes et projetées, cotes, distances aux limites, orientation et niveaux altimétriques.",
  },
  {
    code: "PC3",
    nom: "Plan en coupe coté du terrain et de la construction (PC3)",
    requis: true,
    aide: "Coupe verticale montrant le niveau du terrain naturel, la hauteur des constructions, les niveaux intérieurs et les fondations si pertinent.",
  },
  {
    code: "PC4",
    nom: "Notice descriptive du terrain et du projet (PC4)",
    requis: true,
    aide: "Description détaillée : état actuel du terrain, matériaux et techniques de construction, aspect extérieur (couleurs, toiture, menuiseries).",
  },
  {
    code: "PC5",
    nom: "Plans des façades et des toitures (PC5)",
    requis: true,
    aide: "Toutes les façades représentées (état existant + état projeté), avec matériaux, couleurs, cotes de hauteur et ouvertures.",
  },
  {
    code: "PC6",
    nom: "Document graphique d'insertion dans l'environnement (PC6)",
    requis: true,
    aide: "Représentation 3D, photomontage ou croquis perspectif du projet dans son environnement immédiat.",
  },
  {
    code: "PC7",
    nom: "Photographies de situation (PC7)",
    requis: true,
    aide: "Photos depuis la rue et depuis le terrain vers les quatre horizons. Doit permettre d'apprécier l'insertion dans le tissu existant.",
  },
  {
    code: "PC8",
    nom: "Attestation de prise en compte de la RE2020",
    requis: (ctx) => ctx.surface >= 50 && ctx.natures.includes("maison_neuve"),
    aide: "Attestation établie par un bureau d'étude thermique ou l'architecte certifiant la conformité à la Réglementation Environnementale 2020.",
  },
  // ── Pièces situationnelles ──
  {
    code: "PC16",
    nom: "Dossier d'incidences Natura 2000 (PC16)",
    requis: (ctx) => !!ctx.isNatura2000,
    aide: "Évaluation des incidences du projet sur un site Natura 2000 (art. R. 414-23 du Code de l'environnement). À faire établir par un bureau d'études environnement.",
  },
  {
    code: "PC24",
    nom: "Autorisation de défrichement — lettre du préfet (PC24)",
    requis: (ctx) => !!ctx.hasDefrichement,
    aide: "Copie de la lettre du préfet attestant que votre demande d'autorisation de défrichement est complète (art. R. 431-19 CU). À déposer en préfecture avant le PC.",
  },
  {
    code: "PC28",
    nom: "Certificat de surface constructible du lot — lotissement (PC28)",
    requis: (ctx) => !!ctx.isLotissement,
    aide: "Certificat indiquant la surface de plancher constructible attribuée à votre lot, délivré par le lotisseur (art. R. 442-11 CU).",
  },
  {
    code: "PC29",
    nom: "Certificat d'achèvement des équipements du lotissement (PC29)",
    requis: (ctx) => !!ctx.isLotissement,
    aide: "Certificat attestant l'achèvement des équipements (voirie, réseaux eau/électricité) desservant votre lot (art. R. 431-22-1 CU).",
  },
  {
    code: "PC39",
    nom: "Dossier accessibilité personnes handicapées — ERP (PC39)",
    requis: (ctx) => !!ctx.isERP,
    aide: "Dossier spécifique vérifiant la conformité du projet aux règles d'accessibilité aux personnes handicapées (art. R. 122-11 a) CCH). 3 exemplaires requis en version papier.",
  },
  {
    code: "PC40",
    nom: "Dossier sécurité incendie — ERP (PC40)",
    requis: (ctx) => !!ctx.isERP,
    aide: "Dossier spécifique vérifiant la conformité aux règles de sécurité contre l'incendie (art. R. 122-11 b) CCH). 3 exemplaires requis en version papier.",
  },
  {
    code: "PC47",
    nom: "Attestation Loi Climat & Résilience — art. R.171-35 (PC47)",
    requis: (ctx) => !!ctx.isClimateResilience,
    aide: "Attestation certifiant la conformité aux exigences de la loi n°2021-1104 du 22 août 2021 (article 101). À établir par le maître d'œuvre ou l'architecte.",
  },
];

// ── Permis de Démolir ─────────────────────────────────────────────────────────
const PIECES_DEMOLIR: Piece[] = [
  {
    code: "PD1",
    nom: "Plan de situation du terrain",
    requis: true,
    aide: "Localisation du terrain dans la commune (cadastre, Géoportail).",
  },
  {
    code: "PD2",
    nom: "Plan de masse indiquant les constructions à démolir",
    requis: true,
    aide: "Vue de dessus délimitant clairement les constructions à démolir (hachurage) et celles maintenues.",
  },
  {
    code: "PD3",
    nom: "Photographies extérieures des constructions à démolir",
    requis: true,
    aide: "Photos de toutes les façades des bâtiments concernés, prises depuis l'extérieur.",
  },
  {
    code: "PD4",
    nom: "Notice descriptive de l'état actuel et du projet",
    requis: true,
    aide: "Description de l'état de la construction, des raisons de la démolition, et de l'état envisagé du terrain après.",
  },
];

// ── Certificat d'urbanisme ────────────────────────────────────────────────────
const PIECES_CU: Piece[] = [
  {
    code: "CU1",
    nom: "Plan de situation du terrain",
    requis: true,
    aide: "Extrait cadastral ou plan localisant précisément le terrain dans la commune.",
  },
  {
    code: "CU2",
    nom: "Plan sommaire du terrain",
    requis: true,
    aide: "Plan simple indiquant les bâtiments existants, les arbres remarquables et les accès. Peut être un extrait cadastral annoté.",
  },
];

export function buildPiecesContext(
  natures: string[],
  surface: number,
  servitudes?: Array<{ categorie?: string; libelle?: string }>,
  amenagementType?: string,
  situational?: {
    isLotissement?: boolean;
    isERP?: boolean;
    hasDefrichement?: boolean;
    isNatura2000?: boolean;
    isClimateResilience?: boolean;
  },
): PiecesContext {
  return {
    natures,
    surface,
    hasABF: (servitudes ?? []).some(
      (s) => s.categorie?.toUpperCase().startsWith("AC") || s.libelle?.toLowerCase().includes("abf"),
    ),
    hasModifAspect: natures.includes("modification_aspect"),
    hasConstruction: natures.some((n) =>
      ["maison_neuve", "agrandissement", "petite_construction"].includes(n),
    ),
    hasChangementDestination: natures.includes("changement_destination"),
    amenagementType,
    isLotissement: situational?.isLotissement,
    isERP: situational?.isERP,
    hasDefrichement: situational?.hasDefrichement,
    isNatura2000: situational?.isNatura2000,
    isClimateResilience: situational?.isClimateResilience,
  };
}

export function getPiecesForType(
  type: string,
  ctx: PiecesContext,
): Array<{ nom: string; requis: boolean; aide: string }> {
  let pieces: Piece[];
  switch (type) {
    case "declaration_prealable": pieces = PIECES_DP; break;
    case "permis_de_construire": pieces = PIECES_PC; break;
    case "permis_demolir": pieces = PIECES_DEMOLIR; break;
    case "certificat_urbanisme": pieces = PIECES_CU; break;
    default: pieces = PIECES_DP;
  }

  return pieces.map((p) => ({
    nom: p.nom,
    requis: typeof p.requis === "function" ? p.requis(ctx) : p.requis,
    aide: p.aide,
  }));
}
