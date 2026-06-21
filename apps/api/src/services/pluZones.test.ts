import { describe, it, expect } from "vitest";
import { findZoneAtPoint, filterZonesByInsee, clipZonesToCommune } from "./pluZones.js";

// Helpers de construction de zones GeoJSON minimales — uniquement les champs
// que findZoneAtPoint et filterZonesByInsee inspectent (libelle, typezone,
// geometry, insee).

function square(minLng: number, minLat: number, maxLng: number, maxLat: number) {
  return [[
    [minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat],
  ]];
}

describe("findZoneAtPoint", () => {
  it("trouve la zone qui contient le point", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "UA", libelong: "Centre-bourg", typezone: "U", insee: "41047" },
          geometry: { type: "Polygon", coordinates: square(0, 0, 1, 1) } },
        { type: "Feature", properties: { libelle: "A", libelong: "Agricole", typezone: "A", insee: "41047" },
          geometry: { type: "Polygon", coordinates: square(1, 0, 2, 1) } },
      ],
    };
    // Point dans le carré UA
    const ua = findZoneAtPoint(zones, 0.5, 0.5);
    expect(ua).not.toBeNull();
    expect(ua!.zone_code).toBe("UA");
    expect(ua!.zone_type).toBe("U");
    // Point dans le carré A
    const a = findZoneAtPoint(zones, 0.5, 1.5);
    expect(a).not.toBeNull();
    expect(a!.zone_code).toBe("A");
    expect(a!.zone_type).toBe("A");
  });

  it("renvoie null quand aucune zone ne couvre le point", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "UA", typezone: "U" },
          geometry: { type: "Polygon", coordinates: square(0, 0, 1, 1) } },
      ],
    };
    expect(findZoneAtPoint(zones, 5, 5)).toBeNull();
  });

  it("renvoie null pour des zones nulles/vides (signature défensive)", () => {
    expect(findZoneAtPoint(null, 0, 0)).toBeNull();
    expect(findZoneAtPoint(undefined, 0, 0)).toBeNull();
    expect(findZoneAtPoint({ type: "FeatureCollection", features: [] }, 0, 0)).toBeNull();
  });

  it("gère un MultiPolygon : trouve dans n'importe quel sous-polygone", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "N", typezone: "N" },
          geometry: { type: "MultiPolygon", coordinates: [square(0, 0, 1, 1), square(2, 2, 3, 3)] } },
      ],
    };
    expect(findZoneAtPoint(zones, 0.5, 0.5)?.zone_code).toBe("N");
    expect(findZoneAtPoint(zones, 2.5, 2.5)?.zone_code).toBe("N");
    // Entre les deux : pas couvert
    expect(findZoneAtPoint(zones, 1.5, 1.5)).toBeNull();
  });

  it("respecte les trous (interior rings) d'un Polygon", () => {
    // Carré 0..10 avec un trou 4..6
    const withHole = [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ];
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "UB", typezone: "U" },
          geometry: { type: "Polygon", coordinates: withHole } },
      ],
    };
    // Hors du trou : couvert
    expect(findZoneAtPoint(zones, 1, 1)?.zone_code).toBe("UB");
    // Dans le trou : pas couvert
    expect(findZoneAtPoint(zones, 5, 5)).toBeNull();
  });

  it("ignore les features sans géométrie polygonale", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "X" }, geometry: { type: "Point", coordinates: [0, 0] } },
        { type: "Feature", properties: { libelle: "UA", typezone: "U" },
          geometry: { type: "Polygon", coordinates: square(0, 0, 1, 1) } },
      ],
    };
    expect(findZoneAtPoint(zones, 0.5, 0.5)?.zone_code).toBe("UA");
  });

  it("renvoie le libelle comme zone_code et le libelong comme zone_label", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "UBai", libelong: "Secteur ancien dense", typezone: "U" },
          geometry: { type: "Polygon", coordinates: square(0, 0, 1, 1) } },
      ],
    };
    const z = findZoneAtPoint(zones, 0.5, 0.5)!;
    expect(z.zone_code).toBe("UBai");
    expect(z.zone_label).toBe("Secteur ancien dense");
  });
});

describe("filterZonesByInsee", () => {
  it("retire les zones d'INSEE différent", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { insee: "41047", libelle: "A" }, geometry: { type: "Polygon", coordinates: square(0, 0, 1, 1) } },
        { type: "Feature", properties: { insee: "41100", libelle: "N" }, geometry: { type: "Polygon", coordinates: square(2, 2, 3, 3) } },
      ],
    };
    const cleaned = filterZonesByInsee(zones, "41047");
    expect(cleaned.features).toHaveLength(1);
    expect((cleaned.features![0] as { properties: { libelle: string } }).properties.libelle).toBe("A");
  });

  it("conserve tout quand aucune feature ne porte d'INSEE (vieux datasets)", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "A" }, geometry: { type: "Polygon", coordinates: square(0, 0, 1, 1) } },
      ],
    };
    const cleaned = filterZonesByInsee(zones, "41047");
    expect(cleaned.features).toHaveLength(1);
  });

  it("renvoie l'original si le filtre vide tout (sécurité anti-régression carte vide)", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { insee: "41100", libelle: "A" }, geometry: { type: "Polygon", coordinates: square(0, 0, 1, 1) } },
      ],
    };
    const cleaned = filterZonesByInsee(zones, "41047");
    // Plutôt que retourner zéro feature (carte vide), on garde l'original.
    expect(cleaned.features).toHaveLength(1);
  });
});

