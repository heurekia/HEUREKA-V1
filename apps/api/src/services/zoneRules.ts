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

  const deepest = ordered[0]!;
  return {
    zone: { id: deepest.id, code: deepest.zone_code, label: deepest.zone_label, type: deepest.zone_type },
    matchedChain: ordered.map((z) => z.zone_code),
    rules: merged,
  };
}
