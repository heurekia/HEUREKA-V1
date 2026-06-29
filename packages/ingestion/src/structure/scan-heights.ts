/**
 * Scanner d'interprétation des règles de HAUTEUR.
 *
 * Objectif : MESURER, sur un corpus de règles déjà ingérées, combien de règles
 * de hauteur relèvent d'une subtilité que le système interprète mal (ou pas),
 * et LISTER les formulations réelles à traiter. C'est l'outil de priorisation
 * avant d'investir dans l'évaluation différentielle (niveaux 2/3).
 *
 * Usage :
 *   tsx src/structure/scan-heights.ts <fichier.json> [autre.json ...]
 *
 * Formats acceptés (auto-détectés) :
 *   - PLU canonique          : { zones: [ { rules: [...] } ] }
 *   - ZoneRules[] / { rules } : { rules: [...] } ou [ { rules: [...] } ]
 *   - Dump de règles         : [ { topic, rule_text, value_max, ... }, ... ]
 *
 * Le cœur (classifyHeightRule / scanHeightRules) est pur et testé hors I/O.
 */
import { isRelativeHeightConstraint } from "./structurer.ts";

// Forme minimale qu'on lit d'une règle, quel que soit le format source.
export interface ScannableRule {
  topic?: string | null;
  rule_text?: string | null;
  summary?: string | null;
  value_min?: number | null;
  value_max?: number | null;
  value_exact?: number | null;
  unit?: string | null;
  sub_theme?: string | null;
}

export type HeightCategory =
  // Relatif déjà capté par le garde-fou niveau 1 (seuil neutralisé) — impact
  // DÉJÀ mitigé. Sert à mesurer la part de hauteurs concernées.
  | "relative_guarded"
  // Formulation relative probable que le garde-fou NE capte PAS encore, alors
  // qu'un seuil chiffré subsiste → faux refus potentiel. À couvrir en priorité.
  | "relative_suspect"
  // Article qui mentionne À LA FOIS égout et faîtage : deux seuils distincts
  // souvent réduits à un seul chiffre par l'extraction (niveau 2).
  | "egout_faitage_conflation"
  // Hauteur dépendante d'un datum altimétrique non soustrait (NGF).
  | "ngf"
  // Hauteur comptée depuis le terrain naturel / point le plus bas ou haut.
  | "terrain_naturel"
  // Plafond absolu sans subtilité détectée.
  | "absolute_ok";

export interface HeightClassification {
  category: HeightCategory;
  reason: string;
}

const SUSPECT_RELATIVE_RES: RegExp[] = [
  /par\s+rapport\s+[àa]/i,
  /au[-\s]dessus\s+(?:de|du|des)/i,
  /au[-\s]del[àa]\s+(?:de|du|des)/i,
  /compt[ée]e?s?\s+(?:[àa]\s+partir|depuis)/i,
  /(?:construction|b[âa]timent)s?\s+(?:voisin|mitoyen|contigu|attenant)/i,
  /[àa]\s+l['’]alignement/i,
];
const EGOUT_RE = /[ée]gout/i;
const FAITAGE_RE = /fa[îi]tage/i;
const TERRAIN_NATUREL_RE = /(?:terrain|sol)\s+naturel|point\s+le\s+plus\s+(?:bas|haut)/i;
const NGF_RE = /\bN\.?G\.?F\b/i;

function hasNumericThreshold(r: ScannableRule): boolean {
  return r.value_min != null || r.value_max != null || r.value_exact != null;
}

/** Classe UNE règle de hauteur. Suppose topic === "hauteur" (sinon "absolute_ok"). */
export function classifyHeightRule(r: ScannableRule): HeightClassification {
  const text = `${r.rule_text ?? ""} ${r.summary ?? ""}`;
  const numeric = hasNumericThreshold(r);

  // 1) Relatif déjà neutralisé par le garde-fou (le seuil a pu être mis à null,
  //    on ne gate donc PAS sur la présence d'un chiffre ici).
  if (isRelativeHeightConstraint(text)) {
    return { category: "relative_guarded", reason: "formulation relative captée par le garde-fou niveau 1" };
  }
  // 2) Relatif probable NON capté, avec un seuil chiffré encore présent.
  if (numeric) {
    const hit = SUSPECT_RELATIVE_RES.find((re) => re.test(text));
    if (hit) {
      return { category: "relative_suspect", reason: `indice relatif non couvert : ${hit.source}` };
    }
  }
  // 3) Égout ET faîtage cités ensemble → deux seuils possibles.
  if (EGOUT_RE.test(text) && FAITAGE_RE.test(text)) {
    return { category: "egout_faitage_conflation", reason: "égout et faîtage cités ensemble (deux seuils possibles)" };
  }
  // 4) NGF (datum altimétrique).
  if (NGF_RE.test(text) || NGF_RE.test(r.unit ?? "")) {
    return { category: "ngf", reason: "cote NGF — datum altimétrique non soustrait" };
  }
  // 5) Terrain naturel / point le plus bas-haut.
  if (TERRAIN_NATUREL_RE.test(text)) {
    return { category: "terrain_naturel", reason: "hauteur comptée depuis le terrain naturel / un point de référence" };
  }
  return { category: "absolute_ok", reason: "plafond absolu, aucune subtilité détectée" };
}

export interface ScanExample {
  category: HeightCategory;
  reason: string;
  rule_text: string;
  value_max: number | null | undefined;
  unit: string | null | undefined;
}

export interface ScanReport {
  total_rules: number;
  height_rules: number;
  counts: Record<HeightCategory, number>;
  examples: ScanExample[];
}

const ALL_CATEGORIES: HeightCategory[] = [
  "relative_guarded",
  "relative_suspect",
  "egout_faitage_conflation",
  "ngf",
  "terrain_naturel",
  "absolute_ok",
];

/** Scanne un lot de règles (déjà aplaties) et agrège un rapport. */
export function scanHeightRules(rules: ScannableRule[], examplesPerCategory = 3): ScanReport {
  const counts = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0])) as Record<HeightCategory, number>;
  const examples: ScanExample[] = [];
  const seenPerCat = new Map<HeightCategory, number>();
  let heightRules = 0;

  for (const r of rules) {
    if ((r.topic ?? "") !== "hauteur") continue;
    heightRules++;
    const { category, reason } = classifyHeightRule(r);
    counts[category]++;
    const seen = seenPerCat.get(category) ?? 0;
    if (category !== "absolute_ok" && seen < examplesPerCategory) {
      seenPerCat.set(category, seen + 1);
      examples.push({
        category,
        reason,
        rule_text: (r.rule_text ?? "").slice(0, 240),
        value_max: r.value_max,
        unit: r.unit,
      });
    }
  }

  return { total_rules: rules.length, height_rules: heightRules, counts, examples };
}

