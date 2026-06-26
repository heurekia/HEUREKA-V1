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
  article_number double precision,
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

-- Index de chemins chauds identifiés à l'audit de performance (Palier 0).
-- Jointure/filtre des règles par zone (instruction, viewer réglementation, ingestion) :
-- sans index, chaque lecture des règles d'une zone faisait un seq scan de toute la table,
-- qui grossit avec chaque PLU ingéré. Le composite (zone_id, validation_status) couvre
-- à la fois les lookups par zone seule et le filtre fréquent validation_status = 'valide'.
CREATE INDEX IF NOT EXISTS idx_zone_regulatory_rules_zone ON zone_regulatory_rules(zone_id, validation_status);
-- Timeline d'un dossier (instruction_events), lue à chaque ouverture de fiche dossier.
CREATE INDEX IF NOT EXISTS idx_instruction_events_dossier ON instruction_events(dossier_id);
-- Notifications rattachées à un dossier (jointure GET /notifications) + lookup inverse.
CREATE INDEX IF NOT EXISTS idx_notifications_dossier ON notifications(dossier_id);
-- Événements de calendrier rattachés à un dossier.
CREATE INDEX IF NOT EXISTS idx_calendar_events_dossier ON calendar_events(dossier_id);

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
-- Intitulé exact de la fonction du signataire (imprimé dans les courriers).
ALTER TABLE signataires ADD COLUMN IF NOT EXISTS fonction text;
-- Signature + tampon propres au signataire (priment sur ceux de la commune).
ALTER TABLE signataires ADD COLUMN IF NOT EXISTS signature_image text;
ALTER TABLE signataires ADD COLUMN IF NOT EXISTS tampon_image text;

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
-- Partition GPU "gagnante" pour la commune (DU_<INSEE>, <SIREN>_PLUI, etc.).
-- Persistée pour court-circuiter la découverte par point dans le flux par adresse,
-- où le /document GPU est fragile sur un Point (voirie, bord de commune,
-- conventions de nommage hétérogènes).
ALTER TABLE communes ADD COLUMN IF NOT EXISTS plu_partition text;

-- Couche vectorielle d'annexe spatiale (ex. plan des hauteurs) portée par un
-- document réglementaire, isolée du zonage PLU pour ne pas polluer la résolution.
ALTER TABLE regulatory_documents ADD COLUMN IF NOT EXISTS geojson jsonb;
-- Raison stable d'indisponibilité du PLU pour cette commune :
--   'rnu' : commune en RNU, pas de PLU à chercher
--   'not_in_gpu' : aucune partition trouvée côté Géoportail (commune sans PLU déposé)
--   NULL : PLU disponible ou statut inconnu (échec transient sans diagnostic)
ALTER TABLE communes ADD COLUMN IF NOT EXISTS plu_unavailable_reason text;

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

-- article_number : integer → double precision. Les PLU modernisés numérotent
-- en décimal (« 12.1 », « 12.2 »…) ; la colonne integer faisait planter
-- l'ingestion (invalid input syntax for type integer: "12.2"). Gardé idempotent
-- ET conditionnel pour éviter une réécriture de table à chaque déploiement.
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'zone_regulatory_rules' AND column_name = 'article_number') = 'integer' THEN
    ALTER TABLE zone_regulatory_rules
      ALTER COLUMN article_number TYPE double precision USING article_number::double precision;
  END IF;
END $$;

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
  cost_eur                    double precision NOT NULL DEFAULT 0,
  duration_ms                 integer,
  created_at                  timestamp NOT NULL DEFAULT now()
);

