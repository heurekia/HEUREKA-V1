import { and, eq, ilike, inArray } from "drizzle-orm";
import { db } from "../db.js";
import { zones, zone_regulatory_rules, communes } from "@heureka-v1/db";

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
    const [row] = await db
      .select({ id: communes.id })
      .from(communes)
      .where(ilike(communes.name, `%${options.communeNom}%`))
      .limit(1);
    communeId = row?.id ?? null;
  }

  // 2. Look up every ancestor zone in one query
  const ancestry = walkZoneAncestry(zoneCode);
  const where = communeId
    ? and(inArray(zones.zone_code, ancestry), eq(zones.commune_id, communeId))
    : inArray(zones.zone_code, ancestry);
  const foundZones = await db.select().from(zones).where(where);

  if (foundZones.length === 0) {
    return { zone: null, matchedChain: [], rules: [] };
  }

  // 3. Re-order found zones by ancestry depth (deepest first)
  const byCode = new Map(foundZones.map((z) => [z.zone_code, z]));
  const ordered: ZoneRow[] = [];
  for (const code of ancestry) {
    const z = byCode.get(code);
    if (z) ordered.push(z);
  }

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

  // 6. Scrub sibling-sector mentions from the merged rules so the citizen
  //    popup only sees content relevant to the parcel's own sector ancestry.
  const ancestryCodes = ordered.map((z) => z.zone_code);
  const scrubbed = merged.map((r) => applyParcelSecteurContext(r, ancestryCodes));

  const deepest = ordered[0]!;
  return {
    zone: { id: deepest.id, code: deepest.zone_code, label: deepest.zone_label, type: deepest.zone_type },
    matchedChain: ancestryCodes,
    rules: scrubbed,
  };
}
