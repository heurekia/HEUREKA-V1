import { pgTable, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Réglages globaux du site public (singleton id = 1), pilotés depuis le
// super-admin. Même approche que ai_alert_config : une seule ligne garantie
// par un CHECK (id = 1).
//
// Usage principal : le mode « bientôt en ligne ». Quand il est actif, le portail
// public (www.heurekia.com + apex) affiche une page vitrine « le système arrive
// prochainement » et exige un mot de passe d'accès avant de laisser entrer.
export const site_settings = pgTable("site_settings", {
  id: integer("id").primaryKey().default(1),
  // true → le site public affiche la page vitrine et exige le mot de passe.
  // false → site normalement accessible (comportement par défaut).
  coming_soon_enabled: boolean("coming_soon_enabled").notNull().default(false),
  // Titre + message affichés sur la page vitrine. null → textes par défaut côté front.
  coming_soon_title: text("coming_soon_title"),
  coming_soon_message: text("coming_soon_message"),
  // Hash bcrypt du mot de passe d'accès. null = aucun mot de passe défini ;
  // dans ce cas on interdit l'activation du mode pour ne bloquer personne sans
  // issue (le mot de passe en clair n'est jamais stocké ni renvoyé au client).
  coming_soon_password_hash: text("coming_soon_password_hash"),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
