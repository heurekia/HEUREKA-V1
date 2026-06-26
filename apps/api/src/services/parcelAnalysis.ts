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
 *  4. georisques.gouv.fr         → risks: gaspar/alea (commune) + zonage_sismique & rga (au point)
 *  5. data.geopf.fr/altimetrie   → terrain altitude (RGE ALTI®) — prérequis cote NGF / PPRI
 *  6. local DB (zones + rules)   → regulatory rules for the zone
 */

import type { Geometry, Polygon, MultiPolygon } from "geojson";
import { db } from "../db.js";
import { zones, zone_regulatory_rules, communes, gpu_parcel_cache } from "@heureka-v1/db";
import { eq, and, ilike, sql, inArray } from "drizzle-orm";
import { calculateBuildability, type BuildabilityInput } from "./buildability.js";
import { computeBuiltFootprintM2 } from "./buildingFootprint.js";
import { loadZoneRulesWithInheritance, pickMostSpecificRule } from "./zoneRules.js";
import { resolveCommuneZoneIds } from "./communeZones.js";
import { getCommunePluContext, findZoneAtPoint, findZonesForParcel, type PluCommuneContext } from "./pluZones.js";
import { buildParcelSynthesis, type ParcelSynthesis } from "./parcelSynthesis.js";
import type { ParcelleRef, UniteFonciere } from "@heureka-v1/shared";
import { loadCommuneHeightLayer, resolveParcelHeight, heightFromPrescriptions, describeHeightCategory, type ParcelHeight } from "./heightLayer.js";

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
  /** Altitude moyenne du terrain (m, NGF / IGN69) issue du RGE ALTI® (Géoplateforme).
   *  Prérequis pour comparer à la cote de référence d'un PPRI. null si indisponible. */
  terrain_altitude_m?: number | null;
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
  // Version « citoyen » générée à l'ingestion (titre court + phrase simple).
  citizen_title?: string | null;
  citizen_summary?: string | null;
  citizen_relevant?: boolean | null;
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