-- Suppression idempotente des colonnes Anthropic-only cache_*_input_tokens.
-- Concept "prompt caching" sans équivalent Mistral, toujours écrites à 0
-- depuis la bascule juin 2026 — déposent du bruit "0/0" dans l'admin Coûts IA
-- sans porter d'information. Aucune perte de donnée (valeurs déjà nulles).
ALTER TABLE ai_usage_events DROP COLUMN IF EXISTS cache_read_input_tokens;
ALTER TABLE ai_usage_events DROP COLUMN IF EXISTS cache_creation_input_tokens;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS commune_id uuid REFERENCES communes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_dossier ON ai_usage_events(dossier_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_commune ON ai_usage_events(commune_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at ON ai_usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_purpose ON ai_usage_events(purpose);

-- ── Grille tarifaire IA, éditable depuis le back-office ────────────────────
-- Une ligne par modèle Mistral (chat ou embedding). Le service aiUsage lit
-- cette table pour estimer le coût des nouveaux appels — les anciens
-- événements gardent leur cost_eur historique (pas de recalcul rétroactif).
-- "kind" ∈ {chat, embedding}. Pour kind=embedding, output_eur_per_m=0.
-- Le tarif EFFECTIVEMENT appliqué est dupliqué sur ai_usage_events (colonnes
-- input_rate_eur_per_m / output_rate_eur_per_m) pour pouvoir auditer un
-- événement même après modification de la grille.
CREATE TABLE IF NOT EXISTS ai_pricing (
  model              text PRIMARY KEY,
  kind               text NOT NULL DEFAULT 'chat',
  input_eur_per_m    double precision NOT NULL,
  output_eur_per_m   double precision NOT NULL DEFAULT 0,
  note               text,
  updated_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at         timestamp NOT NULL DEFAULT now()
);

-- Seed initial : grille au 2026-06 publiée par Mistral
-- (cf. https://mistral.ai/pricing/). Conversion USD→EUR à 0.92 indicative ;
-- l'admin peut écraser ces valeurs à tout moment depuis l'onglet Coûts IA.
INSERT INTO ai_pricing (model, kind, input_eur_per_m, output_eur_per_m, note)
VALUES
  ('mistral-large-latest',  'chat',      1.80, 5.40, 'Mistral Large 2 — tarif legacy'),
  ('mistral-large-3',       'chat',      0.46, 1.38, 'Mistral Large 3 ($0.5/$1.5 par M tokens, USD→EUR ~0.92)'),
  ('mistral-small-latest',  'chat',      0.20, 0.60, 'Mistral Small 3'),
  ('mistral-small-4',       'chat',      0.09, 0.28, 'Mistral Small 4 ($0.1/$0.3 par M tokens, USD→EUR ~0.92)'),
  ('pixtral-large-latest',  'chat',      2.00, 6.00, 'Pixtral Large — vision'),
  ('pixtral-12b-2409',      'chat',      0.15, 0.15, 'Pixtral 12B — vision compact'),
  ('mistral-embed',         'embedding', 0.09, 0.00, '$0.1 par M tokens, USD→EUR ~0.92')
ON CONFLICT (model) DO NOTHING;

-- Tarif effectif appliqué à chaque événement (audit + réconciliation).
-- NULLABLE pour les lignes historiques (avant déploiement de cette colonne).
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS input_rate_eur_per_m double precision;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS output_rate_eur_per_m double precision;
-- Endpoint Mistral utilisé : 'chat' (chat completions) | 'embedding' (embeddings).
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS endpoint text;

-- Purge des événements résiduels Anthropic/Claude (bascule juin 2026 vers
-- Mistral). Leur cost_eur était calculé sur la grille Claude → polluait les
-- agrégats de l'onglet "Coûts IA · estimés", qui ne suit désormais que Mistral.
-- Idempotent : aucun nouvel événement ne peut atterrir avec ce model_pattern
-- depuis le retrait du MODEL_ID = "claude-haiku..." côté code applicatif.
DELETE FROM ai_usage_events WHERE model LIKE 'claude-%';

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

-- ── Offboarding des comptes professionnels (désactivation, pas suppression) ──
-- Un agent/admin n'est JAMAIS supprimé : ses arrêtés signés (decisions.instructeur_id
-- est NOT NULL), courriers émis, etc. sont des records légaux à conserver, et leurs
-- FK interdisent de toute façon l'effacement de la ligne users. On le DÉSACTIVE :
-- deactivated_at non NULL ⇒ connexion refusée + sessions révoquées (token_version),
-- et l'agent disparaît des listes/assignations. Les citoyens, eux, restent effacés
-- (RGPD art. 17). deactivated_by = uuid de l'admin (sans FK, cf. instructeur_status_by).
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_by uuid;
CREATE INDEX IF NOT EXISTS idx_users_deactivated_at ON users(deactivated_at);

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
  statut text NOT NULL DEFAULT 'envoye',
  signature_status text NOT NULL DEFAULT 'non_requise',
  signataire_user_id uuid REFERENCES users(id),
  signature_requested_by uuid REFERENCES users(id),
  signature_requested_at timestamp,
  signed_at timestamp,
  signature_image text,
  tampon_image text,
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
-- Ancienne contrainte « un seul actif par (dossier, clé) » retirée :
-- incompatible avec Phase 1 (plusieurs candidats persistés, un seul gagnant
-- — cf. resolveDossierFactsWithConflicts). Le DROP IF EXISTS + CREATE de
-- l'index correct se trouvent plus bas (uniq_dossier_facts_active_winner_key).
-- Conserver le CREATE ici provoquait un fail de migration sur les bases qui
-- contiennent déjà des données au format Phase 1.

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

-- ── Lot 1a — Préparation des documents intercommunaux (PLUi) ────────────────
-- Additif strict : aucune table renommée, aucun consommateur impacté.
-- Le Lot 1b suivra avec le rename commune_documents → regulatory_documents et
-- la propagation aux 8 fichiers TS qui référencent le nom actuel.

-- Porteur polymorphe : un document est désormais porté par une commune OU
-- par un EPCI (cas PLUi). Exactement l'un des deux doit être renseigné.
ALTER TABLE commune_documents ADD COLUMN IF NOT EXISTS porteur_commune_id uuid REFERENCES communes(id) ON DELETE CASCADE;
ALTER TABLE commune_documents ADD COLUMN IF NOT EXISTS porteur_epci_id uuid REFERENCES epci(id) ON DELETE CASCADE;

-- Backfill : les documents existants gardent leur commune comme porteur.
UPDATE commune_documents
SET porteur_commune_id = commune_id
WHERE porteur_commune_id IS NULL AND porteur_epci_id IS NULL;

-- Contrainte XOR posée APRÈS le backfill — sinon échec sur les lignes existantes.
DO $$ BEGIN
  ALTER TABLE commune_documents
    ADD CONSTRAINT commune_documents_porteur_xor
    CHECK ((porteur_commune_id IS NOT NULL) <> (porteur_epci_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Rattachement N:N document → communes. Un PLUi y aura N lignes, un PLU
-- strictement communal une seule. Remplacera commune_documents.commune_id
-- comme source de vérité du périmètre d'applicabilité (Lots 3 & 4).
CREATE TABLE IF NOT EXISTS document_communes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES commune_documents(id) ON DELETE CASCADE,
  commune_id uuid NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT document_communes_unique UNIQUE (document_id, commune_id)
);
CREATE INDEX IF NOT EXISTS idx_document_communes_document ON document_communes(document_id);
CREATE INDEX IF NOT EXISTS idx_document_communes_commune ON document_communes(commune_id);

-- Backfill 1:1 du périmètre existant. ON CONFLICT pour l'idempotence.
INSERT INTO document_communes (document_id, commune_id)
SELECT id, commune_id FROM commune_documents
WHERE commune_id IS NOT NULL
ON CONFLICT (document_id, commune_id) DO NOTHING;

-- ── Lot 1b — Rename commune_documents → regulatory_documents ───────────────
-- La table n'est plus strictement « par commune » : avec porteur_epci_id et
-- document_communes elle décrit un document réglementaire générique.
--
-- Idempotence sur ré-exécution (bug rencontré en prod OVH) :
-- le CREATE TABLE IF NOT EXISTS commune_documents historique plus haut dans
-- ce script (legacy DDL) re-crée systématiquement une coquille vide à chaque
-- exécution, MÊME après le rename. Si on ne fait rien, la 2e exécution
-- trouve les deux tables et le RENAME échoue (relation déjà existante).
-- On nettoie la coquille vide ici, puis on renomme uniquement si nécessaire.
DO $$ BEGIN
  -- Cas 1 : les deux tables existent → ne peut arriver qu'après une 1re
  -- exécution réussie. La vraie donnée vit dans regulatory_documents, la
  -- coquille vide est dans commune_documents (recréée plus haut). On la
  -- supprime — mais seulement si elle est effectivement vide (garde-fou
  -- contre toute situation imprévue).
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'commune_documents' AND relkind = 'r')
     AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'regulatory_documents' AND relkind = 'r') THEN
    IF NOT EXISTS (SELECT 1 FROM commune_documents LIMIT 1) THEN
      DROP TABLE commune_documents CASCADE;
    ELSE
      RAISE EXCEPTION 'commune_documents et regulatory_documents existent simultanément avec des données dans la première — examen manuel requis avant de continuer';
    END IF;
  END IF;

  -- Cas 2 : seule commune_documents existe (1re exécution post-merge sur une
  -- base déjà alignée jusqu'au Lot 1a). On renomme.
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'commune_documents' AND relkind = 'r')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'regulatory_documents' AND relkind = 'r') THEN
    ALTER TABLE commune_documents RENAME TO regulatory_documents;
  END IF;
