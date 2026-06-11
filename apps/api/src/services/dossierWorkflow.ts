// Service workflow d'instruction côté API.
//
// Centralise toute mutation du couple (status, instructeur_id) sur un dossier.
// Toute transition de statut passe par la machine à états partagée
// (packages/shared/dossierWorkflow.ts) et est tracée dans instruction_events.
// Les assignations sont validées contre le rôle de l'utilisateur cible et
// également journalisées.

import { db } from "../db.js";
import { dossiers, instruction_events, users } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import {
  ASSIGNABLE_ROLES,
  canTransition,
  type DossierStatus,
} from "@heureka-v1/shared";
import { resolveEffectiveInstructeur } from "./absenceDelegation.js";

export type WorkflowErrorCode =
  | "DOSSIER_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_ASSIGNEE"
  | "ASSIGNEE_NOT_FOUND";

export class WorkflowError extends Error {
  constructor(public code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export interface StatusChangeOptions {
  // Raison libre, stockée dans le metadata de l'event.
  reason?: string | null;
  // Bypass strictement réservé aux transitions imposées par le moteur de
  // décision (signature de l'arrêté → accepte/refuse/accord_prescription).
  // Toute route exposée à l'utilisateur DOIT laisser ce flag à false.
  bypassStateMachine?: boolean;
  // Champs additionnels à fusionner dans le metadata de l'event.
  extraMetadata?: Record<string, unknown>;
  // Type d'event à utiliser. Par défaut "status_changed". Permet aux
  // déclencheurs métiers (ex. décision signée) de poser un type distinct.
  eventType?: string;
}

export interface StatusChangeResult {
  previous_status: DossierStatus;
  new_status: DossierStatus;
  changed: boolean;
}

export async function changeDossierStatus(
  dossierId: string,
  newStatus: DossierStatus,
  actorId: string | null,
  opts: StatusChangeOptions = {},
): Promise<StatusChangeResult> {
  const [before] = await db
    .select({ id: dossiers.id, status: dossiers.status })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);
  if (!before) throw new WorkflowError("DOSSIER_NOT_FOUND", "Dossier non trouvé");

  const prev = before.status as DossierStatus;
  if (prev === newStatus) {
    return { previous_status: prev, new_status: newStatus, changed: false };
  }
  if (!opts.bypassStateMachine && !canTransition(prev, newStatus)) {
    throw new WorkflowError(
      "INVALID_TRANSITION",
      `Transition ${prev} → ${newStatus} non autorisée`,
    );
  }

  await db
    .update(dossiers)
    .set({ status: newStatus, updated_at: new Date() })
    .where(eq(dossiers.id, dossierId));

  await db.insert(instruction_events).values({
    dossier_id: dossierId,
    type: opts.eventType ?? "status_changed",
    user_id: actorId,
    description: `Statut : ${prev} → ${newStatus}`,
    metadata: {
      previous_status: prev,
      new_status: newStatus,
      reason: opts.reason ?? null,
      ...(opts.extraMetadata ?? {}),
    },
  });

  return { previous_status: prev, new_status: newStatus, changed: true };
}

export interface AssignOptions {
  reason?: string | null;
  // Désactive la redirection automatique en cas d'absence (utilisé par le job
  // cron pour ne pas re-rediriger un dossier déjà redirigé, ou par
  // l'administration pour forcer une attribution explicite).
  skipAbsenceRedirection?: boolean;
}

export async function assignInstructeur(
  dossierId: string,
  instructeurId: string,
  actorId: string | null,
  opts: AssignOptions = {},
): Promise<{ changed: boolean; previous_instructeur_id: string | null; redirected_from?: string }> {
  const [before] = await db
    .select({ id: dossiers.id, instructeur_id: dossiers.instructeur_id })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);
  if (!before) throw new WorkflowError("DOSSIER_NOT_FOUND", "Dossier non trouvé");

