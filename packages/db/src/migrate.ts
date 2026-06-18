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
CREATE INDEX IF NOT EXISTS idx_dossier_messages_dossier ON dossier_messages(dossier_id);

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

-- Typologies de procédures fines (PCMI vs PC, CUa vs CUb).
-- Ajout idempotent : les valeurs legacy ('permis_de_construire',
-- 'certificat_urbanisme') restent valides pour les dossiers déjà créés.
ALTER TYPE dossier_type ADD VALUE IF NOT EXISTS 'permis_de_construire_mi';
ALTER TYPE dossier_type ADD VALUE IF NOT EXISTS 'certificat_urbanisme_a';
ALTER TYPE dossier_type ADD VALUE IF NOT EXISTS 'certificat_urbanisme_b';

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

-- Courrier templates (WYSIWYG, with variable placeholders).
-- service_id reste nullable : un template peut appartenir à une mairie
-- (commune) plutôt qu'à un service externe.
CREATE TABLE IF NOT EXISTS courrier_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES external_services(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  body text NOT NULL DEFAULT '',
  commune text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
-- Idempotent pour les bases existantes créées avec le schéma initial
-- (service_id NOT NULL, pas de colonne commune).
ALTER TABLE courrier_templates ALTER COLUMN service_id DROP NOT NULL;
ALTER TABLE courrier_templates ADD COLUMN IF NOT EXISTS commune text;
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
ALTER TABLE legal_mentions ADD COLUMN IF NOT EXISTS categories jsonb NOT NULL DEFAULT '[]';

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

-- Fil de discussion par consultation (mairie ↔ service externe).
-- NULL ⇒ fil citoyen ↔ mairie (comportement historique préservé).
ALTER TABLE dossier_messages ADD COLUMN IF NOT EXISTS consultation_id uuid;
DO $$ BEGIN
  ALTER TABLE dossier_messages
    ADD CONSTRAINT dossier_messages_consultation_fk
    FOREIGN KEY (consultation_id) REFERENCES dossier_consultations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_dossier_messages_consultation ON dossier_messages(consultation_id);

-- Upload de pièces justificatives avec analyse IA
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS code_piece text;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS analyse_ia jsonb;
-- Extraction structurée (dimensions, surfaces, hauteurs NGF…) — sert au
-- moteur de conformité PLU.
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS extraction_ia jsonb;
-- Décision de l'instructeur : valide | rejete | complement_demande | null
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS instructeur_status text;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS instructeur_note text;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS instructeur_status_at timestamp;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS instructeur_status_by uuid;

-- Analyse de conformité globale d'un dossier (croisement pièces ↔ PLU ↔ CERFA)
-- Calculée à la soumission ou à la demande par la mairie.
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS conformite_analysis jsonb;
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS conformite_status text;
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS conformite_analyzed_at timestamp;

-- Phase 3.C.5b : analyse de conformité FINALE — déclenchée explicitement par
-- l'instructeur avant la délivrance de l'arrêté. Ne prend en compte que les
-- pièces dont instructeur_status = 'valide'. Stockée séparément de l'analyse
-- interim pour préserver l'historique et permettre la comparaison.
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS conformite_final_analysis jsonb;
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS conformite_final_status text;
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS conformite_final_analyzed_at timestamp;
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS conformite_final_triggered_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Cas conditionnels structurés sur une règle (ex: 10 m sens unique / 13 m double sens)
ALTER TABLE zone_regulatory_rules ADD COLUMN IF NOT EXISTS cases jsonb DEFAULT '[]'::jsonb;
-- Décomposition d'articles complexes en sous-règles + applicabilité
ALTER TABLE zone_regulatory_rules ADD COLUMN IF NOT EXISTS applies_if jsonb DEFAULT '[]'::jsonb;
ALTER TABLE zone_regulatory_rules ADD COLUMN IF NOT EXISTS sub_theme text;
-- Version « citoyen » générée par l'IA à l'ingestion (titre + phrase simple + pertinence)
ALTER TABLE zone_regulatory_rules ADD COLUMN IF NOT EXISTS citizen_title text;
ALTER TABLE zone_regulatory_rules ADD COLUMN IF NOT EXISTS citizen_summary text;
ALTER TABLE zone_regulatory_rules ADD COLUMN IF NOT EXISTS citizen_relevant boolean NOT NULL DEFAULT true;

-- Synthèse textuelle des documents thématiques de commune (OAP, PPRI, …) sur
-- laquelle l'outil d'instruction s'appuie quand un dossier tombe dans le
-- périmètre concerné.
ALTER TABLE commune_documents ADD COLUMN IF NOT EXISTS synthese text;

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

-- ── Suivi des coûts IA (un événement par appel LLM facturable) ──
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id                  uuid REFERENCES dossiers(id) ON DELETE SET NULL,
  user_id                     uuid REFERENCES users(id) ON DELETE SET NULL,
  purpose                     text NOT NULL,
  model                       text NOT NULL,
  input_tokens                integer NOT NULL DEFAULT 0,
  output_tokens               integer NOT NULL DEFAULT 0,
  cache_read_input_tokens     integer NOT NULL DEFAULT 0,
  cache_creation_input_tokens integer NOT NULL DEFAULT 0,
  cost_eur                    double precision NOT NULL DEFAULT 0,
  duration_ms                 integer,
  created_at                  timestamp NOT NULL DEFAULT now()
);
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS commune_id uuid REFERENCES communes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_dossier ON ai_usage_events(dossier_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_commune ON ai_usage_events(commune_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at ON ai_usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_purpose ON ai_usage_events(purpose);

-- ── Configuration alertes Slack sur les coûts IA (singleton id=1) ──
CREATE TABLE IF NOT EXISTS ai_alert_config (
  id                      integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  slack_webhook_url       text,
  per_call_threshold_eur  double precision,
  daily_threshold_eur     double precision,
  daily_last_notified_at  timestamp,
  updated_at              timestamp NOT NULL DEFAULT now()
);
INSERT INTO ai_alert_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── Normalisation validation_status sur zone_regulatory_rules ──
-- Le schéma historique posait DEFAULT 'draft' alors que tout le code applicatif
-- raisonne en français ('valide' | 'brouillon' | 'rejete'). Conséquence : tout
-- insert qui aurait omis le champ atterrissait en 'draft' → invisible des
-- filtres applicatifs (trou silencieux). On normalise les lignes existantes
-- et on aligne le défaut sur la convention applicative.
UPDATE zone_regulatory_rules SET validation_status = 'brouillon'
  WHERE validation_status NOT IN ('valide', 'brouillon', 'rejete');
ALTER TABLE zone_regulatory_rules ALTER COLUMN validation_status SET DEFAULT 'brouillon';

-- ── Validation des synthèses commune (audit juridique) ──
-- Une synthèse est un texte libre rédigé/modifié par un humain ; tant qu'elle
-- n'est pas validée, elle ne doit JAMAIS alimenter un verdict d'instruction.
-- Convention de valeurs alignée avec zone_regulatory_rules : valide | brouillon | rejete.
-- Default brouillon = safe-by-default : les synthèses existantes sont marquées
-- non-validées et l'instructeur doit les passer en revue avant qu'elles
-- ré-entrent dans la boucle d'instruction (fuite documentée).
ALTER TABLE commune_documents ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'brouillon';
ALTER TABLE commune_documents ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE commune_documents ADD COLUMN IF NOT EXISTS validated_at timestamp;

-- ── RGPD : consentement à l'analyse IA des pièces (art. 13 + art. 22) ──
-- Le citoyen accepte (par défaut) ou refuse l'analyse automatisée de ses
-- pièces. Si false → aucun appel LLM sur le contenu de ses fichiers.
-- NULL = consentement non demandé (dossiers antérieurs à la mise en place).
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS ai_consent boolean;
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS ai_consent_at timestamp;
-- Trace par pièce : l'IA a-t-elle effectivement été appelée sur ce fichier ?
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS ai_processed boolean NOT NULL DEFAULT false;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS archived_at timestamp;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS archived_by_piece_id uuid;
CREATE INDEX IF NOT EXISTS idx_dossier_pieces_jointes_archived ON dossier_pieces_jointes(dossier_id, archived_at);

-- ── OCR asynchrone côté comptoir mairie ──────────────────────────────────────
-- L'analyse IA/OCR des pièces déposées est désormais exécutée en arrière-plan
-- pour rendre la main à l'agent immédiatement après l'upload. ocr_status pilote
-- ce cycle de vie et permet à la notification "dossier prêt" de savoir quand
-- toutes les pièces sont passées par le worker.
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS ocr_status text NOT NULL DEFAULT 'pending';
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS ocr_started_at timestamp;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS ocr_completed_at timestamp;
-- Backfill : les pièces déjà uploadées (avant ce passage en asynchrone) sont
-- considérées comme traitées si ai_processed est vrai, sinon comme "skipped"
-- pour ne pas bloquer indéfiniment d'éventuelles notifications futures.
UPDATE dossier_pieces_jointes
   SET ocr_status = CASE WHEN ai_processed THEN 'done' ELSE 'skipped' END,
       ocr_completed_at = uploaded_at
 WHERE ocr_status = 'pending' AND uploaded_at < now() - interval '5 minutes';
CREATE INDEX IF NOT EXISTS idx_dossier_pieces_jointes_ocr_status
  ON dossier_pieces_jointes(dossier_id, ocr_status);

-- ── RGPD : empreinte du fichier envoyé à l'IA (sans stocker le contenu) ──
-- SHA-256 hexadécimal calculé côté serveur AVANT envoi. Permet de prouver
-- qu'un fichier donné a (ou n'a pas) été soumis à l'IA, sans dupliquer le
-- contenu personnel dans la base d'audit.
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS file_hash text;
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_file_hash ON ai_usage_events(file_hash);

-- ── Rétention 12 mois des logs d'authentification (CCSC Art. 4.14) ──
-- Purge automatique : tout audit log de plus de 12 mois est supprimé.
-- Implémenté côté application (cron léger au démarrage) ; cet index accélère
-- la purge et la recherche par date.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_purge ON audit_logs(created_at);

-- ── Traçabilité étendue : actions mairie + recherches d'adresses citoyens ──
-- role : rôle au moment de l'action (snapshot — l'utilisateur peut être
--        supprimé ou changer de rôle ensuite).
-- target_type/target_id : cible métier (ex: "dossier" + uuid) pour pouvoir
--        retrouver toutes les actions sur un objet donné.
-- metadata : contexte JSON spécifique à l'action (route, body filtré,
--        adresse cherchée, code INSEE, etc.). Champs sensibles strippés
--        côté service (audit.ts) avant insert.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_type text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_id text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata jsonb;
CREATE INDEX IF NOT EXISTS idx_audit_logs_role ON audit_logs(role);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

