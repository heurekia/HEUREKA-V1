import { pgTable, text, timestamp, integer, uuid, jsonb } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";
import { users } from "./users.js";

export const dossier_pieces_jointes = pgTable("dossier_pieces_jointes", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").notNull().references(() => users.id),
  nom: text("nom").notNull(),
  url: text("url").notNull(),
  type: text("type").notNull(),
  taille: integer("taille").notNull(),
  code_piece: text("code_piece"),
  analyse_ia: jsonb("analyse_ia"),
  // Extraction structurée — valeurs cotées / déclarées lues sur la pièce
  // (dimensions, surfaces, hauteurs NGF…). Sert d'entrée au moteur de
  // conformité (croisement avec les règles PLU).
  extraction_ia: jsonb("extraction_ia"),
  uploaded_at: timestamp("uploaded_at").notNull().defaultNow(),
});
