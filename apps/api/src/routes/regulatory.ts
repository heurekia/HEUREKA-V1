import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { dossiers, regulatory_analyses, regulatory_findings, dossier_facts, zone_regulatory_rules, zones, communes, document_segments, regulatory_documents } from "@heureka-v1/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { getCommuneScope, communeInScope } from "../middlewares/dossierAccess.js";
import { runAnalysis } from "@heureka-v1/regulatory-engine";
import { syncDossierFactsFromPieces } from "../services/dossierFacts.js";
import { enrichAnalysisCitations } from "../services/citationResolver.js";
import { EDITABLE_FACT_KEYS, isEditableKey } from "../services/dossierFactsAllowlist.js";
import { analyzeLimiter } from "../middlewares/rateLimiters.js";

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
  analyzeLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const dossierId = z.string().uuid().parse(req.params.dossierId);
      const owned = await loadOwnedDossier(req, res, dossierId);
      if (!owned) return;

      // Sync défensif : on remappe les extractions IA des pièces vers
      // dossier_facts juste avant l'analyse. Garantit que le moteur tourne
      // sur le contexte le plus à jour, même si la sync best-effort post-
      // upload a échoué pour une raison ou une autre.
      const factsSync = await syncDossierFactsFromPieces(dossierId).catch((err) => {
        console.warn("[regulatory] syncDossierFactsFromPieces a échoué (non bloquant):", err);
        return null;
      });

      const { analysis_id, run } = await runAnalysis(dossierId, {
        triggered_by: req.user!.id,
      });

      // Enrichissement best-effort : pour chaque finding, on tente de retrouver
      // dans l'index RAG le PASSAGE officiel correspondant au verbatim de la
      // règle (page réelle + type de document matchable par le viewer), avec
      // validation verbatim — pas de lien fabriqué. Une panne RAG ne bloque
      // pas l'analyse : les findings gardent leur verbatim affiché en texte.
      const citations_enriched = await enrichAnalysisCitations(analysis_id, dossierId, {
        dossierId,
        userId: req.user!.id,
      }).catch((err) => {
        console.warn("[regulatory] enrichAnalysisCitations a échoué (non bloquant):", err);
        return 0;
      });

      res.json({
        analysis_id,
        status: "done",
        summary: run.summary,
        findings_count: run.findings.length,
        facts_sync: factsSync,
        citations_enriched,
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

      // Faits actifs : on les renvoie avec l'analyse pour que l'UI puisse
      // afficher la provenance de chaque verdict sans aller-retour. La
      // colonne pdf_content / OCR brut N'EST PAS exposée ici — seulement
      // les métadonnées de fait (valeur, source, source_ref, confidence).
      // Phase 1 : on ne renvoie ici que les faits GAGNANTS. La table
      // contient désormais aussi des non-gagnants (candidats divergents)
      // pour alimenter le futur moteur de contradictions. L'UI règle des
      // verdicts ne doit voir qu'un fait par clé pour rester cohérente
      // avec l'historique. Un endpoint dédié remontera les conflits.
      const facts = await db
        .select({
          id: dossier_facts.id,
          key: dossier_facts.key,
          value: dossier_facts.value,
          unit: dossier_facts.unit,
          source: dossier_facts.source,
          source_ref: dossier_facts.source_ref,
          confidence: dossier_facts.confidence,
          validated_by: dossier_facts.validated_by,
          validated_at: dossier_facts.validated_at,
          created_at: dossier_facts.created_at,
        })
        .from(dossier_facts)
        .where(and(
          eq(dossier_facts.dossier_id, dossierId),
          isNull(dossier_facts.superseded_at),
          eq(dossier_facts.is_winner, true),
        ));

      res.json({ analysis, findings, facts });
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

// ── GET /api/regulatory/rules/:ruleId ──────────────────────────────
// Renvoie le detail d'une regle PLU validee (article complet + zone +
// commune). Pas de filtrage par scope commune sur cette route : une
// regle est publique au sens "n'importe quel instructeur authentifie
// peut lire le PLU" — ce sont les documents qui contiennent ces regles
// qui sont publiquement accessibles par ailleurs. Le filtrage par scope
// se fait sur les dossiers, pas sur les regles elles-memes.
regulatoryRouter.get(
  "/rules/:ruleId",
  requireRole(...INSTRUCTOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const ruleId = z.string().uuid().parse(req.params.ruleId);
      const [row] = await db
        .select({
          rule_id: zone_regulatory_rules.id,
          article_number: zone_regulatory_rules.article_number,
          article_title: zone_regulatory_rules.article_title,
          topic: zone_regulatory_rules.topic,
          sub_theme: zone_regulatory_rules.sub_theme,
          rule_text: zone_regulatory_rules.rule_text,
          summary: zone_regulatory_rules.summary,
          conditions: zone_regulatory_rules.conditions,
          exceptions: zone_regulatory_rules.exceptions,
          value_min: zone_regulatory_rules.value_min,
          value_max: zone_regulatory_rules.value_max,
          value_exact: zone_regulatory_rules.value_exact,
          unit: zone_regulatory_rules.unit,
          applies_if: zone_regulatory_rules.applies_if,
          citizen_title: zone_regulatory_rules.citizen_title,
          citizen_summary: zone_regulatory_rules.citizen_summary,
          instructor_note: zone_regulatory_rules.instructor_note,
          validation_status: zone_regulatory_rules.validation_status,
          zone_code: zones.zone_code,
          zone_label: zones.zone_label,
          commune_name: communes.name,
          commune_insee: communes.insee_code,
        })
        .from(zone_regulatory_rules)
        .innerJoin(zones, eq(zones.id, zone_regulatory_rules.zone_id))
        // leftJoin (et non innerJoin) : une zone de PLUi a commune_id = NULL ;
        // un innerJoin droperait la règle et renverrait un 404 à tort.
        .leftJoin(communes, eq(communes.id, zones.commune_id))
        .where(eq(zone_regulatory_rules.id, ruleId))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Règle introuvable" });
      res.json({ rule: row });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "ruleId invalide" });
      }
      console.error("[regulatory] get rule failed:", err);
      res.status(500).json({ error: "Lecture de la règle impossible" });
    }
  },
);

