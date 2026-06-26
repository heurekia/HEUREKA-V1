/**
 * Logger applicatif structuré (pino).
 *
 * Pourquoi : jusqu'ici les logs étaient des `console.log`/`console.error` non
 * structurés — illisibles à agréger, sans corrélation par requête, sans niveau.
 * pino émet du JSON ligne par ligne (un événement = un objet), capté tel quel par
 * pm2/journald et n'importe quel agrégateur (Loki, Datadog…), avec un niveau et
 * un `reqId` de corrélation injectés par le middleware HTTP (cf. app.ts).
 *
 * Sortie JSON sur stdout (pas de transport worker-thread, pour rester robuste en
 * prod). En dev, piper la sortie dans `pino-pretty` pour la lisibilité :
 *   pnpm --filter @heureka-v1/api dev | npx pino-pretty
 *
 * Niveau via LOG_LEVEL (défaut: info en prod, debug ailleurs).
 */
import { pino } from "pino";

const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  // Redaction défensive : on ne veut jamais voir un jeton/cookie dans les logs,
  // même si un middleware tiers tente de logger les en-têtes.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
    ],
    remove: true,
  },
  // Horodatage ISO (plus lisible que l'epoch ms par défaut côté agrégateur).
  timestamp: pino.stdTimeFunctions.isoTime,
});