-- ── Annotations chunk-level sur documents indexés (Phase 1 niveau B) ──
-- Une annotation valide est INJECTÉE à côté du chunk lors du search RAG.
-- Permet à l'instructeur de "patcher" un PDF sans le réécrire : corrections
-- éditoriales, jurisprudence locale, cas particuliers connus de la commune.
-- Garde juridique : statut 'brouillon' tant que non explicitement validé.
CREATE TABLE IF NOT EXISTS document_segment_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id text NOT NULL,
  source_id text NOT NULL,
  kind text NOT NULL DEFAULT 'note_perso',
  note text NOT NULL,
  applies_if jsonb NOT NULL DEFAULT '[]',
  validation_status text NOT NULL DEFAULT 'brouillon',
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  validated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  validated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_segment_annotations_segment ON document_segment_annotations(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_annotations_source ON document_segment_annotations(source_id);

-- Phase 3.B : visibilité private/shared. Les annotations existantes ont été
-- créées sous l'ancien modèle "tout ce qui est validé alimente l'IA" : on
-- les bascule en 'shared' pour préserver leur comportement. Les nouvelles
-- annotations sont 'private' par défaut — l'instructeur opt-in.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_segment_annotations' AND column_name = 'visibility'
  ) THEN
    ALTER TABLE document_segment_annotations
      ADD COLUMN visibility text NOT NULL DEFAULT 'private';
    UPDATE document_segment_annotations SET visibility = 'shared';
  END IF;
