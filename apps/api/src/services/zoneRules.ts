import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "../db.js";
import { zones, zone_regulatory_rules, communes } from "@heureka-v1/db";
import { resolveCommuneZoneIds } from "./communeZones.js";

export type ZoneRow = typeof zones.$inferSelect;
export type RuleRow = typeof zone_regulatory_rules.$inferSelect;

/**
 * Derives the parent zone code of a PLU sector code, by convention :
 *   UBai → UBa → UB
 *   1AUh → 1AU
 *   Ap   → A
 *   UB   → null   (top-level zone, no parent)
 *
 * Heuristic : strip a trailing lowercase letter as long as the remaining code
 * is still ≥ 2 chars. Mixed-case secteurs ("NL", "NI" in some PLUs) are NOT
 * handled — those rare cases must declare their parent_zone_code explicitly.
 */
export function deriveParentZoneCode(code: string): string | null {
  if (code.length < 2) return null;
  const last = code[code.length - 1] ?? "";
  if (!/[a-z]/.test(last)) return null;
  const parent = code.slice(0, -1);
  return parent.length >= 1 ? parent : null;
}

/**
 * Walks the ancestor chain of a zone code, deepest first :
 *   walkZoneAncestry("UBai") → ["UBai", "UBa", "UB"]
 *   walkZoneAncestry("UB")   → ["UB"]
 *
 * Cuts off at top-level (no further parent) or after 5 hops (safety).
 */
export function walkZoneAncestry(code: string): string[] {
  const chain = [code];
  let cur = code;
  for (let i = 0; i < 5; i++) {
    const parent = deriveParentZoneCode(cur);
    if (!parent) break;
    chain.push(parent);
    cur = parent;
  }
  return chain;
}

// Key used to dedupe rules across ancestor zones : same article + topic +
// sub_theme → the most specific (deepest) ancestor wins.
function ruleDedupeKey(r: Pick<RuleRow, "article_number" | "topic" | "sub_theme">): string {
  return `${r.article_number ?? "x"}|${r.topic}|${r.sub_theme ?? ""}`;
}

/**
 * Pure merge function : given rules from each ancestor zone (deepest first),
 * returns one rule per (article_number, topic, sub_theme), keeping the deepest.
 * Exposed for tests.
 */
export function mergeRulesDeepestWins<R extends Pick<RuleRow, "article_number" | "topic" | "sub_theme">>(
  rulesByDepth: R[][],
): R[] {
  const seen = new Map<string, R>();
  for (const rules of rulesByDepth) {
    for (const r of rules) {
      const key = ruleDedupeKey(r);
      if (!seen.has(key)) seen.set(key, r);
    }
  }
  return Array.from(seen.values());
}

// ── Sibling sector text scrubbing ────────────────────────────────────────────
//
// PLUs commonly describe per-sector variants inside the parent-zone rule text :
//   « Hauteur max : 9 m. Toutefois, en UBa : 12 m ; en UBai : 7 m. »
//
// For a parcel located in UBb (ancestry = [UBb, UB]), the mentions of UBa /
// UBai are irrelevant — they pollute the citizen popup with rules about
// neighbouring sectors. This helper strips sentences that mention ONLY sibling
// sector codes, while keeping anything that also references the ancestry.

/**
 * Removes from `text` the sentences that mention exclusively sibling sectors
 * (sub-sectors of the parent zone that are NOT in the parcel's ancestry).
 * Returns the cleaned text, or the original if nothing was filtered.
 *
 * The parent code must be ≥ 2 chars to avoid false positives ("U[a-z]+" would
 * eat ordinary French words). For single-letter parent zones (A, N) we don't
 * filter — those rarely have lowercase-suffix siblings anyway.
 */
