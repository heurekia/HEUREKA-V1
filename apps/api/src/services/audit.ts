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

export type AuditOptions = {
  userId?: string | null;
  email?: string | null;
};

// Async fire-and-forget audit insert. Errors are logged (not swallowed) so that
// a broken audit pipeline is visible in server logs and can be fixed.
export function logAudit(req: AuthRequest, action: string, opts: AuditOptions = {}): Promise<void> {
  const userId = opts.userId ?? req.user?.id ?? null;
  const email = opts.email ?? req.user?.email ?? null;
  return db
    .insert(audit_logs)
    .values({
      user_id: userId ?? undefined,
      email,
      action,
      ip: clientIp(req),
      user_agent: userAgent(req),
    })
    .then(() => undefined)
    .catch((err) => {
      console.error(`[audit] insert failed for action="${action}":`, err);
    });
}
