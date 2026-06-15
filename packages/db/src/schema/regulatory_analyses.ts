import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";
import { users } from "./users.js";

// Un run du moteur réglementaire sur un dossier à un instant donné.
//
// Reproductibilité juridique : engine_version + ruleset_version + le
// context_snapshot (faits utilisés, zones, applicabilité) doivent permettre
// de rejouer la même analyse plus tard, même si le PLU a évolué entre-temps.
//
// status : 'running' | 'done' | 'failed' | 'obsolete'.
// Une analyse passe en 'obsolete' dès qu'une analyse plus récente est
// validée sur le même dossier — l'historique reste consultable pour audit.
export const regulatory_analyses = pgTable("regulatory_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  engine_version: text("engine_version").notNull(),
  ruleset_version: text("ruleset_version"),
  context_snapshot: jsonb("context_snapshot"),
  summary: jsonb("summary"),
  triggered_by: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
  validated_by: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
  validated_at: timestamp("validated_at"),
  started_at: timestamp("started_at").notNull().defaultNow(),
  finished_at: timestamp("finished_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});
