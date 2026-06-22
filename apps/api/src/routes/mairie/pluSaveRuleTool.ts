/**
 * Outil `save_rule` de l'ingestion PLU par PDF (Pixtral Vision).
 *
 * Extrait ici (hors de admin.ts) pour : 1) être testable en isolation, 2)
 * partager UNE définition entre les trois sous-pipelines (SSE legacy, worker
 * async, batch). Aligné sur le MÊME contrat que le chemin « coller un article »
 * (reglementation.ts) et sur le format canonique : mêmes `topic`, mêmes
 * `applies_if`, et désormais `cases` / `sub_theme` / `exceptions`.
 *
 * Le few-shot de calibration (zone UC validée) est injecté dans les prompts via
 * `PLU_EXTRACTION_CALIBRATION` pour que l'upload d'un PDF complet sorte au même
 * niveau de structuration que le collage d'article.
 */
import type { AiToolDefinition } from "../../services/aiUsage.js";
import { KNOWN_TOPICS, KNOWN_APPLIES_IF } from "@heureka-v1/ingestion/canonical";
import { calibrationFewShot } from "@heureka-v1/ingestion/calibration";

export type PluRuleCase = { condition: string; value: number | null; unit: string | null; kind: "condition" | "parametre" };

export type PluRuleInput = {
  article_number?: number | null;
  article_title?: string;
  sub_theme?: string | null;
  topic: string;
  rule_text: string;
  not_regulated?: boolean;
  value_min?: number | null;
  value_max?: number | null;
  value_exact?: number | null;
  unit?: string | null;
  conditions?: string | null;
  exceptions?: string | null;
  cases?: PluRuleCase[];
  applies_if?: string[];
  summary: string;
  citizen_title?: string | null;
  citizen_summary?: string | null;
  citizen_relevant?: boolean;
  needs_vision?: boolean;
  needs_external_doc?: boolean;
  external_doc_name?: string | null;
};

const CASE_UNITS = ["m", "cm", "%", "m²", "places"] as const;
const APPLIES_IF_TAGS = new Set<string>(KNOWN_APPLIES_IF);

