import { isPluFamily } from "@heureka-v1/db";

/**
 * Arbitrage de substitution (Lot 5) — logique PURE, testée isolément.
 *
 * Deux documents réglementaires de la MÊME famille PLU (`plu` / `plui` / `plum`)
 * couvrant une même commune ne se superposent pas : un PLUi entré en vigueur
 * **remplace** le PLU communal historique. Ce module décide, à une date donnée,
 * quels documents contribuent leurs règles pour une commune :
 *   - toutes les familles NON-PLU (PPRI, OAP, PEB…) → conservées (superposition) ;
 *   - la famille PLU → au plus UN document, celui en vigueur le plus récent.
 *
 * Le caller (builder.ts) résout pour UNE commune : l'ensemble passé ici décrit
 * donc les documents couvrant cette seule commune.
 */
export interface CandidateDocument {
  documentId: string;
  /** Type du document (cf. REGULATORY_DOCUMENT_TYPES). */
  type: string;
  /** Début de la fenêtre d'effet. NULL = borne ouverte (« depuis toujours »). */
  effectiveFrom: Date | null;
  /** Fin de la fenêtre d'effet. NULL = toujours en vigueur. */
  effectiveTo: Date | null;
  /** Départage deux documents PLU non datés (le plus récemment ingéré gagne). */
  createdAt: Date;
}

/**
 * Un document est « en vigueur » à la date `at` si sa fenêtre couvre `at` :
 *   (effective_from IS NULL OR effective_from <= at)
 *   AND (effective_to IS NULL OR effective_to > at)
 * Convention `effective_to` exclusive, alignée sur `commune_fiscalite`.
 */
export function isInForce(doc: CandidateDocument, at: Date): boolean {
  const t = at.getTime();
  if (doc.effectiveFrom && doc.effectiveFrom.getTime() > t) return false;
  if (doc.effectiveTo && doc.effectiveTo.getTime() <= t) return false;
  return true;
}

/**
 * Renvoie l'ensemble des `documentId` dont les règles doivent être conservées
 * à la date `at`, après arbitrage de la substitution PLU.
 *
 * Départage des documents PLU en vigueur : `effective_from` le plus récent
 * (une datation explicite l'emporte sur un document historique non daté, traité
 * comme -∞), puis `created_at` le plus récent à égalité.
 */
export function selectActiveDocumentIds(docs: CandidateDocument[], at: Date): Set<string> {
  const allowed = new Set<string>();
  const pluInForce: CandidateDocument[] = [];

  for (const d of docs) {
    if (!isPluFamily(d.type)) {
      allowed.add(d.documentId); // autres familles : superposition, toujours gardées
    } else if (isInForce(d, at)) {
      pluInForce.push(d);
    }
  }

  if (pluInForce.length > 0) {
    pluInForce.sort((a, b) => {
      const fa = a.effectiveFrom ? a.effectiveFrom.getTime() : -Infinity;
      const fb = b.effectiveFrom ? b.effectiveFrom.getTime() : -Infinity;
      if (fa !== fb) return fb - fa;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    allowed.add(pluInForce[0]!.documentId);
  }

  return allowed;
}
