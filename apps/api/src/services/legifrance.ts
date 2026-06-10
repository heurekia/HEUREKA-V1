// Légifrance — accès au contenu officiel des articles via l'API DILA (PISTE).
//
// L'API officielle est documentée sur https://piste.gouv.fr → Légifrance.
// On expose ici une couche fine qui :
//   1. utilise `legal_mentions` comme cache local (re-publication autorisée par
//      la licence ouverte v2.0 Etalab, avec mention "Source : Légifrance"),
//   2. fait un lazy-fetch sur l'API PISTE quand l'article n'est pas en base,
//   3. normalise la référence d'article (sub-paragraphes, alinéas) pour
//      n'avoir qu'une entrée par article — c'est `getArticleWithIdAndNum`
//      qui se charge de retrouver la version en vigueur.

import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { legal_mentions } from "@heureka-v1/db";
import { pistePost } from "./pisteClient.js";

export const CODE_URBANISME_ID   = "LEGITEXT000006074075";
export const CODE_URBANISME_NAME = "Code de l'urbanisme";

// Codes supportés (étendable au besoin) — utilisé pour valider l'entrée
// publique et résoudre `code` → `id LEGITEXT`.
const CODE_REGISTRY: Record<string, { id: string; name: string }> = {
  CU:  { id: CODE_URBANISME_ID, name: CODE_URBANISME_NAME },
  CCH: { id: "LEGITEXT000006074096", name: "Code de la construction et de l'habitation" },
  CE:  { id: "LEGITEXT000006074220", name: "Code de l'environnement" },
};

export function resolveCode(code: string): { id: string; name: string } | null {
  return CODE_REGISTRY[code.toUpperCase()] ?? null;
}

// Normalise une référence d'article :
//  "R421-17 a) CU"  → { num: "R421-17", codeKey: "CU", normalized: "R421-17" }
//  "R421-13 al.2 CU"→ { num: "R421-13", codeKey: "CU", normalized: "R421-13" }
//  "R431-2 CU"      → { num: "R431-2",  codeKey: "CU", normalized: "R431-2"  }
export function parseArticleRef(ref: string): { num: string; codeKey: string; normalized: string } | null {
  const m = ref.trim().match(/^([LRD]?\d+-\d+)(?:\s+[a-z]\))?(?:\s+al\.\d+)?\s+([A-Z]{2,5})$/i);
  if (!m || !m[1] || !m[2]) return null;
  const num = m[1].toUpperCase();
  return { num, codeKey: m[2].toUpperCase(), normalized: num };
}

// Forme renvoyée par /consult/getArticleWithIdAndNum (champs utiles uniquement).
type PisteGetArticleResponse = {
  article?: {
    id?: string;
    num?: string;
    titre?: string;
    fullSectionTitre?: string;
    texte?: string;        // HTML (ancien champ)
    texteHtml?: string;    // HTML (champ swagger officiel)
    dateDebut?: number;
  } | null;
};

// Table des matières d'un code — utilisée comme fallback pour résoudre
// num → LEGIARTI quand getArticleWithIdAndNum échoue (typiquement pour les
// articles avec version en vigueur différée — voir note du Swagger).
type CodeTocSection = {
  id?: string;
  cid?: string;
  title?: string;
  articles?: { id?: string; cid?: string; num?: string; etat?: string }[];
  sections?: CodeTocSection[];
};
type CodeTocResponse = {
  sections?: CodeTocSection[];
  articles?: { id?: string; cid?: string; num?: string; etat?: string }[];
};

// Entrée d'index TOC : ce dont on a besoin pour fetcher ET enrichir l'article.
type TocEntry = { id: string; sectionPath: string };

// Cache TOC par code (en mémoire processus) : la structure d'un code change rarement.
const tocCache = new Map<string, Promise<Map<string, TocEntry>>>();

// Parcourt récursivement les sections pour construire un index
// { num → { id, sectionPath } } où sectionPath est la suite des titres
// de sections parents, séparés par " › ".
function indexToc(toc: CodeTocResponse): Map<string, TocEntry> {
  const idx = new Map<string, TocEntry>();
  const visitArticles = (arts: { id?: string; cid?: string; num?: string }[] | undefined, sectionPath: string) => {
    for (const a of arts ?? []) {
      const id = a.id ?? a.cid;
      if (a.num && id) idx.set(a.num.toUpperCase(), { id, sectionPath });
    }
  };
  const walk = (sections: CodeTocSection[] | undefined, parentPath: string[]) => {
    for (const s of sections ?? []) {
      const path = s.title ? [...parentPath, s.title.trim()] : parentPath;
      visitArticles(s.articles, path.join(" › "));
      walk(s.sections, path);
    }
  };
  // Articles à la racine (rare) : pas de section path.
  visitArticles(toc.articles, "");
  walk(toc.sections, []);
  return idx;
}

async function getCodeNumIndex(codeId: string): Promise<Map<string, TocEntry>> {
  let p = tocCache.get(codeId);
  if (!p) {
    p = pistePost<CodeTocResponse>("/consult/code/tableMatieres", {
      textId: codeId,
      date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
    }).then(indexToc).catch((err) => {
      console.warn(`[legifrance] TOC ${codeId} échoué:`, (err as Error).message);
      tocCache.delete(codeId);
      return new Map<string, TocEntry>();
    });
    tocCache.set(codeId, p);
  }
  return p;
}

// Récupère le chemin de section pour un num, ou null si la TOC n'est pas dispo.
async function lookupSectionPath(codeId: string, num: string): Promise<string | null> {
  const idx = await getCodeNumIndex(codeId);
  for (const candidate of numVariants(num)) {
    const entry = idx.get(candidate.toUpperCase());
    if (entry?.sectionPath) return entry.sectionPath;
  }
  return null;
}

