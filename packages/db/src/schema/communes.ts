import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const communes = pgTable("communes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  insee_code: text("insee_code").notNull().unique(),
  zip_code: text("zip_code"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
