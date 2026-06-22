import { describe, it, expect } from "vitest";
import {
  describeSeismicZone,
  describeFloodRisk,
  describeClayRisk,
  describeRadonLevel,
  seismicShortLabel,
  supConsequence,
  prescriptionConsequence,
} from "@heureka-v1/shared";

describe("riskTriage — anti-bruit", () => {
  it("ne produit aucune ligne pour une inondation non déterminée", () => {
    expect(describeFloodRisk("inconnu").show).toBe(false);
    expect(describeFloodRisk(undefined).show).toBe(false);
  });

  it("ne produit aucune ligne pour argiles/radon non significatifs", () => {
    expect(describeClayRisk("faible").show).toBe(false);
    expect(describeClayRisk("inconnu").show).toBe(false);
    expect(describeRadonLevel("1").show).toBe(false);
    expect(describeRadonLevel("inconnu").show).toBe(false);
  });

  it("masque une zone sismique inconnue mais affiche les zones 1-5", () => {
    expect(describeSeismicZone("0").show).toBe(false);
    for (const z of ["1", "2", "3", "4", "5"]) {
      expect(describeSeismicZone(z).show).toBe(true);
    }
  });
});

describe("riskTriage — sismicité parlante", () => {
  it("rend la zone 2 lisible avec son libellé et une conséquence", () => {
    const r = describeSeismicZone("2");
    expect(r.label).toContain("faible");
    expect(r.label).toContain("zone 2");
    expect(r.consequence).toBeTruthy();
  });

  it("classe les zones fortes (3-5) en vigilance (tier 2) et les faibles en contexte", () => {
    expect(describeSeismicZone("2").tier).toBe(3);
    expect(describeSeismicZone("3").tier).toBe(2);
    expect(describeSeismicZone("5").tier).toBe(2);
  });

  it("fournit un libellé court pour la pastille de synthèse", () => {
    expect(seismicShortLabel("4")).toBe("Sismicité moyenne");
    expect(seismicShortLabel("9")).toBeNull();
  });
});

describe("riskTriage — opposabilité & conséquence inondation", () => {
  it("devient opposable (tier 1) quand un PPRI couvre la parcelle", () => {
    const sansPpri = describeFloodRisk("moyen", false);
    expect(sansPpri.tier).toBe(2);
    expect(sansPpri.opposabilite).toBe("porter_a_connaissance");

    const avecPpri = describeFloodRisk("moyen", true);
    expect(avecPpri.tier).toBe(1);
    expect(avecPpri.opposabilite).toBe("opposable");
    expect(avecPpri.consequence).toContain("PPRI");
  });
});

describe("riskTriage — conséquence d'instruction des SUP", () => {
  it("mappe AC1 sur l'avis conforme ABF et la majoration de délai", () => {
    const m = supConsequence("AC1");
    expect(m?.opposabilite).toBe("opposable");
    expect(m?.consequence).toMatch(/Architecte des Bâtiments de France/);
    expect(m?.consequence).toMatch(/1 mois/);
  });

  it("retombe sur la famille quand le code exact n'est pas catalogué", () => {
    expect(supConsequence("AC9")?.consequence).toMatch(/Architecte des Bâtiments de France/);
    expect(supConsequence("PM9")?.consequence).toMatch(/PPRI/);
  });

  it("normalise la casse et gère l'absence de code", () => {
    expect(supConsequence("ac1")?.consequence).toMatch(/Architecte des Bâtiments de France/);
    expect(supConsequence("")).toBeNull();
    expect(supConsequence(undefined)).toBeNull();
  });
});

describe("riskTriage — prescriptions PLU", () => {
  it("classe une zone non aedificandi (10) en opposable fort (tier 1)", () => {
    const p = prescriptionConsequence("10");
    expect(p.tier).toBe(1);
    expect(p.consequence).toMatch(/inconstructible|refus/i);
  });

  it("fournit un repli pour un typepsc inconnu", () => {
    const p = prescriptionConsequence("99");
    expect(p.consequence).toBeTruthy();
    expect(p.tier).toBe(2);
  });
});
