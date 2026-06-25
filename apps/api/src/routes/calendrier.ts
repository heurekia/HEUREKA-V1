import { Router } from "express";
import { db } from "../db.js";
import { calendarEvents } from "@heureka-v1/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { requirePermission } from "../middlewares/permissions.js";

export const calendrierRouter = Router();

calendrierRouter.use(requireAuth);

// ── Événements entre deux dates ──
calendrierRouter.get("/", requirePermission("calendrier"), async (req: AuthRequest, res) => {
  try {
    const { debut, fin } = req.query;
    // Filtrage strict par user_id : un utilisateur ne voit que ses propres
    // événements (RDV instructeur, échéances dossier qui le concernent…).
    const userFilter = eq(calendarEvents.user_id, req.user!.id);
    let events;
    if (debut && fin) {
      events = await db
        .select()
        .from(calendarEvents)
        .where(and(
          userFilter,
          gte(calendarEvents.date, new Date(debut as string)),
          lte(calendarEvents.date, new Date(fin as string)),
        ))
        .orderBy(calendarEvents.date);
    } else {
      events = await db
        .select()
        .from(calendarEvents)
        .where(userFilter)
        .orderBy(calendarEvents.date)
        .limit(100);
    }
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

calendrierRouter.post("/", requirePermission("calendrier"), async (req: AuthRequest, res) => {
  try {
    const { title, date, end_date, type, dossier_id, description, all_day } = req.body;
    if (!title || !date || !type) {
      return res.status(400).json({ error: "Titre, date et type requis" });
    }
    const [event] = await db
      .insert(calendarEvents)
      .values({ title, date: new Date(date), end_date: end_date ? new Date(end_date) : null, type, dossier_id, description, all_day: all_day ?? false, user_id: req.user!.id })
      .returning();
    res.status(201).json(event);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
