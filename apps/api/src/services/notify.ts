// Service de notification interne — abstraction unique pour pousser des
// notifications visibles dans la cloche de la mairie (et plus tard d'autres
// canaux : email, SMS…).
//
// Priorité de ciblage pour un dossier :
//   1. instructeur explicitement assigné (dossiers.instructeur_id)
//   2. à défaut, tous les agents (rôles mairie/instructeur/admin) rattachés à
//      la commune du dossier via user_communes
//
// On déduplique sur le user_id pour éviter d'inonder un agent multi-communes.
// Toute erreur est avalée : une notification est non-bloquante par design.

import { db } from "../db.js";
import { notifications, dossiers, users, user_communes, communes } from "@heureka-v1/db";
import { and, eq, ilike, inArray } from "drizzle-orm";

export interface NotifyDossierInput {
  dossier_id: string;
  type: string;
  title: string;
  message: string;
  // Si fourni, on évite de notifier l'auteur de l'action (ex. instructeur qui
  // répond à lui-même).
  exclude_user_id?: string | null;
}

// Détermine la liste d'agents à notifier pour un dossier donné.
export async function resolveDossierRecipients(dossierId: string): Promise<string[]> {
  const [dossier] = await db
    .select({ id: dossiers.id, instructeur_id: dossiers.instructeur_id, commune: dossiers.commune })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);
  if (!dossier) return [];

  if (dossier.instructeur_id) {
    return [dossier.instructeur_id];
  }

  // Pas d'assigné : on retombe sur tous les agents de la commune.
  if (!dossier.commune) return [];
  const [commune] = await db
    .select({ id: communes.id })
    .from(communes)
    .where(ilike(communes.name, dossier.commune))
    .limit(1);
  if (!commune) return [];

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(user_communes, eq(user_communes.user_id, users.id))
    .where(and(
      eq(user_communes.commune_id, commune.id),
      inArray(users.role, ["mairie", "instructeur", "admin"]),
    ));

  return Array.from(new Set(rows.map((r) => r.id)));
}

// Retire les destinataires ayant explicitement désactivé ce type de
// notification (notification_prefs[type] === false). Clé absente = activé :
// par défaut un agent reçoit tout. Best-effort — si la lecture échoue on ne
// filtre rien (mieux vaut une notification de trop qu'une notification perdue).
async function filterByNotificationPref(userIds: string[], type: string): Promise<string[]> {
  if (userIds.length === 0) return [];
  try {
    const rows = await db
      .select({ id: users.id, prefs: users.notification_prefs })
      .from(users)
      .where(inArray(users.id, userIds));
    const optedOut = new Set(
      rows.filter((r) => r.prefs && r.prefs[type] === false).map((r) => r.id),
    );
    return userIds.filter((id) => !optedOut.has(id));
  } catch (err) {
    console.error("[notify] filterByNotificationPref a échoué:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    return userIds;
  }
}

export async function notifyDossierAgents(input: NotifyDossierInput): Promise<void> {
  try {
    let recipients = await resolveDossierRecipients(input.dossier_id);
    if (input.exclude_user_id) {
      recipients = recipients.filter((u) => u !== input.exclude_user_id);
    }
    recipients = await filterByNotificationPref(recipients, input.type);
    if (recipients.length === 0) return;
    await db.insert(notifications).values(
      recipients.map((user_id) => ({
        user_id,
        dossier_id: input.dossier_id,
        type: input.type,
        title: input.title,
        message: input.message,
      })),
    );
  } catch (err) {
    console.error("[notify] notifyDossierAgents a échoué:", err instanceof Error ? `${err.name}: ${err.message}` : err);
  }
}

// Notifie un utilisateur unique (ex. décision en attente de signature). Best-effort.
export async function notifyUser(input: { user_id: string; dossier_id?: string | null; type: string; title: string; message: string }): Promise<void> {
  try {
    const allowed = await filterByNotificationPref([input.user_id], input.type);
    if (allowed.length === 0) return;
    await db.insert(notifications).values({
      user_id: input.user_id,
      dossier_id: input.dossier_id ?? null,
      type: input.type,
      title: input.title,
      message: input.message,
    });
  } catch (err) {
    console.error("[notify] notifyUser a échoué:", err instanceof Error ? `${err.name}: ${err.message}` : err);
  }
}
