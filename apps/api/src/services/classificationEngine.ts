// Moteur de classification déterministe — Code de l'urbanisme
// Références : R421-1, R421-9, R421-12, R421-13, R421-17, R421-19, R421-23,
//              R421-27, R421-28, R431-2, L410-1

export type AuthType =
  | "declaration_prealable"
  | "permis_de_construire"          // PC (autre que maison individuelle)
  | "permis_de_construire_mi"       // PCMI (maison individuelle)
  | "permis_amenager"
  | "permis_demolir"
  | "certificat_urbanisme_a"        // CUa (informatif)
  | "certificat_urbanisme_b"        // CUb (opérationnel)
  | "aucune_autorisation";

export type AuthSubtype =
  | "cu_a"          // CU informatif
  | "cu_b"          // CU opérationnel
  | "pcmi"          // PC maison individuelle
  | "pc"            // PC standard (autres constructions)
  | "division"      // DP déclaration de division (sans voirie)
  | "pa_lotissement" // PA lotissement avec voirie
  | "pd";           // PD seul (démolition sans reconstruction)

export interface ClassificationInput {
  natures: string[];
  surface?: number;            // m² de surface plancher créée
  empriseExistante?: number;   // m² existants (pour calcul total et seuil architecte)
  zone?: string;               // code zone PLU ex. "UA", "UB", "A", "N"
  hasABF?: boolean;
  amenagementType?: string;    // "piscine" | "cloture" | "terrasse" | "autre"
  certificatType?: "a" | "b"; // CUa informatif vs CUb opérationnel
  hasVoirieCommune?: boolean;  // division terrain : voirie/réseaux communs → PA
  // Pour un agrandissement / petite construction au-delà des seuils DP :
  // précise si le bâtiment existant est une maison individuelle, ce qui
  // bascule le PC vers un PCMI (CERFA 13406 au lieu de 13409).
  existingIsMaisonIndividuelle?: boolean;
}

export interface ClassificationResult {
  type: AuthType;
  subtype: AuthSubtype | null;
  libelle: string;
  libelle_court: string;
  cerfa: string;
  articles: string[];
  delai_moyen: string;
  architecte_requis: boolean;
  confidence: "deterministic" | "faible";
}

