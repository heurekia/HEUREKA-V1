import type { DossierStatus, DossierType } from "@heureka-v1/shared";

// Origine d'un fait : conditionne la confiance et la possibilité de fonder
// un verdict bloquant. Voir packages/db/.../dossier_facts.ts.
export type FactSource =
  | "citizen_declaration"
  | "document_extraction"
  | "instructor_entry"
  | "external_data";

// Un fait unitaire utilisé par le moteur. Volontairement non-typé sur value
// (le moteur valide via Zod par clé connue côté evaluator).
export interface DossierFact {
  key: string;
  value: unknown;
  unit?: string;
  source: FactSource;
  source_ref?: Record<string, unknown>;
  confidence?: number;
  validated_by?: string;
  validated_at?: string;
}

// Informations dossier strictement nécessaires au moteur. On ne tire pas
// tout `dossiers` ici — uniquement ce qui sert à qualifier la procédure.
export interface DossierSummary {
  id: string;
  numero: string;
  type: DossierType;
  status: DossierStatus;
  commune?: string;
  code_postal?: string;
  parcelle?: string;
  adresse?: string;
  description?: string;
  date_depot?: string;
  date_completude?: string;
  ai_consent?: boolean | null;
}

// Contexte parcellaire : zonage, risques, secteurs, servitudes. Rempli par
// le ContextBuilder à partir de GPU, des documents commune validés et des
// zones PLU.
export interface ParcelleContext {
  parcelle_ref?: string;
  zonage_plu?: string[];
  secteurs?: string[];
  risques?: string[];
  servitudes?: string[];
  abf?: boolean;
  oap?: string[];
  prescriptions_graphiques?: string[];
}

// Caractéristiques du projet — déduites des faits ('extension', 'demolition',
// 'changement_destination', etc.) et utilisées pour générer les tags
// d'applicabilité consommés par RuleApplicabilityEngine.
export interface ProjectContext {
  nature_travaux?: string[];
  destination_avant?: string;
  destination_apres?: string;
  surface_creee?: number;
  surface_plancher_apres?: number;
  hauteur?: number;
  emprise?: number;
  stationnement?: number;
  demolition?: boolean;
  extension?: boolean;
  surelevation?: boolean;
  annexe?: boolean;
  cloture?: boolean;
}

export interface InstructionContext {
  dossier: DossierSummary;
  parcelle: ParcelleContext;
  projet: ProjectContext;
  facts: DossierFact[];
  // Tags dérivés (extension, abf, inondable, zone_UA…) — consommés par les
  // `applies_if` des règles de zone.
  applicability_tags: string[];
  // Identifiants des règles considérées comme candidates ; le filtrage fin
  // se fait dans RuleApplicabilityEngine.
  candidate_rule_ids: string[];
  // Faits manquants connus à la construction du contexte. Permet de
  // pré-remplir la checklist instructeur avant même l'évaluation.
  missing_facts: string[];
  built_at: string;
  engine_version: string;
}
