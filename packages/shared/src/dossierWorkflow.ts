// ── Workflow d'instruction d'un dossier ──
// Machine à états centrale partagée API + Web. Toute mutation de statut
// d'un dossier doit passer par cette validation ; aucune transition n'est
// autorisée hors de la table DOSSIER_TRANSITIONS.

export type DossierStatus =
  | "brouillon"
  | "soumis"
  | "pre_instruction"
  | "incomplet"
  | "en_instruction"
  | "decision_en_cours"
  | "accepte"
  | "refuse"
  | "accord_prescription";

export const DOSSIER_STATUSES: DossierStatus[] = [
  "brouillon", "soumis", "pre_instruction", "incomplet", "en_instruction",
  "decision_en_cours", "accepte", "refuse", "accord_prescription",
];

export const TERMINAL_STATUSES: ReadonlySet<DossierStatus> = new Set([
  "accepte", "refuse", "accord_prescription",
]);

// Transitions autorisées. Toute transition absente d'ici est refusée par l'API.
// Les transitions vers les statuts terminaux (accepte/refuse/accord_prescription)
// ne sont pas listées ici : elles sont pilotées par le moteur de signature de
// décision (routes/decisions.ts) qui force le statut via bypassStateMachine.
export const DOSSIER_TRANSITIONS: Record<DossierStatus, DossierStatus[]> = {
  brouillon:           ["soumis"],
  soumis:              ["pre_instruction", "incomplet"],
  pre_instruction:     ["en_instruction", "incomplet"],
  incomplet:           ["pre_instruction"],
  en_instruction:      ["decision_en_cours", "incomplet"],
  decision_en_cours:   ["en_instruction"],
  accepte:             [],
  refuse:              [],
  accord_prescription: [],
};

export function canTransition(from: DossierStatus, to: DossierStatus): boolean {
  if (from === to) return false;
  return DOSSIER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: DossierStatus): DossierStatus[] {
  return DOSSIER_TRANSITIONS[from] ?? [];
}

export function isTerminal(status: DossierStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export const STATUS_LABELS: Record<DossierStatus, string> = {
  brouillon: "Brouillon",
  soumis: "Soumis",
  pre_instruction: "Pré-instruction",
  incomplet: "Incomplet",
  en_instruction: "En instruction",
  decision_en_cours: "Décision en cours",
  accepte: "Accepté",
  refuse: "Refusé",
  accord_prescription: "Accord avec prescriptions",
};

// ── Next action contextuelle pour l'instructeur ──
// Détermine le CTA principal à afficher en haut du dossier selon le statut.
// Renvoie null quand l'action attendue est externe (signature, dépôt citoyen…).
export type NextActionVariant = "primary" | "success" | "warning";

export interface NextAction {
  label: string;
  target_status: DossierStatus;
  variant: NextActionVariant;
  hint: string;
}

export function primaryNextAction(status: DossierStatus): NextAction | null {
  switch (status) {
    case "brouillon":
      return null; // le citoyen doit soumettre
    case "soumis":
      return {
        label: "Prendre en charge",
        target_status: "pre_instruction",
        variant: "primary",
        hint: "Démarrer l'analyse de complétude du dossier.",
      };
    case "pre_instruction":
      return {
        label: "Déclarer le dossier complet",
        target_status: "en_instruction",
        variant: "success",
        hint: "Les pièces requises ont été validées.",
      };
    case "incomplet":
      return {
        label: "Réexaminer la complétude",
        target_status: "pre_instruction",
        variant: "warning",
        hint: "Les pièces complémentaires ont été reçues.",
      };
    case "en_instruction":
    case "decision_en_cours":
    case "accepte":
    case "refuse":
    case "accord_prescription":
      return null;
  }
}

// Rôles autorisés à être désignés comme instructeur d'un dossier.
export const ASSIGNABLE_ROLES: ReadonlySet<string> = new Set(["instructeur", "mairie", "admin"]);
