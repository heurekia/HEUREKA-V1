/**
 * ParcelAnalysisService
 *
 * Orchestrates real French public APIs to produce a full regulatory analysis
 * for a given address or cadastral reference. Used by both:
 *  - the citizen-facing /public/analyse endpoint (pre-dossier address lookup)
 *  - the mairie instruction Parcelle tab (dossier regulatory review)
 *
 * Data sources in order of reliability:
 *  1. api-adresse.data.gouv.fr   → geocode address to lat/lng
 *  2. apicarto.ign.fr/cadastre   → parcel reference, surface, geometry
 *  3. apicarto.ign.fr/gpu        → PLU zone code and label
 *  4. georisques.gouv.fr         → flood/seismic/clay risks
 *  5. local DB (zones + rules)   → regulatory rules for the zone
 */

import type { Geometry, Polygon } from "geojson";
import { db } from "../db.js";
import { zones, zone_regulatory_rules, communes } from "@heureka-v1/db";
import { eq, and, ilike } from "drizzle-orm";
import { calculateBuildability, type BuildabilityInput } from "./buildability.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AddressResult {
  label: string;
  lat: number;
  lng: number;
  citycode: string;
  postcode: string;
  city: string;
  score: number;
  type: string;  // "housenumber" | "street" | "locality" | "municipality"
}

export interface ParcelResult {
  parcelle_id: string;   // e.g. "37018000AB0123"
  section: string;
  numero: string;
  surface_m2: number;
  commune: string;
  code_insee: string;
  geometry: Geometry | null;
}

export interface PluZoneResult {
  zone_id?: string;    // GPU partition id
  zone_code: string;   // e.g. "UC", "UBai"
  zone_label: string;
  zone_type: string;   // "U", "AU", "A", "N"
  plu_nom?: string;
  plu_etat?: string;
  geometry?: Geometry;
}

export interface MunicipalityResult {
  is_rnu: boolean;
  libelle?: string;
  partition?: string;
}

export interface PrescriptionResult {
  libelle: string;
  typepsc: string;
  txtpsc?: string;
}

export interface ServitudeResult {
  categorie: string;   // ex: AC1, EL7, PM1, T1
  libelle?: string;
}

export interface RiskResult {
  flood_risk: "fort" | "moyen" | "faible" | "nul" | "inconnu";
  seismic_zone: string;
  clay_risk: "fort" | "moyen" | "faible" | "nul" | "inconnu";
  landslide_risk: "fort" | "moyen" | "faible" | "nul" | "inconnu";
  radon_level: "3" | "2" | "1" | "inconnu";
  raw?: Record<string, unknown>;
}

export interface RegDbRule {
  id: string;
  article_number: number | null;
  topic: string;
  rule_text: string;
  value_min: number | null;
  value_max: number | null;
  value_exact: number | null;
  unit: string | null;
  summary: string | null;
  conditions: string | null;
  validation_status: string;
}

export interface ParcelAnalysis {
  query: string;
  address?: AddressResult;
  parcel?: ParcelResult;
  plu_zone?: PluZoneResult;
  risks?: RiskResult;
  db_zone?: { id: string; code: string; label: string | null; type: string | null } | null;
  rules: RegDbRule[];
  buildability: ReturnType<typeof calculateBuildability> | null;
  data_sources: string[];
  warnings: string[];
  available_zones?: Array<{ zone_code: string; zone_label: string; zone_type: string }>;
  municipality?: MunicipalityResult | null;
  prescriptions?: PrescriptionResult[];
  servitudes?: ServitudeResult[];
}

// ── Geocoding ────────────────────────────────────────────────────────────────

// Nominatim (OpenStreetMap) geocoder — used as fallback when BAN returns nothing.
// Returns coordinates in AddressResult shape; citycode is injected from the caller
// since Nominatim doesn't return French INSEE codes.
async function geocodeNominatim(address: string, citycode?: string): Promise<AddressResult | null> {
  try {
    const params = new URLSearchParams({ q: address, format: "json", limit: "1", countrycodes: "fr", addressdetails: "1" });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Heureka-Urbanisme/1.0" },
    });
    if (!r.ok) return null;
    const data = await r.json() as Array<{
      lat: string; lon: string; display_name: string; type: string; class: string;
      address?: { postcode?: string; city?: string; town?: string; village?: string; municipality?: string };
    }>;
    const f = data?.[0];
    if (!f) return null;
    const lat = parseFloat(f.lat);
    const lng = parseFloat(f.lon);
    if (isNaN(lat) || isNaN(lng)) return null;
    return {
      label: f.display_name,
      lat, lng,
      citycode: citycode ?? "",
      postcode: f.address?.postcode ?? "",
      city: f.address?.city ?? f.address?.town ?? f.address?.village ?? f.address?.municipality ?? "",
      score: 0.75,
      type: f.type === "house" || f.type === "residential" ? "housenumber" : "street",
    };
  } catch {
    return null;
  }
}