END $$;

-- Renommage des objets dépendants (contrainte XOR, index). Idempotent.
-- On vérifie que la contrainte vit bien sur regulatory_documents avant de la
-- renommer — évite de toucher une contrainte homonyme sur la coquille
-- éphémère commune_documents recréée à chaque run et droppée juste au-dessus.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'commune_documents_porteur_xor'
      AND t.relname = 'regulatory_documents'
  ) THEN
    ALTER TABLE regulatory_documents
      RENAME CONSTRAINT commune_documents_porteur_xor TO regulatory_documents_porteur_xor;
  END IF;
END $$;
ALTER INDEX IF EXISTS idx_commune_documents_commune_id RENAME TO idx_regulatory_documents_commune_id;

-- ── Lot 2 — Traçabilité règle → document ───────────────────────────────────
-- Une zone_regulatory_rule sait désormais de quel regulatory_document elle
-- provient. Nullable au démarrage : permet le backfill puis les futures
-- règles ajoutées manuellement par un instructeur sans document attaché.
-- ON DELETE SET NULL : supprimer un document ne casse pas les règles qui
-- en proviennent (purge contrôlée côté applicatif uniquement).
ALTER TABLE zone_regulatory_rules
  ADD COLUMN IF NOT EXISTS source_document_id uuid
  REFERENCES regulatory_documents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_zone_regulatory_rules_source_document
  ON zone_regulatory_rules(source_document_id);

-- Backfill : on rattache chaque règle au document de famille PLU le plus
-- récent de la commune de sa zone (plu / plui / plum). Couvre la quasi-
-- totalité du corpus actuel (1 commune = 1 PLU). Les communes sans aucun
-- document de famille PLU restent à NULL — détectables via SELECT count(*)
-- WHERE source_document_id IS NULL et à corriger manuellement (cas rares :
-- règles saisies à la main sans ingestion).
WITH plu_by_commune AS (
  SELECT DISTINCT ON (commune_id) commune_id, id AS document_id
  FROM regulatory_documents
  WHERE type IN ('plu', 'plui', 'plum') AND commune_id IS NOT NULL
  ORDER BY commune_id, created_at DESC
)
UPDATE zone_regulatory_rules zrr
SET source_document_id = pbc.document_id
FROM zones z, plu_by_commune pbc
WHERE zrr.zone_id = z.id
  AND z.commune_id = pbc.commune_id
  AND zrr.source_document_id IS NULL;

