import { Router } from "express";
import { db } from "../db.js";
import { notifications, dossiers } from "@heureka-v1/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { getCommuneScope, communeScopeFilter } from "../middlewares/dossierAccess.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const communeParam = typeof req.query.commune === "string" ? req.query.commune.trim() : "";

    // Vue « commune » (onglet Paramètres › Notifications) : on regroupe les
    // notifications de TOUTE la ville, pas seulement celles de l'agent connecté.
    // Une même action de dossier génère une ligne par destinataire (cf.
    // notifyDossierAgents) : on déduplique donc sur l'événement
    // (dossier + type + titre + message + date) pour ne présenter qu'une entrée
    // par événement, quel que soit le nombre d'agents notifiés.
    if (communeParam) {
      const scope = await getCommuneScope(req.user!.id, req.user!.role);
      const filter = communeScopeFilter(sql`d.commune`, scope, communeParam);
      // - `id` : on privilégie la ligne de l'agent connecté (pour que « marquer
      //   lu » agisse sur SA notification), à défaut n'importe quelle ligne.
      // - `is_read` : reflète l'état de lecture personnel de l'agent — un
      //   événement adressé à d'autres agents (dossier assigné à un tiers)
      //   compte comme lu pour lui et n'alimente donc pas le badge « non lues ».
      const result = await db.execute(sql`
        SELECT
          (array_agg(n.id ORDER BY (n.user_id = ${req.user!.id}) DESC, n.id))[1] AS id,
          bool_and(CASE WHEN n.user_id = ${req.user!.id} THEN n.is_read ELSE true END) AS is_read,
          n.dossier_id,
          n.type,
          n.title,
          n.message,
          n.created_at,
          d.commune AS commune
        FROM notifications n
        JOIN dossiers d ON d.id = n.dossier_id
        WHERE ${filter}
        GROUP BY n.dossier_id, n.type, n.title, n.message, n.created_at, d.commune
        ORDER BY n.created_at DESC
        LIMIT 50
      `);
      const rows = (result as unknown as { rows?: unknown[] }).rows
        ?? (result as unknown as unknown[]);
      return res.json(Array.isArray(rows) ? rows : []);
    }

    // Vue personnelle (cloche) : uniquement les notifications de l'agent.
    // On joint le dossier lié pour exposer sa commune : l'UI s'en sert pour
    // basculer la commune active au clic et préfixer la notification du nom de
    // la ville (utile aux agents multi-communes).
    const list = await db
      .select({
        id: notifications.id,
        user_id: notifications.user_id,
        dossier_id: notifications.dossier_id,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        is_read: notifications.is_read,
        created_at: notifications.created_at,
        commune: dossiers.commune,
      })
      .from(notifications)
      .leftJoin(dossiers, eq(notifications.dossier_id, dossiers.id))
      .where(eq(notifications.user_id, req.user!.id))
      .orderBy(desc(notifications.created_at))
      .limit(50);
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

notificationsRouter.patch("/:id/read", async (req: AuthRequest, res) => {
  try {
    const [notif] = await db
      .update(notifications)
      .set({ is_read: true })
      .where(and(
        eq(notifications.id, req.params.id as string),
        eq(notifications.user_id, req.user!.id),
      ))
      .returning();
    if (!notif) return res.status(404).json({ error: "Notification non trouvée" });
    res.json(notif);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

notificationsRouter.patch("/read-all", async (req: AuthRequest, res) => {
  try {
    const communeParam = typeof req.query.commune === "string" ? req.query.commune.trim() : "";

    // Depuis l'onglet Paramètres › Notifications, « Tout marquer lu » ne doit
    // toucher que les notifications de l'agent rattachées à la commune affichée
    // (et dans son périmètre) — pas ses notifications des autres communes.
    if (communeParam) {
      const scope = await getCommuneScope(req.user!.id, req.user!.role);
      const filter = communeScopeFilter(sql`d.commune`, scope, communeParam);
      await db.execute(sql`
        UPDATE notifications AS n
           SET is_read = true
          FROM dossiers AS d
         WHERE d.id = n.dossier_id
           AND n.user_id = ${req.user!.id}
           AND n.is_read = false
           AND ${filter}
      `);
      return res.json({ success: true });
    }

    await db
      .update(notifications)
      .set({ is_read: true })
      .where(eq(notifications.user_id, req.user!.id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
