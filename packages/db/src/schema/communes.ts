import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const communes = pgTable("communes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  insee_code: text("insee_code").notNull().unique(),
  zip_code: text("zip_code"),
  email: text("email"),
  telephone: text("telephone"),
  logo_url: text("logo_url"),
  population: text("population"),
  surface: text("surface"),
  departement: text("departement"),
  region: text("region"),
  description: text("description"),
  epci_id: uuid("epci_id"),
  instruction_mutualisee: boolean("instruction_mutualisee").notNull().default(false),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
