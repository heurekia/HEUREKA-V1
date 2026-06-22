import { describe, it, expect } from "vitest";
import type { Geometry } from "geojson";
import { parseHeightTxt, resolveParcelHeight, heightFromPrescriptions, type HeightFeatureCollection } from "./heightLayer.js";

function square(minLng: number, minLat: number, maxLng: number, maxLat: number) {
  return [[
    [minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat],
  ]];
}
function poly(a: number, b: number, c: number, d: number): Geometry {
  return { type: "Polygon", coordinates: square(a, b, c, d) };
}

// Couche : "18 m" sur [0,1]×[0,1], "10 m" sur [1,2]×[0,1], "art. 10 RU" sur [2,3]×[0,1].
const layer: HeightFeatureCollection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { hauteur_txt: "18 m" }, geometry: poly(0, 0, 1, 1) },
    { type: "Feature", properties: { hauteur_txt: "10 m" }, geometry: poly(1, 0, 2, 1) },
    { type: "Feature", properties: { hauteur_txt: "art. 10 RU" }, geometry: poly(2, 0, 3, 1) },
  ],
};

describe("parseHeightTxt", () => {
  it("lit les hauteurs chiffrées", () => {
    expect(parseHeightTxt("18 m")).toEqual({ hauteur_m: 18, categorie: "metres" });
    expect(parseHeightTxt("9 m")).toEqual({ hauteur_m: 9, categorie: "metres" });
    expect(parseHeightTxt("65 m")).toEqual({ hauteur_m: 65, categorie: "metres" });
    expect(parseHeightTxt("12,5 m")).toEqual({ hauteur_m: 12.5, categorie: "metres" });
    // Tolère un libellé verbeux (txtpsc GPU).
    expect(parseHeightTxt("Hauteur maximale : 7 m")).toEqual({ hauteur_m: 7, categorie: "metres" });
  });
  it("classe les renvois et cas spéciaux", () => {
    expect(parseHeightTxt("art. 10 RU").categorie).toBe("article_10_reglement");
    expect(parseHeightTxt("Non fixée").categorie).toBe("non_fixee");
    expect(parseHeightTxt("PM").categorie).toBe("renvoi_plan_masse");
    expect(parseHeightTxt("").categorie).toBe("autre");
    for (const t of ["art. 10 RU", "Non fixée", "PM"]) expect(parseHeightTxt(t).hauteur_m).toBeNull();
  });
});

describe("resolveParcelHeight", () => {
  it("parcelle dans un secteur chiffré : hauteur dominante, pas à cheval", () => {
    const r = resolveParcelHeight(layer, poly(0.2, 0.2, 0.8, 0.8));
    expect(r).not.toBeNull();
    expect(r!.hauteur_m).toBe(18);
    expect(r!.categorie).toBe("metres");
    expect(r!.a_cheval).toBe(false);
    expect(r!.repartition).toHaveLength(1);
  });

  it("parcelle à cheval sur deux hauteurs : drapeau + répartition + dominante par aire", () => {
    // [0.8,1.6] : ~25% en "18 m" (0.8→1.0), ~75% en "10 m" (1.0→1.6) → dominante 10 m.
    const r = resolveParcelHeight(layer, poly(0.8, 0, 1.6, 1));
    expect(r!.a_cheval).toBe(true);
    expect(r!.repartition.map((x) => x.hauteur_txt).sort()).toEqual(["10 m", "18 m"]);
    expect(r!.hauteur_txt).toBe("10 m");
    expect(r!.hauteur_m).toBe(10);
  });

  it("parcelle sur un renvoi (art. 10) : pas de hauteur chiffrée, catégorie portée", () => {
    const r = resolveParcelHeight(layer, poly(2.2, 0.2, 2.8, 0.8));
    expect(r!.hauteur_m).toBeNull();
    expect(r!.categorie).toBe("article_10_reglement");
    expect(r!.a_cheval).toBe(false);
  });

  it("renvoie null hors de toute zone, ou sans couche / géométrie", () => {
    expect(resolveParcelHeight(layer, poly(5, 5, 6, 6))).toBeNull();
    expect(resolveParcelHeight(null, poly(0, 0, 1, 1))).toBeNull();
    expect(resolveParcelHeight(layer, null)).toBeNull();
    expect(resolveParcelHeight({ type: "FeatureCollection", features: [] }, poly(0, 0, 1, 1))).toBeNull();
  });

  it("porte source = plan_hauteurs (résolu contre la géométrie)", () => {
    expect(resolveParcelHeight(layer, poly(0.2, 0.2, 0.8, 0.8))!.source).toBe("plan_hauteurs");
  });
});

describe("heightFromPrescriptions (repli GPU type 39)", () => {
  it("extrait la hauteur d'une prescription type 39 (txtpsc)", () => {
    const r = heightFromPrescriptions([
      { typepsc: "05", libelle: "Emplacement réservé", txtpsc: "V10" },
      { typepsc: "39", libelle: "Hauteur maximale", txtpsc: "7 m" },
    ]);
    expect(r).not.toBeNull();
    expect(r!.hauteur_m).toBe(7);
    expect(r!.categorie).toBe("metres");
    expect(r!.source).toBe("gpu_prescription");
  });

  it("reconnaît la hauteur via le libellé quand txtpsc est verbeux", () => {
    const r = heightFromPrescriptions([{ typepsc: "39", libelle: "Hauteur maximale", txtpsc: "Hauteur maximale : 12 m" }]);
    expect(r!.hauteur_m).toBe(12);
  });

  it("préfère la prescription chiffrée parmi plusieurs type 39", () => {
    const r = heightFromPrescriptions([
      { typepsc: "39", libelle: "Hauteur maximale", txtpsc: "art. 10 RU" },
      { typepsc: "39", libelle: "Hauteur maximale", txtpsc: "16 m" },
    ]);
    expect(r!.hauteur_m).toBe(16);
  });

  it("renvoie null sans prescription de hauteur", () => {
    expect(heightFromPrescriptions([{ typepsc: "01", libelle: "EBC", txtpsc: null }])).toBeNull();
    expect(heightFromPrescriptions([])).toBeNull();
    expect(heightFromPrescriptions(null)).toBeNull();
  });
});
