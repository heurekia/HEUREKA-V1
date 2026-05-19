import { Router } from "express";
import { analyseParcel } from "../services/parcelAnalysis.js";

export const publicRouter = Router();

/**
 * GET /public/analyse?q=<adresse ou ref cadastrale>
 * Accept: "12 rue du Commerce, Ballan-Miré" OR "37018000AB0050"
 * Returns full ParcelAnalysis including GPU zone, risks, DB rules, buildability.
 */
publicRouter.get("/analyse", async (req, res) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q) return res.status(400).json({ error: "Paramètre q requis (adresse ou référence cadastrale)" });
    const analysis = await analyseParcel(q);
    res.json(analysis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * GET /public/analyse-parcelle/:parcelle
 * Legacy endpoint — kept for backwards compatibility, proxies to analyseParcel.
 */
publicRouter.get("/analyse-parcelle/:parcelle", async (req, res) => {
  try {
    const analysis = await analyseParcel(req.params.parcelle as string);
    res.json(analysis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
