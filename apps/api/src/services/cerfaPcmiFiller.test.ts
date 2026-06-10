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

  it("PCMI par définition = construction nouvelle, jamais existante", () => {
    const v = buildPcmiFieldValues(baseInput);
    expect(v.checkboxes.construction_nouvelle).toBe(true);
    expect(v.checkboxes.construction_existante).toBe(false);
  });

  it("destination principale cochée si habitation", () => {
    const v = buildPcmiFieldValues(baseInput);
    expect(v.checkboxes.destination_principale).toBe(true);
    expect(v.checkboxes.destination_secondaire).toBe(false);
  });

  it("destination secondaire si garage", () => {
    const v = buildPcmiFieldValues({
      ...baseInput,
      cerfa: { ...baseInput.cerfa, destinationFuture: "garage" },
    });
    expect(v.checkboxes.destination_principale).toBe(false);
    expect(v.checkboxes.destination_secondaire).toBe(true);
  });

  it("ABF coché uniquement si proximité explicite", () => {
    expect(buildPcmiFieldValues(baseInput).checkboxes.abf).toBe(false);
    expect(buildPcmiFieldValues({
      ...baseInput,
      cerfa: { ...baseInput.cerfa, proximiteABF: true },
    }).checkboxes.abf).toBe(true);
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
