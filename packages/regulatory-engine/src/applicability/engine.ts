import type { InstructionContext } from "../context/types.js";
import type {
  ApplicabilityResult,
  ApplicableRule,
  ExcludedRule,
  RuleForApplicability,
} from "./types.js";

// Évalue l'applicabilité d'un ensemble de règles à un contexte d'instruction.
//
// Fonction PURE — aucune I/O. Permet d'écrire des tests déterministes et de
// rejouer une analyse archivée à partir d'un context_snapshot.
//
// Règles d'évaluation, dans cet ordre :
//   1. validation_status != 'valide' ⇒ excluded ("not_validated").
//      Filet de sécurité : le ContextBuilder ne charge déjà que des règles
//      validées, mais on défend en profondeur — un contexte sérialisé puis
//      rejoué doit rester sûr.
//   2. zone_code absent du `parcelle.zonage_plu` ⇒ excluded ("zone_mismatch").
//      Sauf si `zonage_plu` est vide/absent ⇒ on inclut (zone inconnue) avec
//      un avertissement.
//   3. Tous les tags `applies_if` doivent être présents dans
//      `applicability_tags`. Sinon excluded ("applies_if_unsatisfied") avec
//      la liste des tags manquants.
//   4. Sinon applicable, avec un `specificity_score` = nombre de tags
//      `applies_if` satisfaits (0 pour une règle "toujours applicable").
export function evaluateApplicability(
  rules: RuleForApplicability[],
  context: InstructionContext,
): ApplicabilityResult {
  const applicable: ApplicableRule[] = [];
  const excluded: ExcludedRule[] = [];
  const warnings: string[] = [];

  const tagSet = new Set(context.applicability_tags);
  const zoneList = context.parcelle.zonage_plu ?? [];
  const zoneSet = new Set(zoneList);
  const zoneUnknown = zoneList.length === 0;

  if (zoneUnknown) {
    warnings.push(
      "Zone PLU non résolue : toutes les règles validées de la commune sont remontées comme candidates (à confirmer une fois le zonage géolocalisé).",
    );
  }

  for (const rule of rules) {
    if (rule.validation_status !== "valide") {
      excluded.push({
        rule,
        reason: "not_validated",
        detail: `validation_status = "${rule.validation_status}"`,
        source_refs: [],
      });
      continue;
    }

    const zoneMatched = zoneSet.has(rule.zone_code);
    if (!zoneUnknown && !zoneMatched) {
      excluded.push({
        rule,
        reason: "zone_mismatch",
        detail: `règle zone=${rule.zone_code}, parcelle zonage=[${zoneList.join(", ")}]`,
        source_refs: [],
      });
      continue;
    }

    const satisfied: string[] = [];
    const missing: string[] = [];
    for (const tag of rule.applies_if) {
      if (tagSet.has(tag)) satisfied.push(tag);
      else missing.push(tag);
    }

    if (missing.length > 0) {
      excluded.push({
        rule,
        reason: "applies_if_unsatisfied",
        detail: `tags manquants : ${missing.join(", ")}`,
        source_refs: [],
      });
      continue;
    }

    applicable.push({
      rule,
      reason: {
        zone_matched: zoneMatched,
        zone_unknown: zoneUnknown,
        applies_if_satisfied: satisfied,
        applies_if_missing: [],
        specificity_score: satisfied.length,
      },
    });
  }

  if (applicable.length === 0 && rules.length > 0) {
    warnings.push(
      "Aucune règle validée applicable en l'état : vérifiez le zonage et les caractéristiques du projet.",
    );
  }

  return { applicable, excluded, warnings };
}

// Résolution règle générale / règle spéciale pour un même (zone, topic, sub_theme).
// La règle la plus spécifique (specificity_score le plus élevé) prend le pas.
// En cas d'égalité, on garde toutes les règles à égalité — c'est à l'évaluateur
// de signaler le conflit plutôt que de trancher arbitrairement.
//
// Cette fonction est intentionnellement séparée : tous les appels ne veulent
// pas la résolution (l'UI peut vouloir afficher l'ensemble), seuls les
// evaluators l'appliquent.
export function resolveSpecificity(applicable: ApplicableRule[]): ApplicableRule[] {
  const groups = new Map<string, ApplicableRule[]>();
  for (const a of applicable) {
    const key = `${a.rule.zone_code}|${a.rule.topic}|${a.rule.sub_theme ?? ""}`;
    const arr = groups.get(key) ?? [];
    arr.push(a);
    groups.set(key, arr);
  }
  const winners: ApplicableRule[] = [];
  for (const arr of groups.values()) {
    const maxScore = Math.max(...arr.map((a) => a.reason.specificity_score));
    for (const a of arr) {
      if (a.reason.specificity_score === maxScore) winners.push(a);
    }
  }
  return winners;
}
