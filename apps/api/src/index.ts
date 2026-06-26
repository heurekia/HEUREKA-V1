import "dotenv/config";
// Importé AVANT app.js : l'init Sentry (si SENTRY_DSN défini) s'exécute tôt, une
// fois dotenv chargé. No-op sans DSN. Voir src/sentry.ts.
import "./sentry.js";
import { app } from "./app.js";
import { startScheduledJobs } from "./jobs/scheduler.js";
import { probeAiUsageTable, probePdfTooling } from "./services/aiUsage.js";
import { warmCodeTocCache } from "./services/legifrance.js";

const PORT = Number(process.env.PORT ?? 3001);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 HEUREKA V1 API running on http://0.0.0.0:${PORT}`);
  startScheduledJobs();
  void probeAiUsageTable();
  // Vérifie poppler-utils (pdftoppm/pdftotext) : sans lui l'OCR de toute pièce
  // PDF échoue silencieusement. Sonde au boot pour le signaler clairement.
  probePdfTooling();
  // Pré-chauffe les tables des matières des codes utilisés par le
  // moteur de classification et l'admin — évite que le premier "↻
  // Légifrance" du jour timeoute (TOC du CU = plusieurs Mo).
  warmCodeTocCache("CU");
  warmCodeTocCache("CCH");
  warmCodeTocCache("CE");
});

// Timeouts serveur HTTP. Node ne borne pas la durée totale d'une requête au-delà
// de ses défauts, et derrière nginx un `keepAliveTimeout` trop court provoque des
// 502 sporadiques (course à la fermeture de socket côté upstream). On fixe donc
// explicitement :
//  - keepAliveTimeout > au keepalive upstream de nginx (60s) pour éviter ces 502 ;
//  - headersTimeout > keepAliveTimeout (exigé par Node) — borne le slowloris d'en-têtes ;
//  - requestTimeout : durée max d'une requête complète (corps inclus). Généreux car
//    les uploads de pièces/PLU peuvent être volumineux sur lien lent ; configurable.
server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS ?? 65_000);
server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS ?? 66_000);
server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 300_000);

// Graceful shutdown. Sans ça, systemd envoie SIGTERM lors d'un
// `systemctl restart` (déploiement ou rotation logs), Node sort en code 143,
// pnpm rapporte ELIFECYCLE et l'unité est marquée failed alors que c'est un
// arrêt normal demandé par l'orchestrateur.
function shutdown(signal: NodeJS.Signals) {
  console.log(`[shutdown] ${signal} reçu — fermeture HTTP…`);
  const force = setTimeout(() => {
    console.warn("[shutdown] timeout 10s — force exit");
    process.exit(0);
  }, 10_000);
  force.unref();
  server.close((err) => {
    if (err) console.error("[shutdown] server.close error:", err);
    else console.log("[shutdown] HTTP fermé proprement");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
