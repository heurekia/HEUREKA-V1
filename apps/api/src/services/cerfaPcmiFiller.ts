// Remplissage du CERFA 13406*16 (Permis de Construire — Maison Individuelle).
//
// Architecture :
//   1. `pcmiFieldMap` — registre déclaratif clés sémantiques → noms AcroForm
//      du PDF officiel. Volontairement plat pour rester lisible. La référence
//      complète des 365 champs vit dans data/cerfa/13406-16.fields.json
//      (régénérable via `tsx scripts/inspect-cerfa.ts`).
//   2. `buildPcmiFieldValues(input)` — projette dossier + user + cerfa_data
//      saisi par le pétitionnaire vers les VALEURS finales (string/boolean).
//      Pure function, testable sans charger le PDF.
//   3. `fillPcmiCerfa(input)` — charge le PDF template, écrit les valeurs,
//      retourne le buffer prérempli. Conserve les AcroForms modifiables :
//      le citoyen pourra ajuster manuellement.
//
// Couverture v1 :
//   - Demandeur personne physique (D1*, D3* adresse, D5GE1 email, D5A accept.)
//   - Terrain (T2* adresse + cadastre principal — pas encore parcelles addl.)
//   - Description projet (C2ZD1) + cases destination principale
//   - Surface plancher créée (W3ES2)
//   - Engagement (E1L/E1D/E1S)
//   - Cases ABF / paysage si applicable (X1A, X2*)
//
// À compléter dans les itérations suivantes :
//   - Demandeur SCI (D2*) + raison sociale
//   - Mandataire / architecte (H1*, H2*) + déclaration sur l'honneur (H1H)
//   - Détail surface par destination (W2*…) — 12 destinations × 6 colonnes
//   - Stationnement, niveaux, pièces (C5Z*)
//   - DPE / RT2020 (C2ZE1, C6Z*)
//   - Taxes (P*) — laissées vides volontairement, la mairie les calcule

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PCMI_TEMPLATE_PATH = path.resolve(__dirname, "../data/cerfa/13406-16.pdf");

// ── Types d'entrée ──────────────────────────────────────────────────────────

export interface CerfaPcmiUser {
  nom: string;
  prenom: string;
  email: string;
  telephone: string | null;
}

export interface CerfaPcmiDossier {
  adresse: string | null;
  commune: string | null;
  code_postal: string | null;
  parcelle: string | null;
  description: string | null;
  surface_plancher: string | null;
}

/** Données saisies au step 5 du wizard. Tous champs facultatifs côté UI :
 *  le PDF reste modifiable si un champ manque. */
export interface CerfaPcmiData {
  // ── 1. Identité demandeur (complète l'état civil) ────────────────────────
  qualiteDemandeur?: "particulier" | "sci" | "indivision" | "autre";
  dateNaissance?: string;            // JJ/MM/AAAA
  communeNaissance?: string;
  deptNaissance?: string;
  paysNaissance?: string;
  // SCI / personne morale (si qualiteDemandeur ≠ particulier)
  societeDenomination?: string;
  societeRaisonSociale?: string;
  societeSiret?: string;
  societeTypeJuridique?: string;     // "SCI", "SARL"…
  societeRepresentantNom?: string;
  societeRepresentantPrenom?: string;
  // Adresse postale du demandeur (si différente du terrain)
  adresseDemandeurNumero?: string;
  adresseDemandeurVoie?: string;
  adresseDemandeurLocalite?: string;
  adresseDemandeurCodePostal?: string;
  adresseDemandeurBoite?: string;
  adresseDemandeurCedex?: string;
  // ── 2. Consentement notification numérique ───────────────────────────────
  accepteEmail?: boolean;
  // ── 3. Caractéristiques projet ───────────────────────────────────────────
  empriseSol?: string;
  hauteurProjet?: string;
  destinationActuelle?: string;     // ex: "habitation"
  destinationFuture?: string;
  nbLogements?: string;
  nbPieces?: string;
  nbNiveaux?: string;
  // Annexes
  comporteGarage?: boolean;
  comporteVeranda?: boolean;
  comportePiscine?: boolean;
  comporteAbriJardin?: boolean;
  // Travaux sur existant (cas extension / surélévation)
  surfaceExistanteAvant?: string;
  surfaceCreee?: string;
  surfaceSupprimee?: string;
  surelevation?: boolean;
  // Détail logements aidés
  nbLogementsLLS?: string;           // logements locatifs sociaux
  nbLogementsPTZ?: string;
  nbLogementsAccessionSociale?: string;
  // Destination du projet
  destinationUsage?: "principale" | "secondaire";
  destinationVente?: boolean;
  destinationLocation?: boolean;
  contratPreliminaire?: boolean;
  // ── 4. Mandataire / Architecte ───────────────────────────────────────────
  architecteRequis?: boolean;
  architecteNom?: string;
  architectePrenom?: string;
  architecteOrdre?: string;          // numéro d'inscription à l'Ordre
  architecteConseilRegional?: string;
  architecteVoieNumero?: string;
  architecteVoie?: string;
  architecteLocalite?: string;
  architecteCodePostal?: string;
  architecteTelephone?: string;
  architecteEmail?: string;
  // ── 5. Situations particulières ──────────────────────────────────────────
  proximiteABF?: boolean;            // monument historique <500m
  siteRemarquable?: boolean;
  siteClasse?: boolean;
  monumentHistorique?: boolean;
  raccordementReseaux?: boolean;
  legislationConnexe?: boolean;
  // ── 6. Travaux antérieurs ────────────────────────────────────────────────
  travauxAnterieurs?: boolean;
  travauxAnterieursDate?: string;
  travauxAnterieursLogements?: string;
}

