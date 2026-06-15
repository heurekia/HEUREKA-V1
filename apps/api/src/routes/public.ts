import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { analyseParcel } from "../services/parcelAnalysis.js";
import { gpuDebug } from "../services/gpuDebug.js";
import { getOrFetchArticle, parseArticleRef } from "../services/legifrance.js";
import { requireAuth, requireRole, optionalAuth, type AuthRequest } from "../middlewares/auth.js";
import { logAudit } from "../services/audit.js";

export const publicRouter = Router();

// Endpoint anonyme et coûteux (GPU, géocodage, règles DB) : limite par IP
// pour éviter l'abus/DoS tout en restant confortable pour un usage normal.
const analyseLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, legacyHeaders: false });

/**
 * GET /public/analyse?q=<adresse ou ref cadastrale>
 * Accept: "12 rue du Commerce, Ballan-Miré" OR "37018000AB0050"
 * Returns full ParcelAnalysis including GPU zone, risks, DB rules, buildability.
 */
publicRouter.get("/analyse", analyseLimiter, optionalAuth, async (req: AuthRequest, res) => {
  try {
    const q = ((req.query.q as string | undefined) ?? "").trim();
    const lat = req.query.lat !== undefined ? parseFloat(req.query.lat as string) : undefined;
    const lng = req.query.lng !== undefined ? parseFloat(req.query.lng as string) : undefined;
    const citycode = req.query.citycode as string | undefined;
    const zoneOverride = req.query.zone as string | undefined;

    const hasCoords = lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng);
    if (!q && !hasCoords) {
      return res.status(400).json({ error: "Paramètre q ou (lat+lng) requis" });
    }

    const analysis = await analyseParcel(q, {
      citycode,
      zoneOverride,
      coords: hasCoords ? { lat: lat!, lng: lng! } : undefined,
    });

    // Traçabilité : enregistrer l'adresse cherchée pour le super admin.
    // user_id et email sont remplis si le citoyen est connecté (optionalAuth),
    // sinon on garde l'IP comme seul identifiant — utile pour mesurer l'usage
    // anonyme du portail.
    void logAudit(req, "address_search", {
      role: req.user?.role ?? "anonyme",
      targetType: "address",
      targetId: q || null,
      metadata: {
        query: q || null,
        coords: hasCoords ? { lat, lng } : null,
        citycode: citycode ?? null,
        zone_override: zoneOverride ?? null,
        // Résultat synthétique de l'analyse, sans le payload géométrique
        // lourd : code INSEE, zone PLU et nom de commune si trouvés.
        result: {
          insee: (analysis as { insee?: string } | null)?.insee ?? null,
          commune: (analysis as { commune?: string } | null)?.commune ?? null,
          zone: (analysis as { zone?: { code?: string } } | null)?.zone?.code ?? null,
        },
      },
    });

    res.json(analysis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * GET /public/debug/gpu?lat=47.40317&lng=0.65321
 * Returns raw GPU API responses for all endpoints at the given coordinates.
 * Used to verify field names, available data and mappings.
 */
publicRouter.get("/debug/gpu", requireAuth, requireRole("admin"), async (req, res) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: "lat et lng requis" });
  try {
    const data = await gpuDebug(lat, lng);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * GET /public/analyse-parcelle/:parcelle
 * Legacy endpoint — kept for backwards compatibility, proxies to analyseParcel.
 */
publicRouter.get("/analyse-parcelle/:parcelle", analyseLimiter, optionalAuth, async (req: AuthRequest, res) => {
  try {
    const parcelle = req.params.parcelle as string;
    const analysis = await analyseParcel(parcelle);
    void logAudit(req, "address_search", {
      role: req.user?.role ?? "anonyme",
      targetType: "parcelle",
      targetId: parcelle,
      metadata: {
        query: parcelle,
        result: {
          insee: (analysis as { insee?: string } | null)?.insee ?? null,
          commune: (analysis as { commune?: string } | null)?.commune ?? null,
          zone: (analysis as { zone?: { code?: string } } | null)?.zone?.code ?? null,
        },
      },
    });
    res.json(analysis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * GET /public/legal-articles/:code/:num
 * Code = "CU" | "CCH" | "CE" (résolu vers son LEGITEXT côté serveur).
 * Num  = numéro brut, ex. "R431-2", "L410-1".
 *
 * Sert le contenu officiel d'un article (cache DB + lazy-fetch Légifrance).
 * Endpoint public — le contenu est en licence ouverte v2.0 Etalab.
 */
publicRouter.get("/legal-articles/:code/:num", async (req, res) => {
  try {
    const codeKey = String(req.params.code ?? "").toUpperCase();
    const num = String(req.params.num ?? "").trim().toUpperCase();
    if (!codeKey || !num) {
      return res.status(400).json({ error: "code et num requis" });
    }
    const article = await getOrFetchArticle(codeKey, num);
    if (!article) {
      // Fallback : on renvoie au moins une URL Légifrance utilisable par le client.
      return res.status(404).json({
        error: "Article introuvable",
        fallback_url: `https://www.legifrance.gouv.fr/search/code?query=${encodeURIComponent(num)}`,
      });
    }
    res.json({
      code: codeKey,
      article_ref: article.article_ref,
      title: article.article_title,
      html: article.article_html,
      legifrance_id: article.legifrance_id,
      source_url: article.source_url,
      fetched_at: article.fetched_at,
      // Mention obligatoire par la licence Etalab.
      license: "Licence ouverte v2.0 — Source : Légifrance (DILA)",
    });
  } catch (err) {
    console.error("[public/legal-articles] ", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * GET /public/legal-articles/parse?ref=<référence brute>
 * Helper de debug : normalise une référence type "R421-17 a) CU" → article fetch.
 */
publicRouter.get("/legal-articles/parse", async (req, res) => {
  const ref = String(req.query.ref ?? "").trim();
  const parsed = parseArticleRef(ref);
  if (!parsed) return res.status(400).json({ error: "Référence non reconnue" });
  const article = await getOrFetchArticle(parsed.codeKey, parsed.normalized);
  if (!article) return res.status(404).json({ error: "Article introuvable", parsed });
  res.json({ parsed, article });
});
