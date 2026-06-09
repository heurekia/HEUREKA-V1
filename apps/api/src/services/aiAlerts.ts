import { eq, gte, sql } from "drizzle-orm";
import { db } from "../db.js";
import { ai_alert_config, ai_usage_events } from "@heureka-v1/db";

// Cache de la config : on évite un SELECT à chaque appel IA. Invalidé par
// `invalidateAiAlertConfigCache()` quand l'admin sauve une nouvelle config.
let _configCache: typeof ai_alert_config.$inferSelect | null | undefined = undefined;
let _configCacheAt = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateAiAlertConfigCache(): void {
  _configCache = undefined;
  _configCacheAt = 0;
}

async function loadConfig(): Promise<typeof ai_alert_config.$inferSelect | null> {
  if (_configCache !== undefined && Date.now() - _configCacheAt < CACHE_TTL_MS) {
    return _configCache;
  }
  const [row] = await db.select().from(ai_alert_config).where(eq(ai_alert_config.id, 1)).limit(1);
  _configCache = row ?? null;
  _configCacheAt = Date.now();
  return _configCache;
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: Array<{ type: string; text: string }>;
}

async function postToSlack(webhookUrl: string, text: string, blocks?: SlackBlock[]): Promise<boolean> {
  try {
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks }),
      // Évite que Slack bloque l'event loop si la réponse traîne.
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch (err) {
    console.error("[aiAlerts] Slack webhook failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

function fmtEur(v: number): string {
  if (v < 0.01) return `${(v * 100).toFixed(2)} c€`;
  return `${v.toFixed(v < 1 ? 3 : 2)} €`;
}

interface EventInfo {
  purpose: string;
  model: string;
  cost_eur: number;
  dossier_id: string | null;
  commune_id: string | null;
}

/**
 * Vérifie les seuils après l'insertion d'un événement, et envoie un ping Slack
 * si nécessaire. Non bloquant — toute erreur est loggée et avalée.
 */
export async function maybeNotify(event: EventInfo): Promise<void> {
  try {
    const cfg = await loadConfig();
    if (!cfg || !cfg.slack_webhook_url) return;

    // 1) Seuil par appel
    if (cfg.per_call_threshold_eur != null && event.cost_eur >= cfg.per_call_threshold_eur) {
      await postToSlack(
        cfg.slack_webhook_url,
        `🤖 Alerte coût IA : un appel a coûté ${fmtEur(event.cost_eur)} (seuil : ${fmtEur(cfg.per_call_threshold_eur)})`,
        [
          { type: "section", text: { type: "mrkdwn", text: `*🤖 Coût IA — appel coûteux détecté*\nUn seul appel a atteint *${fmtEur(event.cost_eur)}* (seuil configuré : ${fmtEur(cfg.per_call_threshold_eur)}).` } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Usage*\n${event.purpose}` },
              { type: "mrkdwn", text: `*Modèle*\n\`${event.model}\`` },
              ...(event.dossier_id ? [{ type: "mrkdwn", text: `*Dossier*\n\`${event.dossier_id.slice(0, 8)}…\`` }] : []),
            ],
          },
        ],
      );
    }

    // 2) Seuil journalier cumulé
    if (cfg.daily_threshold_eur != null) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Cooldown : pas re-ping si déjà fait aujourd'hui.
      const alreadyNotifiedToday = cfg.daily_last_notified_at && cfg.daily_last_notified_at >= todayStart;
      if (!alreadyNotifiedToday) {
        const [today] = await db
          .select({ cost_eur: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)` })
          .from(ai_usage_events)
          .where(gte(ai_usage_events.created_at, todayStart));
        const todayCost = Number(today?.cost_eur ?? 0);
        if (todayCost >= cfg.daily_threshold_eur) {
          const ok = await postToSlack(
            cfg.slack_webhook_url,
            `🤖 Alerte coût IA : seuil journalier dépassé — ${fmtEur(todayCost)} aujourd'hui (seuil : ${fmtEur(cfg.daily_threshold_eur)})`,
            [
              { type: "section", text: { type: "mrkdwn", text: `*🤖 Coût IA — seuil journalier dépassé*\n*${fmtEur(todayCost)}* consommés aujourd'hui (seuil : ${fmtEur(cfg.daily_threshold_eur)}).` } },
            ],
          );
          if (ok) {
            await db.update(ai_alert_config)
              .set({ daily_last_notified_at: new Date(), updated_at: new Date() })
              .where(eq(ai_alert_config.id, 1));
            invalidateAiAlertConfigCache();
          }
        }
      }
    }
  } catch (err) {
    console.error("[aiAlerts] maybeNotify failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Envoie un message de test au webhook configuré.
 */
export async function sendTestNotification(webhookUrl: string): Promise<boolean> {
  return postToSlack(
    webhookUrl,
    "🤖 Test — alertes coûts IA actives sur HEUREKIA. Tu recevras une notification ici dès qu'un seuil sera dépassé.",
  );
}