export async function geocodeAddress(address: string, citycode?: string): Promise<AddressResult | null> {
  try {
    // If citycode (INSEE) is known, constrain BAN to that commune to avoid false matches
    // on homonymous street names in other communes.
    const params = new URLSearchParams({ q: address, limit: "1" });
    if (citycode) params.set("citycode", citycode);
    const url = `https://api-adresse.data.gouv.fr/search/?${params.toString()}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json() as {
      features?: Array<{
        geometry: { coordinates: [number, number] };
        properties: {
          label: string; score: number; citycode: string;
          postcode: string; city: string; type: string;
        };
      }>;
    };
    const f = data.features?.[0];
    if (!f || f.properties.score < 0.2) return null;
    return {
      label: f.properties.label,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      citycode: f.properties.citycode,
      postcode: f.properties.postcode,
      city: f.properties.city,
      score: f.properties.score,
      type: f.properties.type ?? "housenumber",
    };
  } catch {
    return null;
  }
}

// ── Reverse-geocode coordinates to commune INSEE code ─────────────────────────
// Uses geo.api.gouv.fr which returns the commune that spatially contains (lat, lng).
// Called before IGN Cadastre lookups to constrain results to the correct commune
// and prevent the API from returning parcels from an unrelated part of France.

async function getInseeFromCoords(lat: number, lng: number): Promise<string | undefined> {
  try {
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lng}&fields=code&format=json`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!r.ok) return undefined;
    const data = await r.json() as Array<{ code: string }>;
    return data[0]?.code;
  } catch {
    return undefined;
  }
}

// ── Haversine distance (km) between two lat/lng points ────────────────────────
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Best-match parcel near a coordinate ──────────────────────────────────────
// For map clicks: uses geom=<Point> which does actual point-in-polygon containment
// (unlike the lon/lat query which returns nearest centroid regardless of geometry).
// For address lookups: BAN places housenumber points on the road edge, so the
// exact point may fall outside every parcel.  In that case we do a ~80 m bbox
// search and pick the candidate whose centroid is closest to the query point.

