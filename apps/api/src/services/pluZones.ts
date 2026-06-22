// PLU zones fetched from the Géoportail de l'Urbanisme (apicarto.ign.fr/gpu).
// Used by the /mairie/plu-zones route (on-demand) and the nightly cron
// (background refresh of stale entries).
//
// This file is the canonical source of truth for PLU resolution by INSEE :
//  - refreshPluZones        : multi-convention probe + persistence (heavy)
//  - getCommunePluContext   : cache-aside read returning partition + zones
//  - findZoneAtPoint        : pure point-in-polygon over cached zones (free)
//
// parcelAnalysis uses these to escape the fragility of point-based /document
// lookups : a single robust commune-level resolve, then local hit-tests.
import type { Geometry, Polygon, MultiPolygon, Feature, Position } from "geojson";
import polygonClipping from "polygon-clipping";
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
  | { ok: true; zones: PluZonesGeoJson; partition: string; diag: PluDiag }
  | { ok: false; status: number; error: string; diag: PluDiag };

// Raison stable d'absence de PLU pour la commune. NULL = succès, ou échec
// transient sans diagnostic clair.
export type PluUnavailableReason = "not_in_gpu" | "gpu_error";

type ZoneFeature = {
  properties?: { insee?: string; partition?: string; typezone?: string; libelle?: string; libelong?: string; nomfic?: string; urba_etat?: string };
  geometry?: Geometry;
};

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

