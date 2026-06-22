/**
 * Pré-chargement de l'historique SITADEL à la création / mise à jour d'un dossier.
 *
 * SITADEL n'expose qu'un filtre serveur sur la commune (COMM) : retrouver une
 * autorisation précise (ex. une DP de 2022) impose de balayer toutes les lignes
 * de la commune puis de filtrer en mémoire (parcelle / rue). C'est trop coûteux
 * à refaire à chaque ouverture de l'onglet Parcelle, mais raisonnable une fois,
 * en tâche de fond, au moment où le dossier acquiert une localisation. Le
 * résultat est mis en cache dans `dossier.metadata.sitadel_history` et servi
 * instantanément ensuite (cf. route GET /mairie/dossiers/:id/sitadel-history).
 */

import { db } from "../db.js";
import { dossiers, communes } from "@heureka-v1/db";
import { eq, ilike } from "drizzle-orm";
import { fetchSitadelHistory, type SitadelHistoryResult } from "./sitadelHistory.js";

// Lignes balayées par fichier source lors du pré-chargement de fond. Large car
// asynchrone et mis en cache : on accepte d'aller chercher loin dans l'historique
// de la commune pour ne pas rater une autorisation ancienne.
const PREFETCH_MAX_PER_SOURCE = 1000;

// Lignes balayées lors d'un appel interactif (cache absent, scope forcé, ou
// rafraîchissement). Plus modeste pour borner la latence de l'onglet.
export const INTERACTIVE_MAX_PER_SOURCE = 300;

// Durée de validité du snapshot. SITADEL est consolidée mensuellement et un
// dossier s'instruit sur quelques semaines ; au-delà, l'onglet retente un appel
// live (un `?refresh=1` force le re-fetch à tout moment).
export const SITADEL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SitadelHistoryCache {
  result: SitadelHistoryResult;
  insee_code: string;
  scope: "auto";
  fetched_at: string; // ISO 8601
}

type DossierLocation = Pick<
  typeof dossiers.$inferSelect,
  "metadata" | "commune" | "parcelle" | "adresse"
>;

export interface ResolvedSitadelQuery {
  insee_code: string;
  cadastre: Array<{ section: string; numero: string }>;
  street: string | null;
}

/**
 * Résout INSEE + cadastre + rue depuis un dossier. Priorité au cache
 * `parcel_analysis` (précis), sinon repli sur le nom de commune et le champ
 * `parcelle`. Mutualisé entre le pré-chargement et la route GET sitadel-history.
 * Retourne `null` si l'INSEE n'est pas résolvable (dossier sans localisation).
 */
export async function resolveSitadelQueryForDossier(
  dossier: DossierLocation,
): Promise<ResolvedSitadelQuery | null> {
  const meta = (dossier.metadata ?? {}) as Record<string, unknown>;
  const pa = meta["parcel_analysis"] as
    | { parcel?: { code_insee?: string; section?: string; numero?: string } }
    | undefined;

  // INSEE — priorité au cache analyse, sinon lookup exact (case-insensitive)
  // sur le nom de commune.
  let inseeCode: string | undefined = pa?.parcel?.code_insee;
  if (!inseeCode && dossier.commune) {
    const [communeRow] = await db
      .select({ insee_code: communes.insee_code })
      .from(communes)
      .where(ilike(communes.name, dossier.commune))
      .limit(1);
    inseeCode = communeRow?.insee_code ?? undefined;
  }
  if (!inseeCode) return null;

  // Cadastre — section/numéro pour filtrer sur la parcelle.
  const cadastre: Array<{ section: string; numero: string }> = [];
  if (pa?.parcel?.section && pa?.parcel?.numero) {
    cadastre.push({ section: pa.parcel.section, numero: pa.parcel.numero });
  } else if (dossier.parcelle) {
    // ex. "AB 142" ou "AB142" → { section: AB, numero: 142 }
    const m = /^([A-Z]{1,2})\s*0*(\d{1,4})$/i.exec(dossier.parcelle.trim());
    if (m && m[1] && m[2]) cadastre.push({ section: m[1].toUpperCase(), numero: m[2] });
  }

  // Rue / lieu-dit — extrait de l'adresse libre (avant la 1re virgule, pour
  // éviter d'embarquer code postal et commune).
  let street: string | null = null;
  if (dossier.adresse) {
    const firstPart = dossier.adresse.split(",")[0]?.trim() ?? "";
    if (firstPart.length > 0) street = firstPart;
  }

  return { insee_code: inseeCode, cadastre, street };
}

/**
 * Écrit le snapshot dans `metadata.sitadel_history` en read-modify-write :
 * on relit le metadata juste avant l'écriture pour ne pas écraser une mise à
 * jour concurrente (analyse parcellaire, servitudes…).
 */
export async function persistSitadelCache(
  dossierId: string,
  cache: SitadelHistoryCache,
): Promise<void> {
  const [fresh] = await db
    .select({ metadata: dossiers.metadata })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);
  if (!fresh) return;
  const meta = (fresh.metadata ?? {}) as Record<string, unknown>;
  await db
    .update(dossiers)
    .set({ metadata: { ...meta, sitadel_history: cache } })
    .where(eq(dossiers.id, dossierId));
}

/**
 * Pré-charge et met en cache l'historique SITADEL d'un dossier. Best-effort :
 * silencieux (no-op) si l'INSEE n'est pas résolvable — typiquement un brouillon
 * sans adresse ni commune. À appeler sans `await` après la création / mise à
 * jour, comme `attachCerfaToDossier`.
 */
export async function prefetchSitadelHistory(dossierId: string): Promise<void> {
  const [dossier] = await db
    .select({
      metadata: dossiers.metadata,
      commune: dossiers.commune,
      parcelle: dossiers.parcelle,
      adresse: dossiers.adresse,
    })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);
  if (!dossier) return;

  const q = await resolveSitadelQueryForDossier(dossier);
  if (!q) return; // pas d'INSEE → rien à pré-charger

  const result = await fetchSitadelHistory({
    insee_code: q.insee_code,
    cadastre: q.cadastre,
    street: q.street,
    scope: "auto",
    maxPerSource: PREFETCH_MAX_PER_SOURCE,
  });

  await persistSitadelCache(dossierId, {
    result,
    insee_code: q.insee_code,
    scope: "auto",
    fetched_at: new Date().toISOString(),
  });
}
