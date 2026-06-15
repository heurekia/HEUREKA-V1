import type { SourceRef } from "../findings/types.js";

// Représentation d'une règle de zone, suffisamment riche pour le moteur
// d'applicabilité. C'est la projection minimale de zone_regulatory_rules
// + zones (jointure pour récupérer le zone_code). Les autres champs
// (rule_text, value_min/max…) ne sont pas nécessaires ici — ils seront
// chargés par les evaluators du sprint 3.
export interface RuleForApplicability {
  rule_id: string;
  zone_id: string;
  zone_code: string;
  topic: string;
  sub_theme: string | null;
  article_number: number | null;
  applies_if: string[];
  validation_status: string;
}

// Pourquoi une règle a été incluse — utile pour expliquer dans l'UI
// instructeur "cette règle s'applique parce que…".
export interface ApplicabilityReason {
  zone_matched: boolean;
  zone_unknown: boolean;
  applies_if_satisfied: string[];
  applies_if_missing: string[];
  // Score de spécificité : nombre de tags applies_if satisfaits. Une règle
  // avec 3 tags matchés est plus spécifique qu'une règle avec 0 (générale).
  // Sera utilisé par l'evaluator pour résoudre les conflits règle générale /
  // règle spéciale (sprint 3).
  specificity_score: number;
}

export interface ApplicableRule {
  rule: RuleForApplicability;
  reason: ApplicabilityReason;
}

// Une règle écartée et la raison principale. On garde un seul code
// d'exclusion par règle pour ne pas noyer l'UI ; l'ordre d'évaluation
// (zone d'abord, puis applies_if, puis validation) détermine quel code
// remonte.
export type ExclusionReason =
  | "not_validated"
  | "zone_mismatch"
  | "applies_if_unsatisfied";

export interface ExcludedRule {
  rule: RuleForApplicability;
  reason: ExclusionReason;
  detail?: string;
  // Sources réglementaires citables pour justifier l'exclusion dans l'UI.
  // Vide pour l'instant ; alimenté quand on aura le tracking des sources.
  source_refs: SourceRef[];
}

export interface ApplicabilityResult {
  applicable: ApplicableRule[];
  excluded: ExcludedRule[];
  // Avertissements de haut niveau (zone non résolue, aucune règle validée…).
  // Ce sont des signaux pour la checklist instructeur, pas des findings.
  warnings: string[];
}
