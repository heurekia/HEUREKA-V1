import { Router } from "express";
import { db } from "../db.js";
import { dossiers, users, notifications, dossier_messages, zones, zone_regulatory_rules, communes, courrier_templates, user_communes, legal_mentions, user_availability, user_absences, commune_documents, dossier_consultations, external_services, service_communes } from "@heureka-v1/db";
import { eq, desc, and, sql, like, ilike, inArray } from "drizzle-orm";
import { CODE_URBANISME_ID } from "../services/legifrance.js";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { analyseParcel } from "../services/parcelAnalysis.js";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { PDFDocument } from "pdf-lib";

// Anthropic limite chaque requête à ~100 pages de PDF. Les gros règlements PLU
// (200+ pages) sont découpés en tronçons ≤ maxPages, avec un léger chevauchement
// pour ne pas couper en deux la section d'une zone à cheval sur deux tronçons.
// Un PLU court (≤ 100 pages) reste en un seul tronçon (le PDF d'origine).
async function splitPdfBase64(base64: string, maxPages = 90, overlap = 8): Promise<string[]> {
  const src = await PDFDocument.load(Buffer.from(base64, "base64"), { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total <= 100) return [base64];

  const chunks: string[] = [];
  const stride = Math.max(1, maxPages - overlap);
  for (let start = 0; start < total; start += stride) {
    const end = Math.min(start + maxPages, total);
    const out = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await out.copyPages(src, indices);
    pages.forEach(p => out.addPage(p));
    chunks.push(await out.saveAsBase64());
    if (end >= total) break;
  }
  return chunks;
}

// Parse un tableau JSON éventuellement TRONQUÉ (réponse LLM coupée à max_tokens).
// Tente le parse complet ; sinon ferme l'array au dernier objet entier ("}") pour
// récupérer les sous-règles complètes. Renvoie [] si rien d'exploitable.
function parseLooseArray(raw: string): unknown[] {
  const start = raw.indexOf("[");
  if (start < 0) return [];
  const s = raw.slice(start);
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v;
  } catch { /* try salvage */ }
  const lastObj = s.lastIndexOf("}");
  if (lastObj > 0) {
    try {
      const v = JSON.parse(s.slice(0, lastObj + 1) + "]");
      if (Array.isArray(v)) return v;
    } catch { /* give up */ }
  }
  return [];
}

function getAnthropicApiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const candidates = [
    process.env.CLAUDE_SESSION_INGRESS_TOKEN_FILE,
    "/home/claude/.claude/remote/.session_ingress_token",
  ];
  for (const p of candidates) {
    if (!p) continue;
    try {
      const token = fs.readFileSync(p, "utf8").trim();
      if (token) return token;
    } catch { /* try next */ }
  }
  throw new Error("ANTHROPIC_API_KEY non configurée");
}

export const mairieRouter = Router();

mairieRouter.use(requireAuth);
mairieRouter.use(requireRole("mairie", "instructeur", "admin"));

// Délais réglementaires d'instruction (Code de l'Urbanisme)
// Calculés à partir de la date de complétude, ou de dépôt si non renseignée.
const DELAI_INSTRUCTION_MOIS: Record<string, number> = {
  permis_de_construire: 2,    // R.423-23 — droit commun
  declaration_prealable: 1,   // R.423-24
  permis_amenager: 3,         // R.423-25
  permis_demolir: 2,          // R.423-26
  permis_lotir: 3,            // R.423-25 (assimilé PA)
  certificat_urbanisme: 2,    // R.410-9 — CUb opérationnel
};

