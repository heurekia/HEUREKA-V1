-- HEUREKA V1 - Migration SQL
-- Généré depuis les schémas Drizzle

-- Enums
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('citoyen', 'mairie', 'instructeur', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dossier_type AS ENUM ('permis_de_construire', 'permis_de_construire_mi', 'declaration_prealable', 'permis_amenager', 'permis_demolir', 'permis_lotir', 'certificat_urbanisme', 'certificat_urbanisme_a', 'certificat_urbanisme_b');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TYPE dossier_type ADD VALUE IF NOT EXISTS 'permis_de_construire_mi';
ALTER TYPE dossier_type ADD VALUE IF NOT EXISTS 'certificat_urbanisme_a';
ALTER TYPE dossier_type ADD VALUE IF NOT EXISTS 'certificat_urbanisme_b';

DO $$ BEGIN
  CREATE TYPE dossier_status AS ENUM ('brouillon', 'soumis', 'pre_instruction', 'incomplet', 'en_instruction', 'decision_en_cours', 'accepte', 'refuse', 'accord_prescription');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users
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

-- Communes
CREATE TABLE IF NOT EXISTS communes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  insee_code text NOT NULL UNIQUE,
  zip_code text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Zones
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

-- Zone Regulatory Rules
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
  validation_status text NOT NULL DEFAULT 'brouillon',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Dossiers
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

-- Dossier Messages
CREATE TABLE IF NOT EXISTS dossier_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  from_user_id text NOT NULL,
  from_role text NOT NULL,
  content text NOT NULL,
  parent_id integer,
  mentions jsonb DEFAULT '[]',
  created_at timestamp NOT NULL DEFAULT now()
);

-- Dossier Pieces Jointes
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

-- Notifications
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

-- Instruction Events
CREATE TABLE IF NOT EXISTS instruction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  type text NOT NULL,
  user_id text,
  description text,
  metadata jsonb DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now()
);

-- Calendar Events
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_zones_commune_id ON zones(commune_id);
CREATE INDEX IF NOT EXISTS idx_zone_rules_zone_id ON zone_regulatory_rules(zone_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_user_id ON dossiers(user_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_instructeur_id ON dossiers(instructeur_id);
CREATE INDEX IF NOT EXISTS idx_dossier_messages_dossier_id ON dossier_messages(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pieces_jointes_dossier_id ON dossier_pieces_jointes(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pieces_jointes_user_id ON dossier_pieces_jointes(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_instruction_events_dossier_id ON instruction_events(dossier_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_dossier_id ON calendar_events(dossier_id);

-- Documentation Favoris (onglet Documentation contextuelle pendant l'instruction)
CREATE TABLE IF NOT EXISTS documentation_favoris (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_id text NOT NULL,
  reference_type text NOT NULL,
  titre text NOT NULL,
  source text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS documentation_favoris_user_ref_uniq
  ON documentation_favoris(dossier_id, user_id, reference_id);
CREATE INDEX IF NOT EXISTS idx_documentation_favoris_dossier_id
  ON documentation_favoris(dossier_id);