// Decides whether a segment is a CLEAR declaration about a sibling sector
// (and therefore safely droppable). Conservative on purpose : a segment that
// only mentions a sibling but ALSO carries information not solely about that
// sibling (e.g. « 9 m sauf UBa 12 m » where 9 m is the generic value) is
// NOT considered sibling-only and is kept. This avoids omitting useful data.
//
// Drops only segments matching the « En <Sibling> : value » canonical form
// (with common French lead-ins : Dans, Pour, Toutefois en, En secteur, …,
// optional bullet prefix). The sibling code must appear AT THE START of the
// segment ; mentions buried mid-sentence are never enough to drop.
function isSiblingOnlyDeclaration(segment: string, parent: string, ancestryCodes: string[]): boolean {
  const trimmed = segment.trim();
  if (!trimmed) return false;
  const pattern = new RegExp(
    `^(?:[-•*]\\s*)?` +                                                   // optional bullet
    `(?:toutefois,?\\s+|cependant,?\\s+|néanmoins,?\\s+)?` +              // optional concessive
    `(?:en\\s+(?:secteur\\s+)?|dans\\s+(?:le\\s+)?(?:secteur\\s+)?|pour\\s+(?:le\\s+)?(?:secteur\\s+)?|secteur\\s+)?` +
    `(${parent}[a-z]+)\\b\\s*[:,-]\\s*.+$`,                              // <sibling> : <rest>
    "i",
  );
  const m = trimmed.match(pattern);
  if (!m) return false;
  const code = m[1];
  return !!code && !ancestryCodes.includes(code);
}

export function stripSiblingSecteurMentions(
  text: string | null | undefined,
  ancestryCodes: string[],
): string | null {
  if (!text) return null;
  // The top-most ancestor is the parent zone (e.g. "UB" for ancestry [UBb, UB]).
  const parent = ancestryCodes[ancestryCodes.length - 1];
  if (!parent || parent.length < 2) return text;
  // No sub-sector context → keep the original text intact. Sub-sector mentions
  // are the citizen's only hint about which variant applies to them when the
  // GPU layer only reports the parent zone code.
  const deepest = ancestryCodes[0] ?? "";
  if (deepest.length <= parent.length) return text;

  // Split on sentence boundaries and discard separators ; we rejoin with ". "
  // which avoids the double-dot artefact ("9m.. UBb: 10m") that occurred when
  // we preserved the original separators around dropped segments.
  const segments = text.split(/[.;\n]+\s*/).map((s) => s.trim()).filter(Boolean);
  const kept = segments.filter((seg) => !isSiblingOnlyDeclaration(seg, parent, ancestryCodes));

  if (kept.length === segments.length) return text;  // nothing dropped
  if (kept.length === 0) return null;
  // Restore a trailing period if the original ended with one
  const trailing = /[.;]\s*$/.test(text) ? "." : "";
  return kept.join(". ") + trailing;
}

/**
 * Applies the parcel sector context to a single rule by stripping sibling-
 * sector mentions from every citizen-facing or condition-bearing text field.
 * The technical `rule_text` is preserved as-is for instructor traceability.
 */
// Only overwrite the field if it was present on the input rule — keeps the
// shape predictable for callers (no spurious nulls appearing on partial rules).
function scrubField<T extends Record<string, unknown>>(
  out: T, src: T, key: keyof T, codes: string[],
): void {
  if (!(key in src)) return;
  (out as Record<string, unknown>)[key as string] = stripSiblingSecteurMentions(
    (src[key] as string | null | undefined) ?? null,
    codes,
  );
}

// Scrubbing is RESTRICTED to citizen-facing fields. The technical fields
// (rule_text, summary, conditions, exceptions) keep the full original wording
// so the instructeur sees the complete regulatory context — including any
// sibling-sector mentions that might be useful for cross-checking.
export function applyParcelSecteurContext<R extends {
  citizen_summary?: string | null;
  citizen_title?: string | null;
}>(rule: R, ancestryCodes: string[]): R {
  const out: R = { ...rule };
  scrubField(out, rule, "citizen_summary", ancestryCodes);
  scrubField(out, rule, "citizen_title", ancestryCodes);
  return out;
}

// ── Sibling-only rule detection ──────────────────────────────────────────────
//
// PLU regulations often store one rule per sub-sector under the parent zone
// (e.g. all three espaces_verts variants UBa/UBd/UBb/UBc live as separate
// rules under the UB zone, distinguished only by their citizen_title or
// sub_theme). For a parcel in UBb, the « (UBa) » rule must be DROPPED — it
// applies to a different sector and would pollute both the popup and the
// constructibility computation.