  // Résolution de la chaîne de délégation : si la cible est en absence
  // aujourd'hui, on suit ses délégués jusqu'à trouver un instructeur disponible.
  let effectiveId = instructeurId;
  let redirected = false;
  let chain: string[] = [instructeurId];
  if (!opts.skipAbsenceRedirection) {
    const resolved = await resolveEffectiveInstructeur(instructeurId, new Date());
    effectiveId = resolved.instructeurId;
    redirected = resolved.redirected;
    chain = resolved.chain;
  }

  const [target] = await db
    .select({ id: users.id, role: users.role, prenom: users.prenom, nom: users.nom })
    .from(users)
    .where(eq(users.id, effectiveId))
    .limit(1);
  if (!target) throw new WorkflowError("ASSIGNEE_NOT_FOUND", "Utilisateur cible inconnu");
  if (!ASSIGNABLE_ROLES.has(target.role)) {
    throw new WorkflowError(
      "INVALID_ASSIGNEE",
      "Cet utilisateur ne peut pas être désigné comme instructeur",
    );
  }

  if (before.instructeur_id === effectiveId) {
    return { changed: false, previous_instructeur_id: before.instructeur_id };
  }

  await db
    .update(dossiers)
    .set({ instructeur_id: effectiveId, updated_at: new Date() })
    .where(eq(dossiers.id, dossierId));

  const targetName = [target.prenom, target.nom].filter(Boolean).join(" ").trim() || target.id;
  const description = redirected
    ? `Dossier redirigé vers ${targetName} (instructeur initial absent)`
    : before.instructeur_id
      ? `Dossier réassigné à ${targetName}`
      : `Dossier pris en charge par ${targetName}`;
  await db.insert(instruction_events).values({
    dossier_id: dossierId,
    type: redirected
      ? "instructeur_redirected_absence"
      : before.instructeur_id
        ? "instructeur_reassigned"
        : "instructeur_assigned",
    user_id: actorId,
    description,
    metadata: {
      previous_instructeur_id: before.instructeur_id,
      new_instructeur_id: effectiveId,
      requested_instructeur_id: instructeurId,
      delegation_chain: redirected ? chain : undefined,
      reason: opts.reason ?? null,
    },
  });

  return {
    changed: true,
    previous_instructeur_id: before.instructeur_id,
    redirected_from: redirected ? instructeurId : undefined,
  };
}

export async function unassignInstructeur(
  dossierId: string,
  actorId: string | null,
  opts: AssignOptions = {},
): Promise<{ changed: boolean; previous_instructeur_id: string | null }> {
  const [before] = await db
    .select({ id: dossiers.id, instructeur_id: dossiers.instructeur_id })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);
  if (!before) throw new WorkflowError("DOSSIER_NOT_FOUND", "Dossier non trouvé");
  if (!before.instructeur_id) {
    return { changed: false, previous_instructeur_id: null };
  }

  await db
    .update(dossiers)
    .set({ instructeur_id: null, updated_at: new Date() })
    .where(eq(dossiers.id, dossierId));

  await db.insert(instruction_events).values({
    dossier_id: dossierId,
    type: "instructeur_unassigned",
    user_id: actorId,
    description: "Instructeur retiré du dossier",
    metadata: {
      previous_instructeur_id: before.instructeur_id,
      reason: opts.reason ?? null,
    },
  });

  return { changed: true, previous_instructeur_id: before.instructeur_id };
}

// Helper utilisé par les routes pour renvoyer une 4xx propre.
export function workflowErrorToHttp(err: WorkflowError): { status: number; body: { error: string; code: WorkflowErrorCode } } {
  switch (err.code) {
    case "DOSSIER_NOT_FOUND":
    case "ASSIGNEE_NOT_FOUND":
      return { status: 404, body: { error: err.message, code: err.code } };
    case "INVALID_TRANSITION":
    case "INVALID_ASSIGNEE":
      return { status: 400, body: { error: err.message, code: err.code } };
  }
}