export interface CerfaPcmiInput {
  user: CerfaPcmiUser;
  dossier: CerfaPcmiDossier;
  cerfa: CerfaPcmiData;
}

// ── Mapping clé sémantique → champ AcroForm ─────────────────────────────────

/** Mapping clés sémantiques → champs AcroForm du PDF officiel. Étendu en v2
 *  pour couvrir SCI, architecte, surfaces, logements et travaux antérieurs.
 *  Les champs PDF non listés ici restent vides et modifiables. */
const pcmiFieldMap = {
  // ── Demandeur — personne physique ──
  demandeur_nom: "D1N_nom",
  demandeur_prenom: "D1P_prenom",
  demandeur_dateNaissance: "D1A_naissance",
  demandeur_communeNaissance: "D1C_commune",
  demandeur_deptNaissance: "D1D_dept",
  demandeur_paysNaissance: "D1E_pays",
  // ── Demandeur — personne morale / SCI ──
  societe_denomination: "D2D_denomination",
  societe_raison: "D2R_raison",
  societe_siret: "D2S_siret",
  societe_typeJuridique: "D2J_type",
  societe_representantNom: "D2N_nom",
  societe_representantPrenom: "D2P_prenom",
  // ── Adresse demandeur ──
  demandeur_voieNumero: "D3N_numero",
  demandeur_voieNom: "D3V_voie",
  demandeur_lieuDit: "D3W_lieudit",
  demandeur_localite: "D3L_localite",
  demandeur_codePostal: "D3C_code",
  demandeur_boite: "D3B_boite",
  demandeur_cedex: "D3X_cedex",
  demandeur_telephone: "D3T_telephone",
  demandeur_pays: "D3P_pays",
  demandeur_email: "D5GE1_email",
  // ── Terrain — adresse ──
  terrain_voieNumero: "T2Q_numero",
  terrain_voieNom: "T2V_voie",
  terrain_lieuDit: "T2W_lieudit",
  terrain_localite: "T2L_localite",
  terrain_codePostal: "T2C_code",
  // ── Terrain — cadastre principal (1er triplet) ──
  terrain_prefixe: "T2F_prefixe",
  terrain_section: "T2S_section",
  terrain_numero: "T2N_numero",
  terrain_superficie: "T2T_superficie",
  // ── Architecte / Mandataire ──
  architecte_nom: "H1N_nom",
  architecte_prenom: "H1P_prenom",
  architecte_voieNumero: "H1Q_numero",
  architecte_voieNom: "H1V_voie",
  architecte_localite: "H1L_localite",
  architecte_codePostal: "H1C_code",
  architecte_ordre: "H1K_ordre",
  architecte_conseilRegional: "H1R_conseil",
  architecte_telephone: "H1T_telephone",
  architecte_email: "H1AE1_email",
  // ── Projet — caractéristiques ──
  projet_description: "C2ZD1_description",
  projet_nbLogements: "C5ZA1_logements",
  projet_nbPieces: "C5ZB1_pieces",
  projet_nbNiveaux: "C5ZB2_niveaux",
  projet_nbLogementsLLS: "C5ZC1_nombreLLS",
  projet_nbLogementsPTZ: "C5ZC3_nombrePTZ",
  projet_nbLogementsAS: "C5ZC2_nombreAS",
  projet_nbLogementsAutres: "C5ZC5_nombreautres",
  // ── Surfaces plancher ──
  surface_avantTravaux: "W3ES1_avanttravaux",
  surface_creee: "W3ES2_creee",
  surface_supprimee: "W3ES3_supprimee",
  // ── Travaux antérieurs ──
  travaux_anterieurs: "K1J_travaux",
  travaux_anterieursDate: "K1D_date",
  travaux_anterieursLogements: "K1L_logements",
  // ── Engagement ──
  engagement_lieu: "E1L_lieu",
  engagement_date: "E1D_date",
  engagement_signature: "E1S_signature",
} as const;

