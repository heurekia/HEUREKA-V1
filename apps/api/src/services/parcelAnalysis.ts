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
import { zones, zone_regulatory_rules, communes, gpu_parcel_cache } from "@heureka-v1/db";
import { eq, and, ilike, sql } from "drizzle-orm";
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
  id?: string;   // BAN cle_interop (ex: "37261_4950_00013") — used for RNB + certification lookup
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
  categorie: string;      // ex: AC1, EL7, PM1, T1
  libelle?: string;       // libellé de la catégorie SUP
  nomsup?: string;        // nom spécifique (ex: "Église Saint-Symphorien")
  dessup?: string;        // description textuelle de la SUP
  geometry_type?: "surface" | "lineaire";
  ref_acte?: string;      // identifiant SUP (ex: "AC-37214-0001")
  urlacte?: string;       // URL vers l'acte légal (arrêté, décret)
  gestionnaire?: string;  // autorité gestionnaire (DRAC, DDT, etc.)
  datdecr?: string;       // date du décret / arrêté de protection
  typeprotect?: string;   // type de protection (ex: "Monument Historique classé")
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
  exceptions?: string | null;
  validation_status: string;
  cases?: Array<{ condition: string; value: number | null; unit: string | null; kind?: string }> | null;
  applies_if?: string[] | null;
  sub_theme?: string | null;
  // Pertinence calculée vis-à-vis de la parcelle :
  // general = toujours ; applicable = contexte parcelle confirmé ; conditional =
  // dépend du projet ou contexte indéterminé ; excluded = contexte connu et non applicable.
  relevance?: "general" | "applicable" | "conditional" | "excluded";
}

export interface InformationResult {
  libelle: string;
  typeinf?: string;
  txtinf?: string;
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
  informations?: InformationResult[];  // périmètres d'informations GPU (info-surf)
  scot?: string;                       // nom du SCoT couvrant la parcelle
  address_certified?: boolean | null;  // adresse certifiée par la commune (BAL) ; null = inconnu
  parcel_confidence?: "exact" | "approximate"; // exact = parcelle contenant le bâtiment (RNB) ; approximate = heuristique
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
          id?: string;
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
      id: f.properties.id,
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

// ── Cadastre feature → ParcelResult ───────────────────────────────────────────
type CadastreFeature = {
  properties: { id: string; section: string; numero: string; contenance: number; nom_com: string; code_insee: string };
  geometry: Geometry;
};
function cadastreToParcel(f: CadastreFeature): ParcelResult {
  const p = f.properties;
  return {
    parcelle_id: p.id || `${p.code_insee}000${p.section}${String(p.numero).padStart(4, "0")}`,
    section: p.section,
    numero: p.numero,
    surface_m2: p.contenance,
    commune: p.nom_com,
    code_insee: p.code_insee,
    geometry: f.geometry ?? null,
  };
}

// ── Parcel that spatially CONTAINS a point (exact point-in-polygon) ───────────
// Reliable only when the point is genuinely inside a parcel — e.g. a map click,
// or a building interior point from the RNB. Returns null when the point falls
// on the public domain (road) or outside any parcel.
export async function findParcelContaining(lat: number, lng: number, codeInsee: string): Promise<ParcelResult | null> {
  try {
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${codeInsee}&geom=${encodeURIComponent(geom)}&_limit=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json() as { features?: CadastreFeature[] };
    return data.features?.[0] ? cadastreToParcel(data.features[0]) : null;
  } catch {
    return null;
  }
}

// ── Pick the coordinate nearest to a reference point ──────────────────────────
// Pure helper (unit-tested). Input coordinates are GeoJSON [lng, lat].
export function pickNearestCoord(
  coords: Array<[number, number]>,
  refLat: number,
  refLng: number,
): { lat: number; lng: number } | null {
  let best: { lat: number; lng: number } | null = null;
  let bestDist = Infinity;
  for (const c of coords) {
    const lng = c[0];
    const lat = c[1];
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const d = distanceKm(refLat, refLng, lat, lng);
    if (d < bestDist) { bestDist = d; best = { lat, lng }; }
  }
  return best;
}

// ── RNB: BAN address key → building interior point ────────────────────────────
// The Référentiel National des Bâtiments links a BAN cle_interop to the
// building(s) at that address; each building exposes a representative "point"
// guaranteed to sit inside its footprint. Because that point is inside the
// building (hence inside its cadastral parcel), feeding it to
// findParcelContaining() yields the correct parcel — independently of how
// imprecise (or "non certifiée") the BAN housenumber position is.
//
// RNB alpha API (https://rnb-api.beta.gouv.fr). The call degrades gracefully:
// any error / unexpected shape returns null and the caller falls back to the
// legacy heuristic, so there is never a regression.
async function findBuildingInteriorPoint(banId: string, refLat: number, refLng: number): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://rnb-api.beta.gouv.fr/api/alpha/buildings/?cle_interop_ban=${encodeURIComponent(banId)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const data = await r.json() as {
      results?: Array<{ status?: string; point?: { coordinates?: [number, number] } }>;
      features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
    };
    // Support both DRF list (`results`) and GeoJSON (`features`) shapes.
    const points: Array<[number, number]> = [];
    for (const b of data.results ?? []) {
      const c = b.point?.coordinates;
      if (c && b.status !== "demolished" && b.status !== "demolie") points.push(c);
    }
    for (const f of data.features ?? []) {
      const c = f.geometry?.coordinates;
      if (c) points.push(c);
    }
    if (!points.length) return null;
    // An address can host several buildings — keep the one nearest the BAN point.
    return pickNearestCoord(points, refLat, refLng);
  } catch {
    return null;
  }
}

