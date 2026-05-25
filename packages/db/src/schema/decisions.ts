import { pgTable, uuid, text, date, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { dossiers } from "./dossiers.js";

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
  commune: text("commune").notNull(),
  type: text("type").notNull(),
  motif: text("motif"),
  prescriptions: jsonb("prescriptions").$type<string[]>().notNull().default([]),
  conditions: text("conditions"),
  // brouillon | soumis_signature | revision_necessaire | signe | notifie | archive
  status: text("status").notNull().default("brouillon"),
  instructeur_id: uuid("instructeur_id").notNull().references(() => users.id),
  signataire_id: uuid("signataire_id").references(() => users.id, { onDelete: "set null" }),
  arrete_numero: text("arrete_numero"),
  date_decision: date("date_decision"),
  date_notification: date("date_notification"),
  date_limite_recours: date("date_limite_recours"),
  motif_refus_signature: text("motif_refus_signature"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
