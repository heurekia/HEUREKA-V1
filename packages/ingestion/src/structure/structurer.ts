/**
 * "Agent PLU" — structuration des règles par article.
 *
 * Après le découpage DÉTERMINISTE (segmenter), on n'envoie plus le PDF à un LLM :
 * on lui donne le TEXTE COURT des articles d'une zone et il renvoie des règles
 * structurées. Court => rapide, pas de limite de pages, pas de rate-limit.
 *
 * Le LLM est injecté (LlmFn) → cœur testable sans réseau.
 */
import { z } from "zod";
import type { Segment } from "../adapters/interface.ts";
import { calibrationFewShot } from "./calibration.ts";

export const RULE_TOPICS = [
  "interdictions", "conditions", "desserte_voies", "desserte_reseaux", "terrain_min",
  "recul_voie", "recul_limite", "recul_batiments", "emprise_sol", "hauteur", "aspect",
  "stationnement", "espaces_verts", "cos", "destinations", "general",
] as const;
export type RuleTopic = (typeof RULE_TOPICS)[number];

export interface RuleCase {
  condition: string; // libellé du cas / paramètre
  value: number | null;
  unit: string | null;
  kind: "condition" | "parametre"; // alternative exclusive vs valeur de calcul cumulative
}

/**
 * Spécification structurée d'une règle de HAUTEUR (niveau 2).
 *
 * Le champ `value_max` historique ne peut porter qu'UN seuil dans UNE
 * référence — insuffisant pour deux cas fréquents :
 *   - un article fixe DEUX plafonds (« 9 m à l'égout, 12 m au faîtage ») ;
 *   - la hauteur est RELATIVE (« +4 m au-dessus de la hauteur autorisée »).
 *
 * `height_spec` capture ces dimensions sans écraser quoi que ce soit. Les
 * hauteurs sont en MÈTRES. C'est une donnée de FONDATION : l'évaluateur ne la
 * consomme pas encore pour rendre un verdict (cf. niveau 3), il continue de
 * lire value_*. Tous les champs sont indépendamment nullables.
 */
export interface HeightSpec {
  /** Plafond absolu à l'égout du toit, en mètres. */
  egout: number | null;
  /** Plafond absolu au faîtage, en mètres. */
  faitage: number | null;
  /**
   * Référence d'une contrainte RELATIVE, si la hauteur est un écart par
   * rapport à une autre construction : "hauteur_autorisee" | "egout" |
   * "faitage_voisin" | "construction_voisine" | "sol_naturel" |
   * "reference_externe". null si la règle est absolue.
   */
  relative_to: string | null;
  /** Écart vertical maximal (m) pour une contrainte relative. */
  max_delta: number | null;
}

export interface StructuredRule {
  article_number: number | null;
  article_title: string;
  topic: RuleTopic | string;
  rule_text: string;
  value_min: number | null;
  value_max: number | null;
  value_exact: number | null;
  unit: string | null;
  conditions: string | null;
  summary: string;
  instructor_note: string | null;
  cases: RuleCase[];
  sub_theme: string | null;
  applies_if: string[];
  // Spécification hauteur structurée (niveau 2), renseignée hors LLM par
  // enrichHeightSpec. Optionnelle : absente pour les règles non-hauteur ou
  // sans seuil/référence détectable.
  height_spec?: HeightSpec | null;
  // Provenance fine (renseignée hors LLM) : permet de retracer le passage
  // source. source_segment_id = id du segment RAG d'origine (= Segment.id,
  // donc une ligne document_segments), source_quote = verbatim citable.
  source_segment_id?: string | null;
  source_page?: number | null;
  source_quote?: string | null;
}

export interface ZoneRules {
  zone_code: string;
  zone_label: string;
  zone_type: string;
  rules: StructuredRule[];
}

