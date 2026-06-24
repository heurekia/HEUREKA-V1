import { describe, it, expect, vi, afterEach } from "vitest";
import { getRisks, getTerrainAltitude } from "./parcelAnalysis.js";

// Réseau bloqué en CI/sandbox : on mocke `fetch` et on aiguille par endpoint.
// Coordonnées Tours (37) → la table départementale de REPLI donne la zone "2".
const LAT = 47.3941;
const LNG = 0.6848;
const INSEE = "37261";

type Json = Record<string, unknown>;
const ok = (body: Json): Response => ({ ok: true, status: 200, json: async () => body }) as Response;
const ko = (): Response => ({ ok: false, status: 503, json: async () => ({}) }) as Response;

/** Routeur de mock : chaque source répond via son handler (KO par défaut). */
function route(h: {
  gaspar?: () => Response;
  sismique?: () => Response;
  rga?: () => Response;
  alti?: () => Response;
}) {
  return vi.fn(async (url: string) => {
    if (url.includes("data.geopf.fr/altimetrie")) return (h.alti ?? ko)();
    if (url.includes("zonage_sismique")) return (h.sismique ?? ko)();
    if (url.includes("/api/v1/rga")) return (h.rga ?? ko)();
    if (url.includes("gaspar/alea")) return (h.gaspar ?? ko)();
    return ko();
  });
}

afterEach(() => vi.restoreAllMocks());

describe("getTerrainAltitude — RGE ALTI®", () => {
  it("parse la forme zonly ({ elevations: [number] })", async () => {
    vi.stubGlobal("fetch", route({ alti: () => ok({ elevations: [48.7] }) }));
    expect(await getTerrainAltitude(LAT, LNG)).toBe(48.7);
  });

  it("parse la forme objet ({ elevations: [{ z }] }) et arrondit au décimètre", async () => {
    vi.stubGlobal("fetch", route({ alti: () => ok({ elevations: [{ z: 48.673, lat: LAT, lon: LNG }] }) }));
    expect(await getTerrainAltitude(LAT, LNG)).toBe(48.7);
  });

  it("renvoie null sur la sentinelle -99999 (hors couverture RGE ALTI)", async () => {
    vi.stubGlobal("fetch", route({ alti: () => ok({ elevations: [-99999] }) }));
    expect(await getTerrainAltitude(LAT, LNG)).toBeNull();
  });

  it("renvoie null si le service répond en erreur", async () => {
    vi.stubGlobal("fetch", route({ alti: ko }));
    expect(await getTerrainAltitude(LAT, LNG)).toBeNull();
  });
});

describe("getRisks — enrichissement (altitude, sismicité & argiles au point)", () => {
  it("ajoute l'altitude RGE ALTI® au résultat", async () => {
    vi.stubGlobal("fetch", route({ gaspar: () => ok({ data: [] }), alti: () => ok({ elevations: [48.7] }) }));
    const r = await getRisks(LAT, LNG, INSEE);
    expect(r.terrain_altitude_m).toBe(48.7);
  });

  it("la sismicité AU POINT (zonage_sismique) prime sur la table départementale", async () => {
    vi.stubGlobal("fetch", route({
      gaspar: () => ok({ data: [] }),
      sismique: () => ok({ data: [{ code_zone: "3", zone_sismicite: "Modérée" }] }),
    }));
    const r = await getRisks(LAT, LNG, INSEE);
    expect(r.seismic_zone).toBe("3"); // ≠ "2" que donnerait le repli (dept 37)
  });

  it("REPLI sur la table départementale si le zonage au point échoue", async () => {
    vi.stubGlobal("fetch", route({ gaspar: () => ok({ data: [] }), sismique: ko }));
    const r = await getRisks(LAT, LNG, INSEE);
    expect(r.seismic_zone).toBe("2"); // comportement historique préservé
  });

  it("l'exposition argiles AU POINT (RGA) prime sur la maille GASPAR", async () => {
    vi.stubGlobal("fetch", route({
      gaspar: () => ok({ data: [{ codePhenomene: "ARGILES", niveauAlea: "Faible" }] }),
      rga: () => ok({ data: [{ exposition: "Fort" }] }),
    }));
    const r = await getRisks(LAT, LNG, INSEE);
    expect(r.clay_risk).toBe("fort");
  });

  it("conserve l'extraction GASPAR (inondation / mouvement / radon) — non-régression", async () => {
    vi.stubGlobal("fetch", route({
      gaspar: () => ok({ data: [
        { codePhenomene: "INONDATION", niveauAlea: "Moyen" },
        { codePhenomene: "MVMT_TERRAIN", niveauAlea: "Fort" },
        { codePhenomene: "RADON", niveauAlea: "3" },
      ] }),
    }));
    const r = await getRisks(LAT, LNG, INSEE);
    expect(r.flood_risk).toBe("moyen");
    expect(r.landslide_risk).toBe("fort");
    expect(r.radon_level).toBe("3");
  });

  it("tout en échec → champs « inconnu », altitude null, sismicité par repli (aucune exception)", async () => {
    vi.stubGlobal("fetch", route({})); // toutes les sources KO
    const r = await getRisks(LAT, LNG, INSEE);
    expect(r.flood_risk).toBe("inconnu");
    expect(r.clay_risk).toBe("inconnu");
    expect(r.radon_level).toBe("inconnu");
    expect(r.terrain_altitude_m).toBeNull();
    expect(r.seismic_zone).toBe("2"); // repli départemental
  });
});
