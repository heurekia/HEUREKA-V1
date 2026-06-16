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
    let streamRes;
    try {
      streamRes = await provider.getStream(key);
    } catch (err) {
      const code = (err as { name?: string; code?: string }).name
        ?? (err as { code?: string }).code;
      if (code === "NoSuchKey" || code === "NotFound" || code === "ENOENT") {
        return res.status(404).json({ error: "Fichier absent du stockage" });
      }
      throw err;
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
