import express from "express";
import cors from "cors";
import { publicRouter } from "./routes/public.js";
import { authRouter } from "./routes/auth.js";
import { dossiersRouter } from "./routes/dossiers.js";
import { mairieRouter } from "./routes/mairie.js";
import { calibrationRouter } from "./routes/calibration.js";
import { calendrierRouter } from "./routes/calendrier.js";
import { notificationsRouter } from "./routes/notifications.js";

export const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL ?? process.env.RAILWAY_STATIC_URL ?? "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "10mb" }));

app.use("/api/public", publicRouter);
app.use("/api/auth", authRouter);
app.use("/api/dossiers", dossiersRouter);
app.use("/api/mairie", mairieRouter);
app.use("/api/calibration", calibrationRouter);
app.use("/api/calendrier", calendrierRouter);
app.use("/api/notifications", notificationsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});
