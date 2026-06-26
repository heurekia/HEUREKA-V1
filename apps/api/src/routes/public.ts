import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { site_settings } from "@heureka-v1/db";
import { analyseParcel } from "../services/parcelAnalysis.js";
import { gpuDebug } from "../services/gpuDebug.js";
import { getOrFetchArticle, parseArticleRef } from "../services/legifrance.js";
import { requireAuth, requireRole, optionalAuth, type AuthRequest } from "../middlewares/auth.js";
import { logAudit } from "../services/audit.js";
import { COOKIE_OPTIONS } from "./auth.js";

export const publicRouter = Router();

// Endpoint anonyme et coûteux (GPU, géocodage, règles DB) : limite par IP
// pour éviter l'abus/DoS tout en restant confortable pour un usage normal.
const analyseLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, legacyHeaders: false });

// ─── Mode « bientôt en ligne » (page vitrine + mot de passe d'accès) ──────────
// Le portail public peut être verrouillé avant l'ouverture officielle : on
// affiche alors une page « le système arrive prochainement » et on exige un mot
// de passe. Le déverrouillage pose un cookie httpOnly signé (JWT) — le mot de
// passe n'est jamais embarqué dans le bundle front.
const SITE_ACCESS_COOKIE = "site_access";
const JWT_SECRET = process.env.JWT_SECRET as string; // garanti défini (cf. middlewares/auth)

// Anti-bruteforce sur la saisie du mot de passe vitrine.
const siteAccessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives. Réessayez dans 15 minutes." },
});

function hasSiteAccess(req: AuthRequest): boolean {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const token = cookies?.[SITE_ACCESS_COOKIE];
  if (!token) return false;
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /public/site-status
 * État du mode « bientôt en ligne » pour le portail public. Ne renvoie JAMAIS le
 * mot de passe ni son hash. `unlocked` indique si le visiteur courant a déjà
 * fourni le bon mot de passe (cookie valide).
 */
publicRouter.get("/site-status", async (req: AuthRequest, res) => {
  try {
    const [s] = await db.select().from(site_settings).where(eq(site_settings.id, 1)).limit(1);
    const comingSoon = !!s?.coming_soon_enabled;
    res.json({
      comingSoon,
      unlocked: comingSoon ? hasSiteAccess(req) : true,
      title: s?.coming_soon_title ?? null,
      message: s?.coming_soon_message ?? null,
    });
  } catch (err) {
    console.error("[public/site-status]", err);
    // Fail-open : une panne DB ne doit jamais verrouiller le site par accident.
    res.json({ comingSoon: false, unlocked: true, title: null, message: null });
  }
});

/**
 * POST /public/site-access  { password }
 * Vérifie le mot de passe d'accès au site vitrine et, si correct, pose le cookie
 * de déverrouillage (30 jours). 401 si incorrect.
 */
publicRouter.post("/site-access", siteAccessLimiter, async (req, res) => {
  try {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const [s] = await db.select().from(site_settings).where(eq(site_settings.id, 1)).limit(1);
    // Mode inactif : rien à déverrouiller, on répond OK (idempotent).
    if (!s?.coming_soon_enabled) return res.json({ ok: true });
    if (!s.coming_soon_password_hash) {
      return res.status(400).json({ error: "Aucun mot de passe d'accès n'est défini." });
    }
    const ok = await bcrypt.compare(password, s.coming_soon_password_hash);
    if (!ok) return res.status(401).json({ error: "Mot de passe incorrect." });

    const token = jwt.sign({ site_access: true }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie(SITE_ACCESS_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true });
  } catch (err) {
    console.error("[public/site-access]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

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
    // Groupement foncier : liste d'ids cadastraux séparés par virgule. Quand
    // présente, c'est la SÉLECTION EXPLICITE du citoyen (clics carte) : elle fait
    // FOI. L'analyse agrège ces parcelles et recalcule la constructibilité sur
    // l'unité foncière.
    const parcellesParam = (req.query.parcelles as string | undefined)?.trim();
    const parcelles = parcellesParam
      ? parcellesParam.split(",").map((p) => p.trim()).filter(Boolean)
      : [];

    const hasCoords = lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng);
    if (!q && !hasCoords && parcelles.length === 0) {
      return res.status(400).json({ error: "Paramètre q, (lat+lng) ou parcelles requis" });
    }

    // Quand une sélection `parcelles` est fournie, la PRINCIPALE est la 1ère parcelle
    // sélectionnée — PAS celle résolue depuis l'adresse `q`/`coords`. Sans cela, une
    // adresse géocodée sur une parcelle voisine (décalage BAN), ou que le citoyen a
    // justement retirée du groupement, serait réinjectée dans l'unité foncière et
    // induirait en erreur. `q` reste transmis (libellé d'adresse) mais ne résout
    // plus de parcelle. Si aucune sélection : comportement adresse/coords classique.
    const hasSelection = parcelles.length > 0;
    const principalQuery = hasSelection ? parcelles[0]! : q;

    const analysis = await analyseParcel(principalQuery, {
      citycode,
      zoneOverride,
      // La sélection explicite prime : on n'utilise pas les coords (point cliqué /
      // GPS) pour résoudre la principale quand des parcelles sont fournies.
      coords: !hasSelection && hasCoords ? { lat: lat!, lng: lng! } : undefined,
      uniteFonciere: parcelles.length > 1 ? { parcelles } : undefined,
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
