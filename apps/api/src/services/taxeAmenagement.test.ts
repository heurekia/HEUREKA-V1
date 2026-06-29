import { describe, it, expect } from "vitest";
import {
  computeTaxeAmenagement,
  tranchesResidencePrincipale,
  assietteInstallation,
  type ConstantesFiscales,
} from "./taxeAmenagement.js";

// Constantes « rondes » pour des assertions exactes et lisibles (les vraies
// valeurs forfaitaires changent chaque année ; le calcul, lui, est stable).
const CONST: ConstantesFiscales = {
  valeur_forfaitaire_m2: 1000,
  abattement_rate: 0.5,
  rap_rate: 0.4,
};

describe("tranchesResidencePrincipale", () => {
  it("découpe les 100 premiers m² (abattus) du reste (plein tarif)", () => {
    const t = tranchesResidencePrincipale(120, 100);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ surface_m2: 100, abattement: true });
    expect(t[1]).toMatchObject({ surface_m2: 20, abattement: false });
  });

  it("une seule tranche abattue si la surface est sous le seuil", () => {
    const t = tranchesResidencePrincipale(80, 100);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ surface_m2: 80, abattement: true });
  });

  it("surface nulle ou négative → aucune tranche", () => {
    expect(tranchesResidencePrincipale(0)).toEqual([]);
    expect(tranchesResidencePrincipale(-10)).toEqual([]);
  });
});

describe("assietteInstallation", () => {
  it("assiette = quantité × forfait unitaire", () => {
    expect(assietteInstallation("Piscine", 30, 250).base_eur).toBe(7500);
  });
  it("borne les valeurs négatives à 0", () => {
    expect(assietteInstallation("X", -5, 250).base_eur).toBe(0);
  });
});

describe("computeTaxeAmenagement", () => {
  it("résidence principale 120 m² — abattement sur les 100 premiers m²", () => {
    const r = computeTaxeAmenagement({
      surfaces: tranchesResidencePrincipale(120, 100),
      constantes: CONST,
      taux_communal_pct: 5,
      taux_departemental_pct: 2.5,
    });
    // Base = 100×1000×0.5 + 20×1000 = 50 000 + 20 000 = 70 000
    expect(r.assiette_surface_eur).toBe(70000);
    expect(r.base_totale_eur).toBe(70000);
    // Communale 5 % = 3 500 ; départementale 2,5 % = 1 750 ; total = 5 250
    expect(r.part_communale_eur).toBe(3500);
    expect(r.part_departementale_eur).toBe(1750);
    expect(r.taxe_amenagement_eur).toBe(5250);
    // RAP 0,40 % = 280
    expect(r.rap_eur).toBe(280);
  });

  it("intègre une installation à forfait propre (piscine) dans la base", () => {
    const r = computeTaxeAmenagement({
      surfaces: [{ surface_m2: 100, abattement: false }],
      installations: [assietteInstallation("Piscine", 30, 250)], // 7 500
      constantes: CONST,
      taux_communal_pct: 4,
      taux_departemental_pct: 1.5,
    });
    // Base = 100×1000 + 7 500 = 107 500
    expect(r.assiette_surface_eur).toBe(100000);
    expect(r.assiette_installations_eur).toBe(7500);
    expect(r.base_totale_eur).toBe(107500);
    expect(r.part_communale_eur).toBe(Math.round(107500 * 0.04)); // 4 300
    expect(r.part_departementale_eur).toBe(Math.round(107500 * 0.015)); // 1 613 (arrondi)
  });

  it("exonération communale → part communale à 0, départementale inchangée", () => {
    const r = computeTaxeAmenagement({
      surfaces: [{ surface_m2: 100, abattement: false }],
      constantes: CONST,
      taux_communal_pct: 5,
      taux_departemental_pct: 2.5,
      exoneration_communale: true,
    });
    expect(r.part_communale_eur).toBe(0);
    expect(r.part_departementale_eur).toBe(2500);
    expect(r.taxe_amenagement_eur).toBe(2500);
  });

  it("taux communal nul → part communale 0 + avertissement (TA non instituée ?)", () => {
    const r = computeTaxeAmenagement({
      surfaces: [{ surface_m2: 50, abattement: false }],
      constantes: CONST,
      taux_communal_pct: 0,
      taux_departemental_pct: 2,
    });
    expect(r.part_communale_eur).toBe(0);
    expect(r.warnings.some((w) => w.includes("part communale"))).toBe(true);
  });

  it("valeur forfaitaire absente → assiette nulle + avertissement", () => {
    const r = computeTaxeAmenagement({
      surfaces: [{ surface_m2: 100, abattement: false }],
      constantes: { valeur_forfaitaire_m2: 0, abattement_rate: 0.5, rap_rate: 0.4 },
      taux_communal_pct: 5,
      taux_departemental_pct: 2.5,
    });
    expect(r.base_totale_eur).toBe(0);
    expect(r.taxe_amenagement_eur).toBe(0);
    expect(r.warnings.some((w) => w.toLowerCase().includes("valeur forfaitaire"))).toBe(true);
  });

  it("produit une ligne d'assiette par tranche et par installation", () => {
    const r = computeTaxeAmenagement({
      surfaces: tranchesResidencePrincipale(120, 100),
      installations: [assietteInstallation("Piscine", 30, 250)],
      constantes: CONST,
      taux_communal_pct: 5,
      taux_departemental_pct: 2.5,
    });
    expect(r.lignes).toHaveLength(3); // 2 tranches + 1 installation
    expect(r.lignes.map((l) => l.base_eur)).toEqual([50000, 20000, 7500]);
  });
});
