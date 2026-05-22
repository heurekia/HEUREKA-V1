import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const epci = pgTable("epci", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  siren: text("siren").unique(),
  type: text("type").notNull().default("CC"),
  departement: text("departement"),
  region: text("region"),
  logo_url: text("logo_url"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
