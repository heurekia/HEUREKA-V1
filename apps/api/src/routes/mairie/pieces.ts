import { Router } from "express";
import { db } from "../../db.js";
import { dossier_pieces_jointes, instruction_events } from "@heureka-v1/db";
import { eq, desc, and } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { type AuthRequest } from "../../middlewares/auth.js";
import { autoAdvanceIfAllPiecesValid } from "../../services/dossierWorkflow.js";
import { extractPiece, expectedTypeFromCode } from "../../services/pieceExtractor.js";
import { resolveCommuneIdFromUser, UPLOADS_DIR_MAIRIE } from "./_shared.js";

export const piecesRouter = Router();

piecesRouter.get("/dossiers/:id/pieces", async (req: AuthRequest, res) => {
  try {
    const pieces = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.dossier_id, req.params.id as string))
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