// Découpe (intersection géométrique) les zones PLU sur le contour communal.
// Le paramètre `geom` du GPU est un filtre d'INTERSECTION : l'API renvoie les
// polygones de zone ENTIERS dès qu'ils touchent l'emprise, donc les zones de
// bordure (et les zones limitrophes des PLUi) débordent du contour. On les
// rogne ici sur la géométrie communale pleine résolution pour un rendu net dans
// la délimitation de la ville. C'est aussi plus robuste que `filterZonesByInsee` :
// une zone d'une autre commune est retirée géométriquement, même quand la
// propriété `insee` est absente (vieux datasets).
//
// ⚠️ Décision INCLUSION vs DÉCOUPE séparées :
//  - L'inclusion (la zone appartient-elle à la commune ?) est décidée par un
//    test robuste de recouvrement (ray-casting bidirectionnel). On NE se fie
//    PAS au résultat de polygon-clipping pour ça : sur certaines géométries GPU
//    (petites zones U/AU du bourg), polygon-clipping renvoie un résultat VIDE
//    alors que la zone est bien dans la commune → c'est ce qui faisait
//    disparaître le zonage du bourg.
//  - La découpe ne sert qu'à obtenir un bord net. Si elle échoue (retour vide
//    ou exception), on CONSERVE la zone entière plutôt que de la perdre.
// Résultat :
//  - zone sans recouvrement (commune voisine)   → retirée
//  - zone qui recouvre, découpe OK              → rognée au contour
//  - zone qui recouvre, découpe KO              → conservée entière
//  - feature sans géométrie polygonale          → conservée telle quelle
const geomBbox = (geom: Polygon | MultiPolygon): [number, number, number, number] => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys: number[][][][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) for (const ring of poly) for (const p of ring) {
    const x = p[0]!, y = p[1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
};

const bboxOverlap = (a: number[], b: number[]): boolean =>
  a[0]! <= b[2]! && a[2]! >= b[0]! && a[1]! <= b[3]! && a[3]! >= b[1]!;

// Vrai si zone et commune se recouvrent. Couvre les 3 cas : zone incluse dans la
// commune, zone à cheval sur la limite, et commune entièrement contenue dans une
// grande zone (A/N d'un PLUi).
const geomsOverlap = (zone: Polygon | MultiPolygon, commune: Polygon | MultiPolygon): boolean => {
  const polysC: number[][][][] = commune.type === "Polygon" ? [commune.coordinates] : commune.coordinates;
  for (const poly of polysC) for (const ring of poly) for (const p of ring)
    if (pointInPolygonGeom(p[0]!, p[1]!, zone)) return true;
  const polysZ: number[][][][] = zone.type === "Polygon" ? [zone.coordinates] : zone.coordinates;
  for (const poly of polysZ) for (const ring of poly) for (const p of ring)
    if (pointInPolygonGeom(p[0]!, p[1]!, commune)) return true;
  return false;
};

export function clipZonesToCommune(zones: PluZonesGeoJson, communeGeom: Polygon | MultiPolygon): PluZonesGeoJson {
  type Geom = Parameters<typeof polygonClipping.intersection>[0];
  const mask = communeGeom.coordinates as unknown as Geom;
  const communeBbox = geomBbox(communeGeom);
  const debug = process.env.PLU_DEBUG === "1";
  if (debug) {
    let nPts = 0;
    const polys: number[][][][] = communeGeom.type === "Polygon" ? [communeGeom.coordinates] : communeGeom.coordinates;
    for (const poly of polys) for (const ring of poly) nPts += ring.length;
    console.log(`[clip] COMMUNE type=${communeGeom.type} rings=${polys.reduce((a, p) => a + p.length, 0)} pts=${nPts} bbox=${JSON.stringify(communeBbox.map(n => +n.toFixed(4)))}`);
  }
  const out: unknown[] = [];
  for (const f of (zones.features ?? []) as ZoneFeature[]) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) {
      out.push(f);
      continue;
    }
    const zoneGeom = g as Polygon | MultiPolygon;
    const zb = geomBbox(zoneGeom);
    const bbOk = bboxOverlap(zb, communeBbox);
    const ovOk = bbOk && geomsOverlap(zoneGeom, communeGeom);
    if (debug) console.log(`[clip] ${f.properties?.libelle ?? "?"} bbox=${bbOk} overlap=${ovOk} zbbox=${JSON.stringify(zb.map(n => +n.toFixed(4)))}`);
    // Rejet rapide des zones clairement disjointes (limitrophes du PLUi), puis
    // inclusion robuste : si la zone ne recouvre pas la commune → on la retire.
    if (!bbOk || !ovOk) continue;
    // Découpe pour le bord. Si polygon-clipping rate (vide/throw) → zone entière.
    try {
      const clipped = polygonClipping.intersection(g.coordinates as unknown as Geom, mask);
      if (clipped.length > 0) {
        out.push({ ...f, geometry: { type: "MultiPolygon", coordinates: clipped as unknown as Position[][][] } });
        continue;
      }
    } catch { /* conserve la zone entière ci-dessous */ }
    out.push(f);
  }
  return { ...zones, features: out };
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
  type GeoComm = { features?: Array<{ geometry?: Polygon | MultiPolygon }> };
  const communeGeometry = ((await geoR.json()) as GeoComm).features?.[0]?.geometry;
  if (!communeGeometry) return { ok: false, status: 404, error: "Commune non trouvée", diag };
  // Anneau extérieur (1er polygone) pour la requête GPU : filet large, simplifié
  // ensuite à 50 pts. La découpe finale, elle, utilise la géométrie COMPLÈTE.
  const fullRing = communeGeometry.type === "Polygon"
    ? communeGeometry.coordinates[0]
    : communeGeometry.coordinates[0]?.[0];
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

  // Emprise (bbox) de la commune → rectangle à 5 points pour la requête zone-urba.
  // ⚠️ On N'interroge PAS le GPU avec le contour décimé : l'échantillonnage brut
  // d'indices (i % step) produit fréquemment un polygone AUTO-SÉCANT, et
  // GeoServer renvoie alors un `INTERSECTS(the_geom, …)` incomplet — il perd les
  // petites zones intérieures (U/AU du bourg) en ne gardant que les grandes (A/N).
  // Un rectangle est toujours valide et contient À COUP SÛR toutes les zones de
  // la commune ; on les rogne ensuite au contour exact (clipZonesToCommune).
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const scanRing = (ring: number[][]) => {
    for (const p of ring) {
      const lon = p[0]!, lat = p[1]!;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };
  if (communeGeometry.type === "Polygon") communeGeometry.coordinates.forEach(scanRing);
  else communeGeometry.coordinates.forEach(poly => poly.forEach(scanRing));
  const bboxGeom = JSON.stringify({
    type: "Polygon",
    coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
  });

  // ── Collecte des partitions candidates (sans probe à ce stade) ──────────────
  type Cand = { partition: string; source: string; du_type?: string; etat?: string };
  const cands: Cand[] = [];
  const seen = new Set<string>();
  const addCand = (c: Cand) => { if (!seen.has(c.partition)) { seen.add(c.partition); cands.push(c); } };

  // (A) /document — source autoritative
  // On envoie le POLYGONE commune (pas juste le centroïde) : le centroïde
  // peut tomber sur un cours d'eau, une zone non couverte, etc., ce qui
  // ferait revenir 0 docs alors qu'un PLU existe pour la commune.
  // ⚠️ Pour les grandes communes (Tours), le polygone touche les communes
  // limitrophes, donc /document peut renvoyer leurs docs (DU_37179 =
  // Parçay-Meslay quand on cherche Tours 37261). On filtre : si le partition
  // contient un INSEE explicite ET que ce n'est pas le nôtre, on rejette.
  {
    const r = await fetchWithRetry(
      `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(communeGeom)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (r) {
      // ⚠️ Le champ de type est `typedoc` (pas `du_type`) avec des valeurs
      // comme "PLU", "PLUi" (i minuscule), "CC", "PIG", "RNU", "POS", "PSMV".
      type Doc = { properties: { partition?: string; etat?: string; gpu_status?: string; typedoc?: string } };
      const docs = ((await r.json()) as { features?: Doc[] }).features ?? [];

      const PLU_TYPES_PRIORITY = ["PLUI", "PLUIH", "PLU", "POS", "CC", "PIG", "PSMV"];
      const typeRank = (s?: string) => {
        const i = PLU_TYPES_PRIORITY.indexOf((s ?? "").toUpperCase());
        return i < 0 ? 99 : i;
      };
      const isInForce = (d: Doc) => {
        const e = (d.properties.etat ?? "").toLowerCase();
        const g = (d.properties.gpu_status ?? "").toLowerCase();
        return e === "approuve" || e === "opposable" || g.includes("opposable");
      };

      // Rejette les partitions d'autres communes : DU_37179 quand on cherche 37261.
      const INSEE_RE = /(?:^|[_-])(\d{5})(?:[_-]|$)/;
      const partitionTargetsOtherCommune = (part: string): boolean => {
        const m = part.match(INSEE_RE);
        return m !== null && m[1] !== inseeCode;
      };

      docs
        .filter(d => !!d.properties.partition && !partitionTargetsOtherCommune(d.properties.partition!))
        .sort((a, b) => {
          if (isInForce(a) !== isInForce(b)) return isInForce(a) ? -1 : 1;
          return typeRank(a.properties.typedoc) - typeRank(b.properties.typedoc);
        })
        .forEach(d => addCand({
          partition: d.properties.partition!,
          source: "document",
          du_type: d.properties.typedoc,
          etat: d.properties.etat ?? d.properties.gpu_status,
        }));
    } else diag.upstreamFailed = true;
  }

  // (B) Conventions PLU communal (essayer les deux formats connus)
  addCand({ partition: `DU_${inseeCode}`, source: "convention/DU_INSEE" });
  addCand({ partition: `${inseeCode}_PLU`, source: "convention/INSEE_PLU" });

  // (C) Fallback EPCI : "<SIREN>_PLUI" / "<SIREN>_PLU"
  // On utilise /communes/{insee}?fields=codeEpci en premier (plus stable que
  // /communes/{insee}/epcis qui renvoie parfois vide ou 404).
  {
    let epciSiren: string | undefined;

    const r1 = await fetchWithRetry(
      `https://geo.api.gouv.fr/communes/${encodeURIComponent(inseeCode)}?fields=codeEpci`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r1) {
      const j = (await r1.json()) as { codeEpci?: string };
      if (j.codeEpci) epciSiren = j.codeEpci;
    } else diag.upstreamFailed = true;

    // Fallback : /epcis (au cas où codeEpci ne soit pas remonté)
    if (!epciSiren) {
      const r2 = await fetchWithRetry(
        `https://geo.api.gouv.fr/communes/${encodeURIComponent(inseeCode)}/epcis?fields=code&limit=5`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r2) {
        const epcis = (await r2.json()) as Array<{ code?: string }>;
        epciSiren = epcis.find(e => !!e.code)?.code;
      } else diag.upstreamFailed = true;
    }

    if (epciSiren) {
      addCand({ partition: `DU_${epciSiren}`, source: "convention/DU_SIREN" });
      addCand({ partition: `${epciSiren}_PLUI`, source: "convention/EPCI_PLUI" });
      addCand({ partition: `${epciSiren}_PLU`, source: "convention/EPCI_PLU" });
    }
  }

  // ── Itère sur les candidats : pour chacun, on tente le fetch RÉEL (avec geom).
  // Si 0 feature, on retombe sur un fetch SANS geom + filtre INSEE local — au
  // cas où le filtre spatial GPU planterait sur un polygone complexe.
  let chosenPartition: string | undefined;
  let chosenZones: PluZonesGeoJson | undefined;

  // Vérifie que les features rapatriées concernent BIEN notre commune.
  // Quand /document retourne un partition voisin (DU_37179 pour Tours), le
  // fetch zone-urba ramène les zones de Parçay-Meslay (idurba=37179_PLU_…).
  // On rejette si les features ont un idurba qui commence par un INSEE
  // différent du nôtre.
  type FeatProps = { idurba?: string; insee?: string | null };
  const featuresMatchCommune = (zones: PluZonesGeoJson): boolean => {
    const feats = (zones.features ?? []) as Array<{ properties?: FeatProps }>;
    if (feats.length === 0) return false;
    let anyMismatch = false;
    let anyMatch = false;
    for (const f of feats) {
      const idurba = f.properties?.idurba ?? "";
      const insee = f.properties?.insee;
      // idurba conventionnel : "<INSEE>_PLU_<date>" ou "DU_<INSEE>" — on cherche
      // un INSEE 5 chiffres au début (avec ou sans préfixe DU_).
      const m = idurba.match(/^(?:DU_)?(\d{5})(?:[_-]|$)/);
      if (m) {
        if (m[1] === inseeCode) anyMatch = true;
        else anyMismatch = true;
      }
      if (insee === inseeCode) anyMatch = true;
      else if (insee && insee !== inseeCode) anyMismatch = true;
    }
    // Si on a une preuve qu'au moins une feature concerne notre commune → OK.
    // Sinon, si toutes les features pointent ailleurs → rejet.
    // Cas ambigu (pas de marqueur du tout) → on accepte (filtre spatial GPU
    // a déjà fait son travail).
    if (anyMatch) return true;
    if (anyMismatch) return false;
    return true;
  };

  for (const cand of cands) {
    // Fetch principal : partition + emprise bbox (rectangle valide, cf. plus haut).
    // _limit aligné sur la limite dure de l'API GPU (5000) pour ne pas tronquer
    // silencieusement les communes denses / PLUi.
    const params1 = new URLSearchParams({ partition: cand.partition, _limit: "5000" });
    params1.set("geom", bboxGeom);
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
    if ((j1.features?.length ?? 0) > 0 && featuresMatchCommune(j1)) {
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
    if ((cleaned2.features?.length ?? 0) > 0 && featuresMatchCommune(cleaned2)) {
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
      // Erreur transient : on ne marque PAS unavailable_reason (laisse retenter).
      return { ok: false, status: 502, error: "Le Géoportail de l'Urbanisme est temporairement indisponible. Réessayez dans quelques instants.", diag };
    }
    // Diagnostic stable : aucune partition n'a fonctionné alors que le GPU répondait.
    // On grave cet état pour court-circuiter les futures tentatives jusqu'au prochain
    // refresh (cron nocturne ou ?refresh=1 manuel).
    await db.update(communes)
      .set({ plu_unavailable_reason: "not_in_gpu", plu_zones_cached_at: new Date() })
      .where(eq(communes.insee_code, inseeCode))
      .catch((e: unknown) => console.error("[plu-zones DB persist]", e));
    return { ok: false, status: 404, error: "Aucune zone PLU disponible pour cette commune sur le Géoportail de l'Urbanisme", diag };
  }

  diag.picked = chosenPartition;
  console.log(`[plu-zones] INSEE=${inseeCode} → partition=${chosenPartition} (${chosenZones.features?.length ?? 0} features)`);

  const cleaned = filterZonesByInsee(chosenZones, inseeCode);

  // Découpe au contour PLEINE RÉSOLUTION (fullRing, pas la version simplifiée à
  // 50 pts utilisée pour la requête GPU) : garantit que les zones ne débordent
  // pas de la délimitation de la ville. Garde-fou anti-carte-vide : si la
  // découpe retire tout (contour pathologique), on conserve le non-rogné.
  const clippedZones = clipZonesToCommune(cleaned, communeGeometry);
  const finalZones = (clippedZones.features?.length ?? 0) > 0 ? clippedZones : cleaned;

  // Diagnostic : répartition des libellés à chaque étape (fetch → insee → clip).
  // Permet de localiser où d'éventuelles zones (U/AU du bourg) sont perdues.
  const libCount = (z: PluZonesGeoJson): string => {
    const m: Record<string, number> = {};
    for (const f of (z.features ?? []) as ZoneFeature[]) {
      const l = f.properties?.libelle ?? "?";
      m[l] = (m[l] ?? 0) + 1;
    }
    return JSON.stringify(m);
  };
  console.log(`[plu-zones diag] INSEE=${inseeCode} fetched=${libCount(chosenZones)} cleaned=${libCount(cleaned)} final=${libCount(finalZones)}`);

  // Persistance en base (await pour que la fraîcheur soit garantie au retour).
  // On stocke aussi la partition gagnante : `parcelAnalysis` la réutilise pour
  // ses sous-requêtes (zone-urba, prescription-surf, info-surf) sans refaire
  // la découverte point par point — c'est cette persistance qui ferme le mode
  // d'échec "PLU existe mais convention de nommage non-standard".
  await db.update(communes)
    .set({
      plu_zones_geojson: finalZones,
      plu_zones_cached_at: new Date(),
      plu_partition: chosenPartition,
      plu_unavailable_reason: null,
    })
    .where(eq(communes.insee_code, inseeCode))
    .catch((e: unknown) => console.error("[plu-zones DB persist]", e));

  return { ok: true, zones: finalZones, partition: chosenPartition, diag };
}

// ETag faible basé sur l'horodatage du cache DB — suffisant pour 304.
export function pluEtagFor(inseeCode: string, cachedAt: Date | null): string | null {
  if (!cachedAt) return null;
  return `W/"plu-${inseeCode}-${cachedAt.getTime()}"`;
}

// ── Point-in-polygon : trouve la zone PLU contenant un point ─────────────────
// Pure helper, déterministe, immunisé contre les bizarreries spatiales de l'IGN.
// Utilisé comme :
//  - chemin nominal pour parcelAnalysis quand le cache commune est frais
//    (1 appel DB + hit-test local au lieu de N appels GPU)
//  - fallback ultime quand /zone-urba?geom=Point renvoie 0 feature alors
//    qu'on sait qu'une zone existe (cas du point géocodé sur voirie)

// Ray-casting sur un ring (anneau extérieur ou trou). Coordonnées GeoJSON [lng, lat].
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    const xi = a[0]!, yi = a[1]!;
    const xj = b[0]!, yj = b[1]!;
    // Demi-droite horizontale vers +∞ : compte les croisements avec [a,b].
    const crosses = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

// Un Polygon vaut « contenant » si le point est dans le ring extérieur ET dans
// AUCUN trou. Un MultiPolygon : au moins un sous-Polygon le contient.
function pointInPolygonGeom(lng: number, lat: number, geom: Polygon | MultiPolygon): boolean {
  const polys: number[][][][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    const outer = poly[0];
    if (!outer || !pointInRing(lng, lat, outer)) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) {
      if (pointInRing(lng, lat, poly[h]!)) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

export type ZoneAtPoint = {
  zone_code: string;
  zone_label: string;
  zone_type: string;   // "U" | "AU" | "A" | "N" — première lettre de typezone
  plu_nom?: string;
  plu_etat?: string;
  geometry: Geometry;
};

// Cherche la première feature du GeoJSON dont la géométrie contient (lat, lng).
// Renvoie null si aucune zone ne couvre le point (zone non zonée, ou point
// strictement hors commune).
export function findZoneAtPoint(zones: PluZonesGeoJson | null | undefined, lat: number, lng: number): ZoneAtPoint | null {
  const feats = (zones?.features ?? []) as Array<Feature & { properties?: ZoneFeature["properties"] }>;
  for (const f of feats) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    if (!pointInPolygonGeom(lng, lat, g as Polygon | MultiPolygon)) continue;
    const p = f.properties ?? {};
    const code = p.libelle ?? "";
    const type = (p.typezone ?? "U").charAt(0) || "U";
    return {
      zone_code: code,
      zone_label: p.libelong || code,
      zone_type: type,
      plu_nom: p.nomfic,
      plu_etat: p.urba_etat,
      geometry: g,
    };
  }
  return null;
}

// ── Résolution surfacique : zones d'une parcelle (parcelle ∩ zones) ──────────
// findZoneAtPoint résout au POINT : il renvoie la PREMIÈRE zone contenant un
// point (centroïde/adresse), ce qui (a) masque les parcelles à cheval et (b)
// peut désigner la mauvaise zone quand le point tombe en limite. findZonesForParcel
// intersecte la GÉOMÉTRIE de la parcelle avec chaque zone et renvoie TOUTES les
// zones touchées avec leur part d'aire — déterministe, et fidèle à la règle
// « la plus stricte s'applique par partie ».

// Aire géodésique (m²), formule d'excès sphérique — identique à `turf.area` et à
// buildingFootprint.polygonAreaM2. Gardée locale : ce module porte déjà ses
// propres primitives géométriques (cf. pointInRing) pour rester autonome. Seul
// le RATIO d'aires nous intéresse ici, donc l'approximation sphérique suffit
// largement à l'échelle parcellaire. Anneaux en [lng, lat] degrés.
const EARTH_RADIUS_M = 6378137;
function ringAreaM2(ring: number[][]): number {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i]!, p2 = ring[(i + 1) % ring.length]!;
    total += ((p2[0]! - p1[0]!) * Math.PI / 180) *
      (2 + Math.sin((p1[1]! * Math.PI) / 180) + Math.sin((p2[1]! * Math.PI) / 180));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}
function polygonAreaM2(geom: Polygon | MultiPolygon): number {
  const polys: number[][][][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let area = 0;
  for (const poly of polys) {
    if (!poly.length) continue;
    let a = ringAreaM2(poly[0]!);
    for (let i = 1; i < poly.length; i++) a -= ringAreaM2(poly[i]!); // soustrait les trous
    area += Math.max(0, a);
  }
  return area;
}

export type ZoneCoverage = ZoneAtPoint & {
  /** Part de l'aire de la parcelle couverte par cette zone, en % (0..100). */
  couverture_pct: number;
};

export type ParcelZoning = {
  /** Zones couvrant une part matérielle de la parcelle, triées par couverture décroissante. */
  zones: ZoneCoverage[];
  /** Zone de plus grande couverture (null si la parcelle n'intersecte aucune zone). */
  dominant: ZoneCoverage | null;
  /** Vrai si ≥ 2 zones couvrent chacune une part matérielle (parcelle à cheval). */
  a_cheval: boolean;
};

// En-deçà de ce seuil, une intersection parcelle∩zone est un artefact de
// numérisation (bords de polygones quasi-confondus), pas un vrai chevauchement.
// On la retire pour ne pas lever de faux drapeau « à cheval ».
const COVERAGE_SLIVER_PCT = 1;

/**
 * Résout TOUTES les zones PLU touchées par une parcelle, avec leur % de
 * couverture surfacique. Corrige le biais du point unique : détecte les
 * parcelles à cheval et désigne une zone dominante stable (par aire) au lieu de
 * la première zone contenant un point. Pur et déterministe ; renvoie un zonage
 * vide si la géométrie parcellaire manque ou n'est pas surfacique.
 */
export function findZonesForParcel(
  zones: PluZonesGeoJson | null | undefined,
  parcelGeom: Geometry | null | undefined,
): ParcelZoning {
  const empty: ParcelZoning = { zones: [], dominant: null, a_cheval: false };
  if (!parcelGeom || (parcelGeom.type !== "Polygon" && parcelGeom.type !== "MultiPolygon")) return empty;
  const parcel = parcelGeom as Polygon | MultiPolygon;
  const parcelArea = polygonAreaM2(parcel);
  if (parcelArea <= 0) return empty;

  type Geom = Parameters<typeof polygonClipping.intersection>[0];
  const parcelClip = parcel.coordinates as unknown as Geom;
  const parcelBbox = geomBbox(parcel);

  const feats = (zones?.features ?? []) as Array<Feature & { properties?: ZoneFeature["properties"] }>;
  const covered: ZoneCoverage[] = [];
  for (const f of feats) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    if (!bboxOverlap(geomBbox(g as Polygon | MultiPolygon), parcelBbox)) continue; // rejet rapide
    let interArea = 0;
    try {
      const inter = polygonClipping.intersection(parcelClip, g.coordinates as unknown as Geom);
      if (inter.length > 0) {
        interArea = polygonAreaM2({ type: "MultiPolygon", coordinates: inter as unknown as Position[][][] });
      }
    } catch {
      continue; // géométrie pathologique : zone ignorée plutôt que crash
    }
    if (interArea <= 0) continue;
    const pct = Math.min(100, (interArea / parcelArea) * 100);
    if (pct < COVERAGE_SLIVER_PCT) continue; // artefact de numérisation
    const p = f.properties ?? {};
    const code = p.libelle ?? "";
    covered.push({
      zone_code: code,
      zone_label: p.libelong || code,
      zone_type: (p.typezone ?? "U").charAt(0) || "U",
      plu_nom: p.nomfic,
      plu_etat: p.urba_etat,
      geometry: g,
      couverture_pct: Math.round(pct * 10) / 10,
    });
  }
  covered.sort((a, b) => b.couverture_pct - a.couverture_pct);
  return { zones: covered, dominant: covered[0] ?? null, a_cheval: covered.length >= 2 };
}

// ── Contexte PLU d'une commune (cache-aside, robuste) ────────────────────────
// Source de vérité unique pour parcelAnalysis : renvoie partition + zones +
// raison d'indisponibilité, en rafraîchissant uniquement quand nécessaire.
//
//   - cache frais (< PLU_REFRESH_AFTER_MS) → renvoyé tel quel
//   - cache stale (> seuil) ou absent     → refreshPluZones synchrone
//   - GPU KO + cache stale présent        → on retourne le stale + flag
//   - jamais de cache + GPU KO            → null partition + reason="gpu_error"
//
// Conséquence : si refreshPluZones a réussi UNE FOIS (cron ou requête /plu-zones),
// tous les appels suivants servent depuis le cache, gratuits et déterministes.

export type PluCommuneContext = {
  partition: string | null;
  zones: PluZonesGeoJson | null;
  unavailableReason: PluUnavailableReason | null;
  stale: boolean;
};

export async function getCommunePluContext(inseeCode: string): Promise<PluCommuneContext> {
  const [row] = await db.select({
    plu_zones_geojson: communes.plu_zones_geojson,
    plu_zones_cached_at: communes.plu_zones_cached_at,
    plu_partition: communes.plu_partition,
    plu_unavailable_reason: communes.plu_unavailable_reason,
  }).from(communes).where(eq(communes.insee_code, inseeCode)).limit(1);

  const cachedAt = row?.plu_zones_cached_at ?? null;
  const ageMs = cachedAt ? Date.now() - cachedAt.getTime() : Infinity;
  const fresh = ageMs < PLU_REFRESH_AFTER_MS;

  if (row && fresh) {
    return {
      partition: row.plu_partition ?? null,
      zones: (row.plu_zones_geojson as PluZonesGeoJson | null) ?? null,
      unavailableReason: (row.plu_unavailable_reason as PluUnavailableReason | null) ?? null,
      stale: false,
    };
  }

  // Cache stale ou inexistant → tente un refresh.
  const result = await refreshPluZones(inseeCode);
  if (result.ok) {
    return { partition: result.partition, zones: result.zones, unavailableReason: null, stale: false };
  }

  // Échec du refresh : si on a un cache (même stale), on le sert avec le flag.
  if (row?.plu_zones_geojson) {
    return {
      partition: row.plu_partition ?? null,
      zones: row.plu_zones_geojson as PluZonesGeoJson,
      unavailableReason: (row.plu_unavailable_reason as PluUnavailableReason | null) ?? null,
      stale: true,
    };
  }

  // Distinction : 404 GPU = pas de PLU pour cette commune (refresh aura déjà
  // gravé "not_in_gpu") ; 502 = GPU temporairement KO.
  return {
    partition: null,
    zones: null,
    unavailableReason: result.status === 404 ? "not_in_gpu" : "gpu_error",
    stale: false,
  };
}
