import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db } from "../db.js";
import { users, dossiers, dossier_messages, dossier_pieces_jointes, notifications, password_tokens, ai_usage_events, audit_logs } from "@heureka-v1/db";
import { eq, and, gt, isNull, inArray } from "drizzle-orm";
import { generateToken, requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { sendPasswordResetEmail } from "../services/mailer.js";
import { logAudit } from "../services/audit.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Même résolution que dans routes/dossiers.ts : les fichiers déposés par les
// citoyens vivent sous apps/api/uploads. On en a besoin pour respecter le
// droit à l'effacement (RGPD art. 17) en supprimant les fichiers physiques
// quand un compte est supprimé.
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Trop de tentatives de connexion. Réessayez dans 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate-limit per IP, or per email body if available
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : null;
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    return email ? `login:${ip}:${email}` : `login:${ip}`;
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Trop de créations de compte. Réessayez dans 1 heure." },
  standardHeaders: true,
  legacyHeaders: false,
});

const IS_PROD = process.env.NODE_ENV === "production";

const COOKIE_CLEAR_OPTIONS = {
  path: "/",
  ...(IS_PROD ? { domain: ".heurekia.com" } : {}),
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax" as const,
  // Shared across www/app subdomains in production
  ...(IS_PROD ? { domain: ".heurekia.com" } : {}),
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: "/",
};

// Distinct cookie names per portal so a citoyen session on www.heurekia.com
// and a mairie session on app.heurekia.com can coexist in the same browser.
// Primary signal: `req.hostname` (Host header, always present). Origin/Referer
// are not always sent — e.g. browser does NOT send Origin on same-origin GETs.
export function cookieNameFor(req: AuthRequest): "token_app" | "token_www" {
  const host = (req.hostname ?? "").toLowerCase();
  const origin = ((req.headers.origin as string | undefined) ?? (req.headers.referer as string | undefined) ?? "").toLowerCase();
  const isApp = host.includes("app.heurekia.com") || origin.includes("app.heurekia.com");
  return isApp ? "token_app" : "token_www";
}

function writeAudit(userId: string | null, email: string, action: string, req: AuthRequest) {
  return logAudit(req, action, { userId, email });
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  prenom: z.string().min(1),
  nom: z.string().min(1),
  commune: z.string().optional(),
  telephone: z.string().optional(),
});

