/**
 * Types du harnais de benchmark LLM pour HEUREKA.
 *
 * Objectif : comparer plusieurs fournisseurs d'inférence (Anthropic direct,
 * Anthropic via Bedrock, Mistral Pixtral, Google Vertex) sur la tâche
 * d'analyse de pièces d'urbanisme RÉELLES, afin de décider lequel
 * privilégier en production.
 *
 * Aucune dépendance vers le code applicatif HEUREKA — le harnais reproduit
 * en autonome les prompts utilisés en prod (cf. apps/api/src/services/
 * pieceAnalyzer.ts et pieceExtractor.ts) pour rester comparable.
 */

export type PieceKind =
  | "plan_masse"
  | "plan_coupe"
  | "plan_facade"
  | "plan_situation"
  | "cerfa"
  | "notice"
  | "photo"
  | "insertion"
  | "autre";

/** Une pièce de test avec sa vérité-terrain renseignée à la main. */
export interface PieceFixture {
  /** Identifiant unique (ex: "plan-masse-01"). */
  id: string;
  /** Chemin relatif depuis benchmark-fixtures/pieces. */
  file: string;
  /** Type MIME du fichier. */
  mime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  /** Libellé lisible — apparaît dans le rapport. */
  label: string;
  /** Contexte minimal à fournir au modèle (zone PLU, nature des travaux). */
  context: {
    dossierType?: string;
    natures?: string[];
    zone?: string;
    surface?: number;
    commune?: string;
    aide?: string;
  };
  /** Vérité-terrain — ce qui DEVRAIT être extrait/produit. */
  golden: GoldenAnswer;
}

/**
 * Vérité-terrain pour une pièce. Tous les champs sont optionnels — on note
 * UNIQUEMENT ce qu'un humain saurait lire sur la pièce. Un champ omis n'est
 * pas évalué (ni en précision ni en rappel).
 */
export interface GoldenAnswer {
  /** Type attendu (l'IA doit identifier correctement). */
  piece_type: PieceKind;
  /** Score qualitatif attendu — concordance avec un instructeur humain. */
  expected_score?: "conforme" | "acceptable" | "incomplet" | "non_conforme";
  /** Le document est-il lisible ? (un humain le voit immédiatement) */
  expected_quality?: "lisible" | "partiellement_lisible" | "illisible";
  /** Valeurs cotées attendues. Tolérance numérique configurable par champ. */
  expected_values?: Record<string, number | string | boolean>;
  /** Tolérance numérique relative (10% par défaut). */
  numeric_tolerance?: number;
  /** Éléments manquants attendus (l'IA doit les détecter). */
  expected_missing?: string[];
  /** Non-conformités PLU attendues (résumé). */
  expected_non_conformites?: string[];
  /** Note libre pour le rédacteur de la fixture. */
  notes?: string;
}

/** Réponse normalisée d'un provider — pivot commun pour la comparaison. */
export interface ProviderResponse {
  /** Sortie JSON brute renvoyée par le modèle (peut être null si parse échoue). */
  parsed: Record<string, unknown> | null;
  /** Texte brut renvoyé (pour debug). */
  raw_text: string;
  /** Tokens facturés (lus depuis la réponse provider). */
  input_tokens: number;
  output_tokens: number;
  /** Coût estimé en EUR d'après les tarifs publics du provider. */
  cost_eur: number;
  /** Durée wall-clock de l'appel. */
  duration_ms: number;
  /** Identifiant du modèle utilisé (pour la trace). */
  model_id: string;
  /** Erreur éventuelle (timeout, refus, JSON invalide…). */
  error: string | null;
}

/** Interface qu'un provider doit implémenter. */
export interface BenchmarkProvider {
  /** Nom court (apparaît dans le rapport). */
  name: string;
  /** Région de l'inférence (souveraineté). */
  region: string;
  /** Pays du fournisseur (souveraineté). */
  country: string;
  /** Modèle utilisé. */
  model: string;
  /** Lance une analyse de pièce. */
  analyze(piece: PieceFixture, fileBuffer: Buffer): Promise<ProviderResponse>;
  /** Lance une extraction structurée. */
  extract(piece: PieceFixture, fileBuffer: Buffer): Promise<ProviderResponse>;
}

/** Résultat de scoring d'UN appel provider sur UNE pièce. */
export interface PieceScore {
  /** Type correctement identifié ? */
  type_match: boolean;
  /** Score qualitatif correctement attribué ? */
  score_match: boolean | null;
  /** Précision sur les valeurs : (champs corrects) / (champs extraits). */
  precision: number;
  /** Rappel sur les valeurs : (champs corrects) / (champs attendus). */
  recall: number;
  /** F1 = 2·P·R / (P+R). */
  f1: number;
  /** Champs hallucinés (extraits mais absents du golden). */
  hallucinations: string[];
  /** Champs golden non extraits. */
  missing: string[];
  /** Champs extraits avec valeur incorrecte. */
  wrong_values: Array<{ field: string; expected: unknown; got: unknown }>;
  /** JSON parsable ? */
  valid_json: boolean;
}

/** Résultat agrégé d'un provider sur l'ensemble des fixtures. */
export interface ProviderAggregate {
  provider: BenchmarkProvider;
  /** Nombre de pièces évaluées. */
  n: number;
  /** Moyenne des scores. */
  avg_precision: number;
  avg_recall: number;
  avg_f1: number;
  /** % de fixtures avec type correctement identifié. */
  type_accuracy: number;
  /** % de fixtures avec JSON parsable. */
  json_validity: number;
  /** Latence moyenne (ms). */
  avg_latency_ms: number;
  /** Latence médiane (ms). */
  p50_latency_ms: number;
  /** Latence p95 (ms). */
  p95_latency_ms: number;
  /** Coût total cumulé (EUR). */
  total_cost_eur: number;
  /** Nombre d'erreurs (parse, refus, timeout). */
  errors: number;
}

export interface BenchmarkRun {
  started_at: string;
  finished_at: string;
  fixtures_count: number;
  providers: ProviderAggregate[];
  per_piece: Array<{
    fixture: PieceFixture;
    results: Array<{
      provider: string;
      analysis: ProviderResponse;
      extraction: ProviderResponse;
      score_analysis: PieceScore;
      score_extraction: PieceScore;
    }>;
  }>;
}
