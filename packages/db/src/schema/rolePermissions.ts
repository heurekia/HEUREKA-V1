import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const role_permissions = pgTable("role_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  label: text("label").notNull(),
  base_role: text("base_role").notNull().default("instructeur"),
  description: text("description"),
  color: text("color").notNull().default("#4F46E5"),
  permissions: jsonb("permissions").notNull().default([]).$type<string[]>(),
  is_system: boolean("is_system").notNull().default(false),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
