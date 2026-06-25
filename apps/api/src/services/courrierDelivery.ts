// Remise d'un courrier d'instruction au pétitionnaire selon le canal choisi.
//
// L'émission (statut "envoye", effets métier) reste gérée en amont
// (pieceRequest / route). Ce service ne s'occupe QUE de la transmission :
//   - "messagerie" : dépose le courrier dans la messagerie interne du dossier
//                    (dossier_messages, fil citoyen↔mairie) — dématérialisé,
//                    instantané, sans dépendance externe ;
//   - "email"      : notifie le pétitionnaire par email (Resend) que le courrier
//                    est disponible dans son espace — dégradation gracieuse si
//                    pas d'adresse connue ou service email non configuré ;
//   - "postal"/"ar": aucune automatisation — le PDF imprimé est l'artefact, on
//                    se contente de tracer le mode de remise.
//
// Aucune exception bloquante : un échec de canal est renvoyé dans le résultat
// (delivered=false + note), pour que l'émission elle-même ne soit pas annulée.

import { db } from "../db.js";
import { dossier_messages, dossiers, users } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import { resolveAttachmentRefs } from "./gedAttachments.js";
import { sendCourrierEmail } from "./mailer.js";
import type { PieceRequestItem } from "./pieceRequest.js";

export const COURRIER_CHANNELS = ["messagerie", "email", "postal", "ar"] as const;
export type CourrierChannel = (typeof COURRIER_CHANNELS)[number];

export function isCourrierChannel(v: unknown): v is CourrierChannel {
  return typeof v === "string" && (COURRIER_CHANNELS as readonly string[]).includes(v);
}

export interface DeliverCourrierInput {
  dossier_id: string;
  channel: CourrierChannel;
  subject: string;
  // Pièces demandées (courrier de pièces) — listées en clair dans le message.
  pieces?: PieceRequestItem[];
  // Corps en texte brut (courrier général) — listé si aucune pièce.
  body_text?: string | null;
  // Documents GED à joindre au message de messagerie interne.
  attachment_document_ids?: string[];
  emis_par: string;
  emis_par_role: string;
}

export interface DeliverCourrierResult {
  channel: CourrierChannel;
  // true = canal traité (message posté / email envoyé / remise postale actée).
  delivered: boolean;
  // Libellé humain du canal effectif (affiché côté front).
  via: string;
  // Précision éventuelle (email non configuré, à poster soi-même…).
  note?: string;
}

// Liste de pièces en texte brut (pour la messagerie interne et l'email).
function piecesToText(pieces: PieceRequestItem[]): string {
  if (pieces.length === 0) return "";
  return pieces
    .map((p) => {
      const code = p.code_piece ? `${p.code_piece} — ` : "";
      const tag = p.manquante ? " (à fournir)" : " (à compléter)";
      const reason = p.raison ? ` — ${p.raison}` : "";
      return `• ${code}${p.nom}${tag}${reason}`;
    })
    .join("\n");
}

export async function deliverCourrier(input: DeliverCourrierInput): Promise<DeliverCourrierResult> {
  const { dossier_id, channel, subject, attachment_document_ids, emis_par, emis_par_role } = input;
  const pieces = input.pieces ?? [];

  if (channel === "messagerie") {
    const attachments = await resolveAttachmentRefs(dossier_id, attachment_document_ids ?? [], "citoyen");
    const piecesTxt = piecesToText(pieces);
    const content = [
      subject || "Courrier du service urbanisme",
      piecesTxt ? `\nPièces à fournir ou à compléter :\n${piecesTxt}` : (input.body_text ? `\n${input.body_text.trim()}` : ""),
    ].filter(Boolean).join("\n");
    await db.insert(dossier_messages).values({
      dossier_id,
      from_user_id: emis_par,
      from_role: emis_par_role,
      content,
      attachments,
    });
    return { channel, delivered: true, via: "messagerie interne" };
  }

  if (channel === "email") {
    const [row] = await db
      .select({ email: users.email, prenom: users.prenom, numero: dossiers.numero, commune: dossiers.commune })
      .from(dossiers)
      .innerJoin(users, eq(dossiers.user_id, users.id))
      .where(eq(dossiers.id, dossier_id))
      .limit(1);
    if (!row?.email) {
      return { channel, delivered: false, via: "email", note: "Aucune adresse email connue pour le pétitionnaire." };
    }
    if (!process.env.RESEND_API_KEY) {
      return { channel, delivered: false, via: "email", note: "Service email non configuré (clé Resend absente)." };
    }
    try {
      await sendCourrierEmail({
        to: row.email,
        prenom: row.prenom ?? "",
        numeroDossier: row.numero,
        communeName: row.commune ?? undefined,
        subject,
        piecesText: piecesToText(pieces),
      });
      return { channel, delivered: true, via: "email" };
    } catch (err) {
      console.error("[deliverCourrier email]", err);
      return { channel, delivered: false, via: "email", note: "Échec de l'envoi de l'email." };
    }
  }

  // postal / ar : pas d'automatisation — le PDF imprimé est l'artefact.
  return {
    channel,
    delivered: true,
    via: channel === "ar" ? "courrier recommandé (LRAR)" : "voie postale",
    note: "Imprimez le courrier (bouton Imprimer / PDF) et postez-le — aucun envoi automatique.",
  };
}
