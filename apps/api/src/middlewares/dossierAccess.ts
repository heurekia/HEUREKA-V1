import type { Response, NextFunction } from "express";
import { db } from "../db.js";
import { dossiers, users, communes, user_communes } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import type { AuthRequest } from "./auth.js";

// Résultat de la résolution du périmètre d'un agent : noms de communes (en
// minuscules) auxquelles il a accès. Admin → null = pas de filtre.
export type CommuneScope = Set<string> | null;

const _scopeCache = new Map<string, CommuneScope>();

/**
 * Calcule l'ensemble des communes (par nom, lowercased) qu'un user mairie/
 * instructeur a le droit de voir. Pour les admins, retourne null (tout passe).
 * Source de vérité : table user_communes ; fallback sur users.commune si la
 * jointure est vide (comptes legacy mono-commune).
 */
export async function getCommuneScope(userId: string, role: string): Promise<CommuneScope> {
  if (role === "admin") return null;
  const cached = _scopeCache.get(userId);
  if (cached !== undefined) return cached;

  const linked = await db
    .select({ name: communes.name })
    .from(user_communes)
    .innerJoin(communes, eq(user_communes.commune_id, communes.id))
    .where(eq(user_communes.user_id, userId));

  const names = new Set<string>();
  for (const r of linked) {
    if (r.name) names.add(r.name.trim().toLowerCase());
  }

  if (names.size === 0) {
    const [u] = await db.select({ commune: users.commune }).from(users).where(eq(users.id, userId)).limit(1);
    if (u?.commune) names.add(u.commune.trim().toLowerCase());
  }

  _scopeCache.set(userId, names);
  return names;
}

/** Invalide le cache de scope (à appeler après modification de user_communes). */
export function invalidateCommuneScope(userId: string): void {
  _scopeCache.delete(userId);
}

/** Vérifie qu'une commune (nom texte) appartient au scope. */
export function communeInScope(commune: string | null | undefined, scope: CommuneScope): boolean {
  if (scope === null) return true;
  if (!commune) return false;
  return scope.has(commune.trim().toLowerCase());
}

/**
 * Middleware pour les routes mairie portant /dossiers/:id*.
 * - Charge le dossier.
 * - Pour citoyen : 403 (les routes mairie n'acceptent pas les citoyens, mais
 *   par sécurité défense en profondeur).
 * - Pour mairie/instructeur : vérifie que dossier.commune ∈ scope.
 * - Pour admin : pass.
 * Attache req.dossier pour éviter une seconde requête côté handler.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function enforceDossierAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const dossierId = String(req.params.id ?? "");
    if (!dossierId) return res.status(400).json({ error: "ID dossier manquant" });

    // Si le segment ne ressemble pas à un UUID, on laisse passer : c'est une
    // sous-route littérale (ex. /dossiers/export). Le handler suivant fera
    // sa propre validation.
    if (!UUID_RE.test(dossierId)) return next();

    const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const role = req.user?.role ?? "";
    const userId = req.user?.id ?? "";
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    if (role !== "admin" && role !== "mairie" && role !== "instructeur") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const scope = await getCommuneScope(userId, role);
    if (!communeInScope(dossier.commune, scope)) {
      return res.status(404).json({ error: "Dossier non trouvé" });
    }

    (req as AuthRequest & { dossier?: typeof dossier }).dossier = dossier;
    next();
  } catch (err) {
    console.error("[enforceDossierAccess]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
}
