import { Router } from "express";
import type { Response } from "express";
import { db } from "../../db.js";
import { dossiers, users, dossier_messages, dossier_consultations } from "@heureka-v1/db";
import { eq, desc, and, sql, isNull } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { getCommuneScope, communeScopeFilter, communeInScope } from "../../middlewares/dossierAccess.js";
import { requirePermission } from "../../middlewares/permissions.js";
import { resolveAttachmentRefs } from "../../services/gedAttachments.js";

export const conversationsRouter = Router();

// Les routes de LISTE (/conversations, /service-conversations) et celles
// adressées par :consultationId ne passent pas par enforceDossierAccess (qui ne
// couvre que /dossiers/:id et /conversations/:dossierId). Elles doivent donc
// appliquer elles-mêmes le périmètre commune — le ?commune= n'est PAS une
// frontière de sécurité.

/** Vérifie que la consultation appartient à un dossier du périmètre de l'agent.
 *  Renvoie le dossier_id, ou null après avoir répondu 404 (pas de fuite
 *  d'existence d'une consultation hors périmètre). */
async function consultationInScopeOr404(req: AuthRequest, res: Response, consultationId: string): Promise<string | null> {
  const [row] = await db
    .select({ dossier_id: dossier_consultations.dossier_id, commune: dossiers.commune })
    .from(dossier_consultations)
    .leftJoin(dossiers, eq(dossier_consultations.dossier_id, dossiers.id))
    .where(eq(dossier_consultations.id, consultationId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Consultation introuvable" });
    return null;
  }
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(row.commune, scope)) {
    res.status(404).json({ error: "Consultation introuvable" });
    return null;
  }
  return row.dossier_id;
}

