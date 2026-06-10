import { describe, it, expect } from "vitest";
import {
  canTransition,
  nextStatuses,
  primaryNextAction,
  isTerminal,
  DOSSIER_STATUSES,
  ASSIGNABLE_ROLES,
  type DossierStatus,
} from "@heureka-v1/shared";

describe("dossier workflow state machine", () => {
  it("autorise les transitions normales du parcours d'instruction", () => {
    expect(canTransition("brouillon", "soumis")).toBe(true);
    expect(canTransition("soumis", "pre_instruction")).toBe(true);
    expect(canTransition("pre_instruction", "en_instruction")).toBe(true);
    expect(canTransition("pre_instruction", "incomplet")).toBe(true);
    expect(canTransition("incomplet", "pre_instruction")).toBe(true);
    expect(canTransition("en_instruction", "decision_en_cours")).toBe(true);
    expect(canTransition("decision_en_cours", "en_instruction")).toBe(true);
  });

  it("refuse les sauts d'étape (soumis → en_instruction direct)", () => {
    expect(canTransition("soumis", "en_instruction")).toBe(false);
    expect(canTransition("brouillon", "pre_instruction")).toBe(false);
    expect(canTransition("pre_instruction", "decision_en_cours")).toBe(false);
  });

  it("interdit toute transition depuis un statut terminal", () => {
    for (const terminal of ["accepte", "refuse", "accord_prescription"] as DossierStatus[]) {
      expect(isTerminal(terminal)).toBe(true);
      expect(nextStatuses(terminal)).toEqual([]);
      for (const target of DOSSIER_STATUSES) {
        expect(canTransition(terminal, target)).toBe(false);
      }
    }
  });

  it("refuse les transitions vers les statuts terminaux (réservées à la signature)", () => {
    // Les statuts terminaux sont forcés par le moteur de décision via
    // bypassStateMachine — la machine à états ouverte ne doit jamais les
    // autoriser directement, pour éviter qu'une route soit utilisée pour
    // by-passer le circuit de signature.
    expect(canTransition("decision_en_cours", "accepte")).toBe(false);
    expect(canTransition("decision_en_cours", "refuse")).toBe(false);
    expect(canTransition("en_instruction", "accepte")).toBe(false);
  });

  it("refuse les transitions vers le même statut (no-op)", () => {
    for (const s of DOSSIER_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it("renvoie une next action utile pour les statuts actifs", () => {
    expect(primaryNextAction("soumis")?.target_status).toBe("pre_instruction");
    expect(primaryNextAction("pre_instruction")?.target_status).toBe("en_instruction");
    expect(primaryNextAction("incomplet")?.target_status).toBe("pre_instruction");
  });

  it("ne propose pas de next action quand l'attente est externe (citoyen / signature / terminal)", () => {
    expect(primaryNextAction("brouillon")).toBeNull();
    expect(primaryNextAction("en_instruction")).toBeNull();
    expect(primaryNextAction("decision_en_cours")).toBeNull();
    expect(primaryNextAction("accepte")).toBeNull();
    expect(primaryNextAction("refuse")).toBeNull();
    expect(primaryNextAction("accord_prescription")).toBeNull();
  });

  it("expose la liste des rôles assignables comme instructeur", () => {
    expect(ASSIGNABLE_ROLES.has("instructeur")).toBe(true);
    expect(ASSIGNABLE_ROLES.has("mairie")).toBe(true);
    expect(ASSIGNABLE_ROLES.has("admin")).toBe(true);
    expect(ASSIGNABLE_ROLES.has("citoyen")).toBe(false);
    expect(ASSIGNABLE_ROLES.has("service_externe")).toBe(false);
  });
});
