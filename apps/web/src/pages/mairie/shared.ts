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
  // Email réel du pétitionnaire (null si compte interne/placeholder), état de son
  // compte, et si la mairie peut l'inviter à activer son espace citoyen.
  petitionnaire_email?: string | null;
  petitionnaire_is_placeholder?: boolean;
  petitionnaire_can_invite?: boolean;
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

// Carte commune → code INSEE. Amorce/repli codé en dur (fusionné puis
// écrasé par /mairie/my-communes au runtime). À terme : 100% API.
export const COMMUNE_INSEE: Record<string, string> = {
  "Ballan-Miré": "37018",
  "Berthenay": "37024",
  "Tours": "37261",
  "Saint-Avertin": "37208",
  "Joué-lès-Tours": "37122",
  "La Riche": "37195",
};

// Dossier tel que renvoyé par GET /mairie/dossiers (liste, recherche).
export type ApiDossier = {
  id: string; numero: string; type: string; status: string;
  adresse: string | null; commune: string | null; description: string | null;
  date_depot: string | null; date_limite_instruction: string | null;
  demandeur: string;
  instructeur_id?: string | null;
  instructeur?: string | null;
  // Vrai tant qu'une pièce du dossier est encore `pending`/`processing` côté
  // worker OCR. La ligne est alors grisée et non cliquable dans la liste, et
  // le détail renvoie 423.
  ocr_processing?: boolean;
};

// Types de dossier sélectionnables (création + édition du type en détail).
export type NouveauDossierType =
  | "permis_de_construire"
  | "permis_de_construire_mi"
  | "declaration_prealable"
  | "permis_amenager"
  | "permis_demolir"
  | "permis_lotir"
  | "certificat_urbanisme"
  | "certificat_urbanisme_a"
  | "certificat_urbanisme_b";

export const DOSSIER_TYPE_OPTIONS: { value: NouveauDossierType; label: string }[] = [
  { value: "permis_de_construire_mi", label: "Permis de construire — Maison individuelle (PCMI)" },
  { value: "permis_de_construire", label: "Permis de construire (PC)" },
  { value: "declaration_prealable", label: "Déclaration préalable (DP)" },
  { value: "permis_amenager", label: "Permis d'aménager (PA)" },
  { value: "permis_demolir", label: "Permis de démolir (PD)" },
  { value: "certificat_urbanisme_a", label: "Certificat d'urbanisme informatif (CUa)" },
  { value: "certificat_urbanisme_b", label: "Certificat d'urbanisme opérationnel (CUb)" },
];

// Notifications : forme API + helpers d'affichage (icône, couleur, temps relatif).
export type ApiNotif = { id: string; type: string; title: string; message: string; is_read: boolean; dossier_id: string | null; created_at: string };

export function notifIcon(type: string) {
  if (type.includes("message")) return "💬";
  if (type.includes("delai") || type.includes("echeance") || type.includes("incomplet")) return "⏰";
  if (type.includes("decision") || type.includes("accepte") || type.includes("refuse")) return "✅";
  if (type.includes("dossier") || type.includes("nouveau")) return "📁";
  return "🔔";
}
export function notifColor(type: string) {
  if (type.includes("delai") || type.includes("echeance") || type.includes("incomplet") || type.includes("refuse")) return "#EF4444";
  if (type.includes("message")) return "#3B82F6";
  return "#4F46E5";
}
export function relTime(d: string) {
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60_000) return "À l'instant";
  if (ms < 3_600_000) return `Il y a ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `Il y a ${Math.floor(ms / 3_600_000)}h`;
  if (ms < 172_800_000) return "Hier";
  return `Il y a ${Math.floor(ms / 86_400_000)}j`;
}
