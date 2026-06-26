import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import { users } from "@heureka-v1/db";

if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET env var is not set");
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET as string;

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    commune?: string;
    commune_insee?: string;
  };
}

// Claims réellement présents dans le JWT (inclut `tv`, la version de session).
interface TokenClaims {
  id: string;
  email: string;
  role: string;
  commune?: string;
  commune_insee?: string;
  tv?: number;
}

export function generateToken(payload: {
  id: string; email: string; role: string; commune?: string; commune_insee?: string; token_version?: number;
}): string {
  const { token_version, ...claims } = payload;
  // `tv` = version de session embarquée ; comparée à users.token_version par
  // requireAuth pour permettre la révocation (cf. bumpTokenVersion).
  return jwt.sign({ ...claims, tv: token_version ?? 0 }, JWT_SECRET, { expiresIn: "7d" });
}

// ── Révocation de session via token_version ─────────────────────────────────
// requireAuth doit connaître la version de session COURANTE pour rejeter un JWT
// dont le `tv` ne correspond plus (mot de passe/rôle changé, compte révoqué).
// Pour ne pas payer un accès DB à chaque requête, on met en cache (userId → tv)
// avec un TTL court : la révocation prend effet en ≤ TTL (≈ immédiat).
const TV_TTL_MS = 60_000;
const _tvCache = new Map<string, { tv: number; exp: number }>();

async function currentTokenVersion(userId: string): Promise<number | null> {
  const now = Date.now();
  const cached = _tvCache.get(userId);
  if (cached && cached.exp > now) return cached.tv;
  const [u] = await db
    .select({ tv: users.token_version, deactivated_at: users.deactivated_at })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // Utilisateur supprimé (citoyen effacé) OU désactivé (offboarding d'un compte
  // pro) → jeton invalide. On traite la désactivation comme une révocation : la
  // session tombe au plus tard au prochain rafraîchissement du cache (≤ TTL), et
  // immédiatement si la désactivation a bumpé token_version (cf. deactivateUser).
  if (!u || u.deactivated_at) { _tvCache.delete(userId); return null; }
  _tvCache.set(userId, { tv: u.tv, exp: now + TV_TTL_MS });
  return u.tv;
}

/**
 * Incrémente la version de session d'un utilisateur → invalide TOUS ses jetons
 * existants. À appeler sur changement de mot de passe / de rôle / révocation.
 * Retourne la nouvelle version (à embarquer dans un éventuel jeton réémis pour
 * ne pas déconnecter la session courante de l'acteur).
 */
export async function bumpTokenVersion(userId: string): Promise<number> {
  const [u] = await db
    .update(users)
    .set({ token_version: sql`${users.token_version} + 1` })
    .where(eq(users.id, userId))
    .returning({ tv: users.token_version });
  const tv = u?.tv ?? 0;
  _tvCache.set(userId, { tv, exp: Date.now() + TV_TTL_MS });
  return tv;
}

/** Purge l'entrée de cache (ex. après suppression de compte). */
export function invalidateTokenVersionCache(userId: string): void {
  _tvCache.delete(userId);
}

// ── Ticket MFA ──────────────────────────────────────────────────────────────
// Émis quand le mot de passe est validé mais que la MFA reste à confirmer. Ce
// n'est PAS une session : courte durée, purpose dédié, ne donne accès à rien
// d'autre qu'à /auth/mfa/login-verify.
export function issueMfaTicket(userId: string): string {
  return jwt.sign({ uid: userId, purpose: "mfa_login" }, JWT_SECRET, { expiresIn: "5m" });
}

export function verifyMfaTicket(ticket: string): string | null {
  try {
    const d = jwt.verify(ticket, JWT_SECRET) as { uid?: string; purpose?: string };
    if (d.purpose !== "mfa_login" || typeof d.uid !== "string") return null;
    return d.uid;
  } catch {
    return null;
  }
}

function extractToken(req: Request): string | null {
  // Per-portal cookie: the citoyen (www), mairie (app) and super-admin (admin)
  // sessions must coexist WITHOUT bleeding into each other.
  //   admin.heurekia.com → token_admin
  //   app.heurekia.com   → token_app
  //   www / autre        → token_www
  //
  // Primary signal: `req.hostname` (from the Host header). Always present,
  // works on a `GET /api/auth/me` at page refresh where the browser does NOT
  // send `Origin` for same-origin GETs. Origin/Referer are only used as a
  // redundancy in case `hostname` is somehow empty.
  //
  // IMPORTANT — there is NO cross-portal fallback : if the portal-specific
  // cookie is missing, the user is simply not authenticated on this portal.
  // Falling back to another portal's cookie would expose e.g. a super-admin
  // session on the citoyen portal, which would be a privilege leak.
  const host = (req.hostname ?? "").toLowerCase();
  const origin = ((req.headers.origin as string | undefined) ?? (req.headers.referer as string | undefined) ?? "").toLowerCase();
  const portalCookie =
    host.includes("admin.heurekia.com") || origin.includes("admin.heurekia.com")
      ? "token_admin"
      : host.includes("app.heurekia.com") || origin.includes("app.heurekia.com")
      ? "token_app"
      : "token_www";
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (cookies?.[portalCookie]) return cookies[portalCookie] as string;
  // Legacy single-cookie fallback (sessions issued before the per-portal split).
  // Harmless : the legacy cookie was set when only one portal existed.
  if (cookies?.token) return cookies.token;
  // Bearer header as fallback (API clients / CLI)
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenClaims;
    // Révocation : le `tv` du jeton doit correspondre à la version courante.
    // tv === null → utilisateur supprimé → jeton invalide.
    const tv = await currentTokenVersion(decoded.id);
    if (tv === null || (decoded.tv ?? 0) !== tv) {
      return res.status(401).json({ error: "Session expirée, veuillez vous reconnecter." });
    }
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      commune: decoded.commune,
      commune_insee: decoded.commune_insee,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Accès refusé" });
    }
    next();
  };
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as TokenClaims;
      const tv = await currentTokenVersion(decoded.id);
      if (tv !== null && (decoded.tv ?? 0) === tv) {
        req.user = {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role,
          commune: decoded.commune,
          commune_insee: decoded.commune_insee,
        };
      }
    } catch {
      // silent fail
    }
  }
  next();
}
