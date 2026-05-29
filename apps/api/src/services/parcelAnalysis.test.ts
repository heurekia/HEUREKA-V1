import { describe, it, expect } from "vitest";
import { pickNearestCoord } from "./parcelAnalysis.js";

describe("pickNearestCoord", () => {
  const refLat = 47.389;
  const refLng = 0.688;

  it("retourne le point le plus proche de la référence", () => {
    const near: [number, number] = [0.6881, 47.3891];
    const far: [number, number] = [0.70, 47.40];
    const r = pickNearestCoord([far, near], refLat, refLng);
    expect(r).toEqual({ lat: 47.3891, lng: 0.6881 });
  });

  it("convertit l'ordre GeoJSON [lng, lat] vers {lat, lng}", () => {
    const r = pickNearestCoord([[0.688, 47.389]], refLat, refLng);
    expect(r).toEqual({ lat: 47.389, lng: 0.688 });
  });

  it("renvoie null pour une liste vide", () => {
    expect(pickNearestCoord([], refLat, refLng)).toBeNull();
  });

  it("ignore les coordonnées non numériques", () => {
    const bad = [undefined as unknown as number, 47.39] as [number, number];
    const good: [number, number] = [0.688, 47.389];
    const r = pickNearestCoord([bad, good], refLat, refLng);
    expect(r).toEqual({ lat: 47.389, lng: 0.688 });
  });

  it("est stable : le premier rencontré gagne à distance égale", () => {
    const a: [number, number] = [0.688, 47.389];
    const b: [number, number] = [0.688, 47.389];
    const r = pickNearestCoord([a, b], refLat, refLng);
    expect(r).toEqual({ lat: 47.389, lng: 0.688 });
  });
});
