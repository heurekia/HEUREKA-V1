import { Registry, Histogram, Counter, collectDefaultMetrics } from "prom-client";
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger.js";

// ── Observabilité : métriques Prometheus (durcissement § 2.3) ────────────────
//
// Expose /metrics au format Prometheus. Couvre :
//  - les métriques process PAR DÉFAUT de prom-client : `nodejs_eventloop_lag_*`
//    (le signal direct des gels event loop traités au § 1.3b), `process_resident_
//    memory_bytes` / heap (à corréler au `max_memory_restart` pm2), GC, handles… ;
//  - la durée et le nombre des requêtes HTTP, labellés méthode / route / statut.
//
// Sécurité : /metrics divulgue des infos internes (routes, volumétrie, mémoire).
// En prod il NE doit PAS être public. Si `METRICS_TOKEN` est défini, on exige
// `Authorization: Bearer <token>` (ou `?token=`). Sinon on sert quand même (pour
// un déploiement où nginx restreint déjà l'accès) mais on loggue un
// avertissement — cf. docs/durcissement-production.md § 5.

export const registry = new Registry();
registry.setDefaultLabels({ app: "heurekia-api" });
collectDefaultMetrics({ register: registry });

const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Durée des requêtes HTTP, en secondes",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

const httpTotal = new Counter({
  name: "http_requests_total",
  help: "Nombre total de requêtes HTTP traitées",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

// Label de route = PATTERN Express (`baseUrl` + `route.path`), surtout PAS le
// chemin brut : sinon chaque id de dossier/pièce créerait une série distincte
// (explosion de cardinalité Prometheus). Fallback prudent (2 premiers segments)
// pour les requêtes non routées (404, middleware).
function routeLabel(req: Request): string {
  const base = req.baseUrl || "";
  const sub = req.route?.path;
  if (typeof sub === "string") return (base + (sub === "/" ? "" : sub)) || "/";
  return req.path.split("/").slice(0, 3).join("/") || "/";
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/metrics") return next(); // on ne mesure pas le scraper lui-même
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) };
    end(labels);
    httpTotal.inc(labels);
  });
  next();
}

let warnedNoToken = false;
export async function metricsHandler(req: Request, res: Response) {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const provided = bearer ?? (typeof req.query.token === "string" ? req.query.token : undefined);
    if (provided !== token) {
      return res.status(401).type("text/plain").send("unauthorized");
    }
  } else if (!warnedNoToken) {
    warnedNoToken = true;
    logger.warn("/metrics exposé sans METRICS_TOKEN — restreindre l'accès via nginx ou définir METRICS_TOKEN");
  }
  res.set("Content-Type", registry.contentType);
  res.send(await registry.metrics());
}
