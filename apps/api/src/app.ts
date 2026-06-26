import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "path";
import { FRONTEND_DIST_DIR } from "./paths.js";
import { publicRouter } from "./routes/public.js";
import { authRouter } from "./routes/auth.js";
import { franceConnectRouter } from "./routes/franceConnect.js";
import { dossiersRouter } from "./routes/dossiers.js";
import { mairieRouter } from "./routes/mairie/index.js";
import { calibrationRouter } from "./routes/calibration.js";
import { calendrierRouter } from "./routes/calendrier.js";
import { notificationsRouter } from "./routes/notifications.js";
import { superAdminRouter } from "./routes/superAdmin.js";
import { serviceRouter } from "./routes/service.js";
import { decisionsRouter } from "./routes/decisions.js";
import { regulatoryRouter } from "./routes/regulatory.js";
import { uploadsRouter } from "./routes/uploads.js";
import { client } from "@heureka-v1/db";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { metricsMiddleware, metricsHandler } from "./metrics.js";
import { setupSentryErrorHandler } from "./sentry.js";

export const app = express();

// Trust the first proxy (nginx en frontal du VPS OVH) so rate-limiters see the real client IP
app.set("trust proxy", 1);

// Log structuré de chaque requête (méthode, route, status, durée) avec un reqId
// de corrélation — réutilise le X-Request-Id de nginx s'il existe, sinon en
// génère un (renvoyé au client). Placé tôt pour couvrir toutes les routes ; le
// health-check est exclu pour ne pas noyer les logs sous le polling du gate.
app.use(pinoHttp({
  logger,
  genReqId: (req, res) => {
    const hdr = req.headers["x-request-id"];
    const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  autoLogging: {
    ignore: (req) => req.url === "/api/health" || req.url === "/api/health/live",
  },
}));

// Métriques Prometheus : chronomètre chaque requête (durée + compteur, labellés
// méthode/route/statut). Placé tôt pour englober tout le pipeline. Le endpoint
// d'exposition est /metrics (cf. plus bas). Voir src/metrics.ts.
app.use(metricsMiddleware);

// Skip compression for Server-Sent Events — gzip buffering would hold the
// stream and the client would receive nothing until the response ends.
app.use(compression({
  filter: (req, res) => {
    const ct = res.getHeader("Content-Type");
    if (typeof ct === "string" && ct.includes("text/event-stream")) return false;
    return compression.filter(req, res);
  },
}));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Tuiles cartographiques : IGN Géoplateforme uniquement (souverain). Les
      // anciens fonds OpenStreetMap/CARTO (serveurs hors UE) ont été retirés.
      imgSrc: ["'self'", "data:", "blob:", "https://data.geopf.fr"],
      connectSrc: ["'self'", "https://data.geopf.fr", "https://api-adresse.data.gouv.fr", "https://geo.api.gouv.fr"],
      // Vidéos embarquées dans les articles du Centre d'aide (YouTube/Vimeo).
      frameSrc: ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
      // Lectures vidéo/audio uploadées (data/blob) en plus du same-origin.
      mediaSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cookieParser());

const _allowedOrigins = (
  process.env.FRONTEND_URLS ?? process.env.FRONTEND_URL ?? "http://localhost:5173"
).split(",").map((s) => s.trim());

