import { Router } from "express";
import { db } from "../../db.js";
import { dossier_pieces_jointes, instruction_events } from "@heureka-v1/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import fs from "fs";
import path from "path";
import multer from "multer";
import crypto from "crypto";
import { type AuthRequest } from "../../middlewares/auth.js";
import { autoAdvanceIfAllPiecesValid } from "../../services/dossierWorkflow.js";
import { extractPiece, expectedTypeFromCode } from "../../services/pieceExtractor.js";
import { getStorageProvider } from "../../services/storage.js";
import { archivePreviousComplementDemande } from "../../services/pieceArchive.js";
import { queuePieceOcr, notifyIfAlreadyComplete } from "../../services/pieceOcrQueue.js";
import { resolveCommuneIdFromUser, UPLOADS_DIR_MAIRIE } from "./_shared.js";
import { sql } from "drizzle-orm";

export const piecesRouter = Router();

// Multer en mémoire pour l'upload de pièces côté mairie (dépôt au comptoir).
// Plus permissif que le ocrUpload de dossiers.ts : on accepte aussi GIF/WEBP/
// TIFF (photos lointaines, scans en TIFF). Le sniff binaire en handler
// rejette les contenus qui ne correspondent pas à leur extension annoncée.
// Limite 60 Mo : alignée avec le message UI (MairieApp ~ "60 Mo") — couvre
// les scans haute résolution des pièces lourdes (plan masse, notice).
const pieceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf|jpe?g|png|gif|webp|tiff?/i;
    if (allowed.test(path.extname(file.originalname)) || allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Format non supporté (PDF, JPEG, PNG, GIF, WEBP, TIFF)"));
    }
  },
});

function sniffPieceType(buf: Buffer): "pdf" | "jpeg" | "png" | "gif" | "webp" | "tiff" | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 1024).includes("%PDF")) return "pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) return "tiff";
  if (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a) return "tiff";
  return null;
}

function pieceUploadSingle(req: AuthRequest, res: import("express").Response, next: import("express").NextFunction) {
  pieceUpload.single("file")(req, res, (err) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Fichier invalide";
      return res.status(400).json({ error: message });
    }
    next();
  });
}

