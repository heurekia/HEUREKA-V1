// Service d'émission d'une demande de pièces complémentaires.
//
// Centralise :
// - la construction du bloc HTML "liste des pièces à compléter" qui sera
//   injecté dans le corps du courrier (via la variable
//   {liste_pieces_a_completer} dans les templates) ;
// - l'enregistrement du courrier dans dossier_courriers (snapshot + pièces +
//   articles) ;
// - les effets de bord sur le dossier : passage des pièces sélectionnées en
//   `instructeur_status = "complement_demande"` et transition du dossier
//   vers `incomplet` via la machine à états.
//
// Conçu pour rester pilotable par l'instructeur — aucune sélection
// automatique : il décide quelles pièces demander, l'IA ne peut que suggérer
// (et même cette suggestion peut être désactivée côté UI).

import { db } from "../db.js";
import { dossier_pieces_jointes, dossier_courriers, instruction_events } from "@heureka-v1/db";
import { eq, inArray } from "drizzle-orm";
import { changeDossierStatus, WorkflowError } from "./dossierWorkflow.js";
import { resolveAttachmentRefs } from "./gedAttachments.js";

export interface PieceRequestItem {
  // Soit on demande une pièce déjà déposée (piece_id renseigné, manquante=false),
  // soit on signale une pièce non déposée (piece_id absent, manquante=true,
  // code_piece et/ou nom fournis).
  piece_id?: string;
  code_piece?: string;
  nom: string;
  raison?: string;
  manquante?: boolean;
}

export interface EmitPieceRequestInput {
  dossier_id: string;
  pieces: PieceRequestItem[];
  articles_cites: string[];
  // Snapshot du corps de courrier après substitution (HTML ou JSON canvas).
  // Optionnel : on accepte une émission sans corps (ex. émission programmatique
  // sans génération PDF), auquel cas seul l'event est tracé.
  body_snapshot?: string | null;
  subject?: string | null;
  delivery_method?: string | null;
  // Documents de la GED à joindre au courrier (ex. plan annoté par l'instructeur).
  attachment_document_ids?: string[];
  // Utilisateur émetteur. Toujours fourni par la route.
  emis_par: string;
}

export interface EmitPieceRequestResult {
  courrier_id: string;
  pieces_marked: number;
  status_changed: boolean;
}

// Rendu HTML compact d'une liste de pièces, utilisable directement dans un
// courrier. Sécurisé côté client par DOMPurify. On reste sobre côté HTML
// (pas de classes, juste des balises sémantiques) pour s'imbriquer dans
// n'importe quel template.
export function renderPieceListHtml(pieces: PieceRequestItem[]): string {
  if (pieces.length === 0) return "";
  const items = pieces.map((p) => {
    const codeLabel = p.code_piece ? `<strong>${escapeHtml(p.code_piece)}</strong> — ` : "";
    const reason = p.raison ? `<br/><span style="font-size:0.9em;color:#475569;">${escapeHtml(p.raison)}</span>` : "";
    const tag = p.manquante
      ? `<span style="font-size:0.78em;color:#B45309;background:#FEF3C7;padding:1px 6px;border-radius:4px;margin-left:6px;">à fournir</span>`
      : `<span style="font-size:0.78em;color:#0284C7;background:#E0F2FE;padding:1px 6px;border-radius:4px;margin-left:6px;">à compléter</span>`;
    return `<li style="margin-bottom:6px;">${codeLabel}${escapeHtml(p.nom)}${tag}${reason}</li>`;
  }).join("");
  return `<ul style="padding-left:18px;margin:0;">${items}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] ?? c));
}

export async function emitPieceComplementRequest(
  input: EmitPieceRequestInput,
): Promise<EmitPieceRequestResult> {
  const { dossier_id, pieces, articles_cites, body_snapshot, subject, delivery_method, attachment_document_ids, emis_par } = input;

  if (pieces.length === 0) {
    throw new Error("Au moins une pièce doit être sélectionnée pour la demande de complément");
  }

  // Documents GED joints (plan annoté…) : résolus + partagés au citoyen.
  const attachments = await resolveAttachmentRefs(dossier_id, attachment_document_ids, "citoyen");

  // 1) Persiste le courrier (snapshot figé).
  const [courrier] = await db
    .insert(dossier_courriers)
    .values({
      dossier_id,
      type: "pieces_complementaires",
      subject: subject ?? "Demande de pièces complémentaires",
      body_snapshot: body_snapshot ?? null,
      pieces_jointes_ids: pieces.map((p) => ({
        piece_id: p.piece_id,
        code_piece: p.code_piece,
        nom: p.nom,
        raison: p.raison,
        manquante: p.manquante ?? !p.piece_id,
      })),
      articles_cites,
      attachments,
      emis_par,
      delivery_method: delivery_method ?? null,
    })
    .returning({ id: dossier_courriers.id });

  if (!courrier) throw new Error("Échec de l'enregistrement du courrier");

  // 2) Marque les pièces déjà déposées en "complement_demande" si elles
  //    n'étaient pas déjà refusées. On ne touche pas aux pièces "valide" ou
  //    "rejete" déjà posées : l'instructeur garde la main.
  const existingPieceIds = pieces
    .filter((p) => !!p.piece_id && !p.manquante)
    .map((p) => p.piece_id as string);
  let pieces_marked = 0;
  if (existingPieceIds.length > 0) {
    const rows = await db
      .update(dossier_pieces_jointes)
      .set({
        instructeur_status: "complement_demande",
        instructeur_status_at: new Date(),
        instructeur_status_by: emis_par,
      })
      .where(inArray(dossier_pieces_jointes.id, existingPieceIds))
      .returning({ id: dossier_pieces_jointes.id });
    pieces_marked = rows.length;
  }

  // 3) Trace dans la chronologie d'instruction.
  await db.insert(instruction_events).values({
    dossier_id,
    type: "pieces_complementaires_demandees",
    user_id: emis_par,
    description: `Demande de ${pieces.length} pièce${pieces.length > 1 ? "s" : ""} complémentaire${pieces.length > 1 ? "s" : ""}`,
    metadata: {
      courrier_id: courrier.id,
      pieces_count: pieces.length,
      manquantes_count: pieces.filter((p) => p.manquante || !p.piece_id).length,
      articles_cites,
    },
  });

  // 4) Transition vers "incomplet" si la machine à états le permet.
  //    Si le dossier est déjà en "incomplet" ou hors phase de complétude
  //    (ex. en_instruction), on n'essaie pas de forcer — la machine refusera
  //    proprement et la levée d'exception serait un faux positif.
  let status_changed = false;
  try {
    const result = await changeDossierStatus(dossier_id, "incomplet", emis_par, {
      reason: "demande de pièces complémentaires émise",
      extraMetadata: { courrier_id: courrier.id },
    });
    status_changed = result.changed;
  } catch (err) {
    if (err instanceof WorkflowError && err.code === "INVALID_TRANSITION") {
      // OK : on reste sur le statut courant, le courrier est tracé.
    } else {
      throw err;
    }
  }

  return { courrier_id: courrier.id, pieces_marked, status_changed };
}