// ── Validation Zod de la sortie LLM ──────────────────────────────────────────
// Le LLM renvoie parfois "x" ou "" là où l'on attend un nombre/une chaîne :
// ces champs dégradent en null plutôt que de rejeter toute la règle. En
// revanche une règle sans rule_text NI article_title est inutilisable → rejet
// (tracé via onIssue, plus de filtrage silencieux).
const looseNumber = z.preprocess(
  (v) => (typeof v === "number" && Number.isFinite(v) ? v : null),
  z.number().nullable(),
);
const looseString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim() : null),
  z.string().nullable(),
);

const ruleCaseSchema = z.object({
  condition: looseString,
  value: looseNumber,
  unit: looseString,
  kind: z.preprocess((v) => (v === "condition" ? "condition" : "parametre"), z.enum(["condition", "parametre"])),
});

export const structuredRuleSchema = z
  .object({
    article_number: looseNumber,
    article_title: looseString.transform((v) => v ?? ""),
    topic: looseString.transform((v) => v ?? "general"),
    rule_text: looseString.transform((v) => v ?? ""),
    value_min: looseNumber,
    value_max: looseNumber,
    value_exact: looseNumber,
    unit: looseString,
    conditions: looseString,
    summary: looseString.transform((v) => v ?? ""),
    instructor_note: looseString,
    cases: z
      .array(ruleCaseSchema)
      .catch([])
      .transform((cs) => cs.flatMap((c) => (c.condition ? [{ ...c, condition: c.condition }] : []))),
    sub_theme: looseString,
    applies_if: z
      .array(looseString)
      .catch([])
      .transform((xs) => xs.filter((x): x is string => x !== null)),
  })
  .refine((r) => r.rule_text !== "" || r.article_title !== "", {
    message: "rule_text et article_title tous deux vides",
  });

// ── Garde-fou : contraintes de hauteur RELATIVES ─────────────────────────────
// Certaines règles de hauteur ne fixent pas un plafond absolu mais un ÉCART
// maximal par rapport à une AUTRE référence (« le faîtage ne peut dépasser de
// plus de 4 m la hauteur de la construction autorisée », « supérieure de 2 m à
// l'égout du bâtiment voisin »…). Le LLM aplatit souvent ce « 4 m » en
// value_max=4 ; l'évaluateur comparerait alors un faîtage absolu (≈ 9 m) à 4 m
// → faux « non conforme » systématique sur toute la zone.
//
// Tant que l'évaluation différentielle n'est pas portée (niveaux 2/3), on
// NEUTRALISE le seuil chiffré (value_* → null) : la règle devient qualitative,
// et l'évaluateur la remonte en « à vérifier » plutôt qu'en refus erroné. Le
// chiffre et le sens sont préservés dans instructor_note pour l'instructeur.
//
// Distinction clé tenue par les motifs : « de plus de 4 m LA hauteur » (relatif,
// neutralisé) vs « de plus de 4 m DE hauteur » (absolu, conservé).

// Mot désignant une RÉFÉRENCE de hauteur (et non un nombre) : c'est la présence
// d'un tel objet — « la hauteur autorisée », « le bâtiment voisin », « l'égout »
// — qui distingue le relatif (« de plus de 4 m LA hauteur ») de l'absolu
// (« de plus de 4 m DE hauteur », « au-dessus de 9 m »).
const REF = "(?:hauteur|[ée]gouts?|fa[îi]tages?|constructions?|b[âa]timents?|niveau|cote|acrot[èe]res?)";