describe("clipZonesToCommune", () => {
  // Contour commune = carré 0..10 (géométrie Polygon).
  const commune = { type: "Polygon" as const, coordinates: square(0, 0, 10, 10) };

  it("rogne une zone qui déborde du contour", () => {
    // Zone 5..15 : la moitié droite déborde, on doit la rogner à 5..10.
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "UA", typezone: "U" },
          geometry: { type: "Polygon", coordinates: square(5, 0, 15, 10) } },
      ],
    };
    const clipped = clipZonesToCommune(zones, commune);
    expect(clipped.features).toHaveLength(1);
    const g = (clipped.features![0] as { geometry: { type: string; coordinates: number[][][][] } }).geometry;
    expect(g.type).toBe("MultiPolygon");
    // Tous les sommets rognés sont dans [0,10]×[0,10].
    const xs = g.coordinates.flat(2).map(p => p[0]!);
    const ys = g.coordinates.flat(2).map(p => p[1]!);
    expect(Math.max(...xs)).toBeLessThanOrEqual(10);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(10);
  });

  it("retire une zone entièrement hors commune (intersection vide)", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "A", typezone: "A" },
          geometry: { type: "Polygon", coordinates: square(20, 20, 30, 30) } },
      ],
    };
    expect(clipZonesToCommune(zones, commune).features).toHaveLength(0);
  });

  it("conserve une zone entièrement contenue (rognage neutre)", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "UB", typezone: "U" },
          geometry: { type: "Polygon", coordinates: square(2, 2, 4, 4) } },
      ],
    };
    const clipped = clipZonesToCommune(zones, commune);
    expect(clipped.features).toHaveLength(1);
    // La zone rognée reste localisable par point-in-polygon.
    expect(findZoneAtPoint(clipped, 3, 3)?.zone_code).toBe("UB");
  });

  it("conserve une zone qui CONTIENT toute la commune (cas A/N d'un PLUi)", () => {
    // Grande zone -5..15 qui englobe la commune 0..10 : aucun sommet de la zone
    // n'est dans la commune, mais les sommets de la commune sont dans la zone.
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "A", typezone: "A" },
          geometry: { type: "Polygon", coordinates: square(-5, -5, 15, 15) } },
      ],
    };
    const clipped = clipZonesToCommune(zones, commune);
    expect(clipped.features).toHaveLength(1);
    // Rognée à la commune → reste localisable partout dans 0..10.
    expect(findZoneAtPoint(clipped, 5, 5)?.zone_code).toBe("A");
    const g = (clipped.features![0] as { geometry: { coordinates: number[][][][] } }).geometry;
    const xs = g.coordinates.flat(2).map(p => p[0]!);
    expect(Math.max(...xs)).toBeLessThanOrEqual(10);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  });

  it("laisse passer les features sans géométrie polygonale", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "X" }, geometry: { type: "Point", coordinates: [1, 1] } },
      ],
    };
    expect(clipZonesToCommune(zones, commune).features).toHaveLength(1);
  });

  it("conserve les zones de chaque morceau d'une commune MultiPolygon (exclave)", () => {
    // Commune en deux morceaux : 0..10 et 20..30.
    const multi = { type: "MultiPolygon" as const, coordinates: [square(0, 0, 10, 10), square(20, 20, 30, 30)] };
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "UA", typezone: "U" }, geometry: { type: "Polygon", coordinates: square(2, 2, 4, 4) } },
        { type: "Feature", properties: { libelle: "A", typezone: "A" }, geometry: { type: "Polygon", coordinates: square(22, 22, 24, 24) } },
      ],
    };
    const clipped = clipZonesToCommune(zones, multi);
    // Les deux zones (une par morceau) sont conservées.
    expect(clipped.features).toHaveLength(2);
    expect(findZoneAtPoint(clipped, 3, 3)?.zone_code).toBe("UA");
    expect(findZoneAtPoint(clipped, 23, 23)?.zone_code).toBe("A");
  });

  it("retire une zone située dans un trou de la commune (enclave)", () => {
    // Commune 0..10 avec une enclave (trou) 4..6 qui n'en fait PAS partie.
    const withHole = {
      type: "Polygon" as const,
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
      ],
    };
    const zones = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { libelle: "ENCLAVE", typezone: "U" }, geometry: { type: "Polygon", coordinates: square(4.4, 4.4, 5.6, 5.6) } },
        { type: "Feature", properties: { libelle: "UB", typezone: "U" }, geometry: { type: "Polygon", coordinates: square(1, 1, 3, 3) } },
      ],
    };
    const clipped = clipZonesToCommune(zones, withHole);
    // La zone dans le trou disparaît ; celle hors trou reste.
    expect(clipped.features).toHaveLength(1);
    expect((clipped.features![0] as { properties: { libelle: string } }).properties.libelle).toBe("UB");
  });
});
