import { Router } from "express";
import { db } from "../../db.js";
import { dossiers } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requirePermission } from "../../middlewares/permissions.js";
import {
  runDossierConformityAnalysis,
  runDossierConformityAnalysisBackground,
  ConformityFinalPreconditionError,
  type ConformiteReport,
} from "../../services/dossierConformity.js";

export const conformiteRouter = Router();

conformiteRouter.get("/dossiers/:id/conformite", requirePermission("dossiers.read"), async (req: AuthRequest, res) => {
  try {
    const [row] = await db
      .select({
        analysis: dossiers.conformite_analysis,
        status: dossiers.conformite_status,
        analyzed_at: dossiers.conformite_analyzed_at,
      })
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Dossier non trouvé" });
    res.json({
      status: row.status ?? "absent",
      analyzed_at: row.analyzed_at,
      report: row.analysis as ConformiteReport | null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

conformiteRouter.post("/dossiers/:id/conformite/analyse", requirePermission("dossiers.instruct"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const [d] = await db.select({
      id: dossiers.id,
      status: dossiers.conformite_status,
    }).from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    if (!d) return res.status(404).json({ error: "Dossier non trouvé" });
    if (d.status === "running") {
      return res.status(409).json({ error: "Une analyse est déjà en cours pour ce dossier" });
    }

    const wantSync = req.body?.sync === true;
    if (wantSync) {
      const report = await runDossierConformityAnalysis(dossierId);
      return res.json({ status: "done", report });
    }
    // Marquage immédiat "pending" pour que l'UI sache que c'est lancé,
    // puis exécution en tâche de fond.
    await db
      .update(dossiers)
      .set({ conformite_status: "pending", updated_at: new Date() })
      .where(eq(dossiers.id, dossierId));
    runDossierConformityAnalysisBackground(dossierId);
    res.status(202).json({ status: "pending" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// Analyse de conformité FINALE (3.C.5b) — déclenchée explicitement par
// l'instructeur juste avant la délivrance de l'arrêté. Filtre les pièces
// à uniquement celles dont instructeur_status = 'valide'.
//
// Pré-conditions vérifiées par le service :
//   - aucune pièce sans statut (toutes examinées)
//   - aucun complément encore en attente
//   - au moins une pièce validée
// Sinon → 422 avec payload structuré listant les bloqueurs, l'UI peut
// pointer l'instructeur vers les pièces à statuer avant de relancer.
conformiteRouter.get("/dossiers/:id/conformite/finale", requirePermission("dossiers.read"), async (req: AuthRequest, res) => {
  try {
    const [row] = await db
      .select({
        analysis: dossiers.conformite_final_analysis,
        status: dossiers.conformite_final_status,
        analyzed_at: dossiers.conformite_final_analyzed_at,
        triggered_by: dossiers.conformite_final_triggered_by,
      })
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Dossier non trouvé" });
    res.json({
      status: row.status ?? "absent",
      analyzed_at: row.analyzed_at,
      triggered_by: row.triggered_by,
      report: row.analysis as ConformiteReport | null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

conformiteRouter.post("/dossiers/:id/conformite/finale", requirePermission("dossiers.instruct"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Authentification requise" });

    const [d] = await db.select({
      id: dossiers.id,
      status: dossiers.conformite_final_status,
    }).from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    if (!d) return res.status(404).json({ error: "Dossier non trouvé" });
    if (d.status === "running") {
      return res.status(409).json({ error: "Une analyse finale est déjà en cours pour ce dossier" });
    }

    // L'analyse finale est synchrone : l'instructeur attend le résultat avant
    // de cliquer sur "Délivrer l'arrêté", donc on bloque la requête HTTP.
    // Une analyse moyenne prend 30 s à 2 min, dans les délais raisonnables.
    const report = await runDossierConformityAnalysis(dossierId, {
      mode: "final",
      triggeredBy: userId,
    });
    res.json({ status: "done", report });
  } catch (err) {
    if (err instanceof ConformityFinalPreconditionError) {
      // 422 Unprocessable Entity : la requête est bien formée mais l'état
      // métier ne permet pas le traitement demandé. Payload structuré pour
      // que l'UI pointe les pièces à statuer.
      return res.status(422).json({
        error: err.reason,
        blockers: err.blockers,
      });
    }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});
