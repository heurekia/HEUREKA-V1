// Logique pure (sans I/O ni dépendance lourde) décidant comment prévenir le
// pétitionnaire d'un dossier enregistré au comptoir (saisie manuelle / OCR).
// Isolée ici pour rester testable sans démarrer la route (qui charge la couche
// auth/db). Utilisée par routes/mairie/dossiers.ts.

// Domaine des emails synthétiques attribués à un pétitionnaire sans email réel
// (compte interne non utilisable, créé uniquement pour respecter la FK
// dossiers.user_id). Source unique pour la création ET la détection.
export const PLACEHOLDER_EMAIL_DOMAIN = "@placeholder.heureka.local";

// True si l'email est un placeholder synthétique (donc compte non joignable).
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(PLACEHOLDER_EMAIL_DOMAIN);
}

// État du compte pétitionnaire après rattachement/création.
export type PetitionnaireAccountState =
  | "new" //                 compte citoyen tout juste créé
  | "existing-verified" //   compte existant déjà activé (peut se connecter)
  | "existing-unverified" // compte existant jamais activé (lien non cliqué)
  | "placeholder"; //        aucun email → compte interne non utilisable

// Décide comment prévenir le pétitionnaire une fois son compte rattaché/créé.
// La distinction vérifié/non vérifié est essentielle : un citoyen jamais activé
// ne peut pas se connecter, donc une notification in-app lui serait invisible —
// il faut (re)lui envoyer un email d'activation.
export function petitionnaireSideEffect(input: {
  inviteRequested: boolean;
  account: PetitionnaireAccountState;
}): "invite" | "notify" | "none" {
  if (!input.inviteRequested) return "none";
  switch (input.account) {
    case "new":
    case "existing-unverified":
      return "invite";
    case "existing-verified":
      return "notify";
    case "placeholder":
      return "none";
  }
}