export const PLU_SAVE_RULE_TOOL: AiToolDefinition = {
  type: "function",
  function: {
    name: "save_rule",
    description: "Enregistre une (sous-)règle réglementaire extraite d'un article du PLU.",
    parameters: {
      type: "object",
      properties: {
        article_number: { type: "number", description: "Numéro de l'article, décimal autorisé pour les PLU modernisés (6, 12.1, 12.2…). Null si non numéroté." },
        article_title: { type: "string", description: "Titre exact de l'article." },
        sub_theme: { type: "string", description: "Sous-section thématique quand l'article en porte plusieurs, ex: « 12.1 Logements », « 11.4 Clôtures », « Secteur inondable UCi ». Omettre si l'article ne porte qu'une règle." },
        topic: {
          type: "string",
          enum: [...KNOWN_TOPICS],
          description: "Catégorie réglementaire (grille R.123-9). Art. 1 → interdictions, 2 → conditions, 3 → desserte_voies, 4 → desserte_reseaux, 6 → recul_voie, 7 → recul_limite, 9 → emprise_sol, 10 → hauteur, 11 → aspect, 12 → stationnement, 13 → espaces_verts.",
        },
        rule_text: { type: "string", description: "Texte fidèle de la règle." },
        not_regulated: { type: "boolean", description: "True si article dit 'sans objet' ou 'non réglementé'." },
        value_min: { type: "number", description: "Seuil minimal (« au moins », « ≥ »). Omettre si absent." },
        value_max: { type: "number", description: "Seuil maximal (« ne dépasse pas », « ≤ »). Omettre si absent." },
        value_exact: { type: "number", description: "Valeur unique exacte. Omettre si absent." },
        unit: { type: "string", enum: [...CASE_UNITS], description: "Unité de la valeur principale. Omettre si pas de valeur numérique." },
        conditions: { type: "string", description: "Conditions d'application (variantes, sous-cas). Omettre si aucune." },
        exceptions: { type: "string", description: "Dérogations PROPRES à cette règle (« sauf… », « à l'exception de… », dates). Omettre si aucune. NE PAS recopier dans citizen_summary." },
        cases: {
          type: "array",
          description: "Décompose les seuils/alternatives chiffrés d'une MÊME règle. kind='condition' = alternatives EXCLUSIVES (ex: 6,5 m à l'égout / 9 m au faîtage). kind='parametre' = valeurs CUMULATIVES (ex: 1 arbre pour 100 m²). N'invente JAMAIS de case sans valeur chiffrée ; une énumération qualitative reste dans rule_text.",
          items: {
            type: "object",
            properties: {
              condition: { type: "string", description: "Libellé du cas (ex: « à l'égout de toiture », « au-delà de 1000 m² »)." },
              value: { type: "number", description: "Valeur chiffrée du cas." },
              unit: { type: "string", enum: [...CASE_UNITS], description: "Unité du cas. Omettre si sans unité (ex: nombre d'arbres)." },
              kind: { type: "string", enum: ["condition", "parametre"], description: "condition = exclusif ; parametre = cumulatif." },
            },
            required: ["condition", "value", "kind"],
          },
        },
        applies_if: {
          type: "array",
          items: { type: "string", enum: [...KNOWN_APPLIES_IF] },
          description: "Tags de contexte parcellaire : la règle ne s'applique QUE si la parcelle/projet correspond. Ex: secteur inondable → ['inondable'] ; périmètre ABF → ['abf']. [] si général.",
        },
        summary: { type: "string", description: "Résumé technique en 10 mots maximum (usage interne instructeur)." },
        citizen_title: { type: "string", description: "Titre court de la règle, en langage courant, destiné aux particuliers (≤ 8 mots, sans jargon juridique). Ex: « Stationnement pour logements individuels »." },
        citizen_summary: { type: "string", description: "Explication COMPLÈTE de la règle en langage courant, 3 à 6 phrases. Inclut explicitement : la règle de fond, les conditions et exceptions, les valeurs chiffrées avec leur unité, et — si needs_vision = true — une description précise du schéma/croquis (ce qu'il représente, ce qu'il autorise/interdit). Phrases complètes, pas de bullets, pas de compact, pas de jargon." },
        citizen_relevant: { type: "boolean", description: "False seulement si la disposition n'a aucune utilité pour un particulier (procédure administrative pure, articles internes à l'administration). True par défaut." },
        needs_vision: { type: "boolean", description: "True si la règle renvoie à un schéma/croquis graphique du document (calcul de hauteur, implantation, types de lucarnes, etc.)." },
        needs_external_doc: { type: "boolean", description: "True si la règle renvoie explicitement à un document externe (PPRI, PLH, cahier des charges ZAC, servitude…)." },
        external_doc_name: { type: "string", description: "Nom du document externe référencé (ex: 'PPRI', 'PLH', 'cahier des charges ZAC'). Remplir si needs_external_doc = true." },
      },
      required: ["article_number", "article_title", "topic", "rule_text", "not_regulated", "summary", "citizen_title", "citizen_summary", "needs_vision", "needs_external_doc"],
    },
  },
};

/**
 * Bloc de calibration à concaténer aux prompts d'extraction PDF. L'exemple est
 * exprimé en JSON ; en function-calling, le modèle produit l'ÉQUIVALENT via des
 * appels `save_rule` (un par sous-règle).
 */
export const PLU_EXTRACTION_CALIBRATION = `

CALIBRATION — niveau de décomposition attendu (function-calling) :
L'exemple ci-dessous, tiré d'un règlement réel validé, est donné en JSON. Toi, tu produis l'ÉQUIVALENT en appelant save_rule UNE fois par (sous-)règle, en remplissant cases / applies_if / sub_theme / exceptions de la même manière. Reproduis ce NIVEAU de structuration, ne recopie PAS les valeurs.
${calibrationFewShot()}`;

/** Coercion défensive des `cases` issus du modèle (on jette les cas sans valeur). */
export function coerceCases(x: unknown): PluRuleCase[] {
  if (!Array.isArray(x)) return [];
  return (x as unknown[])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c): PluRuleCase => ({
      condition: typeof c.condition === "string" ? c.condition.trim() : "",
      value: typeof c.value === "number" && Number.isFinite(c.value) ? c.value : null,
      unit: typeof c.unit === "string" && c.unit.trim() ? c.unit.trim() : null,
      kind: c.kind === "condition" ? "condition" : "parametre",
    }))
    .filter((c) => c.condition && c.value != null);
}

/** Coercion défensive des `applies_if` (on ne garde que les tags connus). */
export function coerceAppliesIf(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return (x as unknown[]).filter((t): t is string => typeof t === "string" && APPLIES_IF_TAGS.has(t));
}
