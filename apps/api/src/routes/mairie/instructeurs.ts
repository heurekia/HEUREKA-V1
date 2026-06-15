import { Router } from "express";
import { db } from "../../db.js";
import { users, user_availability, user_absences, user_delegations } from "@heureka-v1/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";

export const instructeursRouter = Router();

instructeursRouter.get("/instructeurs", async (_req: AuthRequest, res) => {
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

// ── Disponibilités ────────────────────────────────────────────────────────────

instructeursRouter.get("/my-availability", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const [avail] = await db.select().from(user_availability).where(eq(user_availability.user_id, userId)).limit(1);
    const absences = await db.select({
      id: user_absences.id,
      start_date: user_absences.start_date,
      end_date: user_absences.end_date,
      reason: user_absences.reason,
      note: user_absences.note,
      delegate_user_id: user_absences.delegate_user_id,
      delegate_prenom: users.prenom,
      delegate_nom: users.nom,
    })
      .from(user_absences)
      .leftJoin(users, eq(user_absences.delegate_user_id, users.id))
      .where(eq(user_absences.user_id, userId))
      .orderBy(user_absences.start_date);
    res.json({
      working_days: avail?.working_days ?? [1, 2, 3, 4, 5],
      start_time: avail?.start_time ?? "08:30",
      end_time: avail?.end_time ?? "17:30",
      absences,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

instructeursRouter.put("/my-availability", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { working_days, start_time, end_time } = req.body as { working_days: number[]; start_time: string; end_time: string };
    await db.insert(user_availability)
      .values({ user_id: userId, working_days, start_time, end_time, updated_at: new Date() })
      .onConflictDoUpdate({ target: user_availability.user_id, set: { working_days, start_time, end_time, updated_at: new Date() } });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

instructeursRouter.post("/my-absences", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { start_date, end_date, reason, note, delegate_user_id } = req.body as {
      start_date: string; end_date: string; reason?: string; note?: string; delegate_user_id?: string;
    };
    if (!start_date || !end_date) return res.status(400).json({ error: "start_date et end_date requis" });
    const [row] = await db.insert(user_absences)
      .values({ user_id: userId, start_date, end_date, reason: reason ?? "conges", note: note ?? null, delegate_user_id: delegate_user_id ?? null })
      .returning();
    res.status(201).json(row);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

instructeursRouter.delete("/my-absences/:id", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params as { id: string };
    await db.delete(user_absences).where(and(eq(user_absences.id, id), eq(user_absences.user_id, userId)));
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

// ── Délégations ──────────────────────────────────────────────────────────────
// Chaîne ordonnée des instructeurs qui prennent le relais pendant une absence.
// L'ordre dans la liste reçue détermine la priorité (1er = principal).

instructeursRouter.get("/my-delegations", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const rows = await db
      .select({
        id: user_delegations.id,
        delegate_user_id: user_delegations.delegate_user_id,
        priority: user_delegations.priority,
        prenom: users.prenom,
        nom: users.nom,
        email: users.email,
      })
      .from(user_delegations)
      .leftJoin(users, eq(user_delegations.delegate_user_id, users.id))
      .where(eq(user_delegations.user_id, userId))
      .orderBy(user_delegations.priority);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

instructeursRouter.put("/my-delegations", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { delegates } = req.body as { delegates: string[] };
    if (!Array.isArray(delegates)) {
      return res.status(400).json({ error: "delegates doit être un tableau d'UUID" });
    }
    // Pas d'auto-délégation ni de doublons.
    const seen = new Set<string>();
    const ordered = delegates.filter((d) => {
      if (typeof d !== "string" || !d) return false;
      if (d === userId) return false;
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    });

    if (ordered.length > 0) {
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, ordered), sql`role IN ('instructeur', 'mairie', 'admin')`));
      const validIds = new Set(found.map((r) => r.id));
      const filtered = ordered.filter((d) => validIds.has(d));
      if (filtered.length !== ordered.length) {
        return res.status(400).json({ error: "Un ou plusieurs délégués n'ont pas les droits d'instruction" });
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(user_delegations).where(eq(user_delegations.user_id, userId));
      if (ordered.length === 0) return;
      await tx.insert(user_delegations).values(
        ordered.map((delegate_user_id, idx) => ({
          user_id: userId,
          delegate_user_id,
          priority: idx + 1,
        })),
      );
    });

    const rows = await db
      .select({
        id: user_delegations.id,
        delegate_user_id: user_delegations.delegate_user_id,
        priority: user_delegations.priority,
        prenom: users.prenom,
        nom: users.nom,
        email: users.email,
      })
      .from(user_delegations)
      .leftJoin(users, eq(user_delegations.delegate_user_id, users.id))
      .where(eq(user_delegations.user_id, userId))
      .orderBy(user_delegations.priority);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});