authRouter.post("/register", registerLimiter, async (req: AuthRequest, res) => {
  try {
    const data = registerSchema.parse(req.body);
    const existing = await db.select().from(users).where(eq(users.email, data.email)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: "Cet email est déjà utilisé" });
    }
    const password_hash = await bcrypt.hash(data.password, 10);
    const rows = await db
      .insert(users)
      .values({
        email: data.email,
        password_hash,
        prenom: data.prenom,
        nom: data.nom,
        role: "citoyen" as const,
        commune: data.commune,
        telephone: data.telephone,
      })
      .returning();
    const user = rows[0]!;
    const token = generateToken({ id: user.id, email: user.email, role: user.role, commune: user.commune ?? undefined, commune_insee: user.commune_insee ?? undefined });
    res.cookie(cookieNameFor(req), token, COOKIE_OPTIONS);
    res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
    await writeAudit(user.id, user.email, "register", req);
    res.status(201).json({
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, commune: user.commune, commune_insee: user.commune_insee },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: err.errors });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.post("/login", loginLimiter, async (req: AuthRequest, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email et mot de passe requis" });
    }
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
      await writeAudit(null, email, "login_failed", req);
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await writeAudit(null, email, "login_failed", req);
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }
    const token = generateToken({ id: user.id, email: user.email, role: user.role, commune: user.commune ?? undefined, commune_insee: user.commune_insee ?? undefined });
    res.cookie(cookieNameFor(req), token, COOKIE_OPTIONS);
    res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
    await writeAudit(user.id, user.email, "login", req);
    res.json({
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, commune: user.commune, commune_insee: user.commune_insee },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.post("/logout", requireAuth, async (req: AuthRequest, res) => {
  await writeAudit(req.user!.id, req.user!.email, "logout", req);
  res.clearCookie(cookieNameFor(req), COOKIE_CLEAR_OPTIONS);
  res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
  res.json({ ok: true });
});

authRouter.get("/me/export", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const [[user], userDossiers, messages, pieces, notifs, userAuditLogs] = await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      db.select().from(dossiers).where(eq(dossiers.user_id, userId)),
      db.select().from(dossier_messages).where(eq(dossier_messages.from_user_id, userId)),
      db.select().from(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.user_id, userId)),
      db.select().from(notifications).where(eq(notifications.user_id, userId)),
      db.select().from(audit_logs).where(eq(audit_logs.user_id, userId)),
    ]);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });

    // Événements IA imputables au pétitionnaire : tous les appels LLM
    // effectués au titre de ses dossiers. Permet au citoyen de constater
    // précisément quels fichiers ont été soumis à l'IA (file_hash) et à
    // quel coût (cost_eur). Droit d'accès RGPD art. 15.
    const dossierIds = userDossiers.map((d) => d.id);
    const aiEvents = dossierIds.length > 0
      ? await db.select().from(ai_usage_events).where(inArray(ai_usage_events.dossier_id, dossierIds))
      : [];

    const payload = {
      export_date: new Date().toISOString(),
      export_note: "Export complet de vos données conformément au droit d'accès RGPD (art. 15) et au droit à la portabilité (art. 20). Contactez le DPD pour toute question.",
      profil: {
        id: user.id,
        email: user.email,
        prenom: user.prenom,
        nom: user.nom,
        role: user.role,
        commune: user.commune,
        telephone: user.telephone,
        created_at: user.created_at,
      },
      // RGPD : exposition explicite du consentement à l'analyse IA + son
      // horodatage, pour chaque dossier. Le citoyen voit s'il a accepté ou
      // refusé l'analyse automatisée.
      dossiers: userDossiers.map((d) => ({
        ...d,
        ai_consent_explicite: d.ai_consent,
        ai_consent_date: d.ai_consent_at,
      })),
      messages,
      documents: pieces.map((p) => ({
        ...p,
        ia_analyse_effectuee: p.ai_processed,
      })),
      notifications: notifs,
      // RGPD : journal complet des appels IA effectués sur vos dossiers.
      // L'empreinte SHA-256 du fichier permet d'auditer précisément ce qui
      // a été soumis, sans dupliquer le contenu du fichier.
      evenements_ia: aiEvents.map((e) => ({
        date: e.created_at,
        dossier_id: e.dossier_id,
        finalite: e.purpose,
        modele: e.model,
        empreinte_fichier_sha256: e.file_hash,
        cout_eur: e.cost_eur,
        tokens_entree: e.input_tokens,
        tokens_sortie: e.output_tokens,
      })),
      // RGPD : journal d'audit lié à votre compte (connexions, modifications,
      // exports). Adresse IP partiellement conservée pour la sécurité.
      journal_audit: userAuditLogs.map((l) => ({
        date: l.created_at,
        action: l.action,
        ip: l.ip,
        user_agent: l.user_agent,
      })),
    };

    res.setHeader("Content-Disposition", `attachment; filename="mes-donnees-heureka-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader("Content-Type", "application/json");
    await writeAudit(userId, user.email, "data_export", req);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.delete("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Mot de passe requis" });

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Mot de passe incorrect" });

    // RGPD art. 17 (droit à l'effacement) : le simple DELETE en DB laisse les
    // fichiers physiques (PDF, plans, photos) sur disque → fuite de données.
    // On les supprime AVANT le DELETE en base. Best-effort : si un fichier est
    // déjà absent, on continue (l'objectif est zéro orphelin résiduel).
    const userPieces = await db
      .select({ url: dossier_pieces_jointes.url })
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.user_id, user.id));
    let filesDeleted = 0;
    let filesFailed = 0;
    for (const p of userPieces) {
      const filename = p.url?.split("/").pop();
      if (!filename) continue;
      try {
        fs.unlinkSync(path.join(UPLOADS_DIR, filename));
        filesDeleted++;
      } catch (err) {
        // ENOENT = déjà supprimé, on l'ignore ; tout autre code est tracé.
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`[rgpd] échec suppression ${filename}:`, err);
          filesFailed++;
        }
      }
    }

    await writeAudit(user.id, user.email, "account_deleted", req);
    // La cascade DB supprime dossiers → pieces → messages → notifications.
    // audit_logs.user_id est ON DELETE SET NULL (préservé pour la sécurité).
    await db.delete(users).where(eq(users.id, user.id));

    res.clearCookie(cookieNameFor(req), COOKIE_CLEAR_OPTIONS);
    res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
    res.json({ ok: true, files_deleted: filesDeleted, files_failed: filesFailed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.patch("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { prenom, nom, telephone } = req.body as { prenom?: string; nom?: string; telephone?: string };
    const update: Record<string, unknown> = { updated_at: new Date() };
    if (prenom?.trim()) update.prenom = prenom.trim();
    if (nom?.trim()) update.nom = nom.trim();
    if (telephone !== undefined) update.telephone = telephone?.trim() || null;
    const [updated] = await db.update(users).set(update).where(eq(users.id, req.user!.id)).returning();
    if (!updated) return res.status(404).json({ error: "Utilisateur non trouvé" });
    await writeAudit(req.user!.id, req.user!.email, "profile_update", req);
    res.json({ id: updated.id, email: updated.email, prenom: updated.prenom, nom: updated.nom, role: updated.role, commune: updated.commune, commune_insee: updated.commune_insee, telephone: updated.telephone, avatar_url: updated.avatar_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.patch("/me/password", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { current_password, new_password } = req.body as { current_password?: string; new_password?: string };
    if (!current_password || !new_password) return res.status(400).json({ error: "Mots de passe requis" });
    if (new_password.length < 8) return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 8 caractères" });
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Mot de passe actuel incorrect" });
    const password_hash = await bcrypt.hash(new_password, 10);
    await db.update(users).set({ password_hash, updated_at: new Date() }).where(eq(users.id, user.id));
    await writeAudit(user.id, user.email, "password_change", req);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    res.json({
      id: user.id,
      email: user.email,
      prenom: user.prenom,
      nom: user.nom,
      role: user.role,
      commune: user.commune,
      commune_insee: user.commune_insee,
      telephone: user.telephone,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Mot de passe oublié ──────────────────────────────────────────────────────
authRouter.post("/forgot-password", rateLimit({ windowMs: 15 * 60 * 1000, max: 5, legacyHeaders: false }), async (req: AuthRequest, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ error: "Email requis" });

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Always return 200 to avoid user enumeration
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.insert(password_tokens).values({ user_id: user.id, token, type: "reset", expires_at: expires });
    await sendPasswordResetEmail({ to: user.email, prenom: user.prenom, token }).catch(err => console.error("[mailer] reset:", err));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Vérification token (activation ou reset) ─────────────────────────────────
authRouter.get("/activate/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const [row] = await db.select({ id: password_tokens.id, type: password_tokens.type, user_id: password_tokens.user_id, email: users.email, prenom: users.prenom })
      .from(password_tokens)
      .leftJoin(users, eq(password_tokens.user_id, users.id))
      .where(and(eq(password_tokens.token, token), isNull(password_tokens.used_at), gt(password_tokens.expires_at, new Date())))
      .limit(1);
    if (!row) return res.status(400).json({ error: "Lien invalide ou expiré" });
    res.json({ valid: true, email: row.email, prenom: row.prenom, type: row.type });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Définir le mot de passe via token ────────────────────────────────────────
authRouter.post("/activate", rateLimit({ windowMs: 15 * 60 * 1000, max: 10, legacyHeaders: false }), async (req: AuthRequest, res) => {
  try {
    const { token, password } = req.body as { token?: string; password?: string };
    if (!token || !password) return res.status(400).json({ error: "Token et mot de passe requis" });
    if (password.length < 12) return res.status(400).json({ error: "Le mot de passe doit contenir au moins 12 caractères" });

    const [row] = await db.select().from(password_tokens)
      .where(and(eq(password_tokens.token, token), isNull(password_tokens.used_at), gt(password_tokens.expires_at, new Date())))
      .limit(1);
    if (!row) return res.status(400).json({ error: "Lien invalide ou expiré" });

    const password_hash = await bcrypt.hash(password, 10);
    await Promise.all([
      db.update(users).set({ password_hash }).where(eq(users.id, row.user_id)),
      db.update(password_tokens).set({ used_at: new Date() }).where(eq(password_tokens.id, row.id)),
    ]);

    const [user] = await db.select().from(users).where(eq(users.id, row.user_id)).limit(1);
    if (!user) return res.status(500).json({ error: "Erreur serveur" });

    const jwtToken = generateToken({ id: user.id, email: user.email, role: user.role, commune: user.commune ?? undefined, commune_insee: user.commune_insee ?? undefined });
    res.cookie(cookieNameFor(req), jwtToken, COOKIE_OPTIONS);
    res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
    await writeAudit(user.id, user.email, row.type === "activation" ? "account_activated" : "password_reset", req);
    res.json({ user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
