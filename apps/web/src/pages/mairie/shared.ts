import type { DossierStatus, NextAction } from "@heureka-v1/shared";

// Types et constantes transverses au module mairie, extraits de MairieApp.tsx
// (qui dépassait 11 000 lignes) afin d'être partagés entre écrans
// — DossierDetailScreen, DecisionPanel… — sans dépendance circulaire.

export type DelaiBreakdown = {
  total_mois: number;
  base_date?: string;
  base_date_source?: "completude" | "depot";
  computed_at?: string;
  breakdown: Array<{ label: string; mois: number; article: string }>;
};

export type WorkflowMeta = {
  status: DossierStatus;
  next_action: NextAction | null;
  allowed_transitions: DossierStatus[];
  can_take_charge: boolean;
  can_reassign: boolean;
  can_unassign: boolean;
  is_mine: boolean;
};

export type DossierInfo = {
  id: string; numero: string; type: string; petitionnaire: string; adresse: string;
  status: string; echeance: string; date_depot?: string;
  date_completude?: string;
  delai?: DelaiBreakdown | null;
  description?: string; parcelle?: string; surface_plancher?: string;
  commune?: string; code_postal?: string;
  instructeur?: string;
  instructeur_id?: string;
  workflow?: WorkflowMeta;
  lat?: number; lng?: number;
  // Analyse parcellaire propagée depuis la création du dossier côté citoyen,
  // évite un re-fetch /analyse-parcelle à l'ouverture.
  cachedParcelAnalysis?: Record<string, unknown> | null;
};

// Libellés des rôles signataires / agents (partagé : gestion des
// utilisateurs + panneau de décision).
export const ROLE_LABELS: Record<string, string> = {
  maire: "Maire",
  adjoint: "Adjoint au Maire",
  dgs: "Directeur Général des Services",
  responsable_ads: "Responsable ADS",
  directeur: "Directeur de service",
};
