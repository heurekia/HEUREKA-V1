import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { publicRouter } from "./routes/public.js";
import { authRouter } from "./routes/auth.js";
import { dossiersRouter } from "./routes/dossiers.js";
import { mairieRouter } from "./routes/mairie.js";
import { calibrationRouter } from "./routes/calibration.js";
import { calendrierRouter } from "./routes/calendrier.js";
import { notificationsRouter } from "./routes/notifications.js";
import { superAdminRouter } from "./routes/superAdmin.js";
import { serviceRouter } from "./routes/service.js";
import { decisionsRouter } from "./routes/decisions.js";

export const app = express();

// Trust the first proxy (Railway, Render, etc.) so rate-limiters see the real client IP
app.set("trust proxy", 1);

app.use(compression());
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
  process.env.FRONTEND_URLS ?? process.env.FRONTEND_URL ?? process.env.RAILWAY_STATIC_URL ?? "http://localhost:5173"
).split(",").map((s) => s.trim());

app.use(cors({
  origin(origin, cb) {
    if (!origin || _allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "2mb" }));

app.use("/api/public", publicRouter);
app.use("/api/auth", authRouter);
app.use("/api/dossiers", dossiersRouter);
app.use("/api/mairie", mairieRouter);
app.use("/api/calibration", calibrationRouter);
app.use("/api/calendrier", calendrierRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/admin", superAdminRouter);
app.use("/api/service", serviceRouter);
app.use("/api/decisions", decisionsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

// Unknown API routes must return a JSON 404 — not the SPA's index.html.
// Otherwise a typo'd or removed endpoint silently serves HTML, which the
// frontend then fails to parse as JSON (confusing "Unexpected token <" errors).
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Route introuvable" });
});


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, "../../web/dist");
const uploadsDir = path.resolve(__dirname, "../uploads");

// Uploaded files — no-cache so the client always gets the latest version
app.use("/api/uploads", express.static(uploadsDir, { maxAge: 0 }));

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
