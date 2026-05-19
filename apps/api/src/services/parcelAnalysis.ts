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

// ── GPU PLU Zone lookup ───────────────────────────────────────────────────────

export async function findPluZone(lat: number, lng: number, codeInsee?: string): Promise<PluZoneResult | null> {
  try {
    // Use geom (GeoJSON Point) + partition=DU_<codeINSEE> to constrain the query to the
    // correct commune's PLU — without partition, APICarto GPU can return zones from
    // neighboring communes, especially near municipal boundaries.
    const geom = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
    const params = new URLSearchParams({ geom });
    if (codeInsee) params.set("partition", `DU_${codeInsee}`);
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
export async function analyseParcel(query: string, options?: { citycode?: string; zoneOverride?: string }): Promise<ParcelAnalysis> {
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
  let code_insee: string | undefined = options?.citycode;

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
    // Free-text address — try with citycode first (avoids homonymous street false matches),
    // then retry without if the constrained search returns nothing.
    let addr = await geocodeAddress(query, options?.citycode);
    if (!addr && options?.citycode) {
      // Retry without citycode: some valid addresses have a low BAN score under citycode constraint
      const fallback = await geocodeAddress(query);
      if (fallback && fallback.citycode === options.citycode) {
        addr = fallback;  // Only accept if still in the expected commune
      }
    }

    if (addr) {
      result.address = addr;
      result.data_sources.push("BAN (api-adresse)");
      lat = addr.lat;
      lng = addr.lng;
      code_insee = addr.citycode;

      // Step 2: Find parcel at those coordinates — constrain to commune to avoid wrong results
      const parcel = await findParcelByLatLng(lat, lng, code_insee);
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
      // BAN couldn't geocode the address — don't abort, continue to step 5b so the
      // instructeur sees the zone picker and can select the zone manually.
      result.warnings.push("Adresse non reconnue par la BAN. Corrigez l'adresse via le crayon ou sélectionnez la zone manuellement.");
    }
  }

  // Step 3: GPU PLU zone — pass code_insee so the partition constraint targets the correct commune
  if (lat !== undefined && lng !== undefined) {
    const zone = await findPluZone(lat, lng, code_insee);
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
  }

  // Step 3b: GPU supplementary data (municipality RNU, prescriptions, SUP) — run in parallel
  if (lat !== undefined && lng !== undefined) {
    const partition = code_insee ? `DU_${code_insee}` : undefined;
    const [municipality, prescriptions, servitudes] = await Promise.all([
      getMunicipality(lat, lng),
      getPrescriptionsSurf(lat, lng, partition),
      getServitudesSurf(lat, lng, partition),
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
