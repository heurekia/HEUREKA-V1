import { describe, it, expect, vi, afterEach } from "vitest";
import { getProtectedAreas } from "./parcelAnalysis.js";

// Réseau bloqué en CI/sandbox (et apicarto refusé par la policy du proxy) : on
// mocke `fetch` et on aiguille par COUCHE nature. Coordonnées Camargue (un point
// qui, en réel, recoupe Natura 2000 + ZNIEFF + PNR) — sans valeur ici car le
// routeur ignore la géométrie et ne se base que sur le chemin de la couche.
const LAT = 43.48;
const LNG = 4.43;

type Json = Record<string, unknown>;
const ok = (body: Json): Response => ({ ok: true, status: 200, json: async () => body }) as Response;
const ko = (): Response => ({ ok: false, status: 503, json: async () => ({}) }) as Response;
// Fabrique une FeatureCollection GeoJSON à partir d'une liste de `properties`.
const fc = (props: Json[]) => ({ type: "FeatureCollection", features: props.map((p) => ({ type: "Feature", properties: p })) });

/** Routeur de mock : chaque couche `/api/nature/<path>` répond via son handler. */
function route(h: Partial<Record<string, () => Response>>) {
  return vi.fn(async (url: string) => {
    for (const path of Object.keys(h)) {
      // `?` suit immédiatement le chemin → match de segment exact (znieff1 ≠ znieff2).
      if (url.includes(`/api/nature/${path}?`)) return h[path]!();
    }
    return ko();
  });
}

afterEach(() => vi.restoreAllMocks());

describe("getProtectedAreas — apicarto module Nature", () => {
  it("mappe un site Natura 2000 (habitat) : type fiable + nom + sitecode", async () => {
    vi.stubGlobal("fetch", route({
      "natura-habitat": () => ok(fc([{ sitecode: "FR9301592", nom_site: "Camargue" }])),
    }));
    expect(await getProtectedAreas(LAT, LNG)).toEqual([
      { type: "natura2000_habitat", label: "Natura 2000 — Directive Habitats (ZSC)", nom: "Camargue", code: "FR9301592" },
    ]);
  });

  it("mappe une ZNIEFF via ses clés propres (lb_zn / id_mnhn)", async () => {
    vi.stubGlobal("fetch", route({
      "znieff1": () => ok(fc([{ lb_zn: "Marais de X", id_mnhn: "930012345" }])),
    }));
    expect(await getProtectedAreas(LAT, LNG)).toEqual([
      { type: "znieff1", label: "ZNIEFF de type I", nom: "Marais de X", code: "930012345" },
    ]);
  });

  it("agrège plusieurs couches et dédoublonne un même site d'une couche", async () => {
    vi.stubGlobal("fetch", route({
      "natura-oiseaux": () => ok(fc([
        { sitecode: "FR9310019", nom_site: "Camargue" },
        { sitecode: "FR9310019", nom_site: "Camargue" }, // doublon (plusieurs polygones)
      ])),
      "pnr": () => ok(fc([{ nom: "Camargue" }])),
    }));
    const areas = await getProtectedAreas(LAT, LNG);
    const types = areas.map((a) => a.type);
    expect(types).toContain("natura2000_oiseaux");
    expect(types).toContain("parc_naturel_regional");
    // Le doublon Natura 2000 est réduit à une seule entrée…
    expect(areas.filter((a) => a.type === "natura2000_oiseaux")).toHaveLength(1);
    // …mais le PNR (type différent, même nom) n'est PAS dédoublonné avec lui.
    expect(areas).toHaveLength(2);
  });

  it("garde un type fiable même quand aucune propriété de nom n'est exposée", async () => {
    vi.stubGlobal("fetch", route({ "rnn": () => ok(fc([{ foo: "bar" }])) }));
    const areas = await getProtectedAreas(LAT, LNG);
    expect(areas[0]).toMatchObject({ type: "reserve_naturelle", label: "Réserve naturelle nationale" });
    expect(areas[0]!.nom).toBeUndefined();
    expect(areas[0]!.code).toBeUndefined();
  });

  it("toutes les couches en échec → [] (aucune exception)", async () => {
    vi.stubGlobal("fetch", route({}));
    expect(await getProtectedAreas(LAT, LNG)).toEqual([]);
  });
});
