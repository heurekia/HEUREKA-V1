import { pgTable, text, timestamp, pgEnum, uuid } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["citoyen", "mairie", "instructeur", "admin", "service_externe"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  prenom: text("prenom").notNull(),
  nom: text("nom").notNull(),
  role: userRoleEnum("role").notNull().default("citoyen"),
  commune: text("commune"),
  commune_insee: text("commune_insee"),
  telephone: text("telephone"),
  avatar_url: text("avatar_url"),
  role_config_id: uuid("role_config_id"),
  service_id: uuid("service_id"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
