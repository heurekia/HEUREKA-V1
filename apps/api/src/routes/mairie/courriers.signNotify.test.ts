import { describe, it, expect } from "vitest";

// Verrouille la règle métier : à la signature d'un courrier, on prévient
// l'instructeur qui a demandé la signature (signature_requested_by) — sauf
// lorsqu'il signe lui-même son propre courrier (requester == signataire).
// Même esprit que decision_signee pour un arrêté. Test sans base de données :
// on isole le prédicat de notification, à garder synchronisé avec la route
// POST /dossiers/:id/courriers/:courrierId/sign.

// Réplique exacte de la condition appliquée par la route. À garder synchronisé.
const shouldNotifyRequester = (
  courrier: { signature_requested_by: string | null },
  signerUserId: string,
): boolean =>
  !!courrier.signature_requested_by && courrier.signature_requested_by !== signerUserId;

const REQUESTER = "user-instructeur";
const SIGNER = "user-signataire";

describe("Notification « Courrier signé » (POST .../sign)", () => {
  it("prévient l'instructeur quand un autre signataire signe", () => {
    expect(shouldNotifyRequester({ signature_requested_by: REQUESTER }, SIGNER)).toBe(true);
  });

  it("ne s'auto-notifie pas quand le signataire signe son propre courrier", () => {
    expect(shouldNotifyRequester({ signature_requested_by: SIGNER }, SIGNER)).toBe(false);
  });

  it("ne notifie personne en l'absence de demande de signature", () => {
    expect(shouldNotifyRequester({ signature_requested_by: null }, SIGNER)).toBe(false);
  });
});
