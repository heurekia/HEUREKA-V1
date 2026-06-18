import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";
import { dossier_pieces_jointes, dossiers } from "@heureka-v1/db";
import { eq, like } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { getCommuneScope, communeInScope } from "../middlewares/dossierAccess.js";
import { getStorageProvider } from "../services/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

// Clé attendue : UUID (avec ou sans extension). On rejette tout chemin
// contenant ".." ou "/" pour bloquer le path traversal.
const KEY_RE = /^[a-zA-Z0-9._-]+$/;

uploadsRouter.get("/:key", async (req: AuthRequest, res) => {
  try {
    const key = String(req.params.key ?? "");
    if (!KEY_RE.test(key) || key.includes("..")) {
      return res.status(400).json({ error: "Clé invalide" });
    }

    // On retrouve la pièce via le suffixe d'URL stocké en base. Format
    // historique : "/api/uploads/<key>".
    const urlSuffix = `/api/uploads/${key}`;
    const [piece] = await db
      .select({
        id: dossier_pieces_jointes.id,
        user_id: dossier_pieces_jointes.user_id,
        dossier_id: dossier_pieces_jointes.dossier_id,
        type: dossier_pieces_jointes.type,
        nom: dossier_pieces_jointes.nom,
        dossier_commune: dossiers.commune,
        dossier_user_id: dossiers.user_id,
      })
      .from(dossier_pieces_jointes)
      .leftJoin(dossiers, eq(dossier_pieces_jointes.dossier_id, dossiers.id))
      .where(like(dossier_pieces_jointes.url, `%${urlSuffix}`))
      .limit(1);

    if (!piece) return res.status(404).json({ error: "Fichier introuvable" });

    const userId = req.user!.id;
    const role = req.user!.role;
    let allowed = false;

    if (role === "admin") {
      allowed = true;
    } else if (role === "citoyen") {
      // Le citoyen propriétaire du dossier (ou qui a déposé la pièce).
      allowed = piece.user_id === userId || piece.dossier_user_id === userId;
    } else if (role === "mairie" || role === "instructeur") {
      const scope = await getCommuneScope(userId, role);
      allowed = communeInScope(piece.dossier_commune, scope);
    } else if (role === "service_externe") {
      // Les services externes accèdent via leurs propres routes de
      // consultation : pas d'accès direct aux pièces déposées.
      allowed = false;
    }

    if (!allowed) return res.status(403).json({ error: "Accès refusé" });

    const provider = getStorageProvider();

    // Garde-fou path traversal pour le provider local — sans effet sur S3 mais
    // utile en defense-in-depth si l'on revient à un disque local.
    const filePath = path.join(UPLOADS_DIR, key);
    if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
      return res.status(400).json({ error: "Chemin invalide" });
    }

    // On stream le fichier en proxy à travers l'API, quel que soit le provider.
    // Pas de redirection 302 vers une URL signée S3 : ces URL expirent au bout
    // de quelques minutes et peuvent être mises en cache par le navigateur ou
    // un CDN intermédiaire, ce qui fait disparaître la preview après quelques
    // heures. En streamant ici, l'URL exposée au front reste /api/uploads/<key>
    // et l'authentification est revérifiée à chaque accès.
    //
    // PDF compat : si une variante "compat" (re-encodée par pdftocairo pour
    // contourner le JPEG 2000 incompatible pdf.js) existe en stockage, on
    // la sert en priorité au viewer. L'original reste accessible pour le
    // téléchargement, l'analyse IA, et comme filet de sécurité si la compat
    // s'avère défaillante.
    //
    // Garde-fou réglementaire : ?variant=original force la lecture du fichier
    // déposé tel quel, sans passer par la version compat. Utilisé par le
    // bouton "Télécharger l'original" du viewer et par toute future
    // procédure d'audit (preuve de la pièce officielle).
    const forceOriginal = String(req.query.variant ?? "").toLowerCase() === "original";
    const isPdf = key.toLowerCase().endsWith(".pdf");
    const wantsCompat = !forceOriginal && isPdf && !key.includes(".compat.");
    const tryKeys: string[] = wantsCompat
      ? [(await import("../services/pdfCompat.js")).compatKeyFor(key), key]
      : [key];

    let streamRes;
    let servedKey: string | null = null;
    let lastErr: unknown = null;
    for (const k of tryKeys) {
      try {
        streamRes = await provider.getStream(k);
        servedKey = k;
        break;
      } catch (err) {
        lastErr = err;
        const code = (err as { name?: string; code?: string }).name
          ?? (err as { code?: string }).code;
        if (code !== "NoSuchKey" && code !== "NotFound" && code !== "ENOENT") {
          throw err;
        }
        // Sinon on essaie la clé suivante (typiquement l'original après l'échec compat).
      }
    }
    if (!streamRes) {
      const code = (lastErr as { name?: string; code?: string } | null)?.name
        ?? (lastErr as { code?: string } | null)?.code;
      if (code === "NoSuchKey" || code === "NotFound" || code === "ENOENT") {
        return res.status(404).json({ error: "Fichier absent du stockage" });
      }
      throw lastErr ?? new Error("Stream introuvable");
    }

    res.setHeader(
      "Content-Type",
      streamRes.contentType || piece.type || "application/octet-stream",
    );
    if (typeof streamRes.contentLength === "number") {
      res.setHeader("Content-Length", String(streamRes.contentLength));
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(piece.nom || key)}"`,
    );
    // Transparence sur la variante servie : le frontend peut afficher un
    // tag visuel quand c'est le compat (et proposer le bouton "Télécharger
    // l'original"). Header CORS-exposé pour être lisible côté JS.
    const servedVariant = servedKey && servedKey.includes(".compat.") ? "compat" : "original";
    res.setHeader("X-Pdf-Variant", servedVariant);
    res.setHeader("Access-Control-Expose-Headers", "X-Pdf-Variant");
    // Helmet pose globalement `Content-Security-Policy: frame-ancestors 'none'`
    // et `X-Frame-Options: SAMEORIGIN`. Le frame-ancestors 'none' interdit
    // l'embed du PDF dans l'<iframe> du PieceViewer — y compris depuis notre
    // propre SPA — d'où l'aperçu inline vide alors que "Ouvrir dans un nouvel
    // onglet" fonctionne (navigation top-level, pas un frame). On relâche à
    // 'self' pour ce flux : embed autorisé depuis nos pages, refusé pour les
    // tiers (anti-clickjacking conservé).
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
    streamRes.stream.on("error", (e) => {
      console.error("[uploads] stream error", e);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(e);
    });
    streamRes.stream.pipe(res);
  } catch (err) {
    console.error("[uploads]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
