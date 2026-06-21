import { pgTable, text, timestamp, integer, uuid, jsonb, boolean } from "drizzle-orm/pg-core";
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
  // Décision de l'instructeur : null = pas encore examiné ; "valide" /
  // "rejete" / "complement_demande" = statut explicitement posé.
  instructeur_status: text("instructeur_status"),
  instructeur_note: text("instructeur_note"),
  instructeur_status_at: timestamp("instructeur_status_at"),
  instructeur_status_by: uuid("instructeur_status_by"),
  // RGPD : trace par pièce de l'exécution effective d'une analyse IA.
  // false = le citoyen a refusé OU le format n'est pas analysable.
  ai_processed: boolean("ai_processed").notNull().default(false),
  // Cycle de vie de l'OCR / analyse IA exécutée en arrière-plan après l'upload
  // au comptoir mairie. Valeurs : pending|processing|done|failed|skipped.
  // pending = inséré, en attente de prise en charge par le worker.
  // processing = en cours d'analyse.
  // done = OCR terminé avec succès (analyse_ia ou extraction_ia non null).
  // failed = OCR tenté mais sans résultat exploitable.
  // skipped = pas d'analyse (consentement refusé / format non supporté).
  ocr_status: text("ocr_status").notNull().default("pending"),
  ocr_started_at: timestamp("ocr_started_at"),
  ocr_completed_at: timestamp("ocr_completed_at"),
  // Versioning : quand l'instructeur demande un complément sur une pièce et
  // que le pétitionnaire en redépose une nouvelle pour le même slot, l'ancienne
  // est archivée (jamais supprimée — audit RGPD). archived_by_piece_id pointe
  // sur la pièce qui l'a remplacée, pour reconstruire la chronologie.
  archived_at: timestamp("archived_at"),
  archived_by_piece_id: uuid("archived_by_piece_id"),
  uploaded_at: timestamp("uploaded_at").notNull().defaultNow(),
});
