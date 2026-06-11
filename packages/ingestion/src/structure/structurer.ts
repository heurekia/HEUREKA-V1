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
- N'invente AUCUNE valeur : si incertain, value_* = null.`;

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
      rules.push(parsed.data);
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
