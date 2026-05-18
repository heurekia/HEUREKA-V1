import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db.js";
import { users } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import { generateToken, requireAuth, type AuthRequest } from "../middlewares/auth.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  prenom: z.string().min(1),
  nom: z.string().min(1),
  role: z.enum(["citoyen", "mairie", "instructeur", "admin"]).default("citoyen"),
  commune: z.string().optional(),
  telephone: z.string().optional(),
});

authRouter.post("/register", async (req, res) => {
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
    res.status(201).json({
      token,
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

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email et mot de passe requis" });
    }
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }
    const token = generateToken({ id: user.id, email: user.email, role: user.role });
    res.json({
      token,
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, commune: user.commune },
    });
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
      telephone: user.telephone,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
