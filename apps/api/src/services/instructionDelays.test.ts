import { describe, it, expect } from "vitest";
import {
  computeInstructionDelay,
  computeDelaiMois,
  applyMonthsToDate,
  type DeadlineMetadata,
  type DeadlineServitude,
} from "./instructionDelays.js";

// Cœur juridique de l'instruction (Code de l'urbanisme R.423-23 et suivants).
// Ces tests verrouillent : les délais de droit commun par type, la détection
// "maison individuelle", la NON-accumulation des extensions patrimoine, la
// priorité de l'évaluation environnementale, et l'arithmétique de fin de mois.

describe("computeInstructionDelay — délai de droit commun par type", () => {
  it("PC hors maison individuelle = 3 mois (R.423-23 3°)", () => {
    const r = computeInstructionDelay("permis_de_construire", null, null);
    expect(r.total_mois).toBe(3);
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0]).toMatchObject({ mois: 3, article: "R.423-23 3°" });
    expect(r.breakdown[0]!.label).toContain("hors maison individuelle");
  });

  it("PC = 2 mois quand le projet est une maison individuelle (R.423-23 2°)", () => {
    const r = computeInstructionDelay("permis_de_construire", { natures: ["maison_neuve"] }, null);
    expect(r.total_mois).toBe(2);
    expect(r.breakdown[0]).toMatchObject({ mois: 2, article: "R.423-23 2°" });
  });

  it("PC reste 3 mois si l'opération inclut une division de terrain (pas une MI)", () => {
    const r = computeInstructionDelay("permis_de_construire", { natures: ["maison_neuve", "division_terrain"] }, null);
    expect(r.total_mois).toBe(3);
  });

  it("permis_de_construire_mi = 2 mois", () => {
    expect(computeInstructionDelay("permis_de_construire_mi", null, null).total_mois).toBe(2);
  });

  it("déclaration préalable = 1 mois (R.423-23 1°)", () => {
    const r = computeInstructionDelay("declaration_prealable", null, null);
    expect(r.total_mois).toBe(1);
    expect(r.breakdown[0]!.article).toBe("R.423-23 1°");
  });

  it("permis d'aménager / lotir = 3 mois ; permis de démolir = 2 mois", () => {
    expect(computeInstructionDelay("permis_amenager", null, null).total_mois).toBe(3);
    expect(computeInstructionDelay("permis_lotir", null, null).total_mois).toBe(3);
    expect(computeInstructionDelay("permis_demolir", null, null).total_mois).toBe(2);
  });

  it("CU : informatif (a) = 1 mois, opérationnel (b) = 2 mois", () => {
    expect(computeInstructionDelay("certificat_urbanisme_a", null, null).total_mois).toBe(1);
    expect(computeInstructionDelay("certificat_urbanisme_b", null, null).total_mois).toBe(2);
  });

  it("CU legacy : suit metadata.certificatType (a → 1, sinon 2)", () => {
    expect(computeInstructionDelay("certificat_urbanisme", { certificatType: "a" }, null).total_mois).toBe(1);
    expect(computeInstructionDelay("certificat_urbanisme", null, null).total_mois).toBe(2);
  });

  it("type inconnu → repli à 2 mois", () => {
    expect(computeInstructionDelay("type_bidon", null, null).total_mois).toBe(2);
  });
});

describe("computeInstructionDelay — extensions patrimoine (R.423-24)", () => {
  it("périmètre ABF (AC1) ajoute +1 mois", () => {
    const r = computeInstructionDelay("permis_de_construire", null, [{ categorie: "AC1" }]);
    expect(r.total_mois).toBe(4);
    expect(r.breakdown).toHaveLength(2);
    expect(r.breakdown[1]!.label).toContain("ABF");
  });

  it("ne compte qu'UNE extension patrimoine même si plusieurs SUP cumulées (AC1 + AC4)", () => {
    const r = computeInstructionDelay("permis_de_construire", null, [{ categorie: "AC1" }, { categorie: "AC4" }]);
    expect(r.total_mois).toBe(4); // 3 + 1, pas 3 + 2
    const patrimoine = r.breakdown.filter((b) => /ABF|patrimonial|classé|Réserve/.test(b.label));
    expect(patrimoine).toHaveLength(1);
  });

  it("AC1 + AC2 → une seule ligne (ABF prioritaire, cf. commentaire de code)", () => {
    const r = computeInstructionDelay("permis_de_construire", null, [{ categorie: "AC2" }, { categorie: "AC1" }]);
    expect(r.total_mois).toBe(4);
    expect(r.breakdown[1]!.label).toContain("ABF");
  });

  it("SPR seul (AC4), site classé seul (AC2), réserve seule (AC3) = +1 mois chacun", () => {
    expect(computeInstructionDelay("declaration_prealable", null, [{ categorie: "AC4" }]).total_mois).toBe(2);
    expect(computeInstructionDelay("declaration_prealable", null, [{ categorie: "AC2" }]).total_mois).toBe(2);
    expect(computeInstructionDelay("declaration_prealable", null, [{ categorie: "AC3" }]).total_mois).toBe(2);
  });

  it("matching de catégorie insensible à la casse / préfixe", () => {
    expect(computeInstructionDelay("declaration_prealable", null, [{ categorie: "ac1" }]).total_mois).toBe(2);
    expect(computeInstructionDelay("declaration_prealable", null, [{ categorie: "AC1-quelquechose" }]).total_mois).toBe(2);
  });
});

