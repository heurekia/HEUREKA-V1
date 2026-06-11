import { Router } from "express";
import { db } from "../db.js";
import { dossiers, users, dossier_messages, dossier_pieces_jointes, external_services, service_communes, communes, courrier_templates, dossier_consultations } from "@heureka-v1/db";
import { eq, desc, ilike, inArray, and, or, notInArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

export const serviceRouter = Router();

serviceRouter.use(requireAuth);
serviceRouter.use(requireRole("service_externe"));

/**
 * Vérifie qu'un dossier appartient au périmètre du service de l'utilisateur.
 * Renvoie true si OK, écrit la réponse 403/404 et renvoie false sinon.
 */
async function enforceDossierInServiceScope(req: AuthRequest, res: import("express").Response, dossierId: string): Promise<boolean> {
  const [dossier] = await db.select({ commune: dossiers.commune })
    .from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
  if (!dossier) { res.status(404).json({ error: "Dossier introuvable" }); return false; }
  const { names } = await getServiceCommunes(req.user!.id);
  const inScope = names.some(n => dossier.commune?.toLowerCase() === n.toLowerCase());
  if (!inScope) { res.status(403).json({ error: "Hors périmètre" }); return false; }
  return true;
}

// ── Helper: get commune names covered by the logged-in user's service ────────
async function getServiceCommunes(userId: string): Promise<{ ids: string[]; names: string[]; service: typeof external_services.$inferSelect | null }> {
  const [user] = await db.select({ service_id: users.service_id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.service_id) return { ids: [], names: [], service: null };

  const [service, coverageRows] = await Promise.all([
    db.select().from(external_services).where(eq(external_services.id, user.service_id)).limit(1).then(r => r[0] ?? null),
    db.select({ commune_id: service_communes.commune_id })
      .from(service_communes)
      .where(eq(service_communes.service_id, user.service_id)),
  ]);

  const communeIds = coverageRows.map(r => r.commune_id);
  if (communeIds.length === 0) return { ids: communeIds, names: [], service };

  const communeRows = await db.select({ name: communes.name })
    .from(communes)
    .where(inArray(communes.id, communeIds));

  return { ids: communeIds, names: communeRows.map(r => r.name), service };
}

// ── Info service ──────────────────────────────────────────────────────────────
serviceRouter.get("/info", async (req: AuthRequest, res) => {
  try {
    const { service, names } = await getServiceCommunes(req.user!.id);
    if (!service) return res.status(404).json({ error: "Service introuvable" });
    res.json({ service, communesCount: names.length, communes: names });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Paramètres du service (en-tête, pied, signature) ─────────────────────────
serviceRouter.put("/settings", async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select({ service_id: users.service_id }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user?.service_id) return res.status(404).json({ error: "Service introuvable" });

    const { letterhead_logo, letterhead_title, letterhead_subtitle, letterhead_address, footer_text, signature_image } = req.body as Record<string, string | null>;

    await db.update(external_services).set({
      letterhead_logo: letterhead_logo ?? null,
      letterhead_title: letterhead_title ?? null,
      letterhead_subtitle: letterhead_subtitle ?? null,
      letterhead_address: letterhead_address ?? null,
      footer_text: footer_text ?? null,
      signature_image: signature_image ?? null,
      updated_at: new Date(),
    }).where(eq(external_services.id, user.service_id));

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Dossiers du périmètre ─────────────────────────────────────────────────────
serviceRouter.get("/dossiers", async (req: AuthRequest, res) => {
  try {
    const { names } = await getServiceCommunes(req.user!.id);
    if (names.length === 0) return res.json([]);

    const communeFilter = or(...names.map(n => ilike(dossiers.commune, n)));
    const rows = await db.select({
      id: dossiers.id, numero: dossiers.numero, type: dossiers.type, status: dossiers.status,
      adresse: dossiers.adresse, commune: dossiers.commune, description: dossiers.description,
      date_depot: dossiers.date_depot, date_limite_instruction: dossiers.date_limite_instruction,
      created_at: dossiers.created_at,
      demandeur_prenom: users.prenom, demandeur_nom: users.nom,
    })
      .from(dossiers)
      .leftJoin(users, eq(dossiers.user_id, users.id))
      .where(and(communeFilter, notInArray(dossiers.status, ["brouillon" as const])))
      .orderBy(desc(dossiers.created_at));

    res.json(rows.map(r => ({
      ...r,
      demandeur: [r.demandeur_prenom, r.demandeur_nom].filter(Boolean).join(" ") || "—",
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Détail dossier ────────────────────────────────────────────────────────────
serviceRouter.get("/dossiers/:id", async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const { names } = await getServiceCommunes(req.user!.id);
    const [dossier] = await db.select({
      id: dossiers.id, numero: dossiers.numero, type: dossiers.type, status: dossiers.status,
      adresse: dossiers.adresse, commune: dossiers.commune, code_postal: dossiers.code_postal,
      parcelle: dossiers.parcelle, description: dossiers.description,
      surface_plancher: dossiers.surface_plancher,
      date_depot: dossiers.date_depot, date_limite_instruction: dossiers.date_limite_instruction,
      demandeur_prenom: users.prenom, demandeur_nom: users.nom, demandeur_email: users.email,
    })
      .from(dossiers)
      .leftJoin(users, eq(dossiers.user_id, users.id))
      .where(eq(dossiers.id, dossierId))
      .limit(1);

    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const inScope = names.some(n => dossier.commune?.toLowerCase() === n.toLowerCase());
    if (!inScope) return res.status(403).json({ error: "Hors périmètre" });

    const pieces = await db.select().from(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.dossier_id, dossierId));
    res.json({ ...dossier, demandeur: [dossier.demandeur_prenom, dossier.demandeur_nom].filter(Boolean).join(" ") || "—", pieces });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Messagerie consultation ───────────────────────────────────────────────────
serviceRouter.get("/dossiers/:id/messages", async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    if (!await enforceDossierInServiceScope(req, res, dossierId)) return;
    const msgs = await db.select().from(dossier_messages)
      .where(eq(dossier_messages.dossier_id, dossierId))
      .orderBy(dossier_messages.created_at);
    res.json(msgs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

serviceRouter.post("/dossiers/:id/messages", async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    if (!await enforceDossierInServiceScope(req, res, dossierId)) return;
    const { content, type = "consultation" } = req.body as { content?: string; type?: string };
    if (!content?.trim()) return res.status(400).json({ error: "Contenu requis" });

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    const [msg] = await db.insert(dossier_messages).values({
      dossier_id: dossierId,
      from_user_id: req.user!.id,
      from_role: `service_externe:${type}`,
      content: content.trim(),
    }).returning();

    res.status(201).json({ ...msg, from_name: user ? `${user.prenom} ${user.nom}` : "Agent" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Consultations adressées à ce service ─────────────────────────────────────
serviceRouter.get("/dossiers/:id/consultations", async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const [user] = await db.select({ service_id: users.service_id }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user?.service_id) return res.json([]);

    const rows = await db.select()
      .from(dossier_consultations)
      .where(and(
        eq(dossier_consultations.dossier_id, dossierId),
        eq(dossier_consultations.external_service_id, user.service_id),
      ))
      .orderBy(desc(dossier_consultations.created_at));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

serviceRouter.patch("/dossiers/:id/consultations/:consultationId", async (req: AuthRequest, res) => {
  try {
    const { consultationId, id: dossierId } = req.params as { consultationId: string; id: string };
    const [user] = await db.select({ service_id: users.service_id }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user?.service_id) return res.status(403).json({ error: "Service introuvable" });

    const [existing] = await db.select({ external_service_id: dossier_consultations.external_service_id })
      .from(dossier_consultations)
      .where(and(
        eq(dossier_consultations.id, consultationId),
        eq(dossier_consultations.dossier_id, dossierId),
      ))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Consultation introuvable" });
    if (existing.external_service_id !== user.service_id) return res.status(403).json({ error: "Accès refusé" });

    const { favorable, avis } = req.body as { favorable?: boolean | null; avis?: string };

    const [row] = await db.update(dossier_consultations).set({
      favorable: favorable ?? null,
      avis: avis?.trim() ?? null,
      status: "avis_recu",
      date_reponse: new Date(),
      updated_at: new Date(),
    }).where(eq(dossier_consultations.id, consultationId)).returning();

    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Courriers templates CRUD ──────────────────────────────────────────────────
serviceRouter.get("/templates", async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select({ service_id: users.service_id }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user?.service_id) return res.json([]);
    const rows = await db.select().from(courrier_templates)
      .where(eq(courrier_templates.service_id, user.service_id))
      .orderBy(courrier_templates.created_at);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

serviceRouter.post("/templates", async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select({ service_id: users.service_id }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user?.service_id) return res.status(404).json({ error: "Service introuvable" });

    const { name, category = "general", body = "" } = req.body as { name?: string; category?: string; body?: string };
    if (!name?.trim()) return res.status(400).json({ error: "Nom requis" });

    const [tpl] = await db.insert(courrier_templates).values({
      service_id: user.service_id,
      name: name.trim(),
      category,
      body,
    }).returning();

    res.status(201).json(tpl);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

serviceRouter.put("/templates/:templateId", async (req: AuthRequest, res) => {
  try {
    const templateId = req.params.templateId as string;
    const [user] = await db.select({ service_id: users.service_id }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user?.service_id) return res.status(404).json({ error: "Service introuvable" });

    const [existing] = await db.select({ service_id: courrier_templates.service_id })
      .from(courrier_templates).where(eq(courrier_templates.id, templateId)).limit(1);
    if (!existing || existing.service_id !== user.service_id) return res.status(403).json({ error: "Accès refusé" });

    const { name, category, body } = req.body as { name?: string; category?: string; body?: string };
    if (!name?.trim()) return res.status(400).json({ error: "Nom requis" });

    const [tpl] = await db.update(courrier_templates).set({
      name: name.trim(),
      category: category ?? "general",
      body: body ?? "",
      updated_at: new Date(),
    }).where(eq(courrier_templates.id, templateId)).returning();

    res.json(tpl);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

serviceRouter.delete("/templates/:templateId", async (req: AuthRequest, res) => {
  try {
    const templateId = req.params.templateId as string;
    const [user] = await db.select({ service_id: users.service_id }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user?.service_id) return res.status(404).json({ error: "Service introuvable" });

    const [existing] = await db.select({ service_id: courrier_templates.service_id })
      .from(courrier_templates).where(eq(courrier_templates.id, templateId)).limit(1);
    if (!existing || existing.service_id !== user.service_id) return res.status(403).json({ error: "Accès refusé" });

    await db.delete(courrier_templates).where(eq(courrier_templates.id, templateId));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
