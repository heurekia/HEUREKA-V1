import { pgTable, text, timestamp, boolean, integer, jsonb, doublePrecision, uuid } from "drizzle-orm/pg-core";
import { communes } from "./communes.js";
import { regulatory_documents } from "./regulatoryDocuments.js";

export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  commune_id: uuid("commune_id").notNull().references(() => communes.id),
  // Document réglementaire d'origine. Nullable : permet aux zones créées
  // manuellement (route POST /reglementation/zones) d'exister sans document
  // attaché. ON DELETE SET NULL — supprimer un document ne casse pas les
  // zones qu'il a produites (purge contrôlée côté applicatif).
  source_document_id: uuid("source_document_id").references(() => regulatory_documents.id, { onDelete: "set null" }),
  zone_code: text("zone_code").notNull(),
  zone_label: text("zone_label"),
  zone_type: text("zone_type"),
  summary: text("summary"),
  geometry: jsonb("geometry"),
  status: text("status").notNull().default("draft"),
  constraints: jsonb("constraints").default([]),
  parent_zone_code: text("parent_zone_code"),
  is_active: boolean("is_active").notNull().default(true),
  display_order: integer("display_order").notNull().default(0),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