// Builds the haystack used to evaluate a rule's sector affinity. We include
// every field where the ingestion may have placed the sector code : labels
// (citizen_title, sub_theme), summaries (summary, citizen_summary) and the
// raw rule text. Inspecting rule_text matters because the ingestion prompt
// often produces a generic citizen_title (« Hauteur ») even when the rule
// explicitly applies to sub-sectors (« Dans les secteurs UBa, UBb, UBc … »).
function ruleSectorHaystack<R extends {
  citizen_title?: string | null;
  sub_theme?: string | null;
  citizen_summary?: string | null;
  summary?: string | null;
  rule_text?: string | null;
}>(rule: R): string {
  return [rule.citizen_title, rule.sub_theme, rule.citizen_summary, rule.summary, rule.rule_text]
    .filter((s): s is string => !!s)
    .join(" ");
}

/**
 * Returns true when the rule's text fields mention exclusively sibling
 * sectors — none of the parcel's ancestry codes (deepest sector OR the
 * parent zone) appear. Conservative on purpose : a rule with no sector
 * mention at all (purely generic) is kept ; so is a rule mentioning both
 * the parent and a sibling (e.g. « UB/UBd »).
 */
export function isRuleSiblingOnly<R extends {
  citizen_title?: string | null;
  sub_theme?: string | null;
  citizen_summary?: string | null;
  summary?: string | null;
  rule_text?: string | null;
}>(rule: R, ancestryCodes: string[]): boolean {
  const parent = ancestryCodes[ancestryCodes.length - 1];
  if (!parent || parent.length < 2) return false;

  // No sub-sector context (ancestry is just the parent zone) → keep every
  // sub-rule, including those that describe variants per sub-secteur. They
  // are precisely what helps the citizen identify which sub-secteur applies
  // to them when the GPU layer only exposes the parent zone code.
  const deepest = ancestryCodes[0] ?? "";
  if (deepest.length <= parent.length) return false;

  const text = ruleSectorHaystack(rule);
  if (!text) return false;

  // Sub-sector tokens : Parent + lowercase suffix (UBa, UBai, …).
  const subSectorRe = new RegExp(`\\b${parent}[a-z]+\\b`, "g");
  const subMatches = text.match(subSectorRe) ?? [];
  if (subMatches.length === 0) return false; // no sector mention → generic rule, keep

  const hasAncestrySub = subMatches.some((m) => ancestryCodes.includes(m));
  if (hasAncestrySub) return false; // mentions our sector or an ancestor — keep

  // Bare parent code (« UB » without lowercase suffix) means the rule is
  // generic for the whole parent zone — keep.
  const parentRe = new RegExp(`\\b${parent}\\b(?![a-z])`);
  if (parentRe.test(text)) return false;

  return true; // every sector mention concerns a sibling → drop
}

/**
 * Picks the rule that applies most specifically to the parcel's own sector
 * among candidates sharing the same topic. The selection prefers a rule
 * whose citizen_title, sub_theme, summary or rule_text explicitly names the
 * parcel's deepest sector (e.g. « UBb »), then falls back to one mentioning
 * the parent zone, and finally to the first candidate.
 *
 * Scanning rule_text is critical : the LLM ingestion often produces a
 * generic citizen_title (« Hauteur ») even when the rule body explicitly
 * applies to specific sub-sectors (« Dans les secteurs UBa, UBb, UBc … »).
 * Without rule_text inspection, the more permissive parent-zone rule wins
 * silently — and the citizen sees the wrong limit.
 */
export function pickMostSpecificRule<R extends {
  topic?: string | null;
  citizen_title?: string | null;
  sub_theme?: string | null;
  citizen_summary?: string | null;
  summary?: string | null;
  rule_text?: string | null;
}>(rules: R[], topic: string, ancestryCodes: string[]): R | null {
  const candidates = rules.filter((r) => r.topic === topic);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // Walk ancestry deepest first ; the first rule mentioning that code wins.
  for (const code of ancestryCodes) {
    const re = new RegExp(`\\b${code}\\b(?![a-z])`);
    const match = candidates.find((r) => re.test(ruleSectorHaystack(r)));
    if (match) return match;
  }
  return candidates[0]!;
}