-- ── Lot 3 — Refactor loadRules() document-centric ──────────────────────────
-- Les zones aussi connaissent leur document d'origine. Permet à terme qu'un
-- PLUi crée des zones partagées entre N communes (à travers document_communes)
-- et que la purge à l'ingestion soit indexée par document, pas par commune.
ALTER TABLE zones
  ADD COLUMN IF NOT EXISTS source_document_id uuid
  REFERENCES regulatory_documents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_zones_source_document
  ON zones(source_document_id);

-- Backfill : chaque zone hérite du document de famille PLU le plus récent de
-- sa commune (plu / plui / plum — même logique que pour zone_regulatory_rules
-- en Lot 2).
WITH plu_by_commune AS (
  SELECT DISTINCT ON (commune_id) commune_id, id AS document_id
  FROM regulatory_documents
  WHERE type IN ('plu', 'plui', 'plum') AND commune_id IS NOT NULL
  ORDER BY commune_id, created_at DESC
)
UPDATE zones z
SET source_document_id = pbc.document_id
FROM plu_by_commune pbc
WHERE z.commune_id = pbc.commune_id
  AND z.source_document_id IS NULL;

-- ── Phase 1 — Fondations preuves et candidats ──────────────────────────────
-- Préalable au moteur de contradictions (Phase 3). Aujourd'hui resolveDossierFacts
-- choisit silencieusement un gagnant par clé. On veut désormais persister TOUS
-- les candidats (avec is_winner=false pour les non-gagnants), regrouper les
-- candidats dont les valeurs divergent par conflict_group_id, et garder une
-- trace de la valeur brute avant normalisation.
ALTER TABLE dossier_facts ADD COLUMN IF NOT EXISTS is_winner boolean NOT NULL DEFAULT true;
ALTER TABLE dossier_facts ADD COLUMN IF NOT EXISTS conflict_group_id uuid;
ALTER TABLE dossier_facts ADD COLUMN IF NOT EXISTS raw_value jsonb;
ALTER TABLE dossier_facts ADD COLUMN IF NOT EXISTS normalized_value jsonb;
ALTER TABLE dossier_facts ADD COLUMN IF NOT EXISTS normalization_method text;

-- L'ancien index garantissait un seul fait actif par (dossier, clé). Avec les
-- non-gagnants persistés, on doit restreindre la contrainte aux gagnants.
-- DROP de l'ancien index avant d'en créer un plus précis — sans courte
-- fenêtre de non-unicité car ils ciblent les mêmes lignes (tous les
-- pré-Phase-1 ont is_winner=true par défaut).
DROP INDEX IF EXISTS uniq_dossier_facts_active_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dossier_facts_active_winner_key
  ON dossier_facts(dossier_id, key)
  WHERE superseded_at IS NULL AND is_winner = true;

-- Index utiles pour : lister tous les candidats d'une clé donnée, et regrouper
-- les contradictions à l'instruction.
CREATE INDEX IF NOT EXISTS idx_dossier_facts_conflict_group
  ON dossier_facts(conflict_group_id) WHERE conflict_group_id IS NOT NULL;

-- ── Phase 3 — Zones partagées pour les PLUi ────────────────────────────────
-- Une zone portée par un PLUi intercommunal ne « possède » pas de commune
-- unique : elle s'applique aux N communes membres via document_communes, et
-- le moteur résout les règles par source_document_id (cf. Lot 4). On lève
-- donc le NOT NULL sur zones.commune_id. Additif et rétro-compatible : toutes
-- les zones existantes conservent leur commune_id ; seules les futures zones
-- de PLUi pourront être créées avec commune_id NULL.
ALTER TABLE zones ALTER COLUMN commune_id DROP NOT NULL;

-- Idem pour le document lui-même : un PLUi porté par un EPCI n'a pas de
-- commune propriétaire unique, son périmètre vit dans document_communes.
ALTER TABLE regulatory_documents ALTER COLUMN commune_id DROP NOT NULL;

