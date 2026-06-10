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
    texte?: string;        // HTML
    texteHtml?: string;    // HTML alternatif selon endpoint
    dateDebut?: number;    // ms epoch
  } | null;
};

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

// Récupère un article depuis l'API Légifrance (PISTE) et upsert dans `legal_mentions`.
async function fetchAndCacheFromPiste(codeId: string, codeName: string, num: string): Promise<LegalArticle> {
  const data = await pistePost<PisteGetArticleResponse>("/consult/getArticleWithIdAndNum", {
    id: codeId,
    num,
  });
  const a = data?.article ?? null;
  if (!a) throw new Error(`Article ${num} introuvable dans ${codeId}`);

  const html  = a.texte ?? a.texteHtml ?? null;
  const title = a.titre ?? a.fullSectionTitre ?? null;
  const legifranceId = a.id ?? null;

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
