import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { dossiers, regulatory_analyses, regulatory_findings } from "@heureka-v1/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { getCommuneScope, communeInScope } from "../middlewares/dossierAccess.js";
import { runAnalysis } from "@heureka-v1/regulatory-engine";

export const regulatoryRouter = Router();
regulatoryRouter.use(requireAuth);

// Le moteur réglementaire est un outil d'aide à l'instruction : il n'est
// PAS exposé au citoyen. Les vues citoyen dérivées passeront par une autre
// route, qui projettera findings + règles via les champs citizen_*.
const INSTRUCTOR_ROLES = ["mairie", "instructeur", "admin"] as const;

async function loadOwnedDossier(req: AuthRequest, res: Response, dossierId: string) {
  const [row] = await db
    .select({ id: dossiers.id, commune: dossiers.commune })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Dossier introuvable" });
    return null;
  }
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(row.commune, scope)) {
    res.status(404).json({ error: "Dossier introuvable" });
    return null;
  }
  return row;
}

// ── POST /api/regulatory/analyze/:dossierId ─────────────────────────
// Lance une nouvelle analyse réglementaire sur le dossier. L'analyse
// précédente n'est PAS marquée obsolète automatiquement : c'est une
// action manuelle "valider cette analyse" qui le fera (sprint suivant).
regulatoryRouter.post(
  "/analyze/:dossierId",
  requireRole(...INSTRUCTOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const dossierId = z.string().uuid().parse(req.params.dossierId);
      const owned = await loadOwnedDossier(req, res, dossierId);
      if (!owned) return;

      const { analysis_id, run } = await runAnalysis(dossierId, {
        triggered_by: req.user!.id,
      });
      res.json({
        analysis_id,
        status: "done",
        summary: run.summary,
        findings_count: run.findings.length,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "dossierId invalide" });
      }
      console.error("[regulatory] runAnalysis failed:", err);
      res.status(500).json({ error: "Analyse réglementaire échouée" });
    }
  },
);

// ── GET /api/regulatory/dossier/:dossierId/latest ──────────────────
// Renvoie l'analyse la plus récente (n'importe quel statut) + ses
// findings. Si aucune analyse n'a encore été lancée, renvoie 204.
regulatoryRouter.get(
  "/dossier/:dossierId/latest",
  requireRole(...INSTRUCTOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const dossierId = z.string().uuid().parse(req.params.dossierId);
      const owned = await loadOwnedDossier(req, res, dossierId);
      if (!owned) return;

      const [analysis] = await db
        .select()
        .from(regulatory_analyses)
        .where(eq(regulatory_analyses.dossier_id, dossierId))
        .orderBy(desc(regulatory_analyses.created_at))
        .limit(1);
      if (!analysis) return res.status(204).end();

      const findings = await db
        .select()
        .from(regulatory_findings)
        .where(eq(regulatory_findings.analysis_id, analysis.id))
        .orderBy(desc(regulatory_findings.severity), desc(regulatory_findings.created_at));

      res.json({ analysis, findings });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "dossierId invalide" });
      }
      console.error("[regulatory] latest failed:", err);
      res.status(500).json({ error: "Lecture de l'analyse impossible" });
    }
  },
);

// ── POST /api/regulatory/findings/:findingId/decision ──────────────
// Capture la décision instructeur sur un finding (accepted | corrected
// | ignored) + un commentaire. C'est la boucle humaine qui alimentera
// l'apprentissage métier (palier 5) et l'audit trail.
const DecisionSchema = z.object({
  decision: z.enum(["accepted", "corrected", "ignored"]),
  comment: z.string().max(2000).optional(),
});

regulatoryRouter.post(
  "/findings/:findingId/decision",
  requireRole(...INSTRUCTOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const findingId = z.string().uuid().parse(req.params.findingId);
      const body = DecisionSchema.parse(req.body);

      // Vérifier que le finding existe et que le dossier rattaché est
      // dans le scope de l'instructeur. Sans ce check, n'importe quel
      // agent pourrait écrire sur n'importe quel finding.
      const [row] = await db
        .select({
          finding_id: regulatory_findings.id,
          dossier_id: regulatory_findings.dossier_id,
          commune: dossiers.commune,
        })
        .from(regulatory_findings)
        .innerJoin(dossiers, eq(dossiers.id, regulatory_findings.dossier_id))
        .where(eq(regulatory_findings.id, findingId))
        .limit(1);
      if (!row) {
        return res.status(404).json({ error: "Finding introuvable" });
      }
      const scope = await getCommuneScope(req.user!.id, req.user!.role);
      if (!communeInScope(row.commune, scope)) {
        return res.status(404).json({ error: "Finding introuvable" });
      }

      await db
        .update(regulatory_findings)
        .set({
          instructor_decision: body.decision,
          instructor_comment: body.comment ?? null,
          instructor_decided_by: req.user!.id,
          instructor_decided_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(regulatory_findings.id, findingId));

      res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "Requête invalide", details: err.issues });
      }
      console.error("[regulatory] decision failed:", err);
      res.status(500).json({ error: "Enregistrement de la décision impossible" });
    }
  },
);

// ── GET /api/regulatory/dossier/:dossierId/history ──────────────────
// Toutes les analyses du dossier, ordonnées de la plus récente à la
// plus ancienne. Sans les findings — utile pour un panneau d'audit.
regulatoryRouter.get(
  "/dossier/:dossierId/history",
  requireRole(...INSTRUCTOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const dossierId = z.string().uuid().parse(req.params.dossierId);
      const owned = await loadOwnedDossier(req, res, dossierId);
      if (!owned) return;

      const rows = await db
        .select({
          id: regulatory_analyses.id,
          status: regulatory_analyses.status,
          engine_version: regulatory_analyses.engine_version,
          ruleset_version: regulatory_analyses.ruleset_version,
          summary: regulatory_analyses.summary,
          triggered_by: regulatory_analyses.triggered_by,
          validated_by: regulatory_analyses.validated_by,
          validated_at: regulatory_analyses.validated_at,
          started_at: regulatory_analyses.started_at,
          finished_at: regulatory_analyses.finished_at,
          created_at: regulatory_analyses.created_at,
        })
        .from(regulatory_analyses)
        .where(eq(regulatory_analyses.dossier_id, dossierId))
        .orderBy(desc(regulatory_analyses.created_at));

      res.json({ analyses: rows });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "dossierId invalide" });
      }
      console.error("[regulatory] history failed:", err);
      res.status(500).json({ error: "Lecture de l'historique impossible" });
    }
  },
);
