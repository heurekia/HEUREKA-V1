/**
 * Eval harness — comparaison golden vs sortie réelle du pipeline.
 *
 * Pures fonctions, sans I/O : faciles à tester, faciles à raisonner.
 * Toutes les métriques sont des micro-F1 standards (TP/FP/FN classiques).
 */
import type { Segment } from "../adapters/interface.ts";
import type {
  ArticleDiff,
  EvalScores,
  GoldenExpected,
  GoldenTolerances,
  ZoneDiff,
} from "./types.ts";

export function scores(tp: number, fp: number, fn: number): EvalScores {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

export function diffZones(segments: Segment[], expected: string[]): ZoneDiff {
  const found = segments.filter((s) => s.segment_type === "zone").map((s) => s.segment_code);
  const foundSet = new Set(found);
  const expectedSet = new Set(expected);
  const missing = expected.filter((z) => !foundSet.has(z));
  const spurious = found.filter((z) => !expectedSet.has(z));
  const tp = expected.length - missing.length;
  return { found, expected, missing, spurious, scores: scores(tp, spurious.length, missing.length) };
}

/**
 * Extrait le numéro d'article depuis un segment_code type "UA_ART_7" ou
 * "1AU_ART_12". Retourne null si pas un article reconnu.
 */
function articleNumber(code: string): { zone: string; num: number } | null {
  const m = /^(.+)_ART_(\d+)$/.exec(code);
  if (!m) return null;
  return { zone: m[1]!, num: parseInt(m[2]!, 10) };
}

export function diffArticles(
  segments: Segment[],
  expectedPerZone: Record<string, number[]>,
): ArticleDiff[] {
  // Index : zone -> numéros d'articles trouvés
  const foundByZone = new Map<string, Set<number>>();
  for (const seg of segments) {
    if (seg.segment_type !== "article") continue;
    const parsed = articleNumber(seg.segment_code);
    if (!parsed) continue;
    if (!foundByZone.has(parsed.zone)) foundByZone.set(parsed.zone, new Set());
    foundByZone.get(parsed.zone)!.add(parsed.num);
  }

  const diffs: ArticleDiff[] = [];
  for (const [zone, expected] of Object.entries(expectedPerZone)) {
    const found = Array.from(foundByZone.get(zone) ?? []).sort((a, b) => a - b);
    const foundSet = new Set(found);
    const expectedSet = new Set(expected);
    const missing = expected.filter((n) => !foundSet.has(n));
    const spurious = found.filter((n) => !expectedSet.has(n));
    const tp = expected.length - missing.length;
    diffs.push({
      zone,
      found,
      expected,
      missing,
      spurious,
      scores: scores(tp, spurious.length, missing.length),
    });
  }
  return diffs;
}

/**
 * Synthèse "réussi / échoué" en fonction des tolérances de la fixture.
 * Retourne aussi la liste des raisons d'échec (vide si passed).
 */
export function evaluatePass(
  zones: ZoneDiff,
  articles: ArticleDiff[],
  tolerances: GoldenTolerances | undefined,
): { passed: boolean; reasons: string[] } {
  const t = tolerances ?? {};
  const reasons: string[] = [];

  const extraAllowed = t.extra_zones_allowed ?? 0;
  const missingAllowed = t.missing_zones_allowed ?? 0;
  if (zones.spurious.length > extraAllowed) {
    reasons.push(
      `Zones détectées en trop (${zones.spurious.length} > ${extraAllowed}) : ${zones.spurious.join(", ")}`,
    );
  }
  if (zones.missing.length > missingAllowed) {
    reasons.push(
      `Zones manquantes (${zones.missing.length} > ${missingAllowed}) : ${zones.missing.join(", ")}`,
    );
  }

  if (t.min_zone_f1 !== undefined && zones.scores.f1 < t.min_zone_f1) {
    reasons.push(`F1 zones ${zones.scores.f1.toFixed(2)} < seuil ${t.min_zone_f1}`);
  }
  if (t.min_article_f1 !== undefined && articles.length > 0) {
    const macroF1 = articles.reduce((s, a) => s + a.scores.f1, 0) / articles.length;
    if (macroF1 < t.min_article_f1) {
      reasons.push(`F1 articles ${macroF1.toFixed(2)} < seuil ${t.min_article_f1}`);
    }
  }

  return { passed: reasons.length === 0, reasons };
}

/**
 * Validation rapide qu'une fixture est cohérente. Ne lit pas le PDF, juste les
 * champs : on attrape vite les fautes de frappe sur les codes zones.
 */
export function validateGoldenShape(expected: GoldenExpected): string[] {
  const issues: string[] = [];
  if (!Array.isArray(expected.zones) || expected.zones.length === 0) {
    issues.push("expected.zones doit contenir au moins une zone");
  }
  if (expected.articles_per_zone) {
    for (const zone of Object.keys(expected.articles_per_zone)) {
      if (!expected.zones.includes(zone)) {
        issues.push(`articles_per_zone référence la zone "${zone}" qui n'est pas dans expected.zones`);
      }
    }
  }
  return issues;
}
