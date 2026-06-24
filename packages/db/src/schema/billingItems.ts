import { date, doublePrecision, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { communes } from "./communes.js";
import { epci } from "./epci.js";
import { billing_prestations } from "./billingPrestations.js";
import { billing_plans } from "./billingPlans.js";
import { users } from "./users.js";

// Une ligne = une prestation facturée à UNE collectivité (commune OU EPCI).
// Exactement un de commune_id / epci_id est renseigné (contrainte CHECK posée
// côté migration). Les valeurs prix/TVA/cycle sont des snapshots du catalogue
// au moment de l'ajout : modifier le catalogue ne réécrit pas l'historique.
//
// Reconnaissance du chiffre d'affaires (cf. services/billing.ts) :
//   - récurrent (monthly/quarterly/yearly) : proraté sur la période demandée
//     entre start_date et end_date (NULL = abonnement toujours actif) ;
//   - one_shot / usage : compté en totalité dans la période contenant
//     start_date (date de facturation de la ligne).
export const billing_items = pgTable("billing_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Référence catalogue (nullable : une ligne peut être ad hoc, hors catalogue).
  prestation_id: uuid("prestation_id").references(() => billing_prestations.id, { onDelete: "set null" }),
  // Plan tarifaire (palier population) appliqué, le cas échéant (nullable).
  plan_id: uuid("plan_id").references(() => billing_plans.id, { onDelete: "set null" }),
  commune_id: uuid("commune_id").references(() => communes.id, { onDelete: "cascade" }),
  epci_id: uuid("epci_id").references(() => epci.id, { onDelete: "cascade" }),
  // Libellé snapshot (éditable indépendamment du catalogue).
  label: text("label").notNull(),
  quantity: doublePrecision("quantity").notNull().default(1),
  // Prix unitaire HT (snapshot), en euros.
  unit_price_eur: doublePrecision("unit_price_eur").notNull().default(0),
  vat_rate: doublePrecision("vat_rate").notNull().default(20),
  billing_cycle: text("billing_cycle").notNull().default("one_shot"),
  // Début de l'abonnement (récurrent) ou date de facturation (ponctuel/usage).
  start_date: date("start_date").notNull(),
  // Fin de l'abonnement. NULL = toujours actif.
  end_date: date("end_date"),
  // 'active' | 'cancelled'.
  status: text("status").notNull().default("active"),
  note: text("note"),
  created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
