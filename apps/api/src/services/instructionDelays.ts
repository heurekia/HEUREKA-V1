/**
 * Calcul des délais d'instruction d'une demande d'urbanisme.
 *
 * Référence : Code de l'Urbanisme — articles R.423-23 à R.423-37
 * + R.410-9 (certificats d'urbanisme).
 *
 * Le délai final = délai de droit commun + extensions éventuelles, chacune
 * justifiée par un article du code et reportée dans le `breakdown` pour
 * traçabilité (affichage à l'instructeur).
 */

export type DeadlineDossierType =
  | "permis_de_construire"
  | "permis_de_construire_mi"
  | "declaration_prealable"
  | "permis_amenager"
  | "permis_demolir"
  | "permis_lotir"
  | "certificat_urbanisme"
  | "certificat_urbanisme_a"
  | "certificat_urbanisme_b";

export interface DeadlineMetadata {
  natures?: string[];                    // ["maison_neuve", "agrandissement", …]
  certificatType?: "a" | "b";
  // Drapeaux contextuels saisis par l'instructeur ou déduits du dossier.
  derogationPLU?: boolean;               // dérogation aux règles du PLU (R.423-25)
  evaluationEnvironnementaleSoumise?: boolean;   // R.423-25 — +6 mois
  evaluationEnvironnementaleCasParCas?: boolean; // R.423-25 — +1 mois si "cas par cas"
  defrichementRequis?: boolean;          // R.423-26 — +1 mois
  estERP?: boolean;                      // autorisation au titre des ERP — +1 mois
  derogationAccessibilite?: boolean;     // +1 mois
  consultationCDPENAF?: boolean;         // zone A/N, +2 mois
  secteurSauvegarde?: boolean;           // SPR / secteur sauvegardé +1 mois
  unesco?: boolean;                      // patrimoine mondial +2 mois
  natura2000?: boolean;                  // +1 mois si évaluation incidence requise
}

export interface DeadlineServitude {
  categorie?: string;
  libelle?: string;
}

export interface DeadlineBreakdownItem {
  // Libellé court ("Base", "ABF", "Site classé", "Évaluation environnementale", …)
  label: string;
  // +N mois (peut être négatif si jamais on raccourcissait, ce qui n'existe pas en pratique)
  mois: number;
  // Article du Code de l'Urbanisme qui fonde cette ligne, pour audit.
  article: string;
}

export interface DeadlineComputation {
  total_mois: number;
  breakdown: DeadlineBreakdownItem[];
}

// Délai de droit commun par type, AVANT spécialisation (R.423-23 / R.410-9).
const DEFAULT_MOIS: Record<DeadlineDossierType, number> = {
  permis_de_construire: 3,        // R.423-23 3° (autre que maison individuelle)
  permis_de_construire_mi: 2,     // R.423-23 2° (maison individuelle)
  declaration_prealable: 1,       // R.423-23 1°
  permis_amenager: 3,             // R.423-23 3°
  permis_demolir: 2,              // R.423-23 2°
  permis_lotir: 3,                // R.423-23 3°
  certificat_urbanisme: 2,        // legacy — équivalent CUb
  certificat_urbanisme_a: 1,      // R.410-9 al.1 — CUa informatif
  certificat_urbanisme_b: 2,      // R.410-9 al.2 — CUb opérationnel
};

function isMaisonIndividuelle(natures: string[]): boolean {
  if (!natures.length) return false;
  // Une opération de lotissement / division ne rentre PAS dans la catégorie PC MI.
  if (natures.includes("division_terrain")) return false;
  return natures.some((n) => ["maison_neuve", "agrandissement", "petite_construction"].includes(n));
}

function servitudeBase(s: DeadlineServitude): string {
  return (s.categorie ?? "").toUpperCase();
}

function hasServitude(servitudes: DeadlineServitude[], categorie: string | RegExp): boolean {
  for (const s of servitudes) {
    const c = servitudeBase(s);
    if (typeof categorie === "string") {
      if (c === categorie || c.startsWith(categorie)) return true;
    } else if (categorie.test(c)) return true;
  }
  return false;
}

/**
 * Calcule le délai d'instruction d'un dossier et renvoie le détail.
 *
 * Hypothèses :
 *  - Les extensions automatiques (R.423-24/25/26) sont appliquées sans
 *    notification distincte (R.423-44 — l'autorité informe seulement le
 *    pétitionnaire dans le premier mois).
 *  - Les valeurs ne sont JAMAIS sommées plusieurs fois pour la même cause
 *    (ex. ABF AC1 + AC2 → on ne compte que +1 mois patrimoine au max).
 */
