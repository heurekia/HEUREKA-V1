// Calcul de la taxe d'aménagement (TA) et de la redevance d'archéologie
// préventive (RAP) — art. L.331-1 s. du Code de l'urbanisme.
//
// Service PUR (aucune E/S, aucune dépendance DB) : il prend une assiette déjà
// catégorisée + les paramètres fiscaux (constantes nationales, taux communal et
// départemental) et renvoie le détail chiffré, prêt à figurer dans la rubrique
// « taxes et participations » d'un Certificat d'Urbanisme.
//
// La RÉSOLUTION des paramètres (lecture des tables fiscal_national_constants,
// fiscal_departemental_rates, commune_fiscalite À LA DATE de la demande) et la
// CATÉGORISATION juridique (qu'est-ce qui est résidence principale, exonéré…)
// sont du ressort de l'appelant — ici on ne fait que l'arithmétique légale, ce
// qui rend le calcul entièrement testable et auditable.
//
// Formule (par part) :
//   base = Σ(surfaces taxables × valeur forfaitaire/m², abattues si éligibles)
//        + Σ(assiettes forfaitaires des installations : piscine, stationnement…)
//   part_communale     = base × taux_communal %      (0 si exonérée)
//   part_départementale = base × taux_départemental %  (0 si exonérée)
//   RAP                = base × taux_RAP %
//
// Abattement de droit (art. L.331-12) : 50 % de la valeur forfaitaire pour les
// 100 premiers m² de résidence principale, les logements aidés et les locaux
// industriels/artisanaux. On le porte au niveau de chaque « tranche » de surface
// (drapeau `abattement`) — l'appelant découpe l'assiette en conséquence ; le
// helper `tranchesResidencePrincipale` automatise le cas le plus courant.

// ── Entrées ──────────────────────────────────────────────────────────────────

/** Une tranche homogène de surface taxable (même régime d'abattement). */
export interface TrancheSurfaceTaxable {
  surface_m2: number;
  /** true = 50 % de la valeur forfaitaire (résidence principale ≤ 100 m², logement aidé, local industriel). */
  abattement: boolean;
  libelle?: string;
}

/** Une installation à assiette forfaitaire propre (non liée à la surface de plancher). */
export interface InstallationTaxable {
  libelle: string;
  /** Assiette en euros (ex. piscine 30 m² × 250 €/m² = 7 500). Voir `assietteInstallation`. */
  base_eur: number;
}

export interface ConstantesFiscales {
  /** Valeur forfaitaire par m² applicable (métropole ou IDF selon la commune). */
  valeur_forfaitaire_m2: number;
  /** Taux d'abattement de droit (0.5 par défaut). */
  abattement_rate: number;
  /** Taux de la redevance d'archéologie préventive, en % (ex. 0.40). */
  rap_rate: number;
}

export interface TaxeAmenagementInput {
  surfaces: TrancheSurfaceTaxable[];
  installations?: InstallationTaxable[];
  constantes: ConstantesFiscales;
  /** Taux de la part communale, en % (ex. 5 pour 5 %). */
  taux_communal_pct: number;
  /** Taux de la part départementale, en % (ex. 1.5 pour 1,5 %). */
  taux_departemental_pct: number;
  /** Exonération facultative de la part communale (délibération L.331-9). */
  exoneration_communale?: boolean;
  /** Exonération de la part départementale (rare, mais possible). */
  exoneration_departementale?: boolean;
}

// ── Sorties ──────────────────────────────────────────────────────────────────

export interface LigneAssiette {
  libelle: string;
  /** Assiette en euros pour cette ligne (après abattement éventuel). */
  base_eur: number;
}

export interface TaxeAmenagementResult {
  /** Assiette « bâtie » (surfaces × valeur forfaitaire, après abattements), en euros. */
  assiette_surface_eur: number;
  /** Assiette des installations à forfait propre, en euros. */
  assiette_installations_eur: number;
  /** Base totale servant au calcul des trois prélèvements. */
  base_totale_eur: number;
  /** Détail ligne à ligne (pour affichage dans le CU). */
  lignes: LigneAssiette[];
  /** Part communale, en euros (arrondie). 0 si exonérée. */
  part_communale_eur: number;
  /** Part départementale, en euros (arrondie). 0 si exonérée. */
  part_departementale_eur: number;
  /** Total taxe d'aménagement (communale + départementale), en euros. */
  taxe_amenagement_eur: number;
  /** Redevance d'archéologie préventive, en euros (arrondie). */
  rap_eur: number;
  /** Avertissements non bloquants (paramètre manquant, valeur suspecte…). */
  warnings: string[];
}

