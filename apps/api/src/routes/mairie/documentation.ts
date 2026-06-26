/**
 * Onglet « Documentation » — référencement réglementaire contextuel.
 *
 * Surface REST :
 *   GET    /mairie/dossiers/:id/documentation?piece_id=&topics=
 *          → contexte + liste des références applicables
 *   GET    /mairie/dossiers/:id/documentation/reference/:refId
 *          → détail d'une référence
 *   GET    /mairie/dossiers/:id/documentation/search?q=
 *          → recherche plein-texte sur PLU + documents communaux validés
 *   GET    /mairie/dossiers/:id/documentation/favoris
 *          → favoris de l'instructeur sur ce dossier
 *   POST   /mairie/dossiers/:id/documentation/favoris
 *          → épingle une référence (idempotent)
 *   DELETE /mairie/dossiers/:id/documentation/favoris/:refId
 *          → désépingle
 *
 * Le moteur est 100 % déterministe — voir documentationEngine.ts.
 */

import { Router } from "express";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requirePermission } from "../../middlewares/permissions.js";
import { getCommuneScope, communeInScope } from "../../middlewares/dossierAccess.js";
import {
  buildDocumentationContext,
  listApplicableReferences,
  getReferenceDetail,
  searchReferences,
  listFavoris,
  addFavori,
  removeFavori,
} from "../../services/documentationEngine.js";

export const documentationRouter = Router();

documentationRouter.get("/dossiers/:id/documentation", requirePermission("documentation"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const pieceId = (req.query.piece_id as string | undefined) ?? null;
    const topicsParam = (req.query.topics as string | undefined) ?? "";
    const topics = topicsParam
      ? topicsParam.split(",").map((t) => t.trim()).filter(Boolean)
      : null;

    const { context, references } = await listApplicableReferences(dossierId, {
      pieceId,
      topics,
    });
    res.json({ context, references });
  } catch (err) {
    console.error("[documentation:list]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

documentationRouter.get("/dossiers/:id/documentation/reference/:refId", requirePermission("documentation"), async (req: AuthRequest, res) => {
  try {
    const refId = req.params.refId as string;
    const detail = await getReferenceDetail(refId);
    if (!detail) return res.status(404).json({ error: "Référence introuvable" });
    // Défense en profondeur : `:refId` est une ressource indépendante du dossier
    // (enforceDossierAccess ne valide que `:id`). On vérifie que la commune de la
    // référence appartient au périmètre de l'agent, sinon un agent pouvait lire
    // le contenu réglementaire (texte PLU / synthèse de document) d'une AUTRE
    // commune en devinant un refId. `commune` nulle = portée intercommunale
    // (PLUi) : pas de restriction par commune.
    if (detail.commune) {
      const scope = await getCommuneScope(req.user!.id, req.user!.role);
      if (!communeInScope(detail.commune, scope)) {
        return res.status(404).json({ error: "Référence introuvable" });
      }
    }
    res.json(detail);
  } catch (err) {
    console.error("[documentation:detail]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

documentationRouter.get("/dossiers/:id/documentation/search", requirePermission("documentation"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const query = ((req.query.q as string | undefined) ?? "").trim();
    if (query.length < 2) return res.json({ results: [] });

    // On résout le contexte juste pour récupérer l'INSEE de la commune — la
    // recherche reste restreinte au périmètre documentaire de cette commune.
    const ctx = await buildDocumentationContext(dossierId);
    if (!ctx.insee_code) {
      return res.json({ results: [], warning: "Commune non résolue — recherche impossible" });
    }
    const results = await searchReferences(ctx.insee_code, query);
    res.json({ results });
  } catch (err) {
    console.error("[documentation:search]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

documentationRouter.get("/dossiers/:id/documentation/favoris", requirePermission("documentation"), async (req: AuthRequest, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Authentification requise" });
    const items = await listFavoris(req.params.id as string, req.user.id);
    res.json(items);
  } catch (err) {
    console.error("[documentation:favoris:list]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

documentationRouter.post("/dossiers/:id/documentation/favoris", requirePermission("documentation"), async (req: AuthRequest, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Authentification requise" });
    const body = (req.body ?? {}) as {
      reference_id?: string;
      reference_type?: string;
      titre?: string;
      source?: string | null;
    };
    if (!body.reference_id || !body.reference_type || !body.titre) {
      return res.status(400).json({ error: "reference_id, reference_type et titre requis" });
    }
    const item = await addFavori({
      dossierId: req.params.id as string,
      userId: req.user.id,
      referenceId: body.reference_id,
      referenceType: body.reference_type,
      titre: body.titre,
      source: body.source ?? null,
    });
    res.status(201).json(item);
  } catch (err) {
    console.error("[documentation:favoris:add]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

documentationRouter.delete("/dossiers/:id/documentation/favoris/:refId", requirePermission("documentation"), async (req: AuthRequest, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Authentification requise" });
    await removeFavori({
      dossierId: req.params.id as string,
      userId: req.user.id,
      referenceId: req.params.refId as string,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[documentation:favoris:remove]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
