import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
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

    if (provider.name === "s3") {
      // Redirection vers une URL signée à courte durée — le navigateur
      // récupère le fichier directement depuis le bucket.
      const signed = await provider.getDownloadUrl(key, 300);
      return res.redirect(302, signed);
    }

    // Provider local : on stream depuis le disque.
    const filePath = path.join(UPLOADS_DIR, key);
    if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
      return res.status(400).json({ error: "Chemin invalide" });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Fichier absent du disque" });

    res.setHeader("Content-Type", piece.type || "application/octet-stream");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(piece.nom || key)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error("[uploads]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