// ── Conversations : liste avec preview et non-lus ──
conversationsRouter.get("/conversations", requirePermission("messagerie"), async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const scope = await getCommuneScope(req.user!.id, req.user!.role);
    // Périmètre commune appliqué côté SQL ; ?commune= n'est qu'un filtre additionnel.
    const communeFilter = sql`AND (${communeScopeFilter(sql`d.commune`, scope, commune)})`;
    const rows = await db.execute(sql`
      WITH last_msg AS (
        SELECT DISTINCT ON (dossier_id) dossier_id, content, from_role, created_at
        FROM dossier_messages
        WHERE consultation_id IS NULL
        ORDER BY dossier_id, created_at DESC
      ),
      unread AS (
        SELECT dm.dossier_id, COUNT(*)::int AS cnt
        FROM dossier_messages dm
        WHERE dm.consultation_id IS NULL
          AND dm.from_role = 'citoyen'
          AND dm.read_at IS NULL
        GROUP BY dm.dossier_id
      )
      SELECT
        d.id AS dossier_id, d.numero, d.type, d.status,
        COALESCE(u.prenom || ' ' || u.nom, '—') AS petitionnaire,
        lm.content AS last_content, lm.from_role AS last_from_role,
        lm.created_at AS last_at,
        COALESCE(ur.cnt, 0) AS unread_count
      FROM dossiers d
      JOIN last_msg lm ON lm.dossier_id = d.id
      LEFT JOIN users u ON u.id = d.user_id
      LEFT JOIN unread ur ON ur.dossier_id = d.id
      WHERE 1=1 ${communeFilter}
      ORDER BY lm.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Nombre total de messages non lus (pour le badge dashboard) ──
// Combine les fils citoyen↔mairie (messages 'citoyen' non lus) et les fils
// mairie↔service externe (messages 'service_externe%' non lus) pour rester
// cohérent avec le badge maintenu en temps réel par MessageScreen.
conversationsRouter.get("/conversations/unread-count", requirePermission("messagerie"), async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const scope = await getCommuneScope(req.user!.id, req.user!.role);
    const communeFilter = sql`AND (${communeScopeFilter(sql`d.commune`, scope, commune)})`;
    const rows = await db.execute(sql`
      SELECT (
        SELECT COUNT(DISTINCT dm.dossier_id)::int
        FROM dossier_messages dm
        JOIN dossiers d ON d.id = dm.dossier_id
        WHERE dm.consultation_id IS NULL
          AND dm.from_role = 'citoyen'
          AND dm.read_at IS NULL ${communeFilter}
      ) + (
        SELECT COUNT(DISTINCT dm.consultation_id)::int
        FROM dossier_messages dm
        JOIN dossiers d ON d.id = dm.dossier_id
        WHERE dm.consultation_id IS NOT NULL
          AND dm.from_role LIKE 'service_externe%'
          AND dm.read_at IS NULL ${communeFilter}
      ) AS count
    `) as unknown as [{ count: number }];
    res.json({ count: rows[0]?.count ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Thread d'une conversation ──
conversationsRouter.get("/conversations/:dossierId", requirePermission("messagerie"), async (req: AuthRequest, res) => {
  try {
    const msgs = await db
      .select({
        id: dossier_messages.id,
        content: dossier_messages.content,
        from_role: dossier_messages.from_role,
        created_at: dossier_messages.created_at,
        attachments: dossier_messages.attachments,
        prenom: users.prenom,
        nom: users.nom,
      })
      .from(dossier_messages)
      .leftJoin(users, sql`dossier_messages.from_user_id::uuid = users.id`)
      .where(and(
        eq(dossier_messages.dossier_id, req.params.dossierId as string),
        isNull(dossier_messages.consultation_id),
      ))
      .orderBy(dossier_messages.created_at);
    res.json(msgs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Envoyer un message à un citoyen depuis le dossier ──
conversationsRouter.post("/conversations/:dossierId", requirePermission("messagerie"), async (req: AuthRequest, res) => {
  try {
    const content = (req.body?.content as string | undefined)?.trim() ?? "";
    const dossierId = req.params.dossierId as string;
    // Pièces jointes GED jointes au message (ex : pièce annotée par l'instructeur).
    // Un message peut être composé d'une pièce jointe seule (sans texte).
    const attachments = await resolveAttachmentRefs(dossierId, req.body?.attachment_document_ids, "citoyen");
    if (!content && attachments.length === 0) {
      return res.status(400).json({ error: "Contenu ou pièce jointe requis" });
    }

    const [dossier] = await db
      .select({ id: dossiers.id })
      .from(dossiers)
      .where(eq(dossiers.id, dossierId))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const [msg] = await db
      .insert(dossier_messages)
      .values({
        dossier_id: dossierId,
        from_user_id: req.user!.id,
        from_role: req.user!.role,
        content,
        attachments,
      })
      .returning();

    const [author] = await db
      .select({ prenom: users.prenom, nom: users.nom })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);

    res.status(201).json({ ...msg, prenom: author?.prenom ?? null, nom: author?.nom ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Marquer tous les messages citoyens d'une conversation comme lus ──
conversationsRouter.post("/conversations/:dossierId/read", requirePermission("messagerie"), async (req: AuthRequest, res) => {
  try {
    await db
      .update(dossier_messages)
      .set({ read_at: new Date() })
      .where(
        and(
          eq(dossier_messages.dossier_id, req.params.dossierId as string),
          isNull(dossier_messages.consultation_id),
          eq(dossier_messages.from_role, "citoyen"),
          sql`read_at IS NULL`,
        )
      );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Remettre la conversation en non-lu (efface read_at du dernier message citoyen) ──
conversationsRouter.post("/conversations/:dossierId/unread", requirePermission("messagerie"), async (req: AuthRequest, res) => {
  try {
    const [last] = await db
      .select({ id: dossier_messages.id })
      .from(dossier_messages)
      .where(
        and(
          eq(dossier_messages.dossier_id, req.params.dossierId as string),
          isNull(dossier_messages.consultation_id),
          eq(dossier_messages.from_role, "citoyen"),
        )
      )
      .orderBy(desc(dossier_messages.created_at))
      .limit(1);
    if (!last) return res.status(404).json({ error: "Aucun message citoyen" });
    await db
      .update(dossier_messages)
      .set({ read_at: null })
      .where(eq(dossier_messages.id, last.id));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Conversations services consultés (mairie ↔ service externe) ──
// Une conversation = une consultation_id. Le service rattaché est résolu via
// dossier_consultations.external_service_id (peut être NULL si le service n'a
// pas encore de compte/lien — on retombe sur service_name).
conversationsRouter.get("/service-conversations", requirePermission("messagerie"), async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const scope = await getCommuneScope(req.user!.id, req.user!.role);
    const communeFilter = sql`AND (${communeScopeFilter(sql`d.commune`, scope, commune)})`;
    const rows = await db.execute(sql`
      WITH last_msg AS (
        SELECT DISTINCT ON (dm.consultation_id)
          dm.consultation_id, dm.content, dm.from_role, dm.created_at
        FROM dossier_messages dm
        WHERE dm.consultation_id IS NOT NULL
        ORDER BY dm.consultation_id, dm.created_at DESC
      ),
      unread AS (
        SELECT dm.consultation_id, COUNT(*)::int AS cnt
        FROM dossier_messages dm
        WHERE dm.consultation_id IS NOT NULL
          AND dm.from_role LIKE 'service_externe%'
          AND dm.read_at IS NULL
        GROUP BY dm.consultation_id
      )
      SELECT
        c.id AS consultation_id,
        c.dossier_id,
        d.numero,
        d.type,
        d.status,
        c.service_name,
        c.service_type,
        c.status AS consultation_status,
        c.favorable,
        es.id AS service_id,
        es.name AS service_full_name,
        es.email AS service_email,
        lm.content AS last_content,
        lm.from_role AS last_from_role,
        lm.created_at AS last_at,
        COALESCE(ur.cnt, 0) AS unread_count
      FROM dossier_consultations c
      JOIN dossiers d ON d.id = c.dossier_id
      LEFT JOIN external_services es ON es.id = c.external_service_id
      LEFT JOIN last_msg lm ON lm.consultation_id = c.id
      LEFT JOIN unread ur ON ur.consultation_id = c.id
      WHERE 1=1 ${communeFilter}
      ORDER BY COALESCE(lm.created_at, c.created_at) DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

conversationsRouter.get("/service-conversations/:consultationId", requirePermission("messagerie"), async (req: AuthRequest, res) => {
  try {
    const inScope = await consultationInScopeOr404(req, res, req.params.consultationId as string);
    if (!inScope) return;
    const msgs = await db
      .select({
        id: dossier_messages.id,
        content: dossier_messages.content,
        from_role: dossier_messages.from_role,
        created_at: dossier_messages.created_at,
        prenom: users.prenom,
        nom: users.nom,
      })
      .from(dossier_messages)
      .leftJoin(users, sql`dossier_messages.from_user_id::uuid = users.id`)
      .where(eq(dossier_messages.consultation_id, req.params.consultationId as string))
      .orderBy(dossier_messages.created_at);
    res.json(msgs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

conversationsRouter.post("/service-conversations/:consultationId", requirePermission("messagerie"), async (req: AuthRequest, res) => {
  try {
    const content = (req.body?.content as string | undefined)?.trim();
    if (!content) return res.status(400).json({ error: "Contenu requis" });

    const consultationId = req.params.consultationId as string;
    const dossierId = await consultationInScopeOr404(req, res, consultationId);
    if (!dossierId) return;

    const [msg] = await db
      .insert(dossier_messages)
      .values({
        dossier_id: dossierId,
        consultation_id: consultationId,
        from_user_id: req.user!.id,
        from_role: req.user!.role,
        content,
      })
      .returning();

    const [author] = await db
      .select({ prenom: users.prenom, nom: users.nom })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);

    res.status(201).json({ ...msg, prenom: author?.prenom ?? null, nom: author?.nom ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

conversationsRouter.post("/service-conversations/:consultationId/read", requirePermission("messagerie"), async (req: AuthRequest, res) => {
  try {
    const consultationId = req.params.consultationId as string;
    const dossierId = await consultationInScopeOr404(req, res, consultationId);
    if (!dossierId) return;
    await db
      .update(dossier_messages)
      .set({ read_at: new Date() })
      .where(and(
        eq(dossier_messages.consultation_id, consultationId),
        sql`from_role LIKE 'service_externe%'`,
        sql`read_at IS NULL`,
      ));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
