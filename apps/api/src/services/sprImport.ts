/**
 * Segmentation d'un règlement de SPR (Site Patrimonial Remarquable, ex-AVAP) —
 * helpers purs, sans I/O → couverts par sprImport.test.ts.
 *
 * Un règlement SPR n'a PAS la structure d'un PLU (zones U/AU/A/N + articles
 * 1-16). Celui de Rochecorbon s'organise en livrets, dont le **Livret 2**
 * (« Dispositions particulières concernant les constructions nouvelles et les
 * aménagements extérieurs ») découpe le territoire en **secteurs paysagers** :
 *
 *   Chapitre 1  - Dispositions communes à tous les secteurs        (p. 155)
 *   Chapitre 2  - Secteur de la vallée de Vaufoynard               (p. 164)
 *   Chapitre 3  - Secteur du vallon secondaire de la Bédoire       (p. 186)
 *   …
 *   Chapitre 10 - Secteur de la vallée de la Bédoire confidentielle (p. 338)
 *
 * Chaque secteur porte un en-tête courant « Chapitre N - Secteur … » répété sur
 * TOUTES ses pages (comme les en-têtes courants « Zone UA » du PLU). La PREMIÈRE
 * page de corps où l'en-tête apparaît = la page de début du secteur — exactement
 * l'ancre attendue par `partitionPagesByZone` (réutilisé depuis pluImport).
 *
 * Ces secteurs deviennent des `zones` de `zone_type = "spr"`, ingérées en mode
 * document (source_document_id = le SPR) → elles COHABITENT avec les zones PLU
 * de la commune sans les écraser.
 *
 * PÉRIMÈTRE de cette 1re version : le Livret 2 (dispositions communes + 9
 * secteurs). Le Livret 1 (dispositions par CATÉGORIE de bâti : immeuble
 * remarquable, intéressant, troglodyte…) relève d'un autre axe d'applicabilité
 * (tags `applies_if` plutôt que zones) et sera traité dans un second temps.
 */
import type { TocEntry } from "./pluImport.js";

export const SPR_ZONE_TYPE = "spr";

/** Retire les accents/diacritiques (é→e, à→a…) pour des slugs/déduplications stables. */
function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Fabrique un code de zone stable et unique pour un secteur SPR à partir de son
 * libellé. Ex. « Secteur de la vallée de Vaufoynard » → « SPR-VALLEE-VAUFOYNARD ».
 *
 * Les mots-outils (de, la, du, des, à, et…) sont retirés pour raccourcir sans
 * perdre le distinctif : trois secteurs mentionnent « Bédoire » (vallon /
 * habitée / confidentielle) → leurs slugs restent distincts car on garde les
 * mots porteurs. Préfixe « SPR- » pour ne jamais entrer en collision avec un
 * code de zone PLU (UA, 1AU…).
 */
const SLUG_STOPWORDS = new Set([
  "secteur", "de", "des", "du", "d", "la", "le", "les", "l", "a", "au", "aux",
  "et", "en", "ses", "son", "sa", "un", "une",
]);
export function slugifySecteurCode(label: string): string {
  const words = deaccent(label.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !SLUG_STOPWORDS.has(w));
  const slug = (words.length > 0 ? words : ["secteur"]).join("-").slice(0, 48).toUpperCase();
  return `SPR-${slug}`;
}

/** Nombre de lettres minuscules — sert à préférer l'en-tête courant complet
 * (« Secteur du vallon… ») au gros titre en capitales tronqué de la 1re page
 * (« SECTEUR DU VALLON SECONDAIRE DE LA »), qui portent le MÊME chapitre. */
function lowercaseCount(s: string): number {
  let n = 0;
  for (const c of s) if (c >= "a" && c <= "z") n++;
  return n;
}

