import { describe, it, expect } from "vitest";
import { buildPiecesContext, getPiecesForType } from "./piecesRequises.js";

// Helper : codes des pièces REQUISES pour un PC.
function requiredPcCodes(args: {
  natures: string[];
  surface?: number;
  servitudes?: Array<{ categorie?: string; libelle?: string }>;
  situational?: { isERP?: boolean };
  risks?: { seismic_zone?: string; clay_risk?: string };
}): string[] {
  const ctx = buildPiecesContext(
    args.natures,
    args.surface ?? 100,
    args.servitudes,
    undefined,
    args.situational,
    args.risks,
  );
  return getPiecesForType("permis_de_construire", ctx)
    .filter((p) => p.requis)
    .map((p) => p.code);
}

describe("piecesRequises — attestation parasismique (R.431-16 g, décret 2023-1173)", () => {
  it("est exigée pour une maison neuve en zone de sismicité 3, 4 ou 5", () => {
    for (const z of ["3", "4", "5"]) {
      expect(requiredPcCodes({ natures: ["maison_neuve"], risks: { seismic_zone: z } })).toContain("PC-PARASISMIQUE");
    }
  });

  it("n'est PAS exigée pour une maison individuelle (cat. II) en zone 2", () => {
    expect(requiredPcCodes({ natures: ["maison_neuve"], risks: { seismic_zone: "2" } })).not.toContain("PC-PARASISMIQUE");
  });

  it("est exigée en zone 2 pour un ERP (catégorie III/IV)", () => {
    expect(
      requiredPcCodes({ natures: ["maison_neuve"], situational: { isERP: true }, risks: { seismic_zone: "2" } }),
    ).toContain("PC-PARASISMIQUE");
  });

  it("n'est PAS exigée en zone 1, ni sans construction neuve", () => {
    expect(requiredPcCodes({ natures: ["maison_neuve"], risks: { seismic_zone: "1" } })).not.toContain("PC-PARASISMIQUE");
    expect(requiredPcCodes({ natures: ["modification_aspect"], risks: { seismic_zone: "5" } })).not.toContain("PC-PARASISMIQUE");
  });
});

describe("piecesRequises — attestation argiles (décret 2023-1173, loi ELAN)", () => {
  it("est exigée pour une construction neuve en aléa argiles moyen ou fort", () => {
    for (const a of ["moyen", "fort"]) {
      expect(requiredPcCodes({ natures: ["maison_neuve"], risks: { clay_risk: a } })).toContain("PC-RGA");
    }
  });

  it("n'est PAS exigée en aléa faible/nul ni hors construction neuve", () => {
    expect(requiredPcCodes({ natures: ["maison_neuve"], risks: { clay_risk: "faible" } })).not.toContain("PC-RGA");
    expect(requiredPcCodes({ natures: ["modification_aspect"], risks: { clay_risk: "fort" } })).not.toContain("PC-RGA");
  });
});

describe("piecesRequises — rétro-compatibilité", () => {
  it("sans contexte risque, aucune attestation risque n'est ajoutée", () => {
    const codes = requiredPcCodes({ natures: ["maison_neuve"] });
    expect(codes).not.toContain("PC-PARASISMIQUE");
    expect(codes).not.toContain("PC-RGA");
    // …mais les pièces de base restent présentes.
    expect(codes).toContain("PC1");
  });
});
