// OCR asynchrone pour les pièces déposées au comptoir mairie.
//
// Pourquoi un worker en arrière-plan : l'analyse IA d'une pièce (analyzePiece
// + extractPiece, deux appels LLM avec vision) prend plusieurs secondes par
// fichier. Quand un agent dépose un dossier complet (CERFA + 5 à 10 plans),
// la route d'upload restait bloquée 30 à 60 secondes — l'agent attendait
// devant le pétitionnaire. On rend désormais la main immédiatement après la
// persistance de la pièce, et l'OCR tourne ici. La cloche de notification
// signale à l'instructeur que l'analyse complète du dossier est prête.
//
// La file est volontairement minimaliste (Promise dans le process, FIFO via
// chaînage) : un seul replicat API mairie pour l'instant, et on évite une
// dépendance Redis/BullMQ. Si on passe à plusieurs replicas il faudra
// déplacer la file dans Postgres (LISTEN/NOTIFY) ou Redis.

import { db } from "../db.js";
import { dossier_pieces_jointes, dossiers } from "@heureka-v1/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { analyzePiece } from "./pieceAnalyzer.js";
import { extractPiece, expectedTypeFromCode } from "./pieceExtractor.js";
import { notifyDossierAgents } from "./notify.js";

export interface QueueOcrInput {
  pieceId: string;
  dossierId: string;
  fileBuffer: Buffer;
  mimeType: string;
  nom_piece: string;
  code_piece: string;
  trace: { dossierId: string | null; userId: string | null; communeId: string | null };
}

// Chaîne de promesses : on traite une pièce à la fois pour ne pas saturer le
// quota LLM et garder un comportement déterministe sous charge. Le coût en
// latence par pièce reste le même qu'avant côté worker, mais c'est invisible
// pour l'agent à l'upload.
let chain: Promise<void> = Promise.resolve();

export function queuePieceOcr(input: QueueOcrInput): void {
  chain = chain.then(() => processOne(input)).catch((err) => {
    console.error("[pieceOcrQueue] tâche en échec (avalée pour ne pas casser la file):",
      err instanceof Error ? `${err.name}: ${err.message}` : err);
  });
}

async function processOne(input: QueueOcrInput): Promise<void> {
  const { pieceId, dossierId, fileBuffer, mimeType, nom_piece, code_piece, trace } = input;

  // Marque "processing" avant d'envoyer au LLM — utile pour le debug et pour
  // que la finalize-session ne notifie pas pendant qu'un worker tourne.
  await db
    .update(dossier_pieces_jointes)
    .set({ ocr_status: "processing", ocr_started_at: new Date() })
    .where(eq(dossier_pieces_jointes.id, pieceId))
    .catch(() => { /* best-effort */ });

  const expected = expectedTypeFromCode(code_piece);
  const [analyse_ia, extraction_ia] = await Promise.all([
    analyzePiece(fileBuffer, mimeType, nom_piece, code_piece, undefined, trace).catch((err) => {
      console.error("[pieceOcrQueue] analyzePiece:", err instanceof Error ? `${err.name}: ${err.message}` : err);
      return null;
    }),
    extractPiece(fileBuffer, mimeType, { expected_type: expected, nom_piece, code_piece }, trace).catch((err) => {
      console.error("[pieceOcrQueue] extractPiece:", err instanceof Error ? `${err.name}: ${err.message}` : err);
      return null;
    }),
  ]);

  const aiProcessed = analyse_ia !== null || extraction_ia !== null;
  await db
    .update(dossier_pieces_jointes)
    .set({
      analyse_ia: analyse_ia ?? null,
      extraction_ia: extraction_ia ?? null,
      ai_processed: aiProcessed,
      ocr_status: aiProcessed ? "done" : "failed",
      ocr_completed_at: new Date(),
    })
    .where(eq(dossier_pieces_jointes.id, pieceId));

  // À chaque complétion, on tente d'envoyer la notification "dossier prêt".
  // C'est un no-op tant que (a) l'agent n'a pas finalisé sa session d'upload
  // ou (b) d'autres pièces sont encore en file.
  await maybeNotifyDossierReady(dossierId).catch((err) => {
    console.warn("[pieceOcrQueue] maybeNotifyDossierReady:", err instanceof Error ? `${err.name}: ${err.message}` : err);
  });
}

// Vérifie l'état du dossier : si l'agent a appelé /finalize-upload-session ET
// qu'aucune pièce n'est plus en pending/processing, on déclenche UNE seule
// notification et on persiste un timestamp pour empêcher les doublons (le
// flag est aussi le verrou d'unicité).
export async function maybeNotifyDossierReady(dossierId: string): Promise<void> {
  // Compte les pièces encore à traiter (pending ou processing, non archivées).
  const pending = await db
    .select({ id: dossier_pieces_jointes.id })
    .from(dossier_pieces_jointes)
    .where(and(
      eq(dossier_pieces_jointes.dossier_id, dossierId),
      inArray(dossier_pieces_jointes.ocr_status, ["pending", "processing"]),
    ))
    .limit(1);
  if (pending.length > 0) return;

  // Update atomique : on coche `notified_at` dans le metadata UNIQUEMENT si
  // l'agent a explicitement finalisé sa session et qu'on n'a pas déjà notifié.
  // Le RETURNING nous dit si la ligne a été modifiée — c'est notre verrou.
  const rows = await db.execute(sql`
    UPDATE dossiers
       SET metadata = jsonb_set(
             coalesce(metadata, '{}'::jsonb),
             '{mairie_pieces_ocr_notified_at}',
             to_jsonb(now()::text),
             true
           )
     WHERE id = ${dossierId}
       AND coalesce((metadata->>'mairie_pieces_upload_finalized')::boolean, false) = true
       AND (metadata->>'mairie_pieces_ocr_notified_at') IS NULL
     RETURNING id, instructeur_id, numero
  `);

  type Row = { id: string; instructeur_id: string | null; numero: string };
  const updated = (rows as unknown as { rows?: Row[] }).rows ?? (rows as unknown as Row[]);
  const winner = Array.isArray(updated) ? updated[0] : undefined;
  if (!winner) return;

  await notifyDossierAgents({
    dossier_id: dossierId,
    type: "dossier_pret_apres_ocr",
    title: "Dossier prêt à instruire",
    message: `Le dossier ${winner.numero} est constitué : l'analyse OCR de toutes les pièces est terminée.`,
  });
}

// Notification "fenêtre vide" : appelée par la route /finalize-upload-session
// pour couvrir le cas où l'agent finalise APRÈS que toutes les pièces sont
// déjà passées par le worker (très court dossier, OCR plus rapide que l'agent).
export async function notifyIfAlreadyComplete(dossierId: string): Promise<void> {
  await maybeNotifyDossierReady(dossierId);
}
