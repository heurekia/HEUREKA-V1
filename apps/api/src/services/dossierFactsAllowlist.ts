import { z } from "zod";

// ─── Allowlist des clés de fait modifiables par l'instructeur ────────
//
// Pourquoi un allowlist : sans cela, n'importe quel client authentifié
// pourrait inonder dossier_facts avec des clés arbitraires (pollution,
// incident d'audit, et le moteur ne lit que les clés qu'il connaît de
// toute façon). L'allowlist mirror les clés qu'on sait produire et
// consommer côté evaluators et UI.
//
// Chaque clé déclare un schéma Zod de la `value` attendue, plus une unité
// optionnelle par défaut. Toute valeur qui ne passe pas le schéma est
// rejetée par l'API en 400 — pas de cast silencieux.

const numericMeters = z.number().finite().min(0).max(1000);
const numericArea = z.number().finite().min(0).max(1_000_000);
const numericRatio = z.number().finite().min(0).max(1);
const numericInteger = z.number().int().min(0).max(10_000);
const numericDegrees = z.number().finite().min(0).max(360);
const nonEmptyString = z.string().trim().min(1).max(200);

export interface FactKeySpec {
  schema: z.ZodTypeAny;
  defaultUnit?: string;
  // Description courte affichée dans l'erreur 400 si la valeur ne passe
  // pas — l'instructeur sait quoi corriger sans deviner.
  hint: string;
}

export const EDITABLE_FACT_KEYS: Record<string, FactKeySpec> = {
  // Mesures dimensionnelles
  hauteur:                    { schema: numericMeters, defaultUnit: "m",   hint: "Nombre en mètres (0 à 1000), ex. 9.5" },
  hauteur_acrotere:           { schema: numericMeters, defaultUnit: "m",   hint: "Nombre en mètres" },
  recul_voie:                 { schema: numericMeters, defaultUnit: "m",   hint: "Nombre en mètres" },
  reculs_limites:             { schema: z.array(numericMeters).min(1).max(20), defaultUnit: "m", hint: "Tableau de cotes en mètres, ex. [3.2, 4.0]" },

  // Surfaces
  emprise:                    { schema: numericArea, defaultUnit: "m2", hint: "Nombre en m²" },
  emprise_existante:          { schema: numericArea, defaultUnit: "m2", hint: "Nombre en m²" },
  emprise_creee:              { schema: numericArea, defaultUnit: "m2", hint: "Nombre en m²" },
  surface_terrain:            { schema: numericArea, defaultUnit: "m2", hint: "Nombre en m²" },
  surface_plancher_apres:     { schema: numericArea, defaultUnit: "m2", hint: "Nombre en m²" },
  surface_plancher_existante: { schema: numericArea, defaultUnit: "m2", hint: "Nombre en m²" },
  surface_plancher_creee:     { schema: numericArea, defaultUnit: "m2", hint: "Nombre en m²" },

  // Comptes
  stationnement: { schema: numericInteger, defaultUnit: "places", hint: "Nombre entier de places" },
  nb_logements:  { schema: numericInteger, defaultUnit: undefined, hint: "Nombre entier" },

  // Pente / inclinaison
  pente_toiture: { schema: numericDegrees, defaultUnit: "deg", hint: "Nombre en degrés (0 à 360)" },
  pente_terrain: { schema: z.number().finite().min(0).max(100), defaultUnit: "pct", hint: "Pourcentage (0 à 100)" },

  // Catégoriels / textes
  destination_apres: { schema: nonEmptyString, hint: "Texte court, ex. habitation, commerce" },
  toiture_type:      { schema: nonEmptyString, hint: "Texte court, ex. deux pans, monopente, terrasse" },

  // Tags contextuels (forme booléenne)
  extension:               { schema: z.boolean(), hint: "true ou false" },
  surelevation:            { schema: z.boolean(), hint: "true ou false" },
  demolition:              { schema: z.boolean(), hint: "true ou false" },
  annexe:                  { schema: z.boolean(), hint: "true ou false" },
  changement_destination:  { schema: z.boolean(), hint: "true ou false" },
  ravalement:              { schema: z.boolean(), hint: "true ou false" },
  cloture:                 { schema: z.boolean(), hint: "true ou false" },
  secteur_abf:             { schema: z.boolean(), hint: "true ou false" },

  // Listes contextuelles
  zonage_plu:     { schema: z.array(nonEmptyString).min(1).max(10), hint: "Tableau de codes zone, ex. [UA] ou [UA, UB]" },
  risques:        { schema: z.array(nonEmptyString).max(20), hint: "Tableau d'étiquettes de risque" },
  servitudes:     { schema: z.array(nonEmptyString).max(50), hint: "Tableau de catégories de SUP" },
  nature_travaux: { schema: z.array(nonEmptyString).min(1).max(20), hint: "Tableau de natures du wizard" },
  materiaux:      { schema: z.array(nonEmptyString).min(1).max(50), hint: "Tableau de matériaux" },
  teintes:        { schema: z.array(nonEmptyString).min(1).max(50), hint: "Tableau de teintes" },
};

export function isEditableKey(key: string): key is keyof typeof EDITABLE_FACT_KEYS {
  return Object.prototype.hasOwnProperty.call(EDITABLE_FACT_KEYS, key);
}
