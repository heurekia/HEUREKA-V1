// Résolveur de fiscalité : assemble, pour une commune et une DATE donnée, les
// paramètres nécessaires au calcul de la taxe d'aménagement, en lisant les trois
// sources posées par le schéma fiscal :
//   1. fiscal_national_constants   (millésime → valeurs forfaitaires, RAP, abattement)
//   2. fiscal_departemental_rates  (département × millésime → part départementale)
//   3. commune_fiscalite           (commune, version EN VIGUEUR à la date → part communale)
//
// C'est le maillon entre le schéma (données) et le calcul (taxeAmenagement.ts).
// Le cœur d'assemblage `assembleFiscalite` est PUR (testable sans DB) ; le
// wrapper `resolveFiscaliteForCommune` ne fait que les lectures.
//
// Pourquoi « à la date » : un CU cristallise les règles. Pour rejouer la
// fiscalité telle qu'elle était au dépôt, on prend la version de commune_fiscalite
// en vigueur à cette date (effective_from ≤ D < effective_to) et le millésime
// national correspondant.

import { and, desc, eq, isNull, lte, or, gt } from "drizzle-orm";
import { db } from "../db.js";
import {
  communes,
  fiscal_national_constants,
  fiscal_departemental_rates,
  commune_fiscalite,
} from "@heureka-v1/db";
import type { ConstantesFiscales } from "./taxeAmenagement.js";

// Départements d'Île-de-France (valeur forfaitaire majorée).
const IDF_DEPARTEMENTS = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);

/** Code département à partir d'un code INSEE commune ("37261" → "37", "2A004" → "2A", "97411" → "974"). */
export function departementCodeFromInsee(insee: string | null | undefined): string {
  if (!insee) return "";
  const head2 = insee.slice(0, 2);
  // Outre-mer : 3 chiffres (971…976, 984, 986…988).
  if (head2 === "97" || head2 === "98") return insee.slice(0, 3);
  return head2; // métropole (et Corse 2A/2B, déjà sur 2 caractères dans le COG)
}

export function isIdfDepartement(departementCode: string): boolean {
  return IDF_DEPARTEMENTS.has(departementCode);
}

// ── Types d'assemblage (purs) ────────────────────────────────────────────────

export interface NationalConstantsRow {
  year: number;
  valeur_forfaitaire_m2: number;
  valeur_forfaitaire_m2_idf: number;
  abattement_rate: number;
  abattement_surface_threshold_m2: number;
  rap_rate: number;
  forfait_piscine_m2: number | null;
  forfait_stationnement_min: number | null;
  forfait_stationnement_max: number | null;
}

export interface CommuneFiscaliteRow {
  part_communale_rate: number;
  secteurs_taux_majore: unknown;
  exonerations_facultatives: unknown;
  deliberation_ref: string | null;
  deliberation_date: Date | null;
  effective_from: Date;
}

export interface AssembleFiscaliteInput {
  year: number;
  isIdf: boolean;
  national: NationalConstantsRow | null;
  departementalRatePct: number | null;
  communale: CommuneFiscaliteRow | null;
}

export interface ResolvedFiscalite {
  year: number;
  is_idf: boolean;
  /** Constantes prêtes pour computeTaxeAmenagement (valeur forfaitaire déjà choisie métropole/IDF). null si millésime absent. */
  constantes: ConstantesFiscales | null;
  /** Valeur forfaitaire par m² retenue (métropole ou IDF), pour affichage. */
  valeur_forfaitaire_m2: number | null;
  /** Forfaits installations utiles à l'UI/calcul (null si millésime absent). */
  forfait_piscine_m2: number | null;
  forfait_stationnement_min: number | null;
  forfait_stationnement_max: number | null;
  /** Taux de part communale (%), null si la commune n'a pas encore renseigné sa fiscalité. */
  taux_communal_pct: number | null;
  secteurs_taux_majore: unknown;
  exonerations_facultatives: unknown;
  /** Taux de part départementale (%), null si non renseigné pour ce département/millésime. */
  taux_departemental_pct: number | null;
  source: {
    national: string | null;
    communale: { deliberation_ref: string | null; deliberation_date: Date | null; effective_from: Date } | null;
  };
  /** Drapeaux de complétude — conditionnent l'affichage « à compléter » dans le CU. */
  completeness: { national: boolean; communale: boolean; departementale: boolean };
  warnings: string[];
}

// ── Assemblage pur ────────────────────────────────────────────────────────────

