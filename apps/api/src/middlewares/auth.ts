import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

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

export function generateToken(payload: { id: string; email: string; role: string; commune?: string; commune_insee?: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function extractToken(req: Request): string | null {
  // Per-portal cookie: pick the one matching the portal currently requested so a
  // citoyen session on www.heurekia.com and a mairie session on app.heurekia.com
  // can coexist in the same browser without overwriting each other.
  //
  // Primary signal: `req.hostname` (from the Host header). Always present, works
  // on a `GET /api/auth/me` at page refresh where the browser does NOT send
  // `Origin` for same-origin GETs. Falling back to Origin only would log the
  // user out on every refresh — that's the bug we're avoiding.
  const host = (req.hostname ?? "").toLowerCase();
  const origin = ((req.headers.origin as string | undefined) ?? (req.headers.referer as string | undefined) ?? "").toLowerCase();
  const isApp = host.includes("app.heurekia.com") || origin.includes("app.heurekia.com");
  const portalCookie = isApp ? "token_app" : "token_www";
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (cookies?.[portalCookie]) return cookies[portalCookie] as string;
  // Cross-portal fallback: if the portal cookie is missing (ambiguous host in
  // dev, behind a proxy that rewrites Host, etc.) accept the other portal's
  // cookie rather than dropping the session.
  const otherCookie = isApp ? "token_www" : "token_app";
  if (cookies?.[otherCookie]) return cookies[otherCookie] as string;
  // Legacy single-cookie fallback (sessions issued before the per-portal split).
  if (cookies?.token) return cookies.token;
  // Bearer header as fallback (API clients / CLI)
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: string };
    req.user = decoded;
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
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: string };
      req.user = decoded;
    } catch {
      // silent fail
    }
  }
  next();
}
