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

type ZoneFeature = { properties?: { insee?: string; partition?: string; typezone?: string } };

// Garde uniquement les zones dont la propriété `insee` correspond à la commune.
// Pour les PLUi, le filtre `geom` du GPU laisse passer les zones limitrophes
// (intersection vs containment) — on les retire ici.
// Si aucune feature ne porte d'INSEE (vieux dataset), on garde tout en
// fallback pour ne pas vider la carte.
export function filterZonesByInsee(zones: PluZonesGeoJson, inseeCode: string): PluZonesGeoJson {
  const features = (zones.features ?? []) as ZoneFeature[];
  const withInsee = features.filter(f => !!f.properties?.insee);
  if (withInsee.length === 0) return zones;
  const filtered = withInsee.filter(f => f.properties?.insee === inseeCode);
  if (filtered.length === 0) return zones;
  return { ...zones, features: filtered };
}

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

  // ── Identification de la partition ──────────────────────────────────────────
  // Tracke les pannes upstream pour distinguer "API GPU en vrac" (retry-worthy)
  // de "vraiment pas de PLU pour cette commune" (404 stable).
  let upstreamFailed = false;
  let partition: string | undefined;
  const tried: string[] = []; // pour logs diagnostiques

  // Probe une partition AVEC le polygone commune. On veut une partition qui
  // contient au moins une zone INTERSECTANT notre commune, pas juste une
  // partition qui existe globalement (ex: une PLUi voisine qui aurait été
  // mal référencée).
  const probeForCommune = async (part: string): Promise<number> => {
    tried.push(part);
    const r = await fetchWithRetry(
      `https://apicarto.ign.fr/api/gpu/zone-urba?partition=${encodeURIComponent(part)}&_limit=1&geom=${encodeURIComponent(communeGeom)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r) return -1;
    const j = (await r.json()) as { features?: unknown[] };
    return j.features?.length ?? 0;
  };

  // A) Fast-path : PLU communal "<INSEE>_PLU".
  {
    const cand = `${inseeCode}_PLU`;
    const n = await probeForCommune(cand);
    if (n > 0) partition = cand;
    else if (n < 0) upstreamFailed = true;
  }

  // B) Endpoint /document : liste autoritative des documents d'urbanisme couvrant
  // le centroïde. Pour les communes en PLUi (ex: Tours, Métropole), c'est ici
  // qu'on récupère la bonne partition.
  if (!partition) {
    const r = await fetchWithRetry(
      `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(ptGeom)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r) {
      type Doc = { properties: { partition?: string; etat?: string; gpu_status?: string; du_type?: string } };
      const docs = ((await r.json()) as { features?: Doc[] }).features ?? [];

      // Tri par préférence — mais on ne filtre PAS : si du_type est absent ou
      // d'une casse inattendue, on essaie quand même. C'était la cause des
      // 404 sur "bon nombre de villes".
      const DU_PRIORITY = ["PLUI", "PLUIH", "PLU", "POS", "CC", "PSMV"];
      const duRank = (s?: string) => {
        const i = DU_PRIORITY.indexOf((s ?? "").toUpperCase());
        return i < 0 ? 99 : i;
      };
      const isInForce = (d: Doc) => {
        const e = (d.properties.etat ?? "").toLowerCase();
        const g = (d.properties.gpu_status ?? "").toLowerCase();
        return e === "approuve" || e === "opposable" || g.includes("opposable");
      };

      const candidates = docs
        .filter(d => !!d.properties.partition)
        .sort((a, b) => {
          if (isInForce(a) !== isInForce(b)) return isInForce(a) ? -1 : 1;
          return duRank(a.properties.du_type) - duRank(b.properties.du_type);
        });

      // Probe chaque candidat avec le filtre géo de la commune → garantit que
      // la partition choisie contient bien des zones DANS notre commune.
      for (const cand of candidates) {
        const part = cand.properties.partition!;
        const n = await probeForCommune(part);
        if (n > 0) { partition = part; break; }
        if (n < 0) upstreamFailed = true;
      }
    } else upstreamFailed = true;
  }

  // C) PLUi intercommunal : récupère le SIREN de l'EPCI → "<SIREN>_PLUI".
  // Fallback si /document n'a rien donné (API GPU instable ou data manquante).
  if (!partition) {
    const epciR = await fetchWithRetry(
      `https://geo.api.gouv.fr/communes/${encodeURIComponent(inseeCode)}/epcis?fields=code&limit=5`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (epciR) {
      const epcis = (await epciR.json()) as Array<{ code?: string }>;
      for (const epci of epcis) {
        if (!epci.code || partition) continue;
        for (const suffix of ["_PLUI", "_PLU"]) {
          const cand = `${epci.code}${suffix}`;
          const n = await probeForCommune(cand);
          if (n > 0) { partition = cand; break; }
          if (n < 0) upstreamFailed = true;
        }
        if (partition) break;
      }
    } else upstreamFailed = true;
  }

  if (!partition) {
    console.warn(`[plu-zones] INSEE=${inseeCode} : aucune partition trouvée. Sondes tentées : ${tried.join(", ") || "(none)"}. upstreamFailed=${upstreamFailed}`);
  } else {
    console.log(`[plu-zones] INSEE=${inseeCode} → partition=${partition} (après ${tried.length} sonde(s))`);
  }

  if (!partition) {
    if (upstreamFailed) {
      return { ok: false, status: 502, error: "Le Géoportail de l'Urbanisme est temporairement indisponible. Réessayez dans quelques instants." };
    }
    return { ok: false, status: 404, error: "Aucune zone PLU disponible pour cette commune sur le Géoportail de l'Urbanisme" };
  }

  // ── Récupération des zones filtrées par partition + polygone commune ────────
  const params = new URLSearchParams({ partition, _limit: "1000" });
  params.set("geom", communeGeom);
  const zoneR = await fetchWithRetry(
    `https://apicarto.ign.fr/api/gpu/zone-urba?${params.toString()}`,
    { signal: AbortSignal.timeout(25000) }, 2, 2000
  );
  if (!zoneR) return { ok: false, status: 502, error: "Le Géoportail de l'Urbanisme est temporairement indisponible. Réessayez dans quelques instants." };

  const zoneJson = (await zoneR.json()) as PluZonesGeoJson;
  if (!zoneJson.features?.length) return { ok: false, status: 404, error: "Aucune zone PLU disponible pour cette commune sur le Géoportail de l'Urbanisme" };

  const cleaned = filterZonesByInsee(zoneJson, inseeCode);

  // Persistance en base (await pour que la fraîcheur soit garantie au retour)
  await db.update(communes)
    .set({ plu_zones_geojson: cleaned, plu_zones_cached_at: new Date() })
    .where(eq(communes.insee_code, inseeCode))
    .catch((e: unknown) => console.error("[plu-zones DB persist]", e));

  return { ok: true, zones: cleaned };
}

// ETag faible basé sur l'horodatage du cache DB — suffisant pour 304.
export function pluEtagFor(inseeCode: string, cachedAt: Date | null): string | null {
  if (!cachedAt) return null;
  return `W/"plu-${inseeCode}-${cachedAt.getTime()}"`;
}