// ── Normalisation des formats d'entrée ───────────────────────────────────────

/** Aplatit n'importe quel format source connu en une liste de règles. */
export function flattenRules(input: unknown): ScannableRule[] {
  const out: ScannableRule[] = [];
  const pushFromContainer = (c: unknown): void => {
    if (!c || typeof c !== "object") return;
    const obj = c as Record<string, unknown>;
    if (Array.isArray(obj.zones)) {
      for (const z of obj.zones) {
        const zr = (z as Record<string, unknown>)?.rules;
        if (Array.isArray(zr)) out.push(...(zr as ScannableRule[]));
      }
    } else if (Array.isArray(obj.rules)) {
      out.push(...(obj.rules as ScannableRule[]));
    } else if ("topic" in obj || "rule_text" in obj) {
      out.push(obj as ScannableRule);
    }
  };

  if (Array.isArray(input)) {
    for (const item of input) pushFromContainer(item);
  } else {
    pushFromContainer(input);
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage : tsx src/structure/scan-heights.ts <fichier.json> [...]");
    process.exit(1);
  }
  const { readFile } = await import("node:fs/promises");
  const all: ScannableRule[] = [];
  for (const f of files) {
    try {
      const parsed: unknown = JSON.parse(await readFile(f, "utf8"));
      const rules = flattenRules(parsed);
      all.push(...rules);
      console.error(`  ${f} → ${rules.length} règle(s)`);
    } catch (err) {
      console.error(`  ${f} → ILLISIBLE (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  const report = scanHeightRules(all);
  const pct = (n: number) => (report.height_rules ? ` (${Math.round((n / report.height_rules) * 100)}%)` : "");

  console.log(`\n=== Scan hauteurs — ${report.height_rules} règle(s) de hauteur sur ${report.total_rules} ===`);
  for (const cat of ALL_CATEGORIES) {
    console.log(`  ${cat.padEnd(26)} ${String(report.counts[cat]).padStart(4)}${pct(report.counts[cat])}`);
  }
  const actionable =
    report.counts.relative_suspect + report.counts.egout_faitage_conflation + report.counts.ngf;
  console.log(`\n  À TRAITER (hors garde-fou actuel) : ${actionable}`);

  if (report.examples.length) {
    console.log(`\n--- Exemples par catégorie ---`);
    for (const ex of report.examples) {
      console.log(`\n  [${ex.category}] ${ex.reason}`);
      console.log(`    « ${ex.rule_text} »  (value_max=${ex.value_max ?? "null"} ${ex.unit ?? ""})`);
    }
  }
}

// Exécution directe uniquement (pas à l'import depuis les tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