// Variantes de `num` à essayer en cas d'introuvable. Le Code de l'urbanisme
// note ses articles réglementaires avec un astérisque ("R*421-1") qui
// signale un décret en Conseil d'État ; la canonicalisation API n'est pas
// toujours symétrique selon les codes.
function numVariants(num: string): string[] {
  const v = new Set<string>([num]);
  if (/^[LRD]\d/.test(num)) {
    v.add(num.replace(/^([LRD])(\d)/, "$1*$2"));   // R421-1 → R*421-1
    v.add(num.replace(/^([LRD])\*/, "$1"));        // R*421-1 → R421-1
  }
  return [...v];
}

export type LegalArticle = {
  code: string;
  code_name: string;
  article_ref: string;
  article_title: string | null;
  article_html: string | null;
  legifrance_id: string | null;
  fetched_at: Date;
  source_url: string;
};

function buildSourceUrl(legifranceId: string | null, codeId: string, num: string): string {
  if (legifranceId) {
    return `https://www.legifrance.gouv.fr/codes/article_lc/${legifranceId}`;
  }
  return `https://www.legifrance.gouv.fr/codes/article_lc/?idArticle=${encodeURIComponent(num)}&cidTexte=${codeId}`;
}

// Tente getArticleWithIdAndNum sur chaque variante de `num`.
async function tryGetArticleByNum(codeId: string, num: string): Promise<PisteGetArticleResponse["article"]> {
  for (const candidate of numVariants(num)) {
    try {
      const data = await pistePost<PisteGetArticleResponse>("/consult/getArticleWithIdAndNum", {
        id: codeId,
        num: candidate,
      });
      if (data?.article) return data.article;
    } catch {
      // tente la variante suivante
    }
  }
  return null;
}

// Fallback : résout num → LEGIARTI via la table des matières du code,
// puis charge l'article par son id. Couvre les articles avec version en
// vigueur différée que getArticleWithIdAndNum ne renvoie pas.
async function tryGetArticleViaToc(codeId: string, num: string): Promise<PisteGetArticleResponse["article"]> {
  const idx = await getCodeNumIndex(codeId);
  let entry: TocEntry | undefined;
  for (const candidate of numVariants(num)) {
    entry = idx.get(candidate.toUpperCase());
    if (entry) break;
  }
  if (!entry) return null;
  try {
    const data = await pistePost<PisteGetArticleResponse>("/consult/getArticle", { id: entry.id });
    return data?.article ?? null;
  } catch {
    return null;
  }
}

// Récupère un article depuis l'API Légifrance (PISTE) et upsert dans `legal_mentions`.
async function fetchAndCacheFromPiste(codeId: string, codeName: string, num: string): Promise<LegalArticle> {
  const a = (await tryGetArticleByNum(codeId, num)) ?? (await tryGetArticleViaToc(codeId, num));
  if (!a) throw new Error(`Article ${num} introuvable dans ${codeId}`);

  const html = a.texteHtml ?? a.texte ?? null;
  const legifranceId = a.id ?? null;
  // Titre = chemin de section dans la TOC (les articles de codes n'ont pas
  // de titre propre). Si la TOC est indisponible, on tombe sur les champs
  // directs de l'article (rare mais ça arrive selon le fonds).
  const sectionPath = await lookupSectionPath(codeId, num);
  const title = sectionPath ?? a.fullSectionTitre ?? a.titre ?? null;

  await db
    .insert(legal_mentions)
    .values({
      code: codeId,
      code_name: codeName,
      article_ref: num,
      article_title: title,
      article_html: html,
      legifrance_id: legifranceId,
      fetched_at: new Date(),
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [legal_mentions.code, legal_mentions.article_ref],
      set: {
        article_title: title,
        article_html: html,
        legifrance_id: legifranceId,
        fetched_at: new Date(),
        updated_at: new Date(),
        code_name: codeName,
      },
    });

  return {
    code: codeId,
    code_name: codeName,
    article_ref: num,
    article_title: title,
    article_html: html,
    legifrance_id: legifranceId,
    fetched_at: new Date(),
    source_url: buildSourceUrl(legifranceId, codeId, num),
  };
}

// Lecture cache-first. Fetch PISTE si absent en DB. Renvoie `null` si l'API
// est injoignable ET que rien n'est en base (le caller affichera un fallback).
export async function getOrFetchArticle(codeKey: string, num: string): Promise<LegalArticle | null> {
  const code = resolveCode(codeKey);
  if (!code) return null;

  const [row] = await db
    .select()
    .from(legal_mentions)
    .where(and(eq(legal_mentions.code, code.id), eq(legal_mentions.article_ref, num)))
    .limit(1);

  if (row && row.article_html) {
    return {
      code: row.code,
      code_name: row.code_name,
      article_ref: row.article_ref,
      article_title: row.article_title,
      article_html: row.article_html,
      legifrance_id: row.legifrance_id,
      fetched_at: row.fetched_at,
      source_url: buildSourceUrl(row.legifrance_id, row.code, row.article_ref),
    };
  }

  try {
    return await fetchAndCacheFromPiste(code.id, code.name, num);
  } catch (err) {
    console.warn(`[legifrance] fetch ${codeKey} ${num} échoué:`, (err as Error).message);
    return null;
  }
}

// Force-refresh (utile pour seed/sync job).
export async function refreshArticle(codeKey: string, num: string): Promise<LegalArticle | null> {
  const code = resolveCode(codeKey);
  if (!code) return null;
  try {
    return await fetchAndCacheFromPiste(code.id, code.name, num);
  } catch (err) {
    console.warn(`[legifrance] refresh ${codeKey} ${num} échoué:`, (err as Error).message);
    return null;
  }
}
