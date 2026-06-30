import { pgTable, text, timestamp, uuid, integer, doublePrecision, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { communes } from "./communes.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fiscalité de l'urbanisme — socle de données pour la taxe d'aménagement (TA)
// et la redevance d'archéologie préventive (RAP), en vue de la rubrique
// « taxes et participations » d'un Certificat d'Urbanisme.
//
// Modèle HYBRIDE assumé (cf. discussion produit) :
//   • Le NATIONAL et le DÉPARTEMENTAL sont des constantes que NOUS maintenons
//     (valeurs forfaitaires indexées par arrêté annuel, taux RAP, taux part
//     départementale voté par le conseil départemental). → tables centrales.
//   • Le COMMUNAL est saisi/validé par la commune elle-même (autorité qui FIXE
//     le taux) : taux de part communale, secteurs à taux majoré, exonérations
//     facultatives. → table `commune_fiscalite`, VERSIONNÉE.
//
// Pourquoi versionner le communal et pas juste écraser (cf. ai_pricing) : un CU
// CRISTALLISE les règles applicables (18 mois pour un CUa). Si une demande est
// instruite à cheval sur un changement de délibération, on doit pouvoir
// restituer le taux EN VIGUEUR À LA DATE DE LA DEMANDE, pas le dernier connu.
// D'où le couple effective_from / effective_to et un gate de validation humaine.
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Constantes nationales (millésimées) ───────────────────────────────────
// Une ligne par année (millésime). Source : arrêté annuel fixant les valeurs
// forfaitaires de la taxe d'aménagement (art. L.331-11 s. C. urb.). Mises à jour
// une fois par an par un admin depuis le back-office.
export const fiscal_national_constants = pgTable("fiscal_national_constants", {
  // Millésime d'application (ex. 2026). Clé naturelle : une seule grille par an.
  year: integer("year").primaryKey(),

  // Valeur forfaitaire par m² de surface taxable (hors Île-de-France), indexée
  // chaque année sur l'indice du coût de la construction (ex. 2025 : 930 €/m²).
  valeur_forfaitaire_m2: doublePrecision("valeur_forfaitaire_m2").notNull(),
  // Valeur forfaitaire par m² majorée applicable en Île-de-France.
  valeur_forfaitaire_m2_idf: doublePrecision("valeur_forfaitaire_m2_idf").notNull(),

  // Abattement de droit (art. L.331-12) : 50 % de la valeur forfaitaire pour les
  // 100 premiers m² de résidence principale, les logements sociaux et les locaux
  // industriels/artisanaux. Stockés en clair pour rester ajustables si la loi
  // change le taux ou le seuil.
  abattement_rate: doublePrecision("abattement_rate").notNull().default(0.5),
  abattement_surface_threshold_m2: doublePrecision("abattement_surface_threshold_m2").notNull().default(100),

  // Taux de la redevance d'archéologie préventive (part État), exprimé en % de
  // l'assiette (ex. 0.40). Réglé nationalement.
  rap_rate: doublePrecision("rap_rate").notNull(),

  // Forfaits d'aménagements particuliers (assiette spécifique, pas en m² de
  // plancher) : piscine (€/m²), emplacement de stationnement extérieur (€/place,
  // borne min/plafond délibérable par la commune).
  forfait_piscine_m2: doublePrecision("forfait_piscine_m2"),
  forfait_stationnement_min: doublePrecision("forfait_stationnement_min"),
  forfait_stationnement_max: doublePrecision("forfait_stationnement_max"),
  // Longue traîne des autres forfaits (panneaux PV au sol, éoliennes, tentes/
  // caravanes/HLL, etc.) → { code: string, libelle: string, valeur: number, unite: string }[].
  forfaits_installations: jsonb("forfaits_installations"),

  // Traçabilité : référence de l'arrêté qui fixe ces valeurs + qui a saisi.
  source_arrete: text("source_arrete"),
  note: text("note"),
  updated_by: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

// ── 2. Part départementale (par département, millésimée) ──────────────────────
// Taux voté par le conseil départemental (≤ 2,5 %, art. L.331-3), une valeur par
// département et par année. Finance les CAUE et les espaces naturels sensibles.
// Centralisé chez nous (pré-rempli) : la commune n'a pas à le saisir.
export const fiscal_departemental_rates = pgTable("fiscal_departemental_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Code département INSEE ("41", "75", "2A", "971"…).
  departement_code: text("departement_code").notNull(),
  year: integer("year").notNull(),
  // Taux de la part départementale, en % (ex. 1.50 pour 1,5 %).
  part_departementale_rate: doublePrecision("part_departementale_rate").notNull(),
  // Référence de la délibération du conseil départemental.
  source: text("source"),
  updated_by: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // Une seule ligne par (département, millésime).
  deptYearIdx: index("idx_fiscal_dept_rates_dept_year").on(t.departement_code, t.year),
}));

// ── 3. Fiscalité communale (versionnée) ───────────────────────────────────────
// Le spécifique communal, saisi par un responsable de la commune et validé.
// Une nouvelle DÉLIBÉRATION = une nouvelle ligne (on n'écrase jamais), datée par
// effective_from ; la précédente est clôturée (effective_to renseigné). La ligne
// « en vigueur » à une date D est celle où :
//   status = 'valide'  AND  effective_from <= D  AND  (effective_to IS NULL OR effective_to > D)
export const commune_fiscalite = pgTable("commune_fiscalite", {
  id: uuid("id").primaryKey().defaultRandom(),
  commune_id: uuid("commune_id").notNull().references(() => communes.id, { onDelete: "cascade" }),

  // Taux de droit commun de la part communale, en % (1 à 5 %, art. L.331-14 ;
  // jusqu'à 20 % en secteur à taux majoré dûment motivé — cf. secteurs ci-dessous).
  part_communale_rate: doublePrecision("part_communale_rate").notNull(),

  // Secteurs à taux majoré : array de
  //   { libelle: string, taux: number, motivation?: string, delib_ref?: string,
  //     geometry?: GeoJSON } — geometry optionnelle (sinon secteur décrit en
  //   toutes lettres et rattaché à la main par l'instructeur).
  secteurs_taux_majore: jsonb("secteurs_taux_majore"),

  // Exonérations FACULTATIVES délibérées (art. L.331-9) : liste de codes
  //   (ex. "logements_sociaux_pls", "commerces_<400m2", "abris_jardin_soumis_dp",
  //    "locaux_artisanaux", "maisons_sante", "immeubles_classes"…).
  exonerations_facultatives: jsonb("exonerations_facultatives"),

  // ── Provenance & versioning ───────────────────────────────────────────────
  // Référence de la délibération du conseil municipal qui fonde ces taux.
  deliberation_ref: text("deliberation_ref"),
  // Date de la délibération (acte fondateur).
  deliberation_date: timestamp("deliberation_date"),
  // Fenêtre d'application (cristallisation). effective_to NULL = en vigueur.
  effective_from: timestamp("effective_from").notNull(),
  effective_to: timestamp("effective_to"),

  // Gate juridique : une ligne n'est opposable (et lue par le générateur de CU)
  // que si status = 'valide'. 'brouillon' tant que la commune n'a pas validé.
  status: text("status").notNull().default("brouillon"),
  validated_by: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
  validated_at: timestamp("validated_at"),

  created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // Recherche « fiscalité en vigueur pour la commune X à la date D ».
  communeEffIdx: index("idx_commune_fiscalite_commune_eff").on(t.commune_id, t.effective_from),
}));