/** Cases à cocher du PDF activées par projection booléenne. */
const pcmiCheckboxMap = {
  // Consentement notifications
  consentement_email: "D5A_acceptation",
  // Caractère principal / secondaire
  destination_principale: "C2ZF1_principale",
  destination_secondaire: "C2ZF2_secondaire",
  // Type de construction
  construction_nouvelle: "C2ZA1_nouvelle",
  construction_existante: "C2ZB1_existante",
  // Annexes incluses
  annexe_piscine: "C5ZE1_piscine",
  annexe_garage: "C5ZE2_garage",
  annexe_veranda: "C5ZE3_veranda",
  annexe_abri: "C5ZE4_abri",
  annexe_autres: "C5ZE5_annexes",
  // Usage projeté
  usage_vente: "C5ZD2_vente",
  usage_location: "C5ZD3_location",
  contrat_preliminaire_oui: "C5ZG1_contratoui",
  contrat_preliminaire_non: "C5ZG2_contratnon",
  // Travaux : nature
  surelevation: "C5ZK2_surelevation",
  extension: "C5ZK1_extension",
  // Travaux antérieurs : portée
  travaux_anterieurs_totale: "K1S_totale",
  travaux_anterieurs_partielle: "K1E_partielle",
  // Architecte
  architecte_honneur: "H1H_honneur",
  // Situations particulières
  raccordement: "X1U_raccordement",
  abf: "X1A_ABF",
  legislation: "X1L_legislation",
  site_remarquable: "X2R_remarquable",
  monument_historique: "X2H_historique",
  site_classe: "X2C_classe",
} as const;

// ── Projection : input métier → valeurs PDF ─────────────────────────────────

export interface PcmiFieldValues {
  text: Partial<Record<keyof typeof pcmiFieldMap, string>>;
  checkboxes: Partial<Record<keyof typeof pcmiCheckboxMap, boolean>>;
}

/** Découpe "12 rue de la République" → { numero: "12", voie: "rue de la République" }.
 *  Heuristique simple : 1er token si numérique, reste sinon. */
function splitAdresse(adresse: string | null | undefined): { numero: string; voie: string } {
  if (!adresse) return { numero: "", voie: "" };
  const trimmed = adresse.trim();
  // Accepte les suffixes bis/ter/quater accolés (ex: "12bis", "3 ter") sans
  // perdre le reste de la voie.
  const match = trimmed.match(/^(\d+\s*(?:bis|ter|quater|[a-zA-Z])?)\s+(.*)$/i);
  if (match) return { numero: match[1]!.trim(), voie: match[2]!.trim() };
  return { numero: "", voie: trimmed };
}

/** Format CERFA des références cadastrales : on accepte indifféremment
 *  "AB 123", "AB-123", "000 AB 123" et on retourne { prefixe, section, numero }.
 *  Si on ne reconnaît rien, on retombe sur la chaîne brute en section. */
function parseParcelle(parcelle: string | null | undefined): { prefixe: string; section: string; numero: string } {
  if (!parcelle) return { prefixe: "", section: "", numero: "" };
  const cleaned = parcelle.trim().replace(/[-_/]/g, " ").replace(/\s+/g, " ");
  const parts = cleaned.split(" ");
  // Format complet : 3 segments (préfixe 3 chiffres, section, numéro)
  if (parts.length >= 3 && /^\d{3}$/.test(parts[0]!)) {
    return { prefixe: parts[0]!, section: parts[1] ?? "", numero: parts[2] ?? "" };
  }
  // Format réduit : section + numéro
  if (parts.length >= 2) {
    return { prefixe: "", section: parts[0]!, numero: parts[1]! };
  }
  return { prefixe: "", section: cleaned, numero: "" };
}

