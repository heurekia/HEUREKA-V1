import { Router } from "express";
import { db } from "../db.js";
import { dossiers, users, notifications } from "@heureka-v1/db";
import { eq, desc, and, sql, like } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

export const mairieRouter = Router();

mairieRouter.use(requireAuth);
mairieRouter.use(requireRole("mairie", "instructeur", "admin"));

// ── Dashboard stats ──
mairieRouter.get("/dashboard", async (_req: AuthRequest, res) => {
  try {
    const total = await db.select({ count: sql<number>`count(*)` }).from(dossiers);
    const parStatut = await db
      .select({ status: dossiers.status, count: sql<number>`count(*)` })
      .from(dossiers)
      .groupBy(dossiers.status);

    const recent = await db
      .select()
      .from(dossiers)
      .orderBy(desc(dossiers.updated_at))
      .limit(10);

    const pendingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(dossiers)
      .where(sql`status NOT IN ('accepte', 'refuse', 'brouillon')`);

    res.json({
      total_dossiers: Number(total[0]?.count ?? 0),
      dossiers_par_statut: parStatut.map((r) => ({ status: r.status, count: Number(r.count) })),
      dossiers_recents: recent,
      en_cours: Number(pendingCount[0]?.count ?? 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste tous les dossiers (mairie) ──
mairieRouter.get("/dossiers", async (req: AuthRequest, res) => {
  try {
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    let query = db.select().from(dossiers).orderBy(desc(dossiers.created_at));
    let result;
    if (search) {
      const pattern = `%${search}%`;
      result = await db
        .select()
        .from(dossiers)
        .where(sql`(numero ILIKE ${pattern} OR adresse ILIKE ${pattern} OR parcelle ILIKE ${pattern} OR commune ILIKE ${pattern})`)
        .orderBy(desc(dossiers.created_at));
    } else if (status) {
      result = await db
        .select()
        .from(dossiers)
        .where(eq(dossiers.status, status as any))
        .orderBy(desc(dossiers.created_at));
    } else {
      result = await query;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Détail dossier mairie ──
mairieRouter.get("/dossiers/:id", async (req: AuthRequest, res) => {
  try {
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    const demandeur = await db
      .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
      .from(users)
      .where(eq(users.id, dossier.user_id))
      .limit(1);
    res.json({ ...dossier, demandeur: demandeur[0] ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Changer le statut d'un dossier ──
mairieRouter.patch("/dossiers/:id/status", async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Statut requis" });
    const [dossier] = await db
      .update(dossiers)
      .set({ status, updated_at: new Date() })
      .where(eq(dossiers.id, req.params.id as string))
      .returning();
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    res.json(dossier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Assigner un instructeur ──
mairieRouter.patch("/dossiers/:id/assign", async (req: AuthRequest, res) => {
  try {
    const { instructeur_id } = req.body;
    if (!instructeur_id) return res.status(400).json({ error: "instructeur_id requis" });
    const [dossier] = await db
      .update(dossiers)
      .set({ instructeur_id, updated_at: new Date() })
      .where(eq(dossiers.id, req.params.id as string))
      .returning();
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    res.json(dossier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Statistiques ──
mairieRouter.get("/stats", async (_req: AuthRequest, res) => {
  try {
    const total = await db.select({ count: sql<number>`count(*)` }).from(dossiers);
    const parType = await db
      .select({ type: dossiers.type, count: sql<number>`count(*)` })
      .from(dossiers)
      .groupBy(dossiers.type);
    const parMois = await db
      .select({
        mois: sql<string>`to_char(date_depot, 'YYYY-MM')`,
        count: sql<number>`count(*)`,
      })
      .from(dossiers)
      .where(sql`date_depot IS NOT NULL`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    res.json({
      total: Number(total[0]?.count ?? 0),
      par_type: parType,
      par_mois: parMois,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des instructeurs ──
mairieRouter.get("/instructeurs", async (_req: AuthRequest, res) => {
  try {
    const instructeurs = await db
      .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
      .from(users)
      .where(sql`role IN ('instructeur', 'mairie', 'admin')`);
    res.json(instructeurs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Notifications ──
mairieRouter.get("/notifications", async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(notifications)
      .where(eq(notifications.user_id, req.user!.id))
      .orderBy(desc(notifications.created_at))
      .limit(50);
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
