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

export type PluDiag = {
  insee: string;
  candidates: Array<{ partition: string; source: string; du_type?: string; etat?: string; probe?: "ok" | "empty" | "failed" }>;
  picked?: string;
  upstreamFailed: boolean;
};

export type PluFetchResult =
  | { ok: true; zones: PluZonesGeoJson; diag: PluDiag }
  | { ok: false; status: number; error: string; diag: PluDiag };

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
  const diag: PluDiag = { insee: inseeCode, candidates: [], upstreamFailed: false };

  // Contour commune
  const geoR = await fetchWithRetry(
    `https://geo.api.gouv.fr/communes?code=${encodeURIComponent(inseeCode)}&fields=contour&format=geojson&geometry=contour&limit=1`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!geoR) return { ok: false, status: 502, error: "Erreur geo.api.gouv.fr", diag };
  type GeoComm = { features?: Array<{ geometry?: { coordinates: number[][][] } }> };
  const fullRing = ((await geoR.json()) as GeoComm).features?.[0]?.geometry?.coordinates[0];
  if (!fullRing?.length) return { ok: false, status: 404, error: "Commune non trouvée", diag };

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

  // ── Collecte des partitions candidates (sans probe à ce stade) ──────────────
  type Cand = { partition: string; source: string; du_type?: string; etat?: string };
  const cands: Cand[] = [];
  const seen = new Set<string>();
  const addCand = (c: Cand) => { if (!seen.has(c.partition)) { seen.add(c.partition); cands.push(c); } };

  // (A) /document — source autoritative
  {
    const r = await fetchWithRetry(
      `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(ptGeom)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r) {
      type Doc = { properties: { partition?: string; etat?: string; gpu_status?: string; du_type?: string } };
      const docs = ((await r.json()) as { features?: Doc[] }).features ?? [];

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

      docs
        .filter(d => !!d.properties.partition)
        .sort((a, b) => {
          if (isInForce(a) !== isInForce(b)) return isInForce(a) ? -1 : 1;
          return duRank(a.properties.du_type) - duRank(b.properties.du_type);
        })
        .forEach(d => addCand({
          partition: d.properties.partition!,
          source: "document",
          du_type: d.properties.du_type,
          etat: d.properties.etat ?? d.properties.gpu_status,
        }));
    } else diag.upstreamFailed = true;
  }

  // (B) Fast-path conventionnel : "<INSEE>_PLU"
  addCand({ partition: `${inseeCode}_PLU`, source: "convention/INSEE_PLU" });

  // (C) Fallback EPCI : "<SIREN>_PLUI" / "<SIREN>_PLU"
  {
    const epciR = await fetchWithRetry(
      `https://geo.api.gouv.fr/communes/${encodeURIComponent(inseeCode)}/epcis?fields=code&limit=5`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (epciR) {
      const epcis = (await epciR.json()) as Array<{ code?: string }>;
      for (const epci of epcis) {
        if (!epci.code) continue;
        addCand({ partition: `${epci.code}_PLUI`, source: "convention/EPCI_PLUI" });
        addCand({ partition: `${epci.code}_PLU`, source: "convention/EPCI_PLU" });
      }
    } else diag.upstreamFailed = true;
  }

  // ── Itère sur les candidats : pour chacun, on tente le fetch RÉEL (avec geom).
  // Si 0 feature, on retombe sur un fetch SANS geom + filtre INSEE local — au
  // cas où le filtre spatial GPU planterait sur un polygone complexe.
  let chosenPartition: string | undefined;
  let chosenZones: PluZonesGeoJson | undefined;

  for (const cand of cands) {
    // Fetch principal : partition + geom commune
    const params1 = new URLSearchParams({ partition: cand.partition, _limit: "1000" });
    params1.set("geom", communeGeom);
    const r1 = await fetchWithRetry(
      `https://apicarto.ign.fr/api/gpu/zone-urba?${params1.toString()}`,
      { signal: AbortSignal.timeout(25000) }, 2, 2000
    );
    if (!r1) {
      diag.upstreamFailed = true;
      diag.candidates.push({ ...cand, probe: "failed" });
      continue;
    }
    const j1 = (await r1.json()) as PluZonesGeoJson;
    if ((j1.features?.length ?? 0) > 0) {
      diag.candidates.push({ ...cand, probe: "ok" });
      chosenPartition = cand.partition;
      chosenZones = j1;
      break;
    }

    // 0 feature avec geom — on retente SANS geom + filtre INSEE local
    const params2 = new URLSearchParams({ partition: cand.partition, _limit: "5000" });
    const r2 = await fetchWithRetry(
      `https://apicarto.ign.fr/api/gpu/zone-urba?${params2.toString()}`,
      { signal: AbortSignal.timeout(25000) }, 2, 2000
    );
    if (!r2) {
      diag.upstreamFailed = true;
      diag.candidates.push({ ...cand, probe: "failed" });
      continue;
    }
    const j2 = (await r2.json()) as PluZonesGeoJson;
    const cleaned2 = filterZonesByInsee(j2, inseeCode);
    if ((cleaned2.features?.length ?? 0) > 0) {
      diag.candidates.push({ ...cand, probe: "ok" });
      chosenPartition = cand.partition;
      chosenZones = cleaned2;
      break;
    }
    diag.candidates.push({ ...cand, probe: "empty" });
  }

  if (!chosenPartition || !chosenZones) {
    console.warn(`[plu-zones] INSEE=${inseeCode} échec — candidats=${JSON.stringify(diag.candidates)} upstreamFailed=${diag.upstreamFailed}`);
    if (diag.upstreamFailed) {
      return { ok: false, status: 502, error: "Le Géoportail de l'Urbanisme est temporairement indisponible. Réessayez dans quelques instants.", diag };
    }
    return { ok: false, status: 404, error: "Aucune zone PLU disponible pour cette commune sur le Géoportail de l'Urbanisme", diag };
  }

  diag.picked = chosenPartition;
  console.log(`[plu-zones] INSEE=${inseeCode} → partition=${chosenPartition} (${chosenZones.features?.length ?? 0} features)`);

  const cleaned = filterZonesByInsee(chosenZones, inseeCode);

  // Persistance en base (await pour que la fraîcheur soit garantie au retour)
  await db.update(communes)
    .set({ plu_zones_geojson: cleaned, plu_zones_cached_at: new Date() })
    .where(eq(communes.insee_code, inseeCode))
    .catch((e: unknown) => console.error("[plu-zones DB persist]", e));

  return { ok: true, zones: cleaned, diag };
}

// ETag faible basé sur l'horodatage du cache DB — suffisant pour 304.
export function pluEtagFor(inseeCode: string, cachedAt: Date | null): string | null {
  if (!cachedAt) return null;
  return `W/"plu-${inseeCode}-${cachedAt.getTime()}"`;
}
