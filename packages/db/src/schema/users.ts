import { pgTable, text, timestamp, pgEnum, uuid, integer, boolean, jsonb } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["citoyen", "mairie", "instructeur", "admin", "service_externe"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // NULL pour un compte « 100 % FranceConnect » (aucun mot de passe local).
  password_hash: text("password_hash"),
  // Identifiant pivot FranceConnect (claim « sub »), NULL pour les comptes
  // email/mot de passe. Unicité garantie par un index partiel (cf. migrate.ts).
  fc_sub: text("fc_sub"),
  prenom: text("prenom").notNull(),
  nom: text("nom").notNull(),
  role: userRoleEnum("role").notNull().default("citoyen"),
  commune: text("commune"),
  commune_insee: text("commune_insee"),
  telephone: text("telephone"),
  avatar_url: text("avatar_url"),
  role_config_id: uuid("role_config_id"),
  service_id: uuid("service_id"),
  // Horodatage de confirmation de l'adresse email. NULL = email non vérifié :
  // la connexion est refusée tant que le citoyen n'a pas cliqué sur le lien de
  // vérification reçu après l'inscription publique. Les comptes invités
  // (mairie/instructeur) sont marqués vérifiés au moment de l'activation.
  email_verified_at: timestamp("email_verified_at"),
  // Horodatage de complétion de l'onboarding (pop-up de bienvenue). NULL =
  // jamais vu → la modale d'accueil s'affiche à la 1re connexion d'un agent
  // mairie/instructeur. Renseigné une fois que l'agent l'a parcourue/fermée.
  onboarding_completed_at: timestamp("onboarding_completed_at"),
  // Compteur de version de session : incrémenté pour invalider d'un coup TOUS
  // les jetons JWT existants d'un utilisateur (changement de mot de passe, de
  // rôle, ou révocation/offboarding). Le JWT embarque cette valeur (claim `tv`)
  // et requireAuth la compare à la valeur courante (cf. middlewares/auth.ts).
  token_version: integer("token_version").notNull().default(0),
  // MFA TOTP (opt-in, comptes agents/admin). mfa_secret = secret TOTP CHIFFRÉ
  // au repos (AES-256-GCM, cf. services/mfa.ts) ; NULL = non enrôlé. mfa_enabled
  // passe à true seulement après confirmation d'un 1er code. mfa_backup_codes =
  // empreintes SHA-256 des codes de secours à usage unique (jamais en clair).
  mfa_secret: text("mfa_secret"),
  mfa_enabled: boolean("mfa_enabled").notNull().default(false),
  mfa_backup_codes: jsonb("mfa_backup_codes").$type<string[]>(),
  // Offboarding d'un compte PROFESSIONNEL (mairie/instructeur/admin/service).
  // NULL = compte actif ; non-NULL = compte désactivé. Contrairement aux
  // citoyens (effacés, RGPD art. 17), les comptes pro ne sont JAMAIS supprimés :
  // ils portent des records légaux dont les FK NOT NULL interdisent l'effacement
  // (decisions.instructeur_id = arrêté signé). Une fois deactivated_at posé, la
  // connexion est refusée et toutes les sessions sont révoquées (token_version).
  // deactivated_by = id de l'admin qui a effectué l'offboarding (uuid simple,
  // sans FK — cf. instructeur_status_by — pour ne pas réintroduire une FK
  // bloquante sur users).
  deactivated_at: timestamp("deactivated_at"),
  deactivated_by: uuid("deactivated_by"),
  // Préférences de notification de la cloche mairie, par type :
  // { [type]: boolean }. Une clé absente vaut « activé » (modèle opt-out). Lue
  // et filtrée dans services/notify.ts avant l'insertion d'une notification.
  notification_prefs: jsonb("notification_prefs").$type<Record<string, boolean>>().notNull().default({}),
  // Profil CERFA mémorisé (RGPD — confort de saisie, citoyens). Sous-ensemble
  // STABLE et réutilisable des données d'état civil saisies au step 5 du tunnel
  // (civilité, date/lieu de naissance, qualité, adresse postale du demandeur,
  // société). CHIFFRÉ au repos (AES-256-GCM, cf. services/cerfaProfile.ts) :
  // un dump de la base n'expose pas la date de naissance en clair. NULL = aucun
  // profil mémorisé. Finalité distincte de l'instruction → base légale
  // consentement (opt-in révocable, cf. cerfa_profile_consent_at). Effacé par
  // cascade à la suppression du compte (colonne portée par users).
  cerfa_profile: text("cerfa_profile"),
  // Horodatage du consentement à la mémorisation du profil CERFA (RGPD art.
  // 6-1-a). NULL = pas de consentement / profil non mémorisé. Posé au moment où
  // le citoyen coche « Mémoriser ces informations » ; remis à NULL (avec
  // cerfa_profile) lorsqu'il révoque.
  cerfa_profile_consent_at: timestamp("cerfa_profile_consent_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