-- ── Vérification d'email à l'inscription publique ──────────────────────────
-- Un compte citoyen auto-inscrit reste non vérifié (email_verified_at NULL) et
-- ne peut pas se connecter tant que l'adresse n'est pas confirmée via le lien
-- envoyé par email. Backfill : tous les comptes déjà existants au moment de la
-- migration sont considérés vérifiés (on prend created_at) pour ne pas les
-- bloquer. Les futures inscriptions partent à NULL → vérification requise.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamp;
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- Onboarding (pop-up de bienvenue) : NULL = jamais vu → la modale s'affiche à
-- la 1re connexion d'un agent mairie/instructeur. On NE rétro-remplit PAS :
-- les agents existants la verront donc une fois (sert aussi à annoncer le
-- module d'aide « ? »). Pour ne la réserver qu'aux nouveaux comptes, exécuter
-- une fois : UPDATE users SET onboarding_completed_at = now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp;

-- ── FranceConnect (OpenID Connect) ─────────────────────────────────────────
-- Identifiant pivot FranceConnect (claim « sub »). UNIQUE pour empêcher deux
-- comptes locaux de pointer la même identité FranceConnect. Reste NULL pour
-- les comptes créés par email/mot de passe (l'index UNIQUE de Postgres autorise
-- plusieurs NULL).
ALTER TABLE users ADD COLUMN IF NOT EXISTS fc_sub text;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_fc_sub ON users(fc_sub) WHERE fc_sub IS NOT NULL;

-- Un compte « 100 % FranceConnect » n'a pas de mot de passe local : on lève le
-- NOT NULL historique. Les comptes email/mot de passe gardent évidemment leur
-- hash ; seuls les comptes issus de FranceConnect ont password_hash = NULL.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Revocation de session : compteur embarque dans le JWT (claim tv). Incremente
-- lors d'un changement de mot de passe / de role / d'une revocation -> tous les
-- jetons emis avant deviennent invalides (cf. middlewares/auth.ts). DEFAULT 0 :
-- les jetons deja emis (tv absent => 0) restent valides jusqu'a leur expiration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;

-- MFA TOTP (opt-in agents/admin). mfa_secret = secret TOTP chiffre au repos
-- (AES-256-GCM) ; mfa_enabled true apres confirmation d'un 1er code ;
-- mfa_backup_codes = empreintes SHA-256 des codes de secours a usage unique.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes jsonb;

-- ── Traçabilité fine règle → passage source ────────────────────────────────
-- Jusqu'ici une règle ne pointait que vers son DOCUMENT (source_document_id).
-- On ajoute de quoi retrouver le PASSAGE exact :
--   source_segment_id : segment RAG (document_segments) d'origine → texte + page
--   source_page       : n° de page si connu à l'extraction
--   source_quote      : extrait verbatim (= rule_text), citable tel quel
-- Renseignés à l'ingestion automatique ; NULL pour les règles saisies à la main.
-- ON DELETE SET NULL : réindexer le RAG ne casse jamais une règle.
ALTER TABLE zone_regulatory_rules
  ADD COLUMN IF NOT EXISTS source_segment_id text
  REFERENCES document_segments(id) ON DELETE SET NULL;
ALTER TABLE zone_regulatory_rules ADD COLUMN IF NOT EXISTS source_page integer;
ALTER TABLE zone_regulatory_rules ADD COLUMN IF NOT EXISTS source_quote text;
CREATE INDEX IF NOT EXISTS idx_zone_regulatory_rules_source_segment
  ON zone_regulatory_rules(source_segment_id);

-- Backfill minimal : à défaut de provenance fine (héritée d'une ré-ingestion),
-- on pose au moins le verbatim citable = rule_text pour le stock existant.
UPDATE zone_regulatory_rules
SET source_quote = rule_text
WHERE source_quote IS NULL;

-- Lien explicite segment → document (remplace le rapprochement implicite par
-- doc_source_file + insee). Renseigné par le script de reindex/backfill ;
-- NULL tant que non rapproché.
ALTER TABLE document_segments
  ADD COLUMN IF NOT EXISTS source_document_id uuid
  REFERENCES regulatory_documents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_document_segments_source_document
  ON document_segments(source_document_id);

-- Backfill exact pour le stock RAG déjà indexé : l'indexeur grave depuis
-- toujours metadata.source_id = regulatory_documents.id. On le promeut en FK
-- quand c'est un UUID valide pointant un document existant.
UPDATE document_segments ds
SET source_document_id = (ds.metadata->>'source_id')::uuid
FROM regulatory_documents rd
WHERE ds.source_document_id IS NULL
  AND ds.metadata->>'source_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND rd.id = (ds.metadata->>'source_id')::uuid;

-- ── GED de dossier + annotation des pièces citoyen (3.D) ────────────────────
-- Coffre des documents PRODUITS par l'instruction (export aplati d'une pièce
-- annotée, plus tard les courriers PDF…), distinct de dossier_pieces_jointes
-- (pièces DÉPOSÉES par le citoyen). shared_with_citizen est la garde de
-- confidentialité : un document reste interne tant qu'il n'a pas été joint à un
-- envoi citoyen (message/courrier) ; la route /api/uploads n'ouvre l'accès
-- citoyen qu'à ce drapeau vrai.
CREATE TABLE IF NOT EXISTS dossier_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  nom text NOT NULL,
  url text NOT NULL,
  type text NOT NULL,
  taille integer NOT NULL,
  category text NOT NULL DEFAULT 'annotation',
  source_piece_id uuid REFERENCES dossier_pieces_jointes(id) ON DELETE SET NULL,
  note text,
  shared_with_citizen boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dossier_documents_dossier ON dossier_documents(dossier_id);
CREATE INDEX IF NOT EXISTS idx_dossier_documents_source_piece ON dossier_documents(source_piece_id);

-- Calque d'annotation vectorielle des pièces du citoyen (internalise Inkscape/
-- Foxit). Une ligne = une marque (forme + commentaire + visibilité). Les
-- géométries sont en % de page. visibility ∈ { interne, citoyen }.
CREATE TABLE IF NOT EXISTS dossier_piece_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  piece_id uuid NOT NULL REFERENCES dossier_pieces_jointes(id) ON DELETE CASCADE,
  page integer NOT NULL DEFAULT 1,
  tool text NOT NULL,
  geometry jsonb NOT NULL DEFAULT '{}'::jsonb,
  style jsonb NOT NULL DEFAULT '{}'::jsonb,
  comment text,
  visibility text NOT NULL DEFAULT 'interne',
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_piece_annotations_piece ON dossier_piece_annotations(piece_id);
CREATE INDEX IF NOT EXISTS idx_piece_annotations_dossier ON dossier_piece_annotations(dossier_id);

