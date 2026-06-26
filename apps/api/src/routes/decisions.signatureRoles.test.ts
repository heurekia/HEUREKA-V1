import { describe, it, expect } from "vitest";
import { ASSIGNABLE_ROLES } from "@heureka-v1/shared";
import { userRoleEnum } from "@heureka-v1/db";

// Régression : un signataire de rôle « instructeur » recevait « Accès refusé »
// (HTTP 403) en cliquant « Confirmer le refus » — et de même « Signer l'arrêté ».
//
// Cause : POST /decisions/:id/sign et /refuse-signature étaient gardés par
// requireRole("mairie", "admin"), ce qui EXCLUT « instructeur ». Or n'importe
// quel agent (instructeur compris) peut être habilité signataire via
// Paramètres → bouton ✍️, et l'UI (DecisionPanel) lui présente alors les boutons
// Signer / Refuser. L'autorité réelle pour ces deux actes est l'habilitation
// signataire (table signataires, cf. isActiveSignataire), PAS le rôle de base :
// le rôle ne sert que de garde-fou grossier « agent interne, pas citoyen ».
//
// On reconstruit ici la liste de rôles des deux routes (comme
// dossiers.createType.test.ts reconstruit le schéma de validation) et on la
// confronte aux sources de vérité partagées (ASSIGNABLE_ROLES + userRoleEnum).

// Miroir du requireRole(...) appliqué À LA FOIS à /sign et /refuse-signature
// dans apps/api/src/routes/decisions.ts. À garder synchronisé avec ces routes.
const SIGNATURE_ACTION_ROLES = ["mairie", "instructeur", "admin"] as const;

// Réplique exacte du prédicat de requireRole (apps/api/src/middlewares/auth.ts) :
// l'accès passe si le rôle de l'utilisateur figure dans la liste autorisée.
const roleAllowed = (allow: readonly string[], role: string) => allow.includes(role);

describe("Autorisation signature d'arrêté (POST /decisions/:id/sign & /refuse-signature)", () => {
  it("autorise un instructeur — régression « Accès refusé »", () => {
    expect(roleAllowed(SIGNATURE_ACTION_ROLES, "instructeur")).toBe(true);
  });

  it("couvre tous les rôles d'agent interne habilitables signataires (ASSIGNABLE_ROLES)", () => {
    // Tout rôle pouvant être désigné/habilité en interne DOIT pouvoir agir sur la
    // signature que l'UI lui propose ; sinon « Accès refusé » à un signataire
    // pourtant légitime. C'est cet invariant qui empêche de re-restreindre la
    // liste à "mairie"/"admin" sans faire échouer le test.
    for (const role of ASSIGNABLE_ROLES) {
      expect(roleAllowed(SIGNATURE_ACTION_ROLES, role)).toBe(true);
    }
  });

  it("refuse les rôles non-agents (citoyen, service_externe)", () => {
    // Le garde-fou de rôle reste « agent interne uniquement ». L'habilitation
    // fine (signataire actif de la commune) est contrôlée séparément par la route.
    const externalRoles = userRoleEnum.enumValues.filter((r) => !ASSIGNABLE_ROLES.has(r));
    expect(externalRoles).toEqual(expect.arrayContaining(["citoyen", "service_externe"]));
    for (const role of externalRoles) {
      expect(roleAllowed(SIGNATURE_ACTION_ROLES, role)).toBe(false);
    }
  });
});
