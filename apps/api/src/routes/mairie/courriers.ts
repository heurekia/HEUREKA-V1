import { Router } from "express";
import { db } from "../../db.js";
import { dossier_courriers, users, communes, courrier_templates, legal_mentions, user_communes, dossiers, signataires } from "@heureka-v1/db";
import { eq, and, desc, sql, ilike } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requirePermission } from "../../middlewares/permissions.js";
import { getCommuneScope, communeInScope } from "../../middlewares/dossierAccess.js";
import { CODE_URBANISME_ID } from "../../services/legifrance.js";
import {
  emitPieceComplementRequest,
  renderPieceListHtml,
  type PieceRequestItem,
} from "../../services/pieceRequest.js";
import { deliverCourrier, isCourrierChannel } from "../../services/courrierDelivery.js";

// Corps HTML → texte brut lisible (pour la remise en messagerie d'un courrier
// général, où dossier_messages.content est du texte).
function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export const courriersRouter = Router();

courriersRouter.post("/dossiers/:id/courriers/pieces-complementaires", requirePermission("courriers.generate"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const body = (req.body ?? {}) as {
      pieces?: PieceRequestItem[];
      articles_cites?: string[];
      body_snapshot?: string | null;
      subject?: string | null;
      delivery_method?: string | null;
      attachment_document_ids?: string[];
    };

    if (!Array.isArray(body.pieces) || body.pieces.length === 0) {
      return res.status(400).json({ error: "Au moins une pièce doit être sélectionnée" });
    }
    // Sécurise les entrées libres : on accepte seulement nom + raison + flags
    // attendus, pas d'HTML brut. Un nom vide est invalide.
    const cleaned: PieceRequestItem[] = body.pieces
      .filter((p) => p && typeof p === "object" && typeof p.nom === "string" && p.nom.trim().length > 0)
      .map((p) => ({
        piece_id: typeof p.piece_id === "string" ? p.piece_id : undefined,
        code_piece: typeof p.code_piece === "string" ? p.code_piece : undefined,
        nom: p.nom.trim(),
        raison: typeof p.raison === "string" && p.raison.trim() ? p.raison.trim() : undefined,
        manquante: p.manquante === true || !p.piece_id,
      }));
    if (cleaned.length === 0) {
      return res.status(400).json({ error: "Aucune pièce valide dans la sélection" });
    }
    const articles = Array.isArray(body.articles_cites) ? body.articles_cites.filter((a) => typeof a === "string") : [];

    const result = await emitPieceComplementRequest({
      dossier_id: dossierId,
      pieces: cleaned,
      articles_cites: articles,
      body_snapshot: body.body_snapshot ?? null,
      subject: body.subject ?? null,
      delivery_method: body.delivery_method ?? null,
      attachment_document_ids: Array.isArray(body.attachment_document_ids) ? body.attachment_document_ids : [],
      emis_par: req.user!.id,
    });
    const delivery = isCourrierChannel(body.delivery_method)
      ? await deliverCourrier({
          dossier_id: dossierId,
          channel: body.delivery_method,
          subject: body.subject ?? "Demande de pièces complémentaires",
          pieces: cleaned,
          attachment_document_ids: Array.isArray(body.attachment_document_ids) ? body.attachment_document_ids : [],
          emis_par: req.user!.id,
          emis_par_role: req.user!.role,
        })
      : null;
    res.status(201).json({ ...result, delivery });
  } catch (err) {
    console.error("[courriers/pieces-complementaires]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

courriersRouter.post("/dossiers/:id/courriers/pieces-complementaires/preview", requirePermission("courriers.generate"), async (req: AuthRequest, res) => {
  const body = (req.body ?? {}) as { pieces?: PieceRequestItem[] };
  const pieces = Array.isArray(body.pieces) ? body.pieces.filter((p) => p && typeof p.nom === "string" && p.nom.trim()) : [];
  res.json({ html: renderPieceListHtml(pieces) });
});

courriersRouter.get("/dossiers/:id/courriers", requirePermission("courriers.read"), async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        id: dossier_courriers.id,
        type: dossier_courriers.type,
        subject: dossier_courriers.subject,
        body_snapshot: dossier_courriers.body_snapshot,
        pieces_jointes_ids: dossier_courriers.pieces_jointes_ids,
        articles_cites: dossier_courriers.articles_cites,
        attachments: dossier_courriers.attachments,
        emis_par: dossier_courriers.emis_par,
        emis_le: dossier_courriers.emis_le,
        delivery_method: dossier_courriers.delivery_method,
        statut: dossier_courriers.statut,
        signature_status: dossier_courriers.signature_status,
        signataire_user_id: dossier_courriers.signataire_user_id,
        signature_requested_at: dossier_courriers.signature_requested_at,
        signed_at: dossier_courriers.signed_at,
        signataire_prenom: users.prenom,
        signataire_nom: users.nom,
      })
      .from(dossier_courriers)
      .leftJoin(users, eq(users.id, dossier_courriers.signataire_user_id))
      .where(eq(dossier_courriers.dossier_id, req.params.id as string))
      .orderBy(desc(dossier_courriers.emis_le));
    res.json(rows);
  } catch (err) {
    console.error("[courriers list]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Nettoie une liste de pièces venue du client : on ne garde que nom + raison +
// flags attendus (jamais d'HTML brut), et on rejette les noms vides.
function cleanPieces(raw: unknown): PieceRequestItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is PieceRequestItem => !!p && typeof p === "object" && typeof (p as PieceRequestItem).nom === "string" && (p as PieceRequestItem).nom.trim().length > 0)
    .map((p) => ({
      piece_id: typeof p.piece_id === "string" ? p.piece_id : undefined,
      code_piece: typeof p.code_piece === "string" ? p.code_piece : undefined,
      nom: p.nom.trim(),
      raison: typeof p.raison === "string" && p.raison.trim() ? p.raison.trim() : undefined,
      manquante: p.manquante === true || !p.piece_id,
    }));
}

// ── Brouillons de courrier ────────────────────────────────────────────────
// Un brouillon est un courrier enregistré SANS effet métier : le dossier ne
// bascule pas en incomplet et les pièces ne sont pas marquées. Il reste
// modifiable jusqu'à son envoi. L'accès au dossier est déjà contrôlé par
// enforceDossierAccess (monté sur /dossiers/:id, cf. mairie/index.ts).

// Crée un brouillon (tout type de courrier).
courriersRouter.post("/dossiers/:id/courriers/drafts", requirePermission("courriers.generate"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const body = (req.body ?? {}) as {
      type?: string;
      subject?: string | null;
      body_snapshot?: string | null;
      articles_cites?: string[];
      pieces?: unknown;
      delivery_method?: string | null;
    };
    const type = typeof body.type === "string" && body.type.trim() ? body.type.trim() : "general";
    const articles = Array.isArray(body.articles_cites) ? body.articles_cites.filter((a) => typeof a === "string") : [];
    const [row] = await db.insert(dossier_courriers).values({
      dossier_id: dossierId,
      type,
      subject: body.subject ?? null,
      body_snapshot: body.body_snapshot ?? null,
      pieces_jointes_ids: cleanPieces(body.pieces),
      articles_cites: articles,
      delivery_method: body.delivery_method ?? null,
      statut: "brouillon",
      emis_par: req.user!.id,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[courriers/drafts create]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// Met à jour un brouillon (refusé si déjà envoyé — un courrier émis est figé).
courriersRouter.put("/dossiers/:id/courriers/:courrierId", requirePermission("courriers.generate"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const courrierId = req.params.courrierId as string;
    const [existing] = await db.select({ id: dossier_courriers.id, statut: dossier_courriers.statut })
      .from(dossier_courriers)
      .where(and(eq(dossier_courriers.id, courrierId), eq(dossier_courriers.dossier_id, dossierId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Courrier introuvable" });
    if (existing.statut !== "brouillon") {
      return res.status(409).json({ error: "Ce courrier a déjà été envoyé : il n'est plus modifiable." });
    }
    const body = (req.body ?? {}) as {
      type?: string;
      subject?: string | null;
      body_snapshot?: string | null;
      articles_cites?: string[];
      pieces?: unknown;
      delivery_method?: string | null;
    };
    const patch: Partial<typeof dossier_courriers.$inferInsert> = {};
    if (typeof body.type === "string" && body.type.trim()) patch.type = body.type.trim();
    if ("subject" in body) patch.subject = body.subject ?? null;
    if ("body_snapshot" in body) patch.body_snapshot = body.body_snapshot ?? null;
    if ("delivery_method" in body) patch.delivery_method = body.delivery_method ?? null;
    if (Array.isArray(body.articles_cites)) patch.articles_cites = body.articles_cites.filter((a) => typeof a === "string");
    if ("pieces" in body) patch.pieces_jointes_ids = cleanPieces(body.pieces);
    if (Object.keys(patch).length === 0) {
      const [row] = await db.select().from(dossier_courriers).where(eq(dossier_courriers.id, courrierId)).limit(1);
      return res.json(row);
    }
    const [row] = await db.update(dossier_courriers).set(patch).where(eq(dossier_courriers.id, courrierId)).returning();
    res.json(row);
  } catch (err) {
    console.error("[courriers update draft]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// Envoie un courrier (brouillon → envoyé). Pour une demande de pièces, déclenche
// les effets métier (marquage des pièces, bascule du dossier, événement) via le
// service dédié. Pour les autres types, fige simplement le snapshot et horodate.
courriersRouter.post("/dossiers/:id/courriers/:courrierId/send", requirePermission("courriers.generate"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const courrierId = req.params.courrierId as string;
    const [existing] = await db.select()
      .from(dossier_courriers)
      .where(and(eq(dossier_courriers.id, courrierId), eq(dossier_courriers.dossier_id, dossierId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Courrier introuvable" });
    if (existing.statut === "envoye") return res.status(409).json({ error: "Ce courrier a déjà été envoyé." });
    if (existing.signature_status === "a_signer") {
      return res.status(409).json({ error: "Ce courrier est en attente de signature et ne peut pas encore être envoyé." });
    }

    const body = (req.body ?? {}) as {
      body_snapshot?: string | null;
      subject?: string | null;
      delivery_method?: string | null;
      attachment_document_ids?: string[];
      pieces?: unknown;
      articles_cites?: string[];
    };
    const bodySnapshot = body.body_snapshot ?? existing.body_snapshot ?? null;
    const subject = body.subject ?? existing.subject ?? null;
    const deliveryMethod = body.delivery_method ?? existing.delivery_method ?? null;

    if (existing.type === "pieces_complementaires") {
      // Pièces / articles à jour fournis par le client (la sélection a pu changer
      // depuis l'enregistrement) ; à défaut on retombe sur l'état stocké.
      const fromClient = cleanPieces(body.pieces);
      const pieces = fromClient.length ? fromClient : cleanPieces(existing.pieces_jointes_ids);
      if (pieces.length === 0) return res.status(400).json({ error: "Aucune pièce associée à ce courrier" });
      const articles = Array.isArray(body.articles_cites)
        ? body.articles_cites.filter((a) => typeof a === "string")
        : ((existing.articles_cites as string[]) ?? []);
      const result = await emitPieceComplementRequest({
        dossier_id: dossierId,
        existing_courrier_id: courrierId,
        pieces,
        articles_cites: articles,
        body_snapshot: bodySnapshot,
        subject,
        delivery_method: deliveryMethod ?? "print",
        attachment_document_ids: Array.isArray(body.attachment_document_ids) ? body.attachment_document_ids : [],
        emis_par: req.user!.id,
      });
      const delivery = isCourrierChannel(deliveryMethod)
        ? await deliverCourrier({
            dossier_id: dossierId,
            channel: deliveryMethod,
            subject: subject ?? "Demande de pièces complémentaires",
            pieces,
            attachment_document_ids: Array.isArray(body.attachment_document_ids) ? body.attachment_document_ids : [],
            emis_par: req.user!.id,
            emis_par_role: req.user!.role,
          })
        : null;
      return res.json({ ...result, statut: "envoye", delivery });
    }

    const [row] = await db.update(dossier_courriers).set({
      statut: "envoye",
      body_snapshot: bodySnapshot,
      subject,
      delivery_method: deliveryMethod,
      emis_par: req.user!.id,
      emis_le: new Date(),
    }).where(eq(dossier_courriers.id, courrierId)).returning();
    const delivery = isCourrierChannel(deliveryMethod)
      ? await deliverCourrier({
          dossier_id: dossierId,
          channel: deliveryMethod,
          subject: subject ?? "Courrier du service urbanisme",
          body_text: htmlToText(bodySnapshot),
          attachment_document_ids: Array.isArray(body.attachment_document_ids) ? body.attachment_document_ids : [],
          emis_par: req.user!.id,
          emis_par_role: req.user!.role,
        })
      : null;
    res.json({ courrier_id: courrierId, statut: "envoye", row, delivery });
  } catch (err) {
    console.error("[courriers send]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// ── Circuit de signature ──────────────────────────────────────────────────
// Renvoie le signataire ACTIF de la commune rattaché à un utilisateur (= preuve
// d'habilitation à signer), ou null. signataires.commune est le nom de commune.
//
// La comparaison de commune est insensible à la casse et aux espaces : la
// commune d'un dossier dérive de dossiers.commune — texte libre saisi tel quel
// (« TOURS ») — alors que signataires.commune provient des Paramètres
// (« Tours »). Un eq() strict ne matchait jamais et la signature était refusée à
// tort au signataire pourtant habilité (« Le destinataire n'est pas un
// signataire habilité de la commune. »). Aligné sur signataireCommuneEq /
// isActiveSignataire dans decisions.ts.
async function findSignataire(commune: string, userId: string) {
  const [sig] = await db.select().from(signataires)
    .where(and(
      sql`lower(trim(${signataires.commune})) = ${commune.trim().toLowerCase()}`,
      eq(signataires.user_id, userId),
      eq(signataires.active, true),
    ))
    .limit(1);
  return sig ?? null;
}

// Le rédacteur, s'il est lui-même habilité, appose sa signature/tampon sur place.
// L'habilitation est vérifiée côté serveur (présence d'un signataire actif).
courriersRouter.post("/dossiers/:id/courriers/:courrierId/sign", async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const courrierId = req.params.courrierId as string;
    const [existing] = await db
      .select({ id: dossier_courriers.id, signature_status: dossier_courriers.signature_status })
      .from(dossier_courriers)
      .where(and(eq(dossier_courriers.id, courrierId), eq(dossier_courriers.dossier_id, dossierId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Courrier introuvable" });
    if (existing.signature_status === "signee") return res.status(409).json({ error: "Ce courrier est déjà signé." });
    const [d] = await db.select({ commune: dossiers.commune }).from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    if (!d?.commune) return res.status(400).json({ error: "Commune du dossier introuvable" });
    const sig = await findSignataire(d.commune, req.user!.id);
    if (!sig) return res.status(403).json({ error: "Vous n'êtes pas habilité à signer pour cette commune." });
    const body = (req.body ?? {}) as { body_snapshot?: string | null };
    const [row] = await db.update(dossier_courriers).set({
      signature_status: "signee",
      signataire_user_id: req.user!.id,
      signed_at: new Date(),
      signature_image: sig.signature_image ?? null,
      tampon_image: sig.tampon_image ?? null,
      ...(typeof body.body_snapshot === "string" ? { body_snapshot: body.body_snapshot } : {}),
    }).where(eq(dossier_courriers.id, courrierId)).returning();
    res.json(row);
  } catch (err) {
    console.error("[courriers sign]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// Envoi en signature à un signataire désigné (le rédacteur n'a pas — ou ne veut
// pas exercer — son pouvoir de signature). Traçabilité : demandeur + date + cible.
courriersRouter.post("/dossiers/:id/courriers/:courrierId/request-signature", requirePermission("courriers.generate"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const courrierId = req.params.courrierId as string;
    const targetUserId = typeof req.body?.signataire_user_id === "string" ? req.body.signataire_user_id : null;
    if (!targetUserId) return res.status(400).json({ error: "Signataire requis" });
    const [existing] = await db
      .select({ id: dossier_courriers.id, signature_status: dossier_courriers.signature_status })
      .from(dossier_courriers)
      .where(and(eq(dossier_courriers.id, courrierId), eq(dossier_courriers.dossier_id, dossierId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Courrier introuvable" });
    if (existing.signature_status === "signee") return res.status(409).json({ error: "Ce courrier est déjà signé." });
    const [d] = await db.select({ commune: dossiers.commune }).from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    if (!d?.commune) return res.status(400).json({ error: "Commune du dossier introuvable" });
    const target = await findSignataire(d.commune, targetUserId);
    if (!target) return res.status(400).json({ error: "Le destinataire n'est pas un signataire habilité de la commune." });
    const [row] = await db.update(dossier_courriers).set({
      signature_status: "a_signer",
      signataire_user_id: targetUserId,
      signature_requested_by: req.user!.id,
      signature_requested_at: new Date(),
    }).where(eq(dossier_courriers.id, courrierId)).returning();
    res.json(row);
  } catch (err) {
    console.error("[courriers request-signature]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// ── Courriers : templates & en-tête commune ───────────────────────────────

// Code INSEE explicitement demandé par le client = commune sélectionnée dans
// le sélecteur de l'interface (les agents multi-communes en changent à la
// volée). On ne l'utilise qu'après vérification des droits.
function requestedInsee(req: AuthRequest): string | null {
  const v = req.query?.insee_code as unknown;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Vérifie que l'utilisateur a réellement accès à cette commune (via
// user_communes, ou sa commune principale). Un admin voit toutes les communes.
async function userCanAccessInsee(req: AuthRequest, insee: string): Promise<boolean> {
  if (req.user!.role === "admin") return true;
  const linked = await db
    .select({ insee: communes.insee_code })
    .from(user_communes)
    .innerJoin(communes, eq(user_communes.commune_id, communes.id))
    .where(eq(user_communes.user_id, req.user!.id));
  if (linked.some((r) => r.insee === insee)) return true;
  const [u] = await db.select({ commune_insee: users.commune_insee })
    .from(users).where(eq(users.id, req.user!.id)).limit(1);
  return u?.commune_insee === insee;
}

// INSEE de la commune sélectionnée si — et seulement si — l'utilisateur y a
// droit. Sinon null (on retombera sur la commune principale du compte).
async function resolveSelectedInsee(req: AuthRequest): Promise<string | null> {
  const requested = requestedInsee(req);
  if (requested && (await userCanAccessInsee(req, requested))) return requested;
  return null;
}

// Source of truth: commune sélectionnée (multi-communes) > commune_insee >
// commune name. Creates a minimal commune row on the fly if none exists yet.
async function getCommuneRowForUser(req: AuthRequest) {
  const userId = req.user!.id;

  // Commune explicitement sélectionnée dans l'interface : prioritaire sur la
  // commune principale du compte, après vérification des droits. Sans ça, un
  // agent rattaché à plusieurs communes retombait toujours sur sa commune
  // principale (ex. Ballan-Miré) quel que soit le sélecteur.
  const selected = await resolveSelectedInsee(req);
  if (selected) {
    const [bySelected] = await db.select().from(communes).where(eq(communes.insee_code, selected)).limit(1);
    if (bySelected) return bySelected;
  }

  // Fetch user fields from DB (always up-to-date even with old JWT tokens)
  const [u] = await db.select({ commune: users.commune, commune_insee: users.commune_insee })
    .from(users).where(eq(users.id, userId)).limit(1);

  const inseeCode = req.user!.commune_insee ?? u?.commune_insee;
  const communeName = req.user!.commune ?? u?.commune;

  // 1. Lookup by INSEE code (unambiguous)
  if (inseeCode) {
    const [byInsee] = await db.select().from(communes).where(eq(communes.insee_code, inseeCode)).limit(1);
    if (byInsee) return byInsee;
  }

  // 2. Fallback: lookup by name (ilike then unaccent)
  if (communeName) {
    const name = communeName.trim();
    const [byName] = await db.select().from(communes).where(ilike(communes.name, name)).limit(1);
    if (byName) return byName;
    const [byUnaccent] = await db.select().from(communes)
      .where(sql`unaccent(name) ILIKE unaccent(${name})`).limit(1);
    if (byUnaccent) return byUnaccent;
  }

  // Pas de création silencieuse : la commune doit avoir été créée par un
  // admin (via superAdmin /communes). Sinon n'importe quel mairie peut
  // polluer la table avec des `insee_code` `tmp_*` et créer des templates
  // sous une fausse commune.
  return null;
}

async function getCommuneForUser(req: AuthRequest): Promise<string | null> {
  // Commune sélectionnée dans l'interface (multi-communes) si l'utilisateur y
  // a droit, sinon commune principale du compte.
  const selected = await resolveSelectedInsee(req);
  if (selected) return selected;
  const [u] = await db.select({ commune: users.commune, commune_insee: users.commune_insee })
    .from(users).where(eq(users.id, req.user!.id)).limit(1);
  // Prefer INSEE code as the canonical identifier for template ownership
  return u?.commune_insee ?? u?.commune?.trim() ?? null;
}

// Commune (ligne complète) d'un dossier, APRÈS contrôle d'accès au dossier
// (même périmètre que enforceDossierAccess : user_communes ou commune du
// compte ; admin = tout). Sert à scoper modèles & en-tête sur la commune DU
// DOSSIER quand la modale courrier passe ?dossier_id=, indépendamment de la
// commune principale du compte et de toute correspondance nom→INSEE côté front.
async function getDossierCommuneRow(req: AuthRequest, dossierId: string) {
  const [d] = await db.select({ commune: dossiers.commune })
    .from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
  if (!d?.commune) return null;
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(d.commune, scope)) return null;
  const name = d.commune.trim();
  const [byName] = await db.select().from(communes).where(ilike(communes.name, name)).limit(1);
  if (byName) return byName;
  const [byUnaccent] = await db.select().from(communes)
    .where(sql`unaccent(name) ILIKE unaccent(${name})`).limit(1);
  return byUnaccent ?? null;
}

courriersRouter.get("/templates", requirePermission("courriers.read"), async (req: AuthRequest, res) => {
  try {
    // Priorité au périmètre DU DOSSIER (modale courrier) : on résout la commune
    // du dossier côté serveur et on matche les modèles par INSEE *ou* par nom —
    // robuste quel que soit le stockage (seed = INSEE, modèles anciens = nom).
    const dossierId = typeof req.query.dossier_id === "string" && req.query.dossier_id.trim()
      ? req.query.dossier_id.trim() : null;
    if (dossierId) {
      const row = await getDossierCommuneRow(req, dossierId);
      if (row) {
        // Match par INSEE *ou* par nom. NB : surtout pas `ANY(${tableau})` —
        // drizzle développe un tableau JS en `($1,$2)` (une ROW), alors que
        // ANY() exige un vrai tableau SQL → erreur 500. On compare donc des
        // scalaires explicites (commune_insee et name sont NOT NULL).
        const insee = row.insee_code;
        const name = row.name;
        const rows = await db.select().from(courrier_templates)
          .where(sql`commune_insee IN (${insee}, ${name}) OR commune ILIKE ${insee} OR commune ILIKE ${name}`)
          .orderBy(courrier_templates.created_at);
        return res.json(rows);
      }
      // Dossier introuvable ou hors périmètre : repli sur la commune du compte.
    }
    const communeKey = await getCommuneForUser(req);
    if (!communeKey) return res.json([]);
    const rows = await db.select().from(courrier_templates)
      .where(sql`commune_insee = ${communeKey} OR (commune_insee IS NULL AND commune ILIKE ${communeKey})`)
      .orderBy(courrier_templates.created_at);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

courriersRouter.post("/templates", requirePermission("courriers.templates"), async (req: AuthRequest, res) => {
  try {
    const communeKey = await getCommuneForUser(req);
    if (!communeKey) return res.status(400).json({ error: "Commune introuvable" });
    const { name, category = "general", body = "" } = req.body as { name?: string; category?: string; body?: string };
    if (!name?.trim()) return res.status(400).json({ error: "Nom requis" });
    const [tpl] = await db.insert(courrier_templates).values({
      commune_insee: communeKey,
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

courriersRouter.put("/templates/:templateId", requirePermission("courriers.templates"), async (req: AuthRequest, res) => {
  try {
    const templateId = req.params.templateId as string;
    const communeKey = await getCommuneForUser(req);
    const [existing] = await db.select({ commune_insee: courrier_templates.commune_insee, commune: courrier_templates.commune })
      .from(courrier_templates).where(eq(courrier_templates.id, templateId)).limit(1);
    const ownerKey = existing?.commune_insee ?? existing?.commune;
    if (!existing || ownerKey?.toLowerCase() !== communeKey?.toLowerCase()) return res.status(403).json({ error: "Accès refusé" });
    const { name, category, body } = req.body as { name?: string; category?: string; body?: string };
    if (!name?.trim()) return res.status(400).json({ error: "Nom requis" });
    const [tpl] = await db.update(courrier_templates).set({
      name: name.trim(), category: category ?? "general", body: body ?? "", updated_at: new Date(),
    }).where(eq(courrier_templates.id, templateId)).returning();
    res.json(tpl);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

courriersRouter.delete("/templates/:templateId", requirePermission("courriers.templates"), async (req: AuthRequest, res) => {
  try {
    const templateId = req.params.templateId as string;
    const communeKey = await getCommuneForUser(req);
    const [existing] = await db.select({ commune_insee: courrier_templates.commune_insee, commune: courrier_templates.commune })
      .from(courrier_templates).where(eq(courrier_templates.id, templateId)).limit(1);
    const ownerKey = existing?.commune_insee ?? existing?.commune;
    if (!existing || ownerKey?.toLowerCase() !== communeKey?.toLowerCase()) return res.status(403).json({ error: "Accès refusé" });
    await db.delete(courrier_templates).where(eq(courrier_templates.id, templateId));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

courriersRouter.get("/commune-letterhead", requirePermission("courriers.read"), async (req: AuthRequest, res) => {
  try {
    // En-tête de la commune DU DOSSIER si la modale passe ?dossier_id= (sinon
    // commune du compte), pour que logo/titre/signature correspondent au dossier.
    const dossierId = typeof req.query.dossier_id === "string" && req.query.dossier_id.trim()
      ? req.query.dossier_id.trim() : null;
    const commune = (dossierId ? await getDossierCommuneRow(req, dossierId) : null) ?? await getCommuneRowForUser(req);
    if (!commune) return res.json({ commune_configured: false });
    res.json({
      commune_configured: true,
      letterhead_logo: commune.letterhead_logo ?? commune.logo_url,
      commune_logo_url: commune.logo_url,
      letterhead_title: commune.letterhead_title ?? commune.name,
      letterhead_subtitle: commune.letterhead_subtitle,
      letterhead_address: commune.letterhead_address,
      footer_text: commune.footer_text,
      signature_image: commune.signature_image,
      tampon_image: commune.tampon_image,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

courriersRouter.put("/commune-letterhead", requirePermission("courriers.templates"), async (req: AuthRequest, res) => {
  try {
    const commune = await getCommuneRowForUser(req);
    if (!commune) return res.status(404).json({ error: "Commune introuvable — vérifiez que votre compte est bien rattaché à une commune dans l'administration." });
    const { letterhead_logo, letterhead_title, letterhead_subtitle, letterhead_address, footer_text, signature_image, tampon_image } = req.body as Record<string, string | null>;
    await db.update(communes).set({
      letterhead_logo: letterhead_logo ?? null,
      letterhead_title: letterhead_title ?? null,
      letterhead_subtitle: letterhead_subtitle ?? null,
      letterhead_address: letterhead_address ?? null,
      footer_text: footer_text ?? null,
      signature_image: signature_image ?? null,
      tampon_image: tampon_image ?? null,
      updated_at: new Date(),
    }).where(eq(communes.id, commune.id));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Legal mentions (Code de l'urbanisme cache) ────────────────────────────────
courriersRouter.get("/legal-mentions", requirePermission("courriers.read"), async (req: AuthRequest, res) => {
  try {
    const dossierType = (req.query.type as string | undefined) ?? "";
    const courrierType = (req.query.courrier_type as string | undefined) ?? "";

    // Map full dossier type name to short code
    const TYPE_SHORT: Record<string, string> = {
      permis_de_construire: "PC",
      permis_de_construire_mi: "PCMI",
      declaration_prealable: "DP",
      permis_amenager: "PA",
      permis_demolir: "PD",
      certificat_urbanisme: "CU",
      certificat_urbanisme_a: "CUa",
      certificat_urbanisme_b: "CUb",
    };
    const dossierShort = TYPE_SHORT[dossierType] ?? dossierType.toUpperCase();

    const rows = await db
      .select()
      .from(legal_mentions)
      .where(eq(legal_mentions.code, CODE_URBANISME_ID))
      .orderBy(legal_mentions.article_ref);

    res.json(rows.map((r) => {
      const ct = (r.courrier_types as string[]) ?? [];
      const dt = (r.dossier_types as string[]) ?? [];
      const matchesCourrier = !courrierType || ct.length === 0 || ct.includes(courrierType);
      const matchesDossier = !dossierShort || dt.length === 0 || dt.includes(dossierShort);
      return { ...r, suggested: matchesCourrier && matchesDossier };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
