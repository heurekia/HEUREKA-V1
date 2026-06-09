// PLU zones fetched from the Géoportail de l'Urbanisme (apicarto.ign.fr/gpu).
// Used by the /mairie/plu-zones route (on-demand) and the nightly cron
// (background refresh of stale entries).
import { db } from "../db.js";
import { communes } from "@heureka-v1/db";
import { eq } from "drizzle-orm";

export const PLU_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
export const PLU_REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // refresh background si > 30 jours

async function fetchWithRetry(url: string, opts: RequestInit, retries = 3, delayMs = 1500): Promise<Response | null> {
  for (let i = 0; i < retries; i++) {
    const r = await fetch(url, opts).catch(() => null);
    if (r?.ok) return r;
    if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
  }
  return null;
}

export type PluZonesGeoJson = { type?: string; features?: unknown[] };

export type PluFetchResult =
  | { ok: true; zones: PluZonesGeoJson }
  | { ok: false; status: number; error: string };

// Fait l'appel complet GPU + persiste en DB. Aucun side-effect HTTP.
// L'appelant gère les fallbacks (cache DB stale, codes d'erreur).
export async function refreshPluZones(inseeCode: string): Promise<PluFetchResult> {
  // Contour commune
  const geoR = await fetchWithRetry(
    `https://geo.api.gouv.fr/communes?code=${encodeURIComponent(inseeCode)}&fields=contour&format=geojson&geometry=contour&limit=1`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!geoR) return { ok: false, status: 502, error: "Erreur geo.api.gouv.fr" };
  type GeoComm = { features?: Array<{ geometry?: { coordinates: number[][][] } }> };
  const fullRing = ((await geoR.json()) as GeoComm).features?.[0]?.geometry?.coordinates[0];
  if (!fullRing?.length) return { ok: false, status: 404, error: "Commune non trouvée" };

  const MAX_PTS = 50;
  let queryRing = fullRing;
  if (fullRing.length > MAX_PTS) {
    const step = Math.ceil((fullRing.length - 1) / (MAX_PTS - 1));
    queryRing = fullRing.filter((_, i) => i % step === 0);
    if (queryRing[queryRing.length - 1] !== fullRing[fullRing.length - 1])
      queryRing.push(fullRing[fullRing.length - 1]!);
  }
  const communeGeom = JSON.stringify({ type: "Polygon", coordinates: [queryRing] });

  const lats = fullRing.map(p => p[1]!), lngs = fullRing.map(p => p[0]!);
  const centroid = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const ptGeom = JSON.stringify({ type: "Point", coordinates: centroid });

  // Identification de la partition (PLU communal, /document, PLUi)
  let partition: string | undefined;

  const candidate = `${inseeCode}_PLU`;
  const r0 = await fetchWithRetry(
    `https://apicarto.ign.fr/api/gpu/zone-urba?partition=${encodeURIComponent(candidate)}&_limit=1`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (r0) { const j = await r0.json() as { features?: unknown[] }; if ((j.features?.length ?? 0) > 0) partition = candidate; }

  if (!partition) {
    const r = await fetchWithRetry(
      `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(ptGeom)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r) {
      type Doc = { features?: Array<{ properties: { partition?: string; etat?: string } }> };
      const docs = ((await r.json()) as Doc).features ?? [];
      const doc = docs.find(f => f.properties.etat === "approuve") ?? docs.find(f => !!f.properties.partition) ?? docs[0];
      partition = doc?.properties.partition ?? undefined;
    }
  }

  if (!partition) {
    const epciR = await fetchWithRetry(
      `https://geo.api.gouv.fr/communes/${encodeURIComponent(inseeCode)}/epcis?fields=code&limit=5`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (epciR) {
      const epcis = (await epciR.json()) as Array<{ code?: string }>;
      for (const epci of epcis) {
        if (!epci.code || partition) continue;
        const cand = `${epci.code}_PLUI`;
        const r = await fetchWithRetry(
          `https://apicarto.ign.fr/api/gpu/zone-urba?partition=${encodeURIComponent(cand)}&_limit=1`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (r) { const j = await r.json() as { features?: unknown[] }; if ((j.features?.length ?? 0) > 0) partition = cand; }
      }
    }
  }

  if (!partition) return { ok: false, status: 404, error: "Aucune zone PLU disponible pour cette commune sur le Géoportail de l'Urbanisme" };

  const params = new URLSearchParams({ partition, _limit: "1000" });
  params.set("geom", communeGeom);
  const zoneR = await fetchWithRetry(
    `https://apicarto.ign.fr/api/gpu/zone-urba?${params.toString()}`,
    { signal: AbortSignal.timeout(25000) }, 2, 2000
  );
  if (!zoneR) return { ok: false, status: 502, error: "Le Géoportail de l'Urbanisme est temporairement indisponible. Réessayez dans quelques instants." };

  const zoneJson = (await zoneR.json()) as PluZonesGeoJson;
  if (!zoneJson.features?.length) return { ok: false, status: 404, error: "Aucune zone PLU disponible pour cette commune sur le Géoportail de l'Urbanisme" };

  // Persistance en base (await pour que la fraîcheur soit garantie au retour)
  await db.update(communes)
    .set({ plu_zones_geojson: zoneJson, plu_zones_cached_at: new Date() })
    .where(eq(communes.insee_code, inseeCode))
    .catch(e => console.error("[plu-zones DB persist]", e));

  return { ok: true, zones: zoneJson };
}

// ETag faible basé sur l'horodatage du cache DB — suffisant pour 304.
export function pluEtagFor(inseeCode: string, cachedAt: Date | null): string | null {
  if (!cachedAt) return null;
  return `W/"plu-${inseeCode}-${cachedAt.getTime()}"`;
}
