import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { external_services } from "./externalServices.js";

export const courrier_templates = pgTable("courrier_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  service_id: uuid("service_id").notNull().references(() => external_services.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull().default("general"),
  body: text("body").notNull().default(""),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
