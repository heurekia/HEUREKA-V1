import type { Request } from "express";
import { db } from "../db.js";
import { audit_logs } from "@heureka-v1/db";
import type { AuthRequest } from "../middlewares/auth.js";

function clientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
}

function userAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : null;
}

// Champs systématiquement strippés avant insert : ne doivent JAMAIS atterrir
// dans la table d'audit (secrets, contenus binaires lourds, hashes…).
const SENSITIVE_KEYS = new Set([
  "password", "current_password", "new_password", "password_hash",
  "token", "jwt", "secret", "api_key", "apiKey", "authorization",
  // Contenus binaires base64 — feraient exploser la taille des audits.
  "file_b64", "fileB64", "pdf_content", "pdfContent", "logo_url",
  "letterhead_logo", "signature_image", "tampon_image", "avatar_url",
]);

// Tronque récursivement un body utilisateur pour insert en jsonb : on garde
// les clés "métier" lisibles, on jette les binaires et secrets. Profondeur 2 :
// au-delà, on stocke un résumé "(object)" pour éviter d'écrire des tonnes de
// JSON imbriqué.
export function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…(${value.length})` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= 2) return `(array len=${value.length})`;
    return value.slice(0, 20).map((v) => sanitizeMetadataValue(v, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 2) return "(object)";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      out[k] = sanitizeMetadataValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export type AuditOptions = {
  userId?: string | null;
  email?: string | null;
  role?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
};

// Async fire-and-forget audit insert. Errors are logged (not swallowed) so that
// a broken audit pipeline is visible in server logs and can be fixed.
export function logAudit(req: AuthRequest, action: string, opts: AuditOptions = {}): Promise<void> {
  const userId = opts.userId ?? req.user?.id ?? null;
  const email = opts.email ?? req.user?.email ?? null;
  const role = opts.role ?? req.user?.role ?? null;
  const sanitized = opts.metadata ? (sanitizeMetadataValue(opts.metadata) as Record<string, unknown>) : null;
  return db
    .insert(audit_logs)
    .values({
      user_id: userId ?? undefined,
      email,
      role,
      action,
      target_type: opts.targetType ?? null,
      target_id: opts.targetId ?? null,
      metadata: sanitized,
      ip: clientIp(req),
      user_agent: userAgent(req),
    })
    .then(() => undefined)
    .catch((err) => {
      console.error(`[audit] insert failed for action="${action}":`, err);
    });
}
