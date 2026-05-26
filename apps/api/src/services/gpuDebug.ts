/**
 * gpuDebug — returns raw GPU API responses for all endpoints at given coordinates.
 * Used to inspect field names and verify data availability before mapping.
 * Endpoint: GET /public/debug/gpu?lat=...&lng=...
 */

const GPU_BASE = "https://apicarto.ign.fr/api/gpu";
const TIMEOUT = 10_000;

async function safeFetch(url: string): Promise<{ url: string; status: number | "timeout" | "error"; data: unknown }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    let data: unknown;
    try { data = await r.json(); } catch { data = null; }
    return { url, status: r.status, data };
  } catch (e: unknown) {
    const isTimeout = e instanceof Error && e.name === "TimeoutError";
    return { url, status: isTimeout ? "timeout" : "error", data: String(e) };
  }
}

export async function gpuDebug(lat: number, lng: number) {
  const pt = encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lng, lat] }));

  // Step 1: get documents (PLU partition + SCoT)
  const docResult = await safeFetch(`${GPU_BASE}/document?geom=${pt}`);

  // Extract PLU partition from document response
  let pluPartition: string | null = null;
  let scotName: string | null = null;
  try {
    const features = (docResult.data as { features?: Array<{ properties: { partition?: string; typedoc?: string; etat?: string; libelle?: string } }> })?.features ?? [];
    const PLU_TYPES = new Set(["PLU", "PLUi", "CC", "PIG", "RNU"]);
    const pluDocs = features.filter(f => PLU_TYPES.has(f.properties.typedoc ?? ""));
    const pluDoc = pluDocs.find(f => f.properties.etat === "approuve") ?? pluDocs[0];
    pluPartition = pluDoc?.properties.partition ?? null;
    const scotDoc = features.find(f => f.properties.typedoc === "SCOT");
    scotName = scotDoc?.properties.libelle ?? null;
  } catch { /* ignore */ }

  const partition = pluPartition ?? `DU_${lat}`; // fallback for display only

  // Parcel bbox ~100m for SUP queries
  const DLAT = 0.00090, DLNG = 0.00130;
  const bbox = encodeURIComponent(JSON.stringify({
    type: "Polygon",
    coordinates: [[[lng - DLNG, lat - DLAT], [lng + DLNG, lat - DLAT], [lng + DLNG, lat + DLAT], [lng - DLNG, lat + DLAT], [lng - DLNG, lat - DLAT]]],
  }));

  // Bbox 700m for generateurs
  const DLAT7 = 0.0063, DLNG7 = 0.0092;
  const bbox700 = encodeURIComponent(JSON.stringify({
    type: "Polygon",
    coordinates: [[[lng - DLNG7, lat - DLAT7], [lng + DLNG7, lat - DLAT7], [lng + DLNG7, lat + DLAT7], [lng - DLNG7, lat + DLAT7], [lng - DLNG7, lat - DLAT7]]],
  }));

  const partQ = pluPartition ? `&partition=${pluPartition}` : "";

  // Run all calls in sequence to avoid rate-limiting
  const zoneUrba      = await safeFetch(`${GPU_BASE}/zone-urba?geom=${pt}${partQ}`);
  const municipality  = await safeFetch(`${GPU_BASE}/municipality?geom=${pt}`);
  const prescSurf     = await safeFetch(`${GPU_BASE}/prescription-surf?geom=${pt}${partQ}`);
  const infoSurf      = await safeFetch(`${GPU_BASE}/info-surf?geom=${pt}${partQ}`);
  const infoLin       = await safeFetch(`${GPU_BASE}/info-lin?geom=${pt}${partQ}`);
  const infoPct       = await safeFetch(`${GPU_BASE}/info-pct?geom=${pt}${partQ}`);
  const assietteSurfS = await safeFetch(`${GPU_BASE}/assiette-sup-s?geom=${bbox}&_limit=20`);
  const assietteSurfL = await safeFetch(`${GPU_BASE}/assiette-sup-l?geom=${bbox}&_limit=20`);
  const generateurS   = await safeFetch(`${GPU_BASE}/generateur-sup-s?geom=${bbox700}&_limit=30`);

  return {
    coordinates: { lat, lng },
    resolved: { pluPartition, scotName },
    endpoints: {
      document:          docResult,
      zone_urba:         zoneUrba,
      municipality,
      prescription_surf: prescSurf,
      info_surf:         infoSurf,
      info_lin:          infoLin,
      info_pct:          infoPct,
      assiette_sup_s:    assietteSurfS,
      assiette_sup_l:    assietteSurfL,
      generateur_sup_s:  generateurS,
    },
  };
}
