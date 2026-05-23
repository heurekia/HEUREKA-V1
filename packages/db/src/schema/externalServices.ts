import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const external_services = pgTable("external_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  email: text("email"),
  telephone: text("telephone"),
  description: text("description"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
