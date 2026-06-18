import { Router } from "express";
import { db } from "../../db.js";
import { dossiers, communes, regulatory_documents, dossier_consultations, external_services, service_communes } from "@heureka-v1/db";
import { eq, desc, and, sql, ilike } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";

export const consultationsRouter = Router();

// ── Référentiel documentaire par commune ──────────────────────────────────────

consultationsRouter.get("/documents", async (req: AuthRequest, res) => {
  try {
    const communeName = req.query.commune as string | undefined;
    if (!communeName) return res.status(400).json({ error: "Paramètre commune requis" });

    const [commune] = await db.select({ id: communes.id })
      .from(communes).where(ilike(communes.name, communeName)).limit(1);
    if (!commune) return res.json([]);

    const docs = await db.select({
      id: regulatory_documents.id,
      commune_id: regulatory_documents.commune_id,
      type: regulatory_documents.type,
      name: regulatory_documents.name,
      original_filename: regulatory_documents.original_filename,
      file_size: regulatory_documents.file_size,
      synthese: regulatory_documents.synthese,
      status: regulatory_documents.status,
      validation_status: regulatory_documents.validation_status,
      validated_by: regulatory_documents.validated_by,
      validated_at: regulatory_documents.validated_at,
      ingested_at: regulatory_documents.ingested_at,
      created_at: regulatory_documents.created_at,
    })
      .from(regulatory_documents)
      .where(eq(regulatory_documents.commune_id, commune.id))
      .orderBy(regulatory_documents.type, regulatory_documents.created_at);

    res.json(docs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

consultationsRouter.post("/documents", async (req: AuthRequest, res) => {
  try {
    const { commune_name, type, name, original_filename, file_size, pdf_base64, synthese } = req.body as {
      commune_name: string;
      type: string;
      name: string;
      original_filename: string;
      file_size?: number;
      pdf_base64?: string;
      synthese?: string;
    };

    if (!commune_name || !type || !name || !original_filename) {
      return res.status(400).json({ error: "Champs requis manquants" });
    }

    const [commune] = await db.select({ id: communes.id, insee_code: communes.insee_code, name: communes.name })
      .from(communes).where(ilike(communes.name, commune_name)).limit(1);
    if (!commune) return res.status(404).json({ error: "Commune introuvable" });

    const [doc] = await db.insert(regulatory_documents).values({
      commune_id: commune.id,
      porteur_commune_id: commune.id,
      type,
      name,
      original_filename,
      file_size: file_size ?? null,
      pdf_content: pdf_base64 ?? null,
      synthese: synthese?.trim() || null,
      status: pdf_base64 ? "indexing" : "uploaded",
    }).returning({
      id: regulatory_documents.id,
      type: regulatory_documents.type,
      name: regulatory_documents.name,
      original_filename: regulatory_documents.original_filename,
      file_size: regulatory_documents.file_size,
      synthese: regulatory_documents.synthese,
      status: regulatory_documents.status,
      created_at: regulatory_documents.created_at,
    });

    res.json(doc);

    // Indexation RAG en arrière-plan : on a déjà répondu au client. Si ça
    // échoue (Mistral HS, PDF illisible…), on log et on met le statut en
    // "indexing_error" — le doc reste dans la liste avec un badge clair.
    if (pdf_base64 && doc) {
      void (async () => {
        try {
          const { indexCommuneDocument } = await import("../../services/ragService.js");
          const result = await indexCommuneDocument({
            document_id: doc.id,
            insee: commune.insee_code,
            commune_name: commune.name,
            doc_type: type,
            document_name: name,
            original_filename,
            pdf_base64,
          });
          await db.update(regulatory_documents)
            .set({ status: result.chunks > 0 ? "indexed" : "indexing_empty", ingested_at: new Date(), updated_at: new Date() })
            .where(eq(regulatory_documents.id, doc.id));
        } catch (err) {
          console.error(`[rag] indexation échouée pour doc=${doc.id}:`, err instanceof Error ? err.message : err);
          await db.update(regulatory_documents)
            .set({ status: "indexing_error", updated_at: new Date() })
            .where(eq(regulatory_documents.id, doc.id))
            .catch(() => { /* best-effort */ });
        }
      })();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Met à jour la synthèse, le nom, ou le statut de validation d'un document.
//
// Règles importantes (gate juridique) :
//  - Toute modification de la synthèse remet le statut à "brouillon" : un
//    édit non explicitement re-validé ne doit pas continuer d'alimenter
//    l'instruction.
//  - Passer à "valide" exige un utilisateur authentifié (validated_by) et
//    horodate la décision (validated_at) — c'est l'amorce de l'audit trail.
consultationsRouter.patch("/documents/:id", async (req: AuthRequest, res) => {
  try {
    const { synthese, name, validation_status } = req.body as {
      synthese?: string | null;
      name?: string;
      validation_status?: "valide" | "brouillon" | "rejete";
    };
    const patch: {
      synthese?: string | null;
      name?: string;
      validation_status?: string;
      validated_by?: string | null;
      validated_at?: Date | null;
      updated_at: Date;
    } = { updated_at: new Date() };

    const sytheseChanged = synthese !== undefined;
    if (sytheseChanged) patch.synthese = synthese?.trim() || null;
    if (name !== undefined && name.trim()) patch.name = name.trim();

    if (validation_status) {
      if (!["valide", "brouillon", "rejete"].includes(validation_status)) {
        return res.status(400).json({ error: "validation_status invalide" });
      }
      patch.validation_status = validation_status;
      if (validation_status === "valide") {
        if (!req.user?.id) return res.status(401).json({ error: "Authentification requise pour valider" });
        patch.validated_by = req.user.id;
        patch.validated_at = new Date();
      } else {
        patch.validated_by = null;
        patch.validated_at = null;
      }
    } else if (sytheseChanged) {
      // Édit de synthèse sans validation explicite → bascule auto en brouillon.
      patch.validation_status = "brouillon";
      patch.validated_by = null;
      patch.validated_at = null;
    }

    const [doc] = await db.update(regulatory_documents)
      .set(patch)
      .where(eq(regulatory_documents.id, req.params.id as string))
      .returning({
        id: regulatory_documents.id,
        type: regulatory_documents.type,
        name: regulatory_documents.name,
        synthese: regulatory_documents.synthese,
        validation_status: regulatory_documents.validation_status,
        validated_by: regulatory_documents.validated_by,
        validated_at: regulatory_documents.validated_at,
      });
    if (!doc) return res.status(404).json({ error: "Document introuvable" });
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

consultationsRouter.delete("/documents/:id", async (req: AuthRequest, res) => {
  try {
    const documentId = req.params.id as string;
    // Nettoyer l'index RAG avant de supprimer la ligne : sinon on laisse des
    // segments orphelins pointant vers un source_id qui n'existe plus.
    try {
      const { deleteIndexFor } = await import("../../services/ragService.js");
      await deleteIndexFor(documentId);
    } catch (err) {
      console.error(`[rag] nettoyage index échoué pour doc=${documentId}:`, err instanceof Error ? err.message : err);
    }
    await db.delete(regulatory_documents).where(eq(regulatory_documents.id, documentId));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Streaming inline du PDF d'un document réglementaire. Utilisé par le mode
// Comparer du viewer d'instruction qui charge un PLU / PPRI / OAP à côté de
// la pièce du pétitionnaire. Content-Disposition inline pour que le viewer
// navigateur le rende sans déclencher de téléchargement.
consultationsRouter.get("/documents/:id/pdf", async (req: AuthRequest, res) => {
  try {
    const documentId = req.params.id as string;
    const [doc] = await db
      .select({
        pdf_content: regulatory_documents.pdf_content,
        original_filename: regulatory_documents.original_filename,
      })
      .from(regulatory_documents)
      .where(eq(regulatory_documents.id, documentId))
      .limit(1);
    if (!doc || !doc.pdf_content) return res.status(404).json({ error: "PDF indisponible" });

    const buffer = Buffer.from(doc.pdf_content, "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.original_filename)}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Documents thématiques de la commune du dossier, retournés avec leur synthèse
// pour servir de support à l'instruction (l'outil les consulte avant d'analyser
// la conformité d'une demande).
consultationsRouter.get("/dossiers/:id/commune-documents", async (req: AuthRequest, res) => {
  try {
    const [dossier] = await db.select({ commune: dossiers.commune })
      .from(dossiers).where(eq(dossiers.id, req.params.id as string)).limit(1);
    if (!dossier?.commune) return res.json([]);

    const [commune] = await db.select({ id: communes.id })
      .from(communes).where(ilike(communes.name, dossier.commune)).limit(1);
    if (!commune) return res.json([]);

    const docs = await db.select({
      id: regulatory_documents.id,
      type: regulatory_documents.type,
      name: regulatory_documents.name,
      original_filename: regulatory_documents.original_filename,
      file_size: regulatory_documents.file_size,
      synthese: regulatory_documents.synthese,
      status: regulatory_documents.status,
      validation_status: regulatory_documents.validation_status,
      validated_at: regulatory_documents.validated_at,
      created_at: regulatory_documents.created_at,
    })
      .from(regulatory_documents)
      .where(eq(regulatory_documents.commune_id, commune.id))
      .orderBy(regulatory_documents.type, regulatory_documents.created_at);
    res.json(docs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Consultations de services pour un dossier ──

consultationsRouter.get("/dossiers/:id/consultations", async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(dossier_consultations)
      .where(eq(dossier_consultations.dossier_id, req.params.id as string))
      .orderBy(desc(dossier_consultations.created_at));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

consultationsRouter.post("/dossiers/:id/consultations", async (req: AuthRequest, res) => {
  try {
    const { service_name, service_type, avis } = req.body as {
      service_name: string;
      service_type: string;
      avis?: string;
    };
    if (!service_name?.trim() || !service_type?.trim()) {
      return res.status(400).json({ error: "service_name et service_type sont requis" });
    }

    // Resolve external_service_id by matching service_type + dossier commune coverage
    let externalServiceId: string | null = null;
    const [dossierRow] = await db.select({ commune: dossiers.commune })
      .from(dossiers).where(eq(dossiers.id, req.params.id as string)).limit(1);
    if (dossierRow?.commune) {
      const [communeRow] = await db.select({ id: communes.id })
        .from(communes)
        .where(sql`lower(trim(${communes.name})) = lower(trim(${dossierRow.commune}))`)
        .limit(1);
      if (communeRow) {
        const [serviceRow] = await db.select({ id: external_services.id })
          .from(external_services)
          .innerJoin(service_communes, eq(service_communes.service_id, external_services.id))
          .where(and(
            eq(external_services.type, service_type.trim()),
            eq(service_communes.commune_id, communeRow.id),
          ))
          .limit(1);
        externalServiceId = serviceRow?.id ?? null;
      }
    }

    const [row] = await db
      .insert(dossier_consultations)
      .values({
        dossier_id: req.params.id as string,
        service_name: service_name.trim(),
        service_type: service_type.trim(),
        external_service_id: externalServiceId,
        status: "en_attente",
        avis: avis?.trim() ?? null,
        created_by_id: req.user?.id ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

consultationsRouter.patch("/dossiers/:id/consultations/:consultationId", async (req: AuthRequest, res) => {
  try {
    const { status, favorable, avis, date_reponse } = req.body as {
      status?: string;
      favorable?: boolean | null;
      avis?: string;
      date_reponse?: string | null;
    };
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (status !== undefined) updates.status = status;
    if (favorable !== undefined) updates.favorable = favorable;
    if (avis !== undefined) updates.avis = avis ?? null;
    if (date_reponse !== undefined) updates.date_reponse = date_reponse ? new Date(date_reponse) : null;
    if (status === "avis_recu" && !updates.date_reponse) updates.date_reponse = new Date();

    const [row] = await db
      .update(dossier_consultations)
      .set(updates)
      .where(and(
        eq(dossier_consultations.id, req.params.consultationId as string),
        eq(dossier_consultations.dossier_id, req.params.id as string),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Consultation non trouvée" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
