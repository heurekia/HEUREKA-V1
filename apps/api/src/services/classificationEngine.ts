// Moteur de classification déterministe basé sur le Code de l'urbanisme

export type PermitType =
  | "declaration_prealable"
  | "permis_de_construire"
  | "permis_amenager"
  | "permis_demolir"
  | "certificat_urbanisme"
  | "aucune_autorisation";

export interface ClassificationInput {
  natures: string[];
  surface?: number;
  empriseExistante?: number;
  zone?: string;
  servitudes?: Array<{ categorie?: string; libelle?: string }>;
  amenagementType?: string;
}

export interface ClassificationResult {
  type: PermitType;
  libelle: string;
  libelle_court: string;
  articles: string[];
  delai_moyen: string;
  confidence: "deterministic" | "faible";
  modifiers: string[];
}

function isZoneU(zone?: string): boolean {
  if (!zone) return true;
  const z = zone.toUpperCase();
  return z.startsWith("U") || z === "AU" || z.startsWith("AU");
}

function hasABF(servitudes?: Array<{ categorie?: string; libelle?: string }>): boolean {
  return (servitudes ?? []).some(
    (s) => s.categorie?.toUpperCase().startsWith("AC") || s.libelle?.toLowerCase().includes("abf"),
  );
}

export function classifyPermit(input: ClassificationInput): ClassificationResult {
  const { natures, surface = 0, zone, servitudes, amenagementType } = input;
  const abf = hasABF(servitudes);
  const zoneU = isZoneU(zone);
  const mods = abf ? ["ABF"] : [];

  // ─ Certificat d'urbanisme (priorité absolue)
  if (natures.includes("certificat")) {
    return {
      type: "certificat_urbanisme",
      libelle: "Certificat d'urbanisme",
      libelle_court: "CU",
      articles: ["L410-1 CU"],
      delai_moyen: "1 à 2 mois",
      confidence: "deterministic",
      modifiers: mods,
    };
  }

  // ─ Division foncière → DP de division (R421-23)
  if (natures.includes("division_terrain")) {
    return {
      type: "declaration_prealable",
      libelle: "Déclaration Préalable de division foncière",
      libelle_court: "DP",
      articles: ["R421-23 CU"],
      delai_moyen: "1 mois" + (abf ? " (+ 1 mois ABF)" : ""),
      confidence: "deterministic",
      modifiers: mods,
    };
  }

  // ─ Maison neuve → PC (R421-1)
  if (natures.includes("maison_neuve")) {
    return {
      type: "permis_de_construire",
      libelle: "Permis de Construire",
      libelle_court: "PC",
      articles: ["R421-1 CU"],
      delai_moyen: "2 mois" + (abf ? " (+ 1 mois ABF)" : ""),
      confidence: "deterministic",
      modifiers: mods,
    };
  }

  // ─ Démolition seule (sans construction associée)
  const isDemolOnly =
    natures.includes("demolition") &&
    !natures.some((n) => ["maison_neuve", "agrandissement", "petite_construction"].includes(n));

  if (isDemolOnly) {
    if (surface >= 20 || abf) {
      return {
        type: "permis_demolir",
        libelle: "Permis de Démolir",
        libelle_court: "PD",
        articles: ["R421-28 CU"],
        delai_moyen: "2 mois",
        confidence: "deterministic",
        modifiers: mods,
      };
    }
    return {
      type: "declaration_prealable",
      libelle: "Déclaration Préalable",
      libelle_court: "DP",
      articles: ["R421-27 CU"],
      delai_moyen: "1 mois",
      confidence: "deterministic",
      modifiers: mods,
    };
  }

  // ─ Changement de destination (avec ou sans modification d'aspect)
  // R421-17 : DP si changement de destination même avec travaux ≤ 20m²
  // R421-14 : PC si travaux créent surface plancher ≥ 20m²
  if (natures.includes("changement_destination")) {
    if (surface >= 20) {
      return {
        type: "permis_de_construire",
        libelle: "Permis de Construire",
        libelle_court: "PC",
        articles: ["R421-14 CU", "R421-17 CU"],
        delai_moyen: "2 mois" + (abf ? " (+ 1 mois ABF)" : ""),
        confidence: "deterministic",
        modifiers: mods,
      };
    }
    return {
      type: "declaration_prealable",
      libelle: "Déclaration Préalable",
      libelle_court: "DP",
      articles: ["R421-17 c) et d) CU"],
      delai_moyen: "1 mois" + (abf ? " (+ 1 mois ABF)" : ""),
      confidence: "deterministic",
      modifiers: mods,
    };
  }

  // ─ Modification de l'aspect extérieur seule → DP (R421-17 d)
  if (natures.includes("modification_aspect")) {
    return {
      type: "declaration_prealable",
      libelle: "Déclaration Préalable",
      libelle_court: "DP",
      articles: ["R421-17 d) CU"],
      delai_moyen: "1 mois" + (abf ? " (+ 1 mois ABF)" : ""),
      confidence: "deterministic",
      modifiers: mods,
    };
  }

  // ─ Aménagement de terrain
  if (natures.includes("amenagement")) {
    if (amenagementType === "piscine") {
      if (surface > 10) {
        return {
          type: "declaration_prealable",
          libelle: "Déclaration Préalable",
          libelle_court: "DP",
          articles: ["R421-9 CU"],
          delai_moyen: "1 mois" + (abf ? " (+ 1 mois ABF)" : ""),
          confidence: "deterministic",
          modifiers: mods,
        };
      }
      return {
        type: "aucune_autorisation",
        libelle: "Aucune autorisation requise",
        libelle_court: "Aucune",
        articles: ["R421-2 CU"],
        delai_moyen: "—",
        confidence: "deterministic",
        modifiers: [],
      };
    }
    if (amenagementType === "cloture") {
      return {
        type: "declaration_prealable",
        libelle: "Déclaration Préalable",
        libelle_court: "DP",
        articles: ["R421-12 CU"],
        delai_moyen: "1 mois" + (abf ? " (+ 1 mois ABF)" : ""),
        confidence: "deterministic",
        modifiers: mods,
      };
    }
    if (surface >= 20 || abf) {
      return {
        type: "declaration_prealable",
        libelle: "Déclaration Préalable",
        libelle_court: "DP",
        articles: ["R421-17 CU"],
        delai_moyen: "1 mois" + (abf ? " (+ 1 mois ABF)" : ""),
        confidence: "deterministic",
        modifiers: mods,
      };
    }
    return {
      type: "aucune_autorisation",
      libelle: "Aucune autorisation requise (à confirmer avec la mairie)",
      libelle_court: "Aucune",
      articles: ["R421-2 CU"],
      delai_moyen: "—",
      confidence: "deterministic",
      modifiers: [],
    };
  }

  // ─ Agrandissement / Petite construction
  if (natures.includes("agrandissement") || natures.includes("petite_construction")) {
    if (surface < 5 && !abf) {
      return {
        type: "aucune_autorisation",
        libelle: "Aucune autorisation requise",
        libelle_court: "Aucune",
        articles: ["R421-2 CU"],
        delai_moyen: "—",
        confidence: "deterministic",
        modifiers: [],
      };
    }
    if (surface <= 20) {
      return {
        type: "declaration_prealable",
        libelle: "Déclaration Préalable",
        libelle_court: "DP",
        articles: ["R421-13 CU"],
        delai_moyen: "1 mois" + (abf ? " (+ 1 mois ABF)" : ""),
        confidence: "deterministic",
        modifiers: mods,
      };
    }
    // > 20m²: DP jusqu'à 40m² en zone U avec PLU, sinon PC
    if (zoneU && surface <= 40) {
      return {
        type: "declaration_prealable",
        libelle: "Déclaration Préalable",
        libelle_court: "DP",
        articles: ["R421-13 CU"],
        delai_moyen: "1 mois" + (abf ? " (+ 1 mois ABF)" : ""),
        confidence: "deterministic",
        modifiers: mods,
      };
    }
    return {
      type: "permis_de_construire",
      libelle: "Permis de Construire",
      libelle_court: "PC",
      articles: ["R421-14 CU"],
      delai_moyen: "2 mois" + (abf ? " (+ 1 mois ABF)" : ""),
      confidence: "deterministic",
      modifiers: mods,
    };
  }

  return {
    type: "declaration_prealable",
    libelle: "Déclaration Préalable",
    libelle_court: "DP",
    articles: [],
    delai_moyen: "1 mois",
    confidence: "faible",
    modifiers: mods,
  };
}
