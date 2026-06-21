import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
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

export const app = express();

// Trust the first proxy (nginx en frontal du VPS OVH) so rate-limiters see the real client IP
app.set("trust proxy", 1);

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
      imgSrc: ["'self'", "data:", "blob:", "https://data.geopf.fr", "https://*.basemaps.cartocdn.com", "https://*.tile.openstreetmap.org"],
      connectSrc: ["'self'", "https://data.geopf.fr", "https://api-adresse.data.gouv.fr", "https://geo.api.gouv.fr"],
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
// PLU ingestion uploads a base64-encoded PDF. base64 inflates the file by ~33 %,
// so a 60 MB body only fit a ~45 MB PDF — too small for an intercommunal PLUi
// règlement, which returned 413 (PayloadTooLargeError). 150 MB leaves room for a
// ~110 MB PDF. Parsed first so the 2 MB global parser below skips it (body-parser
// won't re-parse an already-parsed request).
// NB : la limite proxy nginx (client_max_body_size) doit être ≥ cette valeur,
// sinon nginx renvoie le 413 avant même d'atteindre Express.
app.use("/api/mairie/admin/ingest-plu-pdf", express.json({ limit: "150mb" }));
// Référentiel documentaire commune (OAP, PPRI, PEB…) : PDFs envoyés en base64.
app.use("/api/mairie/documents", express.json({ limit: "60mb" }));
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

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, "../../web/dist");

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
app.use(express.static(frontendDist, {
  maxAge: "1y",
  immutable: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));

app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(frontendDist, "index.html"));
});
