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
    // Normalise : AUS → AUs, NJ → Nj, UA → UA. Les codes commençant par
    // un préfixe à 2 lettres majuscules (AU, parfois UA, UC…) conservent ce
    // préfixe, seul le suffixe est mis en minuscule.
    const raw = zm.groups.code;
    let code: string;
    if (raw.length <= 2) {
      code = raw.toUpperCase();
    } else if (/^[12]?AU/i.test(raw)) {
      // 1AU, 2AU, AUs, AUa : "AU" majuscule, suffixe minuscule.
      const m = raw.match(/^([12]?)AU(.*)$/i)!;
      code = (m[1] ?? "") + "AU" + (m[2] ?? "").toLowerCase();
    } else {
      // UA, UC, Nh, Ah, Ni : 1re lettre majuscule + 2e majuscule si dans
      // {UA-UZ}, sinon minuscule (Nh, Ni).
      code = raw[0]!.toUpperCase() + (
        raw[0]!.toUpperCase() === "U"
          ? raw[1]!.toUpperCase() + raw.slice(2).toLowerCase()
          : raw.slice(1).toLowerCase()
      );
    }
    const pm = line.match(pageRe);
    if (!pm) continue;
    const page = Number(pm[1]);
    if (!Number.isInteger(page) || page < 1 || page > 999) continue;
    if (seenCodes.has(code)) continue;
    const type = /^[12]?AU/i.test(code) ? "AU"
      : code.startsWith("U") ? "U"
      : code.startsWith("A") ? "A"
      : code.startsWith("N") ? "N" : "U";
    seenCodes.set(code, { code, label: `Zone ${code}`, type, startPage: page });
  }
  const entries = [...seenCodes.values()].sort((a, b) => a.startPage - b.startPage);
  return entries.length >= minZones ? entries : [];
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
