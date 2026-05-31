/**
 * Emprise au sol bâtie (existing building footprint) on a cadastral parcel.
 *
 * The cadastre gives us the parcel polygon + its surface ("contenance"), but not
 * the footprint of the buildings standing on it. We obtain building polygons from
 * the IGN BD TOPO® "batiment" layer (WFS, data.geopf.fr), keep those that actually
 * sit on the parcel (centroid inside the parcel polygon, a robust test against the
 * many buildings straddling a bbox edge), and sum their geodesic areas.
 *
 * Everything fails soft: any network/parse problem returns null so the caller
 * simply omits the "emprise restante" line rather than showing a wrong number.
 */
import type { Geometry, Polygon, MultiPolygon, Position } from "geojson";

// ── Geodesic polygon area (m²) ────────────────────────────────────────────────
// Spherical excess formula (same as turf's `area`). Accurate to well under 1% at
// parcel scale, and dependency-free. Input ring is [lng, lat] degrees.
const EARTH_RADIUS_M = 6378137;
function ringAreaM2(ring: Position[]): number {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i]!;
    const p2 = ring[(i + 1) % ring.length]!;
    const lng1 = p1[0]!, lat1 = p1[1]!, lng2 = p2[0]!, lat2 = p2[1]!;
    total += (toRad(lng2) - toRad(lng1)) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}
function toRad(deg: number): number { return (deg * Math.PI) / 180; }

// Area of a Polygon (outer ring minus holes) or MultiPolygon.
function polygonAreaM2(geom: Geometry): number {
  if (geom.type === "Polygon") {
    const rings = (geom as Polygon).coordinates;
    if (!rings.length) return 0;
    let a = ringAreaM2(rings[0]!);
    for (let i = 1; i < rings.length; i++) a -= ringAreaM2(rings[i]!);
    return Math.max(0, a);
  }
  if (geom.type === "MultiPolygon") {
    return (geom as MultiPolygon).coordinates.reduce((sum, poly) => {
      if (!poly.length) return sum;
      let a = ringAreaM2(poly[0]!);
      for (let i = 1; i < poly.length; i++) a -= ringAreaM2(poly[i]!);
      return sum + Math.max(0, a);
    }, 0);
  }
  return 0;
}

// ── Centroid + point-in-polygon ───────────────────────────────────────────────
function ringCentroid(ring: Position[]): [number, number] {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]!; y += p[1]!; }
  const n = ring.length || 1;
  return [x / n, y / n];
}
function geomCentroid(geom: Geometry): [number, number] | null {
  if (geom.type === "Polygon") return ringCentroid((geom as Polygon).coordinates[0] ?? []);
  if (geom.type === "MultiPolygon") {
    const first = (geom as MultiPolygon).coordinates[0]?.[0];
    return first ? ringCentroid(first) : null;
  }
  return null;
}
// Ray-casting on a single ring.
function pointInRing(pt: [number, number], ring: Position[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!, pj = ring[j]!;
    const xi = pi[0]!, yi = pi[1]!, xj = pj[0]!, yj = pj[1]!;
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt: [number, number], geom: Geometry): boolean {
  if (geom.type === "Polygon") {
    const rings = (geom as Polygon).coordinates;
    if (!rings.length || !pointInRing(pt, rings[0]!)) return false;
    for (let i = 1; i < rings.length; i++) if (pointInRing(pt, rings[i]!)) return false; // hole
    return true;
  }
  if (geom.type === "MultiPolygon") {
    return (geom as MultiPolygon).coordinates.some((poly) => {
      if (!poly.length || !pointInRing(pt, poly[0]!)) return false;
      for (let i = 1; i < poly.length; i++) if (pointInRing(pt, poly[i]!)) return false;
      return true;
    });
  }
  return false;
}

// ── Parcel bbox (for the WFS query) ───────────────────────────────────────────
function bboxOf(geom: Geometry): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (rings: Position[][]) => {
    for (const ring of rings) for (const p of ring) {
      const lng = p[0]!, lat = p[1]!;
      if (lng < minX) minX = lng; if (lng > maxX) maxX = lng;
      if (lat < minY) minY = lat; if (lat > maxY) maxY = lat;
    }
  };
  if (geom.type === "Polygon") visit((geom as Polygon).coordinates);
  else if (geom.type === "MultiPolygon") for (const poly of (geom as MultiPolygon).coordinates) visit(poly);
  else return null;
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

// Small bbox padding (~5 m at French latitudes) so a building whose footprint
// extends just outside the parcel's bounding box still appears in the WFS
// response. Doesn't affect the centroid-in-parcel filter applied afterwards.
const BBOX_PAD_DEG = 5e-5;

/**
 * Total footprint (m²) of buildings standing on `parcelGeom`, or null when the
 * footprint cannot be determined (no geometry, source unreachable…).
 */
export async function computeBuiltFootprintM2(parcelGeom: Geometry | null): Promise<number | null> {
  if (!parcelGeom || (parcelGeom.type !== "Polygon" && parcelGeom.type !== "MultiPolygon")) return null;
  const bbox = bboxOf(parcelGeom);
  if (!bbox) return null;

  // IGN BD TOPO® buildings via WFS. We use CRS:84 (not EPSG:4326) on purpose :
  // EPSG:4326 in WFS 2.0.0 imposes lat,lng axis order on the BBOX *and* the
  // returned coordinates, while many servers (data.geopf.fr included) hand
  // back GeoJSON in lng,lat per the GeoJSON spec — the ambiguity used to make
  // the point-in-polygon test fail silently. CRS:84 is unambiguously lng,lat
  // both ways.
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: "BDTOPO_V3:batiment",
    SRSNAME: "CRS:84",
    OUTPUTFORMAT: "application/json",
    COUNT: "200",
    BBOX: `${minLng - BBOX_PAD_DEG},${minLat - BBOX_PAD_DEG},${maxLng + BBOX_PAD_DEG},${maxLat + BBOX_PAD_DEG},CRS:84`,
  });
  const url = `https://data.geopf.fr/wfs/ows?${params.toString()}`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      console.warn("[buildingFootprint] WFS HTTP error", { status: r.status, statusText: r.statusText });
      return null;
    }
    const data = await r.json() as { features?: Array<{ geometry?: Geometry }> };
    const features = data.features ?? [];
    if (!features.length) return 0; // bbox reachable but empty → no building on plot

    let footprint = 0;
    let counted = 0;
    let geomSkipped = 0;
    for (const f of features) {
      const g = f.geometry;
      if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) { geomSkipped++; continue; }
      const c = geomCentroid(g);
      // Keep only buildings whose centroid sits on the parcel (excludes neighbours
      // caught by the bbox).
      if (!c || !pointInPolygon(c, parcelGeom)) continue;
      footprint += polygonAreaM2(g);
      counted++;
    }
    if (counted === 0) {
      // Diagnostic : WFS returned buildings nearby but none whose centroid is on
      // the parcel. If this is wrong (parcel obviously built), the most likely
      // cause is an axis-order mismatch — the log lets us spot it.
      console.warn("[buildingFootprint] WFS returned features but none centroid-in-parcel", {
        bbox, features_count: features.length, geom_skipped: geomSkipped,
      });
      return 0;
    }
    return Math.round(footprint);
  } catch (err) {
    console.warn("[buildingFootprint] WFS call failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