END
$$;

-- Phase 3.C.3 : annotations PDF-level (vs chunk-level historique).
--   - segment_id devient nullable (les annotations PDF n'en ont pas, elles
--     pointent directement vers le document + page + rectangle de
--     surlignage).
--   - Nouvelles colonnes : page, quote, highlight_rects.
ALTER TABLE document_segment_annotations
  ALTER COLUMN segment_id DROP NOT NULL;
ALTER TABLE document_segment_annotations
  ADD COLUMN IF NOT EXISTS page integer,
  ADD COLUMN IF NOT EXISTS quote text,
  ADD COLUMN IF NOT EXISTS highlight_rects jsonb NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_segment_annotations_source_page
  ON document_segment_annotations(source_id, page);

-- ── Délégations de portefeuille en cas d'absence ──
-- Chaîne ordonnée de délégués configurée par l'instructeur lui-même.
-- Utilisée par le moteur d'attribution et un job quotidien pour rediriger
-- les nouveaux dossiers + les dossiers dont l'échéance tombe pendant l'absence.
CREATE TABLE IF NOT EXISTS user_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegate_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_delegations_user_priority_uniq
  ON user_delegations(user_id, priority);
CREATE INDEX IF NOT EXISTS idx_user_delegations_delegate ON user_delegations(delegate_user_id);

