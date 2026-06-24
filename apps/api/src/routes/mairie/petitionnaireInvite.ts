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

// Normalise un nom pour comparaison : sans accents, minuscules, ponctuation et
// espaces multiples réduits. « Jean-Marie DUPONT » → « jean marie dupont ».
function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Garde-fou anti-erreur d'affiliation : avant de rattacher un dossier à un
// compte existant trouvé par email, on compare l'identité saisie sur le dossier
// à celle du compte. Tolère l'inversion prénom/nom et les noms partiels (un
// placeholder n'a souvent qu'un nom de famille) : on ne signale une divergence
// que si un mot de l'identité la plus courte est absent de l'autre. Si une des
// deux identités est vide, on ne peut pas comparer → pas d'alerte.
export function namesLikelyDiffer(
  a: { prenom?: string | null; nom?: string | null },
  b: { prenom?: string | null; nom?: string | null },
): boolean {
  const tokensA = new Set(normalizeName(`${a.prenom ?? ""} ${a.nom ?? ""}`).split(" ").filter(Boolean));
  const tokensB = new Set(normalizeName(`${b.prenom ?? ""} ${b.nom ?? ""}`).split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  const [small, big] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  for (const t of small) if (!big.has(t)) return true;
  return false;
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