// ── GET /api/regulatory/segment/:segmentId ─────────────────────────
// Retrace un passage source à partir d'un SourceRef de type
// "document_segment" (présent dans finding.source_refs). Renvoie le texte
// du passage, sa page et le document officiel d'origine — de quoi rouvrir
// "le bon passage dans le bon document" côté UI ("PLU X, p. 42 : …").
// Même politique d'accès que /rules : un instructeur authentifié peut lire
// le règlement ; le filtrage par scope porte sur les dossiers, pas sur les
// règles/segments.
regulatoryRouter.get(
  "/segment/:segmentId",
  requireRole(...INSTRUCTOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      // Les ids de segment sont "{insee}_{doc_type}_{code}", pas des UUID.
      const segmentId = z.string().min(1).max(200).parse(req.params.segmentId);
      const [seg] = await db
        .select({
          segment_id: document_segments.id,
          doc_type: document_segments.doc_type,
          doc_source_file: document_segments.doc_source_file,
          doc_version: document_segments.doc_version,
          title: document_segments.title,
          raw_text: document_segments.raw_text,
          metadata: document_segments.metadata,
          commune_name: document_segments.commune_name,
          // Document officiel rapproché (FK explicite) si disponible.
          document_id: regulatory_documents.id,
          document_name: regulatory_documents.name,
          document_type: regulatory_documents.type,
          document_filename: regulatory_documents.original_filename,
        })
        .from(document_segments)
        // leftJoin : un segment pas encore rapproché (source_document_id NULL)
        // doit quand même renvoyer son texte et sa page.
        .leftJoin(regulatory_documents, eq(regulatory_documents.id, document_segments.source_document_id))
        .where(eq(document_segments.id, segmentId))
        .limit(1);
      if (!seg) return res.status(404).json({ error: "Passage introuvable" });

      // La page vit dans metadata.page (le RAG la préserve par chunk). On la
      // remonte à plat pour l'affichage de la citation.
      const meta = (seg.metadata ?? {}) as Record<string, unknown>;
      const page = typeof meta.page === "number" ? meta.page : null;

      res.json({
        segment: {
          segment_id: seg.segment_id,
          doc_type: seg.doc_type,
          title: seg.title,
          page,
          text: seg.raw_text,
          commune_name: seg.commune_name,
          // Nom officiel si rapproché, sinon le fichier source brut.
          document: seg.document_id
            ? { id: seg.document_id, name: seg.document_name, type: seg.document_type, filename: seg.document_filename }
            : { id: null, name: null, type: seg.doc_type, filename: seg.doc_source_file },
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "segmentId invalide" });
      }
      console.error("[regulatory] get segment failed:", err);
      res.status(500).json({ error: "Lecture du passage impossible" });
    }
  },
);