// ── Helpers d'assiette ────────────────────────────────────────────────────────

/**
 * Découpe une surface de résidence principale en deux tranches : les
 * `seuil_m2` premiers m² avec abattement (50 %), le reste à plein tarif.
 * Cas le plus fréquent (maison individuelle d'habitation principale).
 */
export function tranchesResidencePrincipale(
  surfaceTotale_m2: number,
  seuil_m2 = 100,
): TrancheSurfaceTaxable[] {
  if (surfaceTotale_m2 <= 0) return [];
  const abattue = Math.min(surfaceTotale_m2, seuil_m2);
  const tranches: TrancheSurfaceTaxable[] = [
    { surface_m2: abattue, abattement: true, libelle: `Résidence principale (${seuil_m2} premiers m²)` },
  ];
  const reste = surfaceTotale_m2 - abattue;
  if (reste > 0) {
    tranches.push({ surface_m2: reste, abattement: false, libelle: "Résidence principale (surface au-delà du seuil)" });
  }
  return tranches;
}

/** Assiette forfaitaire d'une installation = quantité × forfait unitaire. */
export function assietteInstallation(libelle: string, quantite: number, forfait_unitaire: number): InstallationTaxable {
  return { libelle, base_eur: Math.max(0, quantite) * Math.max(0, forfait_unitaire) };
}

// ── Calcul principal ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeTaxeAmenagement(input: TaxeAmenagementInput): TaxeAmenagementResult {
  const warnings: string[] = [];
  const { constantes, taux_communal_pct, taux_departemental_pct } = input;
  const vf = constantes.valeur_forfaitaire_m2;
  const abRate = constantes.abattement_rate ?? 0.5;

  if (!(vf > 0)) warnings.push("Valeur forfaitaire par m² absente ou nulle — assiette bâtie non calculée.");
  if (abRate < 0 || abRate > 1) warnings.push(`Taux d'abattement hors bornes (${abRate}) — vérifier la constante nationale.`);

  const lignes: LigneAssiette[] = [];

  // 1. Assiette des surfaces taxables (avec abattement par tranche).
  let assietteSurface = 0;
  for (const t of input.surfaces) {
    if (!(t.surface_m2 > 0)) continue;
    const valeurM2 = t.abattement ? vf * abRate : vf;
    const base = t.surface_m2 * valeurM2;
    assietteSurface += base;
    lignes.push({
      libelle: t.libelle ?? `Surface taxable ${t.surface_m2} m²${t.abattement ? " (abattement 50 %)" : ""}`,
      base_eur: round2(base),
    });
  }

  // 2. Assiette des installations à forfait propre (non abattues).
  let assietteInstallations = 0;
  for (const inst of input.installations ?? []) {
    if (!(inst.base_eur > 0)) continue;
    assietteInstallations += inst.base_eur;
    lignes.push({ libelle: inst.libelle, base_eur: round2(inst.base_eur) });
  }

  const baseTotale = assietteSurface + assietteInstallations;

  // 3. Prélèvements. Un taux manquant (null/0) n'est pas une erreur : certaines
  //    communes n'ont pas institué la part communale ; on le signale toutefois.
  if (!(taux_communal_pct > 0)) {
    warnings.push("Taux de part communale non renseigné ou nul — part communale à 0 (la commune a-t-elle institué la TA ?).");
  }
  const partCommunale = input.exoneration_communale ? 0 : baseTotale * (taux_communal_pct / 100);
  const partDepartementale = input.exoneration_departementale ? 0 : baseTotale * (taux_departemental_pct / 100);
  const rap = baseTotale * (constantes.rap_rate / 100);

  // Arrondi à l'euro (la TA est liquidée à l'euro le plus proche).
  const partCommunaleR = Math.round(partCommunale);
  const partDepartementaleR = Math.round(partDepartementale);

  return {
    assiette_surface_eur: round2(assietteSurface),
    assiette_installations_eur: round2(assietteInstallations),
    base_totale_eur: round2(baseTotale),
    lignes,
    part_communale_eur: partCommunaleR,
    part_departementale_eur: partDepartementaleR,
    taxe_amenagement_eur: partCommunaleR + partDepartementaleR,
    rap_eur: Math.round(rap),
    warnings,
  };
}
