/**
 * Ingestion PLU pilotée par le sommaire — helpers purs.
 *
 * Le flux historique envoyait à Pixtral le PDF natif d'un tronçon de 90 pages
 * dont seule la 1re page était convertie en image (cf. aiUsage.ts → conversion
 * "première page seulement"). Conséquence : les tableaux et règles situés après
 * la première page d'une zone (typiquement l'article 12 sur le stationnement)
 * n'étaient jamais lus, et un règlement comme celui de Tours retombait avec
 * 2 zones extraites au lieu des 10 attendues.
 *
 * Ce module pilote l'import via le sommaire :
 *   1. on rend les premières pages en images → l'IA renvoie la liste des
 *      zones avec leur page de début (`extractTocFromPages` côté caller) ;
 *   2. `partitionPagesByZone` traduit ces ancres en plages de pages fermées
 *      [startPage, endPage] zone par zone ;
 *   3. `chunkPages` découpe une plage en paquets raisonnables (≈ 8 pages)
 *      qui rentrent dans une seule requête Pixtral ;
 *   4. `assertTocCoverage` est le garde-fou : si l'IA n'a extrait de règles
 *      que pour 2 zones sur 10, on lève — la transaction d'écriture (cf.
 *      mairie/admin.ts) ne se déclenche pas et le référentiel existant
 *      n'est pas écrasé.
 *
 * Les fonctions exposées ici sont volontairement pures (pas d'I/O, pas
 * d'appel réseau) → couvertes par pluImport.test.ts.
 */

export interface TocEntry {
  /** Code de zone (UA, UC, AUs, A, N…). Trim et upper-case côté caller. */
  code: string;
  /** Libellé court tel que mentionné au sommaire. */
  label: string;
  /** "U" | "AU" | "A" | "N". */
  type: string;
  /** Page de début de la section (1-indexé, identique à pdftoppm -f). */
  startPage: number;
}

export interface ZoneRange extends TocEntry {
  /** Dernière page (incluse) de la zone, déduite de la zone suivante. */
  endPage: number;
}

/**
 * Découpe le PDF en plages fermées [startPage, endPage] zone par zone, à
 * partir des ancres TOC + du nombre total de pages.
 *
 * Règles :
 *   - tri par startPage croissant (le sommaire peut lister les zones dans
 *     n'importe quel ordre) ;
 *   - endPage = startPage_suivante - 1 ; pour la dernière zone, endPage =
 *     totalPages ;
 *   - les startPage hors bornes (< 1 ou > totalPages) ou doublons sont
 *     écartés silencieusement — le caller décide ensuite si la couverture
 *     reste suffisante via `assertTocCoverage`.
 */
export function partitionPagesByZone(toc: TocEntry[], totalPages: number): ZoneRange[] {
  if (totalPages <= 0) return [];
  const seen = new Set<number>();
  const valid: TocEntry[] = [];
  for (const e of toc) {
    if (!Number.isInteger(e.startPage)) continue;
    if (e.startPage < 1 || e.startPage > totalPages) continue;
    if (seen.has(e.startPage)) continue;
    seen.add(e.startPage);
    valid.push(e);
  }
  valid.sort((a, b) => a.startPage - b.startPage);
  return valid.map((e, i) => ({
    ...e,
    endPage: i + 1 < valid.length ? valid[i + 1]!.startPage - 1 : totalPages,
  }));
}

/**
 * Découpe une plage [start, end] en lots de `batchSize` pages. Un lot trop
 * volumineux dépasse la fenêtre d'image Pixtral et fait grimper le coût
 * inutilement ; un lot trop petit multiplie les appels et perd la cohérence
 * intra-article (un article de 4 pages doit rester groupé si possible).
 */
export function chunkPages(start: number, end: number, batchSize: number): Array<[number, number]> {
  if (batchSize <= 0) throw new Error("batchSize doit être > 0");
  if (end < start) return [];
  const out: Array<[number, number]> = [];
  for (let p = start; p <= end; p += batchSize) {
    out.push([p, Math.min(p + batchSize - 1, end)]);
  }
  return out;
}

/**
 * Garde-fou anti-import partiel.
 *
 * Levée si le sommaire annonce N zones mais qu'on n'a réussi à extraire des
 * règles que pour moins de `minCoverage` (par défaut 80 %) d'entre elles. Le
 * caller doit appeler ce helper AVANT de purger / réécrire les données :
 * une erreur ici doit faire échouer la requête HTTP sans toucher la DB.
 *
 * Exemple : TOC = [UA, UC, UJ, UL, UM, UP, UX, AUs, A, N] (10 zones). Si
 * l'extraction renvoie des règles uniquement pour UA et UC (2 zones), on
 * lève ; le règlement précédent reste en place.
 */
