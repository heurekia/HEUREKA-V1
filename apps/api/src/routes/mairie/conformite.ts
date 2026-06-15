import { Router } from "express";
import { db } from "../../db.js";
import { dossiers } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { runDossierConformityAnalysis, runDossierConformityAnalysisBackground, type ConformiteReport } from "../../services/dossierConformity.js";

export const conformiteRouter = Router();

conformiteRouter.get("/dossiers/:id/conformite", async (req: AuthRequest, res) => {
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

conformiteRouter.post("/dossiers/:id/conformite/analyse", async (req: AuthRequest, res) => {
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