piecesRouter.get("/dossiers/:id/pieces", async (req: AuthRequest, res) => {
  try {
    // Par défaut on masque les pièces archivées (remplacées suite à un
    // complément). L'UI peut explicitement demander les versions précédentes
    // via ?include_archived=1 pour reconstituer l'historique d'une rubrique.
    const includeArchived = req.query.include_archived === "1" || req.query.include_archived === "true";
    const conds = [eq(dossier_pieces_jointes.dossier_id, req.params.id as string)];
    if (!includeArchived) conds.push(isNull(dossier_pieces_jointes.archived_at));
    const pieces = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(and(...conds))
      .orderBy(desc(dossier_pieces_jointes.uploaded_at));
    res.json(pieces);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

piecesRouter.patch("/dossiers/:id/pieces/:pieceId/annotation", async (req: AuthRequest, res) => {
  try {
    const body = (req.body ?? {}) as { status?: string | null; note?: string | null };
    const VALID_STATUSES = new Set(["valide", "rejete", "complement_demande", null]);
    const rawStatus = body.status === undefined ? undefined : (body.status === "" ? null : body.status);
    const rawNote = body.note === undefined ? undefined : (body.note === null ? null : String(body.note));
    if (rawStatus !== undefined && !VALID_STATUSES.has(rawStatus as string | null)) {
      return res.status(400).json({ error: "Statut invalide" });
    }

    const [piece] = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(and(
        eq(dossier_pieces_jointes.id, req.params.pieceId as string),
        eq(dossier_pieces_jointes.dossier_id, req.params.id as string),
      ))
      .limit(1);
    if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });

    const statusChanged = rawStatus !== undefined && rawStatus !== piece.instructeur_status;
    const noteChanged = rawNote !== undefined && (rawNote ?? null) !== (piece.instructeur_note ?? null);
    if (!statusChanged && !noteChanged) {
      return res.json(piece);
    }

    const patch: Record<string, unknown> = {};
    if (rawStatus !== undefined) {
      patch.instructeur_status = rawStatus;
      patch.instructeur_status_at = new Date();
      patch.instructeur_status_by = req.user?.id ?? null;
    }
    if (rawNote !== undefined) {
      patch.instructeur_note = rawNote && rawNote.trim() ? rawNote.trim() : null;
    }

    const [updated] = await db
      .update(dossier_pieces_jointes)
      .set(patch)
      .where(eq(dossier_pieces_jointes.id, piece.id))
      .returning();

    // Trace dans la chronologie d'instruction.
    if (statusChanged && updated) {
      const TYPE_MAP: Record<string, string> = {
        valide: "piece_validee",
        rejete: "piece_rejetee",
        complement_demande: "piece_complement_demande",
      };
      const evType = rawStatus == null ? "piece_statut_efface" : (TYPE_MAP[rawStatus as string] ?? "piece_statut_modifie");
      const DESC_MAP: Record<string, string> = {
        valide: `Pièce validée : ${updated.nom}`,
        rejete: `Pièce rejetée : ${updated.nom}`,
        complement_demande: `Complément demandé pour : ${updated.nom}`,
      };
      const description = rawStatus == null
        ? `Statut effacé pour : ${updated.nom}`
        : (DESC_MAP[rawStatus as string] ?? `Pièce mise à jour : ${updated.nom}`);
      await db.insert(instruction_events).values({
        dossier_id: piece.dossier_id,
        type: evType,
        user_id: req.user?.id ?? null,
        description,
        metadata: {
          piece_id: piece.id,
          code_piece: piece.code_piece ?? null,
          previous_status: piece.instructeur_status ?? null,
          new_status: rawStatus ?? null,
          note: rawNote ?? piece.instructeur_note ?? null,
        },
      });
    }

    // Auto-bascule pre_instruction → en_instruction si la dernière pièce
    // restante vient d'être validée. Best-effort : on n'échoue jamais la
    // route d'annotation pour un problème de transition.
    if (statusChanged && rawStatus === "valide") {
      try {
        await autoAdvanceIfAllPiecesValid(piece.dossier_id, req.user?.id ?? null);
      } catch (e) {
        console.warn("[pieces/annotation] autoAdvance:", e);
      }
    }

    res.json(updated);
  } catch (err) {
    console.error("[pieces/annotation]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Upload d'une pièce sur un dossier créé au comptoir (mairie) ──
// Pendant côté mairie du POST /api/dossiers/:id/pieces/upload citoyen. Permet
// à l'opérateur d'attacher les pièces (plans, notice, photos, etc.) qu'il
// vient de scanner avec le CERFA. La pièce est rattachée à l'utilisateur
// propriétaire du dossier (le placeholder pétitionnaire le cas échéant), et
// les analyses IA tournent sans demander de consentement explicite : c'est
// l'opérateur mairie qui a sciemment numérisé et déposé le document.
//
// Performance : l'OCR (analyzePiece + extractPiece) est délégué à un worker
// en arrière-plan via queuePieceOcr — la route rend la main immédiatement
// après la persistance de la pièce pour ne pas laisser l'agent attendre
// devant le pétitionnaire. La notification "dossier prêt" est envoyée à
// l'instructeur quand toutes les pièces ont été traitées ET que l'agent a
// finalisé sa session via POST /finalize-upload-session.
piecesRouter.post("/dossiers/:id/pieces/upload", pieceUploadSingle, async (req: AuthRequest, res) => {
  const storage = getStorageProvider();
  const fileKey = req.file
    ? `${crypto.randomUUID()}${path.extname(req.file.originalname)}`
    : null;
  try {
    if (!req.file || !fileKey) return res.status(400).json({ error: "Fichier requis" });

    if (sniffPieceType(req.file.buffer) === null) {
      return res.status(400).json({ error: "Le contenu du fichier ne correspond pas à un format supporté (PDF, JPEG, PNG, GIF, WEBP, TIFF)" });
    }

    const dossierId = req.params.id as string;
    const dossier = (req as AuthRequest & { dossier?: { id: string; user_id: string; commune: string | null } }).dossier;
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const code_piece = (req.body as Record<string, string>).code_piece ?? "";
    const nom_piece = (req.body as Record<string, string>).nom_piece ?? req.file.originalname;

    const stored = await storage.put({
      key: fileKey,
      body: req.file.buffer,
      mime: req.file.mimetype,
    });

    const [piece] = await db
      .insert(dossier_pieces_jointes)
      .values({
        dossier_id: dossierId,
        // Le user_id de la pièce reflète le propriétaire du dossier, pas
        // l'agent mairie : cohérent avec la lecture côté citoyen et avec le
        // garde-fou IDOR (le pétitionnaire pourra voir/télécharger sa pièce
        // s'il active son compte ultérieurement).
        user_id: dossier.user_id,
        nom: nom_piece,
        url: stored.url,
        type: req.file.mimetype,
        taille: req.file.size,
        code_piece: code_piece || null,
        ocr_status: "pending",
      })
      .returning();

    // Comptoir mairie : si l'agent redépose une pièce pour le compte du
    // pétitionnaire en réponse à un complément demandé, on archive l'ancienne
    // version pour la sortir de la liste d'instruction principale.
    if (piece) {
      try {
        await archivePreviousComplementDemande({
          dossier_id: dossierId,
          code_piece: code_piece || null,
          new_piece_nom: nom_piece,
          new_piece_id: piece.id,
          user_id: req.user?.id ?? null,
        });
      } catch (e) {
        console.warn("[mairie/pieces/upload] archivePreviousComplementDemande:", e);
      }
    }

    // Démarre une nouvelle session d'upload : si l'agent rajoute des pièces
    // après une finalisation précédente, on remet le compteur à zéro pour que
    // la prochaine notification reparte sur du frais.
    try {
      await db.execute(sql`
        UPDATE dossiers
           SET metadata = (coalesce(metadata, '{}'::jsonb))
                          - 'mairie_pieces_upload_finalized'
                          - 'mairie_pieces_ocr_notified_at'
         WHERE id = ${dossierId}
      `);
    } catch (e) {
      console.warn("[mairie/pieces/upload] reset session metadata:", e);
    }

    // OCR asynchrone : on délègue au worker et on rend la main tout de suite.
    // L'agent verra dans l'UI l'état "analyse en cours" et recevra la
    // notification "dossier prêt" quand toutes les pièces seront traitées.
    if (piece) {
      const communeIdForTrace = await resolveCommuneIdFromUser(req);
      queuePieceOcr({
        pieceId: piece.id,
        dossierId,
        fileBuffer: req.file.buffer,
        mimeType: req.file.mimetype,
        nom_piece,
        code_piece,
        trace: { dossierId, userId: req.user?.id ?? null, communeId: communeIdForTrace },
      });
    }

    res.status(201).json({ ...piece, analyse_ia: null, extraction_ia: null, ai_processed: false, ocr_status: "pending" });
  } catch (err) {
    if (fileKey) {
      try { await storage.remove(fileKey); } catch { /* ignore */ }
    }
    console.error("[mairie/pieces/upload]", err);
    res.status(500).json({ error: "Erreur upload" });
  }
});

// Marque la fin de la session d'upload côté agent. Tant que cet appel n'a pas
// eu lieu, aucune notification "dossier prêt" n'est envoyée : ça évite que la
// cloche sonne entre la pièce 1 (déjà OCRisée) et la pièce 2 (pas encore
// uploadée par l'agent). Si toutes les pièces sont déjà passées par le
// worker au moment de l'appel, la notification part immédiatement.
piecesRouter.post("/dossiers/:id/pieces/finalize-upload-session", async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const dossier = (req as AuthRequest & { dossier?: { id: string; user_id: string } }).dossier;
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    await db.execute(sql`
      UPDATE dossiers
         SET metadata = jsonb_set(
               coalesce(metadata, '{}'::jsonb),
               '{mairie_pieces_upload_finalized}',
               'true'::jsonb,
               true
             )
       WHERE id = ${dossierId}
    `);

    // Si l'OCR de toutes les pièces est déjà terminé, on notifie tout de
    // suite. Sinon, c'est le worker qui déclenchera la notification à la fin
    // de la dernière pièce.
    await notifyIfAlreadyComplete(dossierId);

    // Renvoie un statut synthétique pour l'UI : combien de pièces sont encore
    // en cours d'analyse, combien sont prêtes. L'agent peut afficher un
    // récapitulatif "X/Y pièces analysées — vous serez notifié à la fin".
    const counts = await db
      .select({ status: dossier_pieces_jointes.ocr_status, id: dossier_pieces_jointes.id })
      .from(dossier_pieces_jointes)
      .where(and(
        eq(dossier_pieces_jointes.dossier_id, dossierId),
        isNull(dossier_pieces_jointes.archived_at),
      ));
    const summary = counts.reduce(
      (acc, r) => {
        const k = (r.status ?? "pending") as keyof typeof acc;
        if (k in acc) acc[k] += 1;
        return acc;
      },
      { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 },
    );
    const total = counts.length;
    const remaining = summary.pending + summary.processing;
    res.json({ total, remaining, summary });
  } catch (err) {
    console.error("[mairie/pieces/finalize-upload-session]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

piecesRouter.post("/dossiers/:id/pieces/:pieceId/extract", async (req: AuthRequest, res) => {
  try {
    const [piece] = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(and(
        eq(dossier_pieces_jointes.id, req.params.pieceId as string),
        eq(dossier_pieces_jointes.dossier_id, req.params.id as string),
      ))
      .limit(1);
    if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });

    const filename = piece.url.split("/").pop();
    if (!filename) return res.status(404).json({ error: "Fichier non localisable" });
    const filePath = path.join(UPLOADS_DIR_MAIRIE, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Fichier non trouvé sur le disque" });

    const communeIdForPiece = await resolveCommuneIdFromUser(req);
    const extraction = await extractPiece(filePath, piece.type, {
      expected_type: expectedTypeFromCode(piece.code_piece),
      nom_piece: piece.nom,
      code_piece: piece.code_piece ?? "",
    }, { dossierId: req.params.id as string, userId: req.user?.id ?? null, communeId: communeIdForPiece });
    if (!extraction) {
      return res.status(422).json({ error: "Extraction impossible (format non supporté ou fichier trop volumineux)" });
    }

    await db
      .update(dossier_pieces_jointes)
      .set({ extraction_ia: extraction })
      .where(eq(dossier_pieces_jointes.id, piece.id));

    res.json(extraction);
  } catch (err) {
    console.error("[pieces/extract]", err);
    res.status(500).json({ error: "Erreur serveur lors de l'extraction" });
  }
});