async function findBestParcelNearPoint(lat: number, lng: number, codeInsee: string): Promise<ParcelResult | null> {
  type Feature = {
    properties: { id: string; section: string; numero: string; contenance: number; nom_com: string; code_insee: string };
    geometry: Geometry;
  };
  const toParcel = (f: Feature): ParcelResult => ({
    parcelle_id: f.properties.id,
    section: f.properties.section,
    numero: f.properties.numero,
    surface_m2: f.properties.contenance,
    commune: f.properties.nom_com,
    code_insee: f.properties.code_insee,
    geometry: f.geometry ?? null,
  });

  // 1. Exact containment via geom=<Point> — returns the parcel that spatially contains
  //    the point.  This is the correct query for map clicks.
  try {
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${codeInsee}&geom=${encodeURIComponent(geom)}&_limit=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const data = await r.json() as { features?: Feature[] };
      if (data.features?.[0]) return toParcel(data.features[0]);
    }
  } catch { /* fall through to bbox */ }

  // 2. Bbox ~80 m + pick closest centroid — handles BAN road-edge points that fall
  //    between parcel boundaries.
  // At 47° latitude: 1° lat ≈ 111 km, 1° lng ≈ 76 km → 80 m ≈ 0.00072° / 0.00105°
  const DLAT = 0.00072;
  const DLNG = 0.00105;
  const bboxGeom = {
    type: "Polygon",
    coordinates: [[[lng - DLNG, lat - DLAT], [lng + DLNG, lat - DLAT], [lng + DLNG, lat + DLAT], [lng - DLNG, lat + DLAT], [lng - DLNG, lat - DLAT]]],
  };
  try {
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${codeInsee}&geom=${encodeURIComponent(JSON.stringify(bboxGeom))}&_limit=20`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json() as { features?: Feature[] };
    const features = data.features ?? [];
    if (!features.length) return null;

    let best: ParcelResult | null = null;
    let bestDist = Infinity;
    for (const f of features) {
      const parcel = toParcel(f);
      if (parcel.geometry?.type === "Polygon") {
        const coords = (parcel.geometry as Polygon).coordinates[0] ?? [];
        if (coords.length) {
          const cLat = coords.reduce((s, c) => s + (c[1] as number), 0) / coords.length;
          const cLng = coords.reduce((s, c) => s + (c[0] as number), 0) / coords.length;
          const d = distanceKm(lat, lng, cLat, cLng);
          if (d < bestDist) { bestDist = d; best = parcel; }
        }
      } else if (!best) {
        best = parcel;
      }
    }
    return best;
  } catch {
    return null;
  }
}

// ── Cadastral parcel lookup ──────────────────────────────────────────────────

export async function findParcelByLatLng(lat: number, lng: number, codeInsee?: string): Promise<ParcelResult | null> {
  try {
    // Adding code_insee constrains the result to the correct commune — without it,
    // the IGN Cadastre API can return a parcel from a neighboring commune.
    const insee = codeInsee ? `&code_insee=${codeInsee}` : "";
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?lon=${lng}&lat=${lat}&_limit=1${insee}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json() as {
      features?: Array<{
        properties: {
          id: string; section: string; numero: string;
          contenance: number; nom_com: string; code_insee: string;
        };
        geometry: Geometry;
      }>;
    };
    const f = data.features?.[0];
    if (!f) return null;
    return {
      parcelle_id: f.properties.id,
      section: f.properties.section,
      numero: f.properties.numero,
      surface_m2: f.properties.contenance,
      commune: f.properties.nom_com,
      code_insee: f.properties.code_insee,
      geometry: f.geometry ?? null,
    };
  } catch {
    return null;
  }
}

export async function findParcelByRef(parcelle_id: string): Promise<ParcelResult | null> {
  try {
    // parcelle_id format: 37018000BM0019 (14 chars)
    //   [0:5]  = code_insee   → 37018
    //   [5:8]  = prefixe      → 000
    //   [8:10] = section      → BM
    //   [10:]  = numero       → 0019
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${parcelle_id.slice(0, 5)}&section=${parcelle_id.slice(8, 10)}&numero=${parcelle_id.slice(10)}&_limit=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json() as {
      features?: Array<{
        properties: {
          id: string; section: string; numero: string;
          contenance: number; nom_com: string; code_insee: string;
        };
        geometry: Geometry;
      }>;
    };
    const f = data.features?.[0];
    if (!f) return null;
    return {
      parcelle_id: f.properties.id,
      section: f.properties.section,
      numero: f.properties.numero,
      surface_m2: f.properties.contenance,
      commune: f.properties.nom_com,
      code_insee: f.properties.code_insee,
      geometry: f.geometry ?? null,
    };
  } catch {
    return null;
  }
}

// ── GPU document partition lookup ─────────────────────────────────────────────
// Resolves the real GPU partition (e.g. DU_37018 for PLU, DU_<SIREN> for PLUi)
// from coordinates. This is more robust than constructing DU_<INSEE> ourselves
// because intercommunal PLU (PLUi) use a SIREN-based partition.

export async function getGpuPartition(lat: number, lng: number): Promise<string | null> {
  try {
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const url = `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(geom)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const data = await r.json() as {
      features?: Array<{ properties: { partition?: string; etat?: string } }>;
    };
    // Return the partition of the first approved document, preferring "approuve" state
    const features = data.features ?? [];
    const approved = features.find(f => f.properties.etat === "approuve") ?? features[0];
    return approved?.properties.partition ?? null;
  } catch {
    return null;
  }
}

// ── GPU PLU Zone lookup ───────────────────────────────────────────────────────

