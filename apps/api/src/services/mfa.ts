/**
 * MFA TOTP (RFC 6238) pour les comptes agents/admin.
 *
 * - Secret TOTP CHIFFRÉ au repos (AES-256-GCM) : un dump de la base ne suffit
 *   pas à générer des codes. Clé = MFA_ENC_KEY (32 octets hex) si fournie,
 *   sinon dérivée du JWT_SECRET par scrypt.
 * - Codes de secours à usage unique : stockés uniquement sous forme d'empreinte
 *   SHA-256 (jamais en clair), affichés une seule fois à l'utilisateur.
 */
import { authenticator } from "otplib";
import QRCode from "qrcode";
import crypto from "node:crypto";

// Tolérance d'une fenêtre (±30 s) pour absorber un léger décalage d'horloge
// entre le serveur et l'app d'authentification.
authenticator.options = { window: 1 };

const ISSUER = "Heurekia";

// ── Chiffrement au repos du secret TOTP (AES-256-GCM) ───────────────────────
function encKey(): Buffer {
  const hex = process.env.MFA_ENC_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  // Repli : dérivation depuis JWT_SECRET (toujours présent). NB : une rotation
  // du JWT_SECRET rend les secrets MFA indéchiffrables → ré-enrôlement requis.
  return crypto.scryptSync(process.env.JWT_SECRET ?? "", "heureka-mfa-totp", 32);
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Secret MFA illisible");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// ── TOTP ────────────────────────────────────────────────────────────────────
export function generateTotpSecret(): string {
  return authenticator.generateSecret(); // base32
}

export function totpKeyUri(accountLabel: string, secret: string): string {
  return authenticator.keyuri(accountLabel, ISSUER, secret);
}

export function totpQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

export function verifyTotp(code: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: code.replace(/\s+/g, ""), secret });
  } catch {
    return false;
  }
}

// ── Codes de secours (usage unique) ──────────────────────────────────────────
function normalizeBackup(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function hashBackup(code: string): string {
  return crypto.createHash("sha256").update(normalizeBackup(code)).digest("hex");
}

export function generateBackupCodes(n = 10): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(8).toString("hex").slice(0, 10).toUpperCase();
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5)}`); // ex. "A1B2C-3D4E5"
  }
  return { plain, hashes: plain.map(hashBackup) };
}

/**
 * Si `code` correspond à une empreinte non utilisée, retourne la liste des
 * empreintes RESTANTES (sans celle consommée) — l'appelant la persiste.
 * Retourne null si aucun code ne correspond.
 */
export function consumeBackupCode(code: string, hashes: string[] | null | undefined): string[] | null {
  if (!hashes || hashes.length === 0) return null;
  const h = hashBackup(code);
  if (!hashes.includes(h)) return null;
  return hashes.filter((x) => x !== h);
}
