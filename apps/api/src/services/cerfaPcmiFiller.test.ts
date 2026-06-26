import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  buildPcmiFieldValues,
  fillPcmiCerfa,
  _internals,
  type CerfaPcmiInput,
} from "./cerfaPcmiFiller.js";

const { splitAdresse, parseParcelle, pcmiFieldMap, pcmiCheckboxMap } = _internals;

const baseInput: CerfaPcmiInput = {
  user: {
    nom: "Dupont",
    prenom: "Marie",
    email: "marie.dupont@example.com",
    telephone: "0612345678",
  },
  dossier: {
    adresse: "12 rue de la Paix",
    commune: "Ballan-Miré",
    code_postal: "37510",
    parcelle: "000 AB 0123",
    description: "Construction d'une maison individuelle de plain-pied",
    surface_plancher: "120",
  },
  cerfa: {
    dateNaissance: "15/06/1985",
    communeNaissance: "Tours",
    paysNaissance: "France",
    accepteEmail: true,
    nbLogements: "1",
    destinationFuture: "habitation",
    raccordementReseaux: true,
    proximiteABF: false,
  },
};

describe("splitAdresse", () => {
  it("sépare numéro et voie", () => {
    expect(splitAdresse("12 rue de la Paix")).toEqual({ numero: "12", voie: "rue de la Paix" });
  });
  it("gère un bis/ter accolé", () => {
    expect(splitAdresse("12bis avenue des Tilleuls")).toEqual({ numero: "12bis", voie: "avenue des Tilleuls" });
  });
  it("retombe sur la voie seule si pas de numéro", () => {
    expect(splitAdresse("lieu-dit Les Pommiers")).toEqual({ numero: "", voie: "lieu-dit Les Pommiers" });
  });
  it("retourne vides sur null", () => {
    expect(splitAdresse(null)).toEqual({ numero: "", voie: "" });
  });
});

describe("parseParcelle", () => {
  it("parse format complet 000 AB 0123", () => {
    expect(parseParcelle("000 AB 0123")).toEqual({ prefixe: "000", section: "AB", numero: "0123" });
  });
  it("parse format avec tirets", () => {
    expect(parseParcelle("000-AB-0123")).toEqual({ prefixe: "000", section: "AB", numero: "0123" });
  });
  it("parse format réduit AB 123", () => {
    expect(parseParcelle("AB 123")).toEqual({ prefixe: "", section: "AB", numero: "123" });
  });
  it("parse la référence cadastrale compacte sur 14 caractères", () => {
    expect(parseParcelle("37018000AB0123")).toEqual({ prefixe: "000", section: "AB", numero: "0123" });
  });
  it("retourne vides sur null", () => {
    expect(parseParcelle(null)).toEqual({ prefixe: "", section: "", numero: "" });
  });
});

