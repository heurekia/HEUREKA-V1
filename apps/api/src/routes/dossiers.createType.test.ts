import { describe, it, expect } from "vitest";
import { z } from "zod";
import { dossierTypeEnum } from "@heureka-v1/db";
import { classifyPermit, type ClassificationInput } from "../services/classificationEngine.js";

// Régression : le parcours citoyen (NouvelleDemandeWizard) crée le dossier via
// POST /dossiers avec `type = classification.type`. Ce schéma DOIT donc accepter
// tout type que le moteur de classification peut produire — sans quoi la
// création échoue avec un 400 « Données invalides » remonté à l'utilisateur
// comme « Erreur lors de l'enregistrement du dossier. ».
//
// On reconstruit ici exactement la règle de validation de la route
// (cf. createSchema dans dossiers.ts) à partir de la même source de vérité
// (l'enum SQL `dossier_type`), puis on vérifie qu'elle accepte chaque sortie du
// moteur. Le bug d'origine : `certificat_urbanisme_b` (CUb) et
// `permis_de_construire_mi` (PCMI) n'étaient pas acceptés.
const acceptedType = z.enum(dossierTypeEnum.enumValues);

// Matrice couvrant chaque nature du wizard + les branches qui changent le type.
const scenarios: Array<{ label: string; input: ClassificationInput }> = [
  { label: "certificat (défaut → CUb)", input: { natures: ["certificat"] } },
  { label: "certificat type a (→ CUa)", input: { natures: ["certificat"], certificatType: "a" } },
  { label: "certificat type b (→ CUb)", input: { natures: ["certificat"], certificatType: "b" } },
  { label: "maison neuve (→ PCMI)", input: { natures: ["maison_neuve"], surface: 120 } },
  { label: "maison neuve > 150 m² (architecte)", input: { natures: ["maison_neuve"], surface: 200 } },
  { label: "agrandissement zone U ≤ 40 m² (→ DP)", input: { natures: ["agrandissement"], surface: 25, zone: "UB" } },
  { label: "agrandissement MI > seuil (→ PCMI)", input: { natures: ["agrandissement"], surface: 60, zone: "UB", existingIsMaisonIndividuelle: true } },
  { label: "agrandissement non-MI > seuil (→ PC)", input: { natures: ["agrandissement"], surface: 60, zone: "UB", existingIsMaisonIndividuelle: false } },
  { label: "petite construction > seuil (→ PC)", input: { natures: ["petite_construction"], surface: 60 } },
  { label: "aménagement piscine > 100 m² (→ PC)", input: { natures: ["amenagement"], amenagementType: "piscine", surface: 120 } },
  { label: "aménagement piscine 11-100 m² (→ DP)", input: { natures: ["amenagement"], amenagementType: "piscine", surface: 30 } },
  { label: "aménagement clôture (→ DP)", input: { natures: ["amenagement"], amenagementType: "cloture", surface: 0 } },
  { label: "démolition seule (→ PD)", input: { natures: ["demolition"], surface: 40 } },
  { label: "division avec voirie (→ PA)", input: { natures: ["division_terrain"], hasVoirieCommune: true } },
  { label: "division sans voirie (→ DP)", input: { natures: ["division_terrain"], hasVoirieCommune: false } },
  { label: "changement de destination (→ DP)", input: { natures: ["changement_destination"], surface: 60 } },
  { label: "modification d'aspect (→ DP)", input: { natures: ["modification_aspect"] } },
];

describe("POST /dossiers — alignement type ↔ moteur de classification", () => {
  it.each(scenarios)("accepte le type produit pour : $label", ({ input }) => {
    const { type } = classifyPermit(input);
    // `aucune_autorisation` n'est jamais envoyé au POST (le wizard sort tôt).
    if (type === "aucune_autorisation") return;
    expect(acceptedType.safeParse(type).success).toBe(true);
  });

  it("le CUb (cas signalé) est bien accepté", () => {
    const { type } = classifyPermit({ natures: ["certificat"], certificatType: "b" });
    expect(type).toBe("certificat_urbanisme_b");
    expect(acceptedType.safeParse(type).success).toBe(true);
  });
});