export async function findPluZone(lat: number, lng: number, partition?: string): Promise<PluZoneResult | null> {
  try {
    // Use geom (GeoJSON Point) + partition to constrain to the correct PLU document.
    // partition comes from getGpuPartition() which handles both PLU (DU_<INSEE>)
    // and PLUi (DU_<SIREN>).
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const params = new URLSearchParams({ geom });
    if (partition) params.set("partition", partition);
    const url = `https://apicarto.ign.fr/api/gpu/zone-urba?${params.toString()}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json() as {
      features?: Array<{
        properties: {
          libelle: string; typezone: string; libelong: string;
          partition?: string; nomfic?: string; urba_etat?: string;
        };
        geometry: Geometry;
      }>;
    };
    const f = data.features?.[0];
    if (!f) return null;
    const zoneType = f.properties.typezone?.[0] ?? "U"; // first char: U, A, N
    return {
      zone_code: f.properties.libelle,
      zone_label: f.properties.libelong || f.properties.libelle,
      zone_type: zoneType,
      plu_nom: f.properties.nomfic,
      plu_etat: f.properties.urba_etat,
      geometry: f.geometry,
    };
  } catch {
    return null;
  }
}

// ── GPU municipality (RNU check) ─────────────────────────────────────────────

export async function getMunicipality(lat: number, lng: number): Promise<MunicipalityResult | null> {
  try {
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const url = `https://apicarto.ign.fr/api/gpu/municipality?geom=${encodeURIComponent(geom)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const data = await r.json() as {
      features?: Array<{ properties: { is_rnu?: boolean; libelle?: string; partition?: string } }>;
    };
    const f = data.features?.[0];
    if (!f) return null;
    return { is_rnu: f.properties.is_rnu ?? false, libelle: f.properties.libelle, partition: f.properties.partition };
  } catch {
    return null;
  }
}

// ── GPU prescriptions surfaciques (EBC, reculs spéciaux…) ────────────────────

export async function getPrescriptionsSurf(lat: number, lng: number, partition?: string): Promise<PrescriptionResult[]> {
  try {
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const params = new URLSearchParams({ geom });
    if (partition) params.set("partition", partition);
    const url = `https://apicarto.ign.fr/api/gpu/prescription-surf?${params.toString()}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const data = await r.json() as {
      features?: Array<{ properties: { libelle?: string; typepsc?: string; txtpsc?: string } }>;
    };
    return (data.features ?? []).map(f => ({
      libelle: f.properties.libelle ?? "",
      typepsc: f.properties.typepsc ?? "",
      txtpsc: f.properties.txtpsc,
    }));
  } catch {
    return [];
  }
}

// ── GPU assiettes SUP surfaciques (AC1 MH, EL lignes HT, PM inondations…) ───

export async function getServitudesSurf(lat: number, lng: number, partition?: string): Promise<ServitudeResult[]> {
  try {
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const params = new URLSearchParams({ geom });
    if (partition) params.set("partition", partition);
    const url = `https://apicarto.ign.fr/api/gpu/assiette-sup-s?${params.toString()}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const data = await r.json() as {
      features?: Array<{ properties: { catesup?: string; libelle?: string; libsup?: string; nomsup?: string } }>;
    };
    return (data.features ?? []).map(f => ({
      categorie: f.properties.catesup ?? "",
      libelle: f.properties.libsup ?? f.properties.libelle ?? f.properties.nomsup,
    }));
  } catch {
    return [];
  }
}

// ── GéoRisques risk lookup ────────────────────────────────────────────────────

function parseAleaLevel(niv: string): "fort" | "moyen" | "faible" | "nul" {
  const n = niv.toLowerCase();
  return n.includes("fort") || n.includes("eleve") || n.includes("élevé") ? "fort"
    : n.includes("moyen") ? "moyen"
    : n.includes("faible") || n.includes("bas") ? "faible"
    : "nul";
}

