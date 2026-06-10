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
}

export async function assignInstructeur(
  dossierId: string,
  instructeurId: string,
  actorId: string | null,
  opts: AssignOptions = {},
): Promise<{ changed: boolean; previous_instructeur_id: string | null }> {
  const [before] = await db
    .select({ id: dossiers.id, instructeur_id: dossiers.instructeur_id })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);
  if (!before) throw new WorkflowError("DOSSIER_NOT_FOUND", "Dossier non trouvé");

  const [target] = await db
    .select({ id: users.id, role: users.role, prenom: users.prenom, nom: users.nom })
    .from(users)
    .where(eq(users.id, instructeurId))
    .limit(1);
  if (!target) throw new WorkflowError("ASSIGNEE_NOT_FOUND", "Utilisateur cible inconnu");
  if (!ASSIGNABLE_ROLES.has(target.role)) {
    throw new WorkflowError(
      "INVALID_ASSIGNEE",
      "Cet utilisateur ne peut pas être désigné comme instructeur",
    );
  }

  if (before.instructeur_id === instructeurId) {
    return { changed: false, previous_instructeur_id: before.instructeur_id };
  }

  await db
    .update(dossiers)
    .set({ instructeur_id: instructeurId, updated_at: new Date() })
    .where(eq(dossiers.id, dossierId));

  const targetName = [target.prenom, target.nom].filter(Boolean).join(" ").trim() || target.id;
  await db.insert(instruction_events).values({
    dossier_id: dossierId,
    type: before.instructeur_id ? "instructeur_reassigned" : "instructeur_assigned",
    user_id: actorId,
    description: before.instructeur_id
      ? `Dossier réassigné à ${targetName}`
      : `Dossier pris en charge par ${targetName}`,
    metadata: {
      previous_instructeur_id: before.instructeur_id,
      new_instructeur_id: instructeurId,
      reason: opts.reason ?? null,
    },
  });

  return { changed: true, previous_instructeur_id: before.instructeur_id };
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
