// Archivage des pièces remplacées après une demande de complément.
//
// Quand l'instructeur a posé `instructeur_status = "complement_demande"` sur une
// pièce, le pétitionnaire est invité à en redéposer une nouvelle pour le même
// emplacement. Plutôt que d'écraser ou de cohabiter à l'écran avec l'ancienne
// version (bruit visuel), on bascule l'ancienne en archive : `archived_at`
// renseigné, `archived_by_piece_id` pointant sur le nouvel upload. La pièce
// n'est jamais supprimée — RGPD et auditabilité de l'instruction.
//
// Décision : on archive toutes les pièces en `complement_demande` qui matchent
// l'emplacement du nouvel upload, pas seulement la plus ancienne. Cas typique
// d'un slot multi-fichiers (ex. PC5 / 4 façades) où l'instructeur a demandé
// des compléments sur plusieurs vues : la redécouverte par le citoyen se fait
// d'un bloc, et l'instructeur réexamine l'ensemble du nouveau set.

import { db } from "../db.js";
import { dossier_pieces_jointes, instruction_events } from "@heureka-v1/db";
import { and, eq, inArray, isNull, like } from "drizzle-orm";

export interface ArchivePreviousInput {
  dossier_id: string;
  // Identifiant du slot. code_piece est canonique quand renseigné, sinon on
  // s'appuie sur le préfixe du nom (convention citoyen "${slot} - ${file}").
  code_piece: string | null;
  // Nom complet du nouvel upload tel que stocké en base. Sert à extraire le
  // libellé de slot pour distinguer deux annexes sans code partageant la même
  // rubrique.
  new_piece_nom: string;
  new_piece_id: string;
  user_id: string | null;
}

export interface ArchivePreviousResult {
  archived_ids: string[];
}

// Extrait le libellé de slot ("PC5 - Plan des façades") du nom complet
// "${slot} - ${filename}". Retourne null si la convention n'est pas respectée.
function extractSlotLabel(nom: string): string | null {
  const idx = nom.indexOf(" - ");
  if (idx <= 0) return null;
  return nom.slice(0, idx);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function archivePreviousComplementDemande(
  input: ArchivePreviousInput,
): Promise<ArchivePreviousResult> {
  const { dossier_id, code_piece, new_piece_nom, new_piece_id, user_id } = input;
  const slot = extractSlotLabel(new_piece_nom);

  // Sans signal d'emplacement (ni code_piece, ni préfixe slot), on ne sait pas
  // à quoi rattacher l'upload — on s'abstient plutôt que d'archiver à tort.
  if (!code_piece && !slot) return { archived_ids: [] };

  const conds = [
    eq(dossier_pieces_jointes.dossier_id, dossier_id),
    eq(dossier_pieces_jointes.instructeur_status, "complement_demande"),
    isNull(dossier_pieces_jointes.archived_at),
  ];
  if (code_piece) conds.push(eq(dossier_pieces_jointes.code_piece, code_piece));
  else conds.push(isNull(dossier_pieces_jointes.code_piece));
  if (slot) conds.push(like(dossier_pieces_jointes.nom, `${escapeLike(slot)} - %`));

  const candidates = await db
    .select({ id: dossier_pieces_jointes.id, nom: dossier_pieces_jointes.nom })
    .from(dossier_pieces_jointes)
    .where(and(...conds));

  const toArchive = candidates.filter((p) => p.id !== new_piece_id);
  if (toArchive.length === 0) return { archived_ids: [] };

  const now = new Date();
  const ids = toArchive.map((p) => p.id);
  await db
    .update(dossier_pieces_jointes)
    .set({ archived_at: now, archived_by_piece_id: new_piece_id })
    .where(inArray(dossier_pieces_jointes.id, ids));

  await db.insert(instruction_events).values({
    dossier_id,
    type: "piece_archivee_par_complement",
    user_id,
    description: `Archivage de ${toArchive.length} version${toArchive.length > 1 ? "s" : ""} précédente${toArchive.length > 1 ? "s" : ""} remplacée${toArchive.length > 1 ? "s" : ""} par un nouveau dépôt`,
    metadata: {
      new_piece_id,
      archived_piece_ids: ids,
      code_piece,
      slot,
    },
  });

  return { archived_ids: ids };
}