/**
 * Résout le code de zone faisant foi pour un dossier à partir de son
 * `metadata`, par ordre de fiabilité décroissante :
 *   1. zone GÉOLOCALISÉE par l'analyse parcellaire (parcel_analysis) —
 *      rafraîchie à chaque ouverture de l'onglet Parcelle, donc la plus fiable ;
 *   2. metadata.zone — snapshot figé au dépôt par le wizard citoyen ;
 *   3. metadata.zone_plu — clé héritée, historiquement jamais écrite.
 *
 * But : garantir que TOUS les consommateurs (conformité, documentation,
 * constructibilité) appliquent les règles de la MÊME zone — celle réellement
 * identifiée pour la parcelle.
 */
export function resolveDossierZoneCode(meta: Record<string, unknown>): string | null {
  const pa = meta.parcel_analysis as
    | { plu_zone?: { zone_code?: unknown }; db_zone?: { code?: unknown } }
    | undefined;
  const fromAnalysis =
    typeof pa?.plu_zone?.zone_code === "string" && pa.plu_zone.zone_code.trim()
      ? pa.plu_zone.zone_code.trim()
      : typeof pa?.db_zone?.code === "string" && pa.db_zone.code.trim()
        ? pa.db_zone.code.trim()
        : null;
  if (fromAnalysis) return fromAnalysis;
  if (typeof meta.zone === "string" && meta.zone.trim()) return meta.zone.trim();
  if (typeof meta.zone_plu === "string" && meta.zone_plu.trim()) return meta.zone_plu.trim();
  return null;
}

export interface LoadedZoneRules {
  // The zone the parcel sits in (the deepest match found in DB)
  zone: { id: string; code: string; label: string | null; type: string | null } | null;
  // The list of zones whose rules were merged ; ex. ["UBai","UB"] when UBa
  // wasn't found in DB. Useful for warnings and UI traceability.
  matchedChain: string[];
  rules: RuleRow[];
}

/**
 * Loads the rules applicable to a parcel located in `zoneCode`, with parent
 * inheritance : rules from the sector AND every ancestor zone present in DB
 * are merged. The most specific (deepest) rule wins per (article, topic).
 *
 * This replaces the previous "first match wins" logic which silently dropped
 * inherited rules — e.g. parcel in UBa only saw UBa's specific overrides,
 * never the bulk of UB's rules.
 */