// ── BAN certification status for an address ───────────────────────────────────
// "Certifiée" = validated by the commune via its Base Adresse Locale (precise
// position). Non-certified addresses carry a derived/interpolated position that
// can be offset by several metres. Returns null when unknown/unreachable.
async function fetchAddressCertification(banId: string): Promise<boolean | null> {
  try {
    const r = await fetch(`https://plateforme.adresse.data.gouv.fr/lookup/${encodeURIComponent(banId)}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const d = await r.json() as { certifie?: boolean };
    return typeof d.certifie === "boolean" ? d.certifie : null;
  } catch {
    return null;
  }
}

// ── Best-match parcel near a coordinate ──────────────────────────────────────
// 1. Exact containment via geom=<Point> (correct for map clicks / interior points).
// 2. Fallback for BAN road-edge points: ~80 m bbox, pick the closest centroid.
async function findBestParcelNearPoint(lat: number, lng: number, codeInsee: string): Promise<ParcelResult | null> {
  const contained = await findParcelContaining(lat, lng, codeInsee);
  if (contained) return contained;

  // Bbox ~80 m + closest centroid — handles BAN road-edge points between parcels.
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
    const data = await r.json() as { features?: CadastreFeature[] };
    const features = data.features ?? [];
    if (!features.length) return null;

    let best: ParcelResult | null = null;
    let bestDist = Infinity;
    for (const f of features) {
      const parcel = cadastreToParcel(f);
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
    const p = f.properties;
    return {
      parcelle_id: p.id || `${p.code_insee}000${p.section}${String(p.numero).padStart(4, "0")}`,
      section: p.section,
      numero: p.numero,
      surface_m2: p.contenance,
      commune: p.nom_com,
      code_insee: p.code_insee,
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

// ── GPU retry helper ──────────────────────────────────────────────────────────
// The IGN GPU API is prone to transient 503/429 errors and rate-limiting when
// multiple requests are issued in parallel. This wrapper retries once after a
// short delay before giving up, which is enough to ride over most transients.

async function gpuFetch(url: string, timeoutMs = 8000): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 800 + attempt * 400));
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return r;
      // 429 Too Many Requests — wait longer before retry
      if (r.status === 429) await new Promise(r2 => setTimeout(r2, 1500));
    } catch { /* network/timeout — retry */ }
  }
  return null;
}

// ── GPU document partition lookup ─────────────────────────────────────────────
// Resolves the real GPU partition (e.g. DU_37018 for PLU, DU_<SIREN> for PLUi)
// from coordinates. This is more robust than constructing DU_<INSEE> ourselves
// because intercommunal PLU (PLUi) use a SIREN-based partition.

// Returns both the PLU partition (for zone-urba/prescription queries) and the
// SCoT name — extracted from the same /document API call at no extra cost.
export async function getGpuDocuments(lat: number, lng: number): Promise<{ pluPartition: string | null; scotName: string | null }> {
  try {
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const r = await gpuFetch(`https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(geom)}`, 7000);
    if (!r) return { pluPartition: null, scotName: null };
    const data = await r.json() as {
      features?: Array<{ properties: { partition?: string; typedoc?: string; etat?: string; libelle?: string } }>;
    };
    const features = data.features ?? [];
    // PLU partition: first approved PLU/PLUi/CC/PIG document
    const PLU_TYPES = new Set(["PLU", "PLUi", "CC", "PIG", "RNU"]);
    const pluDocs = features.filter(f => PLU_TYPES.has(f.properties.typedoc ?? ""));
    const pluDoc = pluDocs.find(f => f.properties.etat === "approuve") ?? pluDocs[0];
    // SCoT name
    const scotDoc = features.find(f => f.properties.typedoc === "SCOT");
    return {
      pluPartition: pluDoc?.properties.partition ?? null,
      scotName: scotDoc?.properties.libelle ?? null,
    };
  } catch {
    return { pluPartition: null, scotName: null };
  }
}

export async function getGpuPartition(lat: number, lng: number): Promise<string | null> {
  return (await getGpuDocuments(lat, lng)).pluPartition;
}

// ── GPU PLU Zone lookup ───────────────────────────────────────────────────────

export async function findPluZone(lat: number, lng: number, partition?: string): Promise<PluZoneResult | null> {
  try {
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const params = new URLSearchParams({ geom });
    if (partition) params.set("partition", partition);
    const r = await gpuFetch(`https://apicarto.ign.fr/api/gpu/zone-urba?${params.toString()}`, 9000);
    if (!r) return null;
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

// ── GPU périmètres d'informations (info-surf) ─────────────────────────────────
// Displayed as "Périmètres d'informations" on the Géoportail de l'Urbanisme.
// Includes: zones d'attente, secteurs à étude, périmètres divers liés au PLU.

export async function getInfoSurf(lat: number, lng: number, partition?: string): Promise<InformationResult[]> {
  try {
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const params = new URLSearchParams({ geom });
    if (partition) params.set("partition", partition);
    const r = await gpuFetch(`https://apicarto.ign.fr/api/gpu/info-surf?${params.toString()}`, 6000);
    if (!r) return [];
    const data = await r.json() as {
      features?: Array<{ properties: { libelle?: string; typeinf?: string; txtinf?: string } }>;
    };
    return (data.features ?? []).map(f => ({
      libelle: f.properties.libelle ?? "Information réglementaire",
      typeinf: f.properties.typeinf,
      txtinf: f.properties.txtinf,
    }));
  } catch {
    return [];
  }
}

// ── GPU assiettes + générateurs SUP ─────────────────────────────────────────

// GpuSupFeature — open record so we can inspect unknown fields returned by the GPU API.
// The IGN GPU API field naming is inconsistent across versions; we keep an open map
// and extract from whatever the response actually provides.
type GpuSupFeature = {
  properties: Record<string, unknown>;
};

// Known GPU API property names for the SUP category code (e.g. "AC1", "EL7").
// "suptype" is the primary field in the current GPU API (value is lowercase: "ac1" → uppercased).
const SUP_CAT_FIELDS = ["suptype", "natsup", "catesup", "typesup", "nat_sup", "cat_sup"] as const;
// Known fields that contain SUP identifiers (used as fallback for category extraction).
// "idass" / "idgen" / "nomass" are the primary identifiers in the current GPU API.
const SUP_ID_FIELDS  = ["idass", "idgen", "nomass", "idsup", "idacte", "id_sup", "id_acte"] as const;

// GPU idsup format examples: "AC1-37214-0001", "AC1_37018_0003", "EL7_37028_001",
// or partition-prefixed: "37214-AC1-001". Tries to recover the category prefix.
function extractCategoryFromId(idsup: string): string {
  if (!idsup) return "";
  // Normalise ALL separators to hyphens for uniform matching
  const norm = idsup.replace(/[_\s\.\/]/g, "-");
  // Standard prefix: AC1-37214-001
  let m = norm.match(/^([A-Z]{1,3}\d{0,2})-/);
  if (m) return m[1] ?? "";
  // Embedded pattern — handles commune-prefixed IDs like "37214-AC1-001"
  // Anchored to known SUP prefixes to avoid false positives
  m = norm.match(/(?:^|-)((AC|EL|PM|AS|PT|INT?|T|A|I)\d{0,2})(?:-|$)/);
  if (m) return m[1] ?? "";
  // Exact match — the value IS the category code
  m = norm.match(/^([A-Z]{1,3}\d{0,2})$/);
  if (m) return m[1] ?? "";
  return "";
}

// Scan feature properties for a SUP category code (e.g. "AC1", "EL7", "PM1").
// The IGN GPU API field naming varies across versions and responses; this function
// tries every reasonable extraction strategy in priority order.
function scanPropsForCategory(props: Record<string, unknown>): string {
  // Normalise keys to lowercase for case-insensitive lookup (API may return NATSUP etc.)
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) lower[k.toLowerCase()] = v;

  // SUP category codes: 1-3 letters + 0-2 digits, total ≥ 2 chars (case-insensitive — API returns "ac1")
  const EXACT = /^[A-Za-z]{1,3}\d{0,2}$/;
  // Pattern embedded in a longer string (e.g. "AC1_Perimetre-delimite…" or "ac1")
  const EMBEDDED = /\b((ac|AC|el|EL|pm|PM|as|AS|pt|PT|int?|INT?|t\d|T\d|a\d?|A\d?|i\d?|I\d?)[1-9]?\d?)\b/i;

  // 1. Known category field names (case-normalised) — always uppercase the result
  for (const field of SUP_CAT_FIELDS) {
    const v = lower[field];
    if (typeof v !== "string" || !v.trim()) continue;
    const t = v.trim();
    if (EXACT.test(t) && t.length >= 2) return t.toUpperCase();
    // Value might be a longer label or identifier with the code embedded
    const m = t.match(EMBEDDED);
    if (m) return (m[1] ?? "").toUpperCase();
  }

  // 2. Known identifier fields — try to extract category prefix
  for (const field of SUP_ID_FIELDS) {
    const v = lower[field];
    if (typeof v === "string") {
      const cat = extractCategoryFromId(v);
      if (cat) return cat;
    }
  }

  // 3. Scan ALL string properties — exact code match
  for (const v of Object.values(lower)) {
    if (typeof v === "string" && EXACT.test(v.trim()) && v.trim().length >= 2) return v.trim().toUpperCase();
  }

  // 4. Scan ALL string properties — embedded code match
  for (const v of Object.values(lower)) {
    if (typeof v === "string") {
      const m = v.match(EMBEDDED);
      if (m) return (m[1] ?? "").toUpperCase();
    }
  }

  // 5. Try extractCategoryFromId on every string property as last resort
  for (const v of Object.values(lower)) {
    if (typeof v === "string") {
      const cat = extractCategoryFromId(v);
      if (cat) return cat.toUpperCase();
    }
  }

  return "";
}

// GPU date fields come in YYYYMMDD format (e.g. "20180101") — normalise to ISO "YYYY-MM-DD".
function parseGpuDate(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const t = raw.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`;
  return t;
}

function str(props: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) { const v = props[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
  return undefined;
}

function mapSupFeature(f: GpuSupFeature, geomType: "surface" | "lineaire"): ServitudeResult {
  const p = f.properties;
  const categorie = scanPropsForCategory(p);
  // "idgen" links the assiette to its generateur — used as the cross-reference key.
  // Fall back to "idass" (assiette id) if idgen is absent.
  const ref_acte = str(p, "idgen", "idass", "idsup", "idacte");
  return {
    categorie,
    // "nomsuplitt" is the human-readable SUP name in the current GPU API (e.g. "Périmètre délimité des abords - La Gruette")
    libelle:      str(p, "nomsuplitt", "typeass", "libsup", "libelle"),
    nomsup:       str(p, "nomsuplitt", "libsup", "nomsup"),
    dessup:       str(p, "dessup"),
    geometry_type: geomType,
    ref_acte,
    urlacte:      str(p, "urlreg", "urlacte") || undefined,
    gestionnaire: str(p, "gestionnaire"),
    datdecr:      parseGpuDate(p["datesrcass"]) ?? str(p, "datdecr", "datprotect", "datvalid"),
    typeprotect:  str(p, "typeass", "typeprotect", "typeacte"),
  };
}

// ── GPU générateurs SUP ───────────────────────────────────────────────────────
// Générateurs = les sources (monuments, lignes, canalisations…) qui créent les SUP.
// Recherche dans un rayon élargi (700 m) car un MH à 480 m génère un périmètre
// de 500 m qui couvre la parcelle. Renvoie une Map idsup → enrichissement.

async function getGenerateursSup(lat: number, lng: number): Promise<Map<string, Partial<ServitudeResult>>> {
  const DLAT = 0.0063; // ~700 m
  const DLNG = 0.0092;
  const bbox = JSON.stringify({
    type: "Polygon",
    coordinates: [[[lng - DLNG, lat - DLAT], [lng + DLNG, lat - DLAT], [lng + DLNG, lat + DLAT], [lng - DLNG, lat + DLAT], [lng - DLNG, lat - DLAT]]],
  });
  const map = new Map<string, Partial<ServitudeResult>>();
  try {
    const r = await fetch(`https://apicarto.ign.fr/api/gpu/generateur-sup-s?geom=${encodeURIComponent(bbox)}&_limit=30`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return map;
    const data = await r.json() as { features?: GpuSupFeature[] };
    for (const f of data.features ?? []) {
      const p = f.properties as Record<string, unknown>;
      // Generateurs are keyed by "idgen" so assiettes can cross-reference via their own "idgen" field
      const ref = str(p, "idgen", "idass", "idsup", "idacte");
      if (!ref) continue;
      map.set(ref, {
        nomsup:       str(p, "nomsuplitt", "nomsup", "libsup"),
        categorie:    scanPropsForCategory(p),
        urlacte:      str(p, "urlreg", "urlacte") || undefined,
        gestionnaire: str(p, "gestionnaire"),
        dessup:       str(p, "dessup"),
        datdecr:      parseGpuDate(p["datesrcass"]) ?? str(p, "datdecr", "datprotect", "datvalid"),
        typeprotect:  str(p, "typeass", "typeprotect", "typeacte"),
      });
    }
  } catch { /* best-effort */ }
  return map;
}

