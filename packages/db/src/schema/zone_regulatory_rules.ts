import { pgTable, text, timestamp, integer, doublePrecision, uuid } from "drizzle-orm/pg-core";
import { zones } from "./zones.js";

export const zone_regulatory_rules = pgTable("zone_regulatory_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  zone_id: uuid("zone_id").notNull().references(() => zones.id, { onDelete: "cascade" }),
  article_number: integer("article_number"),
  article_title: text("article_title"),
  topic: text("topic").notNull().default("general"),
  rule_text: text("rule_text").notNull(),
  conditions: text("conditions"),
  exceptions: text("exceptions"),
  summary: text("summary"),
  value_min: doublePrecision("value_min"),
  value_max: doublePrecision("value_max"),
  value_exact: doublePrecision("value_exact"),
  unit: text("unit"),
  instructor_note: text("instructor_note"),
  validation_status: text("validation_status").notNull().default("draft"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
