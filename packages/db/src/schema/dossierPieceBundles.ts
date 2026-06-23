import { pgTable, text, integer, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";
import { users } from "./users.js";

// ── Dépôt groupé : un seul fichier (PDF) éclaté en plusieurs pièces ──────────
//
// Le flux historique reste « 1 fichier = 1 pièce » via POST /pieces/upload.
// Ce nouveau flux, STRICTEMENT ADDITIF et optionnel, permet à l'agent de
// déposer un dossier complet en un seul PDF : le système segmente le document
// (un appel vision/texte), propose un découpage (1 segment = 1 pièce), et
// l'instructeur le valide/corrige AVANT que les pièces ne soient créées. Une
// fois validé, chaque segment devient une `dossier_pieces_jointes` normale qui
// repasse dans le pipeline OCR existant (analyse + extraction).
//
// Le fichier source est conservé tel quel (jamais supprimé) comme artefact
// auditable, et la proposition de découpage est stockée ici jusqu'à validation.
export const dossier_piece_bundles = pgTable("dossier_piece_bundles", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
  // L'agent/instructeur qui a déposé le bundle (nullable pour rester tolérant
  // aux dépôts automatisés). Les pièces créées, elles, restent rattachées au
  // propriétaire du dossier (cohérence IDOR — cf. route /pieces/upload).
  user_id: uuid("user_id").references(() => users.id),
  nom: text("nom").notNull(),
  url: text("url").notNull(),
  // Clé de stockage (S3/local) du fichier source — nécessaire pour relire le
  // PDF au moment de l'application du découpage (requête distincte de l'upload).
  storage_key: text("storage_key").notNull(),
  type: text("type").notNull(),
  taille: integer("taille").notNull(),
  page_count: integer("page_count"),
  // Cycle de vie : segmenting → pending_review → applied | discarded
  //                        ↘ failed (segmentation impossible)
  status: text("status").notNull().default("segmenting"),
  // Proposition de découpage produite par la segmentation, éditable par
  // l'instructeur avant application. Forme : { method, page_count, segments[] }.
  proposed_segments: jsonb("proposed_segments"),
  error: text("error"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  segmented_at: timestamp("segmented_at"),
  applied_at: timestamp("applied_at"),
  applied_by: uuid("applied_by"),
});
