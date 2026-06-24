import { date, doublePrecision, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// Charges d'exploitation saisies à la main pour le « mini compte de résultat »
// (hébergement, infrastructure, salaires, marketing, logiciels, divers…).
// Les coûts IA Mistral sont déjà tracés dans ai_usage_events et réinjectés
// séparément dans le compte de résultat — ne PAS les ressaisir ici.
//
// `recurrence` ∈ {one_shot, monthly, quarterly, yearly} : une charge récurrente
// est proratée sur la période demandée (entre incurred_on et end_date), une
// charge one_shot est comptée dans la période contenant incurred_on.
export const billing_costs = pgTable("billing_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Catégorie ("infrastructure", "hebergement", "salaires", "marketing",
  // "logiciels", "autre"…). Libre, regroupée dans le compte de résultat.
  category: text("category").notNull().default("autre"),
  label: text("label").notNull(),
  // Montant HT en euros (par occurrence pour les charges récurrentes).
  amount_eur: doublePrecision("amount_eur").notNull().default(0),
  // TVA déductible en pourcentage (20 = 20 %). 0 = sans TVA déductible.
  vat_rate: doublePrecision("vat_rate").notNull().default(0),
  recurrence: text("recurrence").notNull().default("one_shot"),
  // Date de la charge (ponctuelle) ou début de la charge récurrente.
  incurred_on: date("incurred_on").notNull(),
  // Fin de la charge récurrente. NULL = toujours en cours.
  end_date: date("end_date"),
  note: text("note"),
  created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
