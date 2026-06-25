import type { Response, NextFunction } from "express";
import { db } from "../db.js";
import { users, role_permissions } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import type { AuthRequest } from "./auth.js";

// Périmètre de permissions effectif d'un agent :
//   null = accès complet (super admin, OU agent sans rôle personnalisé assigné).
//   Set  = liste blanche des permissions accordées par le rôle personnalisé.
//
// Principe de rétro-compatibilité : tant qu'aucun rôle personnalisé n'est
// assigné à un utilisateur (role_config_id NULL), il conserve TOUS les droits
// de son rôle de base — l'enforcement ne restreint donc jamais les comptes
// existants. Seuls les agents à qui un profil est explicitement attribué sont
// limités aux permissions cochées dans ce profil.
export type PermissionSet = Set<string> | null;

const _permCache = new Map<string, PermissionSet>();

/**
 * Résout les permissions effectives d'un utilisateur (avec cache mémoire).
 * Source de vérité : users.role_config_id → role_permissions.permissions.
 */
export async function getEffectivePermissions(userId: string, role: string): Promise<PermissionSet> {
  if (role === "admin") return null; // super admin : aucun filtrage
  const cached = _permCache.get(userId);
  if (cached !== undefined) return cached;

  const [u] = await db
    .select({ role_config_id: users.role_config_id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Pas de rôle personnalisé → accès complet du rôle de base.
  if (!u?.role_config_id) {
    _permCache.set(userId, null);
    return null;
  }

  const [cfg] = await db
    .select({ permissions: role_permissions.permissions })
    .from(role_permissions)
    .where(eq(role_permissions.id, u.role_config_id))
    .limit(1);

  // Profil supprimé entre-temps → on retombe sur l'accès complet du rôle de
  // base (cohérent avec le message de suppression côté super admin).
  const set: PermissionSet = cfg ? new Set(cfg.permissions) : null;
  _permCache.set(userId, set);
  return set;
}

/** Invalide le cache d'un utilisateur (après changement de rôle / role_config_id). */
export function invalidatePermissions(userId: string): void {
  _permCache.delete(userId);
}

/**
 * Vide tout le cache. À appeler quand la DÉFINITION d'un rôle change
 * (création / édition / suppression d'un profil), car cela affecte
 * potentiellement tous les utilisateurs qui le possèdent.
 */
export function invalidateAllPermissions(): void {
  _permCache.clear();
}

/** Vrai si l'agent possède la permission (accès complet si set === null). */
export function hasPermission(set: PermissionSet, key: string): boolean {
  return set === null || set.has(key);
}

/**
 * Middleware : protège une route derrière une ou plusieurs permissions.
 * L'agent doit posséder TOUTES les permissions listées (ET logique).
 * Les comptes sans rôle personnalisé (set === null) passent toujours, ce qui
 * garantit la rétro-compatibilité. À chaîner APRÈS requireAuth / requireRole.
 */
export function requirePermission(...keys: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    const role = req.user?.role ?? "";
    if (!userId) return res.status(401).json({ error: "Non authentifié" });
    try {
      const set = await getEffectivePermissions(userId, role);
      if (keys.every((k) => hasPermission(set, k))) return next();
      return res.status(403).json({ error: "Votre rôle ne vous autorise pas à effectuer cette action." });
    } catch (err) {
      console.error("[requirePermission]", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  };
}
