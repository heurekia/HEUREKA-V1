/**
 * Demandes d'aide envoyées depuis le Centre d'aide d'un agent.
 *
 *   POST /mairie/support  { type, subject?, message, url? }
 *
 * L'identité (nom, email, rôle, commune) est résolue côté serveur à partir de
 * la session — le client ne peut pas l'usurper. Le message part par email vers
 * la boîte support, avec reply-to positionné sur l'agent.
 */

import { Router } from "express";
import { db } from "../../db.js";
import { users } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { sendSupportRequestEmail } from "../../services/mailer.js";

const TYPE_LABELS: Record<string, string> = {
  question: "Question",
  bug: "Problème technique",
  evolution: "Demande d'évolution",
  autre: "Autre",
};

function roleLabel(role: string): string {
  switch (role) {
    case "instructeur": return "Instructeur";
    case "admin": return "Administrateur";
    case "mairie": return "Mairie";
    case "service_externe": return "Service externe";
    default: return role;
  }
}

export const supportRouter = Router();

supportRouter.post("/support", async (req: AuthRequest, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Authentification requise" });
    const b = (req.body ?? {}) as { type?: string; subject?: string; message?: string; url?: string };

    const message = (b.message ?? "").trim();
    if (!message) return res.status(400).json({ error: "Le message est requis." });
    if (message.length > 5000) return res.status(400).json({ error: "Message trop long (5000 caractères maximum)." });

    const typeKey = TYPE_LABELS[b.type ?? ""] ? (b.type as string) : "autre";
    const subject = ((b.subject ?? "").trim().slice(0, 200)) || (TYPE_LABELS[typeKey] as string);

    const [u] = await db
      .select({ prenom: users.prenom, nom: users.nom })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);
    const name = u ? `${u.prenom ?? ""} ${u.nom ?? ""}`.trim() || req.user.email : req.user.email;

    await sendSupportRequestEmail({
      type: TYPE_LABELS[typeKey] as string,
      subject,
      message,
      requester: { name, email: req.user.email, roleLabel: roleLabel(req.user.role), commune: req.user.commune ?? null },
      context: {
        url: typeof b.url === "string" ? b.url.slice(0, 500) : undefined,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        at: new Date().toISOString(),
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[support:send]", err);
    res.status(500).json({ error: "Envoi impossible pour le moment. Réessayez plus tard." });
  }
});