// En-tête de chapitre du Livret 2, capturant le n° de chapitre ET le libellé.
// « Chapitre 7 - Secteur du coteau arboré et habité » → [7, "Secteur du…"].
// Ancré en début de ligne (flag `m`, `\s*` absorbe l'indentation de pdftotext
// -layout). Le libellé s'arrête avant les points de conduite du sommaire
// (« ……… 270 ») ou la fin de ligne. Tiret demi-cadratin (–) ou normal accepté.
// Deux variantes de chapitre reconnues :
//   - un SECTEUR paysager (« Secteur … ») → chapitres 2 à 10 ;
//   - les « Dispositions communes à tous les secteurs » (chapitre 1) → socle
//     applicable QUEL QUE SOIT le secteur, ingéré comme zone SPR-COMMUN.
const SPR_CHAPTER_RE =
  /^\s*Chapitre\s+(\d{1,2})\s*[-–]\s*(Secteur\b[^\n.]*?|Dispositions\s+communes\s+[àa]\s+tous\s+les\s+secteurs)\s*(?:\.{2,}.*)?$/gim;

/**
 * Détecte les sections du Livret 2 d'un règlement SPR (dispositions communes +
 * secteurs paysagers) et renvoie leurs ancres page, prêtes pour
 * `partitionPagesByZone`.
 *
 * `pages` = texte natif page par page (form-feed `\f` de pdftotext -layout),
 * index 0 = page 1. On écarte les pages « sommaire » (≥ 3 chapitres regroupés)
 * pour ne pas confondre la table des matières avec le corps.
 *
 * Déduplication par NUMÉRO DE CHAPITRE (unique dans le Livret 2) : la 1re page
 * d'un secteur porte à la fois son en-tête courant complet et un gros titre en
 * capitales souvent tronqué par le retour à la ligne — deux libellés pour le
 * même chapitre. On retient la PREMIÈRE page où le chapitre apparaît et le
 * libellé le plus complet (le plus de minuscules → l'en-tête courant).
 *
 * Renvoie [] si moins de `minSecteurs` secteurs trouvés (le caller décide alors
 * du repli / de l'échec) — évite d'ingérer une bribe non représentative.
 */
export function parseSprSecteurs(pages: string[], minSecteurs = 3): TocEntry[] {
  // Chapitres (n°) trouvés sur chaque page, avec leur meilleur libellé.
  const perPage = pages.map((page) => {
    const found = new Map<string, string>(); // chapNum → libellé
    for (const m of page.matchAll(SPR_CHAPTER_RE)) {
      const chap = m[1] ?? "";
      const label = (m[2] ?? "").replace(/\s+/g, " ").trim();
      if (!chap || !label) continue;
      const prev = found.get(chap);
      if (!prev || lowercaseCount(label) > lowercaseCount(prev)) found.set(chap, label);
    }
    return found;
  });

  // Pages de sommaire : ≥ 3 chapitres distincts regroupés → à exclure.
  const tocPages = new Set<number>();
  perPage.forEach((found, i) => {
    if (found.size >= 3) tocPages.add(i);
  });

  const byChapter = new Map<string, { label: string; startPage: number }>();
  perPage.forEach((found, i) => {
    if (tocPages.has(i)) return;
    for (const [chap, label] of found) {
      const prev = byChapter.get(chap);
      if (!prev) {
        byChapter.set(chap, { label, startPage: i + 1 }); // 1re page de corps
      } else if (lowercaseCount(label) > lowercaseCount(prev.label)) {
        prev.label = label; // libellé plus complet, page inchangée
      }
    }
  });

  const entries: TocEntry[] = [...byChapter.values()].map(({ label, startPage }) => {
    const isCommun = /dispositions\s+communes/i.test(label);
    return {
      code: isCommun ? "SPR-COMMUN" : slugifySecteurCode(label),
      label,
      type: SPR_ZONE_TYPE,
      startPage,
    };
  });
  entries.sort((a, b) => a.startPage - b.startPage);

  // Seuil compté sur les SECTEURS (hors socle commun) : ce sont eux qui portent
  // le zonage ; le socle seul ne suffit pas à valider une détection.
  const secteurCount = entries.filter((e) => e.code !== "SPR-COMMUN").length;
  return secteurCount >= minSecteurs ? entries : [];
}
