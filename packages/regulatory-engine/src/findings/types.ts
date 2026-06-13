// Statut juridique d'un constat — quatre valeurs strictes.
//   conforme       : les faits disponibles prouvent le respect de la règle.
//   non_conforme   : écart explicite avec une règle applicable.
//   incertain      : règle applicable mais évaluation impossible sans
//                    complément (donnée manquante, interprétation ouverte).
//   non_applicable : la règle a été écartée — la raison doit être dans
//                    explanation.
export type FindingStatus = "conforme" | "non_conforme" | "incertain" | "non_applicable";

// Sévérité — pilote l'affichage UI et la priorisation de la checklist.
//   bloquant      : empêche la délivrance en l'état.
//   prescription : non-conformité régularisable par prescription dans
//                  l'arrêté.
//   alerte       : point d'attention sans blocage juridique direct.
//   info         : information contextuelle, pas d'action requise.
export type FindingSeverity = "bloquant" | "prescription" | "alerte" | "info";

// Référence à une source : article de code, règle de zone, segment de
// document ingéré, annotation validée. Toujours qualifier le type — c'est
// ce qui permet d'afficher la bonne pastille dans l'UI et de retrouver
// l'élément en base.
export type SourceRef =
  | { type: "legal_article"; code: string; ref: string; quote?: string }
  | { type: "zone_rule"; rule_id: string; article?: string }
  | { type: "document_segment"; segment_id: string; doc_type: string; page?: number; quote?: string }
  | { type: "annotation"; annotation_id: string; segment_id: string };

// Action recommandée à l'instructeur, dérivée du finding. Le checklist
// engine convertit ces objets en `instruction_recommendations` persistées.
export interface RecommendedAction {
  action_type:
    | "demander_piece"
    | "consulter_service"
    | "valider_point"
    | "prescription_arrete"
    | "motif_refus"
    | "clarifier_fait";
  label: string;
  reason?: string;
  priority?: "haute" | "moyenne" | "basse";
  legal_basis?: SourceRef[];
}

// Décision instructeur sur un finding. NULL = pas encore tranché.
export type InstructorDecision = "accepted" | "corrected" | "ignored";

export interface RegulatoryFinding {
  id?: string;
  analysis_id?: string;
  dossier_id: string;
  topic: string;
  status: FindingStatus;
  severity: FindingSeverity;
  title: string;
  explanation?: string;
  legal_basis: SourceRef[];
  source_refs: SourceRef[];
  // Clés de dossier_facts effectivement consommées par l'évaluation.
  facts_used: string[];
  // Clés de faits dont l'absence a empêché de conclure.
  missing_facts: string[];
  recommended_action?: RecommendedAction;
  citizen_summary?: string;
  rule_id?: string;
}
