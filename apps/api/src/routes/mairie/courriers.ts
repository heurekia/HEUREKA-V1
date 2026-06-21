import { Router } from "express";
import { db } from "../../db.js";
import { dossier_courriers, users, communes, courrier_templates, legal_mentions, user_communes } from "@heureka-v1/db";
import { eq, desc, sql, ilike } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { CODE_URBANISME_ID } from "../../services/legifrance.js";
import {
  emitPieceComplementRequest,
  renderPieceListHtml,
  type PieceRequestItem,
} from "../../services/pieceRequest.js";

export const courriersRouter = Router();

courriersRouter.post("/dossiers/:id/courriers/pieces-complementaires", async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const body = (req.body ?? {}) as {
      pieces?: PieceRequestItem[];
      articles_cites?: string[];
      body_snapshot?: string | null;
      subject?: string | null;
      delivery_method?: string | null;
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
      emis_par: req.user!.id,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error("[courriers/pieces-complementaires]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

courriersRouter.post("/dossiers/:id/courriers/pieces-complementaires/preview", async (req: AuthRequest, res) => {
  const body = (req.body ?? {}) as { pieces?: PieceRequestItem[] };
  const pieces = Array.isArray(body.pieces) ? body.pieces.filter((p) => p && typeof p.nom === "string" && p.nom.trim()) : [];
  res.json({ html: renderPieceListHtml(pieces) });
});

courriersRouter.get("/dossiers/:id/courriers", async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        id: dossier_courriers.id,
        type: dossier_courriers.type,
        subject: dossier_courriers.subject,
        pieces_jointes_ids: dossier_courriers.pieces_jointes_ids,
        articles_cites: dossier_courriers.articles_cites,
        emis_par: dossier_courriers.emis_par,
        emis_le: dossier_courriers.emis_le,
        delivery_method: dossier_courriers.delivery_method,
      })
      .from(dossier_courriers)
      .where(eq(dossier_courriers.dossier_id, req.params.id as string))
      .orderBy(desc(dossier_courriers.emis_le));
    res.json(rows);
  } catch (err) {
    console.error("[courriers list]", err);
    res.status(500).json({ error: "Erreur serveur" });
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

courriersRouter.get("/templates", async (req: AuthRequest, res) => {
  try {
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

courriersRouter.post("/templates", async (req: AuthRequest, res) => {
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

courriersRouter.put("/templates/:templateId", async (req: AuthRequest, res) => {
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

courriersRouter.delete("/templates/:templateId", async (req: AuthRequest, res) => {
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

courriersRouter.get("/commune-letterhead", async (req: AuthRequest, res) => {
  try {
    const commune = await getCommuneRowForUser(req);
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

courriersRouter.put("/commune-letterhead", async (req: AuthRequest, res) => {
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
courriersRouter.get("/legal-mentions", async (req: AuthRequest, res) => {
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
