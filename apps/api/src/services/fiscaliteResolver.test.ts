import { describe, it, expect } from "vitest";
import {
  assembleFiscalite,
  departementCodeFromInsee,
  isIdfDepartement,
  type NationalConstantsRow,
  type CommuneFiscaliteRow,
} from "./fiscaliteResolver.js";

const NAT2026: NationalConstantsRow = {
  year: 2026,
  valeur_forfaitaire_m2: 892,
  valeur_forfaitaire_m2_idf: 1011,
  abattement_rate: 0.5,
  abattement_surface_threshold_m2: 100,
  rap_rate: 0.4,
  forfait_piscine_m2: 251,
  forfait_stationnement_min: 2928,
  forfait_stationnement_max: 5857,
};

const COMM: CommuneFiscaliteRow = {
  part_communale_rate: 5,
  secteurs_taux_majore: null,
  exonerations_facultatives: ["abris_jardin_soumis_dp"],
  deliberation_ref: "DCM 2025-42",
  deliberation_date: new Date("2025-09-15"),
  effective_from: new Date("2026-01-01"),
};

describe("departementCodeFromInsee", () => {
  it("métropole = 2 premiers caractères", () => {
    expect(departementCodeFromInsee("37261")).toBe("37");
    expect(departementCodeFromInsee("75056")).toBe("75");
  });
  it("Corse 2A/2B", () => {
    expect(departementCodeFromInsee("2A004")).toBe("2A");
    expect(departementCodeFromInsee("2B033")).toBe("2B");
  });
  it("outre-mer = 3 premiers chiffres", () => {
    expect(departementCodeFromInsee("97411")).toBe("974");
  });
  it("vide si insee absent", () => {
    expect(departementCodeFromInsee(null)).toBe("");
  });
});

describe("isIdfDepartement", () => {
  it("reconnaît les départements franciliens", () => {
    expect(isIdfDepartement("75")).toBe(true);
    expect(isIdfDepartement("93")).toBe(true);
    expect(isIdfDepartement("37")).toBe(false);
  });
});

describe("assembleFiscalite", () => {
  it("tout présent (hors IDF) → valeur métropole + complétude totale", () => {
    const r = assembleFiscalite({ year: 2026, isIdf: false, national: NAT2026, departementalRatePct: 1.5, communale: COMM });
    expect(r.valeur_forfaitaire_m2).toBe(892);
    expect(r.constantes?.valeur_forfaitaire_m2).toBe(892);
    expect(r.taux_communal_pct).toBe(5);
    expect(r.taux_departemental_pct).toBe(1.5);
    expect(r.completeness).toEqual({ national: true, communale: true, departementale: true });
    expect(r.warnings).toHaveLength(0);
    expect(r.source.communale?.deliberation_ref).toBe("DCM 2025-42");
  });

  it("IDF → retient la valeur forfaitaire majorée", () => {
    const r = assembleFiscalite({ year: 2026, isIdf: true, national: NAT2026, departementalRatePct: 1.5, communale: COMM });
    expect(r.valeur_forfaitaire_m2).toBe(1011);
    expect(r.constantes?.valeur_forfaitaire_m2).toBe(1011);
  });

  it("commune non renseignée → taux communal null + warning + complétude communale false", () => {
    const r = assembleFiscalite({ year: 2026, isIdf: false, national: NAT2026, departementalRatePct: 1.5, communale: null });
    expect(r.taux_communal_pct).toBeNull();
    expect(r.completeness.communale).toBe(false);
    expect(r.warnings.some((w) => w.toLowerCase().includes("communale"))).toBe(true);
    // Les constantes nationales restent disponibles : un calcul partiel est possible.
    expect(r.constantes).not.toBeNull();
  });

  it("millésime national absent → constantes null + warning bloquant", () => {
    const r = assembleFiscalite({ year: 2099, isIdf: false, national: null, departementalRatePct: 1.5, communale: COMM });
    expect(r.constantes).toBeNull();
    expect(r.valeur_forfaitaire_m2).toBeNull();
    expect(r.completeness.national).toBe(false);
    expect(r.warnings.some((w) => w.includes("2099"))).toBe(true);
  });

  it("taux départemental absent → null + warning, reste exploitable", () => {
    const r = assembleFiscalite({ year: 2026, isIdf: false, national: NAT2026, departementalRatePct: null, communale: COMM });
    expect(r.taux_departemental_pct).toBeNull();
    expect(r.completeness.departementale).toBe(false);
    expect(r.warnings.some((w) => w.toLowerCase().includes("départementale"))).toBe(true);
  });
});