describe("buildPcmiFieldValues", () => {
  it("remplit identité demandeur", () => {
    const v = buildPcmiFieldValues(baseInput);
    expect(v.text.demandeur_nom).toBe("Dupont");
    expect(v.text.demandeur_prenom).toBe("Marie");
    expect(v.text.demandeur_email).toBe("marie.dupont@example.com");
    expect(v.text.demandeur_telephone).toBe("0612345678");
    expect(v.text.demandeur_dateNaissance).toBe("15/06/1985");
    expect(v.text.demandeur_paysNaissance).toBe("France");
  });

  it("éclate l'adresse du dossier en numéro + voie", () => {
    const v = buildPcmiFieldValues(baseInput);
    expect(v.text.terrain_voieNumero).toBe("12");
    expect(v.text.terrain_voieNom).toBe("rue de la Paix");
    expect(v.text.terrain_localite).toBe("Ballan-Miré");
    expect(v.text.terrain_codePostal).toBe("37510");
  });

  it("éclate la référence cadastrale", () => {
    const v = buildPcmiFieldValues(baseInput);
    expect(v.text.terrain_prefixe).toBe("000");
    expect(v.text.terrain_section).toBe("AB");
    expect(v.text.terrain_numero).toBe("0123");
  });

  it("laisse les triplets cadastraux additionnels vides sans groupement foncier", () => {
    const v = buildPcmiFieldValues(baseInput);
    expect(v.text.terrain_prefixe2).toBe("");
    expect(v.text.terrain_section2).toBe("");
    expect(v.text.terrain_numero2).toBe("");
    expect(v.text.terrain_prefixe3).toBe("");
  });

  it("remplit les parcelles additionnelles d'un groupement foncier (triplets 2 & 3)", () => {
    const v = buildPcmiFieldValues({
      ...baseInput,
      dossier: {
        ...baseInput.dossier,
        parcelle: "37018000AB0123",
        parcelles: [
          { parcelle_id: "37018000AB0123", surface_m2: 500 }, // principale → triplet 1
          { parcelle_id: "37018000AB0124", surface_m2: 320 }, // → triplet 2
          { parcelle_id: "37018000AB0125", surface_m2: 180 }, // → triplet 3
        ],
      },
    });
    // Principale = 1er triplet (préfixe/section/numéro tels que parsés).
    expect(v.text.terrain_section).toBe("AB");
    expect(v.text.terrain_numero).toBe("0123");
    // 2e parcelle.
    expect(v.text.terrain_section2).toBe("AB");
    expect(v.text.terrain_numero2).toBe("0124");
    expect(v.text.terrain_superficie2).toBe("320");
    // 3e parcelle.
    expect(v.text.terrain_section3).toBe("AB");
    expect(v.text.terrain_numero3).toBe("0125");
    expect(v.text.terrain_superficie3).toBe("180");
  });

  it("au-delà de 3 parcelles, ne remplit que les 2 additionnelles disponibles", () => {
    const v = buildPcmiFieldValues({
      ...baseInput,
      dossier: {
        ...baseInput.dossier,
        parcelle: "37018000AB0123",
        parcelles: [
          { parcelle_id: "37018000AB0123" },
          { parcelle_id: "37018000AB0124" },
          { parcelle_id: "37018000AB0125" },
          { parcelle_id: "37018000AB0126" }, // ignorée (le CERFA n'a que 3 lignes)
        ],
      },
    });
    expect(v.text.terrain_numero2).toBe("0124");
    expect(v.text.terrain_numero3).toBe("0125");
    // La 4e n'apparaît dans aucun triplet.
    expect(Object.values(v.text)).not.toContain("0126");
  });

  it("construction neuve par défaut (pas de surface existante)", () => {
    const v = buildPcmiFieldValues(baseInput);
    expect(v.checkboxes.construction_nouvelle).toBe(true);
    expect(v.checkboxes.construction_existante).toBe(false);
  });

  it("destination principale cochée par défaut", () => {
    const v = buildPcmiFieldValues(baseInput);
    expect(v.checkboxes.destination_principale).toBe(true);
    expect(v.checkboxes.destination_secondaire).toBe(false);
  });

  it("ABF coché uniquement si proximité explicite", () => {
    expect(buildPcmiFieldValues(baseInput).checkboxes.abf).toBe(false);
    expect(buildPcmiFieldValues({
      ...baseInput,
      cerfa: { ...baseInput.cerfa, proximiteABF: true },
    }).checkboxes.abf).toBe(true);
  });

  it("SCI : remplit dénomination + représentant, laisse PP vides", () => {
    const v = buildPcmiFieldValues({
      ...baseInput,
      cerfa: {
        ...baseInput.cerfa,
        qualiteDemandeur: "sci",
        societeDenomination: "SCI Les Vergers",
        societeSiret: "12345678900012",
        societeTypeJuridique: "SCI",
      },
    });
    expect(v.text.societe_denomination).toBe("SCI Les Vergers");
    expect(v.text.societe_siret).toBe("12345678900012");
    expect(v.text.societe_typeJuridique).toBe("SCI");
    // Le représentant est par défaut le user authentifié.
    expect(v.text.societe_representantNom).toBe("Dupont");
    expect(v.text.societe_representantPrenom).toBe("Marie");
  });

  it("particulier : ne remplit aucun champ SCI", () => {
    const v = buildPcmiFieldValues({
      ...baseInput,
      cerfa: { ...baseInput.cerfa, qualiteDemandeur: "particulier" },
    });
    expect(v.text.societe_denomination).toBe("");
    expect(v.text.societe_siret).toBe("");
  });

  it("extension : coche construction existante et remplit surface avant", () => {
    const v = buildPcmiFieldValues({
      ...baseInput,
      cerfa: {
        ...baseInput.cerfa,
        surfaceExistanteAvant: "85",
        surfaceCreee: "35",
      },
    });
    expect(v.checkboxes.construction_nouvelle).toBe(false);
    expect(v.checkboxes.construction_existante).toBe(true);
    expect(v.checkboxes.extension).toBe(true);
    expect(v.text.surface_avantTravaux).toBe("85");
    expect(v.text.surface_creee).toBe("35");
  });

  it("surélévation prime sur extension simple", () => {
    const v = buildPcmiFieldValues({
      ...baseInput,
      cerfa: {
        ...baseInput.cerfa,
        surfaceExistanteAvant: "85",
        surfaceCreee: "30",
        surelevation: true,
      },
    });
    expect(v.checkboxes.surelevation).toBe(true);
    expect(v.checkboxes.extension).toBe(false);
  });

  it("architecte : remplit nom + ordre + email, coche honneur si dispense", () => {
    const v = buildPcmiFieldValues({
      ...baseInput,
      cerfa: {
        ...baseInput.cerfa,
        architecteRequis: true,
        architecteNom: "Martin",
        architectePrenom: "Paul",
        architecteOrdre: "12345",
        architecteEmail: "paul.martin@archi.fr",
      },
    });
    expect(v.text.architecte_nom).toBe("Martin");
    expect(v.text.architecte_ordre).toBe("12345");
    expect(v.text.architecte_email).toBe("paul.martin@archi.fr");
    expect(v.checkboxes.architecte_honneur).toBe(false);

    const dispense = buildPcmiFieldValues({
      ...baseInput,
      cerfa: { ...baseInput.cerfa, architecteRequis: false },
    });
    expect(dispense.checkboxes.architecte_honneur).toBe(true);
  });

  it("annexes : cases cochées séparément", () => {
    const v = buildPcmiFieldValues({
      ...baseInput,
      cerfa: { ...baseInput.cerfa, comporteGarage: true, comportePiscine: true, comporteVeranda: false },
    });
    expect(v.checkboxes.annexe_garage).toBe(true);
    expect(v.checkboxes.annexe_piscine).toBe(true);
    expect(v.checkboxes.annexe_veranda).toBe(false);
  });

  it("adresse demandeur distincte si fournie au step 5", () => {
    const v = buildPcmiFieldValues({
      ...baseInput,
      cerfa: {
        ...baseInput.cerfa,
        adresseDemandeurNumero: "3",
        adresseDemandeurVoie: "boulevard Voltaire",
        adresseDemandeurLocalite: "Paris",
        adresseDemandeurCodePostal: "75011",
      },
    });
    expect(v.text.demandeur_voieNumero).toBe("3");
    expect(v.text.demandeur_voieNom).toBe("boulevard Voltaire");
    expect(v.text.demandeur_localite).toBe("Paris");
    expect(v.text.demandeur_codePostal).toBe("75011");
    // Le terrain reste celui du dossier.
    expect(v.text.terrain_localite).toBe("Ballan-Miré");
  });

  it("usage : par défaut principale, secondaire si déclaré", () => {
    expect(buildPcmiFieldValues(baseInput).checkboxes.destination_principale).toBe(true);
    const v = buildPcmiFieldValues({
      ...baseInput,
      cerfa: { ...baseInput.cerfa, destinationUsage: "secondaire" },
    });
    expect(v.checkboxes.destination_principale).toBe(false);
    expect(v.checkboxes.destination_secondaire).toBe(true);
  });

  it("pré-remplit lieu+date d'engagement", () => {
    const v = buildPcmiFieldValues(baseInput);
    expect(v.text.engagement_lieu).toBe("Ballan-Miré");
    expect(v.text.engagement_date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(v.text.engagement_signature).toBeUndefined();
  });
});

describe("registry consistency", () => {
  it("toutes les clés du mapping pointent vers des noms PDF distincts", () => {
    const names = [...Object.values(pcmiFieldMap), ...Object.values(pcmiCheckboxMap)];
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("fillPcmiCerfa", () => {
  it("produit un PDF valide rechargeable", async () => {
    const buffer = await fillPcmiCerfa(baseInput);
    expect(buffer.length).toBeGreaterThan(50_000);
    // Le PDF doit rester lisible et contenir un formulaire.
    const reloaded = await PDFDocument.load(buffer);
    const form = reloaded.getForm();
    expect(form.getFields().length).toBeGreaterThan(300);
  });

  it("écrit le nom du demandeur dans D1N_nom", async () => {
    const buffer = await fillPcmiCerfa(baseInput);
    const reloaded = await PDFDocument.load(buffer);
    const form = reloaded.getForm();
    expect(form.getTextField("D1N_nom").getText()).toBe("Dupont");
    expect(form.getTextField("D1P_prenom").getText()).toBe("Marie");
  });

  it("coche les bonnes cases (D5A consentement, X1U raccordement)", async () => {
    const buffer = await fillPcmiCerfa(baseInput);
    const reloaded = await PDFDocument.load(buffer);
    const form = reloaded.getForm();
    expect(form.getCheckBox("D5A_acceptation").isChecked()).toBe(true);
    expect(form.getCheckBox("X1U_raccordement").isChecked()).toBe(true);
    expect(form.getCheckBox("X1A_ABF").isChecked()).toBe(false);
  });

  it("garde les AcroForms modifiables (citoyen peut éditer)", async () => {
    const buffer = await fillPcmiCerfa(baseInput);
    const reloaded = await PDFDocument.load(buffer);
    const form = reloaded.getForm();
    // Une signature laissée vide doit pouvoir l'être après remplissage.
    expect(form.getTextField("E1S_signature").getText() ?? "").toBe("");
  });
});
