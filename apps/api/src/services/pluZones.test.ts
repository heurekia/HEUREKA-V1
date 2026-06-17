import { describe, it, expect } from "vitest";
import { findZoneAtPoint, filterZonesByInsee } from "./pluZones.js";

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