app.use(cors({
  origin(origin, cb) {
    if (!origin || _allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials: true,
}));
// PLU ingestion uploads one OR several base64-encoded PDFs (un PLUi peut être
// découpé en plusieurs fichiers : U/AU/A/N ou par tomes — cf. pdfs_base64).
// base64 inflates the file by ~33 %, and the body must fit the SUM of the files.
// 300 MB leaves room for several large règlements intercommunaux ; le NOMBRE de
// fichiers est par ailleurs plafonné côté route (cf. MAX_PDFS_PER_INGEST).
// Parsed first so the 2 MB global parser below skips it (body-parser won't
// re-parse an already-parsed request).
// NB : la limite proxy nginx (client_max_body_size) doit être ≥ cette valeur,
// sinon nginx renvoie le 413 avant même d'atteindre Express.
app.use("/api/mairie/admin/ingest-plu-pdf", express.json({ limit: "300mb" }));
// Référentiel documentaire commune (OAP, PPRI, PEB…) : PDFs envoyés en base64.
app.use("/api/mairie/documents", express.json({ limit: "60mb" }));
// Centre d'aide (super-admin) : articles avec images de couverture/illustrations
// en data URL base64 — la limite globale 2 Mo serait vite atteinte.
app.use("/api/admin/help", express.json({ limit: "30mb" }));
// Analyse d'article avec image (tableau/croquis) en base64.
app.use("/api/mairie/reglementation/structure-article", express.json({ limit: "15mb" }));
app.use(express.json({ limit: "2mb" }));

app.use("/api/public", publicRouter);
app.use("/api/auth", authRouter);
app.use("/api/auth/franceconnect", franceConnectRouter);
app.use("/api/dossiers", dossiersRouter);
app.use("/api/mairie", mairieRouter);
app.use("/api/calibration", calibrationRouter);
app.use("/api/calendrier", calendrierRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/admin", superAdminRouter);
app.use("/api/service", serviceRouter);
app.use("/api/decisions", decisionsRouter);
app.use("/api/regulatory", regulatoryRouter);

// Liveness : le process répond-il ? Superficiel et sans I/O — à utiliser pour
// un probe qui ne doit PAS tuer le process sur un simple incident DB transitoire.
app.get("/api/health/live", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

// Readiness / healthcheck PROFOND : vérifie que la base répond (SELECT 1 borné).
// Le gate de déploiement (deploy.yml) et tout uptime monitor externe doivent voir
// "degraded" (503) quand la DB est injoignable, plutôt qu'un faux "ok" qui
// laisserait passer un déploiement contre une base cassée ou marquerait l'app
// "up" alors qu'elle sert des 500. `curl -f` du gate échoue bien sur le 503.
app.get("/api/health", async (_req, res) => {
  try {
    await Promise.race([
      client`SELECT 1`,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("db healthcheck timeout")), 2000),
      ),
    ]);
    res.json({ status: "ok", db: "ok", version: "1.0.0" });
  } catch {
    res.status(503).json({ status: "degraded", db: "down", version: "1.0.0" });
  }
});

// Exposition Prometheus. À la RACINE (convention `/metrics`), enregistrée avant
// le catch-all SPA `app.get("*")` pour ne pas servir l'index.html à sa place.
// Protégée par METRICS_TOKEN si défini (cf. src/metrics.ts).
app.get("/metrics", metricsHandler);

// Fichiers déposés (pièces jointes des dossiers) — authentifié et vérifié
// par routes/uploads.ts (auth + scope commune / propriétaire).
// IMPORTANT : enregistré AVANT le catch-all `/api` ci-dessous.
app.use("/api/uploads", uploadsRouter);

// Unknown API routes must return a JSON 404 — not the SPA's index.html.
// Otherwise a typo'd or removed endpoint silently serves HTML, which the
// frontend then fails to parse as JSON (confusing "Unexpected token <" errors).
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Route introuvable" });
});

// Hashed JS/CSS assets → cache 1 year
app.use(express.static(FRONTEND_DIST_DIR, {
  maxAge: "1y",
  immutable: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
    // Images publiques (logo pour les signatures mail, visuels Open Graph) :
    // elles doivent pouvoir être chargées depuis une AUTRE origine (Gmail,
    // Zimbra, réseaux sociaux). Or Helmet pose par défaut
    // `Cross-Origin-Resource-Policy: same-origin`, ce qui fait annuler le
    // chargement du logo par les clients mail. On relâche donc CORP pour le
    // seul dossier /img ; le reste de l'app et l'API gardent la valeur stricte.
    if (filePath.replace(/\\/g, "/").includes("/img/")) {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    }
  },
}));

app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(FRONTEND_DIST_DIR, "index.html"));
});

// Handler d'erreurs Sentry — APRÈS toutes les routes (no-op si SENTRY_DSN absent).
// Capture les erreurs propagées via next(err) ; les crashs (uncaughtException /
// unhandledRejection) sont pris par les intégrations globales de Sentry.
setupSentryErrorHandler(app);
