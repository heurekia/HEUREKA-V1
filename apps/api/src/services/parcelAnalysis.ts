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

export interface RiskResult {
  flood_risk: "fort" | "moyen" | "faible" | "nul" | "inconnu";
  seismic_zone: string;
  clay_risk: "fort" | "moyen" | "faible" | "nul" | "inconnu";
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
}

// ── Geocoding ────────────────────────────────────────────────────────────────

export async function geocodeAddress(address: string): Promise<AddressResult | null> {
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json() as {
      features?: Array<{
        geometry: { coordinates: [number, number] };
        properties: {
          label: string; score: number; citycode: string;
          postcode: string; city: string;
        };
      }>;
    };
    const f = data.features?.[0];
    if (!f || f.properties.score < 0.3) return null;
    return {
      label: f.properties.label,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      citycode: f.properties.citycode,
      postcode: f.properties.postcode,
      city: f.properties.city,
      score: f.properties.score,
    };
  } catch {
    return null;
  }
}

// ── Cadastral parcel lookup ──────────────────────────────────────────────────

export async function findParcelByLatLng(lat: number, lng: number): Promise<ParcelResult | null> {
  try {
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?lon=${lng}&lat=${lat}&_limit=1`;
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
    // parcelle_id format: 37018000AB0123 → commune=37018, section=AB, numero=0123
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${parcelle_id.slice(0, 5)}&section=${parcelle_id.slice(7, 9)}&numero=${parcelle_id.slice(9)}&_limit=1`;
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

// ── GPU PLU Zone lookup ───────────────────────────────────────────────────────

export async function findPluZone(lat: number, lng: number): Promise<PluZoneResult | null> {
  try {
    const url = `https://apicarto.ign.fr/api/gpu/zone-urba?lon=${lng}&lat=${lat}`;
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

// ── GéoRisques risk lookup ────────────────────────────────────────────────────

export async function getRisks(lat: number, lng: number, code_insee: string): Promise<RiskResult> {
  const result: RiskResult = {
    flood_risk: "inconnu",
    seismic_zone: "inconnu",
    clay_risk: "inconnu",
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
        if (item.codePhenomene === "INONDATION") {
          const niv = item.niveauAlea?.toLowerCase() ?? "";
          result.flood_risk = niv.includes("fort") ? "fort" : niv.includes("moyen") ? "moyen" : niv.includes("faible") ? "faible" : "nul";
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

async function findDbZoneAndRules(zoneCode: string, communeNom?: string): Promise<{
  zone: { id: string; code: string; label: string | null; type: string | null } | null;
  rules: RegDbRule[];
}> {
  // Try exact match first, then parent zone (e.g. "UBai" → try "UB" too)
  let foundZone = null;
  const attempts = [zoneCode, zoneCode.slice(0, -1), zoneCode.slice(0, -2)].filter(z => z.length >= 2);

  for (const code of attempts) {
    let query = db.select().from(zones).where(eq(zones.zone_code, code));
    if (communeNom) {
      // join with communes to filter by commune
      const communeRows = await db.select().from(communes).where(ilike(communes.name, `%${communeNom}%`)).limit(1);
      if (communeRows[0]) {
        query = db.select().from(zones).where(and(eq(zones.zone_code, code), eq(zones.commune_id, communeRows[0].id)));
      }
    }
    const rows = await query.limit(1);
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
export async function analyseParcel(query: string): Promise<ParcelAnalysis> {
  const result: ParcelAnalysis = {
    query,
    rules: [],
    buildability: null,
    data_sources: [],
    warnings: [],
  };

  const isCadastralRef = /^\d{5}[A-Z0-9]{9,}$/i.test(query.replace(/[\s.]/g, ""));
  const normalizedRef = query.replace(/[\s.]/g, "").toUpperCase();

  let lat: number | undefined;
  let lng: number | undefined;
  let code_insee: string | undefined;

  // Step 1: Resolve coordinates
  if (isCadastralRef) {
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
    // Free-text address
    const addr = await geocodeAddress(query);
    if (addr) {
      result.address = addr;
      result.data_sources.push("BAN (api-adresse)");
      lat = addr.lat;
      lng = addr.lng;
      code_insee = addr.citycode;

      // Step 2: Find parcel at those coordinates
      const parcel = await findParcelByLatLng(lat, lng);
      if (parcel) {
        if (parcel.code_insee !== addr.citycode) {
          // IGN Cadastre sometimes returns a parcel from a neighboring commune
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
      result.warnings.push("Adresse non reconnue. Vérifiez l'orthographe ou utilisez la référence cadastrale.");
      return result;
    }
  }

  // Step 3: GPU PLU zone
  if (lat !== undefined && lng !== undefined) {
    const zone = await findPluZone(lat, lng);
    if (zone) {
      result.plu_zone = zone;
      result.data_sources.push("GPU (Géoportail de l'Urbanisme)");
    } else {
      result.warnings.push("Zone PLU non disponible sur le Géoportail de l'Urbanisme pour cette localisation.");
    }
  }

  // Step 4: GéoRisques
  if (lat !== undefined && lng !== undefined && code_insee) {
    const risks = await getRisks(lat, lng, code_insee);
    result.risks = risks;
    result.data_sources.push("GéoRisques");
  }

  // Step 5: DB rules lookup
  const zoneCodeForDb = result.plu_zone?.zone_code ?? (isCadastralRef ? normalizedRef.slice(0, 2) : null);
  const communeForDb = result.parcel?.commune ?? result.address?.city;

  if (zoneCodeForDb) {
    const { zone, rules } = await findDbZoneAndRules(zoneCodeForDb, communeForDb);
    result.db_zone = zone;
    result.rules = rules;
    if (zone) result.data_sources.push("Base réglementaire HEUREKA");
    else result.warnings.push(`Aucune règle enregistrée pour la zone ${zoneCodeForDb} dans la base HEUREKA.`);
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
