import { Router } from "express";
import { db } from "../db.js";
import { notifications } from "@heureka-v1/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req: AuthRequest, res) => {
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