// SUP queries intentionally do NOT use the PLU partition (DU_xxx) — SUP data lives
// under its own partition scheme (SUP_xxx / national). Passing a DU_ partition silently
// returns zero results. Omit partition and let the GPU API filter spatially.
// Use the parcel polygon when available; fall back to a ~100 m bbox around the point
// so that nearby linear features (power lines, pipeline buffers) are caught.

function supGeom(lat: number, lng: number, parcelGeom?: Geometry | null): string {
  if (parcelGeom && (parcelGeom.type === "Polygon" || parcelGeom.type === "MultiPolygon")) {
    return JSON.stringify(parcelGeom);
  }
  // ~100 m bbox at 47° latitude
  const DLAT = 0.00090;
  const DLNG = 0.00130;
  return JSON.stringify({
    type: "Polygon",
    coordinates: [[[lng - DLNG, lat - DLAT], [lng + DLNG, lat - DLAT], [lng + DLNG, lat + DLAT], [lng - DLNG, lat + DLAT], [lng - DLNG, lat - DLAT]]],
  });
}

export async function getServitudesSurf(lat: number, lng: number, parcelGeom?: Geometry | null): Promise<ServitudeResult[]> {
  try {
    const geom = supGeom(lat, lng, parcelGeom);
    const r = await fetch(`https://apicarto.ign.fr/api/gpu/assiette-sup-s?geom=${encodeURIComponent(geom)}&_limit=20`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const data = await r.json() as { features?: GpuSupFeature[] };
    return (data.features ?? []).map(f => mapSupFeature(f, "surface"));
  } catch {
    return [];
  }
}

export async function getServitudesLin(lat: number, lng: number, parcelGeom?: Geometry | null): Promise<ServitudeResult[]> {
  try {
    const geom = supGeom(lat, lng, parcelGeom);
    const r = await fetch(`https://apicarto.ign.fr/api/gpu/assiette-sup-l?geom=${encodeURIComponent(geom)}&_limit=20`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const data = await r.json() as { features?: GpuSupFeature[] };
    return (data.features ?? []).map(f => mapSupFeature(f, "lineaire"));
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

// ── GPU response cache (DB-backed) ───────────────────────────────────────────
// Cache TTL: 30 days. PLU zones and SUP change very rarely.
// On GPU 503/timeout: serve stale data + add warning.
// Cache key: parcelle_id (preferred) or "lat4,lng4" (rounded to 4 decimal places).

const GPU_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Increment GPU_CACHE_VERSION whenever the extraction logic changes significantly.
// This busts all old cache entries (they become misses) without a DB migration.
// v4: bust entries that may have been poisoned with an incomplete payload
//     (zone present but prescriptions/commune empty after a transient GPU failure).
const GPU_CACHE_VERSION = 4;

function gpuCacheKey(parcelle_id: string | undefined, lat: number, lng: number): string {
  const base = parcelle_id ?? `${lat.toFixed(4)},${lng.toFixed(4)}`;
  return `v${GPU_CACHE_VERSION}:${base}`;
}

type GpuCachePayload = {
  pluPartition: string | null;
  scotName: string | null;
  zone_urba: PluZoneResult | null;
  municipality: MunicipalityResult | null;
  prescriptions: PrescriptionResult[];
  informations: InformationResult[];
  sup_surf: ServitudeResult[];
  sup_lin: ServitudeResult[];
  generateurs: Record<string, Partial<ServitudeResult>>;
};

async function readGpuCache(key: string): Promise<{ payload: GpuCachePayload; stale: boolean } | null> {
  try {
    const [row] = await db.select().from(gpu_parcel_cache).where(eq(gpu_parcel_cache.cache_key, key)).limit(1);
    if (!row) return null;
    const ageMs = Date.now() - row.cached_at.getTime();
    const payload: GpuCachePayload = {
      pluPartition:  row.plu_partition ?? null,
      scotName:      row.scot_name ?? null,
      zone_urba:     (row.zone_urba as PluZoneResult | null) ?? null,
      municipality:  (row.municipality as MunicipalityResult | null) ?? null,
      prescriptions: (row.prescriptions as PrescriptionResult[]) ?? [],
      informations:  (row.informations as InformationResult[]) ?? [],
      sup_surf:      (row.sup_surf as ServitudeResult[]) ?? [],
      sup_lin:       (row.sup_lin as ServitudeResult[]) ?? [],
      generateurs:   (row.generateurs as Record<string, Partial<ServitudeResult>>) ?? {},
    };
    // Increment hit counter asynchronously (fire-and-forget)
    db.update(gpu_parcel_cache)
      .set({ hit_count: sql`${gpu_parcel_cache.hit_count} + 1` })
      .where(eq(gpu_parcel_cache.cache_key, key))
      .catch(() => {});
    return { payload, stale: ageMs > GPU_CACHE_TTL_MS };
  } catch {
    return null;
  }
}

async function writeGpuCache(key: string, parcelle_id: string | undefined, payload: GpuCachePayload): Promise<void> {
  try {
    await db.insert(gpu_parcel_cache).values({
      cache_key:    key,
      parcelle_id:  parcelle_id ?? null,
      plu_partition: payload.pluPartition,
      scot_name:    payload.scotName,
      zone_urba:    payload.zone_urba as never,
      municipality: payload.municipality as never,
      prescriptions: payload.prescriptions as never,
      informations: payload.informations as never,
      sup_surf:     payload.sup_surf as never,
      sup_lin:      payload.sup_lin as never,
      generateurs:  payload.generateurs as never,
      cached_at:    new Date(),
      hit_count:    0,
    }).onConflictDoUpdate({
      target: gpu_parcel_cache.cache_key,
      set: {
        plu_partition: payload.pluPartition,
        scot_name:     payload.scotName,
        zone_urba:     payload.zone_urba as never,
        municipality:  payload.municipality as never,
        prescriptions: payload.prescriptions as never,
        informations:  payload.informations as never,
        sup_surf:      payload.sup_surf as never,
        sup_lin:       payload.sup_lin as never,
        generateurs:   payload.generateurs as never,
        cached_at:     new Date(),
        hit_count:     0,
      },
    });
  } catch { /* cache write failure is non-fatal */ }
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
    rules: rules as unknown as RegDbRule[],
  };
}

// ── Main analysis orchestrator ────────────────────────────────────────────────

// Tags d'applicabilité liés au CONTEXTE de la parcelle (évaluables ici).
// Les autres tags (extension, surelevation, ravalement, cloture_*, annexe…)
// dépendent du PROJET → "conditional".
const PARCEL_CONTEXT_TAGS = new Set(["abf", "inondable", "unesco", "protege_l151_19"]);

function computeRulesRelevance(result: ParcelAnalysis): RegDbRule[] {
  const matched = new Set<string>();     // contexte CONFIRMÉ pour la parcelle
  const determinable = new Set<string>(); // dimensions qu'on a pu évaluer

  if (result.servitudes !== undefined) {
    determinable.add("abf");
    if ((result.servitudes ?? []).some((s) => (s.categorie ?? "").toUpperCase().startsWith("AC"))) matched.add("abf");
  }
  if (result.risks !== undefined) {
    determinable.add("inondable");
    const f = result.risks.flood_risk;
    const zoneCode = result.plu_zone?.zone_code ?? result.db_zone?.code ?? "";
    const hasPpri = (result.servitudes ?? []).some((s) => (s.categorie ?? "").toUpperCase().startsWith("PM"));
    if (f === "fort" || f === "moyen" || f === "faible" || hasPpri || /i$/i.test(zoneCode)) matched.add("inondable");
  }

  return result.rules.map((r) => {
    const tags = Array.isArray(r.applies_if) ? r.applies_if : [];
    if (!tags.length) return { ...r, relevance: "general" as const };
    const parcelCtx = tags.filter((t) => PARCEL_CONTEXT_TAGS.has(t));
    if (parcelCtx.some((t) => matched.has(t))) return { ...r, relevance: "applicable" as const };
    if (parcelCtx.length > 0 && parcelCtx.every((t) => determinable.has(t))) return { ...r, relevance: "excluded" as const };
    return { ...r, relevance: "conditional" as const };
  });
}

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
        result.parcel_confidence = "exact"; // map click → point-in-polygon containment
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
      result.parcel_confidence = "exact"; // explicit cadastral reference → unambiguous
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
      // Reliable path: BAN address key → RNB building interior point → cadastre
      // containment (exact, independent of the BAN point's imprecision).
      // Fallback: legacy heuristic near the BAN point (flagged "approximate").
      if (addr.type === "housenumber" || addr.type === "interpolation") {
        let parcel: ParcelResult | null = null;
        let confidence: "exact" | "approximate" = "approximate";

        if (addr.id && code_insee) {
          // RNB building snap + certification run in parallel — both depend only on
          // the BAN key. Keeping the (informational) certification call off the
          // sequential critical path avoids adding latency before the GPU/risk steps.
          const [certified, bpt] = await Promise.all([
            fetchAddressCertification(addr.id),
            findBuildingInteriorPoint(addr.id, lat, lng),
          ]);
          result.address_certified = certified;
          if (certified === false) {
            result.warnings.push(
              "Adresse non certifiée par la commune : la position fournie par la BAN est approximative. " +
              "La parcelle est confirmée via le bâtiment (RNB) lorsque c'est possible — sinon, vérifiez en cliquant sur la parcelle ou saisissez la référence cadastrale."
            );
          }
          if (bpt) {
            const contained = await findParcelContaining(bpt.lat, bpt.lng, code_insee);
            if (contained && contained.code_insee === code_insee) {
              parcel = contained;
              confidence = "exact";
              // Snap the displayed point onto the building rather than the road edge.
              lat = bpt.lat;
              lng = bpt.lng;
              result.data_sources.push("RNB (bâtiment)");
            }
          }
        }

        if (!parcel && code_insee) {
          parcel = await findBestParcelNearPoint(lat, lng, code_insee);
        }

        if (parcel) {
          if (parcel.code_insee !== addr.citycode) {
            result.warnings.push(`Parcelle trouvée dans ${parcel.commune} (${parcel.code_insee}) — commune différente de ${addr.city} (${addr.citycode}). Données cadastrales non retenues.`);
          } else {
            result.parcel = parcel;
            result.parcel_confidence = confidence;
            result.data_sources.push("IGN Cadastre");
            code_insee = parcel.code_insee;
            if (confidence === "approximate") {
              result.warnings.push(
                "Parcelle déterminée de façon approximative (le bâtiment n'a pas pu être relié à l'adresse). " +
                "Vérifiez en cliquant sur la parcelle sur la carte, ou saisissez la référence cadastrale."
              );
            }
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
    // ── GPU cache-aside pattern ────────────────────────────────────────────────
    // 1. Check DB cache first.
    // 2a. Cache HIT (fresh) → use immediately.
    // 2b. Cache MISS or STALE → call GPU API; on success write cache; on 503 use stale.
    const cacheKey = gpuCacheKey(result.parcel?.parcelle_id, lat, lng);
    let cached = await readGpuCache(cacheKey);

    // When no current-version cache exists, try older versions as stale fallback.
    // These are only used if the live GPU API is also unavailable (prevents old bad data
    // from being served when GPU is healthy and can give us fresh data).
    if (!cached) {
      const base = result.parcel?.parcelle_id ?? `${lat.toFixed(4)},${lng.toFixed(4)}`;
      for (const oldV of [2, 1]) {
        const legacy = await readGpuCache(`v${oldV}:${base}`);
        if (legacy) { cached = { ...legacy, stale: true }; break; }
      }
    }

    let gpuPayload: GpuCachePayload | null = null;
    let gpuFromCache = false;

    if (cached && !cached.stale) {
      // Fresh current-version cache hit — no GPU calls needed
      gpuPayload = cached.payload;
      gpuFromCache = true;
    } else {
      // Try live GPU API
      const { pluPartition, scotName } = await getGpuDocuments(lat, lng);
      const gpuPartition = pluPartition ?? (code_insee ? `DU_${code_insee}` : undefined);
      const gpuAvailable = pluPartition !== null || await findPluZone(lat, lng, gpuPartition).then(z => z !== null).catch(() => false);

      if (gpuAvailable || !cached) {
        // GPU is responding — fetch all data
        const zone = await findPluZone(lat, lng, gpuPartition);
        const parcelGeom = result.parcel?.geometry ?? null;

        const [municipality, prescriptions, informations] = await Promise.all([
          getMunicipality(lat, lng),
          getPrescriptionsSurf(lat, lng, gpuPartition),
          getInfoSurf(lat, lng, gpuPartition),
        ]);

        const [supSurf, supLin] = await Promise.all([
          getServitudesSurf(lat, lng, parcelGeom),
          getServitudesLin(lat, lng, parcelGeom),
        ]);

        let generateurs: Record<string, Partial<ServitudeResult>> = {};
        if (supSurf.length > 0 || supLin.length > 0) {
          const genMap = await getGenerateursSup(lat, lng);
          generateurs = Object.fromEntries(genMap.entries());
        }

        gpuPayload = { pluPartition, scotName, zone_urba: zone, municipality, prescriptions, informations, sup_surf: supSurf, sup_lin: supLin, generateurs };

        // Only cache a COMPLETE payload. A null municipality while a zone exists
        // signals a transient GPU failure on the supplementary layers (commune,
        // prescriptions, SUP) — caching that snapshot would poison future reads
        // with empty data served as "fresh". In that case we still display what we
        // have, but skip the write so the next request retries live.
        const gpuComplete = municipality !== null;
        if ((zone || pluPartition) && gpuComplete) {
          writeGpuCache(cacheKey, result.parcel?.parcelle_id, gpuPayload);
        } else if (!gpuComplete) {
          result.warnings.push(
            "Certaines couches du Géoportail de l'Urbanisme (commune, prescriptions, servitudes) n'ont pas pu être chargées. Réessayez dans quelques instants pour une analyse complète."
          );
        }
      } else if (cached) {
        // GPU down + stale cache (current or legacy version) → use stale with warning
        gpuPayload = cached.payload;
        gpuFromCache = true;
        result.warnings.push("Données GPU servies depuis le cache (API IGN temporairement indisponible) — données réglementaires potentiellement datées.");
      }
    }

    // ── Apply GPU payload to result ────────────────────────────────────────────
    if (gpuPayload) {
      if (gpuPayload.scotName) result.scot = gpuPayload.scotName;
      const gpuPartitionForDisplay = gpuPayload.pluPartition ?? (code_insee ? `DU_${code_insee}` : undefined);

      const zone = gpuPayload.zone_urba;
      if (zone) {
        const pluInsee = zone.plu_nom?.match(/^(\d{5})/)?.[1];
        if (pluInsee && code_insee && pluInsee !== code_insee) {
          result.warnings.push(`Zone PLU GPU (${zone.plu_nom}) appartient à la commune ${pluInsee}, différente de ${code_insee}. Zone ignorée.`);
        } else {
          result.plu_zone = zone;
          result.data_sources.push(gpuFromCache ? "GPU (cache)" : "GPU (Géoportail de l'Urbanisme)");
        }
      } else if (!gpuFromCache) {
        result.warnings.push("Zone PLU non disponible sur le Géoportail de l'Urbanisme pour cette localisation.");
      }
      void gpuPartitionForDisplay; // used above via pluPartition passed to helper calls

      const { municipality, prescriptions, informations, sup_surf: supSurf, sup_lin: supLin, generateurs } = gpuPayload;

      if (municipality) {
        result.municipality = municipality;
        if (municipality.is_rnu) result.warnings.push("Cette commune est soumise au Règlement National d'Urbanisme (RNU) — le PLU local n'est pas applicable.");
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

      if (informations.length > 0) result.informations = informations;

      // Merge + deduplicate SUP, enrich with generateur data
      const allServitudes = [...supSurf, ...supLin];
      const seen = new Set<string>();
      const deduped = allServitudes.filter(s => {
        const k = s.ref_acte ?? `${s.categorie}|${s.nomsup ?? s.libelle ?? ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const genMap = new Map(Object.entries(generateurs));
      const enriched = deduped.map(s => {
        const gen = s.ref_acte ? genMap.get(s.ref_acte) : undefined;
        const base = s.categorie ? s : { ...s, categorie: extractCategoryFromId(s.ref_acte ?? "") };
        if (!gen) return base;
        return { ...base, categorie: base.categorie || gen.categorie || "", nomsup: base.nomsup || gen.nomsup, urlacte: base.urlacte || gen.urlacte, gestionnaire: base.gestionnaire || gen.gestionnaire, dessup: base.dessup || gen.dessup, datdecr: base.datdecr || gen.datdecr, typeprotect: base.typeprotect || gen.typeprotect };
      });

      if (enriched.length > 0) {
        result.servitudes = enriched;
        const ac = enriched.find(s => s.categorie?.startsWith("AC"));
        const el = enriched.find(s => s.categorie?.startsWith("EL"));
        const pm = enriched.find(s => s.categorie?.startsWith("PM"));
        const as_ = enriched.find(s => s.categorie?.startsWith("AS"));
        if (ac) result.warnings.push(`Périmètre ABF — ${ac.nomsup ?? ac.libelle ?? "monument historique"} (SUP ${ac.categorie}) : avis de l'Architecte des Bâtiments de France requis.`);
        if (el) result.warnings.push("Ligne électrique haute tension (SUP EL) — distances de sécurité réglementaires applicables.");
        if (pm) result.warnings.push("Plan de Prévention des Risques (SUP PM) — prescriptions applicables.");
        if (as_) result.warnings.push("Zone de présomption de prescription archéologique (SUP AS) — diagnostic archéologique possible.");
        result.data_sources.push("GPU (SUP)");
      }
    } else {
      result.warnings.push("Géoportail de l'Urbanisme indisponible — données réglementaires (zone PLU, servitudes) non chargées.");
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

  // Pertinence des règles vis-à-vis de la parcelle (applies_if ↔ contexte connu).
  if (result.rules.length > 0) {
    result.rules = computeRulesRelevance(result);
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
      // Valeur du thème : value_exact/max/min, sinon repli sur le 1er cas chiffré
      // (ex. hauteur « 9 m égout / 14 m faîtage » est rangée dans cases).
      const caseVal = () => rule.cases?.find((c) => c.value != null)?.value ?? null;
      const maxVal = rule.value_exact ?? rule.value_max ?? caseVal();
      const minVal = rule.value_exact ?? rule.value_min ?? caseVal();
      if (rule.topic === "emprise_sol") calcVars.maxFootprintRatio = maxVal;
      if (rule.topic === "hauteur") calcVars.maxHeightM = maxVal;
      if (rule.topic === "recul_voie") calcVars.minSetbackFromRoadM = minVal;
      if (rule.topic === "recul_limite") calcVars.minSetbackFromBoundariesM = minVal;
      if (rule.topic === "stationnement" && rule.rule_text) calcVars.parkingRules = rule.rule_text;
      if (rule.topic === "espaces_verts") calcVars.greenSpaceRatio = maxVal;
    }
    result.buildability = calculateBuildability({
      parcelSurfaceM2: result.parcel.surface_m2,
      existingFootprintM2: 0,
      calculationVariables: calcVars,
    });
  }

  return result;
}