// ── Auto-transitions pilotées par l'état des pièces ──────────────────────────
// Les deux fonctions ci-dessous formalisent la "boucle complétude" :
//   citoyen redépose une pièce  → incomplet → pre_instruction
//   instructeur valide la dernière pièce → pre_instruction → en_instruction
// (avec pose de date_completude qui démarre formellement le délai légal
//  d'instruction au sens de R.423-23).
//
// Elles sont conçues pour être idempotentes et ultra conservatrices : aucun
// effet de bord si le statut ne s'y prête pas. Toute exception WorkflowError
// "INVALID_TRANSITION" est avalée (ce n'est pas une erreur métier).

import { dossier_pieces_jointes } from "@heureka-v1/db";
import { computeInstructionDelay, applyMonthsToDate, type DeadlineMetadata, type DeadlineServitude } from "./instructionDelays.js";

export async function autoReopenAfterCitizenUpload(
  dossierId: string,
  actorId: string | null,
): Promise<{ transitioned: boolean }> {
  const [before] = await db
    .select({ id: dossiers.id, status: dossiers.status })
    .from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
  if (!before) return { transitioned: false };
  if (before.status !== "incomplet") return { transitioned: false };
  try {
    const res = await changeDossierStatus(dossierId, "pre_instruction", actorId, {
      eventType: "auto_reexamen_complete",
      reason: "nouveau dépôt de pièce par le pétitionnaire",
    });
    return { transitioned: res.changed };
  } catch (err) {
    if (err instanceof WorkflowError && err.code === "INVALID_TRANSITION") return { transitioned: false };
    throw err;
  }
}

export async function autoAdvanceIfAllPiecesValid(
  dossierId: string,
  actorId: string | null,
): Promise<{ transitioned: boolean; date_completude?: Date | null }> {
  const [before] = await db
    .select().from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
  if (!before) return { transitioned: false };
  if (before.status !== "pre_instruction") return { transitioned: false };

  const pieces = await db
    .select({
      id: dossier_pieces_jointes.id,
      status: dossier_pieces_jointes.instructeur_status,
    })
    .from(dossier_pieces_jointes)
    .where(eq(dossier_pieces_jointes.dossier_id, dossierId));

  // Garde-fous :
  //  - au moins une pièce déposée (évite l'auto-bascule sur dossier vide)
  //  - toutes les pièces sont explicitement "valide" (acceptable / null /
  //    rejete / complement_demande bloquent la bascule)
  if (pieces.length === 0) return { transitioned: false };
  if (pieces.some((p) => p.status !== "valide")) return { transitioned: false };

  const now = new Date();
  const completude = before.date_completude ?? now;

  try {
    const res = await changeDossierStatus(dossierId, "en_instruction", actorId, {
      eventType: "auto_dossier_complet",
      reason: "toutes les pièces validées par l'instructeur",
      extraMetadata: { pieces_count: pieces.length },
    });

    if (res.changed) {
      // Pose date_completude (si elle n'existait pas) et recalcule l'échéance
      // depuis cette date — c'est le point juridique : le délai légal court à
      // partir du dossier déclaré complet (R.423-23).
      const patch: Record<string, unknown> = { updated_at: now };
      if (!before.date_completude) patch.date_completude = completude;
      const meta = (before.metadata as DeadlineMetadata | null) ?? null;
      const servitudes = (meta as { servitudes?: DeadlineServitude[] } | null)?.servitudes ?? null;
      const calc = computeInstructionDelay(before.type, meta, servitudes);
      patch.date_limite_instruction = applyMonthsToDate(new Date(completude), calc.total_mois);
      patch.metadata = {
        ...((before.metadata as Record<string, unknown>) ?? {}),
        delai: {
          total_mois: calc.total_mois,
          breakdown: calc.breakdown,
          base_date: new Date(completude).toISOString(),
          base_date_source: "completude",
          computed_at: now.toISOString(),
        },
      };
      await db.update(dossiers).set(patch).where(eq(dossiers.id, dossierId));
    }

    return { transitioned: res.changed, date_completude: completude };
  } catch (err) {
    if (err instanceof WorkflowError && err.code === "INVALID_TRANSITION") return { transitioned: false };
    throw err;
  }
}
