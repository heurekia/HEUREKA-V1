import "dotenv/config";
import { app } from "./app.js";
import { startScheduledJobs } from "./jobs/scheduler.js";
import { probeAiUsageTable } from "./services/aiUsage.js";
import { warmCodeTocCache } from "./services/legifrance.js";

const PORT = Number(process.env.PORT ?? 3001);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 HEUREKA V1 API running on http://0.0.0.0:${PORT}`);
  startScheduledJobs();
  void probeAiUsageTable();
  // Pré-chauffe les tables des matières des codes utilisés par le
  // moteur de classification et l'admin — évite que le premier "↻
  // Légifrance" du jour timeoute (TOC du CU = plusieurs Mo).
  warmCodeTocCache("CU");
  warmCodeTocCache("CCH");
  warmCodeTocCache("CE");
});

// Graceful shutdown. Sans ça, Railway envoie SIGTERM pendant un rolling
// deploy, Node sort en code 143, pnpm rapporte ELIFECYCLE et Railway lève
// une alerte "crash" alors que c'est un arrêt normal demandé par la plateforme.
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
