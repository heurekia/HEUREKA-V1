import { describe, it, expect } from "vitest";
import {
  trackPieceQueued,
  trackPieceSettled,
  hasInflightPieces,
} from "./pieceOcrQueue.js";

// Invariant central du correctif « notif prématurée sur gros dossier ».
//
// Le watchdog reapStaleProcessing s'appuie sur hasInflightPieces pour NE PAS
// reclasser en `failed` une pièce `pending` qui attend simplement son tour dans
// la file FIFO globale du worker. Tant qu'au moins une pièce du dossier est en
// vol (mise en file, pas encore terminée), le dossier est « en chargement » et
// la notification « dossier prêt » doit rester en attente. Ces tests verrouillent
// cette comptabilité, qui est purement en mémoire (aucun accès DB).
describe("pieceOcrQueue — suivi des pièces en vol (inflight)", () => {
  it("un dossier inconnu n'a aucune pièce en vol", () => {
    expect(hasInflightPieces("dossier-inexistant")).toBe(false);
  });

  it("une pièce mise en file marque le dossier comme en vol", () => {
    const d = "dossier-A";
    trackPieceQueued(d);
    expect(hasInflightPieces(d)).toBe(true);
    trackPieceSettled(d);
    expect(hasInflightPieces(d)).toBe(false);
  });

  it("reste en vol tant que TOUTES les pièces ne sont pas terminées (cas 28 pièces)", () => {
    const d = "dossier-gros";
    const N = 28;
    for (let i = 0; i < N; i++) trackPieceQueued(d);
    expect(hasInflightPieces(d)).toBe(true);

    // Le worker vide la file une pièce à la fois : le dossier doit rester
    // « en vol » jusqu'à la toute dernière. C'est ce qui empêche le watchdog de
    // reclasser à tort les pièces encore en attente et de notifier trop tôt.
    for (let i = 0; i < N - 1; i++) {
      trackPieceSettled(d);
      expect(hasInflightPieces(d)).toBe(true);
    }
    trackPieceSettled(d);
    expect(hasInflightPieces(d)).toBe(false);
  });

  it("ne passe jamais en négatif si on solde plus de pièces que mises en file", () => {
    const d = "dossier-desequilibre";
    trackPieceQueued(d);
    trackPieceSettled(d);
    // Solde superflu (ne devrait pas arriver, mais doit rester inoffensif).
    trackPieceSettled(d);
    expect(hasInflightPieces(d)).toBe(false);
    // Un nouveau cycle repart proprement de zéro.
    trackPieceQueued(d);
    expect(hasInflightPieces(d)).toBe(true);
    trackPieceSettled(d);
    expect(hasInflightPieces(d)).toBe(false);
  });

  it("suit les dossiers indépendamment les uns des autres", () => {
    const a = "dossier-indep-1";
    const b = "dossier-indep-2";
    trackPieceQueued(a);
    expect(hasInflightPieces(a)).toBe(true);
    expect(hasInflightPieces(b)).toBe(false);
    trackPieceSettled(a);
    expect(hasInflightPieces(a)).toBe(false);
  });
});