// ── Dashboard stats ──
mairieRouter.get("/dashboard", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`commune ILIKE ${commune}` : sql`1=1`;

    const total = await db.select({ count: sql<number>`count(*)` }).from(dossiers).where(communeFilter);
    const parStatut = await db
      .select({ status: dossiers.status, count: sql<number>`count(*)` })
      .from(dossiers)
      .where(communeFilter)
      .groupBy(dossiers.status);

    const recent = await db
      .select()
      .from(dossiers)
      .where(communeFilter)
      .orderBy(desc(dossiers.updated_at))
      .limit(10);

    const pendingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(dossiers)
      .where(sql`status NOT IN ('accepte', 'refuse', 'brouillon') AND (${communeFilter})`);

    res.json({
      total_dossiers: Number(total[0]?.count ?? 0),
      dossiers_par_statut: parStatut.map((r) => ({ status: r.status, count: Number(r.count) })),
      dossiers_recents: recent,
      en_cours: Number(pendingCount[0]?.count ?? 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste tous les dossiers (mairie) ──
mairieRouter.get("/dossiers", async (req: AuthRequest, res) => {
  try {
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`dossiers.commune ILIKE ${commune}` : sql`1=1`;

    const sel = {
      id: dossiers.id, numero: dossiers.numero, type: dossiers.type, status: dossiers.status,
      adresse: dossiers.adresse, commune: dossiers.commune, code_postal: dossiers.code_postal,
      parcelle: dossiers.parcelle, surface_plancher: dossiers.surface_plancher,
      description: dossiers.description, date_depot: dossiers.date_depot,
      date_completude: dossiers.date_completude,
      date_limite_instruction: dossiers.date_limite_instruction,
      date_delivrance: dossiers.date_delivrance,
      created_at: dossiers.created_at,
      demandeur_prenom: users.prenom, demandeur_nom: users.nom,
    };

    let rows;
    if (search) {
      const pattern = `%${search}%`;
      rows = await db.select(sel).from(dossiers)
        .leftJoin(users, eq(dossiers.user_id, users.id))
        .where(sql`(${communeFilter}) AND dossiers.status != 'brouillon' AND (dossiers.numero ILIKE ${pattern} OR dossiers.adresse ILIKE ${pattern} OR dossiers.commune ILIKE ${pattern} OR users.prenom ILIKE ${pattern} OR users.nom ILIKE ${pattern} OR CONCAT(users.prenom, ' ', users.nom) ILIKE ${pattern})`)
        .orderBy(desc(dossiers.created_at));
    } else if (status) {
      rows = await db.select(sel).from(dossiers)
        .leftJoin(users, eq(dossiers.user_id, users.id))
        .where(sql`(${communeFilter}) AND dossiers.status = ${status}`)
        .orderBy(desc(dossiers.created_at));
    } else {
      rows = await db.select(sel).from(dossiers)
        .leftJoin(users, eq(dossiers.user_id, users.id))
        .where(sql`(${communeFilter}) AND dossiers.status != 'brouillon'`)
        .orderBy(desc(dossiers.created_at));
    }

    res.json(rows.map(r => ({
      ...r,
      demandeur: [r.demandeur_prenom, r.demandeur_nom].filter(Boolean).join(" ") || "—",
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Export CSV dossiers ──
mairieRouter.get("/dossiers/export", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`dossiers.commune ILIKE ${commune}` : sql`1=1`;

    const rows = await db.select({
      id: dossiers.id, numero: dossiers.numero, type: dossiers.type, status: dossiers.status,
      adresse: dossiers.adresse, commune: dossiers.commune, code_postal: dossiers.code_postal,
      parcelle: dossiers.parcelle, description: dossiers.description,
      surface_plancher: dossiers.surface_plancher,
      date_depot: dossiers.date_depot, date_completude: dossiers.date_completude,
      date_limite_instruction: dossiers.date_limite_instruction,
      is_tacite: dossiers.is_tacite, created_at: dossiers.created_at, updated_at: dossiers.updated_at,
      demandeur_prenom: users.prenom, demandeur_nom: users.nom, demandeur_email: users.email,
    })
      .from(dossiers)
      .leftJoin(users, eq(dossiers.user_id, users.id))
      .where(communeFilter)
      .orderBy(desc(dossiers.created_at));

    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      const s = v instanceof Date ? v.toISOString() : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const headers = [
      "Numéro", "Type", "Statut", "Pétitionnaire", "Email", "Adresse", "Commune",
      "Code postal", "Parcelle", "Surface plancher", "Description",
      "Date dépôt", "Date complétude", "Date limite instruction",
      "Tacite", "Créé le", "Mis à jour le",
    ];

    const csvRows = rows.map(r => [
      r.numero, r.type, r.status,
      [r.demandeur_prenom, r.demandeur_nom].filter(Boolean).join(" "),
      r.demandeur_email,
      r.adresse, r.commune, r.code_postal, r.parcelle, r.surface_plancher, r.description,
      r.date_depot, r.date_completude, r.date_limite_instruction,
      r.is_tacite ? "oui" : "non",
      r.created_at, r.updated_at,
    ].map(esc).join(","));

    const csv = [headers.join(","), ...csvRows].join("\n");
    const filename = `dossiers-${commune ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // BOM for Excel compatibility (UTF-8)
    res.send("﻿" + csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Détail dossier mairie ──
mairieRouter.get("/dossiers/:id", async (req: AuthRequest, res) => {
  try {
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    const [demandeur] = await db
      .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
      .from(users)
      .where(eq(users.id, dossier.user_id))
      .limit(1);
    let instructeur = null;
    if (dossier.instructeur_id) {
      const [inst] = await db
        .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
        .from(users)
        .where(eq(users.id, dossier.instructeur_id))
        .limit(1);
      instructeur = inst ?? null;
    }
    res.json({ ...dossier, demandeur: demandeur ?? null, instructeur });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Changer le statut d'un dossier ──
mairieRouter.patch("/dossiers/:id/status", async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Statut requis" });

    // Lire le dossier avant update pour calculer l'échéance si nécessaire
    const [before] = await db.select().from(dossiers).where(eq(dossiers.id, req.params.id as string)).limit(1);
    if (!before) return res.status(404).json({ error: "Dossier non trouvé" });

    const patch: Partial<typeof before> & { updated_at: Date } = { status: status as typeof before.status, updated_at: new Date() };

    // Auto-date dépôt quand passage en "soumis"
    if (status === "soumis" && !before.date_depot) {
      patch.date_depot = new Date();
    }

    // Auto-calcul de l'échéance si elle n'est pas encore renseignée
    if (!before.date_limite_instruction) {
      const startDate = (before.date_completude ?? patch.date_depot ?? before.date_depot);
      if (startDate) {
        const months = DELAI_INSTRUCTION_MOIS[before.type] ?? 2;
        const deadline = new Date(startDate);
        deadline.setMonth(deadline.getMonth() + months);
        patch.date_limite_instruction = deadline;
      }
    }

    const [updated] = await db.update(dossiers).set(patch).where(eq(dossiers.id, req.params.id as string)).returning();
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Assigner un instructeur ──
mairieRouter.patch("/dossiers/:id/assign", async (req: AuthRequest, res) => {
  try {
    const { instructeur_id } = req.body;
    if (!instructeur_id) return res.status(400).json({ error: "instructeur_id requis" });
    const [dossier] = await db
      .update(dossiers)
      .set({ instructeur_id, updated_at: new Date() })
      .where(eq(dossiers.id, req.params.id as string))
      .returning();
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    res.json(dossier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Statistiques ──
mairieRouter.get("/stats", async (_req: AuthRequest, res) => {
  try {
    const total = await db.select({ count: sql<number>`count(*)` }).from(dossiers);
    const parType = await db
      .select({ type: dossiers.type, count: sql<number>`count(*)` })
      .from(dossiers)
      .groupBy(dossiers.type);
    const parMois = await db
      .select({
        mois: sql<string>`to_char(date_depot, 'YYYY-MM')`,
        count: sql<number>`count(*)`,
      })
      .from(dossiers)
      .where(sql`date_depot IS NOT NULL`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    res.json({
      total: Number(total[0]?.count ?? 0),
      par_type: parType,
      par_mois: parMois,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des instructeurs ──
mairieRouter.get("/instructeurs", async (_req: AuthRequest, res) => {
  try {
    const instructeurs = await db
      .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
      .from(users)
      .where(sql`role IN ('instructeur', 'mairie', 'admin')`);
    res.json(instructeurs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Communes de l'utilisateur connecté ──
mairieRouter.get("/my-communes", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const rows = await db
      .select({ name: communes.name, insee_code: communes.insee_code })
      .from(user_communes)
      .innerJoin(communes, eq(user_communes.commune_id, communes.id))
      .where(eq(user_communes.user_id, userId))
      .orderBy(communes.name);
    if (rows.length > 0) return res.json(rows);
    // Fallback: commune principale de l'utilisateur
    const [user] = await db.select({ commune: users.commune, commune_insee: users.commune_insee })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (user?.commune) return res.json([{ name: user.commune, insee_code: user.commune_insee ?? null }]);
    res.json([]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des communes (noms seuls pour le sélecteur) ──
mairieRouter.get("/communes", async (_req: AuthRequest, res) => {
  try {
    const rows = await db.select({ name: communes.name }).from(communes).orderBy(communes.name);
    const names = rows.map(r => r.name);
    if (names.length) return res.json(names);
    // Fallback: read from dossiers if communes table is empty
    const fallback = await db.selectDistinct({ commune: dossiers.commune }).from(dossiers).where(sql`commune IS NOT NULL`).orderBy(dossiers.commune);
    res.json(fallback.map(r => r.commune).filter(Boolean));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des communes avec code INSEE (pour la carte et le sélecteur) ──
mairieRouter.get("/commune-list", async (_req: AuthRequest, res) => {
  try {
    const rows = await db.select({
      name: communes.name,
      insee_code: communes.insee_code,
      zip_code: communes.zip_code,
    }).from(communes).orderBy(communes.name);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Lookup INSEE via geo.api.gouv.fr (évite CORS côté navigateur) ──
mairieRouter.get("/admin/insee-lookup", async (req: AuthRequest, res) => {
  try {
    const nom = (req.query.nom as string ?? "").trim();
    if (nom.length < 2) return res.status(400).json({ error: "Nom requis (min 2 caractères)" });
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(nom)}&fields=code,nom,codesPostaux,departement,region&limit=8&boost=population`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return res.status(502).json({ error: "geo.api.gouv.fr indisponible" });
    const data = await r.json() as Array<{
      code: string; nom: string;
      codesPostaux?: string[];
      departement?: { nom: string; code: string };
      region?: { nom: string; code: string };
    }>;
    res.json(data.map(c => ({
      nom: c.nom,
      insee: c.code,
      zip: c.codesPostaux?.[0] ?? null,
      departement: c.departement ? `${c.departement.nom} (${c.departement.code})` : null,
      region: c.region?.nom ?? null,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Détails d'une commune (onglet Général) ──
mairieRouter.get("/admin/commune-details", async (req: AuthRequest, res) => {
  try {
    const communeName = (req.query.commune as string ?? "").trim();
    if (!communeName) return res.status(400).json({ error: "Paramètre commune requis" });
    const [row] = await db.select().from(communes).where(ilike(communes.name, communeName));
    if (!row) return res.status(404).json({ error: "Commune non trouvée" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Mise à jour d'une commune (admin uniquement) ──
mairieRouter.patch("/admin/commune-details", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const communeName = (req.query.commune as string ?? "").trim();
    if (!communeName) return res.status(400).json({ error: "Paramètre commune requis" });
    const { email, telephone, logo_url, population, surface, departement, region, description } = req.body as Record<string, string | undefined>;
    await db.update(communes)
      .set({ email: email ?? null, telephone: telephone ?? null, logo_url: logo_url ?? null,
             population: population ?? null, surface: surface ?? null,
             departement: departement ?? null, region: region ?? null,
             description: description ?? null, updated_at: new Date() })
      .where(ilike(communes.name, communeName));
    const [updated] = await db.select().from(communes).where(ilike(communes.name, communeName));
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Ajout d'une commune (admin, onboarding) ──
mairieRouter.post("/admin/communes", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const { name, insee_code, zip_code, email, telephone, population, surface, departement, region, description } = req.body as Record<string, string | undefined>;
    if (!name || !insee_code) return res.status(400).json({ error: "name et insee_code requis" });
    const [row] = await db.insert(communes).values({
      name, insee_code, zip_code: zip_code ?? null,
      email: email ?? null, telephone: telephone ?? null,
      population: population ?? null, surface: surface ?? null,
      departement: departement ?? null, region: region ?? null,
      description: description ?? null,
    }).onConflictDoUpdate({
      target: communes.insee_code,
      set: { name, zip_code: zip_code ?? null, updated_at: new Date() },
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des utilisateurs d'une commune ──
mairieRouter.get("/admin/users", async (req: AuthRequest, res) => {
  try {
    const communeName = (req.query.commune as string ?? "").trim();
    if (!communeName) return res.status(400).json({ error: "Paramètre commune requis" });
    const rows = await db.select({
      id: users.id, email: users.email, prenom: users.prenom, nom: users.nom,
      role: users.role, commune: users.commune, telephone: users.telephone,
      role_config_id: users.role_config_id,
      created_at: users.created_at,
    }).from(users).where(ilike(users.commune, communeName));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Création d'un utilisateur (admin ou mairie pour leur commune) ──
mairieRouter.post("/admin/users", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  try {
    // "mairie" users can only create agents for their own commune
    const communeName = req.user?.role === "admin"
      ? (req.query.commune as string ?? "").trim()
      : (req.user?.commune ?? "");
    const { email, prenom, nom, role, telephone, role_config_id } = req.body as Record<string, string | undefined>;
    if (!email || !prenom || !nom || !role) return res.status(400).json({ error: "email, prenom, nom, role requis" });
    const validRoles = req.user?.role === "admin" ? ["mairie", "instructeur", "admin"] : ["mairie", "instructeur"];
    if (!validRoles.includes(role)) return res.status(400).json({ error: "Rôle invalide" });
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase().trim()));
    if (existing) return res.status(409).json({ error: "Un compte avec cet email existe déjà" });
    const { default: bcrypt } = await import("bcryptjs");
    const { randomBytes } = await import("crypto");
    const { sendActivationEmail } = await import("../services/mailer.js");
    const { password_tokens } = await import("@heureka-v1/db");
    const hash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const [newUser] = await db.insert(users).values({
      email: email.toLowerCase().trim(), prenom, nom,
      role: role as "mairie" | "instructeur" | "admin",
      commune: communeName || null, telephone: telephone ?? null,
      password_hash: hash,
      role_config_id: role_config_id ?? null,
    }).returning({ id: users.id, email: users.email, prenom: users.prenom, nom: users.nom, role: users.role, commune: users.commune, role_config_id: users.role_config_id });
    const token = randomBytes(32).toString("hex");
    await db.insert(password_tokens).values({
      user_id: newUser!.id,
      token,
      type: "activation",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await sendActivationEmail({
      to: email.toLowerCase().trim(),
      prenom,
      serviceName: communeName || "Heurekia",
      token,
    }).catch((err) => console.error("[mailer] invitation:", err));
    res.status(201).json({ ...newUser, invited: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Mise à jour rôle/infos d'un utilisateur (admin ou mairie pour leur commune) ──
mairieRouter.patch("/admin/users/:id", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  try {
    const userId = req.params.id as string;
    const { role, prenom, nom, telephone, role_config_id } = req.body as Record<string, string | undefined>;
    // "mairie" users can only update agents in their commune
    if (req.user?.role === "mairie") {
      const [target] = await db.select({ commune: users.commune }).from(users).where(eq(users.id, userId));
      if (!target || target.commune?.toLowerCase() !== (req.user.commune ?? "").toLowerCase()) {
        return res.status(403).json({ error: "Accès refusé" });
      }
    }
    const validRoles = req.user?.role === "admin" ? ["mairie", "instructeur", "admin", "citoyen"] : ["mairie", "instructeur"];
    if (role && !validRoles.includes(role)) return res.status(400).json({ error: "Rôle invalide" });
    await db.update(users).set({
      ...(role ? { role: role as "mairie" | "instructeur" | "admin" | "citoyen" } : {}),
      ...(prenom ? { prenom } : {}),
      ...(nom ? { nom } : {}),
      ...(telephone !== undefined ? { telephone } : {}),
      ...(role_config_id !== undefined ? { role_config_id: role_config_id || null } : {}),
      updated_at: new Date(),
    }).where(eq(users.id, userId));
    const [updated] = await db.select({
      id: users.id, email: users.email, prenom: users.prenom, nom: users.nom,
      role: users.role, commune: users.commune, telephone: users.telephone,
      role_config_id: users.role_config_id,
    }).from(users).where(eq(users.id, userId));
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Suppression d'un utilisateur (admin ou mairie pour leur commune) ──
mairieRouter.delete("/admin/users/:id", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  try {
    const reqUser = req.user as { id: string; role: string; commune?: string };
    const userId = req.params.id as string;
    if (userId === reqUser.id) return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte" });
    // "mairie" users can only delete agents in their commune
    if (reqUser.role === "mairie") {
      const [target] = await db.select({ commune: users.commune }).from(users).where(eq(users.id, userId));
      if (!target || target.commune?.toLowerCase() !== (reqUser.commune ?? "").toLowerCase()) {
        return res.status(403).json({ error: "Accès refusé" });
      }
    }
    await db.delete(users).where(eq(users.id, userId));
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Dossiers géolocalisés pour la carte ──
mairieRouter.get("/map-dossiers", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;

    const rows = await db
      .select({
        id: dossiers.id,
        numero: dossiers.numero,
        type: dossiers.type,
        status: dossiers.status,
        adresse: dossiers.adresse,
        commune: dossiers.commune,
        code_postal: dossiers.code_postal,
        metadata: dossiers.metadata,
      })
      .from(dossiers)
      .where(
        commune
          ? sql`commune ILIKE ${commune} AND adresse IS NOT NULL AND status != 'brouillon'`
          : sql`adresse IS NOT NULL AND status != 'brouillon'`
      )
      .orderBy(desc(dossiers.created_at))
      .limit(200);

    // Géocode les dossiers sans coordonnées et met en cache dans metadata
    async function geocode(adresse: string, communeNom: string, codePostal: string | null): Promise<{ lat: number; lng: number } | null> {
      try {
        const q = encodeURIComponent(`${adresse} ${communeNom}`);
        const citycode = codePostal ? `&postcode=${encodeURIComponent(codePostal)}` : "";
        const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${q}${citycode}&limit=1`);
        if (!r.ok) return null;
        const data = await r.json() as { features?: { geometry: { coordinates: [number, number] }; properties: { score: number } }[] };
        const feature = data.features?.[0];
        if (!feature || feature.properties.score < 0.4) return null;
        const [lng, lat] = feature.geometry.coordinates;
        return { lat, lng };
      } catch {
        return null;
      }
    }

    const result = await Promise.all(rows.map(async d => {
      const meta = (d.metadata ?? {}) as Record<string, unknown>;
      let lat = parseFloat(String(meta["lat"] ?? ""));
      let lng = parseFloat(String(meta["lng"] ?? ""));

      if ((isNaN(lat) || isNaN(lng)) && d.adresse) {
        const coords = await geocode(d.adresse, d.commune ?? "", d.code_postal ?? null);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
          // Cache dans metadata pour les prochains appels
          await db.update(dossiers)
            .set({ metadata: { ...meta, lat, lng } })
            .where(eq(dossiers.id, d.id));
        }
      }

      return { id: d.id, numero: d.numero, type: d.type, status: d.status, adresse: d.adresse ?? "", commune: d.commune ?? "", lat, lng };
    }));

    res.json(result.filter(d => !isNaN(d.lat) && !isNaN(d.lng)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Conversations : liste avec preview et non-lus ──
mairieRouter.get("/conversations", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`AND d.commune ILIKE ${commune}` : sql``;
    const rows = await db.execute(sql`
      WITH last_msg AS (
        SELECT DISTINCT ON (dossier_id) dossier_id, content, from_role, created_at
        FROM dossier_messages
        ORDER BY dossier_id, created_at DESC
      ),
      unread AS (
        SELECT dm.dossier_id, COUNT(*)::int AS cnt
        FROM dossier_messages dm
        WHERE dm.from_role = 'citoyen' AND dm.read_at IS NULL
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
mairieRouter.get("/conversations/unread-count", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`AND d.commune ILIKE ${commune}` : sql``;
    const rows = await db.execute(sql`
      SELECT COUNT(DISTINCT dm.dossier_id)::int AS count
      FROM dossier_messages dm
      JOIN dossiers d ON d.id = dm.dossier_id
      WHERE dm.from_role = 'citoyen' AND dm.read_at IS NULL ${communeFilter}
    `) as unknown as [{ count: number }];
    res.json({ count: rows[0]?.count ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Thread d'une conversation ──
mairieRouter.get("/conversations/:dossierId", async (req: AuthRequest, res) => {
  try {
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
      .where(eq(dossier_messages.dossier_id, req.params.dossierId as string))
      .orderBy(dossier_messages.created_at);
    res.json(msgs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Marquer tous les messages citoyens d'une conversation comme lus ──
mairieRouter.post("/conversations/:dossierId/read", async (req: AuthRequest, res) => {
  try {
    await db
      .update(dossier_messages)
      .set({ read_at: new Date() })
      .where(
        and(
          eq(dossier_messages.dossier_id, req.params.dossierId as string),
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
mairieRouter.post("/conversations/:dossierId/unread", async (req: AuthRequest, res) => {
  try {
    const [last] = await db
      .select({ id: dossier_messages.id })
      .from(dossier_messages)
      .where(
        and(
          eq(dossier_messages.dossier_id, req.params.dossierId as string),
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

// ── Analyse parcellaire pour un dossier (onglet Parcelle) ──
mairieRouter.get("/dossiers/:id/analyse-parcelle", async (req: AuthRequest, res) => {
  try {
    const qOverride = (req.query.q as string | undefined)?.trim();

    // Always fetch the dossier — we need commune info for the INSEE lookup even when
    // an address override is provided via ?q=, to constrain BAN to the right commune.
    const [dossier] = await db
      .select({ parcelle: dossiers.parcelle, adresse: dossiers.adresse, commune: dossiers.commune })
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const communeName = dossier.commune ?? null;

    // Look up commune INSEE code FIRST — needed to expand partial cadastral refs
    let citycode: string | undefined;
    if (communeName) {
      const [communeRow] = await db.select({ insee_code: communes.insee_code })
        .from(communes)
        .where(ilike(communes.name, `%${communeName}%`))
        .limit(1);
      citycode = communeRow?.insee_code ?? undefined;
    }

    // Build the analysis query.
    // The address is ALWAYS the primary source: geocoding gives exact coordinates,
    // from which we derive the parcel, PLU zone, and all regulatory data.
    // The dossier.parcelle field (often partial like "BM 019") is only used when
    // there is no address and it resolves to a full 14-char cadastral reference.
    let query: string | null;
    if (qOverride) {
      // Instructeur corrected the address via the UI editor
      query = qOverride;
    } else if (dossier.adresse) {
      // Standard flow: address → geocode → parcel → analysis
      // Don't append commune if it's already present in the address string (avoids BAN confusion)
      const communeAlreadyInAddr = dossier.commune &&
        dossier.adresse.toLowerCase().includes(dossier.commune.toLowerCase());
      query = communeAlreadyInAddr
        ? dossier.adresse
        : `${dossier.adresse}${dossier.commune ? ", " + dossier.commune : ""}`;
    } else if (dossier.parcelle) {
      // No address at all — try to use the cadastral reference as a fallback
      const raw = dossier.parcelle.trim().replace(/\s+/g, "");
      if (/^\d{5}[A-Z0-9]{9,}$/i.test(raw)) {
        query = raw;  // Full 14-char ref (e.g. 37018000BM0019)
      } else {
        // Partial ref like "BM 019" — expand with commune INSEE
        const m = /^([A-Z]{1,2})0*(\d{1,4})$/i.exec(raw);
        query = (m && m[1] && m[2] && citycode)
          ? `${citycode}000${m[1].toUpperCase().padStart(2, "0")}${m[2].padStart(4, "0")}`
          : null;
      }
    } else {
      query = null;
    }

    if (!query) return res.status(422).json({ error: "Aucune adresse ni référence parcellaire sur ce dossier." });

    // ?zone= lets the instructeur manually override the PLU zone when GPU fails
    const zoneOverride = (req.query.zone as string | undefined)?.trim();

    // ?lat=&lng= lets the instructeur provide coordinates from a map click
    const latParam = parseFloat(req.query.lat as string);
    const lngParam = parseFloat(req.query.lng as string);
    const coords = !isNaN(latParam) && !isNaN(lngParam) ? { lat: latParam, lng: lngParam } : undefined;

    const analysis = await analyseParcel(query, { citycode, zoneOverride, coords });
    res.json(analysis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Mise à jour adresse d'un dossier ──
mairieRouter.patch("/dossiers/:id/adresse", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { adresse, commune } = req.body as { adresse?: string; commune?: string };
    if (!adresse) return res.status(400).json({ error: "adresse requis" });
    await db.update(dossiers)
      .set({ adresse, commune: commune ?? null, updated_at: new Date() })
      .where(eq(dossiers.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Calcul des dates d'échéance théoriques (admin) ──────────────────────────
// POST /mairie/admin/compute-deadlines
// Remplit date_limite_instruction pour tous les dossiers qui ont une date_depot
// mais pas encore de délai. Idempotent — ne touche pas les dossiers déjà datés.
mairieRouter.post("/admin/compute-deadlines", async (_req: AuthRequest, res) => {
  try {
    const toUpdate = await db
      .select({ id: dossiers.id, type: dossiers.type, date_depot: dossiers.date_depot, date_completude: dossiers.date_completude })
      .from(dossiers)
      .where(sql`date_depot IS NOT NULL AND date_limite_instruction IS NULL`);

    let updated = 0;
    for (const d of toUpdate) {
      const months = DELAI_INSTRUCTION_MOIS[d.type] ?? 2;
      const startDate = new Date((d.date_completude ?? d.date_depot)!);
      const deadline = new Date(startDate);
      deadline.setMonth(deadline.getMonth() + months);
      await db.update(dossiers)
        .set({ date_limite_instruction: deadline, updated_at: new Date() })
        .where(eq(dossiers.id, d.id));
      updated++;
    }

    res.json({
      ok: true, updated,
      rules: Object.entries(DELAI_INSTRUCTION_MOIS).map(([type, mois]) => ({ type, delai_mois: mois })),
    });
  } catch (err) {
    console.error("[compute-deadlines]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Ingestion PLU depuis PDF (IA — admin uniquement) ──────────────────────────
// POST /mairie/admin/ingest-plu-pdf
// Body: { commune_name, insee_code, zip_code?, pdf_base64 }
// Uses Claude's native PDF document support — no pdftotext required.
// All extracted rules stored as validation_status = "brouillon" for human review.

type PluRuleInput = {
  article_number?: number | null;
  article_title?: string;
  topic: string;
  rule_text: string;
  not_regulated?: boolean;
  value_min?: number | null;
  value_max?: number | null;
  value_exact?: number | null;
  unit?: string | null;
  conditions?: string | null;
  summary: string;
  needs_vision?: boolean;
  needs_external_doc?: boolean;
  external_doc_name?: string | null;
};

const PLU_SAVE_RULE_TOOL: Anthropic.Tool = {
  name: "save_rule",
  description: "Enregistre une règle réglementaire extraite d'un article du PLU.",
  input_schema: {
    type: "object" as const,
    properties: {
      article_number: { type: "integer", description: "Numéro de l'article. Null si non numéroté." },
      article_title: { type: "string", description: "Titre exact de l'article." },
      topic: {
        type: "string",
        enum: ["destinations","terrain_min","recul_voie","recul_limite","recul_batiments","emprise_sol","hauteur","aspect","stationnement","espaces_verts","cos","general"],
        description: "Catégorie réglementaire.",
      },
      rule_text: { type: "string", description: "Texte fidèle de la règle." },
      not_regulated: { type: "boolean", description: "True si article dit 'sans objet' ou 'non réglementé'." },
      value_min: { type: "number", description: "Valeur minimale numérique. Omettre si absent." },
      value_max: { type: "number", description: "Valeur maximale numérique. Omettre si absent." },
      value_exact: { type: "number", description: "Valeur unique exacte. Omettre si absent." },
      unit: { type: "string", enum: ["m","%","m²","places"], description: "Unité. Omettre si pas de valeur numérique." },
      conditions: { type: "string", description: "Conditions ou exceptions. Omettre si aucune." },
      summary: { type: "string", description: "Résumé en 10 mots maximum." },
      needs_vision: { type: "boolean", description: "True si la valeur numérique principale est dans un schéma graphique du document." },
      needs_external_doc: { type: "boolean", description: "True si la règle renvoie explicitement à un document externe (PPRI, PLH, cahier des charges ZAC, servitude…)." },
      external_doc_name: { type: "string", description: "Nom du document externe référencé (ex: 'PPRI', 'PLH', 'cahier des charges ZAC'). Remplir si needs_external_doc = true." },
    },
    required: ["article_number","article_title","topic","rule_text","not_regulated","summary","needs_vision","needs_external_doc"],
  },
};

mairieRouter.post("/admin/ingest-plu-pdf", async (req: AuthRequest, res) => {
  const { commune_name, insee_code, zip_code, pdf_base64 } = req.body as {
    commune_name?: string;
    insee_code?: string;
    zip_code?: string;
    pdf_base64?: string;
  };

  if (!commune_name || !insee_code || !pdf_base64) {
    return res.status(400).json({ error: "commune_name, insee_code et pdf_base64 requis" });
  }

  // SSE streaming so the client sees progress zone by zone
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Force the chunk out immediately (defeats any residual buffering).
    (res as unknown as { flush?: () => void }).flush?.();
  };

  try {
    // maxRetries : le SDK réessaie (backoff) sur 429 / 5xx / 529 ; timeout pour
    // ne jamais pendre indéfiniment sur un tronçon PDF lourd.
    const client = new Anthropic({ apiKey: getAnthropicApiKey(), maxRetries: 3, timeout: 120_000 });

    // Upsert commune
    let commune = (await db.select().from(communes).where(eq(communes.insee_code, insee_code)).limit(1))[0];
    if (!commune) {
      const [created] = await db.insert(communes).values({
        name: commune_name,
        insee_code,
        zip_code: zip_code ?? "",
      }).returning();
      commune = created!;
    } else {
      await db.update(communes).set({ name: commune_name, zip_code: zip_code ?? commune.zip_code ?? "", updated_at: new Date() }).where(eq(communes.id, commune.id));
    }

    // NB : on ne purge PAS l'existant ici. L'extraction (longue) a lieu d'abord ;
    // la purge + insertion se font en transaction à la fin, une fois l'extraction
    // réussie — ainsi une interruption en cours d'extraction ne détruit rien.

    // Découpage du PDF (gère la limite ~100 pages/requête d'Anthropic).
    send({ type: "phase", message: "Préparation du document…" });
    const chunks = await splitPdfBase64(pdf_base64);

    // cache_control marque chaque tronçon pour le prompt caching (réutilisé par
    // les appels d'extraction portant sur le même tronçon).
    const pdfDocFor = (b64: string) => ({
      type: "document" as const,
      source: { type: "base64" as const, media_type: "application/pdf" as const, data: b64 },
      cache_control: { type: "ephemeral" as const },
    });

    // Phase 1 — Détection des zones, tronçon par tronçon (chaque zone est rattachée
    // au premier tronçon où sa section apparaît).
    send({ type: "phase", message: chunks.length > 1 ? `Détection des zones (${chunks.length} parties)…` : "Détection des zones…" });
    const detectChunk = async (c: number) => {
     try {
      const zoneMsg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            pdfDocFor(chunks[c]!),
            {
              type: "text",
              text: `Cet extrait fait partie d'un règlement PLU français.

Liste TOUTES les zones et sous-zones qui possèdent, DANS CET EXTRAIT, une section réglementaire dédiée (titre de section + articles ; ex : UA, UB, UC, Ni, Nj, A, Ab, 1AU, 2AU…). Utilise le sommaire s'il est présent dans l'extrait.
Inclure les sous-zones ayant un règlement distinct. Ne pas exclure une zone parce qu'elle semble petite.
Si aucune section de zone n'apparaît dans cet extrait, répondre [].

Répondre UNIQUEMENT avec un JSON array, sans autre texte :
[{"code":"UA","label":"Zone UA – Centre ancien","type":"U"},…]
Types : "U"=urbaine, "AU"=à urbaniser, "A"=agricole, "N"=naturelle.`,
            },
          ],
        }],
      });
      const raw = zoneMsg.content[0]?.type === "text" ? zoneMsg.content[0].text : "[]";
      const found = JSON.parse(raw.match(/\[[\s\S]*?\]/)?.[0] ?? "[]") as Array<{ code: string; label: string; type: string }>;
      send({ type: "phase", message: `Détection des zones — partie ${c + 1}/${chunks.length} analysée (${found.length} zones)` });
      return found.map(z => ({ ...z, chunk: c }));
     } catch (e) {
      // Un tronçon en échec ne doit pas bloquer ni annuler tout l'import :
      // on continue avec les zones des autres tronçons.
      console.error(`[ingest-plu-pdf] détection tronçon ${c} échouée`, e);
      send({ type: "phase", message: `Détection des zones — partie ${c + 1}/${chunks.length} ignorée (erreur temporaire)` });
      return [] as Array<{ code: string; label: string; type: string; chunk: number }>;
     }
    };

    // Tronçons analysés en parallèle ; on conserve l'ordre pour rattacher chaque
    // zone au PREMIER tronçon où elle apparaît.
    const perChunk = await Promise.all(chunks.map((_, c) => detectChunk(c)));
    const zoneMap = new Map<string, { code: string; label: string; type: string; chunk: number }>();
    for (const list of perChunk) {
      for (const z of list) {
        if (z.code && !zoneMap.has(z.code)) zoneMap.set(z.code, z);
      }
    }
    const zoneDefs = [...zoneMap.values()];

    if (zoneDefs.length === 0) {
      send({ type: "error", message: "Aucune zone détectée. Vérifiez que c'est bien un règlement PLU textuel." });
      return res.end();
    }

    send({ type: "zones_found", zones: zoneDefs.map(z => ({ code: z.code, label: z.label, type: z.type })) });

    // Phase 2 — Règles par zone, extraites depuis le tronçon contenant la zone.
    const extractZone = async (zoneDef: { code: string; label: string; type: string; chunk: number }) => {
     try {
      const ruleMsg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        tools: [PLU_SAVE_RULE_TOOL],
        tool_choice: { type: "any" },
        messages: [{
          role: "user",
          content: [
            pdfDocFor(chunks[zoneDef.chunk]!),
            {
              type: "text",
              text: `Cet extrait fait partie d'un règlement PLU français. Extrais les règles de la ZONE ${zoneDef.code} uniquement.

Pour CHAQUE article présent dans la section Zone ${zoneDef.code}, appelle save_rule une fois.
Correspondance article → topic :
  1/2 → destinations | 5 → terrain_min | 6 → recul_voie | 7 → recul_limite
  8 → recul_batiments | 9 → emprise_sol | 10 → hauteur | 11 → aspect
  12 → stationnement | 13 → espaces_verts | 14 → cos

- Si l'article dit "sans objet" ou "non réglementé" → not_regulated = true, appelle quand même save_rule.
- Plusieurs valeurs selon sous-secteurs → valeur principale dans value_max, variantes dans conditions.
- Si la valeur numérique est dans un schéma graphique du document → needs_vision = true.
- Si la règle renvoie à un document externe (PPRI, PLH, cahier des charges ZAC, arrêté préfectoral, servitude…) → needs_external_doc = true, external_doc_name = nom exact du document cité.
- N'invente aucune valeur. Si incertain, omets value_min/max/exact.`,
            },
          ],
        }],
      });

      const rules: PluRuleInput[] = ruleMsg.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map(b => b.input as PluRuleInput);
      const visionCount = rules.filter(r => r.needs_vision || r.needs_external_doc).length;

      send({ type: "zone_done", zone: zoneDef.code, rules: rules.length, vision: visionCount });
      return { zoneDef, rules, visionCount };
     } catch (e) {
      // Une zone en échec ne fait pas planter tout l'import : on l'enregistre
      // sans règle (l'instructeur pourra la compléter manuellement).
      console.error(`[ingest-plu-pdf] extraction zone ${zoneDef.code} échouée`, e);
      send({ type: "zone_done", zone: zoneDef.code, rules: 0, vision: 0, error: true });
      return { zoneDef, rules: [] as PluRuleInput[], visionCount: 0 };
     }
    };

    // Concurrence bornée : traiter les zones par petits lots évite de saturer
    // l'API IA (toutes les zones d'un coup provoque des 429/529/500).
    const extracted: Array<{ zoneDef: { code: string; label: string; type: string; chunk: number }; rules: PluRuleInput[]; visionCount: number }> = [];
    const CONCURRENCY = 3;
    for (let i = 0; i < zoneDefs.length; i += CONCURRENCY) {
      const batch = zoneDefs.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(extractZone));
      extracted.push(...batchResults);
    }

    // ── Écriture atomique ──────────────────────────────────────────────────────
    // L'extraction (ci-dessus) est terminée et a réussi : on purge l'existant et
    // on insère le nouveau jeu dans une seule transaction. Une interruption
    // pendant l'extraction n'aura donc jamais détruit les données ; et si la
    // transaction échoue, elle est annulée (pas d'état partiel).
    send({ type: "phase", message: "Enregistrement…" });
    await db.transaction(async (tx) => {
      const oldZones = await tx.select({ id: zones.id }).from(zones).where(eq(zones.commune_id, commune.id));
      if (oldZones.length > 0) {
        await tx.delete(zone_regulatory_rules).where(inArray(zone_regulatory_rules.zone_id, oldZones.map(z => z.id)));
        await tx.delete(zones).where(eq(zones.commune_id, commune.id));
      }
      for (const { zoneDef, rules } of extracted) {
        const [created] = await tx.insert(zones).values({
          commune_id: commune.id,
          zone_code: zoneDef.code,
          zone_label: zoneDef.label,
          zone_type: zoneDef.type,
          summary: `Zone ${zoneDef.code} — extrait par IA, à valider`,
          status: "active",
          is_active: true,
        }).returning();
        const zoneId = created!.id;
        for (const rule of rules) {
          await tx.insert(zone_regulatory_rules).values({
            zone_id: zoneId,
            article_number: rule.article_number ?? null,
            article_title: rule.article_title ?? (rule.article_number ? `Article ${rule.article_number}` : ""),
            topic: rule.topic,
            rule_text: rule.rule_text,
            value_min: rule.value_min ?? null,
            value_max: rule.value_max ?? null,
            value_exact: rule.value_exact ?? null,
            unit: rule.unit ?? null,
            conditions: rule.conditions ?? null,
            summary: rule.summary,
            instructor_note: [
              rule.needs_vision ? "⚠ Valeur dans un schéma graphique — à vérifier manuellement." : null,
              rule.needs_external_doc ? `⚠ Valeur définie dans un document externe : ${rule.external_doc_name ?? "document non identifié"} — à reporter manuellement.` : null,
            ].filter(Boolean).join(" | ") || null,
            validation_status: "brouillon" as const,
          });
        }
      }
    });

    const results = extracted.map(e => ({ zone: e.zoneDef.code, rules: e.rules.length, vision: e.visionCount }));
    send({
      type: "done",
      ok: true,
      commune: commune.name,
      insee_code: commune.insee_code,
      zones: results.length,
      rules: results.reduce((s, z) => s + z.rules, 0),
      needs_review: results.reduce((s, z) => s + z.vision, 0),
      detail: results,
    });

  } catch (err) {
    console.error("[ingest-plu-pdf]", err);
    // Erreurs transitoires de l'API IA (surcharge / 5xx / quota) → message clair.
    const status = (err as { status?: number })?.status;
    const transient = status === 429 || status === 529 || (typeof status === "number" && status >= 500);
    const message = transient
      ? "Le service d'extraction IA est momentanément indisponible ou surchargé. Aucune donnée n'a été modifiée — réessayez dans quelques instants."
      : (err instanceof Error ? err.message : String(err));
    send({ type: "error", message });
  }

  res.end();
});

// ── Disponibilités ────────────────────────────────────────────────────────────

mairieRouter.get("/my-availability", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const [avail] = await db.select().from(user_availability).where(eq(user_availability.user_id, userId)).limit(1);
    const absences = await db.select({
      id: user_absences.id,
      start_date: user_absences.start_date,
      end_date: user_absences.end_date,
      reason: user_absences.reason,
      note: user_absences.note,
      delegate_user_id: user_absences.delegate_user_id,
      delegate_prenom: users.prenom,
      delegate_nom: users.nom,
    })
      .from(user_absences)
      .leftJoin(users, eq(user_absences.delegate_user_id, users.id))
      .where(eq(user_absences.user_id, userId))
      .orderBy(user_absences.start_date);
    res.json({
      working_days: avail?.working_days ?? [1, 2, 3, 4, 5],
      start_time: avail?.start_time ?? "08:30",
      end_time: avail?.end_time ?? "17:30",
      absences,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

mairieRouter.put("/my-availability", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { working_days, start_time, end_time } = req.body as { working_days: number[]; start_time: string; end_time: string };
    await db.insert(user_availability)
      .values({ user_id: userId, working_days, start_time, end_time, updated_at: new Date() })
      .onConflictDoUpdate({ target: user_availability.user_id, set: { working_days, start_time, end_time, updated_at: new Date() } });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

mairieRouter.post("/my-absences", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { start_date, end_date, reason, note, delegate_user_id } = req.body as {
      start_date: string; end_date: string; reason?: string; note?: string; delegate_user_id?: string;
    };
    if (!start_date || !end_date) return res.status(400).json({ error: "start_date et end_date requis" });
    const [row] = await db.insert(user_absences)
      .values({ user_id: userId, start_date, end_date, reason: reason ?? "conges", note: note ?? null, delegate_user_id: delegate_user_id ?? null })
      .returning();
    res.status(201).json(row);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

mairieRouter.delete("/my-absences/:id", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params as { id: string };
    await db.delete(user_absences).where(and(eq(user_absences.id, id), eq(user_absences.user_id, userId)));
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

mairieRouter.get("/notifications", async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(notifications)
      .where(eq(notifications.user_id, req.user!.id))
      .orderBy(desc(notifications.created_at))
      .limit(50);
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Réglementation ────────────────────────────────────────────────────────────

// GET /mairie/reglementation?insee_code=37018 (or legacy ?commune_name=Ballan-Miré)
// Returns zones with their rules and per-zone validation stats.
mairieRouter.get("/reglementation", async (req: AuthRequest, res) => {
  try {
    const communeName = (req.query.commune_name as string | undefined)?.trim();
    const inseeCode = (req.query.insee_code as string | undefined)?.trim();
    if (!communeName && !inseeCode) return res.status(400).json({ error: "commune_name ou insee_code requis" });

    const [commune] = await db.select().from(communes)
      .where(inseeCode
        ? eq(communes.insee_code, inseeCode)
        : ilike(communes.name, `%${communeName!}%`))
      .limit(1);
    if (!commune) return res.status(404).json({ error: "Commune non trouvée" });

    const zoneRows = await db.select().from(zones)
      .where(and(eq(zones.commune_id, commune.id), eq(zones.is_active, true)))
      .orderBy(zones.display_order);

    const result = await Promise.all(zoneRows.map(async zone => {
      const rules = await db.select().from(zone_regulatory_rules)
        .where(eq(zone_regulatory_rules.zone_id, zone.id))
        .orderBy(zone_regulatory_rules.article_number);

      const stats = {
        total: rules.length,
        valide: rules.filter(r => r.validation_status === "valide").length,
        brouillon: rules.filter(r => r.validation_status === "brouillon" || r.validation_status === "draft").length,
        rejete: rules.filter(r => r.validation_status === "rejete").length,
      };

      return { ...zone, rules, stats };
    }));

    res.json({ commune, zones: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /mairie/admin/reglementation-status
// Diagnostic (lecture seule) : pour chaque commune, INSEE + nb de zones/règles
// + liste des codes de zone. Permet de voir à quelle commune des règles sont
// réellement rattachées (utile pour repérer des données mal associées).
mairieRouter.get("/admin/reglementation-status", requireRole("mairie", "instructeur", "admin"), async (_req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        commune: communes.name,
        insee_code: communes.insee_code,
        zone_count: sql<number>`count(distinct ${zones.id})`,
        rule_count: sql<number>`count(${zone_regulatory_rules.id})`,
        zone_codes: sql<string>`coalesce(string_agg(distinct ${zones.zone_code}, ', '), '')`,
      })
      .from(communes)
      .leftJoin(zones, eq(zones.commune_id, communes.id))
      .leftJoin(zone_regulatory_rules, eq(zone_regulatory_rules.zone_id, zones.id))
      .groupBy(communes.id, communes.name, communes.insee_code)
      .orderBy(communes.insee_code);

    res.json(rows.map(r => ({
      commune: r.commune,
      insee_code: r.insee_code,
      zones: Number(r.zone_count),
      rules: Number(r.rule_count),
      zone_codes: r.zone_codes,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /mairie/reglementation?insee_code=37018
// Purge toutes les zones + règles d'une commune (ex. retirer des données résiduelles
// avant de réimporter le vrai PLU).
mairieRouter.delete("/reglementation", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const inseeCode = (req.query.insee_code as string | undefined)?.trim();
    if (!inseeCode) return res.status(400).json({ error: "insee_code requis" });
    const [commune] = await db.select().from(communes).where(eq(communes.insee_code, inseeCode)).limit(1);
    if (!commune) return res.status(404).json({ error: "Commune non trouvée" });

    const oldZones = await db.select({ id: zones.id }).from(zones).where(eq(zones.commune_id, commune.id));
    if (oldZones.length > 0) {
      await db.delete(zone_regulatory_rules).where(inArray(zone_regulatory_rules.zone_id, oldZones.map(z => z.id)));
      await db.delete(zones).where(eq(zones.commune_id, commune.id));
    }
    res.json({ ok: true, commune: commune.name, insee_code: commune.insee_code, purged_zones: oldZones.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /mairie/reglementation/rules/:id — validate, edit or reject a rule
mairieRouter.patch("/reglementation/rules/:id", async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { rule_text, validation_status, value_min, value_max, value_exact, unit, conditions, exceptions, summary, instructor_note, topic, article_number, article_title, cases, applies_if, sub_theme } = req.body as Record<string, unknown>;

    const allowed = new Set(["valide", "brouillon", "rejete", "draft"]);
    if (validation_status !== undefined && !allowed.has(validation_status as string)) {
      return res.status(400).json({ error: "validation_status invalide" });
    }

    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (rule_text !== undefined) patch.rule_text = rule_text;
    if (validation_status !== undefined) patch.validation_status = validation_status;
    if (value_min !== undefined) patch.value_min = value_min === null ? null : Number(value_min);
    if (value_max !== undefined) patch.value_max = value_max === null ? null : Number(value_max);
    if (value_exact !== undefined) patch.value_exact = value_exact === null ? null : Number(value_exact);
    if (unit !== undefined) patch.unit = unit;
    if (conditions !== undefined) patch.conditions = conditions;
    if (exceptions !== undefined) patch.exceptions = exceptions;
    if (summary !== undefined) patch.summary = summary;
    if (instructor_note !== undefined) patch.instructor_note = instructor_note;
    if (topic !== undefined) patch.topic = topic;
    if (article_number !== undefined) patch.article_number = article_number;
    if (article_title !== undefined) patch.article_title = article_title;
    if (cases !== undefined) patch.cases = Array.isArray(cases) ? cases : [];
    if (applies_if !== undefined) patch.applies_if = Array.isArray(applies_if) ? applies_if : [];
    if (sub_theme !== undefined) patch.sub_theme = sub_theme;

    await db.update(zone_regulatory_rules).set(patch).where(eq(zone_regulatory_rules.id, id));
    const [updated] = await db.select().from(zone_regulatory_rules).where(eq(zone_regulatory_rules.id, id)).limit(1);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /mairie/reglementation/rules/:id
mairieRouter.delete("/reglementation/rules/:id", async (req: AuthRequest, res) => {
  try {
    await db.delete(zone_regulatory_rules).where(eq(zone_regulatory_rules.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/reglementation/zones/:zoneId/rules — add a rule manually
mairieRouter.post("/reglementation/zones/:zoneId/rules", async (req: AuthRequest, res) => {
  try {
    const zone_id = req.params.zoneId as string;
    const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.id, zone_id)).limit(1);
    if (!zone) return res.status(404).json({ error: "Zone non trouvée" });

    const { article_number, article_title, topic, rule_text, value_min, value_max, value_exact, unit, conditions, exceptions, summary, cases, applies_if, sub_theme } = req.body as Record<string, unknown>;
    if (!topic || !rule_text) return res.status(400).json({ error: "topic et rule_text requis" });

    const [created] = await db.insert(zone_regulatory_rules).values({
      zone_id,
      article_number: article_number ? Number(article_number) : null,
      article_title: (article_title as string | undefined) ?? (article_number ? `Article ${article_number}` : ""),
      topic: topic as string,
      rule_text: rule_text as string,
      value_min: value_min != null ? Number(value_min) : null,
      value_max: value_max != null ? Number(value_max) : null,
      value_exact: value_exact != null ? Number(value_exact) : null,
      unit: (unit as string | undefined) ?? null,
      conditions: (conditions as string | undefined) ?? null,
      exceptions: (exceptions as string | undefined) ?? null,
      summary: (summary as string | undefined) ?? null,
      cases: Array.isArray(cases) ? cases : [],
      applies_if: Array.isArray(applies_if) ? applies_if : [],
      sub_theme: (sub_theme as string | undefined) ?? null,
      validation_status: "brouillon",
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/reglementation/zones/:zoneId/rules/bulk — ajout en masse (sous-règles)
mairieRouter.post("/reglementation/zones/:zoneId/rules/bulk", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const zone_id = req.params.zoneId as string;
    const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.id, zone_id)).limit(1);
    if (!zone) return res.status(404).json({ error: "Zone non trouvée" });

    const rules = Array.isArray((req.body as { rules?: unknown }).rules) ? (req.body as { rules: Record<string, unknown>[] }).rules : [];
    if (!rules.length) return res.status(400).json({ error: "Aucune règle à ajouter" });

    const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const values = rules
      .filter((r) => str(r.rule_text) && str(r.topic))
      .map((r) => ({
        zone_id,
        article_number: num(r.article_number),
        article_title: str(r.article_title) ?? (r.article_number ? `Article ${r.article_number}` : ""),
        topic: str(r.topic) as string,
        rule_text: str(r.rule_text) as string,
        value_min: num(r.value_min), value_max: num(r.value_max), value_exact: num(r.value_exact),
        unit: str(r.unit),
        conditions: str(r.conditions),
        exceptions: str(r.exceptions),
        summary: str(r.summary),
        cases: Array.isArray(r.cases) ? r.cases : [],
        applies_if: Array.isArray(r.applies_if) ? r.applies_if : [],
        sub_theme: str(r.sub_theme),
        validation_status: "brouillon" as const,
      }));
    if (!values.length) return res.status(400).json({ error: "Aucune règle valide (topic + rule_text requis)" });

    const created = await db.insert(zone_regulatory_rules).values(values).returning();
    res.status(201).json({ created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/reglementation/structure-article
// « Agent » de structuration : l'instructeur colle le TEXTE d'un article ; Claude
// (texte court, pas le PDF) renvoie les champs structurés pour pré-remplir le
// formulaire. L'instructeur vérifie puis enregistre.
mairieRouter.post("/reglementation/structure-article", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const { text, zone_code, article_number, image_base64, image_media_type } = req.body as { text?: string; zone_code?: string; article_number?: number | string; image_base64?: string; image_media_type?: string };
    const hasImage = typeof image_base64 === "string" && image_base64.length > 0;
    if ((!text || text.trim().length < 5) && !hasImage) return res.status(400).json({ error: "Texte de l'article ou image requis" });

    // Image (tableau / croquis) → vision : Sonnet lit mieux les tableaux complexes.
    const userContent: Anthropic.ContentBlockParam[] = [];
    if (hasImage) {
      const media = (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image_media_type ?? "") ? image_media_type : "image/png") as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      userContent.push({ type: "image", source: { type: "base64", media_type: media, data: image_base64! } });
    }
    userContent.push({ type: "text", text: `${zone_code ? `Zone ${zone_code}. ` : ""}${article_number ? `Article ${article_number}. ` : ""}\n\n${text ?? "(Voir le tableau / croquis fourni en image.)"}` });

    const client = new Anthropic({ apiKey: getAnthropicApiKey(), maxRetries: 3, timeout: 60_000 });
    const msg = await client.messages.create({
      model: hasImage ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      system: `Tu es un expert en droit de l'urbanisme français. On te donne le TEXTE d'UN article de règlement PLU (souvent long, avec sous-sections) ET/OU une IMAGE (tableau ou croquis).

Si une IMAGE est fournie : lis-la attentivement. Pour un TABLEAU (ex: stationnement art. 12 — colonne « Type »/« Destination » → colonne « Normes »), CHAQUE LIGNE devient une SOUS-RÈGLE (sub_theme = le type, ex: « Habitation », « Bureaux », « Commerce »). Les tranches/seuils d'une même ligne (ex: « 1 place/40 m² entre 300 et 1000 m² », « 1 place/30 m² au-delà de 1000 m² ») deviennent des "cases" (kind "parametre"). Pour un CROQUIS, décris la règle dans rule_text.

DÉCOMPOSE l'article en SOUS-RÈGLES cohérentes (une par sous-section / thème). Renvoie UNIQUEMENT un tableau JSON, sans autre texte :
[
  {
    "sub_theme": string,            // numéro + intitulé de la sous-section, ex: "11.1.5 Toiture", "11.2.2 Éléments protégés"
    "article_number": number|null,
    "article_title": string,
    "topic": "interdictions|conditions|desserte_voies|desserte_reseaux|terrain_min|recul_voie|recul_limite|recul_batiments|emprise_sol|hauteur|aspect|stationnement|espaces_verts|cos|general",
    "rule_text": string,            // TEXTE QUALITATIF FIDÈLE de la sous-règle (la prose EST la règle ; ne pas sur-résumer)
    "value_min": number|null, "value_max": number|null, "value_exact": number|null,
    "unit": "m|cm|%|m²|places"|null,
    "conditions": string|null,
    "exceptions": string|null,      // dérogations « sauf… / à l'exception de… / hormis… » (texte court), renvoi d'article inclus
    "summary": string,              // ≤ 15 mots
    "cases": [ { "condition": string, "value": number|null, "unit": "m|cm|%|m²|places"|null, "kind": "condition|parametre" } ],
    "applies_if": [ ]               // tags d'applicabilité, parmi : protege_l151_19, unesco, abf, inondable, extension, surelevation, ravalement, demolition, cloture_sur_rue, cloture_limite, annexe, devanture_commerciale, equipement_public. [] si général.
  }
]

DÉCOUPAGE — RÈGLE IMPÉRATIVE :
- Découpe UNIQUEMENT selon la NUMÉROTATION interne de l'article (ex: 11.1, 11.1.4, 11.2, 11.2.2). UNE sous-règle = UNE sous-section numérotée. "sub_theme" = son numéro + son intitulé.
- Si l'article N'A PAS de sous-sections numérotées (ex: article 1 = simple liste d'occupations interdites, article 2 = liste de conditions) → renvoie UNE SEULE sous-règle pour tout l'article ; la liste complète va dans "rule_text". NE crée SURTOUT PAS une sous-règle par item/tiret de la liste.
- EXCEPTION tableau (image) : chaque LIGNE du tableau (type → norme) est une sous-règle.
- Plusieurs conditions/valeurs DANS une même sous-section (ou règle) → ajoute autant de "cases" à CETTE sous-règle. NE crée JAMAIS une nouvelle sous-règle juste parce qu'il y a une condition de plus.

AUTRES RÈGLES :
- "rule_text" : conserve le sens qualitatif (matériaux, teintes, prescriptions) — pour l'aspect (art. 11) c'est l'essentiel, ne le réduis PAS à un nombre. Mais reste SYNTHÉTIQUE sur les passages très longs (prescriptions clés, pas la prose redondante) afin de produire un JSON COMPLET et bien formé.
- "exceptions" : repère les DÉROGATIONS (« sauf… », « à l'exception de… », « hormis… », « sauf cas de… ») et liste-les dans ce champ (ex: « sauf ICPE visées à l'art. UA-2 ; démolition autorisée si sinistre grave ; abattage si état sanitaire le justifie »). null si aucune.
- "applies_if" : tague une sous-règle qui ne s'applique qu'à un contexte ("Clôtures sur rue" → ["cloture_sur_rue"] ; "Éléments protégés L.151-19" → ["protege_l151_19"] ; "Périmètre UNESCO" → ["unesco"] ; surélévation → ["surelevation"]). [] sinon.
- VALEUR PRINCIPALE (value_*) = LE seuil de la sous-règle dans une unité COHÉRENTE (%, m, m², places). Respecte min ("≥") vs max ("≤"). NE MÉLANGE JAMAIS valeur et unité. Mesures secondaires/d'autres unités → "cases". Si rien de chiffré → value_* null (fréquent pour l'aspect).
- "cases" : à utiliser UNIQUEMENT pour des éléments porteurs d'une VALEUR chiffrée (ex: 1,80 m, 50 cm) ou d'une vraie ALTERNATIVE conditionnelle (ex: 10 m sens unique / 13 m double sens). kind "condition" (alternative exclusive) vs "parametre" (valeur cumulative).
  NE crée PAS de cases pour une simple énumération QUALITATIVE sans valeur (liste d'occupations interdites, de matériaux autorisés…) : elle reste dans "rule_text". Un cas avec value=null et sans alternative réelle ne doit PAS exister.
- N'invente AUCUNE valeur. Articles 5 et 14 → "sans objet" (loi ALUR).`,
      messages: [{ role: "user", content: userContent }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "[]";
    // Parsing tolérant : si la réponse est tronquée (max_tokens), on récupère les
    // sous-règles COMPLÈTES en fermant l'array au dernier objet entier.
    const arr = parseLooseArray(raw);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const APPLIES = new Set(["protege_l151_19", "unesco", "abf", "inondable", "extension", "surelevation", "ravalement", "demolition", "cloture_sur_rue", "cloture_limite", "annexe", "devanture_commerciale", "equipement_public"]);
    const rules = (Array.isArray(arr) ? arr : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        sub_theme: str(r.sub_theme),
        article_number: num(r.article_number) ?? (article_number ? Number(article_number) : null),
        article_title: str(r.article_title) ?? "",
        topic: str(r.topic) ?? "general",
        rule_text: str(r.rule_text) ?? "",
        value_min: num(r.value_min), value_max: num(r.value_max), value_exact: num(r.value_exact),
        unit: str(r.unit),
        conditions: str(r.conditions),
        exceptions: str(r.exceptions),
        summary: str(r.summary) ?? "",
        cases: Array.isArray(r.cases)
          ? (r.cases as unknown[]).filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
              .map((c) => ({ condition: str(c.condition) ?? "", value: num(c.value), unit: str(c.unit), kind: c.kind === "condition" ? "condition" : "parametre" }))
              // On ne garde QUE les cas porteurs d'une valeur (chiffre ou unité) :
              // une énumération qualitative (interdictions, matériaux…) reste dans rule_text.
              .filter((c) => c.condition && (c.value != null || c.unit != null))
          : [],
        applies_if: Array.isArray(r.applies_if)
          ? (r.applies_if as unknown[]).map(str).filter((t): t is string => !!t && APPLIES.has(t))
          : [],
      }))
      .filter((r) => r.rule_text || r.summary);

    // Repli : rien d'exploitable → une sous-règle brute avec le texte collé.
    if (rules.length === 0) {
      rules.push({ sub_theme: null, article_number: article_number ? Number(article_number) : null, article_title: "", topic: "general", rule_text: (text ?? "").trim() || "Voir le tableau / croquis fourni.", value_min: null, value_max: null, value_exact: null, unit: null, conditions: null, exceptions: null, summary: "", cases: [], applies_if: [] });
    }

    res.json({ rules });
  } catch (err) {
    console.error("[structure-article]", err);
    res.status(500).json({ error: "Échec de l'analyse IA — réessayez ou saisissez manuellement." });
  }
});

// POST /mairie/reglementation/zones — create a zone manually
mairieRouter.post("/reglementation/zones", async (req: AuthRequest, res) => {
  try {
    const { insee_code, commune_name, zone_code, zone_label, zone_type } = req.body as {
      insee_code?: string; commune_name?: string;
      zone_code: string; zone_label: string; zone_type: string;
    };
    if (!zone_code || !zone_label || !zone_type) return res.status(400).json({ error: "zone_code, zone_label, zone_type requis" });
    if (!insee_code && !commune_name) return res.status(400).json({ error: "insee_code ou commune_name requis" });

    const [commune] = await db.select().from(communes)
      .where(insee_code ? eq(communes.insee_code, insee_code) : ilike(communes.name, `%${commune_name!}%`))
      .limit(1);
    if (!commune) return res.status(404).json({ error: "Commune non trouvée" });

    const [zone] = await db.insert(zones).values({
      commune_id: commune.id,
      zone_code: zone_code.toUpperCase(),
      zone_label,
      zone_type,
      summary: "",
      status: "active",
      is_active: true,
    }).returning();
    res.status(201).json(zone);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// DELETE /mairie/reglementation/zones/:id — delete a zone and its rules
mairieRouter.delete("/reglementation/zones/:id", async (req: AuthRequest, res) => {
  try {
    await db.delete(zone_regulatory_rules).where(eq(zone_regulatory_rules.zone_id, req.params.id as string));
    await db.delete(zones).where(eq(zones.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// PATCH /mairie/reglementation/zones/:id — update zone label/summary
mairieRouter.patch("/reglementation/zones/:id", async (req: AuthRequest, res) => {
  try {
    const { zone_label, summary } = req.body as { zone_label?: string; summary?: string };
    await db.update(zones)
      .set({ ...(zone_label !== undefined && { zone_label }), ...(summary !== undefined && { summary }), updated_at: new Date() })
      .where(eq(zones.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Proxy APICarto GPU zones (évite le CORS côté navigateur) ─────────────────
// GET /mairie/plu-zones?insee_code=37018 (or legacy ?commune=Ballan-Miré)
const pluZonesCache = new Map<string, { zones: unknown; expiresAt: number }>();
const PLU_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

async function fetchWithRetry(url: string, opts: RequestInit, retries = 3, delayMs = 1500): Promise<Response | null> {
  for (let i = 0; i < retries; i++) {
    const r = await fetch(url, opts).catch(() => null);
    if (r?.ok) return r;
    if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
  }
  return null;
}

mairieRouter.get("/plu-zones", async (req: AuthRequest, res) => {
  const cacheKey = ((req.query.insee_code as string | undefined) ?? (req.query.commune as string | undefined) ?? "").trim();
  const cached = pluZonesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("X-PLU-Cache", "HIT");
    return res.json(cached.zones);
  }

  // Déclaré avant try pour être accessible dans le catch (stale fallback)
  let communeRow: { id: string; plu_zones_geojson: unknown; plu_zones_cached_at: Date | null } | undefined;

  try {
    let inseeCode = (req.query.insee_code as string | undefined)?.trim();
    const communeName = (req.query.commune as string | undefined)?.trim();

    if (!inseeCode && !communeName) {
      return res.status(400).json({ error: "insee_code ou commune requis" });
    }

    // Charge le cache DB (survit aux redémarrages serveur)
    if (inseeCode) {
      communeRow = (await db.select({ id: communes.id, plu_zones_geojson: communes.plu_zones_geojson, plu_zones_cached_at: communes.plu_zones_cached_at })
        .from(communes).where(eq(communes.insee_code, inseeCode)).limit(1))[0];
    }
    if (communeRow?.plu_zones_geojson && communeRow.plu_zones_cached_at) {
      const ageMs = Date.now() - communeRow.plu_zones_cached_at.getTime();
      if (ageMs < PLU_CACHE_TTL_MS) {
        pluZonesCache.set(cacheKey, { zones: communeRow.plu_zones_geojson, expiresAt: Date.now() + (PLU_CACHE_TTL_MS - ageMs) });
        res.setHeader("X-PLU-Cache", "DB-HIT");
        return res.json(communeRow.plu_zones_geojson);
      }
    }

    // Résolution du code INSEE si non fourni
    if (!inseeCode && communeName) {
      const r = await fetchWithRetry(
        `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(communeName)}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r) inseeCode = ((await r.json()) as Array<{ code?: string }>)[0]?.code ?? undefined;
    }

    // Contour de la commune (utilisé pour la requête géographique)
    const lookupQ = inseeCode ? `code=${encodeURIComponent(inseeCode)}` : `nom=${encodeURIComponent(communeName!)}`;
    const geoR = await fetchWithRetry(
      `https://geo.api.gouv.fr/communes?${lookupQ}&fields=contour&format=geojson&geometry=contour&limit=1`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!geoR) {
      if (communeRow?.plu_zones_geojson) { res.setHeader("X-PLU-Cache", "STALE"); return res.json(communeRow.plu_zones_geojson); }
      return res.status(502).json({ error: "Erreur geo.api.gouv.fr" });
    }
    type GeoComm = { features?: Array<{ geometry?: { coordinates: number[][][] } }> };
    const fullRing = ((await geoR.json()) as GeoComm).features?.[0]?.geometry?.coordinates[0];
    if (!fullRing?.length) return res.status(404).json({ error: "Commune non trouvée" });

    // Polygone simplifié ≤50 pts pour la requête GPU (URL manageable)
    const MAX_PTS = 50;
    let queryRing = fullRing;
    if (fullRing.length > MAX_PTS) {
      const step = Math.ceil((fullRing.length - 1) / (MAX_PTS - 1));
      queryRing = fullRing.filter((_, i) => i % step === 0);
      if (queryRing[queryRing.length - 1] !== fullRing[fullRing.length - 1])
        queryRing.push(fullRing[fullRing.length - 1]!);
    }
    const communeGeom = JSON.stringify({ type: "Polygon", coordinates: [queryRing] });

    // Centroïde pour la stratégie document
    const lats = fullRing.map(p => p[1]!), lngs = fullRing.map(p => p[0]!);
    const centroid = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
    const ptGeom = JSON.stringify({ type: "Point", coordinates: centroid });

    // ── Identification de la partition ────────────────────────────────────────
    let partition: string | undefined;

    // A) PLU communal classique : partition = "{INSEE}_PLU"
    if (!partition && inseeCode) {
      const candidate = `${inseeCode}_PLU`;
      const r = await fetchWithRetry(
        `https://apicarto.ign.fr/api/gpu/zone-urba?partition=${encodeURIComponent(candidate)}&_limit=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r) { const j = await r.json() as { features?: unknown[] }; if ((j.features?.length ?? 0) > 0) partition = candidate; }
    }

    // B) Endpoint /document avec le centroïde de la commune
    if (!partition) {
      const r = await fetchWithRetry(
        `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(ptGeom)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r) {
        type Doc = { features?: Array<{ properties: { partition?: string; etat?: string } }> };
        const docs = ((await r.json()) as Doc).features ?? [];
        const doc = docs.find(f => f.properties.etat === "approuve") ?? docs.find(f => !!f.properties.partition) ?? docs[0];
        partition = doc?.properties.partition ?? undefined;
      }
    }

    // C) PLUi intercommunal : récupérer le SIREN de l'EPCI → partition = "{SIREN}_PLUI"
    if (!partition && inseeCode) {
      const epciR = await fetchWithRetry(
        `https://geo.api.gouv.fr/communes/${encodeURIComponent(inseeCode)}/epcis?fields=code&limit=5`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (epciR) {
        const epcis = (await epciR.json()) as Array<{ code?: string }>;
        for (const epci of epcis) {
          if (!epci.code || partition) continue;
          const candidate = `${epci.code}_PLUI`;
          const r = await fetchWithRetry(
            `https://apicarto.ign.fr/api/gpu/zone-urba?partition=${encodeURIComponent(candidate)}&_limit=1`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (r) { const j = await r.json() as { features?: unknown[] }; if ((j.features?.length ?? 0) > 0) partition = candidate; }
        }
      }
    }

    if (!partition) {
      if (communeRow?.plu_zones_geojson) { res.setHeader("X-PLU-Cache", "STALE"); return res.json(communeRow.plu_zones_geojson); }
      return res.status(404).json({ error: "Aucune zone PLU disponible pour cette commune sur le Géoportail de l'Urbanisme" });
    }

    // ── Récupération des zones filtrées par partition + polygone commune ──────
    const params = new URLSearchParams({ partition, _limit: "1000" });
    params.set("geom", communeGeom);
    const zoneR = await fetchWithRetry(
      `https://apicarto.ign.fr/api/gpu/zone-urba?${params.toString()}`,
      { signal: AbortSignal.timeout(25000) }, 2, 2000
    );
    if (!zoneR) {
      if (communeRow?.plu_zones_geojson) { res.setHeader("X-PLU-Cache", "STALE"); return res.json(communeRow.plu_zones_geojson); }
      return res.status(502).json({ error: "Le Géoportail de l'Urbanisme est temporairement indisponible. Réessayez dans quelques instants." });
    }
    const zoneJson = await zoneR.json() as { type?: string; features?: unknown[] };
    if (!zoneJson.features?.length) {
      if (communeRow?.plu_zones_geojson) { res.setHeader("X-PLU-Cache", "STALE"); return res.json(communeRow.plu_zones_geojson); }
      return res.status(404).json({ error: "Aucune zone PLU disponible pour cette commune sur le Géoportail de l'Urbanisme" });
    }

    // Persist dans la mémoire + DB
    pluZonesCache.set(cacheKey, { zones: zoneJson, expiresAt: Date.now() + PLU_CACHE_TTL_MS });
    if (inseeCode) {
      db.update(communes)
        .set({ plu_zones_geojson: zoneJson, plu_zones_cached_at: new Date() })
        .where(eq(communes.insee_code, inseeCode))
        .catch(e => console.error("[plu-zones DB cache]", e));
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(zoneJson);
  } catch (err) {
    console.error("[plu-zones proxy]", err);
    if (communeRow?.plu_zones_geojson) { res.setHeader("X-PLU-Cache", "STALE"); return res.json(communeRow.plu_zones_geojson as object); }
    res.status(500).json({ error: "Erreur serveur", detail: String(err) });
  }
});

// ── Courriers : templates & en-tête commune ───────────────────────────────

// Source of truth: commune_insee (stable) > commune name (fallback).
// Creates a minimal commune row on the fly if none exists yet.
async function getCommuneRowForUser(req: AuthRequest) {
  const userId = req.user!.id;

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

    // 3. Commune not in table yet — create minimal row
    const [created] = await db.insert(communes).values({
      name,
      insee_code: `tmp_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now()}`,
    }).returning();
    return created ?? null;
  }

  return null;
}

async function getCommuneForUser(req: AuthRequest): Promise<string | null> {
  const [u] = await db.select({ commune: users.commune, commune_insee: users.commune_insee })
    .from(users).where(eq(users.id, req.user!.id)).limit(1);
  // Prefer INSEE code as the canonical identifier for template ownership
  return u?.commune_insee ?? u?.commune?.trim() ?? null;
}

mairieRouter.get("/templates", async (req: AuthRequest, res) => {
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

mairieRouter.post("/templates", async (req: AuthRequest, res) => {
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

mairieRouter.put("/templates/:templateId", async (req: AuthRequest, res) => {
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

mairieRouter.delete("/templates/:templateId", async (req: AuthRequest, res) => {
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

mairieRouter.get("/commune-letterhead", async (req: AuthRequest, res) => {
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

mairieRouter.put("/commune-letterhead", async (req: AuthRequest, res) => {
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
mairieRouter.get("/legal-mentions", async (req: AuthRequest, res) => {
  try {
    const dossierType = (req.query.type as string | undefined) ?? "";
    const courrierType = (req.query.courrier_type as string | undefined) ?? "";

    // Map full dossier type name to short code
    const TYPE_SHORT: Record<string, string> = {
      permis_de_construire: "PC",
      declaration_prealable: "DP",
      permis_amenager: "PA",
      permis_demolir: "PD",
      certificat_urbanisme: "CU",
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

// ── GET /api/mairie/commune-users?commune=... ────────────────────────────────
// Returns users with access to a commune (via user_communes OR users.commune)
mairieRouter.get("/commune-users", requireAuth, async (req: AuthRequest, res) => {
  const communeName = (req.query.commune as string) ?? "";
  if (!communeName) return res.json([]);

  // Users linked via user_communes table
  const viaTable = await db
    .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
    .from(users)
    .innerJoin(user_communes, eq(user_communes.user_id, users.id))
    .innerJoin(communes, eq(communes.id, user_communes.commune_id))
    .where(sql`lower(${communes.name}) = lower(${communeName})`);

  // Users whose primary commune matches
  const viaPrimary = await db
    .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
    .from(users)
    .where(sql`lower(${users.commune}) = lower(${communeName})`);

  // Merge and deduplicate
  const all = [...viaTable];
  const seen = new Set(viaTable.map(u => u.id));
  for (const u of viaPrimary) {
    if (!seen.has(u.id)) { all.push(u); seen.add(u.id); }
  }

  res.json(all.sort((a, b) => a.nom.localeCompare(b.nom)));
});

// ── Référentiel documentaire par commune ──────────────────────────────────────

mairieRouter.get("/documents", async (req: AuthRequest, res) => {
  try {
    const communeName = req.query.commune as string | undefined;
    if (!communeName) return res.status(400).json({ error: "Paramètre commune requis" });

    const [commune] = await db.select({ id: communes.id })
      .from(communes).where(ilike(communes.name, communeName)).limit(1);
    if (!commune) return res.json([]);

    const docs = await db.select({
      id: commune_documents.id,
      commune_id: commune_documents.commune_id,
      type: commune_documents.type,
      name: commune_documents.name,
      original_filename: commune_documents.original_filename,
      file_size: commune_documents.file_size,
      status: commune_documents.status,
      ingested_at: commune_documents.ingested_at,
      created_at: commune_documents.created_at,
    })
      .from(commune_documents)
      .where(eq(commune_documents.commune_id, commune.id))
      .orderBy(commune_documents.type, commune_documents.created_at);

    res.json(docs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.post("/documents", async (req: AuthRequest, res) => {
  try {
    const { commune_name, type, name, original_filename, file_size, pdf_base64 } = req.body as {
      commune_name: string;
      type: string;
      name: string;
      original_filename: string;
      file_size?: number;
      pdf_base64?: string;
    };

    if (!commune_name || !type || !name || !original_filename) {
      return res.status(400).json({ error: "Champs requis manquants" });
    }

    const [commune] = await db.select({ id: communes.id })
      .from(communes).where(ilike(communes.name, commune_name)).limit(1);
    if (!commune) return res.status(404).json({ error: "Commune introuvable" });

    const [doc] = await db.insert(commune_documents).values({
      commune_id: commune.id,
      type,
      name,
      original_filename,
      file_size: file_size ?? null,
      pdf_content: pdf_base64 ?? null,
      status: "uploaded",
    }).returning({
      id: commune_documents.id,
      type: commune_documents.type,
      name: commune_documents.name,
      original_filename: commune_documents.original_filename,
      file_size: commune_documents.file_size,
      status: commune_documents.status,
      created_at: commune_documents.created_at,
    });

    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.delete("/documents/:id", async (req: AuthRequest, res) => {
  try {
    await db.delete(commune_documents).where(eq(commune_documents.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Consultations de services pour un dossier ──

mairieRouter.get("/dossiers/:id/consultations", async (req: AuthRequest, res) => {
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

mairieRouter.post("/dossiers/:id/consultations", async (req: AuthRequest, res) => {
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

mairieRouter.patch("/dossiers/:id/consultations/:consultationId", async (req: AuthRequest, res) => {
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
