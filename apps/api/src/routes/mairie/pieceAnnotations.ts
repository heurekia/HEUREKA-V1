import { Router } from "express";
import type { Response, NextFunction } from "express";
import { db } from "../../db.js";
import {
  dossier_pieces_jointes,
  dossier_piece_annotations,
  dossier_documents,
  instruction_events,
  PIECE_ANNOTATION_TOOLS,
  PIECE_ANNOTATION_VISIBILITIES,
  type PieceAnnotationTool,
  type PieceAnnotationVisibility,
} from "@heureka-v1/db";
import { eq, and, asc } from "drizzle-orm";
import multer from "multer";
import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requirePermission } from "../../middlewares/permissions.js";
import { getStorageProvider } from "../../services/storage.js";

export const pieceAnnotationsRouter = Router();

// Composite PNG/JPEG produit côté navigateur (la vue annotée aplatie). Mémoire
// + plafond aligné sur l'upload de pièces (60 Mo) pour absorber un plan en
// haute résolution.
const exportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/png|jpe?g/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Format d'export non supporté (PNG ou JPEG attendu)"));
  },
});
function exportUploadSingle(req: AuthRequest, res: Response, next: NextFunction) {
  exportUpload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "Fichier invalide" });
    }
    next();
  });
}

const TOOL_SET = new Set<string>(PIECE_ANNOTATION_TOOLS);
const VISIBILITY_SET = new Set<string>(PIECE_ANNOTATION_VISIBILITIES);

/** Charge une pièce en vérifiant qu'elle appartient bien au dossier de l'URL.
 *  Le scope commune est déjà garanti par enforceDossierAccess sur /dossiers/:id. */
async function loadPieceInDossier(dossierId: string, pieceId: string) {
  const [piece] = await db
    .select()
    .from(dossier_pieces_jointes)
    .where(and(
      eq(dossier_pieces_jointes.id, pieceId),
      eq(dossier_pieces_jointes.dossier_id, dossierId),
    ))
    .limit(1);
  return piece ?? null;
}

