import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const commune_documents = pgTable("commune_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  commune_id: uuid("commune_id").notNull(),
  type: text("type").notNull(), // ppri | oap | peb | pprt | plh | zac | autre
  name: text("name").notNull(),
  original_filename: text("original_filename").notNull(),
  file_size: integer("file_size"),
  pdf_content: text("pdf_content"), // base64 — conservé pour l'ingestion IA (Phase 2)
  // Synthèse textuelle (rédigée par l'instructeur) sur laquelle l'outil s'appuie
  // pendant l'instruction des dossiers situés dans le périmètre concerné.
  // ⚠️ Ne sera lue par le moteur d'instruction QUE si validation_status = 'valide'.
  synthese: text("synthese"),
  status: text("status").notNull().default("uploaded"), // uploaded | ingested | error
  ingested_at: timestamp("ingested_at"),
  // Validation humaine de la synthèse — gate juridique avant injection LLM.
  // Convention alignée avec zone_regulatory_rules : valide | brouillon | rejete.
  validation_status: text("validation_status").notNull().default("brouillon"),
  validated_by: uuid("validated_by"),
  validated_at: timestamp("validated_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