export function assembleFiscalite(input: AssembleFiscaliteInput): ResolvedFiscalite {
  const warnings: string[] = [];
  const { year, isIdf, national, departementalRatePct, communale } = input;

  if (!national) {
    warnings.push(`Constantes nationales absentes pour le millésime ${year} — calcul de TA impossible tant qu'elles ne sont pas saisies.`);
  }
  if (!communale) {
    warnings.push("Fiscalité communale non renseignée — la commune doit saisir et valider sa part communale (la part communale sera comptée à 0 d'ici là).");
  }
  if (departementalRatePct == null) {
    warnings.push(`Taux de part départementale non renseigné pour ${year} — part départementale comptée à 0 d'ici là.`);
  }

  const valeurForfaitaire = national
    ? (isIdf ? national.valeur_forfaitaire_m2_idf : national.valeur_forfaitaire_m2)
    : null;

  const constantes: ConstantesFiscales | null = national
    ? {
        valeur_forfaitaire_m2: valeurForfaitaire ?? 0,
        abattement_rate: national.abattement_rate,
        rap_rate: national.rap_rate,
      }
    : null;

  return {
    year,
    is_idf: isIdf,
    constantes,
    valeur_forfaitaire_m2: valeurForfaitaire,
    forfait_piscine_m2: national?.forfait_piscine_m2 ?? null,
    forfait_stationnement_min: national?.forfait_stationnement_min ?? null,
    forfait_stationnement_max: national?.forfait_stationnement_max ?? null,
    taux_communal_pct: communale?.part_communale_rate ?? null,
    secteurs_taux_majore: communale?.secteurs_taux_majore ?? null,
    exonerations_facultatives: communale?.exonerations_facultatives ?? null,
    taux_departemental_pct: departementalRatePct,
    source: {
      national: national ? `Constantes nationales ${national.year}` : null,
      communale: communale
        ? { deliberation_ref: communale.deliberation_ref, deliberation_date: communale.deliberation_date, effective_from: communale.effective_from }
        : null,
    },
    completeness: {
      national: national != null,
      communale: communale != null,
      departementale: departementalRatePct != null,
    },
    warnings,
  };
}

// ── Wrapper DB ────────────────────────────────────────────────────────────────

export interface ResolveOptions {
  /** Date de référence (fait générateur / dépôt). Défaut : maintenant. */
  atDate?: Date;
}

/**
 * Résout la fiscalité applicable à une commune (par son id) à une date donnée.
 * Best-effort : une source manquante ne lève pas, elle ressort en
 * completeness=false + warning, pour que le générateur de CU signale la rubrique
 * « à compléter » plutôt que d'échouer.
 */
export async function resolveFiscaliteForCommune(
  communeId: string,
  opts?: ResolveOptions,
): Promise<ResolvedFiscalite> {
  const atDate = opts?.atDate ?? new Date();
  const year = atDate.getFullYear();

  const [commune] = await db
    .select({ insee_code: communes.insee_code })
    .from(communes)
    .where(eq(communes.id, communeId))
    .limit(1);
  const deptCode = departementCodeFromInsee(commune?.insee_code);
  const isIdf = isIdfDepartement(deptCode);

  // 1. Constantes nationales du millésime.
  const [national] = await db
    .select()
    .from(fiscal_national_constants)
    .where(eq(fiscal_national_constants.year, year))
    .limit(1);

  // 2. Taux départemental (département × millésime), le plus récent si doublon.
  const [dept] = deptCode
    ? await db
        .select({ rate: fiscal_departemental_rates.part_departementale_rate })
        .from(fiscal_departemental_rates)
        .where(and(
          eq(fiscal_departemental_rates.departement_code, deptCode),
          eq(fiscal_departemental_rates.year, year),
        ))
        .orderBy(desc(fiscal_departemental_rates.updated_at))
        .limit(1)
    : [];

  // 3. Fiscalité communale EN VIGUEUR à la date : validée, fenêtre couvrant atDate,
  //    la plus récente par effective_from.
  const [communale] = await db
    .select()
    .from(commune_fiscalite)
    .where(and(
      eq(commune_fiscalite.commune_id, communeId),
      eq(commune_fiscalite.status, "valide"),
      lte(commune_fiscalite.effective_from, atDate),
      or(isNull(commune_fiscalite.effective_to), gt(commune_fiscalite.effective_to, atDate)),
    ))
    .orderBy(desc(commune_fiscalite.effective_from))
    .limit(1);

  return assembleFiscalite({
    year,
    isIdf,
    national: (national as NationalConstantsRow | undefined) ?? null,
    departementalRatePct: dept?.rate ?? null,
    communale: (communale as CommuneFiscaliteRow | undefined) ?? null,
  });
}