/**
 * "Agent PLU" — structuration des règles par article.
 *
 * Après le découpage DÉTERMINISTE (segmenter), on n'envoie plus le PDF à un LLM :
 * on lui donne le TEXTE COURT des articles d'une zone et il renvoie des règles
 * structurées. Court => rapide, pas de limite de pages, pas de rate-limit.
 *
 * Le LLM est injecté (LlmFn) → cœur testable sans réseau.
 */
import type { Segment } from "../adapters/interface.ts";

export const RULE_TOPICS = [
  "interdictions", "conditions", "desserte_voies", "desserte_reseaux", "terrain_min",
  "recul_voie", "recul_limite", "recul_batiments", "emprise_sol", "hauteur", "aspect",
  "stationnement", "espaces_verts", "cos", "destinations", "general",
] as const;
export type RuleTopic = (typeof RULE_TOPICS)[number];

export interface RuleCase {
  condition: string;
  value: number | null;
  unit: string | null;
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
}

export interface ZoneRules {
  zone_code: string;
  zone_label: string;
  zone_type: string;
  rules: StructuredRule[];
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
  "cases": [ { "condition": string, "value": number|null, "unit": "m|%|m²|places"|null } ]
}
- "cases" : si la règle a PLUSIEURS valeurs selon une condition (ex: "10 m si voie à sens unique ; 13 m si double sens", ou selon secteur), liste chaque cas. Sinon [].

Grille R.123-9 (n° article → topic) : 1→interdictions, 2→conditions, 3→desserte_voies, 4→desserte_reseaux, 5→terrain_min (sans objet ALUR), 6→recul_voie, 7→recul_limite, 8→recul_batiments, 9→emprise_sol, 10→hauteur, 11→aspect, 12→stationnement, 13→espaces_verts, 14→cos (sans objet ALUR).

Règles :
- Une règle par article présent. Si "non réglementé"/"sans objet" → garde-la avec value_* null.
- topic 'aspect' (article 11) : capture matériaux, couleurs, toitures, menuiseries, clôtures dans rule_text.
- N'invente AUCUNE valeur : si incertain, value_* = null.`;

function buildUserPrompt(zone: { code: string; label: string }, articles: Array<{ number: string; title: string; text: string }>): string {
  const body = articles
    .map((a) => `--- Article ${a.number} : ${a.title} ---\n${a.text}`)
    .join("\n\n");
  return `Zone ${zone.code} — ${zone.label}\n\n${body}`;
}

/** Parse the LLM's JSON array defensively. */
export function parseRules(raw: string): StructuredRule[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  return arr
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      article_number: num(r.article_number),
      article_title: str(r.article_title) ?? "",
      topic: str(r.topic) ?? "general",
      rule_text: str(r.rule_text) ?? "",
      value_min: num(r.value_min),
      value_max: num(r.value_max),
      value_exact: num(r.value_exact),
      unit: str(r.unit),
      conditions: str(r.conditions),
      summary: str(r.summary) ?? "",
      instructor_note: str(r.instructor_note),
      cases: Array.isArray(r.cases)
        ? (r.cases as unknown[])
            .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
            .map((c) => ({ condition: str(c.condition) ?? "", value: num(c.value), unit: str(c.unit) }))
            .filter((c) => c.condition)
        : [],
    }))
    .filter((r) => r.rule_text || r.article_title);
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
    } catch {
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
