import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";
import { users } from "./users.js";
import { external_services } from "./externalServices.js";

export const dossier_consultations = pgTable("dossier_consultations", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
  service_name: text("service_name").notNull(),
  service_type: text("service_type").notNull(),
  external_service_id: uuid("external_service_id").references(() => external_services.id, { onDelete: "set null" }),
  // status: en_attente | avis_recu | non_requis | refuse
  status: text("status").notNull().default("en_attente"),
  favorable: boolean("favorable"),
  avis: text("avis"),
  date_envoi: timestamp("date_envoi").notNull().defaultNow(),
  date_reponse: timestamp("date_reponse"),
  created_by_id: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
