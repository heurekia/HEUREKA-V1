// Moteur de classification déterministe — Code de l'urbanisme
// Références : R421-1, R421-9, R421-12, R421-13, R421-17, R421-19, R421-23, R421-27, R421-28, L410-1

export type AuthType =
  | "declaration_prealable"
  | "permis_de_construire"
  | "permis_amenager"
  | "permis_demolir"
  | "certificat_urbanisme"
  | "aucune_autorisation";

export interface ClassificationInput {
  natures: string[];
  surface?: number;           // surface plancher créée (m²)
  empriseExistante?: number;  // surface plancher existante (m²)
  zone?: string;              // code zone PLU ex. "UA", "UB", "A", "N"
  hasABF?: boolean;
  amenagementType?: string;   // "piscine" | "cloture" | "terrasse" | "autre"
}

export interface ClassificationResult {
  type: AuthType;
  libelle: string;
  libelle_court: string;
  cerfa: string;
  articles: string[];
  delai_moyen: string;
  confidence: "deterministic" | "faible";
}

const CERFA_MAP: Partial<Record<AuthType, string>> = {
  declaration_prealable: "16702*02",
  permis_de_construire:  "13406*16",
  permis_amenager:       "13409*16",
  permis_demolir:        "13405*08",
  certificat_urbanisme:  "13410*06",
};

type PartialResult = Omit<ClassificationResult, "cerfa">;

function result(r: PartialResult): ClassificationResult {
  return { ...r, cerfa: CERFA_MAP[r.type] ?? "" };
}

function isZoneU(zone?: string): boolean {
  return zone ? /^u/i.test(zone.trim()) : false;
}