export function buildPcmiFieldValues(input: CerfaPcmiInput): PcmiFieldValues {
  const { user, dossier, cerfa } = input;
  const isSociete = cerfa.qualiteDemandeur && cerfa.qualiteDemandeur !== "particulier";
  // Adresse du demandeur : prioriser celle saisie au step 5, sinon réutiliser
  // l'adresse du dossier (cas où demandeur = propriétaire du terrain).
  const demAdr = cerfa.adresseDemandeurVoie
    ? { numero: cerfa.adresseDemandeurNumero ?? "", voie: cerfa.adresseDemandeurVoie }
    : splitAdresse(dossier.adresse);
  const demLocalite = cerfa.adresseDemandeurLocalite ?? dossier.commune ?? "";
  const demCodePostal = cerfa.adresseDemandeurCodePostal ?? dossier.code_postal ?? "";
  const terAdr = splitAdresse(dossier.adresse);
  const cad = parseParcelle(dossier.parcelle);

  // Cas extension/surélévation : PCMI peut s'appliquer à du construit existant
  // (cf. wizard nature = "agrandissement"). Sinon construction nouvelle.
  const surfaceAvant = Number(cerfa.surfaceExistanteAvant ?? "");
  const hasExistant = !Number.isNaN(surfaceAvant) && surfaceAvant > 0;

  const text: PcmiFieldValues["text"] = {
    // ── Demandeur PP ──
    demandeur_nom: user.nom,
    demandeur_prenom: user.prenom,
    demandeur_email: user.email,
    demandeur_telephone: user.telephone ?? "",
    demandeur_dateNaissance: cerfa.dateNaissance ?? "",
    demandeur_communeNaissance: cerfa.communeNaissance ?? "",
    demandeur_deptNaissance: cerfa.deptNaissance ?? "",
    demandeur_paysNaissance: cerfa.paysNaissance ?? "France",
    // ── Demandeur SCI / PM ──
    societe_denomination: isSociete ? (cerfa.societeDenomination ?? "") : "",
    societe_raison: isSociete ? (cerfa.societeRaisonSociale ?? "") : "",
    societe_siret: isSociete ? (cerfa.societeSiret ?? "") : "",
    societe_typeJuridique: isSociete ? (cerfa.societeTypeJuridique ?? "") : "",
    societe_representantNom: isSociete ? (cerfa.societeRepresentantNom ?? user.nom) : "",
    societe_representantPrenom: isSociete ? (cerfa.societeRepresentantPrenom ?? user.prenom) : "",
    // ── Adresse demandeur ──
    demandeur_voieNumero: demAdr.numero,
    demandeur_voieNom: demAdr.voie,
    demandeur_localite: demLocalite,
    demandeur_codePostal: demCodePostal,
    demandeur_boite: cerfa.adresseDemandeurBoite ?? "",
    demandeur_cedex: cerfa.adresseDemandeurCedex ?? "",
    demandeur_pays: "France",
    // ── Terrain ──
    terrain_voieNumero: terAdr.numero,
    terrain_voieNom: terAdr.voie,
    terrain_localite: dossier.commune ?? "",
    terrain_codePostal: dossier.code_postal ?? "",
    terrain_prefixe: cad.prefixe,
    terrain_section: cad.section,
    terrain_numero: cad.numero,
    // ── Architecte ──
    architecte_nom: cerfa.architecteNom ?? "",
    architecte_prenom: cerfa.architectePrenom ?? "",
    architecte_voieNumero: cerfa.architecteVoieNumero ?? "",
    architecte_voieNom: cerfa.architecteVoie ?? "",
    architecte_localite: cerfa.architecteLocalite ?? "",
    architecte_codePostal: cerfa.architecteCodePostal ?? "",
    architecte_ordre: cerfa.architecteOrdre ?? "",
    architecte_conseilRegional: cerfa.architecteConseilRegional ?? "",
    architecte_telephone: cerfa.architecteTelephone ?? "",
    architecte_email: cerfa.architecteEmail ?? "",
    // ── Projet ──
    projet_description: dossier.description ?? "",
    projet_nbLogements: cerfa.nbLogements ?? "",
    projet_nbPieces: cerfa.nbPieces ?? "",
    projet_nbNiveaux: cerfa.nbNiveaux ?? "",
    projet_nbLogementsLLS: cerfa.nbLogementsLLS ?? "",
    projet_nbLogementsPTZ: cerfa.nbLogementsPTZ ?? "",
    projet_nbLogementsAS: cerfa.nbLogementsAccessionSociale ?? "",
    projet_nbLogementsAutres: "",
    // ── Surfaces ──
    surface_avantTravaux: cerfa.surfaceExistanteAvant ?? "",
    surface_creee: cerfa.surfaceCreee ?? dossier.surface_plancher ?? "",
    surface_supprimee: cerfa.surfaceSupprimee ?? "",
    // ── Travaux antérieurs ──
    travaux_anterieurs: cerfa.travauxAnterieurs ? "Oui" : "",
    travaux_anterieursDate: cerfa.travauxAnterieursDate ?? "",
    travaux_anterieursLogements: cerfa.travauxAnterieursLogements ?? "",
    // ── Engagement ──
    engagement_lieu: dossier.commune ?? "",
    engagement_date: new Date().toLocaleDateString("fr-FR"),
  };

  const checkboxes: PcmiFieldValues["checkboxes"] = {
    // Consentement
    consentement_email: cerfa.accepteEmail === true,
    // Destination : principale = résidence principale, secondaire sinon.
    destination_principale: cerfa.destinationUsage !== "secondaire",
    destination_secondaire: cerfa.destinationUsage === "secondaire",
    // Type de construction : extension/surélévation cochent "existante",
    // construction neuve coche "nouvelle".
    construction_nouvelle: !hasExistant,
    construction_existante: hasExistant,
    // Annexes
    annexe_piscine: cerfa.comportePiscine === true,
    annexe_garage: cerfa.comporteGarage === true,
    annexe_veranda: cerfa.comporteVeranda === true,
    annexe_abri: cerfa.comporteAbriJardin === true,
    annexe_autres: false,
    // Usage projeté
    usage_vente: cerfa.destinationVente === true,
    usage_location: cerfa.destinationLocation === true,
    contrat_preliminaire_oui: cerfa.contratPreliminaire === true,
    contrat_preliminaire_non: cerfa.contratPreliminaire === false,
    // Nature des travaux
    surelevation: cerfa.surelevation === true,
    extension: hasExistant && cerfa.surelevation !== true,
    // Travaux antérieurs
    travaux_anterieurs_totale: cerfa.travauxAnterieurs === true,
    travaux_anterieurs_partielle: false,
    // Architecte — case "sur l'honneur" cochée si on déclare ne pas y recourir
    architecte_honneur: cerfa.architecteRequis === false,
    // Situations particulières
    raccordement: cerfa.raccordementReseaux === true,
    abf: cerfa.proximiteABF === true,
    legislation: cerfa.legislationConnexe === true,
    site_remarquable: cerfa.siteRemarquable === true,
    monument_historique: cerfa.monumentHistorique === true,
    site_classe: cerfa.siteClasse === true,
  };

  return { text, checkboxes };
}

