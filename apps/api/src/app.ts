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

export const app = express();

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
app.use(cors({ origin: process.env.FRONTEND_URL ?? process.env.RAILWAY_STATIC_URL ?? "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "50mb" }));

app.use("/api/public", publicRouter);
app.use("/api/auth", authRouter);
app.use("/api/dossiers", dossiersRouter);
app.use("/api/mairie", mairieRouter);
app.use("/api/calibration", calibrationRouter);
app.use("/api/calendrier", calendrierRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/admin", superAdminRouter);
app.use("/api/service", serviceRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

// ── PISTE diagnostic (temporary public route — remove after debug) ────────────
app.get("/api/piste-diag", async (_req, res) => {
  const OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
  const API_BASE  = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";
  const r: Record<string, unknown> = {};

  const cid = process.env.PISTE_CLIENT_ID ?? "";
  const csec = process.env.PISTE_CLIENT_SECRET ?? "";
  const akey = process.env.PISTE_API_KEY ?? "";
  const skey = process.env.PISTE_SECRET_KEY ?? "";

  const tryOAuth = async (label: string, hdrs: Record<string, string>, body: Record<string, string>) => {
    try {
      const resp = await fetch(OAUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...hdrs }, body: new URLSearchParams(body), signal: AbortSignal.timeout(8000) });
      const txt = await resp.text();
      r[label] = { status: resp.status, body: txt.slice(0, 300) };
      return resp.ok ? (JSON.parse(txt) as { access_token: string }).access_token : null;
    } catch (e) { r[label] = { error: String(e) }; return null; }
  };

  const trySearch = async (label: string, hdrs: Record<string, string>) => {
    try {
      const resp = await fetch(`${API_BASE}/search`, { method: "POST", headers: { "Content-Type": "application/json", accept: "application/json", ...hdrs }, body: JSON.stringify({ recherche: { champs: [{ typeChamp: "NUM_ARTICLE", criteres: [{ typeRecherche: "EXACTE", valeur: "L424-1", operateur: "ET" }], operateur: "ET" }], filtres: [{ facette: "NOM_CODE", valeurs: ["Code de l’urbanisme"] }, { facette: "DATE_VERSION", singleDate: Date.now() }], pageNumber: 1, pageSize: 1, operateur: "ET", sort: "PERTINENCE", typePagination: "ARTICLE" }, fond: "CODE_DATE" }), signal: AbortSignal.timeout(8000) });
      const txt = await resp.text();
      r[label] = { status: resp.status, body: txt.slice(0, 400) };
    } catch (e) { r[label] = { error: String(e) }; }
  };

  // OAuth attempts
  const t1 = await tryOAuth("1_body_cid_scope",   {}, { grant_type: "client_credentials", client_id: cid,  client_secret: csec, scope: "openid" });
  const t2 = await tryOAuth("2_body_cid_noscope",  {}, { grant_type: "client_credentials", client_id: cid,  client_secret: csec });
  const t3 = await tryOAuth("3_body_akey_scope",   {}, { grant_type: "client_credentials", client_id: akey, client_secret: skey, scope: "openid" });
  const t4 = await tryOAuth("4_body_akey_noscope", {}, { grant_type: "client_credentials", client_id: akey, client_secret: skey });
  const t5 = await tryOAuth("5_basic_cid",  { Authorization: `Basic ${Buffer.from(`${cid}:${csec}`).toString("base64")}` },  { grant_type: "client_credentials" });
  const t6 = await tryOAuth("6_basic_akey", { Authorization: `Basic ${Buffer.from(`${akey}:${skey}`).toString("base64")}` }, { grant_type: "client_credentials" });

  // API key only (no OAuth)
  await trySearch("7_apikey_only",  { "X-Gravitee-Api-Key": akey });
  await trySearch("8_secretkey_only", { "X-Gravitee-Api-Key": skey });

  // Search with first working token
  const tok = t1 ?? t2 ?? t3 ?? t4 ?? t5 ?? t6;
  if (tok) await trySearch("9_bearer_token", { Authorization: `Bearer ${tok}`, "X-Gravitee-Api-Key": akey });

  res.json({ env: { PISTE_CLIENT_ID: cid ? "✓" : "✗", PISTE_CLIENT_SECRET: csec ? "✓" : "✗", PISTE_API_KEY: akey ? "✓" : "✗", PISTE_SECRET_KEY: skey ? "✓" : "✗" }, results: r });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, "../../web/dist");

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
