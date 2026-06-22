import { Router } from "express";
import { db } from "../../db.js";
import { dossiers, dossier_consultations, notifications, users } from "@heureka-v1/db";
import { eq, desc, sql } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { getCommuneScope, communeScopeFilter } from "../../middlewares/dossierAccess.js";

export const dashboardRouter = Router();

// ── Dashboard stats ──
dashboardRouter.get("/dashboard", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const scope = await getCommuneScope(req.user!.id, req.user!.role);
    const communeFilter = communeScopeFilter(sql`commune`, scope, commune);

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

// ── Délais légaux d'instruction par type (en jours) ──
// Référence : code de l'urbanisme R*423-23 et suivants.
const DELAIS_LEGAUX_JOURS: Record<string, number> = {
  permis_de_construire: 90,
  permis_de_construire_mi: 60,
  declaration_prealable: 30,
  permis_amenager: 90,
  permis_demolir: 60,
  permis_lotir: 90,
  certificat_urbanisme: 60,
  certificat_urbanisme_a: 30,
  certificat_urbanisme_b: 60,
};

const STATUTS_DECIDES = ["accepte", "refuse", "accord_prescription"] as const;

// ── Statistiques : vue d'ensemble + types ──
dashboardRouter.get("/stats", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const scope = await getCommuneScope(req.user!.id, req.user!.role);
    const cf = communeScopeFilter(sql`commune`, scope, commune);

    // KPIs agrégés
    const kpiRow = await db
      .select({
        traites: sql<number>`count(*) filter (where status IN ('accepte','refuse','accord_prescription'))`,
        acceptes: sql<number>`count(*) filter (where status = 'accepte')`,
        delai_moyen: sql<number>`avg(extract(epoch from (date_delivrance - date_depot)) / 86400) filter (where date_depot IS NOT NULL AND date_delivrance IS NOT NULL)`,
        en_retard: sql<number>`count(*) filter (where status NOT IN ('accepte','refuse','accord_prescription','brouillon') AND date_limite_instruction IS NOT NULL AND date_limite_instruction < now())`,
        total: sql<number>`count(*)`,
      })
      .from(dossiers)
      .where(cf);

    const k = kpiRow[0];
    const traites = Number(k?.traites ?? 0);
    const acceptes = Number(k?.acceptes ?? 0);
    const tauxAcceptation = traites > 0 ? Math.round((acceptes / traites) * 100) : null;
    const total = Number(k?.total ?? 0);
    const enRetard = Number(k?.en_retard ?? 0);

    // Par mois (12 derniers mois glissants)
    const parMois = await db
      .select({
        mois: sql<string>`to_char(date_depot, 'YYYY-MM')`,
        count: sql<number>`count(*)`,
      })
      .from(dossiers)
      .where(sql`date_depot IS NOT NULL AND date_depot >= now() - interval '12 months' AND (${cf})`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // Par type — count + accepted + refused + délai moyen
    const parType = await db
      .select({
        type: dossiers.type,
        count: sql<number>`count(*)`,
        acceptes: sql<number>`count(*) filter (where status = 'accepte')`,
        refuses: sql<number>`count(*) filter (where status = 'refuse')`,
        delai_moyen: sql<number>`avg(extract(epoch from (date_delivrance - date_depot)) / 86400) filter (where date_depot IS NOT NULL AND date_delivrance IS NOT NULL)`,
      })
      .from(dossiers)
      .where(cf)
      .groupBy(dossiers.type);

    // Résultats des décisions
    const decisions = await db
      .select({ status: dossiers.status, count: sql<number>`count(*)` })
      .from(dossiers)
      .where(sql`status IN ('accepte','refuse','accord_prescription') AND (${cf})`)
      .groupBy(dossiers.status);
    const totalDecisions = decisions.reduce((sum, d) => sum + Number(d.count), 0);

    res.json({
      kpis: {
        traites,
        acceptes,
        delai_moyen: k?.delai_moyen != null ? Math.round(Number(k.delai_moyen)) : null,
        taux_acceptation: tauxAcceptation,
        en_retard: enRetard,
        en_retard_pct: total > 0 ? Math.round((enRetard / total) * 100) : null,
        total,
      },
      par_mois: parMois.map((r) => ({ mois: r.mois, count: Number(r.count) })),
      par_type: parType.map((r) => ({
        type: r.type,
        count: Number(r.count),
        acceptes: Number(r.acceptes),
        refuses: Number(r.refuses),
        delai_moyen: r.delai_moyen != null ? Math.round(Number(r.delai_moyen)) : null,
      })),
      resultats_decisions: decisions.map((d) => ({
        status: d.status,
        count: Number(d.count),
        pct: totalDecisions > 0 ? Math.round((Number(d.count) / totalDecisions) * 100) : 0,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Statistiques : délais d'instruction ──
dashboardRouter.get("/stats/delais", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const scope = await getCommuneScope(req.user!.id, req.user!.role);
    const cf = communeScopeFilter(sql`commune`, scope, commune);

    // Délai moyen actuel par type
    const parType = await db
      .select({
        type: dossiers.type,
        delai_moyen: sql<number>`avg(extract(epoch from (date_delivrance - date_depot)) / 86400)`,
      })
      .from(dossiers)
      .where(sql`date_depot IS NOT NULL AND date_delivrance IS NOT NULL AND (${cf})`)
      .groupBy(dossiers.type);

    // Évolution sur 6 mois
    const evolution = await db
      .select({
        mois: sql<string>`to_char(date_delivrance, 'YYYY-MM')`,
        delai_moyen: sql<number>`avg(extract(epoch from (date_delivrance - date_depot)) / 86400)`,
      })
      .from(dossiers)
      .where(sql`date_depot IS NOT NULL AND date_delivrance IS NOT NULL AND date_delivrance >= now() - interval '6 months' AND (${cf})`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // Dossiers en retard avec pétitionnaire
    const enRetard = await db
      .select({
        id: dossiers.id,
        numero: dossiers.numero,
        type: dossiers.type,
        status: dossiers.status,
        date_depot: dossiers.date_depot,
        date_limite: dossiers.date_limite_instruction,
        prenom: users.prenom,
        nom: users.nom,
      })
      .from(dossiers)
      .leftJoin(users, eq(users.id, dossiers.user_id))
      .where(
        sql`status NOT IN ('accepte','refuse','accord_prescription','brouillon') AND date_limite_instruction IS NOT NULL AND date_limite_instruction < now() AND (${cf})`,
      )
      .orderBy(desc(sql`now() - date_limite_instruction`))
      .limit(20);

    res.json({
      delai_par_type: parType.map((r) => ({
        type: r.type,
        delai_moyen: r.delai_moyen != null ? Math.round(Number(r.delai_moyen)) : null,
        delai_legal: DELAIS_LEGAUX_JOURS[r.type] ?? null,
      })),
      evolution: evolution.map((r) => ({
        mois: r.mois,
        delai_moyen: r.delai_moyen != null ? Math.round(Number(r.delai_moyen)) : 0,
      })),
      en_retard: enRetard.map((r) => {
        const legal = DELAIS_LEGAUX_JOURS[r.type] ?? null;
        const ecoule = r.date_depot ? Math.floor((Date.now() - new Date(r.date_depot).getTime()) / 86400000) : null;
        const depassement = legal != null && ecoule != null ? ecoule - legal : null;
        return {
          id: r.id,
          numero: r.numero,
          type: r.type,
          petitionnaire: [r.prenom, r.nom].filter(Boolean).join(" ") || null,
          delai_legal: legal,
          delai_ecoule: ecoule,
          depassement,
          status: r.status,
        };
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Statistiques : services consultés ──
dashboardRouter.get("/stats/services", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const scope = await getCommuneScope(req.user!.id, req.user!.role);
    // Admin sans filtre = tout ; sinon on restreint via le dossier rattaché à
    // la consultation, en intersectant ?commune= avec le périmètre de l'agent.
    const cf = scope === null && !commune
      ? sql`1=1`
      : sql`exists(select 1 from dossiers d where d.id = dossier_consultations.dossier_id and (${communeScopeFilter(sql`d.commune`, scope, commune)}))`;

    const rows = await db
      .select({
        service: dossier_consultations.service_name,
        consultations: sql<number>`count(*)`,
        retours: sql<number>`count(*) filter (where date_reponse IS NOT NULL)`,
        en_attente: sql<number>`count(*) filter (where date_reponse IS NULL AND status = 'en_attente')`,
        delai_retour_moy: sql<number>`avg(extract(epoch from (date_reponse - date_envoi)) / 86400) filter (where date_reponse IS NOT NULL)`,
      })
      .from(dossier_consultations)
      .where(cf)
      .groupBy(dossier_consultations.service_name)
      .orderBy(sql`count(*) desc`);

    res.json(
      rows.map((r) => {
        const consultations = Number(r.consultations);
        const retours = Number(r.retours);
        return {
          name: r.service,
          consultations,
          retours,
          en_attente: Number(r.en_attente),
          delai_retour_moy: r.delai_retour_moy != null ? Math.round(Number(r.delai_retour_moy)) : null,
          taux_reponse: consultations > 0 ? Math.round((retours / consultations) * 100) : 0,
        };
      }),
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