// ── PUT /api/regulatory/dossier/:dossierId/facts/:key ──────────────
// Pose ou remplace un fait par une saisie instructeur. Le fait précédent
// (s'il existe) est marqué superseded_at — l'historique n'est jamais
// écrasé. Le nouveau fait porte source='instructor_entry', confidence=1,
// validated_by=user, validated_at=now : c'est ce qui le protège contre
// l'écrasement par la sync automatique au prochain upload de pièce.
const FactPutSchema = z.object({
  value: z.unknown(),
  unit: z.string().max(20).optional(),
  comment: z.string().max(2000).optional(),
});

regulatoryRouter.put(
  "/dossier/:dossierId/facts/:key",
  requireRole(...INSTRUCTOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const dossierId = z.string().uuid().parse(req.params.dossierId);
      const owned = await loadOwnedDossier(req, res, dossierId);
      if (!owned) return;

      const key = req.params.key as string;
      if (!isEditableKey(key)) {
        return res.status(400).json({
          error: `Clé "${key}" non éditable.`,
          editable_keys: Object.keys(EDITABLE_FACT_KEYS),
        });
      }
      const body = FactPutSchema.parse(req.body);
      const spec = EDITABLE_FACT_KEYS[key]!;
      const valueCheck = spec.schema.safeParse(body.value);
      if (!valueCheck.success) {
        return res.status(400).json({
          error: `Valeur invalide pour "${key}". ${spec.hint}`,
          details: valueCheck.error.issues,
        });
      }

      const dossier_facts_mod = await import("@heureka-v1/db");
      const { dossier_facts: dfTable } = dossier_facts_mod;
      const now = new Date();

      // Superseder l'éventuel fait actif.
      await db
        .update(dfTable)
        .set({ superseded_at: now, updated_at: now })
        .where(and(eq(dfTable.dossier_id, dossierId), eq(dfTable.key, key), isNull(dfTable.superseded_at)));

      const [inserted] = await db
        .insert(dfTable)
        .values({
          dossier_id: dossierId,
          key,
          value: valueCheck.data as object,
          unit: body.unit ?? spec.defaultUnit ?? null,
          source: "instructor_entry",
          source_ref: { kind: "instructor_override", comment: body.comment ?? null } as object,
          confidence: 1,
          validated_by: req.user!.id,
          validated_at: now,
        })
        .returning();

      res.json({ fact: inserted });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "Requête invalide", details: err.issues });
      }
      console.error("[regulatory] put fact failed:", err);
      res.status(500).json({ error: "Mise à jour du fait impossible" });
    }
  },
);

// ── DELETE /api/regulatory/dossier/:dossierId/facts/:key ────────────
// Annule une saisie instructeur précédente. Marque l'override en
// superseded_at sans rien réinsérer — la prochaine sync (depuis pièces
// ou metadata) repeuplera la clé avec la valeur auto-extraite si elle
// existe. Ne touche PAS aux faits non-instructor (on ne supprime jamais
// une extraction automatique par cette route — seule la sync le fait).
regulatoryRouter.delete(
  "/dossier/:dossierId/facts/:key",
  requireRole(...INSTRUCTOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const dossierId = z.string().uuid().parse(req.params.dossierId);
      const owned = await loadOwnedDossier(req, res, dossierId);
      if (!owned) return;

      const key = req.params.key as string;
      if (!isEditableKey(key)) {
        return res.status(400).json({ error: `Clé "${key}" non éditable.` });
      }

      const dossier_facts_mod = await import("@heureka-v1/db");
      const { dossier_facts: dfTable } = dossier_facts_mod;
      const now = new Date();

      // Seul un instructor_entry actif peut être "retiré". Une extraction
      // auto n'est jamais supprimée par cette route — on remonte 404.
      const [active] = await db
        .select({ id: dfTable.id, source: dfTable.source })
        .from(dfTable)
        .where(and(eq(dfTable.dossier_id, dossierId), eq(dfTable.key, key), isNull(dfTable.superseded_at)))
        .limit(1);
      if (!active || active.source !== "instructor_entry") {
        return res.status(404).json({ error: "Aucune saisie instructeur à annuler sur cette clé." });
      }

      await db
        .update(dfTable)
        .set({ superseded_at: now, updated_at: now })
        .where(eq(dfTable.id, active.id));

      // Re-sync best-effort pour repeupler avec l'auto si disponible.
      try {
        await syncDossierFactsFromPieces(dossierId);
      } catch (e) {
        console.warn("[regulatory] post-revert sync failed:", e);
      }

      res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: "Requête invalide" });
      }
      console.error("[regulatory] delete fact failed:", err);
      res.status(500).json({ error: "Annulation du fait impossible" });
    }
  },
);
