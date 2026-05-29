import "dotenv/config";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL ?? "postgres://localhost:5432/heureka_v1";

const SQL = `
-- Enums
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('citoyen', 'mairie', 'instructeur', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dossier_type AS ENUM (
    'permis_de_construire', 'declaration_prealable', 'permis_amenager',
    'permis_demolir', 'permis_lotir', 'certificat_urbanisme'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dossier_status AS ENUM (
    'brouillon', 'soumis', 'pre_instruction', 'incomplet',
    'en_instruction', 'decision_en_cours', 'accepte', 'refuse', 'accord_prescription'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tables
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  prenom text NOT NULL,
  nom text NOT NULL,
  role user_role NOT NULL DEFAULT 'citoyen',
  commune text,
  telephone text,
  avatar_url text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS communes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  insee_code text NOT NULL UNIQUE,
  zip_code text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL UNIQUE,
  type dossier_type NOT NULL,
  status dossier_status NOT NULL DEFAULT 'brouillon',
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instructeur_id uuid REFERENCES users(id),
  parcelle text,
  adresse text,
  commune text,
  code_postal text,
  description text,
  surface_plancher text,
  metadata jsonb DEFAULT '{}',
  date_depot timestamp,
  date_completude timestamp,
  date_limite_instruction timestamp,
  is_tacite boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dossier_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  from_user_id text NOT NULL,
  from_role text NOT NULL,
  content text NOT NULL,
  parent_id integer,
  mentions jsonb DEFAULT '[]',
  created_at timestamp NOT NULL DEFAULT now(),
  read_at timestamp
);

CREATE TABLE IF NOT EXISTS dossier_pieces_jointes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  nom text NOT NULL,
  url text NOT NULL,
  type text NOT NULL,
  taille integer NOT NULL,
  uploaded_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dossier_id uuid REFERENCES dossiers(id) ON DELETE SET NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id uuid NOT NULL REFERENCES communes(id),
  zone_code text NOT NULL,
  zone_label text,
  zone_type text,
  summary text,
  geometry jsonb,
  status text NOT NULL DEFAULT 'draft',
  constraints jsonb DEFAULT '[]',
  parent_zone_code text,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zone_regulatory_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  article_number integer,
  article_title text,
  topic text NOT NULL DEFAULT 'general',
  rule_text text NOT NULL,
  conditions text,
  exceptions text,
  summary text,
  value_min double precision,
  value_max double precision,
  value_exact double precision,
  unit text,
  instructor_note text,
  validation_status text NOT NULL DEFAULT 'draft',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instruction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  type text NOT NULL,
  user_id text,
  description text,
  metadata jsonb DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  date timestamp NOT NULL,
  end_date timestamp,
  type text NOT NULL,
  dossier_id uuid REFERENCES dossiers(id) ON DELETE SET NULL,
  user_id text,
  description text,
  all_day boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Schema changes (idempotent)
ALTER TABLE dossier_messages ADD COLUMN IF NOT EXISTS read_at timestamp;

ALTER TABLE communes DROP CONSTRAINT IF EXISTS communes_name_unique;
ALTER TABLE communes DROP CONSTRAINT IF EXISTS communes_name_key;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS telephone text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS population text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS surface text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS departement text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS description text;

CREATE TABLE IF NOT EXISTS epci (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  siren text UNIQUE,
  type text NOT NULL DEFAULT 'CC',
  departement text,
  region text,
  logo_url text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE communes ADD COLUMN IF NOT EXISTS epci_id uuid REFERENCES epci(id) ON DELETE SET NULL;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS instruction_mutualisee boolean NOT NULL DEFAULT false;

-- Promote mairie@tours.fr to admin
UPDATE users SET role = 'admin' WHERE email = 'mairie@tours.fr';

CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  label text NOT NULL,
  base_role text NOT NULL DEFAULT 'instructeur',
  description text,
  color text NOT NULL DEFAULT '#4F46E5',
  permissions jsonb NOT NULL DEFAULT '[]',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_config_id uuid REFERENCES role_permissions(id) ON DELETE SET NULL;

-- Services annexes (ABF, SDIS, DDT, etc.)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'service_externe';

CREATE TABLE IF NOT EXISTS external_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  email text,
  telephone text,
  description text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES external_services(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS service_communes (
  service_id uuid NOT NULL REFERENCES external_services(id) ON DELETE CASCADE,
  commune_id uuid NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, commune_id)
);

-- Audit logs (connexions, actions sensibles)
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  email text,
  action text NOT NULL,
  ip text,
  user_agent text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Tokens d'activation de compte et de réinitialisation de mot de passe
CREATE TABLE IF NOT EXISTS password_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  type text NOT NULL DEFAULT 'activation',
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_tokens_token ON password_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_tokens_user_id ON password_tokens(user_id);

-- Extend courrier_templates for mairie usage
ALTER TABLE courrier_templates ALTER COLUMN service_id DROP NOT NULL;
ALTER TABLE courrier_templates ADD COLUMN IF NOT EXISTS commune text;

-- Letterhead & signature for communes (mairie)
ALTER TABLE communes ADD COLUMN IF NOT EXISTS letterhead_logo text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS letterhead_title text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS letterhead_subtitle text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS letterhead_address text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS footer_text text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS signature_image text;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS tampon_image text;

-- Letterhead & signature for external services
ALTER TABLE external_services ADD COLUMN IF NOT EXISTS letterhead_logo text;
ALTER TABLE external_services ADD COLUMN IF NOT EXISTS letterhead_title text;
ALTER TABLE external_services ADD COLUMN IF NOT EXISTS letterhead_subtitle text;
ALTER TABLE external_services ADD COLUMN IF NOT EXISTS letterhead_address text;
ALTER TABLE external_services ADD COLUMN IF NOT EXISTS footer_text text;
ALTER TABLE external_services ADD COLUMN IF NOT EXISTS signature_image text;

-- Courrier templates (WYSIWYG, with variable placeholders)
CREATE TABLE IF NOT EXISTS courrier_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES external_services(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  body text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_courrier_templates_service_id ON courrier_templates(service_id);

-- Code INSEE comme lien vertical (commune active de l'utilisateur)
ALTER TABLE users ADD COLUMN IF NOT EXISTS commune_insee text;
ALTER TABLE courrier_templates ADD COLUMN IF NOT EXISTS commune_insee text;

-- Backfill commune_insee depuis le nom de commune (best-effort)
UPDATE users SET commune_insee = communes.insee_code
FROM communes
WHERE users.commune IS NOT NULL
  AND users.commune_insee IS NULL
  AND lower(trim(users.commune)) = lower(trim(communes.name));

UPDATE courrier_templates SET commune_insee = communes.insee_code
FROM communes
WHERE courrier_templates.commune IS NOT NULL
  AND courrier_templates.commune_insee IS NULL
  AND lower(trim(courrier_templates.commune)) = lower(trim(communes.name));

CREATE INDEX IF NOT EXISTS idx_users_commune_insee ON users(commune_insee);
CREATE INDEX IF NOT EXISTS idx_courrier_templates_commune_insee ON courrier_templates(commune_insee);

-- Communes multiples par utilisateur
CREATE TABLE IF NOT EXISTS user_communes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commune_id uuid NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, commune_id)
);
CREATE INDEX IF NOT EXISTS idx_user_communes_user_id ON user_communes(user_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_users_commune ON users(commune);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_dossiers_commune ON dossiers(commune);
CREATE INDEX IF NOT EXISTS idx_dossiers_status ON dossiers(status);
CREATE INDEX IF NOT EXISTS idx_dossiers_user_id ON dossiers(user_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_instructeur_id ON dossiers(instructeur_id);
CREATE INDEX IF NOT EXISTS idx_zones_commune_id ON zones(commune_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- Legal mentions cache (Légifrance / Code de l'urbanisme)
CREATE TABLE IF NOT EXISTS legal_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  code_name text NOT NULL,
  article_ref text NOT NULL,
  article_title text,
  article_html text,
  legifrance_id text,
  fetched_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT legal_mentions_code_ref UNIQUE (code, article_ref)
);

ALTER TABLE legal_mentions ADD COLUMN IF NOT EXISTS courrier_types jsonb NOT NULL DEFAULT '[]';
ALTER TABLE legal_mentions ADD COLUMN IF NOT EXISTS dossier_types jsonb NOT NULL DEFAULT '[]';
ALTER TABLE legal_mentions ADD COLUMN IF NOT EXISTS contexte text;

-- Date de délivrance (date de la décision / arrêté)
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS date_delivrance timestamp;

-- Disponibilités des instructeurs / agents
CREATE TABLE IF NOT EXISTS user_availability (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  working_days jsonb NOT NULL DEFAULT '[1,2,3,4,5]',
  start_time text NOT NULL DEFAULT '08:30',
  end_time text NOT NULL DEFAULT '17:30',
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Absences et congés
CREATE TABLE IF NOT EXISTS user_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL DEFAULT 'conges',
  delegate_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_absences_user_id ON user_absences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_absences_dates ON user_absences(start_date, end_date);

-- Signataires (personnes habilitées à signer les arrêtés par commune)
CREATE TABLE IF NOT EXISTS signataires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commune text NOT NULL,
  role text NOT NULL,
  delegation_arrete text,
  delegation_date date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signataires_commune ON signataires(commune);
CREATE INDEX IF NOT EXISTS idx_signataires_user_id ON signataires(user_id);

-- Décisions ADS (projet d'arrêté lié à un dossier)
CREATE TABLE IF NOT EXISTS decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  commune text NOT NULL,
  type text NOT NULL,
  motif text,
  prescriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  conditions text,
  status text NOT NULL DEFAULT 'brouillon',
  instructeur_id uuid NOT NULL REFERENCES users(id),
  signataire_id uuid REFERENCES users(id) ON DELETE SET NULL,
  arrete_numero text,
  date_decision date,
  date_notification date,
  date_limite_recours date,
  motif_refus_signature text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decisions_dossier_id ON decisions(dossier_id);
CREATE INDEX IF NOT EXISTS idx_decisions_signataire_id ON decisions(signataire_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);

-- Journal des événements décision (audit trail)
CREATE TABLE IF NOT EXISTS decision_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  note text,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_events_decision_id ON decision_events(decision_id);

-- Cache GPU zones PLU par commune (survit aux redémarrages serveur)
ALTER TABLE communes ADD COLUMN IF NOT EXISTS plu_zones_geojson jsonb;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS plu_zones_cached_at timestamp;

-- Référentiel documentaire par commune (PPRI, OAP, PEB, etc.)
CREATE TABLE IF NOT EXISTS commune_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id uuid NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  original_filename text NOT NULL,
  file_size integer,
  pdf_content text,
  status text NOT NULL DEFAULT 'uploaded',
  ingested_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commune_documents_commune_id ON commune_documents(commune_id);

CREATE TABLE IF NOT EXISTS gpu_parcel_cache (
  cache_key       text PRIMARY KEY,
  parcelle_id     text,
  documents       jsonb,
  zone_urba       jsonb,
  municipality    jsonb,
  prescriptions   jsonb,
  informations    jsonb,
  sup_surf        jsonb,
  sup_lin         jsonb,
  generateurs     jsonb,
  plu_partition   text,
  scot_name       text,
  cached_at       timestamp NOT NULL DEFAULT now(),
  hit_count       integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gpu_parcel_cache_parcelle ON gpu_parcel_cache(parcelle_id);

CREATE TABLE IF NOT EXISTS dossier_consultations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id      uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  service_name    text NOT NULL,
  service_type    text NOT NULL,
  status          text NOT NULL DEFAULT 'en_attente',
  favorable       boolean,
  avis            text,
  date_envoi      timestamp NOT NULL DEFAULT now(),
  date_reponse    timestamp,
  created_by_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dossier_consultations_dossier ON dossier_consultations(dossier_id);
ALTER TABLE dossier_consultations ADD COLUMN IF NOT EXISTS external_service_id uuid REFERENCES external_services(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dossier_consultations_service ON dossier_consultations(external_service_id);

-- Upload de pièces justificatives avec analyse IA
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS code_piece text;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS analyse_ia jsonb;

-- Cas conditionnels structurés sur une règle (ex: 10 m sens unique / 13 m double sens)
ALTER TABLE zone_regulatory_rules ADD COLUMN IF NOT EXISTS cases jsonb DEFAULT '[]'::jsonb;

-- ── Ingestion documentaire : segments + embeddings (pgvector) ──
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS document_segments (
  id              text PRIMARY KEY,
  insee           text NOT NULL,
  commune_name    text,
  doc_type        text NOT NULL,
  doc_subtype     text,
  doc_version     text,
  doc_source_file text,
  segment_code    text NOT NULL,
  segment_type    text NOT NULL,
  parent_code     text,
  title           text,
  raw_text        text NOT NULL,
  embedding_text  text NOT NULL,
  embedding       vector(1024),
  metadata        jsonb DEFAULT '{}'::jsonb,
  char_count      integer,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_document_segments_insee ON document_segments(insee);
CREATE INDEX IF NOT EXISTS idx_document_segments_doc_type ON document_segments(doc_type);
CREATE INDEX IF NOT EXISTS idx_document_segments_parent ON document_segments(parent_code);
-- Recherche de similarité cosinus (HNSW)
CREATE INDEX IF NOT EXISTS idx_document_segments_embedding ON document_segments USING hnsw (embedding vector_cosine_ops);
`;

async function main() {
  const client = postgres(connectionString, { max: 1 });
  try {
    console.log("Running migrations...");
    await client.unsafe(SQL);
    console.log("Migrations complete.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
