import { Router } from "express";
import { db } from "../../db.js";
import { dossier_pieces_jointes, dossier_piece_bundles, instruction_events } from "@heureka-v1/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import path from "path";
import multer from "multer";
import crypto from "crypto";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requirePermission } from "../../middlewares/permissions.js";
import { autoAdvanceIfAllPiecesValid } from "../../services/dossierWorkflow.js";
import { extractPiece, expectedTypeFromCode, codeFromType, defaultPieceName, type PieceType } from "../../services/pieceExtractor.js";
import { getStorageProvider } from "../../services/storage.js";
import { archivePreviousComplementDemande } from "../../services/pieceArchive.js";
import { queuePieceOcr, notifyIfAlreadyComplete } from "../../services/pieceOcrQueue.js";
import { segmentBundle, applySegmentation, type SegmentationResult, type ApplySegmentInput } from "../../services/pieceSegmenter.js";
import { resolveCommuneIdFromUser } from "./_shared.js";
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

piecesRouter.get("/dossiers/:id/pieces", requirePermission("documents"), async (req: AuthRequest, res) => {
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

piecesRouter.patch("/dossiers/:id/pieces/:pieceId/annotation", requirePermission("dossiers.instruct"), async (req: AuthRequest, res) => {
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
piecesRouter.post("/dossiers/:id/pieces/upload", requirePermission("dossiers.instruct"), pieceUploadSingle, async (req: AuthRequest, res) => {
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

    // Conversion compat PDF en arrière-plan si JPEG 2000 détecté
    // (incompatible avec le décodeur pdf.js du viewer mairie).
    const compatSourceBuffer = req.file.buffer;
    const compatSourceMime = req.file.mimetype;
    void (async () => {
      try {
        const { maybeBuildCompatPdf, compatKeyFor } = await import("../../services/pdfCompat.js");
        const compatBuf = await maybeBuildCompatPdf(compatSourceBuffer, compatSourceMime);
        if (!compatBuf) return;
        await storage.put({ key: compatKeyFor(fileKey), body: compatBuf, mime: "application/pdf" });
        console.log(`[pdf-compat] généré pour ${fileKey} (${compatBuf.length} octets)`);
      } catch (err) {
        console.warn(`[pdf-compat] échec pour ${fileKey} : ${err instanceof Error ? err.message : err}`);
      }
    })();

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
piecesRouter.post("/dossiers/:id/pieces/finalize-upload-session", requirePermission("dossiers.instruct"), async (req: AuthRequest, res) => {
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

piecesRouter.post("/dossiers/:id/pieces/:pieceId/extract", requirePermission("dossiers.instruct"), async (req: AuthRequest, res) => {
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

    const storage = getStorageProvider();
    let fileBuffer: Buffer;
    try {
      fileBuffer = await storage.getBuffer(storage.keyFromUrl(piece.url));
    } catch (err) {
      console.warn("[pieces/extract] fichier introuvable dans le storage:", err);
      return res.status(404).json({ error: "Fichier non trouvé dans le stockage" });
    }

    const communeIdForPiece = await resolveCommuneIdFromUser(req);
    const extraction = await extractPiece(fileBuffer, piece.type, {
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

// ════════════════════════════════════════════════════════════════════════════
// Dépôt groupé : un seul PDF déposé → éclaté en plusieurs pièces.
//
// IMPORTANT : flux 100 % additif. La route /pieces/upload (1 fichier = 1 pièce)
// reste l'unique chemin par défaut et n'est jamais modifiée. Ici, l'agent dépose
// un dossier complet en UN PDF : le système propose un découpage, l'instructeur
// le valide/corrige, PUIS les pièces sont créées (et repassent dans l'OCR).
// ════════════════════════════════════════════════════════════════════════════

const PIECE_TYPES = new Set<PieceType>([
  "cerfa", "plan_situation", "plan_masse", "plan_coupe",
  "plan_facade", "notice", "photo", "insertion", "autre",
]);

// Normalise/valide les segments (potentiellement édités par l'instructeur)
// reçus du front avant application. Robuste aux entrées partielles.
function sanitizeSegments(raw: unknown[], dossierType: string | null): ApplySegmentInput[] {
  const out: ApplySegmentInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const pages = Array.isArray(s.pages)
      ? [...new Set(s.pages.map((p) => Number(p)).filter((p) => Number.isInteger(p) && p >= 1))].sort((a, b) => a - b)
      : [];
    if (pages.length === 0) continue;
    const type: PieceType = PIECE_TYPES.has(s.type as PieceType) ? (s.type as PieceType) : "autre";
    let code: string | null;
    if (s.code === null || s.code === "") code = null;
    else if (typeof s.code === "string") code = s.code.toUpperCase().trim().slice(0, 16);
    else code = codeFromType(type, dossierType); // dérivé si non fourni
    const nom = typeof s.nom === "string" && s.nom.trim()
      ? s.nom.trim().slice(0, 200)
      : defaultPieceName(code, type, pages);
    const confidence = typeof s.confidence === "number" ? s.confidence : null;
    out.push({ code, type, pages, nom, confidence });
  }
  return out;
}

// ── Dépôt d'un dossier complet en un seul PDF (segmentation asynchrone) ──────
piecesRouter.post("/dossiers/:id/pieces/upload-bundle", requirePermission("dossiers.instruct"), pieceUploadSingle, async (req: AuthRequest, res) => {
  const storage = getStorageProvider();
  const fileKey = req.file
    ? `${crypto.randomUUID()}${path.extname(req.file.originalname)}`
    : null;
  try {
    if (!req.file || !fileKey) return res.status(400).json({ error: "Fichier requis" });
    const sniffed = sniffPieceType(req.file.buffer);
    if (sniffed === null) {
      return res.status(400).json({ error: "Le contenu du fichier ne correspond pas à un format supporté" });
    }
    // L'éclatement ne concerne que les PDF (multi-pages). Une image seule n'a
    // rien à découper → on renvoie vers l'upload de pièce classique.
    if (sniffed !== "pdf") {
      return res.status(400).json({ error: "Le dépôt groupé attend un PDF. Pour une image seule, utilisez l'upload de pièce classique." });
    }

    const dossierId = req.params.id as string;
    const dossier = (req as AuthRequest & { dossier?: { id: string; user_id: string; type: string; commune: string | null } }).dossier;
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const nom = (req.body as Record<string, string>).nom_piece ?? req.file.originalname;
    const stored = await storage.put({ key: fileKey, body: req.file.buffer, mime: req.file.mimetype });

    const [bundle] = await db
      .insert(dossier_piece_bundles)
      .values({
        dossier_id: dossierId,
        user_id: req.user?.id ?? null,
        nom,
        url: stored.url,
        storage_key: stored.key,
        type: req.file.mimetype,
        taille: req.file.size,
        status: "segmenting",
      })
      .returning();
    if (!bundle) return res.status(500).json({ error: "Création du bundle impossible" });

    // Segmentation en arrière-plan (appel LLM long, jusqu'à plusieurs dizaines
    // de secondes) : on rend la main immédiatement. Le front interroge
    // GET .../bundles/:id jusqu'à status = pending_review (ou failed).
    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const dossierType = dossier.type;
    const communeId = await resolveCommuneIdFromUser(req);
    const userId = req.user?.id ?? null;
    void (async () => {
      try {
        const result = await segmentBundle(buffer, mimeType, dossierType, { dossierId, communeId, userId });
        await db.update(dossier_piece_bundles).set({
          status: "pending_review",
          page_count: result.page_count,
          proposed_segments: result,
          segmented_at: new Date(),
        }).where(eq(dossier_piece_bundles.id, bundle.id));
      } catch (err) {
        console.error("[mairie/pieces/upload-bundle] segmentation:", err instanceof Error ? `${err.name}: ${err.message}` : err);
        await db.update(dossier_piece_bundles).set({
          status: "failed",
          error: err instanceof Error ? err.message.slice(0, 300) : "Échec de la segmentation",
        }).where(eq(dossier_piece_bundles.id, bundle.id)).catch(() => { /* best-effort */ });
      }
    })();

    res.status(201).json({ bundle_id: bundle.id, status: "segmenting" });
  } catch (err) {
    if (fileKey) {
      try { await storage.remove(fileKey); } catch { /* ignore */ }
    }
    console.error("[mairie/pieces/upload-bundle]", err);
    res.status(500).json({ error: "Erreur upload" });
  }
});

// ── Récupère un bundle (statut + proposition de découpage) — polling front ──
piecesRouter.get("/dossiers/:id/pieces/bundles/:bundleId", requirePermission("documents"), async (req: AuthRequest, res) => {
  try {
    const [bundle] = await db
      .select()
      .from(dossier_piece_bundles)
      .where(and(
        eq(dossier_piece_bundles.id, req.params.bundleId as string),
        eq(dossier_piece_bundles.dossier_id, req.params.id as string),
      ))
      .limit(1);
    if (!bundle) return res.status(404).json({ error: "Bundle non trouvé" });
    res.json(bundle);
  } catch (err) {
    console.error("[mairie/pieces/bundles/get]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Applique le découpage validé → crée les pièces + relance l'OCR ──────────
piecesRouter.post("/dossiers/:id/pieces/bundles/:bundleId/apply", requirePermission("dossiers.instruct"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const dossier = (req as AuthRequest & { dossier?: { id: string; user_id: string; type: string; commune: string | null } }).dossier;
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const [bundle] = await db
      .select()
      .from(dossier_piece_bundles)
      .where(and(
        eq(dossier_piece_bundles.id, req.params.bundleId as string),
        eq(dossier_piece_bundles.dossier_id, dossierId),
      ))
      .limit(1);
    if (!bundle) return res.status(404).json({ error: "Bundle non trouvé" });
    if (bundle.status === "applied") return res.status(409).json({ error: "Découpage déjà appliqué" });

    // Segments validés par l'instructeur (corps de la requête), à défaut ceux
    // proposés par l'IA.
    const body = (req.body ?? {}) as { segments?: unknown };
    const rawSegments = Array.isArray(body.segments)
      ? body.segments
      : ((bundle.proposed_segments as SegmentationResult | null)?.segments ?? []);
    const segments = sanitizeSegments(rawSegments as unknown[], dossier.type);
    if (segments.length === 0) return res.status(400).json({ error: "Aucun segment exploitable à appliquer" });

    const communeId = await resolveCommuneIdFromUser(req);
    const result = await applySegmentation({
      bundle: { id: bundle.id, url: bundle.url, storage_key: bundle.storage_key, type: bundle.type, nom: bundle.nom },
      segments,
      dossierId,
      dossierOwnerId: dossier.user_id,
      appliedBy: req.user?.id ?? null,
      trace: { dossierId, communeId, userId: req.user?.id ?? null },
    });

    // Réinitialise la session d'upload pour que la notification « dossier prêt »
    // reparte proprement une fois toutes les pièces éclatées analysées.
    await db.execute(sql`
      UPDATE dossiers
         SET metadata = (coalesce(metadata, '{}'::jsonb))
                        - 'mairie_pieces_upload_finalized'
                        - 'mairie_pieces_ocr_notified_at'
       WHERE id = ${dossierId}
    `).catch(() => { /* best-effort */ });

    res.status(201).json(result);
  } catch (err) {
    console.error("[mairie/pieces/bundles/apply]", err);
    res.status(500).json({ error: "Erreur lors de l'application du découpage" });
  }
});

// ── Abandonne une proposition de découpage (le fichier source est conservé) ──
piecesRouter.post("/dossiers/:id/pieces/bundles/:bundleId/discard", requirePermission("dossiers.instruct"), async (req: AuthRequest, res) => {
  try {
    const [bundle] = await db
      .select()
      .from(dossier_piece_bundles)
      .where(and(
        eq(dossier_piece_bundles.id, req.params.bundleId as string),
        eq(dossier_piece_bundles.dossier_id, req.params.id as string),
      ))
      .limit(1);
    if (!bundle) return res.status(404).json({ error: "Bundle non trouvé" });
    if (bundle.status === "applied") return res.status(409).json({ error: "Découpage déjà appliqué, abandon impossible" });

    await db.update(dossier_piece_bundles)
      .set({ status: "discarded" })
      .where(eq(dossier_piece_bundles.id, bundle.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[mairie/pieces/bundles/discard]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Recatégorisation manuelle d'une pièce par l'instructeur (correction) ─────
// Vaut aussi bien pour une pièce issue d'un éclatement que pour une pièce
// déposée individuellement. Trace l'action dans la chronologie d'instruction.
piecesRouter.patch("/dossiers/:id/pieces/:pieceId/classification", requirePermission("dossiers.instruct"), async (req: AuthRequest, res) => {
  try {
    const body = (req.body ?? {}) as { code_piece?: string | null; type?: string; nom?: string | null };
    const [piece] = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(and(
        eq(dossier_pieces_jointes.id, req.params.pieceId as string),
        eq(dossier_pieces_jointes.dossier_id, req.params.id as string),
      ))
      .limit(1);
    if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });

    // Nouveau code (null/"" = désaffecter).
    let newCode: string | null = piece.code_piece ?? null;
    if (body.code_piece !== undefined) {
      newCode = (body.code_piece === null || body.code_piece === "")
        ? null
        : String(body.code_piece).toUpperCase().trim().slice(0, 16);
    }
    // Type : explicite si valide, sinon dérivé du nouveau code.
    const newType: PieceType = (body.type && PIECE_TYPES.has(body.type as PieceType))
      ? (body.type as PieceType)
      : (expectedTypeFromCode(newCode) ?? "autre");

    // Nom : explicite, sinon régénéré si le nom courant était auto-généré.
    let newNom = piece.nom;
    if (typeof body.nom === "string" && body.nom.trim()) {
      newNom = body.nom.trim().slice(0, 200);
    } else if (piece.code_piece_source === "auto" || piece.code_piece_source === "instructeur") {
      newNom = defaultPieceName(newCode, newType, (piece.source_pages as number[] | null) ?? undefined);
    }

    const changed = newCode !== (piece.code_piece ?? null) || newNom !== piece.nom;
    if (!changed) return res.json(piece);

    const [updated] = await db
      .update(dossier_pieces_jointes)
      .set({ code_piece: newCode, nom: newNom, code_piece_source: "instructeur" })
      .where(eq(dossier_pieces_jointes.id, piece.id))
      .returning();

    await db.insert(instruction_events).values({
      dossier_id: piece.dossier_id,
      type: "piece_reclassifiee",
      user_id: req.user?.id ?? null,
      description: `Pièce reclassée : ${updated?.nom ?? newNom}`,
      metadata: {
        piece_id: piece.id,
        previous_code: piece.code_piece ?? null,
        new_code: newCode,
      },
    }).catch((e) => console.warn("[pieces/classification] instruction_event:", e));

    res.json(updated);
  } catch (err) {
    console.error("[mairie/pieces/classification]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