export function computeInstructionDelay(
  type: string,
  metadata: DeadlineMetadata | null | undefined,
  servitudes: DeadlineServitude[] | null | undefined,
): DeadlineComputation {
  const breakdown: DeadlineBreakdownItem[] = [];
  const natures = metadata?.natures ?? [];
  const sup = servitudes ?? [];

  // ── 1. Délai de droit commun ──
  const t = (type as DeadlineDossierType);
  let baseMois = DEFAULT_MOIS[t] ?? 2;
  let baseLabel = "Délai de droit commun";
  let baseArt = "R.423-23 ou R.410-9";
  switch (t) {
    case "permis_de_construire":
      if (isMaisonIndividuelle(natures)) {
        baseMois = 2;
        baseLabel = "PC maison individuelle";
        baseArt = "R.423-23 2°";
      } else {
        baseLabel = "PC (hors maison individuelle)";
        baseArt = "R.423-23 3°";
      }
      break;
    case "permis_de_construire_mi":
      baseLabel = "PC maison individuelle";
      baseArt = "R.423-23 2°";
      break;
    case "declaration_prealable":
      baseLabel = "Déclaration préalable";
      baseArt = "R.423-23 1°";
      break;
    case "permis_amenager":
      baseLabel = "Permis d'aménager";
      baseArt = "R.423-23 3°";
      break;
    case "permis_lotir":
      baseLabel = "Permis d'aménager (lotissement)";
      baseArt = "R.423-23 3°";
      break;
    case "permis_demolir":
      baseLabel = "Permis de démolir";
      baseArt = "R.423-23 2°";
      break;
    case "certificat_urbanisme":
    case "certificat_urbanisme_a":
    case "certificat_urbanisme_b":
      // Le type au niveau dossier prime ; le metadata.certificatType reste
      // utilisé pour les rangées legacy stockées sous "certificat_urbanisme".
      if (t === "certificat_urbanisme_a" || (t === "certificat_urbanisme" && metadata?.certificatType === "a")) {
        baseMois = 1;
        baseLabel = "CU informatif";
        baseArt = "R.410-9 al.1";
      } else {
        baseLabel = "CU opérationnel";
        baseArt = "R.410-9 al.2";
      }
      break;
  }
  breakdown.push({ label: baseLabel, mois: baseMois, article: baseArt });

  // ── 2. Extensions automatiques (R.423-24 / 25 / 26) ──
  // Patrimoine — ABF / sites / réserves / parcs nationaux : +1 mois
  // On regroupe pour ne pas additionner deux fois la même cause patrimoniale.
  const hasABF = hasServitude(sup, "AC1");
  const hasSiteClasse = hasServitude(sup, "AC2");
  const hasReserveNat = hasServitude(sup, "AC3");
  const hasParcNat = hasServitude(sup, "AC4");
  if (hasABF) {
    breakdown.push({ label: "Périmètre ABF (Monuments Historiques)", mois: 1, article: "R.423-24 b)" });
  } else if (hasSiteClasse) {
    breakdown.push({ label: "Site classé ou inscrit", mois: 1, article: "R.423-24 c)" });
  } else if (hasReserveNat || hasParcNat) {
    breakdown.push({ label: "Réserve naturelle / parc national", mois: 1, article: "R.423-24 d)" });
  }

  if (metadata?.secteurSauvegarde) {
    breakdown.push({ label: "Secteur patrimonial remarquable", mois: 1, article: "R.423-24 e)" });
  }
  if (metadata?.unesco) {
    breakdown.push({ label: "Bien UNESCO / patrimoine mondial", mois: 2, article: "R.423-25 d)" });
  }

  // Dérogation au PLU — R.423-25
  if (metadata?.derogationPLU) {
    breakdown.push({ label: "Dérogation aux règles du PLU", mois: 2, article: "R.423-25 a)" });
  }

  // Évaluation environnementale — R.423-25
  if (metadata?.evaluationEnvironnementaleSoumise) {
    breakdown.push({ label: "Évaluation environnementale (soumis)", mois: 6, article: "R.423-25 c)" });
  } else if (metadata?.evaluationEnvironnementaleCasParCas) {
    breakdown.push({ label: "Évaluation environnementale (cas par cas)", mois: 1, article: "R.423-25 c)" });
  }

  // CDPENAF — R.423-25 (avis commission départementale, zones A/N)
  if (metadata?.consultationCDPENAF) {
    breakdown.push({ label: "Consultation CDPENAF", mois: 2, article: "R.423-25 b)" });
  }

  // Natura 2000 — évaluation des incidences
  if (metadata?.natura2000) {
    breakdown.push({ label: "Évaluation incidences Natura 2000", mois: 1, article: "R.423-25 c)" });
  }

  // Défrichement — R.423-26
  if (metadata?.defrichementRequis) {
    breakdown.push({ label: "Autorisation de défrichement", mois: 1, article: "R.423-26" });
  }

  // ERP / accessibilité
  if (metadata?.estERP) {
    breakdown.push({ label: "Autorisation au titre des ERP", mois: 1, article: "R.423-28" });
  }
  if (metadata?.derogationAccessibilite) {
    breakdown.push({ label: "Dérogation accessibilité", mois: 1, article: "R.423-28-1" });
  }

  const total = breakdown.reduce((s, b) => s + b.mois, 0);
  return { total_mois: total, breakdown };
}

/**
 * Conserve l'API historique (utilisée par les call sites existants).
 */
export function computeDelaiMois(
  type: string,
  metadata: DeadlineMetadata | null | undefined,
  servitudes: DeadlineServitude[] | null | undefined,
): number {
  return computeInstructionDelay(type, metadata, servitudes).total_mois;
}

/**
 * Applique un délai (en mois) à une date de départ. Le code de l'urbanisme
 * définit l'écoulement par mois calendaires : on ajoute N mois, en gérant
 * les fins de mois courtes (31/03 + 1 mois → 30/04, pas 01/05).
 */
export function applyMonthsToDate(start: Date, months: number): Date {
  const d = new Date(start.getTime());
  const day = d.getDate();
  d.setDate(1);                       // pour éviter le débordement
  d.setMonth(d.getMonth() + months);
  const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfMonth));
  return d;
}