export async function loadZoneRulesWithInheritance(
  zoneCode: string,
  options: { communeNom?: string; codeInsee?: string },
): Promise<LoadedZoneRules> {
  // 1. Resolve commune
  let communeId: string | null = null;
  if (options.codeInsee) {
    const [row] = await db
      .select({ id: communes.id })
      .from(communes)
      .where(eq(communes.insee_code, options.codeInsee))
      .limit(1);
    communeId = row?.id ?? null;
  }
  if (!communeId && options.communeNom) {
    // Match exact case-insensitive, sinon une commune comme "Tours" matcherait
    // "Joué-lès-Tours" / "Saint-Pierre-des-Corps" et la recherche de zones
    // retournerait des règles qui ne concernent pas cette commune.
    const [row] = await db
      .select({ id: communes.id })
      .from(communes)
      .where(ilike(communes.name, options.communeNom))
      .limit(1);
    communeId = row?.id ?? null;
  }

  // 2. Look up every ancestor zone AND every sibling sub-zone under the same
  //    parent. Sibling zones often host rules that apply to multiple secteurs
  //    (a rule « Hauteur UBa/UBb/UBc 8 m » may be stored under UBa alone).
  //    isRuleSiblingOnly filters them downstream so only the ones mentioning
  //    our ancestry survive — but they MUST be loaded for that filter to see
  //    them in the first place.
  const ancestry = walkZoneAncestry(zoneCode);
  const parent = ancestry[ancestry.length - 1] ?? zoneCode;
  // Prefix LIKE works because sub-sector codes are formed as Parent + lowercase
  // suffix (UB → UBa, UBai, UBb, …). For very short parents (« A », « N »)
  // skipping the prefix scan avoids over-fetching unrelated zones.
  const useSiblingScan = parent.length >= 2;
  const codeScope = useSiblingScan
    ? or(inArray(zones.zone_code, ancestry), ilike(zones.zone_code, `${parent}%`))
    : inArray(zones.zone_code, ancestry);

  // Périmètre commune PLUi-aware : zones communales propres + zones partagées
  // des PLUi rattachés (cf. resolveCommuneZoneIds). Sans commune résolue, on
  // ne restreint pas (comportement historique).
  let where = codeScope;
  if (communeId) {
    const communeZoneIds = await resolveCommuneZoneIds(communeId);
    // Commune résolue mais sans aucune zone applicable → rien à charger.
    if (communeZoneIds.length === 0) {
      return { zone: null, matchedChain: [], rules: [] };
    }
    where = and(codeScope, inArray(zones.id, communeZoneIds));
  }
  const foundZones = await db.select().from(zones).where(where);

  if (foundZones.length === 0) {
    return { zone: null, matchedChain: [], rules: [] };
  }

  // 3. Re-order found zones : ancestry first (deepest first), then siblings
  //    alphabetically. The ordering matters for mergeRulesDeepestWins, which
  //    keeps the first occurrence per (article, topic, sub_theme) — ancestry
  //    rules thus win on collision, sibling-only rules are added only when
  //    they bring new keys.
  const byCode = new Map(foundZones.map((z) => [z.zone_code, z]));
  const ordered: ZoneRow[] = [];
  const seen = new Set<string>();
  for (const code of ancestry) {
    const z = byCode.get(code);
    if (z) { ordered.push(z); seen.add(code); }
  }
  const siblings = foundZones
    .filter((z) => !seen.has(z.zone_code))
    .sort((a, b) => a.zone_code.localeCompare(b.zone_code));
  ordered.push(...siblings);

  // 4. Load rules of every matched zone in one query, then group by zone
  const allRules = await db
    .select()
    .from(zone_regulatory_rules)
    .where(and(
      inArray(zone_regulatory_rules.zone_id, ordered.map((z) => z.id)),
      eq(zone_regulatory_rules.validation_status, "valide"),
    ));
  const rulesByZone = new Map<string, RuleRow[]>();
  for (const r of allRules) {
    const arr = rulesByZone.get(r.zone_id) ?? [];
    arr.push(r);
    rulesByZone.set(r.zone_id, arr);
  }
  const rulesByDepth = ordered.map((z) => rulesByZone.get(z.id) ?? []);

  // 5. Merge — deepest wins per (article_number, topic, sub_theme)
  const merged = mergeRulesDeepestWins(rulesByDepth)
    .sort((a, b) => (a.article_number ?? 0) - (b.article_number ?? 0));

  // 6. Drop rules whose labels apply only to sibling sectors. The ancestry
  //    (NOT the sibling-extended list) is what defines what's « in scope »
  //    for the parcel : a rule mentioning only UBd is dropped for a UBb
  //    parcel, even if it was loaded from the UBd zone.
  const ancestryCodes = ancestry.filter((c) => byCode.has(c));
  const relevant = merged.filter((r) => !isRuleSiblingOnly(r, ancestryCodes));

  // 7. Scrub sibling-sector mentions from the surviving rules so the citizen
  //    popup only sees content relevant to the parcel's own sector ancestry.
  const scrubbed = relevant.map((r) => applyParcelSecteurContext(r, ancestryCodes));

  // Prefer the deepest matched ancestry zone as the returned `zone` ; fall
  // back to the first available (which may be a sibling) so the response
  // remains non-empty for the rare case where only sibling zones host rules.
  const deepest = ordered.find((z) => ancestryCodes.includes(z.zone_code)) ?? ordered[0]!;
  return {
    zone: { id: deepest.id, code: deepest.zone_code, label: deepest.zone_label, type: deepest.zone_type },
    matchedChain: ancestryCodes,
    rules: scrubbed,
  };
}
