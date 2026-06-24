import { boolean, doublePrecision, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// Grille tarifaire par paliers de population (le « catalogue d'offres » de la
// plateforme). Une commune est rattachée automatiquement au plan dont la
// tranche de population [pop_min, pop_max] contient sa population (cf.
// services/billing.ts → matchPlanForPopulation), prix recopié en snapshot sur
// la ligne facturée — l'admin garde la main pour modifier.
//
// `applies_to` ∈ {commune, epci} : les paliers population ciblent les communes ;
// le palier « Intercommunalité » cible les EPCI (pas de population stockée).
// `dossiers_per_month` / `agents_included` NULL = illimité.
export const billing_plans = pgTable("billing_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  // Libellé de la cible affiché dans la grille (« < 1 500 hab », « EPCI, CC, CA »…).
  target_label: text("target_label"),
  // Tranche de population (incluse). NULL = borne ouverte.
  pop_min: integer("pop_min"),
  pop_max: integer("pop_max"),
  applies_to: text("applies_to").notNull().default("commune"),
  // Prix d'abonnement HT.
  monthly_price_eur: doublePrecision("monthly_price_eur").notNull().default(0),
  annual_price_eur: doublePrecision("annual_price_eur").notNull().default(0),
  // Frais d'onboarding HT (one-shot) : mise en service initiale et reprise
  // intermédiaire. Revenus non récurrents.
  onboarding_initial_eur: doublePrecision("onboarding_initial_eur").notNull().default(0),
  onboarding_intermediate_eur: doublePrecision("onboarding_intermediate_eur").notNull().default(0),
  dossiers_per_month: integer("dossiers_per_month"),
  agents_included: integer("agents_included"),
  support_level: text("support_level"),
  vat_rate: doublePrecision("vat_rate").notNull().default(20),
  active: boolean("active").notNull().default(true),
  sort_order: integer("sort_order").notNull().default(0),
  updated_by: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