/**
 * Extrait le sommaire d'un PLU depuis le TEXTE NATIF du PDF (cf.
 * services/aiUsage.ts → extractPdfText). Évite l'appel Pixtral en phase 1,
 * qui faisait dépasser /ingest-plu-pdf/start de la limite proxy nginx (60 s).
 *
 * Heuristique : on cherche les lignes qui mentionnent à la fois une "zone"
 * et un numéro de page en fin de ligne. Couvre les sommaires PLU usuels :
 *
 *   "Dispositions applicables à la zone UA  ........... 7"
 *   "Chapitre 2 - Zone UC  ...... p. 33"
 *   "TITRE II - DISPOSITIONS APPLICABLES À LA ZONE UL    67"
 *
 * Si moins de `minZones` zones trouvées, retourne [] et le caller bascule sur
 * Pixtral. Codes reconnus : U[A-Z], 1AU/2AU/AU[a-z]?, A, A[a-z]?, N, N[a-z]?.
 */
/**
 * Normalise un code de zone PLU vers sa forme canonique, quelle que soit la
 * casse en entrée. INDISPENSABLE pour que les codes issus de sources
 * différentes (texte natif, sommaire manuel, vision Pixtral) fusionnent : sans
 * ça, "UA" (natif) et "Ua"/"UA " (Pixtral) deviennent deux zones distinctes.
 *
 * Règles : AUS → AUs, NJ → Nj, UA → UA. Préfixe à 2 lettres (AU, UA, UC…)
 * conservé en majuscules, suffixe en minuscules (sauf le 2e caractère des
 * codes U[A-Z]).
 */
export function normalizeZoneCode(raw: string): string {
  const s = raw.trim();
  if (s.length === 0) return "";
  if (/^[12]?AU/i.test(s)) {
    // 1AU, 2AU, AUs, AUa : "AU" majuscule, suffixe minuscule.
    const m = s.match(/^([12]?)AU(.*)$/i)!;
    return (m[1] ?? "") + "AU" + (m[2] ?? "").toLowerCase();
  }
  const first = s[0]!.toUpperCase();
  if (s.length === 1) return first; // A, N
  // UA, UC : zone urbaine = deux lettres majuscules. Nj, Ah, Ni : 1re lettre
  // majuscule + suffixe minuscule (notation conventionnelle des sous-zones).
  return first === "U"
    ? first + s[1]!.toUpperCase() + s.slice(2).toLowerCase()
    : first + s.slice(1).toLowerCase();
}

/** Déduit le type de zone ("U" | "AU" | "A" | "N") à partir d'un code normalisé. */
export function zoneTypeFromCode(code: string): string {
  return /^[12]?AU/i.test(code) ? "AU"
    : code.startsWith("U") ? "U"
    : code.startsWith("A") ? "A"
    : code.startsWith("N") ? "N" : "U";
}

export function parseTocFromNativeText(text: string, minZones = 3): TocEntry[] {
  if (!text) return [];
  const zoneCodeRe = /\bzone\s+(?<code>[12]?AU[a-z]{0,2}|U[A-Z][a-z]?|N[a-z]{0,2}|A[a-z]{0,2})\b/i;
  const pageRe = /(?:p\.?\s*|page\s+)?(\d{1,3})\s*$/;
  const seenCodes = new Map<string, TocEntry>();
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const zm = line.match(zoneCodeRe);
    if (!zm?.groups?.code) continue;
    const code = normalizeZoneCode(zm.groups.code);
    const pm = line.match(pageRe);
    if (!pm) continue;
    const page = Number(pm[1]);
    if (!Number.isInteger(page) || page < 1 || page > 999) continue;
    if (seenCodes.has(code)) continue;
    seenCodes.set(code, { code, label: `Zone ${code}`, type: zoneTypeFromCode(code), startPage: page });
  }
  const entries = [...seenCodes.values()].sort((a, b) => a.startPage - b.startPage);
  return entries.length >= minZones ? entries : [];
}

/**
 * Coercition entière pour article_number (colonne `integer`).
 *   - "" / null / undefined       → null
 *   - "12.2" (sous-article 12.2)   → 12 (le n° d'article ; le détail ".2"
 *                                     reste porté par article_title)
 *   - 7 / "7" / 7.0                → 7
 *   - "abc"                        → null
 *
 * `rule.article_number ?? null` ne suffit pas : "" (chaîne vide souvent
 * renvoyée par l'IA) y passe tel quel, et Postgres rejette '' sur une colonne
 * integer → l'INSERT, donc toute la transaction d'ingestion PLU, échoue.
 */
export function toArticleInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Une règle extraite n'est exploitable que si elle porte au minimum un topic
 * ET un texte de règle non vides. Pixtral renvoie parfois des appels save_rule
 * quasi vides (hallucination de fin de réponse, page blanche, tableau
 * illisible). On les écarte AVANT le garde-fou de couverture, pour qu'une zone
 * qui ne produit que du vide compte réellement comme 0 règle (et déclenche
 * assertTocCoverage) plutôt que d'insérer des lignes fantômes qui plantent
 * l'INSERT ou polluent le référentiel.
 */
export function isUsableRule(r: { topic?: unknown; rule_text?: unknown }): boolean {
  return typeof r?.topic === "string" && r.topic.trim().length > 0
    && typeof r?.rule_text === "string" && r.rule_text.trim().length > 0;
}

