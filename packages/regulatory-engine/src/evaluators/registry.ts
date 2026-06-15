import type { InstructionContext } from "../context/types.js";
import type { RegulatoryFinding } from "../findings/types.js";
import { evaluateHauteur } from "./hauteur.js";
import type { EvaluableRule } from "./types.js";

// Signature commune des évaluateurs : règle + contexte → finding (ou null
// si l'évaluateur ne sait pas traiter cette règle). Retourner null permet
// d'enregistrer tous les évaluateurs et de les laisser se filtrer eux-mêmes
// par topic, sans table de dispatch à maintenir.
export type Evaluator = (rule: EvaluableRule, context: InstructionContext) => RegulatoryFinding | null;

// Registre central des évaluateurs déterministes. À chaque nouveau topic
// traité, on ajoute son évaluateur ici. Aucune logique de priorité — un
// finding par évaluateur qui répond.
const EVALUATORS: Evaluator[] = [
  evaluateHauteur,
];

// Renvoie tous les findings produits par les évaluateurs enregistrés pour
// une règle donnée. Vide si aucun évaluateur ne traite ce topic — la règle
// sera reportée dans `summary.rules_without_evaluator`.
export function runEvaluatorsOnRule(rule: EvaluableRule, context: InstructionContext): RegulatoryFinding[] {
  const findings: RegulatoryFinding[] = [];
  for (const evaluator of EVALUATORS) {
    const f = evaluator(rule, context);
    if (f) findings.push(f);
  }
  return findings;
}

// Topics actuellement gérés — utile pour annoter le summary d'une analyse
// et pour rendre visible côté UI la couverture du moteur.
export function listSupportedTopics(): string[] {
  // Pour l'instant, un évaluateur = un topic. À étendre dès qu'un
  // évaluateur en traite plusieurs.
  return ["hauteur"];
}
