// ── Re-exports ──
export * from "./legalArticlesCatalog.js";

// ── Enums ──
export type Role = "citoyen" | "mairie" | "instructeur" | "admin";
export type DossierStatus = "brouillon" | "soumis" | "en_instruction" | "complete" | "refuse";
export type DossierType = "urbanisme" | "permis_de_construire" | "declaration_prealable" | "declaration_intention" | "permis_amenager" | "permis_demolir" | "permis_lotir";
export type NotificationChannel = "email" | "sms" | "push";
export type NotificationEvent = "nouveau_dossier" | "changement_statut" | "message_recu" | "rappel_echeance" | "decision_rendue";
export type ParcelleStatus = "conforme" | "non_conforme" | "a_verifier" | "en_attente";
export type Decision = "favorable" | "defavorable" | "avec_reserves";

// ── Core ──
export interface User {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  role: Role;
  commune?: string;
  telephone?: string;
  avatar_url?: string;
  created_at: string;
}

export interface Dossier {
  id: string;
  numero: string;
  type: DossierType;
  status: DossierStatus;
  parcelle: string;
  adresse: string;
  commune: string;
  code_postal: string;
  demandeur_id: string;
  instructeur_id?: string;
  description?: string;
  surface_plancher?: number;
  created_at: string;
  updated_at: string;
  date_soumission?: string;
  decision?: Decision;
  date_decision?: string;
}

export interface DossierMessage {
  id: string;
  dossier_id: string;
  user_id: string;
  content: string;
  piece_jointe_url?: string;
  created_at: string;
}

export interface DossierPieceJointe {
  id: string;
  dossier_id: string;
  nom: string;
  url: string;
  type: string;
  taille: number;
  uploaded_at: string;
}

// ── Calibration ──
export interface ZoneRegulatoryRule {
  id: string;
  zone: string;
  libelle: string;
  description?: string;
  // urban rules
  cos?: number;
  emprise_max?: number;
  hauteur_max?: number;
  distance_limite?: number;
  stationnement_requis?: number;
  // calibration
  calibrated?: boolean;
  calibration_date?: string;
  coefficient?: number;
}

export interface ParcelleAnalysis {
  id: string;
  dossier_id: string;
  parcelle: string;
  surface: number;
  zone: string;
  status: ParcelleStatus;
  rules_applicables: ZoneRegulatoryRule[];
  conformite_globale: number;
  alerts: string[];
  analysed_at: string;
}

// ── Stats ──
export interface DashboardStats {
  total_dossiers: number;
  dossiers_par_statut: { status: DossierStatus; count: number }[];
  dossiers_par_mois: { mois: string; count: number }[];
  delai_moyen_instruction: number;
  taux_conformite: number;
}

// ── Calendrier ──
export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: "audience" | "visite" | "reunion" | "echeance";
  dossier_id?: string;
  description?: string;
  all_day?: boolean;
}

// ── Auth ──
export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}