/**
 * Déduplique une liste de règles extraites en gardant la plus complète quand
 * deux règles ont un texte quasi identique.
 *
 * IMPORTANT — pourquoi pas par `(article_number, topic)` :
 * Un même article peut porter PLUSIEURS règles distinctes sur le même topic.
 * Exemple typique, article 12 (stationnement) :
 *   - habitation : 1 place / logement
 *   - commerce < 100 m² : 1 place / 60 m²
 *   - bureaux : 1 place / 40 m²
 *   - artisanat : 1 place / 80 m²
 *   etc.
 * Toutes partagent `article_number=12, topic=stationnement`. Une fusion par
 * (article, topic) n'en gardait qu'UNE → perte massive de règles à
 * l'insertion finale (≈ 8 règles vues pendant l'extraction, 1 seule restituée).
 *
 * Heuristique correcte : la clé est un préfixe normalisé de rule_text
 * (lowercase, espaces compactés, 160 caractères). Deux règles avec préfixe
 * identique = même règle dupliquée (chevauchement de tableau sur deux lots,
 * réémission par hallucination). Préfixes différents = règles distinctes,
 * toutes gardées.
 */
type ExtractedRule = {
  topic?: unknown;
  rule_text?: string | null;
  needs_vision?: boolean;
  needs_external_doc?: boolean;
};
export function dedupeRules<R extends ExtractedRule>(rules: R[]): R[] {
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFKD").replace(/\s+/g, " ").trim().slice(0, 160);
  const m = new Map<string, R>();
  for (const r of rules) {
    if (!isUsableRule(r)) continue;
    const key = norm(r.rule_text as string);
    if (!key) continue;
    const prev = m.get(key);
    if (!prev || (r.rule_text?.length ?? 0) > (prev.rule_text?.length ?? 0)) {
      m.set(key, r);
    }
  }
  return [...m.values()];
}

/**
 * Fusionne les règles extraites de PLUSIEURS segments (= plusieurs PDF d'un
 * même PLUi) par code de zone.
 *
 * Un PLUi est parfois livré en plusieurs fichiers : soit découpé par type de
 * zone (un PDF U, un PDF AU, un PDF A, un PDF N), soit en tomes. Chaque PDF est
 * traité indépendamment (son propre sommaire, sa propre numérotation), ce qui
 * produit un groupe de règles par (segment, zone). Avant l'écriture en base, on
 * regroupe ces règles par `code` de zone :
 *   - codes distincts entre PDF (cas du découpage par type de zone) → chaque
 *     zone reste autonome ;
 *   - code identique dans deux PDF (rare, ex. annexes répétées) → les règles
 *     sont concaténées sous une seule zone ; le caller appliquera ensuite
 *     `dedupeRules` pour écarter les doublons exacts.
 *
 * Le `label`/`type` retenu est celui du segment dont le libellé est le plus
 * informatif (le plus long) — un sommaire détaillé prime sur un libellé nu
 * « Zone UA ».
 *
 * Fonction pure (pas d'I/O) → couverte par pluImport.test.ts.
 */
export type ZoneRulesGroup<R> = {
  zoneDef: { code: string; label: string; type: string };
  rules: R[];
};
export function mergeRulesByZoneCode<R>(
  segmentZones: Array<{ code: string; label: string; type: string; rules: R[] }>,
): ZoneRulesGroup<R>[] {
  const byCode = new Map<string, ZoneRulesGroup<R>>();
  for (const sz of segmentZones) {
    const entry = byCode.get(sz.code);
    if (entry) {
      entry.rules.push(...sz.rules);
      if ((sz.label?.length ?? 0) > (entry.zoneDef.label?.length ?? 0)) {
        entry.zoneDef.label = sz.label;
        entry.zoneDef.type = sz.type;
      }
    } else {
      byCode.set(sz.code, {
        zoneDef: { code: sz.code, label: sz.label, type: sz.type },
        rules: [...sz.rules],
      });
    }
  }
  return [...byCode.values()];
}

export function assertTocCoverage(
  toc: TocEntry[],
  extracted: Array<{ code: string; ruleCount: number }>,
  minCoverage = 0.8,
): void {
  if (toc.length === 0) {
    throw new Error("Sommaire vide : impossible d'identifier les zones du PLU.");
  }
  const withRules = new Set(extracted.filter((e) => e.ruleCount > 0).map((e) => e.code));
  const missing = toc.map((t) => t.code).filter((c) => !withRules.has(c));
  const coverage = (toc.length - missing.length) / toc.length;
  if (coverage < minCoverage) {
    throw new Error(
      `Extraction incomplète : ${toc.length - missing.length}/${toc.length} zones du sommaire ont des règles ` +
        `(seuil ${Math.round(minCoverage * 100)} %). Zones sans règle : ${missing.join(", ")}. ` +
        "Le référentiel existant n'a pas été modifié — réessayez ou contrôlez le PDF.",
    );
  }
}