// ── Remplissage effectif du PDF ─────────────────────────────────────────────

let templateCache: Uint8Array | null = null;

async function loadTemplate(): Promise<Uint8Array> {
  if (!templateCache) {
    templateCache = await readFile(PCMI_TEMPLATE_PATH);
  }
  return templateCache;
}

/** Remplit le PDF template et retourne le buffer du PDF prérempli.
 *  Les AcroForms restent modifiables : le citoyen peut ajuster avant impression. */
export async function fillPcmiCerfa(input: CerfaPcmiInput): Promise<Buffer> {
  const template = await loadTemplate();
  const doc = await PDFDocument.load(template);
  const form = doc.getForm();
  const values = buildPcmiFieldValues(input);

  // Champs texte — ignore silencieusement les champs absents (millésime ≠ 16).
  for (const [semKey, pdfName] of Object.entries(pcmiFieldMap)) {
    const value = values.text[semKey as keyof typeof pcmiFieldMap];
    if (!value) continue;
    try {
      form.getTextField(pdfName).setText(value);
    } catch {
      // Champ absent du template (millésime différent) — on ignore.
    }
  }

  // Cases à cocher
  for (const [semKey, pdfName] of Object.entries(pcmiCheckboxMap)) {
    const checked = values.checkboxes[semKey as keyof typeof pcmiCheckboxMap];
    if (checked === undefined) continue;
    try {
      const box = form.getCheckBox(pdfName);
      if (checked) box.check(); else box.uncheck();
    } catch {
      // Idem.
    }
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// Export interne pour tests
export const _internals = { pcmiFieldMap, pcmiCheckboxMap, splitAdresse, parseParcelle };
