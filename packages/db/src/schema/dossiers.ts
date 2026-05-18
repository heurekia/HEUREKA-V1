import { pgTable, text, timestamp, boolean, jsonb, pgEnum, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const dossierTypeEnum = pgEnum("dossier_type", [
  "permis_de_construire",
  "declaration_prealable",
  "permis_amenager",
  "permis_demolir",
  "permis_lotir",
  "certificat_urbanisme",
]);

export const dossierStatusEnum = pgEnum("dossier_status", [
  "brouillon",
  "soumis",
  "pre_instruction",
  "incomplet",
  "en_instruction",
  "decision_en_cours",
  "accepte",
  "refuse",
  "accord_prescription",
]);

export const dossiers = pgTable("dossiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  numero: text("numero").notNull().unique(),
  type: dossierTypeEnum("type").notNull(),
  status: dossierStatusEnum("status").notNull().default("brouillon"),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  instructeur_id: uuid("instructeur_id").references(() => users.id),
  parcelle: text("parcelle"),
  adresse: text("adresse"),
  commune: text("commune"),
  code_postal: text("code_postal"),
  description: text("description"),
  surface_plancher: text("surface_plancher"),
  metadata: jsonb("metadata").default({}),
  date_depot: timestamp("date_depot"),
  date_completude: timestamp("date_completude"),
  date_limite_instruction: timestamp("date_limite_instruction"),
  is_tacite: boolean("is_tacite").notNull().default(false),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