export async function getRisks(lat: number, lng: number, code_insee: string): Promise<RiskResult> {
  const result: RiskResult = {
    flood_risk: "inconnu",
    seismic_zone: "inconnu",
    clay_risk: "inconnu",
    landslide_risk: "inconnu",
    radon_level: "inconnu",
  };
  try {
    const url = `https://georisques.gouv.fr/api/v1/gaspar/alea?latlon=${lng}%2C${lat}&code_insee=${code_insee}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const data = await r.json() as {
        data?: Array<{ codePhenomene?: string; niveauAlea?: string }>;
      };
      result.raw = data as Record<string, unknown>;
      for (const item of data.data ?? []) {
        const code = (item.codePhenomene ?? "").toUpperCase();
        const niv = item.niveauAlea ?? "";
        if (code.includes("INOND")) {
          result.flood_risk = parseAleaLevel(niv);
        } else if (code.includes("MVMT") || code.includes("MOUVEMENT") || code.includes("GLISSMT") || code.includes("EBOUL")) {
          // Keep worst level if multiple entries
          const lvl = parseAleaLevel(niv);
          const order = ["nul", "faible", "moyen", "fort"];
          if (order.indexOf(lvl) > order.indexOf(result.landslide_risk === "inconnu" ? "nul" : result.landslide_risk)) {
            result.landslide_risk = lvl;
          }
        } else if (code.includes("ARGILE") || code.includes("RETRAIT")) {
          result.clay_risk = parseAleaLevel(niv);
        } else if (code.includes("RADON")) {
          const n = niv.toLowerCase();
          result.radon_level = n.includes("3") || n.includes("eleve") || n.includes("élevé") ? "3"
            : n.includes("2") || n.includes("moyen") ? "2"
            : "1";
        }
      }
    }
  } catch {
    // Risk API is best-effort
  }

  // Seismic zone from department code (arrêté du 22 octobre 2010)
  const dept = code_insee?.slice(0, 2) ?? "";
  const zone1Depts = new Set(["14","22","27","29","35","44","49","50","53","56","61","62","76","80"]);
  const zone3Depts = new Set(["01","05","07","09","15","26","38","42","43","48","63","64","65","67","68","70","73","74","88"]);
  const zone4Depts = new Set(["04","06"]);
  const zone5Depts = new Set(["971","972","974","976"]);
  result.seismic_zone = zone5Depts.has(dept) ? "5" : zone4Depts.has(dept) ? "4" : zone3Depts.has(dept) ? "3" : zone1Depts.has(dept) ? "1" : "2";

  return result;
}

// ── DB regulatory rules lookup ────────────────────────────────────────────────

async function findDbZoneAndRules(zoneCode: string, communeNom?: string, codeInsee?: string): Promise<{
  zone: { id: string; code: string; label: string | null; type: string | null } | null;
  rules: RegDbRule[];
}> {
  // Try exact match first, then parent zone (e.g. "UBai" → try "UB" too)
  let foundZone = null;
  const attempts = [zoneCode, zoneCode.slice(0, -1), zoneCode.slice(0, -2)].filter(z => z.length >= 2);

  // Resolve commune once — prefer INSEE code (exact) over name (fuzzy)
  let communeId: string | null = null;
  if (codeInsee) {
    const [row] = await db.select({ id: communes.id }).from(communes).where(eq(communes.insee_code, codeInsee)).limit(1);
    communeId = row?.id ?? null;
  }
  if (!communeId && communeNom) {
    const [row] = await db.select({ id: communes.id }).from(communes).where(ilike(communes.name, `%${communeNom}%`)).limit(1);
    communeId = row?.id ?? null;
  }

  for (const code of attempts) {
    const where = communeId
      ? and(eq(zones.zone_code, code), eq(zones.commune_id, communeId))
      : eq(zones.zone_code, code);
    const rows = await db.select().from(zones).where(where).limit(1);
    if (rows[0]) { foundZone = rows[0]; break; }
  }

  if (!foundZone) return { zone: null, rules: [] };

  const rules = await db
    .select()
    .from(zone_regulatory_rules)
    .where(and(
      eq(zone_regulatory_rules.zone_id, foundZone.id),
      eq(zone_regulatory_rules.validation_status, "valide"),
    ))
    .orderBy(zone_regulatory_rules.article_number);

  return {
    zone: { id: foundZone.id, code: foundZone.zone_code, label: foundZone.zone_label, type: foundZone.zone_type },
    rules,
  };
}

// ── Main analysis orchestrator ────────────────────────────────────────────────

/**
 * Analyse a parcel by address string or cadastral reference.
 * The `query` parameter can be:
 *  - a free-text address: "12 rue du Commerce, Ballan-Miré"
 *  - a cadastral reference: "37018000AB0050"
 */
export async function analyseParcel(
  query: string,
  options?: { citycode?: string; zoneOverride?: string; coords?: { lat: number; lng: number } }
): Promise<ParcelAnalysis> {
  const result: ParcelAnalysis = {
    query,
    rules: [],
    buildability: null,
    data_sources: [],
    warnings: [],
  };

  const isCadastralRef = /^\d{5}[A-Z0-9]{9,}$/i.test(query.replace(/[\s.]/g, ""));
  const normalizedRef = query.replace(/[\s.]/g, "").toUpperCase();

  let lat: number | undefined = options?.coords?.lat;
  let lng: number | undefined = options?.coords?.lng;
  let code_insee: string | undefined = options?.citycode;

  // Step 1: Resolve coordinates
  if (lat !== undefined && lng !== undefined) {
    // Coordinates provided directly (user clicked on map) — skip geocoding.
    // Pre-resolve the commune INSEE code from geo.api.gouv.fr so that the IGN
    // Cadastre query is constrained to the right commune (without this, the API
    // can silently return a parcel from a completely different region of France).
    result.data_sources.push("Clic carte");
    if (!code_insee) {
      code_insee = await getInseeFromCoords(lat, lng);
    }

    const parcel = code_insee ? await findBestParcelNearPoint(lat, lng, code_insee) : await findParcelByLatLng(lat, lng, undefined);
    if (parcel) {
      if (code_insee && parcel.code_insee !== code_insee) {
        result.warnings.push(`Parcelle trouvée dans ${parcel.commune} (${parcel.code_insee}) — commune différente de ${code_insee}. Données non retenues.`);
      } else {
        result.parcel = parcel;
        result.data_sources.push("IGN Cadastre");
        code_insee = parcel.code_insee;
      }
    } else {
      result.warnings.push("Aucune parcelle identifiée à cet emplacement. Cliquez au centre de la parcelle, pas sur la voirie.");
    }
  } else if (isCadastralRef) {
    const parcel = await findParcelByRef(normalizedRef);
    if (parcel) {
      result.parcel = parcel;
      result.data_sources.push("IGN Cadastre");
      code_insee = parcel.code_insee;
      // Get centroid from geometry if available
      if (parcel.geometry?.type === "Polygon") {
        const coords = (parcel.geometry as Polygon).coordinates[0];
        if (coords && coords.length > 0) {
          lat = coords.reduce((s, c) => s + (c[1] ?? 0), 0) / coords.length;
          lng = coords.reduce((s, c) => s + (c[0] ?? 0), 0) / coords.length;
        }
      }
    } else {
      result.warnings.push("Parcelle cadastrale non trouvée via API IGN.");
    }
  } else {
    // Free-text address — try several BAN strategies in order of reliability.
    // Pre-compute the "street-only" form: strip everything from the postcode onward.
    // "9 Avenue Jean Mermoz 37510 Ballan-Miré" → "9 Avenue Jean Mermoz"
    // When citycode is provided, BAN already pins the commune so this is cleaner.
    const streetOnly = query.replace(/,?\s*\b\d{5}\b.*$/, "").trim();
    const hasStreetOnly = streetOnly !== query && streetOnly.length > 4;

    // Strategy 1: full query, constrained to commune via citycode
    let addr = await geocodeAddress(query, options?.citycode);

    // Strategy 2: stripped query, constrained — embedded postcode+city can reduce BAN scores
    if (!addr && hasStreetOnly) {
      addr = await geocodeAddress(streetOnly, options?.citycode);
    }

    // Strategy 3: full query, unconstrained — accept only if result is in expected commune
    if (!addr && options?.citycode) {
      const unc = await geocodeAddress(query);
      if (unc?.citycode === options.citycode) addr = unc;
    }

    // Strategy 4: stripped + unconstrained with citycode validation
    if (!addr && hasStreetOnly && options?.citycode) {
      const unc = await geocodeAddress(streetOnly);
      if (unc?.citycode === options.citycode) addr = unc;
    }

    // Strategy 5: last resort — unconstrained + no postcode, accept high-confidence results
    // (only when no citycode to validate against; score ≥ 0.6 means BAN is fairly certain)
    if (!addr && hasStreetOnly && !options?.citycode) {
      const unc = await geocodeAddress(streetOnly);
      if (unc && unc.score >= 0.6) addr = unc;
    }

    // Strategy 6: Nominatim (OpenStreetMap) — covers addresses not indexed in BAN
    if (!addr) {
      const nomQuery = hasStreetOnly ? streetOnly : query;
      const nom = await geocodeNominatim(nomQuery, options?.citycode);
      if (nom) {
        // Validate: if citycode is known, check result is in the right department
        if (options?.citycode) {
          const dept = options.citycode.slice(0, 2);
          if (!nom.postcode || nom.postcode.startsWith(dept)) {
            nom.citycode = options.citycode;
            addr = nom;
          }
        } else {
          addr = nom;
        }
      }
    }

    if (addr) {
      result.address = addr;
      const source = addr.score === 0.75 ? "Nominatim (OpenStreetMap)" : "BAN (api-adresse)";
      result.data_sources.push(source);
      lat = addr.lat;
      lng = addr.lng;
      code_insee = addr.citycode;

      // Step 2: Find parcel — only possible for housenumber geocodes.
      // Street-level geocodes land on the road center, which has no cadastral parcel.
      // findParcelWithRetry tries small offsets (~15 m) when the primary point misses,
      // since BAN places housenumber coords on the road edge, not on the parcel itself.
      if (addr.type === "housenumber" || addr.type === "interpolation") {
        const parcel = code_insee ? await findBestParcelNearPoint(lat, lng, code_insee) : null;
        if (parcel) {
          if (parcel.code_insee !== addr.citycode) {
            result.warnings.push(`Parcelle trouvée dans ${parcel.commune} (${parcel.code_insee}) — commune différente de ${addr.city} (${addr.citycode}). Données cadastrales non retenues.`);
          } else {
            result.parcel = parcel;
            result.data_sources.push("IGN Cadastre");
            code_insee = parcel.code_insee;
          }
        } else {
          result.warnings.push("Parcelle cadastrale non identifiée à cette adresse.");
        }
      } else {
        // Street/locality geocode: coordinates are on the road, not inside a parcel.
        // GPU zone and risk lookups still work; the instructeur must provide the parcel ref
        // or select the zone manually.
        result.warnings.push(
          `Adresse géocodée au niveau voirie (type : ${addr.type}). La parcelle exacte ne peut être déterminée automatiquement. ` +
          `Saisissez la référence cadastrale ou sélectionnez la zone PLU ci-dessous.`
        );
      }
    } else {
      // BAN couldn't geocode the address — don't abort, continue to step 5b so the
      // instructeur sees the zone picker and can select the zone manually.
      result.warnings.push("Adresse non reconnue par la BAN. Corrigez l'adresse via le crayon ou sélectionnez la zone manuellement.");
    }
  }

  // Step 3: GPU — resolve the real document partition first, then query zone + supplementary data
  // getGpuPartition handles both PLU (DU_<INSEE>) and PLUi (DU_<SIREN>) transparently.
  if (lat !== undefined && lng !== undefined) {
    const gpuPartition = await getGpuPartition(lat, lng)
      ?? (code_insee ? `DU_${code_insee}` : undefined); // fallback to constructed partition

    const zone = await findPluZone(lat, lng, gpuPartition ?? undefined);
    if (zone) {
      const pluInsee = zone.plu_nom?.match(/^(\d{5})/)?.[1];
      if (pluInsee && code_insee && pluInsee !== code_insee) {
        result.warnings.push(`Zone PLU GPU (${zone.plu_nom}) appartient à la commune ${pluInsee}, différente de ${code_insee}. Zone ignorée.`);
      } else {
        result.plu_zone = zone;
        result.data_sources.push("GPU (Géoportail de l'Urbanisme)");
      }
    } else {
      result.warnings.push("Zone PLU non disponible sur le Géoportail de l'Urbanisme pour cette localisation.");
    }

    // Step 3b: GPU supplementary data (municipality RNU, prescriptions, SUP) — run in parallel
    // Reuse gpuPartition for consistent document scope
    const [municipality, prescriptions, servitudes] = await Promise.all([
      getMunicipality(lat, lng),
      getPrescriptionsSurf(lat, lng, gpuPartition ?? undefined),
      getServitudesSurf(lat, lng, gpuPartition ?? undefined),
    ]);

    if (municipality) {
      result.municipality = municipality;
      if (municipality.is_rnu) {
        result.warnings.push("Cette commune est soumise au Règlement National d'Urbanisme (RNU) — le PLU local n'est pas applicable.");
      }
      result.data_sources.push("GPU (commune)");
    }

    if (prescriptions.length > 0) {
      result.prescriptions = prescriptions;
      const hasEbc = prescriptions.some(p =>
        p.libelle?.toUpperCase().includes("EBC") ||
        p.typepsc?.toUpperCase().includes("EBC") ||
        p.txtpsc?.toLowerCase().includes("espace boisé")
      );
      if (hasEbc) result.warnings.push("Espace Boisé Classé (EBC) sur ou à proximité de la parcelle — défrichement et construction interdits.");
      result.data_sources.push("GPU (prescriptions)");
    }

    if (servitudes.length > 0) {
      result.servitudes = servitudes;
      const ac = servitudes.find(s => s.categorie?.startsWith("AC"));
      const el = servitudes.find(s => s.categorie?.startsWith("EL"));
      const pm = servitudes.find(s => s.categorie?.startsWith("PM"));
      if (ac) result.warnings.push("Périmètre de protection d'un monument historique (SUP AC) — avis de l'ABF requis.");
      if (el) result.warnings.push("Ligne électrique haute tension à proximité (SUP EL) — distances de sécurité réglementaires applicables.");
      if (pm) result.warnings.push("Zone de servitude inondation (SUP PM) — prescriptions PPRI applicables.");
      result.data_sources.push("GPU (SUP)");
    }
  }

  // Step 4: GéoRisques
  if (lat !== undefined && lng !== undefined && code_insee) {
    const risks = await getRisks(lat, lng, code_insee);
    result.risks = risks;
    result.data_sources.push("GéoRisques");
  }

  // Step 5: DB rules lookup — use manual zone override if GPU failed
  const zoneCodeForDb = options?.zoneOverride?.toUpperCase()
    ?? result.plu_zone?.zone_code
    ?? (isCadastralRef ? normalizedRef.slice(0, 2) : null);
  const communeForDb = result.parcel?.commune ?? result.address?.city;

  if (zoneCodeForDb) {
    const { zone, rules } = await findDbZoneAndRules(zoneCodeForDb, communeForDb, code_insee);
    result.db_zone = zone;
    result.rules = rules;
    if (zone) {
      // If zone was manually overridden, reflect it as plu_zone so frontend renders correctly
      if (options?.zoneOverride && !result.plu_zone) {
        result.plu_zone = { zone_code: zone.code, zone_label: zone.label ?? zone.code, zone_type: zone.type ?? "U" };
      }
      result.data_sources.push("Base réglementaire HEUREKA");
    } else {
      result.warnings.push(`Aucune règle enregistrée pour la zone ${zoneCodeForDb} dans la base HEUREKA.`);
    }
  }

  // Step 5b: When GPU zone unavailable, offer all zones for the commune from DB so the
  // instructeur can manually select the correct zone.
  if (!result.plu_zone && !options?.zoneOverride && code_insee) {
    try {
      const [communeRow] = await db.select({ id: communes.id })
        .from(communes)
        .where(eq(communes.insee_code, code_insee))
        .limit(1);
      if (communeRow) {
        const zoneRows = await db
          .select({ zone_code: zones.zone_code, zone_label: zones.zone_label, zone_type: zones.zone_type })
          .from(zones)
          .where(eq(zones.commune_id, communeRow.id))
          .orderBy(zones.display_order);
        result.available_zones = zoneRows.map(z => ({
          zone_code: z.zone_code,
          zone_label: z.zone_label ?? z.zone_code,
          zone_type: z.zone_type ?? "U",
        }));
        if (result.available_zones.length > 0) {
          result.warnings.push(
            `Zone PLU non déterminée automatiquement (${result.available_zones.length} zones disponibles pour cette commune). Sélectionnez la zone manuellement.`
          );
        }
      }
    } catch { /* DB errors are non-fatal */ }
  }

  // Step 6: Buildability calculation
  if (result.rules.length > 0 && result.parcel) {
    const calcVars: BuildabilityInput["calculationVariables"] = {
      maxFootprintRatio: null,
      maxHeightM: null,
      minSetbackFromRoadM: null,
      minSetbackFromBoundariesM: null,
      parkingRules: null,
      greenSpaceRatio: null,
    };
    for (const rule of result.rules) {
      if (rule.topic === "emprise_sol") calcVars.maxFootprintRatio = rule.value_exact ?? rule.value_max;
      if (rule.topic === "hauteur") calcVars.maxHeightM = rule.value_exact ?? rule.value_max;
      if (rule.topic === "recul_voie") calcVars.minSetbackFromRoadM = rule.value_exact ?? rule.value_min;
      if (rule.topic === "recul_limite") calcVars.minSetbackFromBoundariesM = rule.value_exact ?? rule.value_min;
      if (rule.topic === "stationnement" && rule.rule_text) calcVars.parkingRules = rule.rule_text;
      if (rule.topic === "espaces_verts") calcVars.greenSpaceRatio = rule.value_exact ?? rule.value_max;
    }
    result.buildability = calculateBuildability({
      parcelSurfaceM2: result.parcel.surface_m2,
      existingFootprintM2: 0,
      calculationVariables: calcVars,
    });
  }

  return result;
}
