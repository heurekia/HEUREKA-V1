import { pgTable, uuid, text, date, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const signataires = pgTable("signataires", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // commune name (matches dossiers.commune)
  commune: text("commune").notNull(),
  // maire | adjoint | dgs | responsable_ads | directeur
  role: text("role").notNull(),
  // Intitulé exact de la fonction, imprimé dans les courriers (ex.
  // « Conseiller Municipal Délégué à l'Urbanisme »). Plus précis que `role`.
  // NULL → on retombe sur le libellé générique du rôle.
  fonction: text("fonction"),
  // Signature manuscrite et tampon/cachet PROPRES au signataire (et non à la
  // commune) : un courrier est signé par une personne, pas par la mairie.
  // Le rendu retombe sur les images de la commune si le signataire n'en a pas.
  signature_image: text("signature_image"),
  tampon_image: text("tampon_image"),
  delegation_arrete: text("delegation_arrete"),
  delegation_date: date("delegation_date"),
  active: boolean("active").notNull().default(true),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
