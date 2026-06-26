import { describe, it, expect } from "vitest";

// Régression : un courrier (document) envoyé en signature à un signataire désigné
// n'apparaissait NULLE PART dans son espace « Signatures ». La cause : aucun
// endpoint ne listait les courriers à signer, et l'écran « Signatures en attente »
// n'interrogeait que /decisions/pending (projets d'arrêtés). Le destinataire ne
// voyait donc jamais le document à signer.
//
// On expose désormais GET /mairie/courriers/pending-signature, filtré exactement
// comme /decisions/pending : statut « a_signer » ET signataire = utilisateur
// courant. Ce test verrouille ce prédicat de visibilité (même esprit que
// decisions.signGuard.test.ts), sans dépendre de la base.

// Réplique exacte du filtre appliqué par la route. À garder synchronisé.
const PENDING_STATUS = "a_signer";
const isPendingFor = (courrier: { signature_status: string; signataire_user_id: string | null }, userId: string) =>
  courrier.signature_status === PENDING_STATUS && courrier.signataire_user_id === userId;

// Tous les statuts possibles d'un courrier (cf. colonne `signature_status` dans
// packages/db/src/schema/dossierCourriers.ts).
const ALL_SIGNATURE_STATUSES = ["non_requise", "a_signer", "signee"] as const;

const ME = "user-me";
const OTHER = "user-other";

describe("Visibilité des courriers à signer (GET /mairie/courriers/pending-signature)", () => {
  it("rend visible un courrier a_signer assigné à l'utilisateur courant", () => {
    expect(isPendingFor({ signature_status: "a_signer", signataire_user_id: ME }, ME)).toBe(true);
  });

  it("masque un courrier assigné à un autre signataire", () => {
    expect(isPendingFor({ signature_status: "a_signer", signataire_user_id: OTHER }, ME)).toBe(false);
  });

  it("masque un courrier déjà signé ou sans circuit de signature", () => {
    expect(isPendingFor({ signature_status: "signee", signataire_user_id: ME }, ME)).toBe(false);
    expect(isPendingFor({ signature_status: "non_requise", signataire_user_id: ME }, ME)).toBe(false);
  });

  it("masque un courrier a_signer sans signataire désigné", () => {
    expect(isPendingFor({ signature_status: "a_signer", signataire_user_id: null }, ME)).toBe(false);
  });

  it("n'expose qu'un seul statut comme « en attente » parmi tous les statuts", () => {
    const pending = ALL_SIGNATURE_STATUSES.filter(s => isPendingFor({ signature_status: s, signataire_user_id: ME }, ME));
    expect(pending).toEqual(["a_signer"]);
  });
});
