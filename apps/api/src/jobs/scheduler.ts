import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { audit_logs, communes, dossiers, dossier_pieces_jointes, user_absences } from "@heureka-v1/db";
import { sql, eq, lt, lte, gte, and, or, isNull, inArray } from "drizzle-orm";
import { getStorageProvider } from "../services/storage.js";
import { refreshPluZones, PLU_REFRESH_AFTER_MS } from "../services/pluZones.js";
import { resolveEffectiveInstructeur } from "../services/absenceDelegation.js";
import { assignInstructeur } from "../services/dossierWorkflow.js";
import { maybeNotifyDossierReady } from "../services/pieceOcrQueue.js";

// Rétention paramétrable. Valeurs par défaut alignées sur la politique de
// confidentialité publique et les exigences DSI Tours (CCSC).
const AUDIT_LOG_RETENTION_MONTHS = Number(process.env.AUDIT_LOG_RETENTION_MONTHS ?? "12");
const DRAFT_DOSSIER_RETENTION_DAYS = Number(process.env.DRAFT_DOSSIER_RETENTION_DAYS ?? "180");

export function startScheduledJobs() {
  // Daily at 02:00 — purge audit_logs > 12 mois (CCSC §4.14 + RGPD art. 5.1.e).
  cron.schedule("0 2 * * *", async () => {
    try {
      const result = await db.delete(audit_logs)
        .where(sql`created_at < now() - (${AUDIT_LOG_RETENTION_MONTHS}::text || ' months')::interval`)
        .returning({ id: audit_logs.id });
      if (result.length > 0) {
        console.log(`[cron] Purged ${result.length} audit_log entries older than ${AUDIT_LOG_RETENTION_MONTHS} months`);
      }
    } catch (err) {
      console.error("[cron] audit_logs purge failed:", err);
    }
  });

  // Daily at 02:30 — purge des dossiers BROUILLON abandonnés > 180 jours.
  // RGPD art. 5.1.e (limitation de la conservation) : un brouillon jamais
  // soumis n'a pas vocation à rester indéfiniment en base. On supprime
  // aussi les fichiers physiques associés pour éviter les orphelins.
  cron.schedule("30 2 * * *", async () => {
    try {
      // 1) Identifier les dossiers brouillon trop vieux.
      const oldDrafts = await db.select({ id: dossiers.id })
        .from(dossiers)
        .where(and(
          eq(dossiers.status, "brouillon"),
          lt(dossiers.updated_at, sql`now() - (${DRAFT_DOSSIER_RETENTION_DAYS}::text || ' days')::interval`),
        ));
      if (oldDrafts.length === 0) return;

      const draftIds = oldDrafts.map((d) => d.id);

      // 2) Récupérer leurs pièces pour effacer les fichiers physiques via
      // l'abstraction StorageProvider (local OU S3-compatible).
      const storage = getStorageProvider();
      const pieces = await db.select({ url: dossier_pieces_jointes.url })
        .from(dossier_pieces_jointes)
        .where(inArray(dossier_pieces_jointes.dossier_id, draftIds));
      const keys = pieces
        .map((p) => p.url)
        .filter((u): u is string => !!u)
        .map((u) => storage.keyFromUrl(u));
      const { deleted: filesDeleted, failed: filesFailed } = await storage.removeBulk(keys);
      if (filesFailed > 0) {
        console.warn(`[cron] purge brouillons : ${filesFailed} fichiers en échec sur ${keys.length}`);
      }

      // 3) Supprimer en cascade (dossier → pieces, messages, notifications).
      await db.delete(dossiers).where(inArray(dossiers.id, draftIds));
      console.log(`[cron] Purged ${oldDrafts.length} brouillon dossier(s) > ${DRAFT_DOSSIER_RETENTION_DAYS} days (+ ${filesDeleted} files)`);
    } catch (err) {
      console.error("[cron] draft purge failed:", err);
    }
  });

  // Daily at 03:00 — refresh PLU zones whose DB cache is older than 30 days.
  // Évite que la 1ère ouverture de l'onglet Carte tombe sur un cold-fetch (10-30s).
  cron.schedule("0 3 * * *", async () => {
    try {
      const threshold = new Date(Date.now() - PLU_REFRESH_AFTER_MS);
      const stale = await db.select({ insee_code: communes.insee_code })
        .from(communes)
        .where(or(
          isNull(communes.plu_zones_cached_at),
          lt(communes.plu_zones_cached_at, threshold),
        ));
      if (stale.length === 0) return;
      console.log(`[cron] PLU refresh: ${stale.length} commune(s) à rafraîchir`);
      // Séquentiel + délai entre appels pour rester poli avec apicarto.ign.fr
      let ok = 0, ko = 0;
      for (const row of stale) {
        if (!row.insee_code) continue;
        const r = await refreshPluZones(row.insee_code);
        if (r.ok) ok++; else ko++;
        await new Promise(res => setTimeout(res, 1500));
      }
      console.log(`[cron] PLU refresh terminé : ${ok} OK, ${ko} échec(s)`);
    } catch (err) {
      console.error("[cron] PLU refresh failed:", err);
    }
  });

  // Daily at 04:00 — redirection des dossiers en cours pendant l'absence d'un
  // instructeur. On cible les dossiers dont l'échéance d'instruction tombe
  // entre aujourd'hui et la fin de l'absence : ils risquent d'expirer sans
  // que quelqu'un ne s'en occupe. Les nouveaux dossiers attribués pendant
  // l'absence sont déjà redirigés à l'assignation par `assignInstructeur`.
  cron.schedule("0 4 * * *", async () => {
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const activeAbsences = await db
        .select({
          user_id: user_absences.user_id,
          end_date: user_absences.end_date,
        })
        .from(user_absences)
        .where(and(
          lte(user_absences.start_date, todayIso),
          gte(user_absences.end_date, todayIso),
        ));

      if (activeAbsences.length === 0) return;

      const TERMINAL = ["accepte", "refuse", "accord_prescription"] as const;
      let redirectedCount = 0;
      let skippedCount = 0;

      for (const abs of activeAbsences) {
        // Dossiers dont l'échéance tombe pendant l'absence (ou déjà dépassée
        // si l'instructeur est revenu en retard / vient de partir).
        const due = await db
          .select({ id: dossiers.id })
          .from(dossiers)
          .where(and(
            eq(dossiers.instructeur_id, abs.user_id),
            sql`${dossiers.status}::text NOT IN ('accepte','refuse','accord_prescription')`,
            sql`date(${dossiers.date_limite_instruction}) <= ${abs.end_date}`,
          ));

        for (const d of due) {
          const resolved = await resolveEffectiveInstructeur(abs.user_id, new Date());
          if (!resolved.redirected || resolved.instructeurId === abs.user_id) {
            skippedCount++;
            continue;
          }
          try {
            const r = await assignInstructeur(d.id, resolved.instructeurId, null, {
              reason: "Redirection automatique : échéance pendant l'absence",
              skipAbsenceRedirection: true,
            });
            if (r.changed) redirectedCount++;
          } catch (err) {
            console.error(`[cron] redirection dossier ${d.id} échouée:`, err);
          }
        }
      }

      if (redirectedCount > 0 || skippedCount > 0) {
        console.log(`[cron] Redirection absences : ${redirectedCount} dossier(s) redirigé(s), ${skippedCount} sans délégué disponible`);
      }
    } catch (err) {
      console.error("[cron] absence redirection failed:", err);
    }
  });

  // Toutes les minutes : balayage des dossiers comptoir mairie dont l'OCR est
  // resté coincé (worker tombé, restart process, LLM bloqué sans throw…).
  // maybeNotifyDossierReady fait elle-même le reap des pièces stale ET
  // déclenche la notif si tout est prêt — ce job n'a qu'à lui passer la liste
  // des dossiers susceptibles d'être bloqués.
  cron.schedule("* * * * *", async () => {
    try {
      const rows = await db.execute<{ id: string }>(sql`
        SELECT DISTINCT d.id
          FROM dossiers d
          JOIN dossier_pieces_jointes p ON p.dossier_id = d.id
         WHERE p.archived_at IS NULL
           AND p.ocr_status IN ('pending','processing')
           AND (d.metadata->>'mairie_pieces_ocr_notified_at') IS NULL
         LIMIT 50
      `);
      const dossierIds = (rows as unknown as { rows?: { id: string }[] }).rows
        ?? (rows as unknown as { id: string }[]);
      const ids: string[] = Array.isArray(dossierIds) ? dossierIds.map((r) => r.id) : [];
      for (const id of ids) {
        await maybeNotifyDossierReady(id).catch((err) => {
          console.warn(`[cron] sweep OCR pour ${id} a échoué:`, err instanceof Error ? `${err.name}: ${err.message}` : err);
        });
      }
    } catch (err) {
      console.error("[cron] sweep OCR pièces mairie a échoué:", err);
    }
  });

  console.log(`[cron] Scheduled jobs started — audit_logs:${AUDIT_LOG_RETENTION_MONTHS}m, drafts:${DRAFT_DOSSIER_RETENTION_DAYS}d`);
}
