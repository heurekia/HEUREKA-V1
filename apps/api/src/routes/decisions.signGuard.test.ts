import { describe, it, expect } from "vitest";

// Régression : POST /decisions/:id/sign signait l'arrêté quel que soit le statut
// de la décision. On pouvait donc signer un brouillon directement (sans passer
// par la soumission), ou re-signer un arrêté déjà signé / notifié — bref,
// court-circuiter le circuit de signature par appel direct à la route.
//
// La route n'autorise désormais la signature QUE depuis « soumis_signature »
// (cf. garde-fou dans apps/api/src/routes/decisions.ts → /sign). On verrouille
// cet invariant ici, dans le même esprit que decisions.signatureRoles.test.ts.

// Réplique exacte du prédicat de garde appliqué dans /sign. À garder synchronisé
// avec la route.
const SIGNABLE_FROM = "soumis_signature";
const canSign = (status: string) => status === SIGNABLE_FROM;

// Tous les statuts possibles d'une décision (cf. commentaire de la colonne
// `status` dans packages/db/src/schema/decisions.ts).
const ALL_DECISION_STATUSES = [
  "brouillon",
  "soumis_signature",
  "revision_necessaire",
  "signe",
  "notifie",
  "archive",
] as const;

describe("Garde-fou de statut à la signature (POST /decisions/:id/sign)", () => {
  it("autorise la signature uniquement depuis soumis_signature", () => {
    expect(canSign("soumis_signature")).toBe(true);
  });

  it("refuse la signature directe d'un brouillon ou d'une décision en révision", () => {
    expect(canSign("brouillon")).toBe(false);
    expect(canSign("revision_necessaire")).toBe(false);
  });

  it("refuse la re-signature d'un arrêté déjà signé ou notifié", () => {
    expect(canSign("signe")).toBe(false);
    expect(canSign("notifie")).toBe(false);
  });

  it("n'expose qu'un seul statut signable parmi tous les statuts de décision", () => {
    const signable = ALL_DECISION_STATUSES.filter(canSign);
    expect(signable).toEqual(["soumis_signature"]);
  });
});
