import { Router } from "express";
import { db } from "../../db.js";
import { dossier_documents, users, type DocumentAttachmentRef } from "@heureka-v1/db";
import { eq, and, inArray } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { getStorageProvider } from "../../services/storage.js";

/**
 * Résout une liste d'ids de documents GED en références de pièces jointes,
 * en ne gardant que ceux qui appartiennent réellement au dossier. Les
 * documents joints à un envoi **citoyen** sont basculés `shared_with_citizen`
 * = true (la route /api/uploads n'ouvre l'accès citoyen qu'à ce drapeau).
 *
 * `audience` = "citoyen" pour un message/courrier citoyen, "interne" sinon
 * (ex : fil service externe) — dans ce dernier cas on ne partage pas au citoyen.
 */
export async function resolveAttachmentRefs(
  dossierId: string,
  documentIds: unknown,
  audience: "citoyen" | "interne" = "citoyen",
): Promise<DocumentAttachmentRef[]> {
  if (!Array.isArray(documentIds) || documentIds.length === 0) return [];
  const ids = documentIds.filter((x): x is string => typeof x === "string").slice(0, 20);
  if (ids.length === 0) return [];
  const docs = await db
    .select()
    .from(dossier_documents)
    .where(and(
      eq(dossier_documents.dossier_id, dossierId),
      inArray(dossier_documents.id, ids),
    ));
  if (docs.length === 0) return [];
  if (audience === "citoyen") {
    const toShare = docs.filter((d) => !d.shared_with_citizen).map((d) => d.id);
    if (toShare.length > 0) {
      await db
        .update(dossier_documents)
        .set({ shared_with_citizen: true, updated_at: new Date() })
        .where(inArray(dossier_documents.id, toShare));
    }
  }
  return docs.map((d) => ({ document_id: d.id, nom: d.nom, url: d.url, type: d.type }));
}

/**
 * GED du dossier : coffre des documents produits par l'instruction
 * (export d'une pièce annotée pour l'instant). Le scope commune est garanti en
 * amont par enforceDossierAccess sur /dossiers/:id.
 */
export const dossierDocumentsRouter = Router();

// ── Lister les documents de la GED d'un dossier ──
dossierDocumentsRouter.get("/dossiers/:id/documents", async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        id: dossier_documents.id,
        dossier_id: dossier_documents.dossier_id,
        nom: dossier_documents.nom,
        url: dossier_documents.url,
        type: dossier_documents.type,
        taille: dossier_documents.taille,
        category: dossier_documents.category,
        source_piece_id: dossier_documents.source_piece_id,
        note: dossier_documents.note,
        shared_with_citizen: dossier_documents.shared_with_citizen,
        created_by: dossier_documents.created_by,
        created_at: dossier_documents.created_at,
        author_prenom: users.prenom,
        author_nom: users.nom,
      })
      .from(dossier_documents)
      .leftJoin(users, eq(dossier_documents.created_by, users.id))
      .where(eq(dossier_documents.dossier_id, req.params.id as string))
      .orderBy(desc(dossier_documents.created_at));
    res.json(rows);
  } catch (err) {
    console.error("[ged:list]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Supprimer un document de la GED ──
dossierDocumentsRouter.delete("/dossiers/:id/documents/:docId", async (req: AuthRequest, res) => {
  try {
    const [doc] = await db
      .select()
      .from(dossier_documents)
      .where(eq(dossier_documents.id, req.params.docId as string))
      .limit(1);
    if (!doc || doc.dossier_id !== req.params.id) {
      return res.status(404).json({ error: "Document non trouvé" });
    }
    await db.delete(dossier_documents).where(eq(dossier_documents.id, doc.id));
    // Best-effort : on retire aussi le fichier du stockage. Une référence dans
    // un message déjà envoyé deviendra un lien mort — acceptable (le document a
    // été explicitement supprimé par l'instructeur).
    try {
      const storage = getStorageProvider();
      await storage.remove(storage.keyFromUrl(doc.url));
    } catch (e) {
      console.warn("[ged:delete] storage.remove:", e);
    }
    res.status(204).end();
  } catch (err) {
    console.error("[ged:delete]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