CREATE TABLE IF NOT EXISTS dossier_courriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  type text NOT NULL,
  subject text,
  body_snapshot text,
  pieces_jointes_ids jsonb DEFAULT '[]'::jsonb,
  articles_cites jsonb DEFAULT '[]'::jsonb,
  emis_par uuid REFERENCES users(id),
  emis_le timestamp NOT NULL DEFAULT now(),
  delivery_method text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dossier_courriers_dossier ON dossier_courriers(dossier_id);
CREATE INDEX IF NOT EXISTS idx_dossier_courriers_type ON dossier_courriers(dossier_id, type);

-- ── Indexes complémentaires pour la montée en charge ──
-- Postgres ne crée pas d'index automatique pour les FK : sans ces lignes, les
-- requêtes "pièces d'un dossier" et "dossiers d'un user/commune triés" font un
-- scan séquentiel dès que les tables dépassent quelques dizaines de milliers
-- de lignes.
CREATE INDEX IF NOT EXISTS idx_dossier_pieces_jointes_dossier ON dossier_pieces_jointes(dossier_id);
CREATE INDEX IF NOT EXISTS idx_dossier_pieces_jointes_user ON dossier_pieces_jointes(user_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_commune_created ON dossiers(commune, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dossiers_user_created ON dossiers(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dossiers_instructeur_created ON dossiers(instructeur_id, created_at DESC);

-- ── Moteur réglementaire (palier 1) ──
-- Faits d'instruction : on sépare ce que le citoyen a déclaré, ce qui a été
-- extrait des pièces par l'IA, ce que l'instructeur a saisi/validé, et ce qui
-- vient d'une source externe (cadastre, GPU, etc.). Le moteur ne consomme que
-- les faits dont la 'confidence' et l'origine sont compatibles avec la règle
-- évaluée — un fait 'citizen_declaration' non vérifié ne doit jamais fonder
-- un verdict bloquant.
CREATE TABLE IF NOT EXISTS dossier_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  unit text,
  source text NOT NULL,
  source_ref jsonb,
  confidence double precision,
  validated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  validated_at timestamp,
  superseded_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dossier_facts_dossier ON dossier_facts(dossier_id);
CREATE INDEX IF NOT EXISTS idx_dossier_facts_key ON dossier_facts(dossier_id, key);
-- Un seul fait "actif" par (dossier, clé) : superseded_at IS NULL ⇒ canonique.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dossier_facts_active_key
  ON dossier_facts(dossier_id, key) WHERE superseded_at IS NULL;

-- Analyse réglementaire : un run du moteur sur un dossier à un instant T.
-- On historise plusieurs analyses (une à la soumission, une à la complétude,
-- une en cours d'instruction…). engine_version + ruleset_version garantissent
-- la reproductibilité juridique : on doit pouvoir rejouer la même analyse des
-- mois après si le PLU a changé entre-temps. context_snapshot fige le
-- InstructionContext utilisé (faits, zones, applicabilité).
CREATE TABLE IF NOT EXISTS regulatory_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  engine_version text NOT NULL,
  ruleset_version text,
  context_snapshot jsonb,
  summary jsonb,
  triggered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  validated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  validated_at timestamp,
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_regulatory_analyses_dossier ON regulatory_analyses(dossier_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_analyses_status ON regulatory_analyses(status);

-- Constat réglementaire unitaire produit par une analyse.
-- status (conforme | non_conforme | incertain | non_applicable) et severity
-- (bloquant | prescription | alerte | info) sont les axes que l'UI doit
-- afficher distinctement. instructor_decision capture la boucle humaine
-- (accepté | corrigé | ignoré) — c'est cette colonne qui alimente le futur
-- mécanisme d'apprentissage et l'audit.
CREATE TABLE IF NOT EXISTS regulatory_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES regulatory_analyses(id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  topic text NOT NULL,
  status text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  explanation text,
  legal_basis jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  facts_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action jsonb,
  citizen_summary text,
  rule_id uuid REFERENCES zone_regulatory_rules(id) ON DELETE SET NULL,
  instructor_decision text,
  instructor_comment text,
  instructor_decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  instructor_decided_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_regulatory_findings_analysis ON regulatory_findings(analysis_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_findings_dossier ON regulatory_findings(dossier_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_findings_status ON regulatory_findings(dossier_id, status);
CREATE INDEX IF NOT EXISTS idx_regulatory_findings_topic ON regulatory_findings(dossier_id, topic);

-- ── Articles juridiques manquants ──────────────────────────────────────────
-- Quand un utilisateur clique sur une référence d'article (R.421-1, L.123-2…)
-- que ni notre cache ni Légifrance ne renvoient, on enregistre la demande pour
-- que l'admin puisse soit créer l'article (via l'API Légifrance), soit la
-- marquer comme non pertinente. Évite que des refs cassées renvoient
-- silencieusement vers la homepage de legifrance.gouv.fr.
CREATE TABLE IF NOT EXISTS legal_mentions_misses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_key text NOT NULL,
  article_ref text NOT NULL,
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  miss_count integer NOT NULL DEFAULT 1,
  resolved_at timestamp,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution text,
  CONSTRAINT legal_mentions_misses_code_ref UNIQUE (code_key, article_ref)
);
CREATE INDEX IF NOT EXISTS idx_legal_mentions_misses_unresolved
  ON legal_mentions_misses(last_seen_at DESC) WHERE resolved_at IS NULL;
`;

// Backfill exécuté APRÈS le bloc DDL : PostgreSQL n'autorise pas l'utilisation
// d'une valeur d'enum tout juste ajoutée dans la même transaction. On reclasse
// les dossiers historiquement créés en `permis_de_construire` vers PCMI quand
// les natures stockées dans `metadata` indiquent une maison individuelle, et
// les `certificat_urbanisme` génériques vers CUa/CUb selon le metadata.
const BACKFILL_DOSSIER_TYPES = `
UPDATE dossiers
SET type = 'permis_de_construire_mi'
WHERE type = 'permis_de_construire'
  AND metadata ? 'natures'
  AND (metadata->'natures') @> '["maison_neuve"]'::jsonb;

UPDATE dossiers
SET type = 'certificat_urbanisme_a'
WHERE type = 'certificat_urbanisme'
  AND metadata->>'certificatType' = 'a';

UPDATE dossiers
SET type = 'certificat_urbanisme_b'
WHERE type = 'certificat_urbanisme'
  AND (metadata->>'certificatType' IS DISTINCT FROM 'a');
`;

async function main() {
  const client = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    console.log("Running migrations...");
    await client.unsafe(SQL);
    await client.unsafe(BACKFILL_DOSSIER_TYPES);
    console.log("Migrations complete.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
