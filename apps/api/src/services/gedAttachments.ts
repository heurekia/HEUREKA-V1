import { db } from "../db.js";
import { dossier_documents, type DocumentAttachmentRef } from "@heureka-v1/db";
import { eq, and, inArray } from "drizzle-orm";

/**
 * Résout une liste d'ids de documents GED en références de pièces jointes,
 * en ne gardant que ceux qui appartiennent réellement au dossier. Les documents
 * joints à un envoi **citoyen** (message ou courrier) sont basculés
 * `shared_with_citizen = true` — la route /api/uploads n'ouvre l'accès citoyen
 * qu'à ce drapeau, ce qui évite d'exposer un brouillon interne.
 *
 * `audience` = "citoyen" pour un envoi citoyen, "interne" sinon (ex. fil service
 * externe) — dans ce dernier cas on ne partage pas au citoyen.
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
