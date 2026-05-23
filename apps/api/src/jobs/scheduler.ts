import cron from "node-cron";
import { db } from "../db.js";
import { audit_logs } from "@heureka-v1/db";
import { sql } from "drizzle-orm";

export function startScheduledJobs() {
  // Daily at 02:00 — purge audit_logs older than 12 months (CCSC §4.14)
  cron.schedule("0 2 * * *", async () => {
    try {
      const result = await db.delete(audit_logs)
        .where(sql`created_at < now() - interval '12 months'`)
        .returning({ id: audit_logs.id });
      if (result.length > 0) {
        console.log(`[cron] Purged ${result.length} audit_log entries older than 12 months`);
      }
    } catch (err) {
      console.error("[cron] audit_logs purge failed:", err);
    }
  });

  console.log("[cron] Scheduled jobs started");
}
