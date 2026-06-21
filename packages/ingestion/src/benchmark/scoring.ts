/**
 * Compare la sortie d'un provider à la vérité-terrain (golden).
 *
 * Règles :
 * - Type : match strict (string égale).
 * - Score qualitatif : match strict.
 * - Valeurs numériques : tolérance relative (par défaut 10%).
 *   Ex: golden=5.0, got=5.3 → écart 6% → match si tolérance ≥ 6%.
 * - Valeurs string / boolean : match strict (case-insensitive pour les strings).
 * - Précision / Rappel calculés UNIQUEMENT sur les champs présents dans le golden.
 *   Un champ extrait mais absent du golden est compté en "hallucination" séparément
 *   (sans pénaliser le rappel — c'est de l'info bonus, mais on la trace).
 */
import type { GoldenAnswer, PieceFixture, PieceScore, ProviderResponse } from "./types.js";

const DEFAULT_TOLERANCE = 0.10;

/** Compare deux valeurs avec tolérance numérique. */
export function valueMatches(
  expected: unknown,
  got: unknown,
  tolerance = DEFAULT_TOLERANCE,
): boolean {
  if (expected === null || expected === undefined) return got === null || got === undefined;
  if (typeof expected === "boolean") return expected === got;
  if (typeof expected === "number") {
    if (typeof got !== "number" || !Number.isFinite(got)) return false;
    if (expected === 0) return Math.abs(got) < 0.01;
    return Math.abs((got - expected) / expected) <= tolerance;
  }
  if (typeof expected === "string") {
    if (typeof got !== "string") return false;
    return expected.trim().toLowerCase() === got.trim().toLowerCase();
  }
  return false;
}

/**
 * Extrait récursivement tous les couples (chemin, valeur) d'un objet JSON.
 * Permet de comparer des sorties imbriquées comme :
 *   { plan_masse: { recul_voie_m: 4.2 } } → "plan_masse.recul_voie_m" = 4.2
 */
export function flatten(obj: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== "object") {
    out[prefix || "value"] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    // Les listes sont laissées telles quelles (comparaison set-based dans le scoring).
    out[prefix || "value"] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else if (v !== null && v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

/** Score une réponse d'extraction par rapport au golden. */
export function scoreExtraction(
  resp: ProviderResponse,
  fixture: PieceFixture,
): PieceScore {
  const golden = fixture.golden;
  const tolerance = golden.numeric_tolerance ?? DEFAULT_TOLERANCE;

  const valid_json = resp.parsed !== null;
  if (!valid_json) {
    return {
      type_match: false,
      score_match: null,
      precision: 0,
      recall: 0,
      f1: 0,
      hallucinations: [],
      missing: Object.keys(golden.expected_values ?? {}),
      wrong_values: [],
      valid_json: false,
    };
  }

  const parsed = resp.parsed!;
  const got_type = typeof parsed.piece_type === "string" ? parsed.piece_type : "autre";
  const type_match = got_type === golden.piece_type;

  // Aplatir le parsed pour pouvoir matcher les chemins du golden.
  const flatGot = flatten(parsed);

  const expected = golden.expected_values ?? {};
  const expectedKeys = Object.keys(expected);

  const wrong_values: PieceScore["wrong_values"] = [];
  const missing: string[] = [];
  let correct = 0;

  for (const key of expectedKeys) {
    if (!(key in flatGot)) {
      missing.push(key);
      continue;
    }
    if (valueMatches(expected[key], flatGot[key], tolerance)) {
      correct++;
    } else {
      wrong_values.push({ field: key, expected: expected[key], got: flatGot[key] });
    }
  }

  // Hallucinations : champs présents dans la sortie mais pas dans le golden,
  // ET non-null (on ignore les `null` car ils indiquent "non visible" — sain).
  // On se limite aux champs "métier" (numériques ou listes) pour ne pas compter
  // les enveloppes comme piece_type ou commentaire.
  const hallucinations: string[] = [];
  const ENVELOPPE = new Set([
    "piece_type", "confidence_type", "quality", "echelle",
    "nord_visible", "legende_visible", "missing_elements",
    "citations", "notes", "score", "commentaire", "suggestions",
    "non_conformites", "reglementaire",
    // Phase 5/2.3 : nouveaux champs structurels. Comme `graphics` et
    // `parcelles_observees` sont des sous-arbres, leurs feuilles sont
    // scorées via leur chemin complet (ex: "graphics.orientation.kind")
    // — pas via le nom de feuille seul. On exclut donc seulement les
    // étiquettes intermédiaires qui apparaîtraient comme leaf.
    "graphics", "parcelles_observees",
    "orientation", "echelle_graphique", "legende", "limites",
    "acces", "emprise", "cotes_completes", "altimetries", "prises_de_vue",
    "kind", "visible", "evidence",
  ]);
  for (const [k, v] of Object.entries(flatGot)) {
    if (v === null || v === undefined) continue;
    const leaf = k.split(".").pop()!;
    if (ENVELOPPE.has(leaf)) continue;
    if (!(k in expected) && typeof v !== "object") {
      hallucinations.push(k);
    }
  }

  const extractedRelevant = correct + wrong_values.length;
  const precision = extractedRelevant === 0 ? 0 : correct / extractedRelevant;
  const recall = expectedKeys.length === 0 ? 1 : correct / expectedKeys.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    type_match,
    score_match: null,
    precision,
    recall,
    f1,
    hallucinations,
    missing,
    wrong_values,
    valid_json: true,
  };
}

/** Score une réponse d'analyse qualitative (score conforme/acceptable/…). */
export function scoreAnalysis(
  resp: ProviderResponse,
  fixture: PieceFixture,
): PieceScore {
  const golden = fixture.golden;
  const valid_json = resp.parsed !== null;
  if (!valid_json) {
    return {
      type_match: false,
      score_match: false,
      precision: 0,
      recall: 0,
      f1: 0,
      hallucinations: [],
      missing: [],
      wrong_values: [],
      valid_json: false,
    };
  }

  const parsed = resp.parsed!;
  const got_score = typeof parsed.score === "string" ? parsed.score : null;
  const score_match = golden.expected_score
    ? got_score === golden.expected_score
    : null;

  // Pour l'analyse, on ne mesure pas P/R sur des valeurs cotées mais sur la
  // concordance des non-conformités détectées (set overlap simplifié).
  const expectedNC = golden.expected_non_conformites ?? [];
  const gotNC = Array.isArray(parsed.non_conformites)
    ? (parsed.non_conformites as Array<{ regle?: string }>)
        .map((n) => (typeof n?.regle === "string" ? n.regle.toLowerCase() : ""))
        .filter(Boolean)
    : [];

  const matched = expectedNC.filter((e) =>
    gotNC.some((g) => g.includes(e.toLowerCase()) || e.toLowerCase().includes(g)),
  ).length;
  const precision = gotNC.length === 0 ? (expectedNC.length === 0 ? 1 : 0) : matched / gotNC.length;
  const recall = expectedNC.length === 0 ? 1 : matched / expectedNC.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    type_match: true,
    score_match,
    precision,
    recall,
    f1,
    hallucinations: [],
    missing: expectedNC.filter((e) => !gotNC.some((g) => g.includes(e.toLowerCase()))),
    wrong_values: [],
    valid_json: true,
  };
}

/** Calcule la médiane d'une série de nombres. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/** Calcule le p95 (95e percentile) d'une série de nombres. */
export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx]!;
}