// Chaque motif décrit UNE manière de formuler une hauteur relative. On reste
// volontairement précis (la référence doit être un OBJET, jamais un nombre)
// pour ne JAMAIS neutraliser un vrai plafond absolu.
const RELATIVE_HEIGHT_RES: RegExp[] = [
  // « ...de plus de 4 mètres la hauteur / l'égout / la construction voisine... »
  //          └── écart ──┘ └──────────── référence ───────────┘
  new RegExp(`\\bde\\s+plus\\s+de\\s+\\d[\\d.,]*\\s*(?:m\\b|m[èe]tres?\\b)\\s+(?:la\\s+|l['’]\\s*|à\\s+l['’]?\\s*|au\\s+|du\\s+|de\\s+la\\s+)${REF}`, "i"),
  // « ...supérieure de 2 m à l'égout... » (`à` non-word ASCII → on borne par une espace)
  /\bsup[ée]rieure?s?\s+de\s+\d[\d.,]*\s*(?:m\b|m[èe]tres?\b)\s+(?:à|au|aux)\s/i,
  // « ...par rapport à la hauteur autorisée / au bâtiment voisin / à l'alignement... »
  new RegExp(`\\bpar\\s+rapport\\s+[àa]\\s+(?:la\\s+|le\\s+|l['’]\\s*|au\\s+|aux\\s+|du\\s+|des\\s+)?(?:${REF.slice(3, -1)}|alignement|voisin\\w*|existant\\w*|mitoyen\\w*)`, "i"),
  // « ...au-dessus de la hauteur / de l'égout / du bâtiment... » (et NON « au-dessus de 9 m »)
  new RegExp(`\\bau[-\\s]dessus\\s+(?:de\\s+la|de\\s+l['’]|du|des)\\s+${REF}`, "i"),
  // « ...alignée sur les constructions voisines / sur le faîtage voisin... »
  /\balign[ée]e?s?\s+sur\b/i,
  // Mot de hauteur + référence à une construction voisine/mitoyenne/existante dans la même clause.
  new RegExp(`${REF}[^.;]{0,60}(?:constructions?|b[âa]timents?)\\s+(?:voisin\\w*|mitoyen\\w*|contigu\\w*|attenant\\w*|existant\\w*)`, "i"),
];

/** Vrai si le texte décrit une hauteur RELATIVE (écart/référence à une autre construction). */
export function isRelativeHeightConstraint(text: string): boolean {
  return RELATIVE_HEIGHT_RES.some((re) => re.test(text));
}

/**
 * Neutralise le seuil chiffré d'une règle de hauteur RELATIVE pour éviter qu'il
 * soit interprété comme un plafond absolu. No-op si la règle n'est pas une
 * hauteur, ne chiffre rien, ou n'est pas formulée en relatif.
 */
