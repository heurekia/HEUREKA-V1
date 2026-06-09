import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { audit_logs, communes, dossiers, dossier_pieces_jointes } from "@heureka-v1/db";
import { sql, eq, lt, and, or, isNull } from "drizzle-orm";
import { refreshPluZones, PLU_REFRESH_AFTER_MS } from "../services/pluZones.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

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

      // 2) Récupérer leurs pièces pour effacer les fichiers physiques.
      const pieces = await db.select({ url: dossier_pieces_jointes.url })
        .from(dossier_pieces_jointes)
        .where(sql`${dossier_pieces_jointes.dossier_id} = ANY(${draftIds})`);
      let filesDeleted = 0;
      for (const p of pieces) {
        const filename = p.url?.split("/").pop();
        if (!filename) continue;
        try {
          fs.unlinkSync(path.join(UPLOADS_DIR, filename));
          filesDeleted++;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            console.warn(`[cron] échec suppression fichier ${filename}:`, err);
          }
        }
      }

      // 3) Supprimer en cascade (dossier → pieces, messages, notifications).
      await db.delete(dossiers).where(sql`${dossiers.id} = ANY(${draftIds})`);
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

  console.log(`[cron] Scheduled jobs started — audit_logs:${AUDIT_LOG_RETENTION_MONTHS}m, drafts:${DRAFT_DOSSIER_RETENTION_DAYS}d`);
}
