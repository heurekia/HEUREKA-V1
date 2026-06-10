import cron from "node-cron";
import { db } from "../db.js";
import { audit_logs, dossiers, dossier_pieces_jointes } from "@heureka-v1/db";
import { sql, eq, lt, and } from "drizzle-orm";
import { getStorageProvider } from "../services/storage.js";

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
        .where(sql`${dossier_pieces_jointes.dossier_id} = ANY(${draftIds})`);
      const keys = pieces
        .map((p) => p.url)
        .filter((u): u is string => !!u)
        .map((u) => storage.keyFromUrl(u));
      const { deleted: filesDeleted, failed: filesFailed } = await storage.removeBulk(keys);
      if (filesFailed > 0) {
        console.warn(`[cron] purge brouillons : ${filesFailed} fichiers en échec sur ${keys.length}`);
      }

      // 3) Supprimer en cascade (dossier → pieces, messages, notifications).
      await db.delete(dossiers).where(sql`${dossiers.id} = ANY(${draftIds})`);
      console.log(`[cron] Purged ${oldDrafts.length} brouillon dossier(s) > ${DRAFT_DOSSIER_RETENTION_DAYS} days (+ ${filesDeleted} files)`);
    } catch (err) {
      console.error("[cron] draft purge failed:", err);
    }
  });

  console.log(`[cron] Scheduled jobs started — audit_logs:${AUDIT_LOG_RETENTION_MONTHS}m, drafts:${DRAFT_DOSSIER_RETENTION_DAYS}d`);
}
