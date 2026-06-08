/**
 * Eval harness — types.
 *
 * Un "golden" décrit ce qu'on s'attend à voir ressortir d'un document donné
 * après ingestion (zones, articles, règles minimales). Le runner exécute le
 * pipeline réel, compare au golden, et produit un EvalResult avec précision /
 * rappel par catégorie. Toute régression future est mesurable.
 */

/** Schéma du fichier `<insee>_<doc>_<version>.golden.json`. */
export interface GoldenFixture {
  _meta: {
    fixture_version: 1;
    /** Chemin du PDF source, relatif à la racine du repo. */
    source_pdf: string;
    /** Nom de l'adapter dans le registry (`plu-reglement`, `ppri`, …). */
    adapter: string;
    insee: string;
    commune: string;
    doc_version: string;
    annotated_by: string;
    annotated_at: string;
    /** Notes libres de l'annotateur (cas particuliers, ambigüités). */
    notes?: string;
  };
  expected: GoldenExpected;
  tolerances?: GoldenTolerances;
}

export interface GoldenExpected {
  /**
   * Zones réglementaires que le segmenter doit retrouver. L'ordre n'importe
   * pas ; ce sont des codes exacts ("UA", "1AUz", "Nh"…).
   */
  zones: string[];
  /**
   * Articles attendus par zone (numéros). `[]` ou absent = on ne vérifie pas
   * le détail pour cette zone.
   */
  articles_per_zone?: Record<string, number[]>;
  /**
   * Optionnel — vérifications fines sur les règles structurées. Active
   * uniquement quand `--with-rules` est passé au runner (appel LLM coûteux).
   */
  rules?: GoldenRuleCheck[];
}

export interface GoldenRuleCheck {
  zone: string;
  /** Numéro de l'article PLU ciblé (1-14 typiquement). */
  article: number;
  /** Topic attendu (cf. RULE_TOPICS dans structurer.ts). */
  topic: string;
  /** La règle doit exister. */
  must_exist?: true;
  /** Plage acceptée pour la valeur exacte. */
  value_exact_range?: [number, number];
  /** Plage acceptée pour la borne max. */
  value_max_range?: [number, number];
  /** Plage acceptée pour la borne min. */
  value_min_range?: [number, number];
  /** Unité attendue ("m", "%", "m²"…). */
  unit?: string;
}

export interface GoldenTolerances {
  /** Zones détectées en trop autorisées (faux positifs). 0 par défaut. */
  extra_zones_allowed?: number;
  /** Zones manquantes autorisées (faux négatifs). 0 par défaut. */
  missing_zones_allowed?: number;
  /** Seuil minimal de F1 sur les zones pour considérer la fixture "passée". */
  min_zone_f1?: number;
  /** Seuil minimal de F1 sur les articles pour considérer la fixture "passée". */
  min_article_f1?: number;
}

// ── Résultats ─────────────────────────────────────────────────────────────────

export interface EvalScores {
  /** Vrais positifs. */
  tp: number;
  /** Faux positifs (détecté à tort). */
  fp: number;
  /** Faux négatifs (manqué). */
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ZoneDiff {
  found: string[];
  expected: string[];
  missing: string[];
  spurious: string[];
  scores: EvalScores;
}

export interface ArticleDiff {
  zone: string;
  found: number[];
  expected: number[];
  missing: number[];
  spurious: number[];
  scores: EvalScores;
}

export interface RuleCheckResult {
  zone: string;
  article: number;
  topic: string;
  status: "pass" | "fail" | "skipped";
  reason?: string;
}

export interface EvalResult {
  fixture_path: string;
  meta: GoldenFixture["_meta"];
  /** True si toutes les tolérances sont respectées. */
  passed: boolean;
  zones: ZoneDiff;
  articles: ArticleDiff[];
  rules: RuleCheckResult[];
  /** Erreurs/avertissements remontés par le pipeline lui-même. */
  validation: { errors: number; warnings: number };
  duration_ms: number;
  /** Pourquoi `passed` est false, en clair pour le rapport. */
  failure_reasons: string[];
}
