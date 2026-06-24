import { describe, it, expect } from "vitest";
import {
  petitionnaireSideEffect,
  isPlaceholderEmail,
  namesLikelyDiffer,
  PLACEHOLDER_EMAIL_DOMAIN,
  type PetitionnaireAccountState,
} from "./petitionnaireInvite.js";

describe("namesLikelyDiffer — garde-fou avant rattachement à un compte existant", () => {
  it("ne signale pas une identité identique", () => {
    expect(namesLikelyDiffer({ prenom: "Jean", nom: "Dupont" }, { prenom: "Jean", nom: "Dupont" })).toBe(false);
  });

  it("tolère accents, casse et tirets", () => {
    expect(namesLikelyDiffer({ prenom: "Jean-Marie", nom: "DÜPONT" }, { prenom: "jean marie", nom: "dupont" })).toBe(false);
  });

  it("tolère l'inversion prénom/nom", () => {
    expect(namesLikelyDiffer({ prenom: "Jean", nom: "Dupont" }, { prenom: "Dupont", nom: "Jean" })).toBe(false);
  });

  it("tolère un nom partiel (placeholder sans prénom)", () => {
    // Côté dossier on n'a souvent que le nom de famille (prénom « — »).
    expect(namesLikelyDiffer({ prenom: "—", nom: "Dupont" }, { prenom: "Jean", nom: "Dupont" })).toBe(false);
  });

  it("signale deux identités franchement différentes", () => {
    expect(namesLikelyDiffer({ prenom: "Jean", nom: "Dupont" }, { prenom: "Marie", nom: "Martin" })).toBe(true);
  });

  it("signale un même nom mais un prénom incompatible", () => {
    expect(namesLikelyDiffer({ prenom: "Jean", nom: "Dupont" }, { prenom: "Pierre", nom: "Dupont" })).toBe(true);
  });

  it("ne compare pas si une identité est vide", () => {
    expect(namesLikelyDiffer({ prenom: "", nom: "" }, { prenom: "Jean", nom: "Dupont" })).toBe(false);
  });
});

describe("isPlaceholderEmail — détection des comptes internes non joignables", () => {
  it("reconnaît un email synthétique de placeholder", () => {
    expect(isPlaceholderEmail(`dossier-abc-123${PLACEHOLDER_EMAIL_DOMAIN}`)).toBe(true);
  });

  it("est insensible à la casse", () => {
    expect(isPlaceholderEmail(`DOSSIER-XYZ@PLACEHOLDER.HEUREKA.LOCAL`)).toBe(true);
  });

  it("rejette une vraie adresse", () => {
    expect(isPlaceholderEmail("jean.dupont@example.com")).toBe(false);
  });

  it("rejette null/undefined/chaîne vide sans lever", () => {
    expect(isPlaceholderEmail(null)).toBe(false);
    expect(isPlaceholderEmail(undefined)).toBe(false);
    expect(isPlaceholderEmail("")).toBe(false);
  });
});

// Matrice de décision pour prévenir le pétitionnaire après l'enregistrement d'un
// dossier au comptoir (saisie manuelle / import OCR).
//
// Règle métier clé : un citoyen jamais activé ne peut PAS se connecter, donc une
// notification in-app lui serait invisible — on doit (re)lui envoyer un email
// d'activation. Inversement, inutile d'emailer quelqu'un qui peut déjà se
// connecter : la notification in-app suffit. Et sans email (placeholder), aucun
// canal n'est joignable.
describe("petitionnaireSideEffect — matrice invitation/notification", () => {
  const allAccounts: PetitionnaireAccountState[] = [
    "new",
    "existing-verified",
    "existing-unverified",
    "placeholder",
  ];

  it("ne fait rien quand l'invitation n'est pas demandée, quel que soit le compte", () => {
    for (const account of allAccounts) {
      expect(petitionnaireSideEffect({ inviteRequested: false, account })).toBe("none");
    }
  });

  it("compte neuf + invitation → email d'activation", () => {
    expect(petitionnaireSideEffect({ inviteRequested: true, account: "new" })).toBe("invite");
  });

  it("compte existant jamais activé + invitation → (re)envoi de l'activation (une notif in-app serait invisible)", () => {
    expect(petitionnaireSideEffect({ inviteRequested: true, account: "existing-unverified" })).toBe("invite");
  });

  it("compte existant déjà actif + invitation → notification in-app, pas d'email", () => {
    expect(petitionnaireSideEffect({ inviteRequested: true, account: "existing-verified" })).toBe("notify");
  });

  it("placeholder (aucun email) → rien, même si l'invitation est demandée", () => {
    expect(petitionnaireSideEffect({ inviteRequested: true, account: "placeholder" })).toBe("none");
  });
});
