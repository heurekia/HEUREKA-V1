import { describe, it, expect } from "vitest";
import { classifyPermit } from "./classificationEngine.js";

describe("classifyPermit", () => {
  describe("certificat d'urbanisme", () => {
    it("CUb par défaut quand le type n'est pas précisé", () => {
      const r = classifyPermit({ natures: ["certificat"] });
      expect(r.type).toBe("certificat_urbanisme");
      expect(r.subtype).toBe("cu_b");
      expect(r.delai_moyen).toBe("2 mois");
    });

    it("CUa quand certificatType = a", () => {
      const r = classifyPermit({ natures: ["certificat"], certificatType: "a" });
      expect(r.subtype).toBe("cu_a");
      expect(r.delai_moyen).toBe("1 mois");
    });

    it("ne s'applique pas si combiné à une autre nature", () => {
      const r = classifyPermit({ natures: ["certificat", "maison_neuve"] });
      expect(r.type).not.toBe("certificat_urbanisme");
    });
  });

  describe("démolition", () => {
    it("démolition seule → permis de démolir", () => {
      const r = classifyPermit({ natures: ["demolition"] });
      expect(r.type).toBe("permis_demolir");
      expect(r.subtype).toBe("pd");
    });

    it("ajoute R421-27 en zone ABF", () => {
      const r = classifyPermit({ natures: ["demolition"], hasABF: true });
      expect(r.articles).toContain("R421-27 CU");
      expect(r.articles).toContain("R421-28 CU");
    });

    it("démolition + construction → ne reste pas un simple PD", () => {
      const r = classifyPermit({ natures: ["demolition", "maison_neuve"], surface: 120 });
      expect(r.type).toBe("permis_de_construire");
      expect(r.articles).toContain("R421-28 CU"); // PC vaut démolition
    });
  });

  describe("division foncière", () => {
    it("avec voirie commune → permis d'aménager", () => {
      const r = classifyPermit({ natures: ["division_terrain"], hasVoirieCommune: true });
      expect(r.type).toBe("permis_amenager");
      expect(r.subtype).toBe("pa_lotissement");
    });

    it("sans voirie commune → déclaration préalable", () => {
      const r = classifyPermit({ natures: ["division_terrain"], hasVoirieCommune: false });
      expect(r.type).toBe("declaration_prealable");
      expect(r.subtype).toBe("division");
    });
  });

  describe("maison neuve", () => {
    it("≤ 150 m² → PCMI sans architecte", () => {
      const r = classifyPermit({ natures: ["maison_neuve"], surface: 120 });
      expect(r.type).toBe("permis_de_construire");
      expect(r.subtype).toBe("pcmi");
      expect(r.architecte_requis).toBe(false);
    });

    it("> 150 m² → architecte obligatoire (R431-2)", () => {
      const r = classifyPermit({ natures: ["maison_neuve"], surface: 180 });
      expect(r.architecte_requis).toBe(true);
      expect(r.articles).toContain("R431-2 CU");
    });

    it("seuil architecte sur surface totale (créée + existante)", () => {
      const r = classifyPermit({ natures: ["maison_neuve"], surface: 100, empriseExistante: 60 });
      expect(r.architecte_requis).toBe(true);
    });
  });

  describe("agrandissement / petite construction", () => {
    it("≤ 5 m² hors ABF → aucune autorisation", () => {
      const r = classifyPermit({ natures: ["petite_construction"], surface: 4 });
      expect(r.type).toBe("aucune_autorisation");
    });

    it("≤ 5 m² mais en zone ABF → autorisation requise", () => {
      const r = classifyPermit({ natures: ["petite_construction"], surface: 4, hasABF: true });
      expect(r.type).not.toBe("aucune_autorisation");
    });

    it("zone U : DP jusqu'à 40 m²", () => {
      const r = classifyPermit({ natures: ["agrandissement"], surface: 35, zone: "UB" });
      expect(r.type).toBe("declaration_prealable");
      expect(r.articles).toContain("R421-13 al.2 CU");
    });

    it("zone U : > 40 m² → PC", () => {
      const r = classifyPermit({ natures: ["agrandissement"], surface: 50, zone: "UB" });
      expect(r.type).toBe("permis_de_construire");
    });

    it("hors zone U : seuil DP abaissé à 20 m²", () => {
      const dp = classifyPermit({ natures: ["agrandissement"], surface: 18, zone: "A" });
      expect(dp.type).toBe("declaration_prealable");
      const pc = classifyPermit({ natures: ["agrandissement"], surface: 30, zone: "A" });
      expect(pc.type).toBe("permis_de_construire");
    });
  });

  describe("aménagement de terrain", () => {
    it("piscine ≤ 10 m² → aucune autorisation", () => {
      const r = classifyPermit({ natures: ["amenagement"], amenagementType: "piscine", surface: 8 });
      expect(r.type).toBe("aucune_autorisation");
    });

    it("piscine entre 10 et 100 m² → DP", () => {
      const r = classifyPermit({ natures: ["amenagement"], amenagementType: "piscine", surface: 50 });
      expect(r.type).toBe("declaration_prealable");
    });

    it("piscine > 100 m² → PC", () => {
      const r = classifyPermit({ natures: ["amenagement"], amenagementType: "piscine", surface: 120 });
      expect(r.type).toBe("permis_de_construire");
    });

    it("clôture → DP", () => {
      const r = classifyPermit({ natures: ["amenagement"], amenagementType: "cloture" });
      expect(r.type).toBe("declaration_prealable");
      expect(r.articles).toContain("R421-17 c) CU");
    });
  });

  describe("modification d'aspect / changement de destination", () => {
    it("modification d'aspect seule → DP", () => {
      const r = classifyPermit({ natures: ["modification_aspect"] });
      expect(r.type).toBe("declaration_prealable");
      expect(r.articles).toContain("R421-17 a) CU");
    });

    it("changement de destination seul → DP", () => {
      const r = classifyPermit({ natures: ["changement_destination"] });
      expect(r.type).toBe("declaration_prealable");
      expect(r.articles).toContain("R421-17 b) CU");
    });
  });

  describe("délais ABF", () => {
    it("majore le délai en périmètre ABF", () => {
      const sansAbf = classifyPermit({ natures: ["modification_aspect"] });
      const avecAbf = classifyPermit({ natures: ["modification_aspect"], hasABF: true });
      expect(sansAbf.delai_moyen).toBe("1 à 2 mois");
      expect(avecAbf.delai_moyen).toBe("2 à 3 mois");
    });
  });

  describe("classification déterministe", () => {
    it("toutes les branches connues renvoient une confiance déterministe", () => {
      const cases = [
        classifyPermit({ natures: ["certificat"] }),
        classifyPermit({ natures: ["demolition"] }),
        classifyPermit({ natures: ["maison_neuve"], surface: 100 }),
        classifyPermit({ natures: ["modification_aspect"] }),
      ];
      for (const c of cases) expect(c.confidence).toBe("deterministic");
    });

    it("entrée vide → fallback DP de confiance faible", () => {
      const r = classifyPermit({ natures: [] });
      expect(r.type).toBe("declaration_prealable");
      expect(r.confidence).toBe("faible");
    });
  });
});
