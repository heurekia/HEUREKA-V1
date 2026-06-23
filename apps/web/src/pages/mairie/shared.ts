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

// ── Présentation : libellés de statut / type de dossier, formatage de
// dates et helpers d'avatar de conversation. Purs, partagés entre écrans. ──

export const STATUS_LABEL: Record<string, string> = {
  brouillon: "Brouillon",
  soumis: "Nouveau",
  pre_instruction: "Pré-instruction",
  incomplet: "Incomplet",
  en_instruction: "En instruction",
  decision_en_cours: "Décision en cours",
  accepte: "Accepté",
  refuse: "Refusé",
  accord_prescription: "Accord prescriptions",
};

export const TYPE_LABEL: Record<string, string> = {
  permis_de_construire: "Permis de construire (PC)",
  permis_de_construire_mi: "Permis de construire — Maison individuelle (PCMI)",
  declaration_prealable: "Déclaration préalable",
  permis_amenager: "Permis d'aménager",
  permis_demolir: "Permis de démolir",
  permis_lotir: "Permis de lotir",
  certificat_urbanisme: "Certificat d'urbanisme",
  certificat_urbanisme_a: "Certificat d'urbanisme informatif (CUa)",
  certificat_urbanisme_b: "Certificat d'urbanisme opérationnel (CUb)",
};

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}

export function stringToColor(s: string): string {
  const palette = ["#4F46E5","#22C55E","#F97316","#8B5CF6","#EC4899","#14B8A6","#EF4444","#3B82F6"];
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % palette.length;
  return palette[h] ?? "#4F46E5";
}
export function nameInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}
export function fmtConvTime(iso: string): string {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR");
}
