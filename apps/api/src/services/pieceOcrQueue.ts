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
import { dossier_pieces_jointes } from "@heureka-v1/db";
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

// Garde-fous temporels. Le LLM vision (Pixtral) peut hoqueter ou se bloquer
// silencieusement sur un PDF tordu — sans cap, la pièce reste `processing` à
// l'infini et le dossier ne sort jamais du chargement. Les valeurs sont
// volontairement larges (un CERFA scanné multi-pages prend déjà 30–60 s).
const PER_PIECE_TIMEOUT_MS = 4 * 60 * 1000; // 4 min par pièce (analyse + extraction en parallèle)
const STALE_PROCESSING_MS = 6 * 60 * 1000;   // au-delà, on considère la pièce HS et on débloque
const AUTO_FINALIZE_AFTER_LAST_UPLOAD_MS = 3 * 60 * 1000; // filet si /finalize-upload-session n'a pas été appelé

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

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout après ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
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

  // try / finally : quelle que soit l'issue (succès, erreur catchée, exception
  // non catchée, timeout), on garantit que la pièce sort de l'état `processing`.
  // Sans ce filet, un throw imprévu (ex. erreur réseau Mistral non Error)
  // laissait la pièce verrouillée à l'infini et le dossier ne sortait jamais
  // du chargement.
  let aiProcessed = false;
  let analyse_ia: Awaited<ReturnType<typeof analyzePiece>> | null = null;
  let extraction_ia: Awaited<ReturnType<typeof extractPiece>> | null = null;
  try {
    const expected = expectedTypeFromCode(code_piece);
    const work = Promise.all([
      analyzePiece(fileBuffer, mimeType, nom_piece, code_piece, undefined, trace).catch((err) => {
        console.error("[pieceOcrQueue] analyzePiece:", err instanceof Error ? `${err.name}: ${err.message}` : err);
        return null;
      }),
      extractPiece(fileBuffer, mimeType, { expected_type: expected, nom_piece, code_piece }, trace).catch((err) => {
        console.error("[pieceOcrQueue] extractPiece:", err instanceof Error ? `${err.name}: ${err.message}` : err);
        return null;
      }),
    ]);
    [analyse_ia, extraction_ia] = await withTimeout(work, PER_PIECE_TIMEOUT_MS, `OCR pièce ${pieceId}`);
    aiProcessed = analyse_ia !== null || extraction_ia !== null;
  } catch (err) {
    console.error("[pieceOcrQueue] processOne fatal — pièce marquée failed:",
      err instanceof Error ? `${err.name}: ${err.message}` : err);
    // On ne re-throw pas : on veut absolument exécuter le finally et passer à
    // la pièce suivante.
  } finally {
    await db
      .update(dossier_pieces_jointes)
      .set({
        analyse_ia: analyse_ia ?? null,
        extraction_ia: extraction_ia ?? null,
        ai_processed: aiProcessed,
        ocr_status: aiProcessed ? "done" : "failed",
        ocr_completed_at: new Date(),
      })
      .where(eq(dossier_pieces_jointes.id, pieceId))
      .catch((err) => {
        // Si même cette écriture échoue, le watchdog dans maybeNotifyDossierReady
        // récupérera la pièce au prochain appel (cf. reapStaleProcessing).
        console.error("[pieceOcrQueue] update final piece a échoué:",
          err instanceof Error ? `${err.name}: ${err.message}` : err);
      });

    // À chaque complétion, on tente d'envoyer la notification "dossier prêt".
    // C'est un no-op tant que (a) l'agent n'a pas finalisé sa session d'upload
    // ou (b) d'autres pièces sont encore en file.
    await maybeNotifyDossierReady(dossierId).catch((err) => {
      console.warn("[pieceOcrQueue] maybeNotifyDossierReady:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    });
  }
}

// Watchdog : si une pièce traîne en `processing` au-delà de STALE_PROCESSING_MS,
// on considère que le worker s'est planté (timeout LLM non catché, restart du
// process, etc.) et on la marque `failed` pour débloquer la suite. Le LLM
// Pixtral met max ~1 min par pièce ; 6 min est très large.
async function reapStaleProcessing(dossierId: string): Promise<void> {
  await db.execute(sql`
    UPDATE dossier_pieces_jointes
       SET ocr_status = 'failed',
           ocr_completed_at = now()
     WHERE dossier_id = ${dossierId}
       AND archived_at IS NULL
       AND ocr_status IN ('pending', 'processing')
       AND coalesce(ocr_started_at, uploaded_at) < now() - (${STALE_PROCESSING_MS} || ' milliseconds')::interval
  `).catch((err) => {
    console.warn("[pieceOcrQueue] reapStaleProcessing:", err instanceof Error ? `${err.name}: ${err.message}` : err);
  });
}

// Vérifie l'état du dossier : si l'agent a appelé /finalize-upload-session ET
// qu'aucune pièce n'est plus en pending/processing, on déclenche UNE seule
// notification et on persiste un timestamp pour empêcher les doublons (le
// flag est aussi le verrou d'unicité).
export async function maybeNotifyDossierReady(dossierId: string): Promise<void> {
  // 1) Sweep : libère d'éventuelles pièces coincées en processing (worker
  //    tombé, LLM bloqué). Sans ça la file de notif ne sort jamais.
  await reapStaleProcessing(dossierId);

  // 2) Compte les pièces encore à traiter (pending ou processing, non archivées).
  const pending = await db
    .select({ id: dossier_pieces_jointes.id })
    .from(dossier_pieces_jointes)
    .where(and(
      eq(dossier_pieces_jointes.dossier_id, dossierId),
      inArray(dossier_pieces_jointes.ocr_status, ["pending", "processing"]),
    ))
    .limit(1);
  if (pending.length > 0) return;

  // 3) Update atomique : on coche `notified_at` dans le metadata UNIQUEMENT si
  //    l'agent a explicitement finalisé sa session OU si le dernier upload
  //    date d'assez longtemps pour qu'on considère la session abandonnée (le
  //    front-end peut avoir loupé l'appel /finalize-upload-session). Le
  //    RETURNING nous dit si la ligne a été modifiée — c'est notre verrou
  //    d'unicité.
  const rows = await db.execute(sql`
    UPDATE dossiers
       SET metadata = jsonb_set(
             coalesce(metadata, '{}'::jsonb),
             '{mairie_pieces_ocr_notified_at}',
             to_jsonb(now()::text),
             true
           )
     WHERE id = ${dossierId}
       AND (metadata->>'mairie_pieces_ocr_notified_at') IS NULL
       AND (
            coalesce((metadata->>'mairie_pieces_upload_finalized')::boolean, false) = true
         OR (
              SELECT max(uploaded_at) < now() - (${AUTO_FINALIZE_AFTER_LAST_UPLOAD_MS} || ' milliseconds')::interval
                FROM dossier_pieces_jointes
               WHERE dossier_id = dossiers.id
                 AND archived_at IS NULL
            )
       )
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
