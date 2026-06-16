import { Router } from "express";
import { db } from "../../db.js";
import { dossiers, dossier_consultations, notifications } from "@heureka-v1/db";
import { eq, desc, sql } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";

export const dashboardRouter = Router();

// ── Dashboard stats ──
dashboardRouter.get("/dashboard", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`commune ILIKE ${commune}` : sql`1=1`;

    const total = await db.select({ count: sql<number>`count(*)` }).from(dossiers).where(communeFilter);
    const parStatut = await db
      .select({ status: dossiers.status, count: sql<number>`count(*)` })
      .from(dossiers)
      .where(communeFilter)
      .groupBy(dossiers.status);

    const recent = await db
      .select()
      .from(dossiers)
      .where(communeFilter)
      .orderBy(desc(dossiers.updated_at))
      .limit(10);

    const pendingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(dossiers)
      .where(sql`status NOT IN ('accepte', 'refuse', 'brouillon') AND (${communeFilter})`);

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

// ── Statistiques ──
dashboardRouter.get("/stats", async (_req: AuthRequest, res) => {
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

    const delaiAgg = await db
      .select({
        avg: sql<number>`avg(extract(epoch from (date_delivrance - date_depot)) / 86400)`,
      })
      .from(dossiers)
      .where(sql`date_depot IS NOT NULL AND date_delivrance IS NOT NULL`);

    const conformiteAgg = await db
      .select({
        avg: sql<number>`avg((conformite_analysis->>'score_pct')::numeric)`,
      })
      .from(dossiers)
      .where(sql`conformite_analysis ? 'score_pct'`);

    const delaiMoyen = delaiAgg[0]?.avg != null ? Math.round(Number(delaiAgg[0].avg)) : null;
    const conformiteMoyenne = conformiteAgg[0]?.avg != null ? Math.round(Number(conformiteAgg[0].avg)) : null;

    res.json({
      total: Number(total[0]?.count ?? 0),
      par_type: parType.map((r) => ({ type: r.type, count: Number(r.count) })),
      par_mois: parMois.map((r) => ({ mois: r.mois, count: Number(r.count) })),
      delai_moyen: delaiMoyen,
      conformite_moyenne: conformiteMoyenne,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Statistiques : délais d'instruction ──
dashboardRouter.get("/stats/delais", async (_req: AuthRequest, res) => {
  try {
    const globalAgg = await db
      .select({
        avg: sql<number>`avg(extract(epoch from (date_delivrance - date_depot)) / 86400)`,
        total: sql<number>`count(*)`,
        sous_2_mois: sql<number>`count(*) filter (where (date_delivrance - date_depot) <= interval '60 days')`,
        hors_delai: sql<number>`count(*) filter (where date_limite_instruction IS NOT NULL AND date_delivrance > date_limite_instruction)`,
      })
      .from(dossiers)
      .where(sql`date_depot IS NOT NULL AND date_delivrance IS NOT NULL`);

    const row = globalAgg[0];
    const total = Number(row?.total ?? 0);
    const delaiMoyen = row?.avg != null ? Math.round(Number(row.avg)) : null;
    const sous2MoisPct = total > 0 ? Math.round((Number(row?.sous_2_mois ?? 0) / total) * 100) : null;
    const horsDelaiPct = total > 0 ? Math.round((Number(row?.hors_delai ?? 0) / total) * 100) : null;

    const evolution = await db
      .select({
        mois: sql<string>`to_char(date_delivrance, 'YYYY-MM')`,
        avg: sql<number>`avg(extract(epoch from (date_delivrance - date_depot)) / 86400)`,
      })
      .from(dossiers)
      .where(sql`date_depot IS NOT NULL AND date_delivrance IS NOT NULL`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    res.json({
      delai_moyen: delaiMoyen,
      sous_2_mois_pct: sous2MoisPct,
      hors_delai_pct: horsDelaiPct,
      evolution: evolution.map((r) => ({
        mois: r.mois,
        delai_moyen: r.avg != null ? Math.round(Number(r.avg)) : 0,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Statistiques : services consultés ──
dashboardRouter.get("/stats/services", async (_req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        service: dossier_consultations.service_name,
        consults: sql<number>`count(*)`,
        avg_jours: sql<number>`avg(extract(epoch from (date_reponse - date_envoi)) / 86400) filter (where date_reponse IS NOT NULL)`,
      })
      .from(dossier_consultations)
      .groupBy(dossier_consultations.service_name)
      .orderBy(sql`count(*) desc`);

    res.json(
      rows.map((r) => ({
        name: r.service,
        consults: Number(r.consults),
        avg_jours: r.avg_jours != null ? Number(Number(r.avg_jours).toFixed(1)) : null,
      })),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

dashboardRouter.get("/notifications", async (req: AuthRequest, res) => {
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