export function classifyPermit(input: ClassificationInput): ClassificationResult {
  const {
    natures,
    surface = 0,
    zone,
    hasABF = false,
    amenagementType,
  } = input;

  const inZoneU = isZoneU(zone);

  // ── Certificat d'urbanisme ────────────────────────────────────────────────
  if (natures.includes("certificat") && natures.length === 1) {
    return result({
      type: "certificat_urbanisme",
      libelle: "Certificat d'Urbanisme",
      libelle_court: "CU",
      articles: ["L410-1 CU"],
      delai_moyen: "1 à 2 mois",
      confidence: "deterministic",
    });
  }

  // ── Permis de Démolir ─────────────────────────────────────────────────────
  // R421-27 : obligatoire si périmètre protégé (ABF)
  // R421-28 : obligatoire pour toute démolition totale ou partielle
  if (natures.includes("demolition")) {
    return result({
      type: "permis_demolir",
      libelle: "Permis de Démolir",
      libelle_court: "PD",
      articles: hasABF ? ["R421-27 CU", "R421-28 CU"] : ["R421-28 CU"],
      delai_moyen: "2 à 3 mois",
      confidence: "deterministic",
    });
  }

  // ── Division foncière ─────────────────────────────────────────────────────
  // R421-19 : PA si lotissement avec création de voirie ou d'équipements communs
  if (natures.includes("division_terrain") && natures.length === 1) {
    return result({
      type: "permis_amenager",
      libelle: "Permis d'Aménager",
      libelle_court: "PA",
      articles: ["R421-19 a) CU"],
      delai_moyen: "3 à 5 mois",
      confidence: "faible",
    });
  }

  // ── Maison neuve ──────────────────────────────────────────────────────────
  if (natures.includes("maison_neuve")) {
    return result({
      type: "permis_de_construire",
      libelle: "Permis de Construire",
      libelle_court: "PC",
      articles: ["R421-1 CU"],
      delai_moyen: "2 à 3 mois",
      confidence: "deterministic",
    });
  }

  // ── Changement de destination ─────────────────────────────────────────────
  // R421-17 b) : DP si sans modification des structures porteuses
  // R431-24    : PC uniquement si modification des structures porteuses
  // La modification de façade seule ne bascule PAS vers PC.
  if (natures.includes("changement_destination")) {
    if (!natures.some((n) => ["maison_neuve", "agrandissement"].includes(n))) {
      return result({
        type: "declaration_prealable",
        libelle: "Déclaration Préalable",
        libelle_court: "DP",
        articles: ["R421-17 b) CU"],
        delai_moyen: hasABF ? "2 à 3 mois" : "1 à 2 mois",
        confidence: "deterministic",
      });
    }
  }

  // ── Modification de l'aspect extérieur seule ──────────────────────────────
  // R421-17 a) : DP pour ravalement, toiture, fenêtres, menuiseries…
  if (
    natures.includes("modification_aspect") &&
    !natures.some((n) => ["maison_neuve", "agrandissement", "petite_construction"].includes(n))
  ) {
    return result({
      type: "declaration_prealable",
      libelle: "Déclaration Préalable",
      libelle_court: "DP",
      articles: ["R421-17 a) CU"],
      delai_moyen: hasABF ? "2 à 3 mois" : "1 à 2 mois",
      confidence: "deterministic",
    });
  }

  // ── Aménagement de terrain ────────────────────────────────────────────────
  if (
    natures.includes("amenagement") &&
    !natures.some((n) => ["maison_neuve", "agrandissement", "petite_construction"].includes(n))
  ) {
    // Piscine : R421-17 d) — DP si > 10 m²
    if (amenagementType === "piscine") {
      if (surface <= 10) {
        return result({
          type: "aucune_autorisation",
          libelle: "Aucune autorisation requise",
          libelle_court: "—",
          articles: ["R421-9 CU"],
          delai_moyen: "—",
          confidence: "deterministic",
        });
      }
      return result({
        type: "declaration_prealable",
        libelle: "Déclaration Préalable",
        libelle_court: "DP",
        articles: ["R421-17 d) CU"],
        delai_moyen: "1 à 2 mois",
        confidence: "deterministic",
      });
    }
    // Clôture, terrasse, allée → DP
    return result({
      type: "declaration_prealable",
      libelle: "Déclaration Préalable",
      libelle_court: "DP",
      articles: ["R421-17 c) CU"],
      delai_moyen: "1 à 2 mois",
      confidence: "deterministic",
    });
  }

  // ── Agrandissement / petite construction ──────────────────────────────────
  if (natures.some((n) => ["agrandissement", "petite_construction"].includes(n))) {
    // R421-9 : ≤ 5 m² et hauteur ≤ 12 m → aucune autorisation
    if (surface <= 5 && !hasABF) {
      return result({
        type: "aucune_autorisation",
        libelle: "Aucune autorisation requise",
        libelle_court: "—",
        articles: ["R421-9 CU"],
        delai_moyen: "—",
        confidence: "deterministic",
      });
    }

    // Zone U avec PLU : DP jusqu'à 40 m² (loi ALUR — R421-13 al.2)
    // Hors zone U : DP jusqu'à 20 m²
    const dpSeuil = inZoneU ? 40 : 20;

    if (surface <= dpSeuil) {
      return result({
        type: "declaration_prealable",
        libelle: "Déclaration Préalable",
        libelle_court: "DP",
        articles: inZoneU ? ["R421-13 al.2 CU"] : ["R421-12 a) CU"],
        delai_moyen: hasABF ? "2 à 3 mois" : "1 à 2 mois",
        confidence: "deterministic",
      });
    }

    return result({
      type: "permis_de_construire",
      libelle: "Permis de Construire",
      libelle_court: "PC",
      articles: ["R421-1 CU", "R421-14 CU"],
      delai_moyen: hasABF ? "3 à 4 mois" : "2 à 3 mois",
      confidence: "deterministic",
    });
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return result({
    type: "declaration_prealable",
    libelle: "Déclaration Préalable",
    libelle_court: "DP",
    articles: [],
    delai_moyen: "1 à 2 mois",
    confidence: "faible",
  });
}