describe("computeInstructionDelay — autres extensions (R.423-25 / 26 / 28)", () => {
  it("évaluation environnementale : soumise = +6, cas par cas = +1, soumise prime", () => {
    expect(computeInstructionDelay("permis_de_construire", { evaluationEnvironnementaleSoumise: true }, null).total_mois).toBe(9);
    expect(computeInstructionDelay("permis_de_construire", { evaluationEnvironnementaleCasParCas: true }, null).total_mois).toBe(4);
    // Les deux drapeaux posés : seul +6 doit s'appliquer (pas +7).
    const both: DeadlineMetadata = { evaluationEnvironnementaleSoumise: true, evaluationEnvironnementaleCasParCas: true };
    expect(computeInstructionDelay("permis_de_construire", both, null).total_mois).toBe(9);
  });

  it.each([
    ["consultationCDPENAF", 2],
    ["derogationPLU", 2],
    ["unesco", 2],
    ["defrichementRequis", 1],
    ["estERP", 1],
    ["derogationAccessibilite", 1],
    ["natura2000", 1],
    ["secteurSauvegarde", 1],
  ] as const)("drapeau %s ajoute +%i mois au délai de base", (flag, plus) => {
    const r = computeInstructionDelay("permis_de_construire", { [flag]: true } as DeadlineMetadata, null);
    expect(r.total_mois).toBe(3 + plus);
    expect(r.breakdown).toHaveLength(2);
  });
});

describe("computeInstructionDelay — invariants & API legacy", () => {
  it("cumule les extensions et garde le détail tracé (base + ABF + éval env.)", () => {
    const meta: DeadlineMetadata = { natures: ["maison_neuve"], evaluationEnvironnementaleSoumise: true };
    const r = computeInstructionDelay("permis_de_construire", meta, [{ categorie: "AC1" }]);
    expect(r.total_mois).toBe(2 + 1 + 6); // PC MI + ABF + éval env. soumise
    expect(r.breakdown).toHaveLength(3);
  });

  it("total_mois = somme des lignes du breakdown ; chaque ligne cite un article", () => {
    const meta: DeadlineMetadata = { consultationCDPENAF: true, defrichementRequis: true, unesco: true };
    const r = computeInstructionDelay("permis_amenager", meta, [{ categorie: "AC1" }]);
    const sum = r.breakdown.reduce((s, b) => s + b.mois, 0);
    expect(r.total_mois).toBe(sum);
    expect(r.breakdown.every((b) => b.article.length > 0)).toBe(true);
  });

  it("computeDelaiMois (API historique) = total_mois", () => {
    const meta: DeadlineMetadata = { derogationPLU: true };
    const sup: DeadlineServitude[] = [{ categorie: "AC1" }];
    expect(computeDelaiMois("permis_de_construire", meta, sup)).toBe(
      computeInstructionDelay("permis_de_construire", meta, sup).total_mois,
    );
  });
});

describe("applyMonthsToDate — mois calendaires & fins de mois", () => {
  const ymd = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate()];

  it("ajout simple sans débordement (15 jan + 3 mois = 15 avr)", () => {
    expect(ymd(applyMonthsToDate(new Date(2024, 0, 15), 3))).toEqual([2024, 3, 15]);
  });

  it("31 jan + 1 mois → 28 fév (année non bissextile)", () => {
    expect(ymd(applyMonthsToDate(new Date(2023, 0, 31), 1))).toEqual([2023, 1, 28]);
  });

  it("31 jan + 1 mois → 29 fév (année bissextile)", () => {
    expect(ymd(applyMonthsToDate(new Date(2024, 0, 31), 1))).toEqual([2024, 1, 29]);
  });

  it("31 mars + 1 mois → 30 avr (avril n'a que 30 jours)", () => {
    expect(ymd(applyMonthsToDate(new Date(2024, 2, 31), 1))).toEqual([2024, 3, 30]);
  });

  it("passe l'année (30 nov + 3 mois → 28 fév suivant)", () => {
    expect(ymd(applyMonthsToDate(new Date(2024, 10, 30), 3))).toEqual([2025, 1, 28]);
  });

  it("ne mute pas la date d'entrée", () => {
    const start = new Date(2024, 0, 31);
    applyMonthsToDate(start, 5);
    expect(ymd(start)).toEqual([2024, 0, 31]);
  });
});
