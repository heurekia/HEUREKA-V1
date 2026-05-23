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

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_users_commune ON users(commune);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_dossiers_commune ON dossiers(commune);
CREATE INDEX IF NOT EXISTS idx_dossiers_status ON dossiers(status);
CREATE INDEX IF NOT EXISTS idx_dossiers_user_id ON dossiers(user_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_instructeur_id ON dossiers(instructeur_id);
CREATE INDEX IF NOT EXISTS idx_zones_commune_id ON zones(commune_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
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
