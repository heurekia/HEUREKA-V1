/**
 * Profil CERFA mémorisé (RGPD — confort de saisie, citoyens).
 *
 * Permet à un citoyen de réutiliser, d'une demande à l'autre, le sous-ensemble
 * STABLE de ses informations d'état civil saisies au step 5 du tunnel de dépôt
 * (civilité, date/lieu de naissance, qualité du demandeur, adresse postale,
 * société). On NE mémorise PAS les champs propres à un projet (surfaces,
 * hauteur, parcelle, destination…) : minimisation des données (RGPD art. 5-1-c).
 *
 * Cadre RGPD :
 *  • Finalité distincte de l'instruction (« confort de pré-remplissage ») →
 *    base légale = consentement explicite et révocable (art. 6-1-a). L'opt-in
 *    est horodaté dans users.cerfa_profile_consent_at.
 *  • Chiffrement au repos (AES-256-GCM) : un dump de la base n'expose pas la
 *    date de naissance / l'adresse en clair. Même primitive que le secret MFA.
 *  • Conservation liée à la vie du compte ; effacé par cascade à la suppression
 *    (colonne portée par la table users) — cf. accountLifecycle.eraseCitizenAccount.
 *  • Exposé dans l'export RGPD (déchiffré) — cf. GET /api/auth/me/export.
 */
import crypto from "node:crypto";
import { db } from "../db.js";
import { users } from "@heureka-v1/db";
import { eq } from "drizzle-orm";

// ── Périmètre mémorisable ───────────────────────────────────────────────────
// Liste blanche STRICTE des champs réutilisables d'une demande à l'autre. Tout
// champ hors de cette liste (surfaces, hauteur, annexes, architecte du projet…)
// est ignoré : il dépend du projet, pas du demandeur. Sert à la fois à
// l'extraction (pickProfileFields) et au filtrage de l'entrée client.
const PROFILE_FIELDS = [
  // Identité personne physique
  "qualiteDemandeur",
  "civilite",
  "dateNaissance",
  "communeNaissance",
  "deptNaissance",
  "paysNaissance",
  // Société / personne morale
  "societeDenomination",
  "societeTypeJuridique",
  "societeSiret",
  "societeRepresentantCivilite",
  "societeRepresentantNom",
  "societeRepresentantPrenom",
  // Adresse postale du demandeur (si différente du terrain)
  "adresseDemandeurNumero",
  "adresseDemandeurVoie",
  "adresseDemandeurLocalite",
  "adresseDemandeurCodePostal",
] as const;

export type CerfaProfileField = (typeof PROFILE_FIELDS)[number];
export type CerfaProfile = Partial<Record<CerfaProfileField, string>>;

const PROFILE_FIELD_SET = new Set<string>(PROFILE_FIELDS);

/**
 * Réduit un objet arbitraire (cerfa_data complet OU payload client) au seul
 * sous-ensemble mémorisable, en ne gardant que les chaînes non vides. Garantit
 * la minimisation quelle que soit la source : on ne stocke jamais un champ
 * projet même si le client en envoie.
 */
export function pickProfileFields(source: Record<string, unknown> | null | undefined): CerfaProfile {
  if (!source || typeof source !== "object") return {};
  const out: CerfaProfile = {};
  for (const key of PROFILE_FIELDS) {
    const v = source[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v.trim();
  }
  return out;
}

// ── Chiffrement au repos (AES-256-GCM) ──────────────────────────────────────
// Clé dédiée : CERFA_PROFILE_ENC_KEY (32 octets hex) si fournie, sinon dérivée
// du JWT_SECRET par scrypt avec un sel propre (distinct du MFA). NB : une
// rotation du JWT_SECRET sans clé dédiée rend les profils indéchiffrables — le
// déchiffrement échoue alors silencieusement (profil traité comme absent), sans
// jamais bloquer la connexion ni le dépôt.
function encKey(): Buffer {
  const hex = process.env.CERFA_PROFILE_ENC_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  return crypto.scryptSync(process.env.JWT_SECRET ?? "", "heureka-cerfa-profile", 32);
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

function decrypt(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Profil CERFA illisible");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// ── Accès base ──────────────────────────────────────────────────────────────

/**
 * Charge et déchiffre le profil CERFA mémorisé d'un utilisateur. Renvoie le
 * profil + l'horodatage de consentement, ou `{ profile: null }` si aucun profil
 * (ou si le déchiffrement échoue — clé rotée : on dégrade proprement plutôt que
 * de lever).
 */
export async function loadCerfaProfile(
  userId: string,
): Promise<{ profile: CerfaProfile | null; consent_at: Date | null }> {
  const [row] = await db
    .select({ blob: users.cerfa_profile, consentAt: users.cerfa_profile_consent_at })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || !row.blob) return { profile: null, consent_at: row?.consentAt ?? null };
  try {
    const parsed = JSON.parse(decrypt(row.blob)) as Record<string, unknown>;
    return { profile: pickProfileFields(parsed), consent_at: row.consentAt ?? null };
  } catch (err) {
    console.warn(`[cerfa-profile] déchiffrement échoué pour ${userId} (profil ignoré) :`, err);
    return { profile: null, consent_at: row.consentAt ?? null };
  }
}

/**
 * Mémorise (opt-in) le profil CERFA d'un utilisateur : minimise → chiffre →
 * stocke, et horodate le consentement. Si le profil minimisé est vide, équivaut
 * à un effacement (clearCerfaProfile). Renvoie le profil effectivement stocké.
 */
export async function saveCerfaProfile(
  userId: string,
  source: Record<string, unknown>,
  at: Date,
): Promise<CerfaProfile> {
  const profile = pickProfileFields(source);
  if (Object.keys(profile).length === 0) {
    await clearCerfaProfile(userId);
    return {};
  }
  await db
    .update(users)
    .set({
      cerfa_profile: encrypt(JSON.stringify(profile)),
      cerfa_profile_consent_at: at,
      updated_at: at,
    })
    .where(eq(users.id, userId));
  return profile;
}

/**
 * Révoque la mémorisation : efface le profil chiffré ET l'horodatage de
 * consentement (RGPD — retrait du consentement, art. 7-3).
 */
export async function clearCerfaProfile(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ cerfa_profile: null, cerfa_profile_consent_at: null, updated_at: new Date() })
    .where(eq(users.id, userId));
}

// Réexporté pour le filtrage côté route : true si la clé fait partie du
// périmètre mémorisable.
export function isProfileField(key: string): key is CerfaProfileField {
  return PROFILE_FIELD_SET.has(key);
}
