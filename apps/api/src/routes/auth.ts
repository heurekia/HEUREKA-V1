import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db } from "../db.js";
import { users, audit_logs } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import { generateToken, requireAuth, type AuthRequest } from "../middlewares/auth.js";

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
  role: z.enum(["citoyen", "mairie", "instructeur", "admin"]).default("citoyen"),
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
        role: data.role,
        commune: data.commune,
        telephone: data.telephone,
      })
      .returning();
    const user = rows[0]!;
    const token = generateToken({ id: user.id, email: user.email, role: user.role });
    res.cookie("token", token, COOKIE_OPTIONS);
    writeAudit(user.id, user.email, "register", req);
    res.status(201).json({
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, commune: user.commune },
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
    const token = generateToken({ id: user.id, email: user.email, role: user.role });
    res.cookie("token", token, COOKIE_OPTIONS);
    writeAudit(user.id, user.email, "login", req);
    res.json({
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, commune: user.commune },
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
      telephone: user.telephone,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
