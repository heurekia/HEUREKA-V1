import { createHash, randomBytes } from "node:crypto";

/**
 * Génère un token de lien à usage unique (activation / reset / vérification
 * d'email) : 256 bits d'entropie, transmis EN CLAIR au destinataire par email.
 * Le retour est la valeur à mettre dans l'URL ; ce qui est stocké en base est
 * son hash (cf. hashPasswordToken).
 */
export function newPasswordToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash de STOCKAGE d'un token de lien. On enregistre `sha256(token)` en base et
 * jamais le token en clair : un dump SQL (sauvegarde fuitée, accès DBA, lecture
 * via injection) ne permet alors pas de rejouer un lien d'activation/reset
 * valide non encore expiré. SHA-256 suffit ici — le token a déjà une entropie de
 * 256 bits, donc aucun bruteforce n'est possible et bcrypt serait superflu.
 *
 * NB : à comparer côté vérification en hachant le token reçu puis en cherchant
 * l'égalité avec la colonne stockée.
 */
export function hashPasswordToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