-- Pièces jointes GED portées par messages et courriers (références vers
-- dossier_documents — aucune duplication de fichier).
ALTER TABLE dossier_messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dossier_courriers ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;

-- ── Cycle de vie des courriers : brouillon (sans effet) → envoyé (figé) ──────
-- Default 'envoye' : les courriers déjà en base ont tous été émis directement
-- (le brouillon n'existait pas), le backfill les classe donc correctement.
ALTER TABLE dossier_courriers ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'envoye';

-- ── Circuit de signature des courriers ──────────────────────────────────────
ALTER TABLE dossier_courriers ADD COLUMN IF NOT EXISTS signature_status text NOT NULL DEFAULT 'non_requise';
ALTER TABLE dossier_courriers ADD COLUMN IF NOT EXISTS signataire_user_id uuid REFERENCES users(id);
ALTER TABLE dossier_courriers ADD COLUMN IF NOT EXISTS signature_requested_by uuid REFERENCES users(id);
ALTER TABLE dossier_courriers ADD COLUMN IF NOT EXISTS signature_requested_at timestamp;
ALTER TABLE dossier_courriers ADD COLUMN IF NOT EXISTS signed_at timestamp;
ALTER TABLE dossier_courriers ADD COLUMN IF NOT EXISTS signature_image text;
ALTER TABLE dossier_courriers ADD COLUMN IF NOT EXISTS tampon_image text;

-- ── Dépôt groupé : un seul fichier OCR éclaté en plusieurs pièces ───────────
-- Flux historique (1 fichier = 1 pièce) inchangé : ces objets sont additifs.
CREATE TABLE IF NOT EXISTS dossier_piece_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  nom text NOT NULL,
  url text NOT NULL,
  storage_key text NOT NULL,
  type text NOT NULL,
  taille integer NOT NULL,
  page_count integer,
  status text NOT NULL DEFAULT 'segmenting',
  proposed_segments jsonb,
  error text,
  created_at timestamp NOT NULL DEFAULT now(),
  segmented_at timestamp,
  applied_at timestamp,
  applied_by uuid
);
CREATE INDEX IF NOT EXISTS idx_dossier_piece_bundles_dossier ON dossier_piece_bundles(dossier_id);

-- Traçabilité de l'éclatement sur chaque pièce créée à partir d'un bundle.
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS source_bundle_id uuid REFERENCES dossier_piece_bundles(id) ON DELETE SET NULL;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS source_pages jsonb;
-- Provenance de la catégorisation : auto (IA) | instructeur (corrigée) | manuel.
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS code_piece_source text;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS nom_origine text;
ALTER TABLE dossier_pieces_jointes ADD COLUMN IF NOT EXISTS classification_confidence real;

-- ── Facturation / mini compte de résultat (back-office super-admin) ─────────
-- Trois tables alimentent l'onglet « Facturation » : un catalogue de
-- prestations réutilisable, les lignes effectivement facturées à chaque
-- collectivité (commune OU EPCI), et les charges d'exploitation saisies à la
-- main. Le compte de résultat croise ces revenus avec les charges + les coûts
-- IA déjà tracés dans ai_usage_events.

-- Catalogue de prestations (valeurs par défaut recopiées en snapshot sur
-- chaque ligne facturée).
CREATE TABLE IF NOT EXISTS billing_prestations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    text NOT NULL UNIQUE,
  label                   text NOT NULL,
  description             text,
  default_unit_price_eur  double precision NOT NULL DEFAULT 0,
  unit                    text NOT NULL DEFAULT 'forfait',
  default_vat_rate        double precision NOT NULL DEFAULT 20,
  billing_cycle           text NOT NULL DEFAULT 'one_shot',
  active                  boolean NOT NULL DEFAULT true,
  sort_order              integer NOT NULL DEFAULT 0,
  updated_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at              timestamp NOT NULL DEFAULT now(),
  updated_at              timestamp NOT NULL DEFAULT now()
);

