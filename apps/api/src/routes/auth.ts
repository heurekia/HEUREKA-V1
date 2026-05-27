import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db } from "../db.js";
import { users, audit_logs, dossiers, dossier_messages, dossier_pieces_jointes, notifications, password_tokens } from "@heureka-v1/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { generateToken, requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { sendPasswordResetEmail } from "../services/mailer.js";
import crypto from "crypto";

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

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "strict" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: "/",
};

function clientIp(req: AuthRequest): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
}

function writeAudit(userId: string | null, email: string, action: string, req: AuthRequest) {
  db.insert(audit_logs).values({
    user_id: userId ?? undefined,
    email,
    action,
    ip: clientIp(req),
    user_agent: req.headers["user-agent"] ?? null,
  }).catch(() => {});
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
    res.cookie("token", token, COOKIE_OPTIONS);
    writeAudit(user.id, user.email, "register", req);
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
      writeAudit(null, email, "login_failed", req);
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      writeAudit(null, email, "login_failed", req);
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }
    const token = generateToken({ id: user.id, email: user.email, role: user.role, commune: user.commune ?? undefined, commune_insee: user.commune_insee ?? undefined });
    res.cookie("token", token, COOKIE_OPTIONS);
    writeAudit(user.id, user.email, "login", req);
    res.json({
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, commune: user.commune, commune_insee: user.commune_insee },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.post("/logout", requireAuth, (req: AuthRequest, res) => {
  writeAudit(req.user!.id, req.user!.email, "logout", req);
  res.clearCookie("token", { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me/export", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const [[user], userDossiers, messages, pieces, notifs] = await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      db.select().from(dossiers).where(eq(dossiers.user_id, userId)),
      db.select().from(dossier_messages).where(eq(dossier_messages.from_user_id, userId)),
      db.select().from(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.user_id, userId)),
      db.select().from(notifications).where(eq(notifications.user_id, userId)),
    ]);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });

    const payload = {
      export_date: new Date().toISOString(),
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
      dossiers: userDossiers,
      messages,
      documents: pieces,
      notifications: notifs,
    };

    res.setHeader("Content-Disposition", `attachment; filename="mes-donnees-heureka-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader("Content-Type", "application/json");
    writeAudit(userId, user.email, "data_export", req);
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

    writeAudit(user.id, user.email, "account_deleted", req);
    await db.delete(users).where(eq(users.id, user.id));

    res.clearCookie("token", { path: "/" });
    res.json({ ok: true });
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
    writeAudit(req.user!.id, req.user!.email, "profile_update", req);
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
    writeAudit(user.id, user.email, "password_change", req);
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
    res.cookie("token", jwtToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", maxAge: 7 * 24 * 60 * 60 * 1000, path: "/" });
    writeAudit(user.id, user.email, row.type === "activation" ? "account_activated" : "password_reset", req);
    res.json({ user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
