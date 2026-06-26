import { describe, expect, it } from "vitest";
import { pickProfileFields, isProfileField } from "./cerfaProfile.js";

describe("pickProfileFields (minimisation RGPD)", () => {
  it("ne garde que l'état civil réutilisable, jamais les champs projet", () => {
    const fullCerfaData = {
      // État civil — DOIT être mémorisé
      civilite: "madame",
      qualiteDemandeur: "particulier",
      dateNaissance: "26/06/1990",
      communeNaissance: "Tours",
      deptNaissance: "37",
      paysNaissance: "France",
      adresseDemandeurVoie: "rue des Lilas",
      adresseDemandeurCodePostal: "37000",
      // Champs propres au PROJET — ne DOIVENT jamais être mémorisés
      empriseSol: "120",
      hauteurProjet: "6",
      surfaceCreee: "45",
      destinationFuture: "habitation",
      architecteNom: "Durand",
      comportePiscine: true,
      accepteEmail: true,
    };
    const profile = pickProfileFields(fullCerfaData);
    expect(profile.civilite).toBe("madame");
    expect(profile.dateNaissance).toBe("26/06/1990");
    expect(profile.adresseDemandeurVoie).toBe("rue des Lilas");
    // Aucune donnée projet ne fuit dans le profil mémorisé.
    expect(profile).not.toHaveProperty("empriseSol");
    expect(profile).not.toHaveProperty("hauteurProjet");
    expect(profile).not.toHaveProperty("surfaceCreee");
    expect(profile).not.toHaveProperty("destinationFuture");
    expect(profile).not.toHaveProperty("architecteNom");
    expect(profile).not.toHaveProperty("comportePiscine");
    expect(profile).not.toHaveProperty("accepteEmail");
  });

  it("ignore les chaînes vides, les non-chaînes et trimme", () => {
    const profile = pickProfileFields({
      civilite: "  monsieur  ",
      dateNaissance: "",
      qualiteDemandeur: 42 as unknown as string,
      paysNaissance: "   ",
    });
    expect(profile.civilite).toBe("monsieur");
    expect(profile).not.toHaveProperty("dateNaissance");
    expect(profile).not.toHaveProperty("qualiteDemandeur");
    expect(profile).not.toHaveProperty("paysNaissance");
  });

  it("renvoie un objet vide pour une source absente ou non-objet", () => {
    expect(pickProfileFields(null)).toEqual({});
    expect(pickProfileFields(undefined)).toEqual({});
  });

  it("isProfileField distingue le périmètre mémorisable des champs projet", () => {
    expect(isProfileField("dateNaissance")).toBe(true);
    expect(isProfileField("adresseDemandeurCodePostal")).toBe(true);
    expect(isProfileField("empriseSol")).toBe(false);
    expect(isProfileField("parcelle")).toBe(false);
  });
});