// ── Lister les annotations d'une pièce ──
pieceAnnotationsRouter.get("/dossiers/:id/pieces/:pieceId/annotations", requirePermission("pieces.read"), async (req: AuthRequest, res) => {
  try {
    const piece = await loadPieceInDossier(req.params.id as string, req.params.pieceId as string);
    if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });
    const rows = await db
      .select()
      .from(dossier_piece_annotations)
      .where(eq(dossier_piece_annotations.piece_id, piece.id))
      .orderBy(asc(dossier_piece_annotations.created_at));
    res.json(rows);
  } catch (err) {
    console.error("[piece-annotations:list]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Créer une annotation ──
pieceAnnotationsRouter.post("/dossiers/:id/pieces/:pieceId/annotations", requirePermission("pieces.annotate"), async (req: AuthRequest, res) => {
  try {
    const piece = await loadPieceInDossier(req.params.id as string, req.params.pieceId as string);
    if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });

    const b = (req.body ?? {}) as Record<string, unknown>;
    const tool = typeof b.tool === "string" ? b.tool : "";
    if (!TOOL_SET.has(tool)) {
      return res.status(400).json({ error: `tool invalide (attendu : ${PIECE_ANNOTATION_TOOLS.join(" | ")})` });
    }
    const visibility = typeof b.visibility === "string" && VISIBILITY_SET.has(b.visibility)
      ? (b.visibility as PieceAnnotationVisibility)
      : "interne";
    const page = Number.isFinite(b.page) ? Math.max(1, Math.trunc(b.page as number)) : 1;
    const comment = typeof b.comment === "string" && b.comment.trim() ? b.comment.trim().slice(0, 4000) : null;
    const geometry = b.geometry && typeof b.geometry === "object" ? b.geometry : {};
    const style = b.style && typeof b.style === "object" ? b.style : {};

    const [created] = await db
      .insert(dossier_piece_annotations)
      .values({
        dossier_id: piece.dossier_id,
        piece_id: piece.id,
        page,
        tool: tool as PieceAnnotationTool,
        geometry,
        style,
        comment,
        visibility,
        author_user_id: req.user?.id ?? null,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    console.error("[piece-annotations:create]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Modifier une annotation (géométrie, style, commentaire, visibilité) ──
pieceAnnotationsRouter.patch("/dossiers/:id/pieces/:pieceId/annotations/:annId", requirePermission("pieces.annotate"), async (req: AuthRequest, res) => {
  try {
    const piece = await loadPieceInDossier(req.params.id as string, req.params.pieceId as string);
    if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });

    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (b.geometry && typeof b.geometry === "object") patch.geometry = b.geometry;
    if (b.style && typeof b.style === "object") patch.style = b.style;
    if (b.comment !== undefined) {
      patch.comment = typeof b.comment === "string" && b.comment.trim() ? b.comment.trim().slice(0, 4000) : null;
    }
    if (typeof b.visibility === "string") {
      if (!VISIBILITY_SET.has(b.visibility)) {
        return res.status(400).json({ error: "visibility invalide (attendu : interne | citoyen)" });
      }
      patch.visibility = b.visibility;
    }
    if (Number.isFinite(b.page)) patch.page = Math.max(1, Math.trunc(b.page as number));

    const [updated] = await db
      .update(dossier_piece_annotations)
      .set(patch)
      .where(and(
        eq(dossier_piece_annotations.id, req.params.annId as string),
        eq(dossier_piece_annotations.piece_id, piece.id),
      ))
      .returning();
    if (!updated) return res.status(404).json({ error: "Annotation non trouvée" });
    res.json(updated);
  } catch (err) {
    console.error("[piece-annotations:patch]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Supprimer une annotation ──
pieceAnnotationsRouter.delete("/dossiers/:id/pieces/:pieceId/annotations/:annId", requirePermission("pieces.annotate"), async (req: AuthRequest, res) => {
  try {
    const piece = await loadPieceInDossier(req.params.id as string, req.params.pieceId as string);
    if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });
    const [deleted] = await db
      .delete(dossier_piece_annotations)
      .where(and(
        eq(dossier_piece_annotations.id, req.params.annId as string),
        eq(dossier_piece_annotations.piece_id, piece.id),
      ))
      .returning({ id: dossier_piece_annotations.id });
    if (!deleted) return res.status(404).json({ error: "Annotation non trouvée" });
    res.status(204).end();
  } catch (err) {
    console.error("[piece-annotations:delete]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Exporter la pièce annotée → document de la GED ──
// Le navigateur composite la vue (page PDF/image + calque SVG des marques
// visibles) en PNG, qu'il envoie ici. On l'emballe en PDF via pdf-lib (zéro
// dépendance raster serveur) et on l'enregistre dans la GED du dossier
// (category 'annotation'), prêt à être joint à un message ou un courrier.
pieceAnnotationsRouter.post(
  "/dossiers/:id/pieces/:pieceId/annotations/export",
  requirePermission("pieces.annotate"),
  exportUploadSingle,
  async (req: AuthRequest, res) => {
    const storage = getStorageProvider();
    let storedKey: string | null = null;
    try {
      const piece = await loadPieceInDossier(req.params.id as string, req.params.pieceId as string);
      if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });
      if (!req.file) return res.status(400).json({ error: "Image d'export requise" });

      const body = (req.body ?? {}) as Record<string, string>;
      const wantsPdf = (body.format ?? "pdf").toLowerCase() !== "png";

      let outBuffer: Buffer;
      let outMime: string;
      let outExt: string;
      if (wantsPdf) {
        const pdf = await PDFDocument.create();
        const img = req.file.mimetype.includes("png")
          ? await pdf.embedPng(req.file.buffer)
          : await pdf.embedJpg(req.file.buffer);
        // Page à la taille pixel de l'image → fidélité « tel que vu ».
        const page = pdf.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        outBuffer = Buffer.from(await pdf.save());
        outMime = "application/pdf";
        outExt = ".pdf";
      } else {
        outBuffer = req.file.buffer;
        outMime = req.file.mimetype;
        outExt = req.file.mimetype.includes("png") ? ".png" : ".jpg";
      }

      const fileKey = `${crypto.randomUUID()}${outExt}`;
      const stored = await storage.put({ key: fileKey, body: outBuffer, mime: outMime });
      storedKey = fileKey;

      const baseName = (body.nom ?? piece.nom ?? "Document").replace(/\.[a-z0-9]+$/i, "");
      const nom = `${baseName} — annoté`;
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : null;

      const [doc] = await db
        .insert(dossier_documents)
        .values({
          dossier_id: piece.dossier_id,
          nom,
          url: stored.url,
          type: outMime,
          taille: stored.size,
          category: "annotation",
          source_piece_id: piece.id,
          note,
          shared_with_citizen: false,
          created_by: req.user?.id ?? null,
        })
        .returning();

      // Trace dans la chronologie d'instruction (audit léger).
      try {
        await db.insert(instruction_events).values({
          dossier_id: piece.dossier_id,
          type: "piece_annotee_exportee",
          user_id: req.user?.id ?? null,
          description: `Export annoté enregistré dans la GED : ${nom}`,
          metadata: { piece_id: piece.id, document_id: doc?.id ?? null },
        });
      } catch (e) {
        console.warn("[piece-annotations:export] instruction_event:", e);
      }

      res.status(201).json(doc);
    } catch (err) {
      if (storedKey) { try { await storage.remove(storedKey); } catch { /* ignore */ } }
      console.error("[piece-annotations:export]", err);
      res.status(500).json({ error: "Erreur lors de l'export" });
    }
  },
);
