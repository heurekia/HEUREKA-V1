/**
 * Cycle de vie des comptes : effacement (citoyens) vs désactivation (pros).
 *
 * Deux régimes distincts, centralisés ici pour éviter toute divergence entre
 * les points d'entrée (self-service citoyen, suppression super-admin, suppression
 * mairie) — divergence qui avait laissé passer un 500 à la suppression.
 *
 *  • CITOYEN  → effacement définitif (RGPD art. 17 « droit à l'effacement »).
 *  • PRO      → désactivation (offboarding). Un agent/admin porte des records
 *               légaux (arrêtés signés : decisions.instructeur_id est NOT NULL,
 *               courriers émis…) qu'on ne peut ni supprimer ni détacher : on
 *               préserve donc la ligne et on bloque l'accès.
 */
import { db } from "../db.js";
import {
  users,
  dossier_pieces_jointes,
  dossiers,
  decisions,
  dossier_courriers,
  dossier_piece_bundles,
} from "@heureka-v1/db";
import { eq, or } from "drizzle-orm";
import { bumpTokenVersion, invalidateTokenVersionCache } from "../middlewares/auth.js";
import { getStorageProvider } from "./storage.js";

// Comptes « professionnels » : gérés par un administrateur, jamais supprimés.
const PROFESSIONAL_ROLES = new Set(["mairie", "instructeur", "admin", "service_externe"]);

/** true pour un compte pro (mairie/instructeur/admin/service_externe), false pour un citoyen. */
export function isProfessionalRole(role: string): boolean {
  return PROFESSIONAL_ROLES.has(role);
}

// Best-effort STRICT : supprime les fichiers physiques des pièces déposées par
// le citoyen. Ne lève JAMAIS — un provider mal configuré ou une URL héritée
// malformée ne doit pas bloquer l'effacement en base (la partie légalement
// critique). Les fichiers orphelins éventuels sont balayés par la purge planifiée.
async function purgeCitizenFiles(userId: string): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  try {
    const storage = getStorageProvider();
    const pieces = await db
      .select({ url: dossier_pieces_jointes.url })
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.user_id, userId));
    const keys = pieces
      .map((p) => p.url)
      .filter((u): u is string => !!u)
      .flatMap((u) => {
        try { return [storage.keyFromUrl(u)]; } catch { return []; }
      });
    ({ deleted, failed } = await storage.removeBulk(keys));
    if (failed > 0) {
      console.warn(`[rgpd] effacement compte ${userId} : ${failed} fichiers en échec sur ${keys.length}`);
    }
  } catch (err) {
    console.error(`[rgpd] purge fichiers échouée pour ${userId} (effacement poursuivi) :`, err);
  }
  return { deleted, failed };
}

/**
 * Efface DÉFINITIVEMENT un compte citoyen (RGPD art. 17) : fichiers + pièces +
 * cascade DB. `dossier_pieces_jointes.user_id` est une FK NOT NULL sans cascade :
 * on supprime les pièces AVANT l'utilisateur dans une transaction, sinon Postgres
 * rejette le DELETE (la cascade via dossier_id ne désamorce pas cette contrainte
 * à temps — vérifié contre PostgreSQL 16). Le DELETE users emporte ensuite les
 * dossiers (et messages/décisions/courriers/notifications) par cascade.
 */
export async function eraseCitizenAccount(userId: string): Promise<{ files_deleted: number; files_failed: number }> {
  const files = await purgeCitizenFiles(userId);
  await db.transaction(async (tx) => {
    await tx.delete(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.user_id, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });
  invalidateTokenVersionCache(userId);
  return { files_deleted: files.deleted, files_failed: files.failed };
}

/**
 * Désactive (offboarding) un compte professionnel : AUCUNE donnée supprimée,
 * tous les records légaux restent intacts. La connexion est refusée
 * (deactivated_at, cf. /login + requireAuth) et TOUTES les sessions existantes
 * sont révoquées immédiatement (bumpTokenVersion invalide les JWT en cours).
 */
export async function deactivateUser(userId: string, actorId: string | null): Promise<void> {
  await db
    .update(users)
    .set({ deactivated_at: new Date(), deactivated_by: actorId, updated_at: new Date() })
    .where(eq(users.id, userId));
  await bumpTokenVersion(userId);
}

/**
 * true si le compte est référencé par un record légal qu'on ne peut ni supprimer
 * ni détacher — c.-à-d. les FK qui pointent sur `users.id` SANS `on delete`
 * cascade/set null (donc NO ACTION : un DELETE users lèverait une erreur). En
 * pratique : un dossier instruit, un arrêté, un courrier émis/signé, une pièce
 * déposée. Toutes les autres FK vers users sont cascade ou set null et se
 * nettoient seules. Sert à arbitrer « suppression réelle vs désactivation » :
 * un agent qui n'a ni signé ni instruit aucun dossier peut être supprimé.
 */
export async function userHasLegalRecords(userId: string): Promise<boolean> {
  const probes = await Promise.all([
    db.select({ id: dossiers.id }).from(dossiers).where(eq(dossiers.instructeur_id, userId)).limit(1),
    db.select({ id: decisions.id }).from(decisions).where(eq(decisions.instructeur_id, userId)).limit(1),
    db.select({ id: dossier_courriers.id }).from(dossier_courriers).where(or(
      eq(dossier_courriers.emis_par, userId),
      eq(dossier_courriers.signataire_user_id, userId),
      eq(dossier_courriers.signature_requested_by, userId),
    )).limit(1),
    db.select({ id: dossier_piece_bundles.id }).from(dossier_piece_bundles).where(eq(dossier_piece_bundles.user_id, userId)).limit(1),
    db.select({ id: dossier_pieces_jointes.id }).from(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.user_id, userId)).limit(1),
  ]);
  return probes.some((rows) => rows.length > 0);
}

/**
 * Offboarding d'un compte PROFESSIONNEL avec arbitrage : si le compte ne porte
 * AUCUN record légal bloquant (n'a ni signé ni instruit de dossier), on le
 * SUPPRIME réellement — ce qui libère son email (contrainte d'unicité) pour une
 * réutilisation. Sinon on se rabat sur la désactivation, qui préserve la ligne
 * et les records. Les FK restantes (cascade/set null) se nettoient d'elles-mêmes
 * lors du DELETE. Retourne l'action réellement effectuée.
 */
export async function offboardProfessional(
  userId: string,
  actorId: string | null,
): Promise<{ action: "deleted" | "deactivated" }> {
  if (await userHasLegalRecords(userId)) {
    await deactivateUser(userId, actorId);
    return { action: "deactivated" };
  }
  await db.delete(users).where(eq(users.id, userId));
  invalidateTokenVersionCache(userId);
  return { action: "deleted" };
}