// Espace naturel protégé recoupant la parcelle (apicarto module Nature → INPN/MNHN).
// `type` est la catégorie — toujours fiable car déterminée par la COUCHE interrogée,
// pas par les propriétés (qui varient selon la source). `nom`/`code` enrichissent
// quand l'API les fournit. Sert l'évaluation des incidences Natura 2000, la
// sensibilité écologique (ZNIEFF) et les réglementations propres (réserves, parcs).
export interface ProtectedAreaResult {
  type:
    | "natura2000_habitat"
    | "natura2000_oiseaux"
    | "znieff1"
    | "znieff2"
    | "reserve_naturelle"
    | "parc_national"
    | "parc_naturel_regional"
    | "reserve_chasse_faune";
  label: string;   // libellé lisible de la catégorie (ex: « Natura 2000 — Directive Habitats »)
  nom?: string;    // nom du site (ex: « Camargue ») quand disponible
  code?: string;   // identifiant (sitecode Natura 2000 ou id_mnhn) quand disponible
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
  built_footprint_m2?: number;   // emprise au sol déjà bâtie (BD TOPO®)
  data_sources: string[];
  warnings: string[];
  available_zones?: Array<{ zone_code: string; zone_label: string; zone_type: string }>;
  // Zonage SURFACIQUE de la parcelle (parcelle ∩ zones). Complète `plu_zone`
  // (résolue au point) sans le remplacer : `zone_a_cheval` = la parcelle couvre
  // ≥ 2 zones de façon matérielle ; `zones_touchees` détaille la répartition par
  // % d'aire, triée par couverture décroissante. Sert à appliquer « la règle la
  // plus stricte par partie » et à repérer un point tombé en limite de zone.
  zone_a_cheval?: boolean;
  zones_touchees?: Array<{ zone_code: string; zone_label: string; zone_type: string; couverture_pct: number }>;
  // Hauteur résolue depuis le « plan des hauteurs » déposé (document plan_hauteurs).
  // Complète la règle de hauteur et la constructibilité quand le règlement écrit
  // renvoie au document graphique. null/absent si aucune couche déposée.
  hauteur_plan?: ParcelHeight;
  municipality?: MunicipalityResult | null;
  prescriptions?: PrescriptionResult[];
  servitudes?: ServitudeResult[];
  informations?: InformationResult[];  // périmètres d'informations GPU (info-surf)
  protected_areas?: ProtectedAreaResult[];  // espaces naturels protégés (apicarto Nature / INPN)
  scot?: string;                       // nom du SCoT couvrant la parcelle
  address_certified?: boolean | null;  // adresse certifiée par la commune (BAL) ; null = inconnu
  parcel_confidence?: "exact" | "approximate"; // exact = parcelle contenant le bâtiment (RNB) ; approximate = heuristique
  // Synthèse thématique bi-audience (citoyen + instructeur), transversale entre
  // documents (PLU + risques + servitudes). Dérivée des champs ci-dessus.
  synthesis?: ParcelSynthesis;
  // Agrégat « unité foncière » : présent uniquement quand l'analyse porte sur
  // plusieurs parcelles (groupement foncier). `result.parcel` reste la parcelle
  // PRINCIPALE (zone/risques/servitudes résolus dessus) ; la constructibilité,
  // elle, est recalculée sur la SURFACE TOTALE des parcelles.
  unite_fonciere?: UniteFonciere;
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

// ── Espaces naturels protégés (apicarto module Nature → INPN/MNHN) ────────────
// 9 couches : Natura 2000 (habitat + oiseaux), ZNIEFF 1 & 2, réserves naturelles
// (RNN/RNC), réserve nationale de chasse & faune, parcs nationaux & régionaux.
// Interroge toutes les couches EN PARALLÈLE (best-effort, null-safe) sur la
// géométrie parcellaire si disponible, sinon un bbox autour du point — d'où la
// formulation « sur ou à proximité » côté instruction. Sert l'évaluation des
// incidences Natura 2000, la sensibilité écologique (ZNIEFF) et les
// réglementations propres (réserves, cœur de parc). Comme getRisks, appelé en
// LIVE (non caché) : la latence reste celle de l'appel le plus lent.

const NATURE_LAYERS: Array<{ path: string; type: ProtectedAreaResult["type"]; label: string }> = [
  { path: "natura-habitat", type: "natura2000_habitat",    label: "Natura 2000 — Directive Habitats (ZSC)" },
  { path: "natura-oiseaux", type: "natura2000_oiseaux",    label: "Natura 2000 — Directive Oiseaux (ZPS)" },
  { path: "znieff1",        type: "znieff1",               label: "ZNIEFF de type I" },
  { path: "znieff2",        type: "znieff2",               label: "ZNIEFF de type II" },
  { path: "rnn",            type: "reserve_naturelle",     label: "Réserve naturelle nationale" },
  { path: "rnc",            type: "reserve_naturelle",     label: "Réserve naturelle de Corse" },
  { path: "pn",             type: "parc_national",         label: "Parc national" },
  { path: "pnr",            type: "parc_naturel_regional", label: "Parc naturel régional" },
  { path: "rncf",           type: "reserve_chasse_faune",  label: "Réserve nationale de chasse et de faune sauvage" },
];

// Les noms de propriétés varient selon la couche INPN ; on tente plusieurs clés
// connues (nom de site, libellé ZNIEFF lb_zn, sitecode Natura 2000, id MNHN). Le
// TYPE reste fiable car déterminé par la couche interrogée, pas par les props.
function mapNatureFeature(
  props: Record<string, unknown>,
  cfg: { type: ProtectedAreaResult["type"]; label: string },
): ProtectedAreaResult {
  return {
    type: cfg.type,
    label: cfg.label,
    nom:  str(props, "nom_site", "sitename", "site_name", "nom", "lb_zn", "libelle", "nom_rnn", "nom_pnr", "nom_parc"),
    code: str(props, "sitecode", "id_mnhn", "nm_sffzn", "id_local", "gml_id"),
  };
}

export async function getProtectedAreas(lat: number, lng: number, parcelGeom?: Geometry | null): Promise<ProtectedAreaResult[]> {
  const geom = supGeom(lat, lng, parcelGeom);
  const perLayer = await Promise.all(NATURE_LAYERS.map(async (cfg) => {
    try {
      const r = await fetch(`https://apicarto.ign.fr/api/nature/${cfg.path}?geom=${encodeURIComponent(geom)}&_limit=5`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return [];
      const data = await r.json() as { features?: Array<{ properties?: Record<string, unknown> }> };
      return (data.features ?? []).map((f) => mapNatureFeature(f.properties ?? {}, cfg));
    } catch {
      return [];
    }
  }));
  // Dédup : une couche peut renvoyer plusieurs polygones d'un même site.
  const seen = new Set<string>();
  return perLayer.flat().filter((a) => {
    const k = `${a.type}|${a.nom ?? ""}|${a.code ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── GéoRisques risk lookup ────────────────────────────────────────────────────

function parseAleaLevel(niv: string): "fort" | "moyen" | "faible" | "nul" {
  const n = niv.toLowerCase();
  return n.includes("fort") || n.includes("eleve") || n.includes("élevé") ? "fort"
    : n.includes("moyen") ? "moyen"
    : n.includes("faible") || n.includes("bas") ? "faible"
    : "nul";
}

// Niveau d'exposition argileux à partir d'un libellé (RGA au point ou GASPAR).
function parseClayExposure(s: string): "fort" | "moyen" | "faible" | "nul" | null {
  const n = s.toLowerCase();
  if (!n.trim()) return null;
  if (n.includes("fort")) return "fort";
  if (n.includes("moyen")) return "moyen";
  if (n.includes("faible")) return "faible";
  if (n.includes("nul") || n.includes("aucun") || n.includes("absen")) return "nul";
  return null;
}

// Table départementale de sismicité (arrêté du 22 octobre 2010) — REPLI utilisé
// quand l'interrogation au point (zonage_sismique) est indisponible.
function seismicZoneFromDept(code_insee: string): string {
  const dept = code_insee?.slice(0, 2) ?? "";
  const zone1Depts = new Set(["14","22","27","29","35","44","49","50","53","56","61","62","76","80"]);
  const zone3Depts = new Set(["01","05","07","09","15","26","38","42","43","48","63","64","65","67","68","70","73","74","88"]);
  const zone4Depts = new Set(["04","06"]);
  const zone5Depts = new Set(["971","972","974","976"]);
  return zone5Depts.has(dept) ? "5" : zone4Depts.has(dept) ? "4" : zone3Depts.has(dept) ? "3" : zone1Depts.has(dept) ? "1" : "2";
}

type GasparAlea = Pick<RiskResult, "flood_risk" | "landslide_risk" | "clay_risk" | "radon_level"> & {
  raw?: Record<string, unknown>;
};

// GASPAR / aléa (maille communale) — socle historique. Best-effort : null si KO.
async function fetchGasparAlea(lat: number, lng: number, code_insee: string): Promise<GasparAlea | null> {
  try {
    const url = `https://georisques.gouv.fr/api/v1/gaspar/alea?latlon=${lng}%2C${lat}&code_insee=${code_insee}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const data = await r.json() as { data?: Array<{ codePhenomene?: string; niveauAlea?: string }> };
    const out: GasparAlea = {
      flood_risk: "inconnu", landslide_risk: "inconnu", clay_risk: "inconnu", radon_level: "inconnu",
      raw: data as Record<string, unknown>,
    };
    for (const item of data.data ?? []) {
      const code = (item.codePhenomene ?? "").toUpperCase();
      const niv = item.niveauAlea ?? "";
      if (code.includes("INOND")) {
        out.flood_risk = parseAleaLevel(niv);
      } else if (code.includes("MVMT") || code.includes("MOUVEMENT") || code.includes("GLISSMT") || code.includes("EBOUL")) {
        // Keep worst level if multiple entries
        const lvl = parseAleaLevel(niv);
        const order = ["nul", "faible", "moyen", "fort"];
        if (order.indexOf(lvl) > order.indexOf(out.landslide_risk === "inconnu" ? "nul" : out.landslide_risk)) {
          out.landslide_risk = lvl;
        }
      } else if (code.includes("ARGILE") || code.includes("RETRAIT")) {
        out.clay_risk = parseAleaLevel(niv);
      } else if (code.includes("RADON")) {
        const n = niv.toLowerCase();
        out.radon_level = n.includes("3") || n.includes("eleve") || n.includes("élevé") ? "3"
          : n.includes("2") || n.includes("moyen") ? "2"
          : "1";
      }
    }
    return out;
  } catch {
    return null;
  }
}

// Zonage sismique réglementaire AU POINT (georisques) — plus précis que la table
// départementale (le zonage descend à la commune). Best-effort : null si KO.
// Le chemin exact varie selon les versions de l'API (underscore vs tiret) : on
// tente les deux et on retient la première réponse exploitable.
async function fetchSeismicZoneAtPoint(lat: number, lng: number): Promise<string | null> {
  for (const path of ["zonage_sismique", "zonage-sismique"]) {
    try {
      const url = `https://georisques.gouv.fr/api/v1/${path}?latlon=${lng}%2C${lat}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const data = await r.json() as { data?: Array<{ code_zone?: string | number; zone_sismicite?: string }> };
      const row = data.data?.[0];
      const code = row?.code_zone != null ? String(row.code_zone).trim() : "";
      if (/^[1-5]$/.test(code)) return code;
    } catch {
      // variante suivante
    }
  }
  return null;
}

// Retrait-gonflement des argiles AU POINT (georisques /rga) — exposition
// cartographiée, plus fine que la maille GASPAR. Best-effort : null si KO.
async function fetchClayExposureAtPoint(lat: number, lng: number): Promise<"fort" | "moyen" | "faible" | "nul" | null> {
  try {
    const url = `https://georisques.gouv.fr/api/v1/rga?latlon=${lng}%2C${lat}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const data = await r.json() as { data?: Array<{ exposition?: string; niveau?: string; codeExposition?: string | number }> };
    const row = data.data?.[0];
    if (!row) return null;
    return parseClayExposure(String(row.exposition ?? row.niveau ?? row.codeExposition ?? ""));
  } catch {
    return null;
  }
}

// Altitude du terrain (RGE ALTI® via la Géoplateforme). Renvoie l'altitude NGF
// arrondie au décimètre, ou null (hors couverture, sentinelle -99999, ou KO).
export async function getTerrainAltitude(lat: number, lng: number): Promise<number | null> {
  try {
    const url = `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json`
      + `?lon=${lng}&lat=${lat}&resource=ign_rge_alti_wld&zonly=true&indent=false`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json() as { elevations?: Array<number | { z?: number }> };
    const first = data.elevations?.[0];
    const z = typeof first === "number" ? first : first?.z;
    if (typeof z !== "number" || !Number.isFinite(z) || z <= -1000) return null; // -99999 = hors données
    return Math.round(z * 10) / 10;
  } catch {
    return null;
  }
}

export async function getRisks(lat: number, lng: number, code_insee: string): Promise<RiskResult> {
  const result: RiskResult = {
    flood_risk: "inconnu",
    seismic_zone: "inconnu",
    clay_risk: "inconnu",
    landslide_risk: "inconnu",
    radon_level: "inconnu",
    terrain_altitude_m: null,
  };

  // Sources interrogées EN PARALLÈLE → la latence reste celle de l'appel le plus
  // lent (et non leur somme) : on enrichit la donnée sans alourdir l'instruction.
  const [gaspar, altitude, seismicPt, clayPt] = await Promise.all([
    fetchGasparAlea(lat, lng, code_insee),
    getTerrainAltitude(lat, lng),
    fetchSeismicZoneAtPoint(lat, lng),
    fetchClayExposureAtPoint(lat, lng),
  ]);

  // Socle GASPAR (inondation / mouvement de terrain / argiles / radon).
  if (gaspar) {
    result.flood_risk = gaspar.flood_risk;
    result.landslide_risk = gaspar.landslide_risk;
    result.clay_risk = gaspar.clay_risk;
    result.radon_level = gaspar.radon_level;
    result.raw = gaspar.raw;
  }

  // Altitude RGE ALTI® (prérequis cote NGF / PPRI).
  result.terrain_altitude_m = altitude;

  // Argiles : l'exposition AU POINT (RGA) prime sur la maille GASPAR si dispo.
  if (clayPt) result.clay_risk = clayPt;

  // Sismicité : zonage au point si dispo, sinon repli sur la table départementale.
  result.seismic_zone = seismicPt ?? seismicZoneFromDept(code_insee);

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
// v5: bust entries that may have been written with a PLUi zone wrongly rejected
//     (or accepted) due to the old loose `^(\d{5})` INSEE-vs-SIREN regex.
const GPU_CACHE_VERSION = 5;

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
  matchedChain: string[];
}> {
  // Inheritance : a parcel in UBai inherits UBa + UB rules, with the deepest
  // sector winning per (article, topic, sub_theme). Previously this used "first
  // match wins" which silently dropped inherited rules.
  const loaded = await loadZoneRulesWithInheritance(zoneCode, { communeNom, codeInsee });
  return {
    zone: loaded.zone,
    rules: loaded.rules as unknown as RegDbRule[],
    matchedChain: loaded.matchedChain,
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
// Centre approché d'une géométrie cadastrale (anneau extérieur), robuste aux
// Polygon ET MultiPolygon. Sert de point pour résoudre la zone PLU / servitudes
// quand la parcelle est trouvée par RÉFÉRENCE (sans géocodage d'adresse).
function geometryCentroid(geom: Geometry | null | undefined): { lat: number; lng: number } | null {
  if (!geom) return null;
  let outer: number[][] | undefined;
  if (geom.type === "Polygon") outer = (geom as Polygon).coordinates[0];
  else if (geom.type === "MultiPolygon") outer = (geom as MultiPolygon).coordinates[0]?.[0];
  else return null;
  if (!outer || outer.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const c of outer) {
    const x = c[0], y = c[1];
    if (typeof x === "number" && typeof y === "number") { sx += x; sy += y; n++; }
  }
  return n > 0 ? { lat: sy / n, lng: sx / n } : null;
}

export async function analyseParcel(
  query: string,
  options?: {
    citycode?: string;
    zoneOverride?: string;
    coords?: { lat: number; lng: number };
    // Unité foncière : liste d'ids cadastraux (14 car.) du groupement. La parcelle
    // principale (celle résolue depuis `query`/coords) peut y figurer ou non ; elle
    // est de toute façon comptée. Les surfaces sont additionnées et la
    // constructibilité recalculée sur le total.
    uniteFonciere?: { parcelles: string[] };
  }
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
      // Centre depuis la géométrie (Polygon OU MultiPolygon) → point utilisé pour
      // la résolution de zone PLU / servitudes. Sans ce centre, le bloc zonage
      // (gardé par `if (lat && lng)`) est sauté et la zone reste « non déterminée ».
      const centre = geometryCentroid(parcel.geometry);
      if (centre) { lat = centre.lat; lng = centre.lng; }
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

  // ── Parallélisation : on lance dès maintenant les traitements réseau qui ne
  // dépendent QUE de la position (lat/lng/INSEE) ou de la géométrie parcellaire,
  // pour qu'ils s'exécutent EN CONCURRENCE avec le bloc GPU ci-dessous (étape 3)
  // au lieu de s'enchaîner derrière lui. On les attend à leur point d'usage
  // (étapes 4 et 6). Ces fonctions échouent en douceur (jamais de rejet), donc une
  // promesse lancée est toujours sûre à attendre — ou à ignorer.
  //  - getRisks               : GéoRisques + RGE ALTI® (4 appels), dépend de lat/lng/INSEE
  //  - getProtectedAreas      : espaces naturels protégés (apicarto Nature), dépend de lat/lng/géométrie
  //  - computeBuiltFootprintM2 : BD TOPO® bâti, dépend de la seule géométrie parcellaire
  const risksPromise =
    lat !== undefined && lng !== undefined && code_insee
      ? getRisks(lat, lng, code_insee)
      : null;
  const protectedPromise =
    lat !== undefined && lng !== undefined
      ? getProtectedAreas(lat, lng, result.parcel?.geometry ?? null)
      : null;
  const footprintPromise = result.parcel?.geometry
    ? computeBuiltFootprintM2(result.parcel.geometry)
    : null;

  // Mémoïsation du contexte PLU communal pour la durée de cette analyse : le
  // GeoJSON des zones est volumineux et était relu 2 à 3 fois (résolution de
  // partition, repli zone au point, zonage surfacique). Une seule lecture suffit.
  const communeCtxCache = new Map<string, Promise<PluCommuneContext>>();
  const communePluContext = (insee: string): Promise<PluCommuneContext> => {
    let p = communeCtxCache.get(insee);
    if (!p) { p = getCommunePluContext(insee); communeCtxCache.set(insee, p); }
    return p;
  };

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
      // ── Partition resolution (multi-source, never gives up early) ──────────
      // (1) Tente la découverte par point — chemin rapide quand ça marche.
      // (2) Sinon, demande au cache commune (peuplé par refreshPluZones) qui
      //     gère lui-même les 5 conventions de nommage + EPCI SIREN.
      // (3) Sinon, fallback historique sur DU_<INSEE> en dernier recours.
      const { pluPartition: pointPartition, scotName } = await getGpuDocuments(lat, lng);
      let communeCtx: PluCommuneContext | null = null;
      let resolvedPartition: string | null = pointPartition;
      if (!resolvedPartition && code_insee) {
        communeCtx = await communePluContext(code_insee);
        resolvedPartition = communeCtx.partition;
      }
      const gpuPartition = resolvedPartition ?? (code_insee ? `DU_${code_insee}` : undefined);
      // Sonde d'availability : quand la partition n'a pas été résolue en amont, on
      // interroge /zone-urba UNE fois — et on RÉUTILISE ce résultat comme zone
      // ci-dessous, au lieu de relancer le même appel GPU une seconde fois.
      let probedZone: PluZoneResult | null | undefined;
      let gpuAvailable: boolean;
      if (resolvedPartition !== null) {
        gpuAvailable = true;
      } else {
        probedZone = await findPluZone(lat, lng, gpuPartition).catch(() => null);
        gpuAvailable = probedZone !== null;
      }

      if (gpuAvailable || !cached) {
        // GPU is responding — fetch all data
        let zone = probedZone !== undefined ? probedZone : await findPluZone(lat, lng, gpuPartition);

        // ── Validation INSEE ↔ zone ─────────────────────────────────────────
        // Le PLU COMMUNAL nomme ses fichiers <INSEE>_PLU_<date>.<ext>. Si le
        // préfixe pointe vers une AUTRE commune, c'est une réponse parasite du
        // GPU (cas typique : Tours, dont la BBox déborde sur Parçay-Meslay).
        //
        // Mais un PLUi nomme ses fichiers <SIREN>_PLUI / <SIREN>_reglement —
        // un SIREN à 9 chiffres dont les 5 premiers ressemblent à un INSEE
        // étranger (ex: SIREN 200030385 → faux INSEE "20003" pour une commune
        // de Loir-et-Cher). Le regex doit donc EXIGER `_PLU(_|.|$)` après le
        // bloc 5 chiffres pour ne rejeter QUE de vrais PLU communaux.
        const inseeMismatch = (z: PluZoneResult): boolean => {
          if (!code_insee || !z.plu_nom) return false;
          const m = z.plu_nom.match(/^(\d{5})_PLU(?:_|\.|$)/);
          return m !== null && m[1] !== code_insee;
        };
        if (zone && inseeMismatch(zone)) {
          console.warn(`[parcel] zone GPU (${zone.plu_nom}) rejetée pour ${code_insee} — fallback cache commune`);
          zone = null;
        }

        // Fallback ultime : si /zone-urba ne trouve rien au point (point sur
        // voirie, bord de zone, ou zone rejetée à raison ci-dessus), on cherche
        // localement dans les zones cachées de la commune. Point-in-polygon
        // déterministe, gratuit, immunisé contre les bizarreries du filtre
        // spatial GPU et contre les conventions de nommage non-standard.
        if (!zone && code_insee) {
          if (!communeCtx) communeCtx = await communePluContext(code_insee);
          const local = findZoneAtPoint(communeCtx.zones, lat, lng);
          if (local) zone = local;
        }
        const parcelGeom = result.parcel?.geometry ?? null;

        // Toutes ces couches GPU sont indépendantes les unes des autres : on les
        // interroge en un seul lot parallèle (au lieu de deux salves séquentielles)
        // → la latence est celle de l'appel le plus lent, et non leur somme.
        const [municipality, prescriptions, informations, supSurf, supLin] = await Promise.all([
          getMunicipality(lat, lng),
          getPrescriptionsSurf(lat, lng, gpuPartition),
          getInfoSurf(lat, lng, gpuPartition),
          getServitudesSurf(lat, lng, parcelGeom),
          getServitudesLin(lat, lng, parcelGeom),
        ]);

        let generateurs: Record<string, Partial<ServitudeResult>> = {};
        if (supSurf.length > 0 || supLin.length > 0) {
          const genMap = await getGenerateursSup(lat, lng);
          generateurs = Object.fromEntries(genMap.entries());
        }

        gpuPayload = { pluPartition: resolvedPartition, scotName, zone_urba: zone, municipality, prescriptions, informations, sup_surf: supSurf, sup_lin: supLin, generateurs };

        // Only cache a COMPLETE payload. A null municipality while a zone exists
        // signals a transient GPU failure on the supplementary layers (commune,
        // prescriptions, SUP) — caching that snapshot would poison future reads
        // with empty data served as "fresh". In that case we still display what we
        // have, but skip the write so the next request retries live.
        const gpuComplete = municipality !== null;
        if ((zone || resolvedPartition) && gpuComplete) {
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
        // La validation INSEE ↔ PLU est faite en amont (phase fetch), donc une
        // zone présente ici est, par construction, celle de la bonne commune.
        // Sécurité legacy : pour les caches v3- déjà persistés avec une
        // mauvaise zone (regex prefix faussement attentif au SIREN), on rejoue
        // une vérification stricte — pattern <INSEE>_PLU obligatoire pour
        // rejeter, jamais sur du SIREN de PLUi.
        const m = zone.plu_nom?.match(/^(\d{5})_PLU(?:_|\.|$)/);
        const pluInsee = m?.[1];
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

  // Step 4: GéoRisques (+ RGE ALTI®) + espaces naturels protégés (apicarto Nature)
  // — tous lancés EN PARALLÈLE du bloc GPU (voir promesses plus haut) : on ne fait
  // ici que recueillir les résultats. GéoRisques exige le code INSEE (repli sismique
  // départemental) ; les espaces protégés non (interrogés au point / sur la parcelle).
  if (lat !== undefined && lng !== undefined) {
    const risks = risksPromise ? await risksPromise : null;
    const protectedAreas = protectedPromise ? await protectedPromise : [];

    if (risks) {
      result.risks = risks;
      result.data_sources.push("GéoRisques");
      if (risks.terrain_altitude_m != null) result.data_sources.push("RGE ALTI® (IGN)");
    }

    if (protectedAreas.length > 0) {
      result.protected_areas = protectedAreas;
      result.data_sources.push("apicarto Nature (INPN/MNHN)");

      // Conséquences d'instruction les plus structurantes, sans sur-alerter.
      const natura = protectedAreas.find((a) => a.type === "natura2000_habitat" || a.type === "natura2000_oiseaux");
      if (natura) {
        result.warnings.push(
          `Site Natura 2000 sur ou à proximité de la parcelle${natura.nom ? ` (${natura.nom})` : ""} — une évaluation des incidences Natura 2000 peut être requise (art. L.414-4 du code de l'environnement).`,
        );
      }
      const reserve = protectedAreas.find((a) => a.type === "reserve_naturelle");
      if (reserve) {
        result.warnings.push(
          `Réserve naturelle sur ou à proximité${reserve.nom ? ` (${reserve.nom})` : ""} — réglementation propre à la réserve, autorisation spéciale possible.`,
        );
      }
      if (protectedAreas.some((a) => a.type === "parc_national")) {
        result.warnings.push(
          "Parc national sur ou à proximité — en cœur de parc, les travaux sont soumis à autorisation spéciale du parc.",
        );
      }
      const znieff = protectedAreas.some((a) => a.type === "znieff1" || a.type === "znieff2");
      if (znieff && !natura && !reserve && !protectedAreas.some((a) => a.type === "parc_national")) {
        result.warnings.push(
          "ZNIEFF (zone naturelle d'intérêt écologique) sur ou à proximité — sensibilité environnementale à prendre en compte (porter à connaissance).",
        );
      }
    }
  }

  // Step 5: DB rules lookup — use manual zone override if GPU failed
  const zoneCodeForDb = options?.zoneOverride?.toUpperCase()
    ?? result.plu_zone?.zone_code
    ?? (isCadastralRef ? normalizedRef.slice(0, 2) : null);
  const communeForDb = result.parcel?.commune ?? result.address?.city;

  // Captured outside the if-block so the buildability step downstream can use
  // the ancestry chain to pick the most parcel-specific rule per topic.
  let zoneAncestry: string[] = [];
  if (zoneCodeForDb) {
    const { zone, rules, matchedChain } = await findDbZoneAndRules(zoneCodeForDb, communeForDb, code_insee);
    result.db_zone = zone;
    result.rules = rules;
    zoneAncestry = matchedChain;
    if (zone) {
      // If zone was manually overridden, reflect it as plu_zone so frontend renders correctly
      if (options?.zoneOverride && !result.plu_zone) {
        result.plu_zone = { zone_code: zone.code, zone_label: zone.label ?? zone.code, zone_type: zone.type ?? "U" };
      }
      result.data_sources.push("Base réglementaire HEUREKA");
      // When the parcel zone (e.g. UBai) was matched only through inherited
      // ancestors (UB), surface it so the instructeur sees what was used.
      if (matchedChain.length > 1) {
        result.warnings.push(
          `Règles héritées : ${matchedChain.join(" → ")} (les règles du secteur prévalent sur celles de la zone mère).`,
        );
      }
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
        // PLUi-aware : zones communales + zones partagées des PLUi rattachés.
        const communeZoneIds = await resolveCommuneZoneIds(communeRow.id);
        const zoneRows = communeZoneIds.length === 0 ? [] : await db
          .select({ zone_code: zones.zone_code, zone_label: zones.zone_label, zone_type: zones.zone_type })
          .from(zones)
          .where(inArray(zones.id, communeZoneIds))
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

  // ── Plan des hauteurs : compléter la hauteur depuis le document graphique ──
  // Si la commune a déposé un « plan des hauteurs » (document plan_hauteurs), on
  // résout la hauteur max de la parcelle par intersection surfacique. Sert à
  // combler le cas où le règlement écrit ne chiffre pas la hauteur (renvoi au
  // document graphique). Additif : alimente la constructibilité ci-dessous et
  // remonte un éventuel « à cheval » / renvoi. Échec silencieux (non bloquant).
  let parcelHeight: ParcelHeight | null = null;
  if (code_insee && result.parcel?.geometry) {
    try {
      const layer = await loadCommuneHeightLayer(code_insee);
      parcelHeight = resolveParcelHeight(layer, result.parcel.geometry);
    } catch { /* couche absente / DB indisponible → non bloquant */ }
  }
  // Repli LIVE : si aucune couche déposée ne couvre la parcelle, on tente la
  // prescription GPU type 39 « Hauteur maximale » déjà récupérée (résolue au
  // point — moins fiable, mais évite l'absence d'info et l'incohérence avec le
  // panneau « prescriptions » côté mairie).
  if (!parcelHeight && result.prescriptions?.length) {
    parcelHeight = heightFromPrescriptions(result.prescriptions);
  }
  if (parcelHeight) {
    result.hauteur_plan = parcelHeight;
    result.data_sources.push(
      parcelHeight.source === "plan_hauteurs" ? "Plan des hauteurs (PLU)" : "Hauteur GPU (prescription type 39)",
    );
    if (parcelHeight.a_cheval) {
      const rep = parcelHeight.repartition.map((r) => `${r.hauteur_txt} ${r.couverture_pct}%`).join(", ");
      result.warnings.push(
        `Plan des hauteurs : parcelle à cheval sur plusieurs hauteurs (${rep}). La plus stricte s'applique par partie — vérifiez la hauteur applicable à l'emprise du projet.`,
      );
    } else if (parcelHeight.categorie !== "metres") {
      result.warnings.push(`Plan des hauteurs : ${describeHeightCategory(parcelHeight.categorie)}.`);
    } else if (parcelHeight.source === "gpu_prescription") {
      // Résolu au point : on signale que la précision parcellaire suppose le dépôt de la couche.
      result.warnings.push(
        `Hauteur maximale ${parcelHeight.hauteur_txt} issue du GPU (résolue au point, à confirmer). Déposez le plan des hauteurs pour une résolution à la parcelle.`,
      );
    }
  }

  // Step 5b: Unité foncière (groupement de parcelles contiguës) ───────────────
  // Quand plusieurs parcelles sont sélectionnées, on les agrège en une seule
  // unité foncière : `result.parcel` reste la PRINCIPALE (zone/risques/règles
  // résolus dessus), mais on additionne les surfaces cadastrales pour recalculer
  // la constructibilité sur le total. La zone de chaque parcelle est résolue au
  // centroïde (best-effort) afin de signaler un groupement à cheval sur plusieurs
  // zones PLU. NB : le bâti existant (`built_footprint_m2`) n'est mesuré que sur
  // la parcelle principale — l'« emprise restante » reste donc une borne haute
  // quand des bâtiments existent sur les parcelles additionnelles.
  let uniteFonciereTotalM2: number | null = null;
  if (options?.uniteFonciere && result.parcel) {
    const principal = result.parcel;
    const wanted = options.uniteFonciere.parcelles
      .map((p) => p.replace(/[\s.]/g, "").toUpperCase())
      .filter((p) => p.length >= 14);
    const seen = new Set<string>([principal.parcelle_id]);
    const refs: ParcelleRef[] = [{
      parcelle_id: principal.parcelle_id,
      surface_m2: principal.surface_m2,
      commune: principal.commune,
      zone_code: result.plu_zone?.zone_code,
    }];
    for (const id of wanted) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = await findParcelByRef(id);
      if (!p) {
        result.warnings.push(`Parcelle ${id} introuvable via l'API cadastre — non comptée dans l'unité foncière.`);
        continue;
      }
      let zone_code: string | undefined;
      const centre = geometryCentroid(p.geometry);
      if (centre && p.code_insee) {
        try {
          const ctx = await communePluContext(p.code_insee);
          zone_code = findZoneAtPoint(ctx.zones, centre.lat, centre.lng)?.zone_code;
        } catch { /* zone facultative — ne bloque pas l'agrégation */ }
      }
      refs.push({ parcelle_id: p.parcelle_id, surface_m2: p.surface_m2, commune: p.commune, zone_code });
    }
    if (refs.length > 1) {
      const total = refs.reduce((s, r) => s + (r.surface_m2 ?? 0), 0);
      const zones = new Set(refs.map((r) => r.zone_code).filter(Boolean) as string[]);
      const zones_distinctes = zones.size > 1;
      uniteFonciereTotalM2 = total;
      result.unite_fonciere = { parcelles: refs, total_surface_m2: total, zones_distinctes };
      if (zones_distinctes) {
        result.warnings.push(
          `Les parcelles sélectionnées ne sont pas toutes sur la même zone PLU (${Array.from(zones).join(", ")}). La règle la plus stricte s'applique par partie — vérifiez la zone applicable à chaque emprise.`,
        );
      }
    }
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

    // Many PLU zones expose several sub-rules for the same topic (e.g. one per
    // sub-secteur). After the sibling filter, the surviving candidates are all
    // applicable to the parcel ; we pick the MOST specific one (whose labels
    // mention the parcel's deepest sector) instead of letting a naive « last
    // wins » loop pick arbitrarily.
    const matchedChain = zoneAncestry.length > 0 ? zoneAncestry : (result.db_zone ? [result.db_zone.code] : []);
    if (result.plu_zone && !matchedChain.includes(result.plu_zone.zone_code)) {
      matchedChain.unshift(result.plu_zone.zone_code);
    }

    const valueFor = (rule: typeof result.rules[number], pick: "max" | "min") => {
      // Fallback on the first numeric case when value_min/max/exact are absent
      // (e.g. hauteur « 9 m égout / 14 m faîtage » stored in `cases`).
      const caseVal = rule.cases?.find((c) => c.value != null)?.value ?? null;
      return pick === "max"
        ? rule.value_exact ?? rule.value_max ?? caseVal
        : rule.value_exact ?? rule.value_min ?? caseVal;
    };

    // Maxima (« ne dépasse pas X ») → value_max ; Minima (« au moins X ») →
    // value_min. Espaces verts est un MIN obligatoire — c'était le bug : on
    // lisait value_max et le calcul restait null à chaque fois.
    const topicSpec: Array<[string, "max" | "min", (v: number | null) => void]> = [
      ["emprise_sol",   "max", (v) => { calcVars.maxFootprintRatio = v; }],
      ["hauteur",       "max", (v) => { calcVars.maxHeightM = v; }],
      ["recul_voie",    "min", (v) => { calcVars.minSetbackFromRoadM = v; }],
      ["recul_limite",  "min", (v) => { calcVars.minSetbackFromBoundariesM = v; }],
      ["espaces_verts", "min", (v) => { calcVars.greenSpaceRatio = v; }],
    ];
    for (const [topic, pick, assign] of topicSpec) {
      const rule = pickMostSpecificRule(result.rules, topic, matchedChain);
      if (rule) assign(valueFor(rule, pick));
    }
    const parkingRule = pickMostSpecificRule(result.rules, "stationnement", matchedChain);
    if (parkingRule?.rule_text) calcVars.parkingRules = parkingRule.rule_text;

    // Hauteur depuis le plan des hauteurs / prescription type 39. Cette hauteur
    // est PARCELLAIRE et fait foi (le règlement écrit y renvoie) : elle PRIME donc
    // sur une éventuelle hauteur de ZONE, souvent générique voire erronée pour ces
    // communes (sinon le moteur sert une hauteur uniforme fausse sur une parcelle
    // précise). N'agit que si une hauteur parcellaire a été résolue.
    if (parcelHeight?.hauteur_m != null) {
      calcVars.maxHeightM = parcelHeight.hauteur_m;
    }
    // Emprise au sol déjà bâtie sur la parcelle (BD TOPO® bâtiments). null si
    // indéterminable → la « surface restante » ne sera alors pas affichée. L'appel
    // a été lancé en parallèle du GPU (footprintPromise) : on récupère le résultat.
    const existingFootprintM2 = footprintPromise ? await footprintPromise : null;
    if (existingFootprintM2 != null) {
      result.built_footprint_m2 = existingFootprintM2;
      result.data_sources.push("BD TOPO® (bâtiments)");
    }
    result.buildability = calculateBuildability({
      // Sur une unité foncière, la constructibilité (emprise, espaces verts) se
      // calcule sur la surface TOTALE du groupement, pas la seule principale.
      parcelSurfaceM2: uniteFonciereTotalM2 ?? result.parcel.surface_m2,
      existingFootprintM2: existingFootprintM2 ?? 0,
      calculationVariables: calcVars,
    });
  }

  // ── Zonage surfacique de la parcelle (parcelle ∩ zones) ────────────────────
  // Le zonage primaire (result.plu_zone) est résolu au POINT (adresse géocodée
  // ou centroïde) : il masque les parcelles à cheval et peut désigner la
  // mauvaise zone en limite. Quand on a la géométrie parcellaire, on calcule la
  // part d'aire couverte par CHAQUE zone : on remonte la répartition + un
  // drapeau `zone_a_cheval`, et on alerte l'instructeur quand la parcelle
  // chevauche plusieurs zones, ou quand la zone couvrant la parcelle diffère de
  // la zone résolue au point. On NE remplace PAS le zonage primaire ici (aucune
  // régression de verdict, les règles sont déjà chargées) — on rend visible une
  // information aujourd'hui invisible. La sélection de règle par emprise du
  // projet est un lot ultérieur.
  const parcelGeomForZoning = result.parcel?.geometry ?? null;
  if (
    code_insee &&
    parcelGeomForZoning &&
    (parcelGeomForZoning.type === "Polygon" || parcelGeomForZoning.type === "MultiPolygon")
  ) {
    const zoningCtx = await communePluContext(code_insee);
    const zoning = findZonesForParcel(zoningCtx.zones, parcelGeomForZoning);
    if (zoning.zones.length > 0) {
      result.zone_a_cheval = zoning.a_cheval;
      result.zones_touchees = zoning.zones.map((z) => ({
        zone_code: z.zone_code,
        zone_label: z.zone_label,
        zone_type: z.zone_type,
        couverture_pct: z.couverture_pct,
      }));
      if (zoning.a_cheval) {
        const repartition = zoning.zones.map((z) => `${z.zone_code} ${z.couverture_pct}%`).join(", ");
        result.warnings.push(
          `Parcelle à cheval sur plusieurs zones PLU (${repartition}). La règle la plus stricte s'applique par partie : vérifiez la zone applicable à l'emprise du projet.`,
        );
      } else if (
        result.plu_zone?.zone_code &&
        zoning.dominant &&
        zoning.dominant.zone_code !== result.plu_zone.zone_code
      ) {
        result.warnings.push(
          `La zone PLU résolue au point (${result.plu_zone.zone_code}) diffère de la zone couvrant la parcelle (${zoning.dominant.zone_code}, ${zoning.dominant.couverture_pct}%). À vérifier — le point a pu tomber en limite de zone.`,
        );
      }
    }
  }

  // Step 7: Synthèse thématique bi-audience — pure, dérivée de tout ce qui
  // précède (règles PLU, risques, servitudes, prescriptions). Sert à la fois la
  // vue citoyen « clair » et la vue instructeur « tracée & transversale ».
  result.synthesis = buildParcelSynthesis(result);

  return result;
}