-- Seed indicatif : grille de départ, librement éditable depuis le back-office.
INSERT INTO billing_prestations (code, label, description, default_unit_price_eur, unit, default_vat_rate, billing_cycle, sort_order)
VALUES
  ('abonnement_annuel',   'Abonnement plateforme (annuel)',  'Licence annuelle d''accès à la plateforme HEUREKIA',        2400, 'an',       20, 'yearly',   10),
  ('abonnement_mensuel',  'Abonnement plateforme (mensuel)', 'Licence mensuelle d''accès à la plateforme HEUREKIA',        220, 'mois',     20, 'monthly',  20),
  ('setup',               'Frais de mise en service',        'Paramétrage initial, import du PLU, formation de prise en main', 1500, 'forfait', 20, 'one_shot', 30),
  ('formation',           'Formation / accompagnement',      'Session de formation des agents instructeurs',                 800, 'forfait',  20, 'one_shot', 40),
  ('instruction_dossier', 'Instruction de dossier (à l''acte)', 'Facturation à l''unité par dossier instruit',                 12, 'dossier',  20, 'usage',    50)
ON CONFLICT (code) DO NOTHING;

-- Lignes facturées à chaque collectivité. Exactement une cible (commune OU
-- EPCI) renseignée.
CREATE TABLE IF NOT EXISTS billing_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestation_id   uuid REFERENCES billing_prestations(id) ON DELETE SET NULL,
  commune_id      uuid REFERENCES communes(id) ON DELETE CASCADE,
  epci_id         uuid REFERENCES epci(id) ON DELETE CASCADE,
  label           text NOT NULL,
  quantity        double precision NOT NULL DEFAULT 1,
  unit_price_eur  double precision NOT NULL DEFAULT 0,
  vat_rate        double precision NOT NULL DEFAULT 20,
  billing_cycle   text NOT NULL DEFAULT 'one_shot',
  start_date      date NOT NULL DEFAULT CURRENT_DATE,
  end_date        date,
  status          text NOT NULL DEFAULT 'active',
  note            text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);
