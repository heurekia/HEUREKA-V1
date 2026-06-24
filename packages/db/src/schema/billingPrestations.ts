import { boolean, doublePrecision, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// Catalogue des prestations facturables aux collectivités (communes / EPCI).
// Édité depuis l'onglet « Facturation » du back-office super-admin. Sert de
// source aux valeurs par défaut (prix HT, TVA, cycle) quand on ajoute une
// ligne de facturation à un client : chaque ligne recopie ces valeurs en
// snapshot (cf. billing_items) pour rester stable même si le catalogue évolue.
//
// `billing_cycle` ∈ {one_shot, monthly, quarterly, yearly, usage}.
//   - récurrent (monthly/quarterly/yearly) → alimente le MRR/ARR ;
//   - one_shot → forfait ponctuel (setup, formation…) ;
//   - usage → facturation au volume saisie périodiquement (ex. par dossier).
export const billing_prestations = pgTable("billing_prestations", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Slug stable (ex. "abonnement_annuel", "instruction_dossier", "setup").
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  // Prix unitaire HT par défaut, en euros.
  default_unit_price_eur: doublePrecision("default_unit_price_eur").notNull().default(0),
  // Unité affichée ("mois", "an", "dossier", "habitant", "forfait"…).
  unit: text("unit").notNull().default("forfait"),
  // Taux de TVA par défaut en pourcentage (20 = 20 %). 0 = exonéré.
  default_vat_rate: doublePrecision("default_vat_rate").notNull().default(20),
  billing_cycle: text("billing_cycle").notNull().default("one_shot"),
  active: boolean("active").notNull().default(true),
  sort_order: integer("sort_order").notNull().default(0),
  updated_by: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
