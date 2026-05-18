import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { dossiers, dossier_messages, dossier_pieces_jointes, instruction_events, notifications } from "@heureka-v1/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import crypto from "crypto";

export const dossiersRouter = Router();

dossiersRouter.use(requireAuth);

// ── Lister mes dossiers ──
dossiersRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.user_id, req.user!.id))
      .orderBy(desc(dossiers.created_at));
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Détail d'un dossier ──
dossiersRouter.get("/:id", async (req: AuthRequest, res) => {
  try {
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(and(eq(dossiers.id, req.params.id as string), eq(dossiers.user_id, req.user!.id)))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    res.json(dossier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Créer un dossier ──
const createSchema = z.object({
  type: z.enum(["permis_de_construire", "declaration_prealable", "permis_amenager", "permis_demolir", "permis_lotir", "certificat_urbanisme"]),
  parcelle: z.string().optional(),
  adresse: z.string().optional(),
  commune: z.string().optional(),
  code_postal: z.string().optional(),
  description: z.string().optional(),
  surface_plancher: z.string().optional(),
});

dossiersRouter.post("/", async (req: AuthRequest, res) => {
  try {
    const data = createSchema.parse(req.body);
    const numero = `DOS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const [dossier] = await db
      .insert(dossiers)
      .values({ ...data, numero, user_id: req.user!.id })
      .returning();
    res.status(201).json(dossier);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: err.errors });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Messages d'un dossier ──
dossiersRouter.get("/:id/messages", async (req: AuthRequest, res) => {
  try {
    const messages = await db
      .select()
      .from(dossier_messages)
      .where(eq(dossier_messages.dossier_id, req.params.id as string))
      .orderBy(dossier_messages.created_at);
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

dossiersRouter.post("/:id/messages", async (req: AuthRequest, res) => {
  try {
    const content: string = req.body.content;
    if (!content) return res.status(400).json({ error: "Message requis" });
    const rows = await db
      .insert(dossier_messages)
      .values({
        dossier_id: req.params.id as string,
        from_user_id: req.user!.id,
        from_role: req.user!.role,
        content,
      })
      .returning();
    res.status(201).json(rows[0]!);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Pièces jointes ──
dossiersRouter.get("/:id/pieces", async (req: AuthRequest, res) => {
  try {
    const pieces = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.dossier_id, req.params.id as string))
      .orderBy(desc(dossier_pieces_jointes.uploaded_at));
    res.json(pieces);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Événements d'instruction ──
dossiersRouter.get("/:id/events", async (req: AuthRequest, res) => {
  try {
    const events = await db
      .select()
      .from(instruction_events)
      .where(eq(instruction_events.dossier_id, req.params.id as string))
      .orderBy(desc(instruction_events.created_at));
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
