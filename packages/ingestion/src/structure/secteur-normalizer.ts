/**
 * Normaliseur de SECTEUR — garde-fou déterministe post-extraction.
 *
 * Problème : un secteur (UCi, UMr, UA1…) décrit *inline* dans un article peut,
 * selon le découpage du LLM, finir étiqueté (`sub_theme`) OU noyé dans
 * `conditions` (texte libre, ni structuré ni requêtable). Ce module garantit
 * qu'une sous-zone est TOUJOURS au moins identifiée :
 *
 *  1. si `sub_theme` est vide et qu'un code de secteur apparaît dans le texte,
 *     on PROMEUT le secteur en `sub_theme` (« Secteur UCi ») ;
 *  2. on infère un tag `applies_if` de contexte parcellaire sûr (inondable) à
 *     partir de signaux explicites du texte ;
 *  3. si une variante de secteur reste dans `conditions`/`rule_text` sans être
 *     reflétée par le `sub_theme`, on émet une NOTE pour l'instructeur au lieu
 *     de la laisser invisible.
 *
 * Fonction pure, déterministe, sans IA — testable et rejouable.
 */

// Validation d'un jeton candidat : préfixe de zone (chiffre? + U/AU/A/N + ≤3
// majuscules) SUIVI d'un suffixe de secteur (minuscule/chiffre). « UB » (zone
// mère) ne matche pas ; « UBa », « UCi », « UMr », « UA1 », « 1AUh », « Ap »,
// « Nh » oui.
const SECTEUR_TOKEN = /^\d?[A-Z]{1,3}[a-z0-9]+$/;

// Codes « sûrs » détectables SANS mot-clé : le double caractère majuscule au
// début écarte les mots courants (Un, Une, Au, Avenue) et les acronymes
// (UNESCO → pas de minuscule après « UN »).
const BARE_SECTEUR = /\b(?:\d?AU[a-z0-9]+|U[A-Z][a-z0-9]+)\b/g;

// Détection menée par un mot-clé (« secteur », « zone », « en secteur »…) :
// on capture la suite et on valide chaque jeton — le mot-clé sécurise les
// préfixes courts (Ap, Nh).
const KEYWORD_LED = /(?:secteurs?|zones?|en\s+secteur|dans\s+le\s+secteur)\s+([0-9A-Za-z][0-9A-Za-z,'/ -]*?)(?=[.;:)]|\bet\b|\bou\b|$)/gi;

/** Codes de sous-secteur distincts trouvés dans un texte (ordre d'apparition). */
export function detectSecteurCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  const push = (tok: string) => {
    const t = tok.trim();
    if (t && SECTEUR_TOKEN.test(t) && !found.includes(t)) found.push(t);
  };

  for (const m of text.matchAll(BARE_SECTEUR)) push(m[0]);

  for (const m of text.matchAll(KEYWORD_LED)) {
    const run = m[1] ?? "";
    for (const tok of run.split(/[\s,/]+|\bet\b|\bou\b|\bà\b/i)) push(tok);
  }
  return found;
}

// Signaux textuels explicites d'un secteur inondable → tag de contexte sûr.
// On NE déduit PAS « inondable » du simple suffixe « i » d'un code : ce serait
// risqué (une règle pourrait être écartée à tort pour une parcelle non
// inondable). On exige une mention explicite.
const FLOOD_SIGNAL = /inondab|p\.?p\.?r\.?i\b|zone bleue|zone rouge|plus hautes eaux|cote de référence/i;

export interface SecteurNormalizationInput {
  sub_theme?: string | null;
  conditions?: string | null;
  rule_text?: string | null;
}

export interface SecteurNormalizationResult {
  /** sub_theme promu si absent et secteur détecté ; sinon l'original (trimé). */
  sub_theme: string | null;
  /** Tags de contexte parcellaire inférés à AJOUTER (ex: ["inondable"]). */
  appliesIfAdd: string[];
  /** Avertissement instructeur si une variante de secteur n'est pas étiquetée. */
  note: string | null;
  /** Codes détectés (debug / tests). */
  detected: string[];
}

export function normalizeSecteur(input: SecteurNormalizationInput): SecteurNormalizationResult {
  const subRaw = input.sub_theme?.trim() || null;
  const bodyCodes = [
    ...detectSecteurCodes(input.conditions),
    ...detectSecteurCodes(input.rule_text),
  ].filter((c, i, a) => a.indexOf(c) === i);
  const subCodes = detectSecteurCodes(subRaw);

  // 1. Promotion : sub_theme vide + secteur dans le corps → étiquette explicite.
  let sub_theme = subRaw;
  if (!subRaw && bodyCodes.length > 0) {
    sub_theme = `Secteur ${bodyCodes.join(" / ")}`;
  }

  // 2. Tag de contexte sûr.
  const appliesIfAdd: string[] = [];
  const hay = `${input.conditions ?? ""} ${input.rule_text ?? ""} ${subRaw ?? ""}`;
  if (FLOOD_SIGNAL.test(hay)) appliesIfAdd.push("inondable");

  // 3. Note : variante de secteur dans le corps non reflétée par le sub_theme
  //    final. Après promotion, le sub_theme couvre bodyCodes → pas de note.
  const labelled = new Set(detectSecteurCodes(sub_theme).concat(subCodes));
  const orphan = bodyCodes.filter((c) => !labelled.has(c));
  const note = orphan.length > 0
    ? `Variante(s) de secteur dans le texte : ${orphan.join(", ")} — à éclater en règles distinctes si nécessaire.`
    : null;

  return { sub_theme, appliesIfAdd, note, detected: bodyCodes };
}
