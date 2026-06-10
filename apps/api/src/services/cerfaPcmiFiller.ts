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
  // Identité demandeur (complète l'état civil)
  dateNaissance?: string;            // JJ/MM/AAAA
  communeNaissance?: string;
  paysNaissance?: string;
  // Consentement notification numérique
  accepteEmail?: boolean;
  // Caractéristiques projet
  empriseSol?: string;
  hauteurProjet?: string;
  destinationActuelle?: string;     // ex: "habitation"
  destinationFuture?: string;
  nbLogements?: string;
  // Situations particulières
  proximiteABF?: boolean;            // monument historique <500m
  siteRemarquable?: boolean;
  raccordementReseaux?: boolean;
}

export interface CerfaPcmiInput {
  user: CerfaPcmiUser;
  dossier: CerfaPcmiDossier;
  cerfa: CerfaPcmiData;
}

// ── Mapping clé sémantique → champ AcroForm ─────────────────────────────────

/** Sous-ensemble couvert par v1. Les champs PDF non listés ici restent vides
 *  et modifiables par le citoyen. Étendre incrémentalement. */
const pcmiFieldMap = {
  // Demandeur — personne physique
  demandeur_nom: "D1N_nom",
  demandeur_prenom: "D1P_prenom",
  demandeur_dateNaissance: "D1A_naissance",
  demandeur_communeNaissance: "D1C_commune",
  demandeur_deptNaissance: "D1D_dept",
  demandeur_paysNaissance: "D1E_pays",
  // Adresse demandeur
  demandeur_voieNumero: "D3N_numero",
  demandeur_voieNom: "D3V_voie",
  demandeur_lieuDit: "D3W_lieudit",
  demandeur_localite: "D3L_localite",
  demandeur_codePostal: "D3C_code",
  demandeur_telephone: "D3T_telephone",
  demandeur_pays: "D3P_pays",
  demandeur_email: "D5GE1_email",
  // Terrain — adresse
  terrain_voieNumero: "T2Q_numero",
  terrain_voieNom: "T2V_voie",
  terrain_lieuDit: "T2W_lieudit",
  terrain_localite: "T2L_localite",
  terrain_codePostal: "T2C_code",
  // Terrain — cadastre principal (1er triplet)
  terrain_prefixe: "T2F_prefixe",
  terrain_section: "T2S_section",
  terrain_numero: "T2N_numero",
  terrain_superficie: "T2T_superficie",
  // Projet — caractéristiques
  projet_description: "C2ZD1_description",
  projet_nbLogements: "C5ZA1_logements",
  // Surfaces plancher
  surface_creee: "W3ES2_creee",
  // Engagement
  engagement_lieu: "E1L_lieu",
  engagement_date: "E1D_date",
  engagement_signature: "E1S_signature",
} as const;

/** Cases à cocher conditionnelles. Activées par buildPcmiFieldValues. */
const pcmiCheckboxMap = {
  consentement_email: "D5A_acceptation",
  destination_principale: "C2ZF1_principale",
  destination_secondaire: "C2ZF2_secondaire",
  construction_nouvelle: "C2ZA1_nouvelle",
  construction_existante: "C2ZB1_existante",
  raccordement: "X1U_raccordement",
  abf: "X1A_ABF",
  site_remarquable: "X2R_remarquable",
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
  const demAdr = splitAdresse(dossier.adresse);
  const terAdr = splitAdresse(dossier.adresse); // par défaut le terrain = adresse du dossier
  const cad = parseParcelle(dossier.parcelle);

  const text: PcmiFieldValues["text"] = {
    demandeur_nom: user.nom,
    demandeur_prenom: user.prenom,
    demandeur_email: user.email,
    demandeur_telephone: user.telephone ?? "",
    demandeur_dateNaissance: cerfa.dateNaissance ?? "",
    demandeur_communeNaissance: cerfa.communeNaissance ?? "",
    demandeur_paysNaissance: cerfa.paysNaissance ?? "France",
    // Adresse demandeur — réutilise l'adresse du dossier faute d'info séparée
    // dans le profil. Sera enrichi quand on ajoutera adresse_demandeur au step 5.
    demandeur_voieNumero: demAdr.numero,
    demandeur_voieNom: demAdr.voie,
    demandeur_localite: dossier.commune ?? "",
    demandeur_codePostal: dossier.code_postal ?? "",
    demandeur_pays: "France",
    // Terrain
    terrain_voieNumero: terAdr.numero,
    terrain_voieNom: terAdr.voie,
    terrain_localite: dossier.commune ?? "",
    terrain_codePostal: dossier.code_postal ?? "",
    terrain_prefixe: cad.prefixe,
    terrain_section: cad.section,
    terrain_numero: cad.numero,
    // Projet
    projet_description: dossier.description ?? "",
    projet_nbLogements: cerfa.nbLogements ?? "",
    surface_creee: dossier.surface_plancher ?? "",
    // Engagement — lieu/date pré-remplis, signature laissée vide.
    engagement_lieu: dossier.commune ?? "",
    engagement_date: new Date().toLocaleDateString("fr-FR"),
  };

  const checkboxes: PcmiFieldValues["checkboxes"] = {
    consentement_email: cerfa.accepteEmail === true,
    destination_principale: cerfa.destinationFuture === "habitation",
    destination_secondaire: cerfa.destinationFuture === "garage" || cerfa.destinationFuture === "hebergement_hotelier",
    construction_nouvelle: true, // PCMI = par définition une construction neuve
    construction_existante: false,
    raccordement: cerfa.raccordementReseaux === true,
    abf: cerfa.proximiteABF === true,
    site_remarquable: cerfa.siteRemarquable === true,
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