// ── Références CERFA ─────────────────────────────────────────────────────────
const CERFA = {
  cu:   "13410*06",  // CUa et CUb
  pcmi: "13406*16",  // PC maison individuelle
  pc:   "13409*16",  // PC / PA / PD standard
  dp:   "16702*02",  // DP maison individuelle
  pd:   "13405*08",  // Permis de démolir
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
function isZoneU(zone?: string): boolean {
  return zone ? /^u/i.test(zone.trim()) : false;
}

function build(
  type: AuthType,
  subtype: AuthSubtype | null,
  libelle: string,
  libelle_court: string,
  cerfa: string,
  articles: string[],
  delai_moyen: string,
  architecte_requis: boolean,
  confidence: "deterministic" | "faible",
): ClassificationResult {
  return { type, subtype, libelle, libelle_court, cerfa, articles, delai_moyen, architecte_requis, confidence };
}

// ── Moteur ────────────────────────────────────────────────────────────────────
export function classifyPermit(input: ClassificationInput): ClassificationResult {
  const {
    natures,
    surface = 0,
    empriseExistante = 0,
    zone,
    hasABF = false,
    amenagementType,
    certificatType,
    hasVoirieCommune = false,
    existingIsMaisonIndividuelle = false,
  } = input;

  const inZoneU         = isZoneU(zone);
  const surfaceTotale   = surface + empriseExistante;
  const architecteReq   = surfaceTotale > 150;

  const hasConstruction = natures.some((n) =>
    ["maison_neuve", "agrandissement", "petite_construction"].includes(n),
  );
  const hasDemolition   = natures.includes("demolition");
  const isMaisonNeuve   = natures.includes("maison_neuve");

  // ── ABF delay helper ──────────────────────────────────────────────────────
  function delay(base: string): string {
    if (!hasABF) return base;
    const map: Record<string, string> = {
      "1 à 2 mois": "2 à 3 mois",
      "2 à 3 mois": "3 à 4 mois",
      "3 à 5 mois": "4 à 6 mois",
    };
    return map[base] ?? base;
  }

  // ── 1. Certificat d'Urbanisme ─────────────────────────────────────────────
  // L410-1 a) : CUa informatif — règles applicables à la parcelle (1 mois)
  // L410-1 b) : CUb opérationnel — faisabilité d'un projet précis (2 mois)
  if (natures.includes("certificat") && natures.length === 1) {
    const isCUb = certificatType === "b" || certificatType === undefined; // défaut CUb si non précisé
    return build(
      isCUb ? "certificat_urbanisme_b" : "certificat_urbanisme_a",
      isCUb ? "cu_b" : "cu_a",
      isCUb ? "Certificat d'Urbanisme opérationnel (CUb)" : "Certificat d'Urbanisme informatif (CUa)",
      isCUb ? "CUb" : "CUa",
      CERFA.cu,
      ["L410-1 CU"],
      isCUb ? "2 mois" : "1 mois",
      false,
      "deterministic",
    );
  }

  // ── 2. Démolition seule ───────────────────────────────────────────────────
  // R421-27 : zones protégées (ABF, secteur sauvegardé, AVAP/SPR)
  // R421-28 : bâtiments soumis à PC (construction > seuils)
  // Exception : si combinée avec une construction → PC valant démolition (voir §6)
  if (hasDemolition && !hasConstruction) {
    return build(
      "permis_demolir",
      "pd",
      "Permis de Démolir",
      "PD",
      CERFA.pd,
      hasABF ? ["R421-27 CU", "R421-28 CU"] : ["R421-28 CU"],
      delay("2 à 3 mois"),
      false,
      "deterministic",
    );
  }

  // ── 3. Division foncière ──────────────────────────────────────────────────
  // R421-19 a) : PA si création de voirie ou espaces/réseaux communs
  // Sinon DP (déclaration préalable de lotissement, R421-17 e)
  if (natures.includes("division_terrain") && !hasConstruction) {
    if (hasVoirieCommune) {
      return build(
        "permis_amenager",
        "pa_lotissement",
        "Permis d'Aménager",
        "PA",
        CERFA.pc,
        ["R421-19 a) CU"],
        delay("3 à 5 mois"),
        false,
        "deterministic",
      );
    }
    return build(
      "declaration_prealable",
      "division",
      "Déclaration Préalable — Division foncière",
      "DP",
      CERFA.dp,
      ["R442-1 CU", "R421-17 e) CU"],
      delay("1 à 2 mois"),
      false,
      "deterministic",
    );
  }

  // ── 4. Maison neuve ───────────────────────────────────────────────────────
  // R421-1 : PC obligatoire pour toute construction nouvelle
  // Maison individuelle → PCMI (CERFA 13406*16)
  // Architecte obligatoire si surface totale > 150 m² (R431-2 CU)
  // PC valant démolition si demolition est aussi coché
  if (isMaisonNeuve) {
    const articles = ["R421-1 CU"];
    if (hasDemolition) articles.push("R421-28 CU"); // PC vaut permis démolir
    if (architecteReq) articles.push("R431-2 CU");
    return build(
      "permis_de_construire_mi",
      "pcmi",
      architecteReq
        ? "Permis de Construire (architecte obligatoire)"
        : "Permis de Construire — Maison individuelle",
      "PCMI",
      CERFA.pcmi,
      articles,
      delay("2 à 3 mois"),
      architecteReq,
      "deterministic",
    );
  }

  // ── 5. Changement de destination ─────────────────────────────────────────
  // R421-17 b) : DP si sans modification des structures porteuses
  // R431-24    : PC si modification des structures porteuses (non géré ici — complexité)
  // Modification de façade seule ne bascule PAS vers PC.
  if (
    natures.includes("changement_destination") &&
    !natures.some((n) => ["maison_neuve", "agrandissement"].includes(n))
  ) {
    return build(
      "declaration_prealable",
      null,
      "Déclaration Préalable",
      "DP",
      CERFA.dp,
      ["R421-17 b) CU"],
      delay("1 à 2 mois"),
      false,
      "deterministic",
    );
  }

  // ── 6. Modification de l'aspect extérieur seule ───────────────────────────
  // R421-17 a) : DP pour ravalement, toiture, fenêtres, menuiseries…
  if (
    natures.includes("modification_aspect") &&
    !natures.some((n) => ["maison_neuve", "agrandissement", "petite_construction"].includes(n))
  ) {
    return build(
      "declaration_prealable",
      null,
      "Déclaration Préalable",
      "DP",
      CERFA.dp,
      ["R421-17 a) CU"],
      delay("1 à 2 mois"),
      false,
      "deterministic",
    );
  }

  // ── 7. Aménagement de terrain ─────────────────────────────────────────────
  if (
    natures.includes("amenagement") &&
    !natures.some((n) => ["maison_neuve", "agrandissement", "petite_construction"].includes(n))
  ) {
    // Piscine : R421-17 d)
    if (amenagementType === "piscine") {
      if (surface <= 10) {
        return build("aucune_autorisation", null, "Aucune autorisation requise", "—", "", ["R421-9 CU"], "—", false, "deterministic");
      }
      // Piscine > 100 m² ou couverte → PC (R421-1)
      if (surface > 100) {
        return build(
          "permis_de_construire",
          "pc",
          "Permis de Construire",
          "PC",
          CERFA.pc,
          ["R421-1 CU"],
          delay("2 à 3 mois"),
          false,
          "deterministic",
        );
      }
      return build(
        "declaration_prealable",
        null,
        "Déclaration Préalable",
        "DP",
        CERFA.dp,
        ["R421-17 d) CU"],
        delay("1 à 2 mois"),
        false,
        "deterministic",
      );
    }
    // Clôture, terrasse, allée → DP
    return build(
      "declaration_prealable",
      null,
      "Déclaration Préalable",
      "DP",
      CERFA.dp,
      ["R421-17 c) CU"],
      delay("1 à 2 mois"),
      false,
      "deterministic",
    );
  }

  // ── 8. Agrandissement / petite construction ───────────────────────────────
  if (natures.some((n) => ["agrandissement", "petite_construction"].includes(n))) {
    // R421-9 : ≤ 5 m² et hauteur ≤ 12 m → aucune autorisation (sauf ABF)
    if (surface <= 5 && !hasABF) {
      return build("aucune_autorisation", null, "Aucune autorisation requise", "—", "", ["R421-9 CU"], "—", false, "deterministic");
    }

    // Zone U avec PLU : DP jusqu'à 40 m² (loi ALUR — R421-13 al.2)
    // Hors zone U : DP jusqu'à 20 m²
    const dpSeuil = inZoneU ? 40 : 20;

    if (surface <= dpSeuil) {
      const articles = inZoneU ? ["R421-13 al.2 CU"] : ["R421-12 a) CU"];
      if (architecteReq) articles.push("R431-2 CU");
      return build(
        "declaration_prealable",
        null,
        "Déclaration Préalable",
        "DP",
        CERFA.dp,
        articles,
        delay("1 à 2 mois"),
        architecteReq,
        "deterministic",
      );
    }

    // Au-delà des seuils → PC
    // Extension d'une maison individuelle → PCMI (le citoyen a confirmé que le
    //   bâtiment existant est une maison individuelle).
    // Autre bâtiment → PC standard
    const isPCMI = isMaisonNeuve || existingIsMaisonIndividuelle;
    const articles = ["R421-1 CU", "R421-14 CU"];
    if (hasDemolition) articles.push("R421-28 CU");
    if (architecteReq) articles.push("R431-2 CU");
    return build(
      isPCMI ? "permis_de_construire_mi" : "permis_de_construire",
      isPCMI ? "pcmi" : "pc",
      architecteReq ? "Permis de Construire (architecte obligatoire)" : "Permis de Construire",
      isPCMI ? "PCMI" : "PC",
      isPCMI ? CERFA.pcmi : CERFA.pc,
      articles,
      delay("2 à 3 mois"),
      architecteReq,
      "deterministic",
    );
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return build(
    "declaration_prealable",
    null,
    "Déclaration Préalable",
    "DP",
    CERFA.dp,
    [],
    delay("1 à 2 mois"),
    false,
    "faible",
  );
}