-- Cible unique : XOR commune/EPCI (ni les deux, ni aucune).
DO $$ BEGIN
  ALTER TABLE billing_items
    ADD CONSTRAINT billing_items_one_client_chk
    CHECK ((commune_id IS NOT NULL) <> (epci_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_billing_items_commune ON billing_items(commune_id);
CREATE INDEX IF NOT EXISTS idx_billing_items_epci ON billing_items(epci_id);
CREATE INDEX IF NOT EXISTS idx_billing_items_status ON billing_items(status);
CREATE INDEX IF NOT EXISTS idx_billing_items_start_date ON billing_items(start_date);

-- Charges d'exploitation saisies à la main (hors coûts IA, déjà tracés).
CREATE TABLE IF NOT EXISTS billing_costs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category     text NOT NULL DEFAULT 'autre',
  label        text NOT NULL,
  amount_eur   double precision NOT NULL DEFAULT 0,
  vat_rate     double precision NOT NULL DEFAULT 0,
  recurrence   text NOT NULL DEFAULT 'one_shot',
  incurred_on  date NOT NULL DEFAULT CURRENT_DATE,
  end_date     date,
  note         text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_costs_incurred_on ON billing_costs(incurred_on);
CREATE INDEX IF NOT EXISTS idx_billing_costs_category ON billing_costs(category);

-- Grille tarifaire par paliers de population. Une commune est rattachée au
-- plan dont la tranche [pop_min, pop_max] contient sa population ; le palier
-- EPCI cible les intercommunalités. Sert à pré-remplir le prix d'une ligne
-- facturée (modifiable ensuite).
CREATE TABLE IF NOT EXISTS billing_plans (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        text NOT NULL UNIQUE,
  name                        text NOT NULL,
  target_label                text,
  pop_min                     integer,
  pop_max                     integer,
  applies_to                  text NOT NULL DEFAULT 'commune',
  monthly_price_eur           double precision NOT NULL DEFAULT 0,
  annual_price_eur            double precision NOT NULL DEFAULT 0,
  onboarding_initial_eur      double precision NOT NULL DEFAULT 0,
  onboarding_intermediate_eur double precision NOT NULL DEFAULT 0,
  dossiers_per_month          integer,
  agents_included             integer,
  support_level               text,
  vat_rate                    double precision NOT NULL DEFAULT 20,
  active                      boolean NOT NULL DEFAULT true,
  sort_order                  integer NOT NULL DEFAULT 0,
  updated_by                  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                  timestamp NOT NULL DEFAULT now(),
  updated_at                  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_plans_pop ON billing_plans(applies_to, pop_min, pop_max);

-- Seed indicatif : grille proposée (librement éditable depuis le back-office).
-- dossiers_per_month / agents_included NULL = illimité.
INSERT INTO billing_plans (code, name, target_label, pop_min, pop_max, applies_to, monthly_price_eur, annual_price_eur, onboarding_initial_eur, onboarding_intermediate_eur, dossiers_per_month, agents_included, support_level, sort_order)
VALUES
  ('tres_petite',      'Très petite commune', '< 1 500 hab',        NULL,  1500,  'commune',  99, 1188,   600, 349,   15,   1,    'Email, 72h',     10),
  ('petite',           'Petites communes',    '1 501 à 3 000 hab',  1501,  3000,  'commune', 199, 2388,   900, 540,   30,   2,    'Email + visio',  20),
  ('moyenne',          'Commune moyenne',     '3 001 à 5 000 hab',  3001,  5000,  'commune', 299, 3588,  1200, 720,   60,   3,    'Prioritaire',    30),
  ('grande',           'Grande commune',      '5 001 à 50 000 hab', 5001,  50000, 'commune', 699, 8388,  3000, 999,  150,   5,    'Prioritaire',    40),
  ('intercommunalite', 'Intercommunalité',    'EPCI, CC, CA',       NULL,  NULL,  'epci',    999, 11988, 9000, 999,  500,  10,    'Prioritaire',    50),
  ('metropole',        'Métropole',           '> 50 000 hab',       50001, NULL,  'commune', 2500, 30000, 15000, 999, NULL, NULL, 'SLA 99.9%',      60)
ON CONFLICT (code) DO NOTHING;

-- Rattachement d'une ligne facturée au plan tarifaire appliqué (traçabilité).
ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES billing_plans(id) ON DELETE SET NULL;

-- Prestations catalogue générées depuis la grille tarifaire : un abonnement
-- (annuel + mensuel) et l'onboarding (initial + intermédiaire) par palier.
-- Maintenues en phase par l'API à chaque édition d'un plan ; supprimées en
-- cascade si le plan disparaît.
ALTER TABLE billing_prestations ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES billing_plans(id) ON DELETE CASCADE;
ALTER TABLE billing_prestations ADD COLUMN IF NOT EXISTS plan_component text;
CREATE INDEX IF NOT EXISTS idx_billing_prestations_plan ON billing_prestations(plan_id);

INSERT INTO billing_prestations (code, label, description, default_unit_price_eur, unit, default_vat_rate, billing_cycle, active, sort_order, plan_id, plan_component)
SELECT
  'plan_' || p.code || '_' || comp.key,
  p.name || ' — ' || comp.label,
  'Généré depuis la grille tarifaire',
  CASE comp.key
    WHEN 'abo_annuel'  THEN p.annual_price_eur
    WHEN 'abo_mensuel' THEN p.monthly_price_eur
    WHEN 'onb_initial' THEN p.onboarding_initial_eur
    ELSE p.onboarding_intermediate_eur END,
  comp.unit, p.vat_rate, comp.cycle, p.active, p.sort_order * 10 + comp.ord, p.id, comp.key
FROM billing_plans p
CROSS JOIN (VALUES
  ('abo_annuel',  'Abonnement annuel',        'an',      'yearly',   1),
  ('abo_mensuel', 'Abonnement mensuel',       'mois',    'monthly',  2),
  ('onb_initial', 'Onboarding initial',       'forfait', 'one_shot', 3),
  ('onb_interm',  'Onboarding intermédiaire', 'forfait', 'one_shot', 4)
) AS comp(key, label, unit, cycle, ord)
ON CONFLICT (code) DO NOTHING;

-- ── Réglages du site public (singleton id=1) ──────────────────────────────
-- Pilote le mode « bientôt en ligne » : page vitrine + mot de passe d'accès
-- sur le portail public (www.heurekia.com + apex), activable / désactivable
-- depuis le super-admin. coming_soon_password_hash = bcrypt (jamais en clair).
CREATE TABLE IF NOT EXISTS site_settings (
  id                          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  coming_soon_enabled         boolean NOT NULL DEFAULT false,
  coming_soon_title           text,
  coming_soon_message         text,
  coming_soon_password_hash   text,
  updated_at                  timestamp NOT NULL DEFAULT now()
);
INSERT INTO site_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── Centre d'aide : documentation rédigée depuis le super-admin ────────────
-- Deux tables : les thèmes (sommaire) et les articles qui leur sont rattachés.
-- Le contenu HTML est produit par l'éditeur riche (mise en page, images en
-- data URL, vidéos embarquées) et assaini avant rendu côté agent mairie.
CREATE TABLE IF NOT EXISTS help_themes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  title         text NOT NULL,
  description   text,
  icon          text,
  sort_order    integer NOT NULL DEFAULT 0,
  is_published  boolean NOT NULL DEFAULT true,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS help_articles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id      uuid NOT NULL REFERENCES help_themes(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  title         text NOT NULL,
  excerpt       text,
  content_html  text NOT NULL DEFAULT '',
  cover_image   text,
  status        text NOT NULL DEFAULT 'draft',
  sort_order    integer NOT NULL DEFAULT 0,
  author_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  view_count    integer NOT NULL DEFAULT 0,
  published_at  timestamp,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now(),
  CONSTRAINT help_articles_theme_slug UNIQUE (theme_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_help_articles_theme ON help_articles(theme_id);
CREATE INDEX IF NOT EXISTS idx_help_articles_status ON help_articles(status);

-- ── Préférences de notification par utilisateur (cloche mairie) ──
-- Map JSON { type_notification: bool }. Clé absente = activé (opt-out explicite).
-- Filtrée dans services/notify.ts avant l'insertion d'une notification.
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
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