export function neutralizeRelativeHeightRule(rule: StructuredRule): StructuredRule {
  if (rule.topic !== "hauteur") return rule;
  if (rule.value_min == null && rule.value_max == null && rule.value_exact == null) return rule;
  if (!isRelativeHeightConstraint(`${rule.rule_text} ${rule.summary}`)) return rule;

  const extracted = [
    rule.value_min != null ? `min ${rule.value_min}` : null,
    rule.value_max != null ? `max ${rule.value_max}` : null,
    rule.value_exact != null ? `exact ${rule.value_exact}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const note =
    `Hauteur RELATIVE : écart maximal par rapport à une autre référence ` +
    `(hauteur autorisée / égout / construction voisine), et NON un plafond absolu. ` +
    `Valeur extraite : ${extracted} ${rule.unit ?? "m"}. Seuil neutralisé — à apprécier ` +
    `manuellement tant que l'évaluation différentielle n'est pas automatisée.`;

  return {
    ...rule,
    value_min: null,
    value_max: null,
    value_exact: null,
    sub_theme: rule.sub_theme ?? "hauteur_relative",
    instructor_note: rule.instructor_note ? `${rule.instructor_note} — ${note}` : note,
  };
}

// ── Enrichissement : spécification hauteur structurée (niveau 2) ──────────────
// Déduit `height_spec` du texte de la règle, de façon DÉTERMINISTE (pas de LLM).
// Deux familles disjointes :
//   - RELATIVE : la hauteur est un écart → on capte (relative_to, max_delta) et
//     on NE lit PAS de plafond absolu (les nombres sont des deltas, pas des
//     cotes d'égout/faîtage).
//   - ABSOLUE  : on capte les plafonds à l'égout et au faîtage séparément, ce
//     qui résout la conflation « 9 m à l'égout / 12 m au faîtage » réduite à un
//     seul chiffre par l'extraction.

const NUM_UNIT = "(\\d[\\d.,]*)\\s*(?:m\\b|m[èe]tres?\\b)";
// Capture l'écart d'une formulation relative (« de plus de 4 m », « supérieure de 2 m »).
const DELTA_CAPTURE_RE = new RegExp(`(?:de\\s+plus\\s+de|sup[ée]rieure?s?\\s+de)\\s+${NUM_UNIT}`, "i");

function parseFrNumber(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Plafond absolu le plus proche d'un mot de référence (égout/faîtage), dans une
// fenêtre courte pour ne pas rattacher un nombre d'une autre clause. Cherche le
// nombre AVANT puis APRÈS la référence.
function nearestAbsoluteHeight(text: string, refSrc: string): number | null {
  // Fenêtre courte (≤ 14 car.) : « 12 m au faîtage » lie bien, mais le « 9 m »
  // d'une clause d'égout voisine (« 9 m à l'égout et 12 m au faîtage », ~22 car.)
  // ne déborde pas sur le faîtage. Cherche le nombre AVANT puis APRÈS la réf.
  const before = new RegExp(`${NUM_UNIT}[^.;]{0,14}?${refSrc}`, "i");
  const after = new RegExp(`${refSrc}[^.;]{0,14}?${NUM_UNIT}`, "i");
  const m = before.exec(text) ?? after.exec(text);
  return m ? parseFrNumber(m[1]!) : null;
}

// Déduit l'objet de référence d'une contrainte relative depuis le vocabulaire.
function inferRelativeRef(text: string): string {
  if (/(?:construction|hauteur)\s+(?:de\s+la\s+construction\s+)?autoris/i.test(text) || /hauteur\s+autoris/i.test(text))
    return "hauteur_autorisee";
  if (/fa[îi]tage\s+(?:voisin|des\s+constructions?)/i.test(text)) return "faitage_voisin";
  if (/(?:construction|b[âa]timent)s?\s+(?:voisin\w*|mitoyen\w*|contigu\w*|attenant\w*|existant\w*)/i.test(text))
    return "construction_voisine";
  if (/[ée]gout/i.test(text)) return "egout";
  if (/(?:terrain|sol)\s+naturel/i.test(text)) return "sol_naturel";
  return "reference_externe";
}

/**
 * Renseigne `height_spec` sur une règle de hauteur. No-op (rule inchangée) si la
 * règle n'est pas une hauteur ou si rien d'exploitable n'est détecté.
 */
export function enrichHeightSpec(rule: StructuredRule): StructuredRule {
  if (rule.topic !== "hauteur") return rule;
  const text = `${rule.rule_text} ${rule.summary}`;

  let egout: number | null = null;
  let faitage: number | null = null;
  let relative_to: string | null = null;
  let max_delta: number | null = null;

  if (isRelativeHeightConstraint(text)) {
    relative_to = inferRelativeRef(text);
    const m = DELTA_CAPTURE_RE.exec(text);
    if (m) max_delta = parseFrNumber(m[1]!);
  } else {
    egout = nearestAbsoluteHeight(text, "[ée]gout");
    faitage = nearestAbsoluteHeight(text, "fa[îi]tage");
  }

  if (egout == null && faitage == null && relative_to == null && max_delta == null) return rule;
  return { ...rule, height_spec: { egout, faitage, relative_to, max_delta } };
}

/** Injected LLM call: receives a system + user prompt, returns raw text (JSON expected). */
export type LlmFn = (system: string, user: string) => Promise<string>;

const SYSTEM = `Tu es un expert en droit de l'urbanisme français. On te donne le texte des articles d'UNE zone d'un PLU. Tu renvoies UNIQUEMENT un tableau JSON de règles, sans aucun autre texte.

Schéma de chaque règle :
{
  "article_number": number|null,
  "article_title": string,
  "topic": "interdictions|conditions|desserte_voies|desserte_reseaux|terrain_min|recul_voie|recul_limite|recul_batiments|emprise_sol|hauteur|aspect|stationnement|espaces_verts|cos|general",
  "rule_text": string,            // texte fidèle de la règle
  "value_min": number|null,
  "value_max": number|null,       // valeur principale si une seule
  "value_exact": number|null,
  "unit": "m|%|m²|places"|null,
  "conditions": string|null,      // variantes par sous-secteur, exceptions
  "summary": string,              // ≤ 12 mots
  "instructor_note": string|null, // ex: valeur dans un schéma, renvoi à doc externe
  "cases": [ { "condition": string, "value": number|null, "unit": "m|cm|%|m²|places"|null, "kind": "condition|parametre" } ]
}
- "cases" : DISSOCIE chaque valeur de calcul distincte en un cas séparé. "kind" = "condition" (alternatives exclusives : on en applique une, ex: 10 m sens unique / 13 m double sens) ou "parametre" (valeurs cumulatives qui s'appliquent toutes, ex: 15% pleine terre, 50 cm arbustes, 80 cm arbres, 1 arbre/4 places). Sinon [].

Grille R.123-9 (n° article → topic) : 1→interdictions, 2→conditions, 3→desserte_voies, 4→desserte_reseaux, 5→terrain_min (sans objet ALUR), 6→recul_voie, 7→recul_limite, 8→recul_batiments, 9→emprise_sol, 10→hauteur, 11→aspect, 12→stationnement, 13→espaces_verts, 14→cos (sans objet ALUR).

Règles :
- Une règle par article présent. Si "non réglementé"/"sans objet" → garde-la avec value_* null.
- VALEUR PRINCIPALE (value_min/max/exact + unit) = le seuil PRINCIPAL du thème, dans une unité COHÉRENTE (emprise_sol/espaces_verts/cos → %, hauteur/reculs → m, terrain_min → m², stationnement → places). Ne prends PAS "le plus grand nombre". Respecte min ("≥/minimum") vs max ("≤/maximum"). Ne mélange JAMAIS valeur et unité. Les mesures secondaires ou d'autres unités (épaisseurs en cm, ratios…) vont UNIQUEMENT dans "cases". Si rien de cohérent → value_* null.
- topic 'aspect' (article 11) : capture matériaux, couleurs, toitures, menuiseries, clôtures dans rule_text.
- HAUTEUR RELATIVE : si une règle de hauteur se réfère à une AUTRE construction au lieu d'un plafond absolu (« ne peut dépasser DE PLUS DE X m la hauteur autorisée / l'égout », « supérieure de X m à… », « par rapport à la construction voisine », « alignée sur le faîtage voisin », « au-dessus de la hauteur de l'égout »), laisse value_* = null et décris la référence dans instructor_note. Le nombre n'est PAS une hauteur absolue. (« X m DE hauteur », « au-dessus de X m » restent, eux, des seuils absolus → value_max.)
- N'invente AUCUNE valeur : si incertain, value_* = null.${calibrationFewShot()}`;

function buildUserPrompt(zone: { code: string; label: string }, articles: Array<{ number: string; title: string; text: string }>): string {
  const body = articles
    .map((a) => `--- Article ${a.number} : ${a.title} ---\n${a.text}`)
    .join("\n\n");
  return `Zone ${zone.code} — ${zone.label}\n\n${body}`;
}

/**
 * Parse + valide le tableau JSON renvoyé par le LLM.
 * Chaque règle passe par structuredRuleSchema ; les entrées invalides sont
 * écartées une à une (le reste du lot est conservé) et signalées via onIssue.
 */
export function parseRules(
  raw: string,
  onIssue: (msg: string) => void = (msg) => console.warn(`[structurer] ${msg}`),
): StructuredRule[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    onIssue("réponse LLM sans tableau JSON — 0 règle extraite");
    return [];
  }
  let arr: unknown;
  try {
    arr = JSON.parse(match[0]);
  } catch (err) {
    onIssue(`JSON LLM invalide (${err instanceof Error ? err.message : String(err)}) — 0 règle extraite`);
    return [];
  }
  if (!Array.isArray(arr)) {
    onIssue("JSON LLM exploitable mais pas un tableau — 0 règle extraite");
    return [];
  }
  const rules: StructuredRule[] = [];
  arr.forEach((item, i) => {
    const parsed = structuredRuleSchema.safeParse(item);
    if (parsed.success) {
      // enrichHeightSpec d'abord (lit le texte + les valeurs d'origine), puis
      // neutralizeRelativeHeightRule (préserve height_spec via spread).
      rules.push(neutralizeRelativeHeightRule(enrichHeightSpec(parsed.data)));
    } else {
      const detail = parsed.error.issues.map((iss) => `${iss.path.join(".") || "(racine)"} : ${iss.message}`).join(" ; ");
      onIssue(`règle ${i + 1}/${arr.length} rejetée — ${detail}`);
    }
  });
  return rules;
}

/**
 * Structure all zones. Each zone = ONE short LLM call over its article texts.
 * Concurrency-bounded; a failed zone yields an empty rule set (logged by caller).
 */
export async function structureSegments(
  segments: Segment[],
  llm: LlmFn,
  opts: { concurrency?: number; onZone?: (zone: string, count: number) => void } = {},
): Promise<ZoneRules[]> {
  const zones = segments.filter((s) => s.segment_type === "zone");
  const concurrency = opts.concurrency ?? 4;

  const structureOne = async (zone: Segment): Promise<ZoneRules> => {
    const articles = zone.subsections.map((s) => ({ number: s.number, title: s.title, text: s.raw_text }));
    // No articles detected → fall back to the whole zone text as a single block.
    const input = articles.length
      ? buildUserPrompt({ code: zone.segment_code, label: zone.title }, articles)
      : `Zone ${zone.segment_code} — ${zone.title}\n\n${zone.raw_text}`;
    let rules: StructuredRule[] = [];
    try {
      rules = parseRules(await llm(SYSTEM, input));
    } catch (err) {
      console.warn(`[structurer] zone ${zone.segment_code} : appel LLM échoué (${err instanceof Error ? err.message : String(err)})`);
      rules = [];
    }
    // Provenance fine : toutes les règles d'une zone proviennent du segment de
    // cette zone (zone.id = ligne document_segments après --load). On grave
    // l'id du segment + la page si l'adaptateur l'a conservée, et le verbatim
    // (rule_text) comme citation directe.
    const sourcePage = typeof zone.metadata.page === "number" ? zone.metadata.page : null;
    rules = rules.map((r) => ({
      ...r,
      source_segment_id: zone.id,
      source_page: sourcePage,
      source_quote: r.rule_text || null,
    }));
    opts.onZone?.(zone.segment_code, rules.length);
    return {
      zone_code: zone.segment_code,
      zone_label: zone.title,
      zone_type: (zone.metadata.zone_type as string) ?? inferZoneType(zone.segment_code),
      rules,
    };
  };

  const out: ZoneRules[] = [];
  for (let i = 0; i < zones.length; i += concurrency) {
    const batch = zones.slice(i, i + concurrency);
    out.push(...(await Promise.all(batch.map(structureOne))));
  }
  return out;
}

export function inferZoneType(code: string): string {
  if (/^U/i.test(code)) return "U";
  if (/AU/i.test(code)) return "AU";
  if (/^A/i.test(code)) return "A";
  if (/^N/i.test(code)) return "N";
  return "U";
}
