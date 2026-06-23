import { pgTable, text, timestamp, integer, jsonb, uuid } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";
import { dossier_consultations } from "./dossierConsultations.js";

export const dossier_messages = pgTable("dossier_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
  // Scope d'une conversation service-consulté : si non NULL, le fil n'est visible
  // qu'entre la mairie et le service rattaché à cette consultation. Les fils
  // citoyen↔mairie restent identifiés par consultation_id IS NULL.
  consultation_id: uuid("consultation_id").references(() => dossier_consultations.id, { onDelete: "cascade" }),
  from_user_id: text("from_user_id").notNull(),
  from_role: text("from_role").notNull(),
  content: text("content").notNull(),
  parent_id: integer("parent_id"),
  mentions: jsonb("mentions").default([]),
  // Pièces jointes référençant des documents de la GED du dossier
  // (dossier_documents). Format : DocumentAttachmentRef[]
  //   { document_id, nom, url, type }
  // Permet à l'instructeur de transmettre au citoyen une pièce annotée via la
  // messagerie interne. Les fichiers ne sont jamais dupliqués ici : on ne porte
  // qu'une référence vers la GED.
  attachments: jsonb("attachments").notNull().default([]),
  created_at: timestamp("created_at").notNull().defaultNow(),
  read_at: timestamp("read_at"),
});
