// Résolution de la chaîne de délégation en cas d'absence.
//
// Lorsqu'un dossier doit être attribué à un instructeur X, on vérifie si X est
// en absence à la date de référence. Si oui, on parcourt sa chaîne de délégués
// (ordonnée par priorité croissante) et on retourne le premier qui n'est pas
// lui-même en absence à la même date. Si la chaîne se termine sans candidat
// disponible, on retombe sur l'instructeur initial (l'absence ne doit jamais
// laisser un dossier sans propriétaire).

import { db } from "../db.js";
import { user_absences, user_delegations } from "@heureka-v1/db";
import { and, asc, eq, lte, gte } from "drizzle-orm";

export interface ResolveResult {
  instructeurId: string;
  redirected: boolean;
  chain: string[]; // ids parcourus (incluant l'origine), du plus prioritaire au final
  originalUserId: string;
}

// Format YYYY-MM-DD (les colonnes user_absences sont en type date).
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function isAbsentOn(userId: string, isoDate: string): Promise<boolean> {
  const rows = await db
    .select({ id: user_absences.id })
    .from(user_absences)
    .where(
      and(
        eq(user_absences.user_id, userId),
        lte(user_absences.start_date, isoDate),
        gte(user_absences.end_date, isoDate),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function listDelegates(userId: string): Promise<string[]> {
  const rows = await db
    .select({ delegate_user_id: user_delegations.delegate_user_id })
    .from(user_delegations)
    .where(eq(user_delegations.user_id, userId))
    .orderBy(asc(user_delegations.priority));
  return rows.map((r) => r.delegate_user_id);
}

export async function resolveEffectiveInstructeur(
  userId: string,
  date: Date = new Date(),
): Promise<ResolveResult> {
  const iso = toIsoDate(date);
  const original = userId;
  const chain: string[] = [userId];

  // Évite les boucles si deux instructeurs se sont mutuellement délégué et sont
  // tous deux absents (cas limite improbable mais on borne).
  const seen = new Set<string>([userId]);
  let current = userId;

  // Tant que l'utilisateur courant est absent, on cherche le prochain délégué
  // disponible. On limite à 10 sauts pour ne jamais boucler indéfiniment.
  for (let i = 0; i < 10; i++) {
    if (!(await isAbsentOn(current, iso))) {
      return {
        instructeurId: current,
        redirected: current !== original,
        chain,
        originalUserId: original,
      };
    }
    const delegates = await listDelegates(current);
    const next = delegates.find((d) => !seen.has(d));
    if (!next) {
      // Chaîne épuisée : on retombe sur l'original (mieux que `null`).
      return {
        instructeurId: original,
        redirected: false,
        chain,
        originalUserId: original,
      };
    }
    chain.push(next);
    seen.add(next);
    current = next;
  }

  return {
    instructeurId: original,
    redirected: false,
    chain,
    originalUserId: original,
  };
}
