import { Router } from "express";
import { db } from "../db.js";
import { communes, epci, users, dossiers, role_permissions, external_services, service_communes, user_communes, audit_logs, password_tokens, dossier_pieces_jointes, legal_mentions, legal_mentions_misses, ai_usage_events, ai_alert_config, ai_pricing, regulatory_documents, document_communes, zones, zone_regulatory_rules, site_settings, billing_prestations, billing_plans, billing_items, billing_costs, PLU_FAMILY_TYPES, REGULATORY_DOCUMENT_TYPES } from "@heureka-v1/db";
import { resolvePeriod, summarizeRevenue, summarizeCosts, computeMrr, recognizedRevenueHt, recognizedCostHt, matchPlanForPopulation, matchPlanForEpci, parsePopulation, type RevenueLine, type CostLine, type Period } from "../services/billing.js";
import { invalidateAiAlertConfigCache, sendTestNotification } from "../services/aiAlerts.js";
import { invalidatePricingCache } from "../services/aiUsage.js";
import { CODE_URBANISME_ID, CODE_URBANISME_NAME, refreshArticle, resolveCode, searchTocByQuery } from "../services/legifrance.js";
import { eq, sql, count, desc, and, or, isNull, isNotNull, ilike, asc, gte, lt, inArray } from "drizzle-orm";
import crypto from "crypto";
import { sendActivationEmail } from "../services/mailer.js";
import bcrypt from "bcryptjs";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { invalidateCommuneScope } from "../middlewares/dossierAccess.js";
import { invalidatePermissions, invalidateAllPermissions } from "../middlewares/permissions.js";
import { logAudit } from "../services/audit.js";

export const superAdminRouter = Router();

// All routes require authentication + admin role
superAdminRouter.use(requireAuth);
superAdminRouter.use(requireRole("admin"));

// ─── Dashboard ───────────────────────────────────────────────────────────────
superAdminRouter.get("/dashboard", async (_req, res) => {
  try {
    const [[communeCount], [agentCount], [dossierCount], [epciCount]] = await Promise.all([
      db.select({ count: count() }).from(communes),
      db.select({ count: count() }).from(users).where(sql`role IN ('mairie', 'instructeur', 'admin') AND commune IS NOT NULL`),
      db.select({ count: count() }).from(dossiers).where(sql`status NOT IN ('accepte', 'refuse', 'brouillon')`),
      db.select({ count: count() }).from(epci),
    ]);

    res.json({
      communes: Number(communeCount?.count ?? 0),
      agents: Number(agentCount?.count ?? 0),
      dossiersEnCours: Number(dossierCount?.count ?? 0),
      epci: Number(epciCount?.count ?? 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Site public — mode « bientôt en ligne » ─────────────────────────────────
// Singleton site_settings (id=1) garanti par la migration. On ne renvoie jamais
// le hash du mot de passe : seulement un booléen `has_password`.
async function getSiteSettings() {
  const [s] = await db.select().from(site_settings).where(eq(site_settings.id, 1)).limit(1);
  if (s) return s;
  // Garde-fou si la migration de seed n'a pas (encore) tourné.
  await db.insert(site_settings).values({ id: 1 }).onConflictDoNothing();
  const [created] = await db.select().from(site_settings).where(eq(site_settings.id, 1)).limit(1);
  return created!;
}

function publicSiteSettings(s: typeof site_settings.$inferSelect) {
  return {
    coming_soon_enabled: s.coming_soon_enabled,
    coming_soon_title: s.coming_soon_title,
    coming_soon_message: s.coming_soon_message,
    has_password: !!s.coming_soon_password_hash,
    updated_at: s.updated_at,
  };
}

superAdminRouter.get("/site-settings", async (_req, res) => {
  try {
    res.json(publicSiteSettings(await getSiteSettings()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /admin/site-settings
// Body (tous optionnels) : { coming_soon_enabled, coming_soon_title,
//   coming_soon_message, password }. `password` n'est appliqué que s'il est non
//   vide (sinon mot de passe inchangé). On interdit l'activation du mode tant
//   qu'aucun mot de passe n'est défini — sinon le site serait verrouillé sans
//   aucune issue pour le public.
superAdminRouter.patch("/site-settings", async (req, res) => {
  try {
    const b = (req.body ?? {}) as {
      coming_soon_enabled?: boolean;
      coming_soon_title?: string | null;
      coming_soon_message?: string | null;
      password?: string | null;
    };
    const current = await getSiteSettings();

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (b.coming_soon_title !== undefined) {
      updates.coming_soon_title = typeof b.coming_soon_title === "string" ? b.coming_soon_title.trim() || null : null;
    }
    if (b.coming_soon_message !== undefined) {
      updates.coming_soon_message = typeof b.coming_soon_message === "string" ? b.coming_soon_message.trim() || null : null;
    }

    let willHavePassword = !!current.coming_soon_password_hash;
    if (typeof b.password === "string" && b.password.length > 0) {
      updates.coming_soon_password_hash = await bcrypt.hash(b.password, 10);
      willHavePassword = true;
    }

    if (typeof b.coming_soon_enabled === "boolean") {
      if (b.coming_soon_enabled && !willHavePassword) {
        return res.status(400).json({ error: "Définissez d'abord un mot de passe d'accès avant d'activer le mode « bientôt en ligne »." });
      }
      updates.coming_soon_enabled = b.coming_soon_enabled;
    }

    const [updated] = await db.update(site_settings).set(updates).where(eq(site_settings.id, 1)).returning();
    await logAudit(req, "admin_site_settings_updated", {
      targetType: "site_settings",
      targetId: "1",
      metadata: {
        coming_soon_enabled: updated?.coming_soon_enabled ?? null,
        password_changed: updates.coming_soon_password_hash !== undefined,
      },
    });
    res.json(publicSiteSettings(updated!));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Communes ────────────────────────────────────────────────────────────────
superAdminRouter.get("/communes", async (_req, res) => {
  try {
    const [rows, userCounts, dossierCounts] = await Promise.all([
      db
        .select({
          id: communes.id,
          name: communes.name,
          insee_code: communes.insee_code,
          zip_code: communes.zip_code,
          email: communes.email,
          telephone: communes.telephone,
          logo_url: communes.logo_url,
          population: communes.population,
          surface: communes.surface,
          departement: communes.departement,
          region: communes.region,
          description: communes.description,
          epci_id: communes.epci_id,
          epci_name: epci.name,
          instruction_mutualisee: communes.instruction_mutualisee,
        })
        .from(communes)
        .leftJoin(epci, eq(communes.epci_id, epci.id))
        .orderBy(communes.name),
      db
        .select({ commune: users.commune, user_count: count() })
        .from(users)
        .where(sql`role IN ('mairie', 'instructeur')`)
        .groupBy(users.commune),
      db
        .select({ commune: dossiers.commune, dossier_count: count() })
        .from(dossiers)
        .groupBy(dossiers.commune),
    ]);

    const userCountMap: Record<string, number> = {};
    for (const uc of userCounts) {
      if (uc.commune) userCountMap[uc.commune] = Number(uc.user_count);
    }

    const dossierCountMap: Record<string, number> = {};
    for (const dc of dossierCounts) {
      if (dc.commune) dossierCountMap[dc.commune] = Number(dc.dossier_count);
    }

    const result = rows.map((r) => ({
      ...r,
      user_count: userCountMap[r.name] ?? 0,
      dossier_count: dossierCountMap[r.name] ?? 0,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Récupère la population légale d'une commune via l'API Géo (geo.api.gouv.fr)
// à partir de son code INSEE. Sert à alimenter le rattachement automatique au
// plan tarifaire. Renvoie null si indisponible (réseau, code inconnu…).
async function fetchCommunePopulation(insee: string): Promise<number | null> {
  try {
    const r = await fetch(`https://geo.api.gouv.fr/communes/${encodeURIComponent(insee)}?fields=population`);
    if (!r.ok) return null;
    const data = await r.json() as { population?: number };
    return typeof data.population === "number" && Number.isFinite(data.population) ? data.population : null;
  } catch {
    return null;
  }
}

superAdminRouter.post("/communes", async (req, res) => {
  try {
    const { name, insee_code, zip_code, email, telephone, logo_url, population, surface, departement, region, description, epci_id } = req.body as {
      name?: string;
      insee_code?: string;
      zip_code?: string;
      email?: string;
      telephone?: string;
      logo_url?: string;
      population?: string;
      surface?: string;
      departement?: string;
      region?: string;
      description?: string;
      epci_id?: string;
      instruction_mutualisee?: boolean;
    };

    if (!name || !insee_code || !zip_code) {
      return res.status(400).json({ error: "name, insee_code et zip_code sont requis" });
    }

    // Population non fournie : récupération automatique depuis l'API Géo (INSEE)
    // pour activer le rattachement au plan tarifaire (modifiable ensuite).
    let pop = population;
    if ((pop == null || pop.trim() === "") && insee_code) {
      const fetched = await fetchCommunePopulation(insee_code);
      if (fetched != null) pop = String(fetched);
    }

    const [newCommune] = await db
      .insert(communes)
      .values({ name, insee_code, zip_code, email, telephone, logo_url, population: pop, surface, departement, region, description, epci_id, instruction_mutualisee: false })
      .returning();

    res.status(201).json(newCommune);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Complète la population manquante des communes depuis l'API Géo (INSEE).
// Idempotent : ne touche que les communes sans population renseignée.
superAdminRouter.post("/communes/backfill-population", async (req, res) => {
  try {
    const rows = await db.select({ id: communes.id, insee_code: communes.insee_code, population: communes.population }).from(communes);
    let updated = 0, failed = 0, skipped = 0;
    for (const c of rows) {
      if (c.population != null && c.population.trim() !== "") { skipped++; continue; }
      if (!c.insee_code) { failed++; continue; }
      const pop = await fetchCommunePopulation(c.insee_code);
      if (pop == null) { failed++; continue; }
      await db.update(communes).set({ population: String(pop), updated_at: new Date() }).where(eq(communes.id, c.id));
      updated++;
    }
    await logAudit(req, "admin_communes_population_backfilled", { metadata: { updated, failed, skipped } });
    res.json({ updated, failed, skipped, total: rows.length });
  } catch (err) {
    console.error("[communes/backfill-population]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.patch("/communes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // Whitelist explicite — empêche un client de poser des colonnes non
    // prévues (clés API, secrets letterhead…) si le schéma évolue.
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ALLOWED = [
      "name", "insee_code", "zip_code", "email", "telephone", "logo_url",
      "population", "surface", "departement", "region", "description",
      "epci_id", "instruction_mutualisee",
    ] as const;
    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const f of ALLOWED) {
      if (b[f] !== undefined) updates[f] = b[f];
    }

    const [updated] = await db
      .update(communes)
      .set(updates)
      .where(eq(communes.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Commune introuvable" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── EPCI ─────────────────────────────────────────────────────────────────────
superAdminRouter.get("/epci", async (_req, res) => {
  try {
    const epciList = await db.select().from(epci).orderBy(epci.name);
    const communeList = await db
      .select({ id: communes.id, name: communes.name, epci_id: communes.epci_id })
      .from(communes)
      .where(isNotNull(communes.epci_id));

    const pluTypes = PLU_FAMILY_TYPES as readonly string[];

    // Documents de famille PLU portés par un EPCI (= PLUi / PLUm). Plus récent
    // d'abord : on retient le premier rencontré par EPCI.
    const intercommunalDocs = await db
      .select({
        id: regulatory_documents.id,
        type: regulatory_documents.type,
        porteur_epci_id: regulatory_documents.porteur_epci_id,
      })
      .from(regulatory_documents)
      .where(and(
        isNotNull(regulatory_documents.porteur_epci_id),
        inArray(regulatory_documents.type, pluTypes as string[]),
      ))
      .orderBy(desc(regulatory_documents.created_at));

    const docByEpci = new Map<string, { id: string; type: string }>();
    for (const d of intercommunalDocs) {
      if (d.porteur_epci_id && !docByEpci.has(d.porteur_epci_id)) {
        docByEpci.set(d.porteur_epci_id, { id: d.id, type: d.type });
      }
    }

    // Nombre de communes couvertes par chaque document intercommunal (suivi du
    // déploiement progressif : 3/44 par exemple), via document_communes.
    const coverageRows = docByEpci.size > 0
      ? await db
          .select({ document_id: document_communes.document_id, commune_id: document_communes.commune_id })
          .from(document_communes)
          .where(inArray(document_communes.document_id, Array.from(docByEpci.values()).map((d) => d.id)))
      : [];
    const coverageByDoc = new Map<string, number>();
    for (const r of coverageRows) {
      coverageByDoc.set(r.document_id, (coverageByDoc.get(r.document_id) ?? 0) + 1);
    }

    // Communes disposant d'un PLU communal propre (porteur = commune).
    const communalPluRows = await db
      .select({ commune_id: regulatory_documents.porteur_commune_id })
      .from(regulatory_documents)
      .where(and(
        isNotNull(regulatory_documents.porteur_commune_id),
        inArray(regulatory_documents.type, pluTypes as string[]),
      ));
    const communesWithCommunalPlu = new Set(
      communalPluRows.map((r) => r.commune_id).filter((id): id is string => id != null),
    );

    const result = epciList.map((e) => {
      const members = communeList.filter((c) => c.epci_id === e.id);
      const interDoc = docByEpci.get(e.id);
      const communalCount = members.filter((c) => communesWithCommunalPlu.has(c.id)).length;

      // Mode réglementaire dérivé — aucun champ stocké, c'est une lecture du
      // modèle documentaire :
      //  - plui/plum : l'EPCI porte un document de famille PLU intercommunal ;
      //  - communal  : pas de document intercommunal, mais au moins une commune
      //                membre a son propre PLU ;
      //  - none      : aucun document de zonage rattaché.
      let mode: "plui" | "plum" | "communal" | "none";
      if (interDoc) {
        mode = interDoc.type === "plum" ? "plum" : "plui";
      } else if (communalCount > 0) {
        mode = "communal";
      } else {
        mode = "none";
      }

      return {
        ...e,
        communes: members.map((c) => ({ id: c.id, name: c.name })),
        regulatory: {
          mode,
          intercommunal_document_id: interDoc?.id ?? null,
          communes_total: members.length,
          communes_couvertes_plui: interDoc ? coverageByDoc.get(interDoc.id) ?? 0 : 0,
          communes_plu_communal: communalCount,
        },
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.post("/epci", async (req, res) => {
  try {
    const { name, siren, type, departement, region, logo_url } = req.body as {
      name?: string;
      siren?: string;
      type?: string;
      departement?: string;
      region?: string;
      logo_url?: string;
    };

    if (!name) return res.status(400).json({ error: "name est requis" });

    const [newEpci] = await db
      .insert(epci)
      .values({ name, siren, type: type ?? "CC", departement, region, logo_url })
      .returning();

    res.status(201).json(newEpci);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.patch("/epci/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ALLOWED = ["name", "siren", "type", "departement", "region", "logo_url"] as const;
    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const f of ALLOWED) {
      if (b[f] !== undefined) updates[f] = b[f];
    }

    const [updated] = await db
      .update(epci)
      .set(updates)
      .where(eq(epci.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "EPCI introuvable" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/epci/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Check if any communes are attached
    const [attached] = await db
      .select({ count: count() })
      .from(communes)
      .where(eq(communes.epci_id, id));

    if (Number(attached?.count ?? 0) > 0) {
      return res.status(400).json({ error: "Impossible de supprimer un groupement avec des communes rattachées" });
    }

    await db.delete(epci).where(eq(epci.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Import EPCI « clé en main » ─────────────────────────────────────────────
//
// Le point de douleur côté super admin : créer un EPCI puis saisir ses communes
// membres une par une. Or l'État publie la composition officielle de chaque EPCI
// (geo.api.gouv.fr). On en tire trois routes :
//   1. /epci-lookup        : rechercher l'EPCI officiel (nom + SIREN + type)
//   2. /epci-communes      : prévisualiser la liste des communes membres
//   3. POST /epci/import   : créer le groupement + créer/rattacher les communes
//
// Le rattachement est non destructif : une commune déjà connue (même code INSEE)
// est simplement reliée à l'EPCI, on ne réécrit pas ses autres champs.

// Déduit le type Heureka (CC/CA/CU/Métropole) depuis le nom officiel de l'EPCI.
// geo.api.gouv.fr n'expose pas la nature juridique de façon exploitable, mais le
// nom la porte presque toujours ("CC du …", "Métropole de …").
function inferEpciType(nom: string): string {
  const n = nom.toLowerCase();
  if (n.includes("métropole") || n.includes("metropole")) return "Métropole";
  if (n.startsWith("ca ") || n.includes("communauté d'agglomération") || n.includes("communaute d'agglomeration")) return "CA";
  if (n.startsWith("cu ") || n.includes("communauté urbaine") || n.includes("communaute urbaine")) return "CU";
  if (n.startsWith("cc ") || n.includes("communauté de communes") || n.includes("communaute de communes")) return "CC";
  return "CC";
}

// Recherche un EPCI dans le référentiel officiel par son nom.
superAdminRouter.get("/epci-lookup", async (req, res) => {
  try {
    const { nom } = req.query as { nom?: string };
    if (!nom) return res.status(400).json({ error: "nom est requis" });

    const url = `https://geo.api.gouv.fr/epcis?nom=${encodeURIComponent(nom)}&fields=nom,code&limit=8`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({ error: "Erreur lors de la consultation du service geo.api.gouv.fr" });
    }

    const data = await response.json() as Array<{ nom: string; code: string }>;
    const result = data.map((e) => ({
      nom: e.nom,
      siren: e.code,
      type: inferEpciType(e.nom),
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Liste les communes membres d'un EPCI (référentiel officiel), pour prévisualiser
// avant import. siren = code de l'EPCI dans geo.api.gouv.fr.
superAdminRouter.get("/epci-communes", async (req, res) => {
  try {
    const { siren } = req.query as { siren?: string };
    if (!siren) return res.status(400).json({ error: "siren est requis" });

    const url = `https://geo.api.gouv.fr/epcis/${encodeURIComponent(siren)}/communes?fields=nom,code,codesPostaux,departement,region`;
    const response = await fetch(url);
    if (response.status === 404) {
      return res.status(404).json({ error: "EPCI introuvable dans le référentiel officiel" });
    }
    if (!response.ok) {
      return res.status(502).json({ error: "Erreur lors de la consultation du service geo.api.gouv.fr" });
    }

    const data = await response.json() as Array<{
      nom: string;
      code: string;
      codesPostaux: string[];
      departement?: { nom: string };
      region?: { nom: string };
    }>;

    const result = data
      .map((c) => ({
        nom: c.nom,
        insee: c.code,
        zip: c.codesPostaux?.[0] ?? "",
        departement: c.departement?.nom ?? "",
        region: c.region?.nom ?? "",
      }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Crée (ou réutilise) un EPCI puis crée/rattache en lot les communes fournies.
// Body : { epci_id?, epci?: { name, siren?, type?, departement?, region? },
//          communes: [{ nom, insee, zip?, departement?, region? }] }
// - epci_id fourni → import dans un groupement existant.
// - sinon → réutilise l'EPCI de même SIREN s'il existe, sinon le crée.
// Rattachement non destructif : commune existante (même INSEE) = simple lien.
superAdminRouter.post("/epci/import", async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      epci_id?: string;
      epci?: { name?: string; siren?: string; type?: string; departement?: string; region?: string };
      communes?: Array<{ nom?: string; insee?: string; zip?: string; departement?: string; region?: string }>;
    };

    const inputCommunes = (body.communes ?? []).filter((c) => c.insee && c.nom);
    if (inputCommunes.length === 0) {
      return res.status(400).json({ error: "Aucune commune à importer" });
    }

    // Département / région de l'EPCI : fournis explicitement, sinon dérivés de la
    // première commune membre (suffisant pour pré-remplir l'en-tête du groupement).
    const firstC = inputCommunes[0]!;

    // 1. Résoudre l'EPCI cible.
    let targetEpci: typeof epci.$inferSelect | undefined;
    if (body.epci_id) {
      [targetEpci] = await db.select().from(epci).where(eq(epci.id, body.epci_id)).limit(1);
      if (!targetEpci) return res.status(404).json({ error: "Groupement introuvable" });
    } else {
      const e = body.epci ?? {};
      const name = e.name?.trim();
      if (!name) return res.status(400).json({ error: "epci.name ou epci_id est requis" });

      // Réutilise un EPCI de même SIREN pour éviter les doublons.
      if (e.siren) {
        [targetEpci] = await db.select().from(epci).where(eq(epci.siren, e.siren)).limit(1);
      }
      if (!targetEpci) {
        [targetEpci] = await db
          .insert(epci)
          .values({
            name,
            siren: e.siren || null,
            type: e.type || inferEpciType(name),
            departement: e.departement || firstC.departement || null,
            region: e.region || firstC.region || null,
          })
          .returning();
      }
    }
    const epciId = targetEpci!.id;

    // 2. Communes déjà en base (par INSEE), pour distinguer création / rattachement.
    const inseeCodes = inputCommunes.map((c) => c.insee!) as string[];
    const existing = await db
      .select({ id: communes.id, insee_code: communes.insee_code, epci_id: communes.epci_id })
      .from(communes)
      .where(inArray(communes.insee_code, inseeCodes));
    const existingByInsee = new Map(existing.map((c) => [c.insee_code, c]));

    const created: string[] = [];
    const attached: string[] = [];
    const alreadyMember: string[] = [];
    const errors: Array<{ commune: string; error: string }> = [];

    for (const c of inputCommunes) {
      try {
        const found = existingByInsee.get(c.insee!);
        if (found) {
          if (found.epci_id === epciId) {
            alreadyMember.push(c.nom!);
          } else {
            // Rattachement non destructif : on ne touche qu'à epci_id.
            await db
              .update(communes)
              .set({ epci_id: epciId, updated_at: new Date() })
              .where(eq(communes.id, found.id));
            attached.push(c.nom!);
          }
        } else {
          await db.insert(communes).values({
            name: c.nom!,
            insee_code: c.insee!,
            zip_code: c.zip || "",
            departement: c.departement || null,
            region: c.region || null,
            epci_id: epciId,
            instruction_mutualisee: false,
          });
          created.push(c.nom!);
        }
      } catch (e) {
        errors.push({ commune: c.nom ?? c.insee ?? "?", error: e instanceof Error ? e.message : "Erreur" });
      }
    }

    await logAudit(req, "admin_epci_imported", {
      targetType: "epci",
      targetId: epciId,
      metadata: {
        epci_name: targetEpci!.name,
        created: created.length,
        attached: attached.length,
        already_member: alreadyMember.length,
        errors: errors.length,
      },
    });

    res.status(201).json({
      epci: { id: epciId, name: targetEpci!.name, type: targetEpci!.type, siren: targetEpci!.siren },
      created,
      attached,
      already_member: alreadyMember,
      errors,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Documents portés par un EPCI (PLUi, PLUm, etc.) ─────────────────────────
//
// Le minimum vital pour déclencher l'usage PLUi : créer un regulatory_document
// porté par un EPCI et le rattacher aux communes couvertes (toutes les membres
// par défaut, ou un sous-ensemble explicite pour un déploiement progressif).
// L'ingestion effective des règles passe ensuite par la CLI pnpm ingest avec
// --doc-id, ou par une route ultérieure d'extraction PDF.

// Liste les documents portés par un EPCI, avec leur couverture (N/M communes).
// Comportement parallèle à GET /superadmin/epci pour le bloc regulatory : tout
// est dérivé du modèle documentaire, rien n'est stocké en double.
superAdminRouter.get("/epci/:id/documents", async (req, res) => {
  try {
    const { id } = req.params;
    const [groupement] = await db.select({ id: epci.id }).from(epci).where(eq(epci.id, id)).limit(1);
    if (!groupement) return res.status(404).json({ error: "EPCI introuvable" });

    const docs = await db
      .select({
        id: regulatory_documents.id,
        type: regulatory_documents.type,
        name: regulatory_documents.name,
        original_filename: regulatory_documents.original_filename,
        synthese: regulatory_documents.synthese,
        status: regulatory_documents.status,
        validation_status: regulatory_documents.validation_status,
        ingested_at: regulatory_documents.ingested_at,
        created_at: regulatory_documents.created_at,
      })
      .from(regulatory_documents)
      .where(eq(regulatory_documents.porteur_epci_id, id))
      .orderBy(desc(regulatory_documents.created_at));

    // Couverture par document : nombre de communes rattachées via document_communes.
    const coverageRows = docs.length === 0 ? [] : await db
      .select({ document_id: document_communes.document_id, commune_id: document_communes.commune_id })
      .from(document_communes)
      .where(inArray(document_communes.document_id, docs.map((d) => d.id)));
    const coverageByDoc = new Map<string, string[]>();
    for (const r of coverageRows) {
      const arr = coverageByDoc.get(r.document_id) ?? [];
      arr.push(r.commune_id);
      coverageByDoc.set(r.document_id, arr);
    }

    // Nombre total de communes membres (pour exposer la fraction 3/44).
    const totalMembersRows = await db
      .select({ count: count() })
      .from(communes)
      .where(eq(communes.epci_id, id));
    const totalMembers = Number(totalMembersRows[0]?.count ?? 0);

    res.json(docs.map((d) => ({
      ...d,
      communes_couvertes: coverageByDoc.get(d.id) ?? [],
      communes_membres_total: totalMembers,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Crée un document porté par un EPCI et le rattache aux communes couvertes.
// Si `commune_ids` n'est pas fourni, on rattache TOUTES les communes membres
// par défaut (mode complet). Sinon on respecte la liste — utile au déploiement
// progressif (3 communes pilotes sur 44).
//
// Sécurité : on n'accepte que des communes effectivement membres de l'EPCI,
// pour éviter qu'un appel mal formé n'écrase la sémantique du périmètre.
superAdminRouter.post("/epci/:id/documents", async (req, res) => {
  try {
    const { id } = req.params;
    const { type, name, original_filename, commune_ids, synthese } = req.body as {
      type?: string;
      name?: string;
      original_filename?: string;
      commune_ids?: string[];
      synthese?: string;
    };

    if (!type) return res.status(400).json({ error: "type est requis" });
    if (!name?.trim()) return res.status(400).json({ error: "name est requis" });
    if (!(REGULATORY_DOCUMENT_TYPES as readonly string[]).includes(type)) {
      return res.status(400).json({ error: `type invalide. Valeurs autorisées : ${REGULATORY_DOCUMENT_TYPES.join(", ")}` });
    }

    const [groupement] = await db.select({ id: epci.id }).from(epci).where(eq(epci.id, id)).limit(1);
    if (!groupement) return res.status(404).json({ error: "EPCI introuvable" });

    // Résolution des communes à rattacher.
    const memberRows = await db
      .select({ id: communes.id })
      .from(communes)
      .where(eq(communes.epci_id, id));
    const memberIds = new Set(memberRows.map((r) => r.id));

    let targetCommuneIds: string[];
    if (Array.isArray(commune_ids) && commune_ids.length > 0) {
      // Filtre défensif : on ne rattache QUE des communes effectivement membres.
      // Une commune externe glissée ici serait un signal de bug côté caller.
      const invalid = commune_ids.filter((cid) => !memberIds.has(cid));
      if (invalid.length > 0) {
        return res.status(400).json({
          error: "Certaines communes ne sont pas membres de cet EPCI",
          invalid_commune_ids: invalid,
        });
      }
      targetCommuneIds = commune_ids;
    } else {
      // Pas de liste fournie → toutes les communes membres.
      targetCommuneIds = Array.from(memberIds);
    }

    if (targetCommuneIds.length === 0) {
      return res.status(400).json({
        error: "Aucune commune à rattacher (EPCI sans membre ou liste vide)",
      });
    }

    // Création atomique : document + rattachements N:N.
    const document = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(regulatory_documents)
        .values({
          // commune_id reste NULL en mode PLUi : le porteur est l'EPCI, le
          // périmètre vit dans document_communes.
          commune_id: null,
          porteur_commune_id: null,
          porteur_epci_id: id,
          type,
          name: name.trim(),
          original_filename: original_filename?.trim() || "—",
          synthese: synthese?.trim() || null,
          // Statut initial "uploaded" : aucune règle n'est encore ingérée. La
          // CLI ou une route d'extraction passera ensuite à "ingested".
          status: "uploaded",
        })
        .returning();

      await tx.insert(document_communes).values(
        targetCommuneIds.map((commune_id) => ({ document_id: doc!.id, commune_id })),
      );

      return doc!;
    });

    res.status(201).json({
      ...document,
      communes_couvertes: targetCommuneIds,
      communes_membres_total: memberIds.size,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Modifie les infos d'un document (type, name, synthèse, validation_status).
// Le périmètre des communes couvertes n'est PAS touché ici — voir PUT
// /communes ci-dessous (responsabilité séparée).
superAdminRouter.patch("/epci/:id/documents/:docId", async (req: any, res) => {
  try {
    const { id, docId } = req.params;
    const { type, name, original_filename, synthese, validation_status } = req.body as {
      type?: string;
      name?: string;
      original_filename?: string;
      synthese?: string | null;
      validation_status?: "valide" | "brouillon" | "rejete";
    };

    // Cohérence : on vérifie que le document est bien porté par cet EPCI.
    const [doc] = await db.select()
      .from(regulatory_documents)
      .where(and(
        eq(regulatory_documents.id, docId),
        eq(regulatory_documents.porteur_epci_id, id),
      ))
      .limit(1);
    if (!doc) return res.status(404).json({ error: "Document introuvable pour cet EPCI" });

    const patch: Partial<typeof regulatory_documents.$inferInsert> & { updated_at: Date } = { updated_at: new Date() };
    if (type !== undefined) {
      if (!(REGULATORY_DOCUMENT_TYPES as readonly string[]).includes(type)) {
        return res.status(400).json({ error: `type invalide. Valeurs autorisées : ${REGULATORY_DOCUMENT_TYPES.join(", ")}` });
      }
      patch.type = type;
    }
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: "name ne peut pas être vide" });
      patch.name = name.trim();
    }
    if (original_filename !== undefined) patch.original_filename = original_filename.trim() || "—";
    if (synthese !== undefined) patch.synthese = synthese?.trim() || null;
    if (validation_status !== undefined) {
      if (!["valide", "brouillon", "rejete"].includes(validation_status)) {
        return res.status(400).json({ error: "validation_status invalide" });
      }
      patch.validation_status = validation_status;
      // Convention partagée avec mairie/consultations : passer à 'valide'
      // horodatte + impute le validator ; tout retour en arrière efface.
      if (validation_status === "valide") {
        patch.validated_by = req.user?.id ?? null;
        patch.validated_at = new Date();
      } else {
        patch.validated_by = null;
        patch.validated_at = null;
      }
    }

    const [updated] = await db.update(regulatory_documents)
      .set(patch)
      .where(eq(regulatory_documents.id, docId))
      .returning();
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Remplace l'intégralité du périmètre de couverture d'un document : la liste
// `commune_ids` fournie devient EXACTEMENT le rattachement effectif.
// Endpoint séparé du PATCH parce que la manipulation du périmètre a ses
// propres invariants (filtre membres EPCI, anti-effacement total) et que les
// callers UI peuvent vouloir l'un sans l'autre.
superAdminRouter.put("/epci/:id/documents/:docId/communes", async (req, res) => {
  try {
    const { id, docId } = req.params;
    const { commune_ids } = req.body as { commune_ids?: string[] };
    if (!Array.isArray(commune_ids)) {
      return res.status(400).json({ error: "commune_ids doit être un tableau" });
    }

    const [doc] = await db.select({ id: regulatory_documents.id })
      .from(regulatory_documents)
      .where(and(
        eq(regulatory_documents.id, docId),
        eq(regulatory_documents.porteur_epci_id, id),
      ))
      .limit(1);
    if (!doc) return res.status(404).json({ error: "Document introuvable pour cet EPCI" });

    // Filtre défensif : seules les communes membres de l'EPCI sont autorisées.
    const memberRows = await db
      .select({ id: communes.id })
      .from(communes)
      .where(eq(communes.epci_id, id));
    const memberIds = new Set(memberRows.map((r) => r.id));
    const invalid = commune_ids.filter((cid) => !memberIds.has(cid));
    if (invalid.length > 0) {
      return res.status(400).json({
        error: "Certaines communes ne sont pas membres de cet EPCI",
        invalid_commune_ids: invalid,
      });
    }
    if (commune_ids.length === 0) {
      return res.status(400).json({ error: "Au moins une commune doit être rattachée. Supprimez le document si vous voulez retirer toutes les communes." });
    }

    // Sync atomique : on retire les rattachements absents de la nouvelle
    // liste, on ajoute ceux qui manquent. ON CONFLICT pour idempotence si
    // déjà présent (transition fluide sans suppression intermédiaire).
    await db.transaction(async (tx) => {
      const current = await tx
        .select({ commune_id: document_communes.commune_id })
        .from(document_communes)
        .where(eq(document_communes.document_id, docId));
      const currentSet = new Set(current.map((r) => r.commune_id));
      const targetSet = new Set(commune_ids);

      const toRemove = current.filter((r) => !targetSet.has(r.commune_id)).map((r) => r.commune_id);
      const toAdd = commune_ids.filter((cid) => !currentSet.has(cid));

      if (toRemove.length > 0) {
        await tx.delete(document_communes).where(and(
          eq(document_communes.document_id, docId),
          inArray(document_communes.commune_id, toRemove),
        ));
      }
      if (toAdd.length > 0) {
        await tx.insert(document_communes).values(
          toAdd.map((commune_id) => ({ document_id: docId, commune_id })),
        );
      }
    });

    res.json({ document_id: docId, communes_couvertes: commune_ids, communes_membres_total: memberIds.size });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Suppression d'un document. Cascade implicite : les rattachements
// document_communes (FK ON DELETE CASCADE) partent avec, et les zones/règles
// produites par ce document voient leur source_document_id passer à NULL
// (FK ON DELETE SET NULL). Pour effacer aussi les zones et règles dérivées,
// on les supprime explicitement dans la même transaction — c'est le
// comportement attendu côté UI (« je supprime le PLUi → tout ce qu'il a
// produit s'en va »).
superAdminRouter.delete("/epci/:id/documents/:docId", async (req, res) => {
  try {
    const { id, docId } = req.params;
    const [doc] = await db.select({ id: regulatory_documents.id })
      .from(regulatory_documents)
      .where(and(
        eq(regulatory_documents.id, docId),
        eq(regulatory_documents.porteur_epci_id, id),
      ))
      .limit(1);
    if (!doc) return res.status(404).json({ error: "Document introuvable pour cet EPCI" });

    await db.transaction(async (tx) => {
      const derivedZones = await tx.select({ id: zones.id })
        .from(zones)
        .where(eq(zones.source_document_id, docId));
      if (derivedZones.length > 0) {
        const zoneIds = derivedZones.map((z) => z.id);
        await tx.delete(zone_regulatory_rules).where(inArray(zone_regulatory_rules.zone_id, zoneIds));
        await tx.delete(zones).where(inArray(zones.id, zoneIds));
      }
      // document_communes part en cascade via la FK.
      await tx.delete(regulatory_documents).where(eq(regulatory_documents.id, docId));
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────
superAdminRouter.get("/users", async (req, res) => {
  try {
    const { commune, role } = req.query as { commune?: string; role?: string };

    const conditions = [];
    if (commune) {
      // Un agent peut être rattaché à PLUSIEURS communes (table user_communes).
      // `users.commune` ne porte que la commune PRINCIPALE (la 1re saisie à la
      // création) : filtrer dessus seul masque l'agent dans ses communes
      // secondaires. On retient donc aussi les agents reliés à la commune via
      // user_communes (cf. getCommuneScope, qui fait foi pour l'accès réel).
      conditions.push(sql`(
        lower(${users.commune}) = lower(${commune})
        OR EXISTS (
          SELECT 1 FROM user_communes uc
          JOIN communes c ON c.id = uc.commune_id
          WHERE uc.user_id = ${users.id} AND lower(c.name) = lower(${commune})
        )
      )`);
    }
    if (role) conditions.push(eq(users.role, role as "citoyen" | "mairie" | "instructeur" | "admin"));

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        prenom: users.prenom,
        nom: users.nom,
        role: users.role,
        commune: users.commune,
        telephone: users.telephone,
        role_config_id: users.role_config_id,
        created_at: users.created_at,
        activation_pending: sql<boolean>`EXISTS (
          SELECT 1 FROM password_tokens pt
          WHERE pt.user_id = ${users.id}
            AND pt.type = 'activation'
            AND pt.used_at IS NULL
        )`,
      })
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(users.created_at));

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.post("/users", async (req, res) => {
  try {
    const { email, prenom, nom, role, communeIds, telephone, role_config_id } = req.body as {
      email?: string;
      prenom?: string;
      nom?: string;
      role?: string;
      communeIds?: string[];
      telephone?: string;
      role_config_id?: string;
    };

    if (!email || !prenom || !nom || !role) {
      return res.status(400).json({ error: "email, prenom, nom et role sont requis" });
    }

    // Resolve commune names from IDs
    let communeNames: string[] = [];
    let primaryCommune: string | undefined;
    if (communeIds && communeIds.length > 0) {
      const communeRows = await db
        .select({ id: communes.id, name: communes.name })
        .from(communes)
        .where(inArray(communes.id, communeIds));
      communeNames = communeIds.map((id) => communeRows.find((c) => c.id === id)?.name ?? "").filter(Boolean);
      primaryCommune = communeNames[0];
    }

    // Mot de passe inutilisable — l'utilisateur définira le sien via le lien d'activation
    const password_hash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

    const [newUser] = await db
      .insert(users)
      .values({
        email,
        prenom,
        nom,
        role: role as "citoyen" | "mairie" | "instructeur" | "admin",
        commune: primaryCommune ?? null,
        telephone,
        password_hash,
        role_config_id: role_config_id ?? null,
      })
      // Projection explicite : ne jamais renvoyer password_hash au client
      .returning({
        id: users.id,
        email: users.email,
        prenom: users.prenom,
        nom: users.nom,
        role: users.role,
        commune: users.commune,
        commune_insee: users.commune_insee,
        telephone: users.telephone,
        role_config_id: users.role_config_id,
        created_at: users.created_at,
      });

    // Insert commune relationships
    if (communeIds && communeIds.length > 0) {
      await db.insert(user_communes).values(communeIds.map((id) => ({ user_id: newUser!.id, commune_id: id })));
    }

    // Token d'activation valable 7 jours
    const token = crypto.randomBytes(32).toString("hex");
    await db.insert(password_tokens).values({
      user_id: newUser!.id,
      token,
      type: "activation",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await sendActivationEmail({
      to: email,
      prenom,
      serviceName: primaryCommune ?? "Heurekia",
      communeNames: communeNames.length > 0 ? communeNames : undefined,
      token,
    }).catch((err) => console.error("[mailer] invitation:", err));

    await logAudit(req, "admin_user_created", { email });
    res.status(201).json({ ...newUser, invited: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Resend invitation email to a user who hasn't activated their account
superAdminRouter.post("/users/:id/resend-invitation", async (req, res) => {
  try {
    const { id } = req.params;
    const [user] = await db.select({ id: users.id, email: users.email, prenom: users.prenom, commune: users.commune }).from(users).where(eq(users.id, id));
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    // Expire all previous pending activation tokens
    await db.update(password_tokens)
      .set({ used_at: new Date() })
      .where(and(eq(password_tokens.user_id, id), eq(password_tokens.type, "activation"), isNull(password_tokens.used_at)));

    // Create a fresh 7-day token
    const token = crypto.randomBytes(32).toString("hex");
    await db.insert(password_tokens).values({
      user_id: id,
      token,
      type: "activation",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await sendActivationEmail({
      to: user.email,
      prenom: user.prenom,
      serviceName: user.commune ?? "Heurekia",
      token,
    }).catch((err) => console.error("[mailer] resend-invitation:", err));

    await logAudit(req, "admin_invitation_resent", { email: user.email });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.patch("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { role, prenom, nom, commune, commune_insee, telephone, role_config_id } = req.body as Partial<{
      role: "citoyen" | "mairie" | "instructeur" | "admin";
      prenom: string;
      nom: string;
      commune: string | null;
      commune_insee: string | null;
      telephone: string;
      role_config_id: string | null;
    }>;

    // Anti-lockout : refuser la rétrogradation du DERNIER administrateur (sinon
    // plus aucun compte ne peut accéder à /api/admin → récupération SQL manuelle).
    if (role !== undefined && role !== "admin") {
      const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, id)).limit(1);
      if (target?.role === "admin") {
        const adminRows = await db.select({ value: count() }).from(users).where(eq(users.role, "admin"));
        if ((adminRows[0]?.value ?? 0) <= 1) {
          return res.status(409).json({ error: "Impossible de rétrograder le dernier administrateur." });
        }
      }
    }

    const [updated] = await db
      .update(users)
      .set({ role, prenom, nom, commune, commune_insee, telephone, role_config_id, updated_at: new Date() })
      .where(eq(users.id, id))
      // Projection explicite : ne jamais renvoyer password_hash au client
      .returning({
        id: users.id,
        email: users.email,
        prenom: users.prenom,
        nom: users.nom,
        role: users.role,
        commune: users.commune,
        commune_insee: users.commune_insee,
        telephone: users.telephone,
        role_config_id: users.role_config_id,
        created_at: users.created_at,
      });

    if (!updated) return res.status(404).json({ error: "Utilisateur introuvable" });
    // Rôle et/ou commune ont pu changer → purger le cache de périmètre de cet
    // agent, sinon il garde son ancien scope jusqu'au redémarrage du process.
    invalidateCommuneScope(id);
    // Idem pour le cache de permissions (role_config_id a pu changer).
    invalidatePermissions(id);
    await logAudit(req, "admin_user_updated", { email: updated.email });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.get("/users/:id/communes", async (req, res) => {
  try {
    const rows = await db.select({ commune_id: user_communes.commune_id })
      .from(user_communes).where(eq(user_communes.user_id, req.params.id));
    res.json(rows.map((r) => r.commune_id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.put("/users/:id/communes", async (req, res) => {
  try {
    const { id } = req.params;
    const { ids } = req.body as { ids: string[] };
    await db.transaction(async (tx) => {
      await tx.delete(user_communes).where(eq(user_communes.user_id, id));
      if (ids.length > 0) {
        await tx.insert(user_communes).values(ids.map((cid) => ({ user_id: id, commune_id: cid })));
        // Sync primary commune + INSEE code from first selected commune
        const [primary] = await tx.select({ name: communes.name, insee_code: communes.insee_code })
          .from(communes).where(eq(communes.id, ids[0]!)).limit(1);
        if (primary) {
          await tx.update(users).set({ commune: primary.name, commune_insee: primary.insee_code, updated_at: new Date() }).where(eq(users.id, id));
        }
      } else {
        await tx.update(users).set({ commune: null, commune_insee: null, updated_at: new Date() }).where(eq(users.id, id));
      }
    });
    // Le périmètre de communes de l'agent vient de changer → purger son cache
    // de scope (cf. getCommuneScope) pour que l'accès prenne effet immédiatement.
    invalidateCommuneScope(id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // Anti auto-suppression (cohérent avec le flux mairie) et anti-lockout.
    if (id === (req as AuthRequest).user?.id) {
      return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte." });
    }
    const [target] = await db.select({ email: users.email, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (target?.role === "admin") {
      const adminRows = await db.select({ value: count() }).from(users).where(eq(users.role, "admin"));
      if ((adminRows[0]?.value ?? 0) <= 1) {
        return res.status(409).json({ error: "Impossible de supprimer le dernier administrateur." });
      }
    }
    await db.transaction(async (tx) => {
      // Nullify instructeur_id on dossiers assigned to this user (no cascade in schema)
      await tx.update(dossiers).set({ instructeur_id: null }).where(eq(dossiers.instructeur_id, id));
      // Delete pieces jointes uploaded by this user (notNull FK, cannot set null)
      await tx.delete(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.user_id, id));
      // Delete the user — cascades through user_id FKs (dossiers, notifications, etc.)
      await tx.delete(users).where(eq(users.id, id));
    });
    await logAudit(req, "admin_user_deleted", { email: target?.email ?? null });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Roles ───────────────────────────────────────────────────────────────────
superAdminRouter.get("/roles", async (_req, res) => {
  try {
    const rows = await db.select().from(role_permissions).orderBy(asc(role_permissions.label));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.post("/roles", async (req, res) => {
  try {
    const { name, label, base_role, description, color, permissions } = req.body as {
      name?: string;
      label?: string;
      base_role?: string;
      description?: string;
      color?: string;
      permissions?: string[];
    };

    if (!name || !label) {
      return res.status(400).json({ error: "name et label sont requis" });
    }

    const [newRole] = await db
      .insert(role_permissions)
      .values({
        name,
        label,
        base_role: base_role ?? "instructeur",
        description: description ?? null,
        color: color ?? "#4F46E5",
        permissions: permissions ?? [],
        is_system: false,
      })
      .returning();

    invalidateAllPermissions();
    await logAudit(req, "admin_role_created");
    res.status(201).json(newRole);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.patch("/roles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { label, description, color, permissions, base_role } = req.body as Partial<{
      label: string;
      description: string | null;
      color: string;
      permissions: string[];
      base_role: string;
    }>;

    const [existing] = await db.select().from(role_permissions).where(eq(role_permissions.id, id));
    if (!existing) return res.status(404).json({ error: "Rôle introuvable" });

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (label !== undefined) updateData.label = label;
    if (description !== undefined) updateData.description = description;
    if (color !== undefined) updateData.color = color;
    if (permissions !== undefined) updateData.permissions = permissions;
    // Can only change base_role on non-system roles
    if (base_role !== undefined && !existing.is_system) updateData.base_role = base_role;

    const [updated] = await db
      .update(role_permissions)
      .set(updateData)
      .where(eq(role_permissions.id, id))
      .returning();

    // Les permissions du profil ont pu changer → invalider tous les agents.
    invalidateAllPermissions();
    await logAudit(req, "admin_role_updated");
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/roles/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.select().from(role_permissions).where(eq(role_permissions.id, id));
    if (!existing) return res.status(404).json({ error: "Rôle introuvable" });

    if (existing.is_system) {
      return res.status(400).json({ error: "Impossible de supprimer un rôle système" });
    }

    await db.delete(role_permissions).where(eq(role_permissions.id, id));
    invalidateAllPermissions();
    await logAudit(req, "admin_role_deleted");
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Services Annexes ─────────────────────────────────────────────────────────
superAdminRouter.get("/services", async (_req, res) => {
  try {
    const [services, userCounts, communeCounts] = await Promise.all([
      db.select().from(external_services).orderBy(external_services.name),
      db.select({ service_id: users.service_id, cnt: count() })
        .from(users).where(isNotNull(users.service_id)).groupBy(users.service_id),
      db.select({ service_id: service_communes.service_id, cnt: count() })
        .from(service_communes).groupBy(service_communes.service_id),
    ]);
    const userCountMap: Record<string, number> = {};
    for (const uc of userCounts) {
      if (uc.service_id) userCountMap[uc.service_id] = Number(uc.cnt);
    }
    const communeCountMap: Record<string, number> = {};
    for (const cc of communeCounts) {
      communeCountMap[cc.service_id] = Number(cc.cnt);
    }
    res.json(services.map((s) => ({
      ...s,
      user_count: userCountMap[s.id] ?? 0,
      commune_count: communeCountMap[s.id] ?? 0,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.post("/services", async (req, res) => {
  try {
    const { name, type, email, telephone, description } = req.body as {
      name?: string; type?: string; email?: string; telephone?: string; description?: string;
    };
    if (!name || !type) return res.status(400).json({ error: "name et type sont requis" });
    const [service] = await db.insert(external_services).values({ name, type, email, telephone, description }).returning();
    res.status(201).json(service);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.patch("/services/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, email, telephone, description } = req.body as Partial<{
      name: string; type: string; email: string; telephone: string; description: string;
    }>;
    const upd: Record<string, unknown> = { updated_at: new Date() };
    if (name !== undefined) upd.name = name;
    if (type !== undefined) upd.type = type;
    if (email !== undefined) upd.email = email;
    if (telephone !== undefined) upd.telephone = telephone;
    if (description !== undefined) upd.description = description;
    const [updated] = await db.update(external_services).set(upd).where(eq(external_services.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Service introuvable" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/services/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(external_services).where(eq(external_services.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.get("/services/:id/communes", async (req, res) => {
  try {
    const rows = await db
      .select({ commune_id: service_communes.commune_id })
      .from(service_communes)
      .where(eq(service_communes.service_id, req.params.id));
    res.json(rows.map((r) => r.commune_id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.put("/services/:id/communes", async (req, res) => {
  try {
    const { id } = req.params;
    const { ids } = req.body as { ids?: string[] };
    await db.transaction(async (tx) => {
      await tx.delete(service_communes).where(eq(service_communes.service_id, id));
      if (ids && ids.length > 0) {
        await tx.insert(service_communes).values(ids.map((cid) => ({ service_id: id, commune_id: cid })));
      }
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.get("/services/:id/users", async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await db.select({
      id: users.id,
      email: users.email,
      prenom: users.prenom,
      nom: users.nom,
      telephone: users.telephone,
      created_at: users.created_at,
    }).from(users).where(eq(users.service_id, id));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.post("/services/:id/users", async (req, res) => {
  try {
    const { id } = req.params;
    const { email, prenom, nom, telephone } = req.body as {
      email?: string; prenom?: string; nom?: string; telephone?: string;
    };
    if (!email || !prenom || !nom) {
      return res.status(400).json({ error: "email, prenom et nom sont requis" });
    }

    const [service] = await db.select().from(external_services).where(eq(external_services.id, id));
    if (!service) return res.status(404).json({ error: "Service introuvable" });

    // Create account with locked password — user sets it via activation email
    const locked_hash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    const [user] = await db.insert(users).values({
      email, prenom, nom, telephone,
      password_hash: locked_hash,
      role: "service_externe" as const,
      service_id: id,
    }).returning({ id: users.id, email: users.email, prenom: users.prenom, nom: users.nom, telephone: users.telephone, created_at: users.created_at });

    // Generate activation token (valid 7 days)
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.insert(password_tokens).values({ user_id: user!.id, token, type: "activation", expires_at: expires });

    const SERVICE_ROLE_LABELS: Record<string, string> = {
      ABF:                 "Architecte des Bâtiments de France",
      SDIS:                "Agent du Service Départemental d'Incendie et de Secours",
      DDT:                 "Agent de la Direction Départementale des Territoires",
      ARS:                 "Agent de l'Agence Régionale de Santé",
      DREAL:               "Agent de la Direction Régionale de l'Environnement",
      ENEDIS:              "Agent Enedis",
      GRDF:                "Agent GRDF",
      ONF:                 "Agent de l'Office National des Forêts",
      CHAMBRE_AGRICULTURE: "Agent de la Chambre d'Agriculture",
      SNCF:                "Agent SNCF Réseau",
    };
    const roleLabel = SERVICE_ROLE_LABELS[service.type] ?? undefined;

    // Send activation email (fire & forget — don't fail the request if email fails)
    sendActivationEmail({ to: user!.email, prenom: user!.prenom, serviceName: service.name, token, roleLabel })
      .catch(err => console.error("[mailer] activation:", err));

    res.status(201).json(user);
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes("unique")) {
      return res.status(409).json({ error: "Cet email est déjà utilisé" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/services/:id/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    await db.delete(users).where(eq(users.id, userId));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── INSEE Lookup ──────────────────────────────────────────────────────────────
superAdminRouter.get("/insee-lookup", async (req, res) => {
  try {
    const { nom } = req.query as { nom?: string };
    if (!nom) return res.status(400).json({ error: "nom est requis" });

    const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(nom)}&fields=code,codesPostaux,departement,region&boost=population&limit=8`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({ error: "Erreur lors de la consultation du service geo.api.gouv.fr" });
    }

    const data = await response.json() as Array<{
      nom: string;
      code: string;
      codesPostaux: string[];
      departement: { nom: string };
      region: { nom: string };
    }>;

    const result = data.map((c) => ({
      nom: c.nom,
      insee: c.code,
      zip: c.codesPostaux[0] ?? "",
      departement: c.departement?.nom ?? "",
      region: c.region?.nom ?? "",
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Audit Logs ──────────────────────────────────────────────────────────────

// Masque le dernier octet d'une IPv4 (192.168.1.42 → 192.168.1.x) et tronque
// la partie hôte d'une IPv6 (RGPD : pas besoin d'identifier finement). L'IP
// complète reste en base pour usage forensic (CCSC §4.14).
function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  // Strip "::ffff:" préfixe IPv6-mapped IPv4
  const clean = ip.replace(/^::ffff:/, "");
  // IPv4
  const v4 = clean.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.x`;
  // IPv6 — on garde les 4 premiers groupes (préfixe réseau /64)
  if (clean.includes(":")) {
    const parts = clean.split(":");
    return parts.slice(0, 4).join(":") + "::x";
  }
  return clean;
}

superAdminRouter.get("/audit-logs", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = 50;
    const offset = (page - 1) * limit;
    const action = typeof req.query.action === "string" && req.query.action.length > 0
      ? req.query.action
      : undefined;
    const role = typeof req.query.role === "string" && req.query.role.length > 0
      ? req.query.role
      : undefined;
    const targetType = typeof req.query.target_type === "string" && req.query.target_type.length > 0
      ? req.query.target_type
      : undefined;
    const targetId = typeof req.query.target_id === "string" && req.query.target_id.length > 0
      ? req.query.target_id
      : undefined;
    const sinceRaw = typeof req.query.since === "string" && req.query.since.length > 0
      ? req.query.since
      : undefined;
    const sinceDate = sinceRaw ? new Date(sinceRaw) : undefined;

    const conditions = [];
    if (action) conditions.push(eq(audit_logs.action, action));
    if (role) {
      // "mairie" du point de vue super admin couvre mairie + instructeur (les
      // deux rôles qui agissent depuis l'interface mairie). "admin" reste
      // distinct pour identifier les opérations super-admin.
      if (role === "mairie") {
        conditions.push(inArray(audit_logs.role, ["mairie", "instructeur"]));
      } else {
        conditions.push(eq(audit_logs.role, role));
      }
    }
    if (targetType) conditions.push(eq(audit_logs.target_type, targetType));
    if (targetId) conditions.push(eq(audit_logs.target_id, targetId));
    if (sinceDate && !Number.isNaN(sinceDate.getTime())) {
      conditions.push(gte(audit_logs.created_at, sinceDate));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [total]] = await Promise.all([
      db.select({
        id: audit_logs.id,
        user_id: audit_logs.user_id,
        email: audit_logs.email,
        role: audit_logs.role,
        action: audit_logs.action,
        target_type: audit_logs.target_type,
        target_id: audit_logs.target_id,
        metadata: audit_logs.metadata,
        ip: audit_logs.ip,
        user_agent: audit_logs.user_agent,
        created_at: audit_logs.created_at,
        user_prenom: users.prenom,
        user_nom: users.nom,
      })
        .from(audit_logs)
        .leftJoin(users, eq(audit_logs.user_id, users.id))
        .where(where)
        .orderBy(desc(audit_logs.created_at))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(audit_logs).where(where),
    ]);

    // RGPD : on masque le dernier octet de l'IP côté API avant exposition à
    // l'admin. La valeur brute reste en base pour usage forensic.
    const sanitized = rows.map((r) => ({ ...r, ip: maskIp(r.ip) }));

    res.json({ rows: sanitized, total: Number(total?.count ?? 0), page, limit });
  } catch (err) {
    console.error("[audit-logs] query failed:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Legal mentions (Code de l'urbanisme) — CRUD ───────────────────────────────

superAdminRouter.get("/legal-mentions", async (req, res) => {
  try {
    // Filtre optionnel : ?code=CU|CCH|CE → restreint au LEGITEXT correspondant.
    // Sans param, on renvoie tous les codes (UI admin).
    const codeKey = String(req.query.code ?? "").toUpperCase();
    const resolved = codeKey ? resolveCode(codeKey) : null;
    const rows = resolved
      ? await db.select().from(legal_mentions).where(eq(legal_mentions.code, resolved.id)).orderBy(legal_mentions.article_ref)
      : await db.select().from(legal_mentions).orderBy(legal_mentions.code, legal_mentions.article_ref);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.patch("/legal-mentions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { article_title, article_html, courrier_types, dossier_types, categories, contexte } = req.body as {
      article_title?: string;
      article_html?: string;
      courrier_types?: string[];
      dossier_types?: string[];
      categories?: string[];
      contexte?: string;
    };

    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (article_title !== undefined) patch.article_title = article_title;
    if (article_html !== undefined) patch.article_html = article_html;
    if (courrier_types !== undefined) patch.courrier_types = courrier_types;
    if (dossier_types !== undefined) patch.dossier_types = dossier_types;
    if (categories !== undefined) patch.categories = categories;
    if (contexte !== undefined) patch.contexte = contexte;

    const [updated] = await db
      .update(legal_mentions)
      .set(patch)
      .where(eq(legal_mentions.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Article introuvable" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Rafraîchit le contenu d'un article depuis l'API Légifrance (PISTE).
// Préserve les catégories et autres méta — n'écrase que titre / html / fetched_at.
superAdminRouter.post("/legal-mentions/:id/refresh", async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(legal_mentions)
      .where(eq(legal_mentions.id, req.params.id))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Article introuvable" });

    // Mapper le LEGITEXT stocké → clé code lisible (CU/CCH/CE) pour le service.
    let codeKey: string | null = null;
    for (const k of ["CU", "CCH", "CE"]) {
      const r = resolveCode(k);
      if (r && r.id === row.code) { codeKey = k; break; }
    }
    if (!codeKey) return res.status(400).json({ error: "Code non supporté", code: row.code });

    const fresh = await refreshArticle(codeKey, row.article_ref);
    if (!fresh) {
      return res.status(404).json({
        error: `Article ${row.article_ref} introuvable côté Légifrance — vérifie la référence (peut-être renumérotée ou inexistante dans ce code).`,
      });
    }

    const [updated] = await db
      .select()
      .from(legal_mentions)
      .where(eq(legal_mentions.id, req.params.id));
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Recherche dans la table des matières d'un code (CU/CCH/CE).
// Sert l'autocomplete au moment d'ajouter un article — évite les erreurs
// de saisie type L410-2 (n'existe pas) ou les fautes de frappe.
// Query : ?code=CU&q=DAACT (ou un num partiel comme "R431").
superAdminRouter.get("/legal-mentions/toc-search", async (req, res) => {
  try {
    const codeKey = String(req.query.code ?? "CU").toUpperCase();
    const q = String(req.query.q ?? "");
    const limit = Math.min(50, Number(req.query.limit ?? 20));
    const hits = await searchTocByQuery(codeKey, q, limit);
    res.json({ hits, code: codeKey });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.post("/legal-mentions", async (req, res) => {
  try {
    const { article_ref, code, article_title, article_html, courrier_types, dossier_types, categories, contexte, skip_validation } = req.body as {
      article_ref?: string;
      code?: string; // "CU" | "CCH" | "CE" — défaut CU pour rétro-compatibilité
      article_title?: string;
      article_html?: string;
      courrier_types?: string[];
      dossier_types?: string[];
      categories?: string[];
      contexte?: string;
      skip_validation?: boolean; // bypass volontaire si Légifrance est down
    };
    if (!article_ref?.trim()) return res.status(400).json({ error: "article_ref requis" });

    const codeKey = (code ?? "CU").toUpperCase();
    const resolvedCode = resolveCode(codeKey);
    if (!resolvedCode) return res.status(400).json({ error: `Code non supporté : ${codeKey}` });

    const refUpper = article_ref.trim().toUpperCase();

    // Validation Légifrance — sauf si déjà en base OU skip explicite.
    // Si l'article existe : refreshArticle a déjà fait l'upsert avec title/html.
    // S'il n'existe pas : refus net pour ne pas polluer la base.
    if (!skip_validation) {
      const fresh = await refreshArticle(codeKey, refUpper);
      if (!fresh) {
        return res.status(404).json({
          error: `Article ${refUpper} introuvable dans ${resolvedCode.name}. Vérifie la référence sur legifrance.gouv.fr, ou ajoute-le avec skip_validation: true si tu veux forcer.`,
        });
      }
    }

    // Upsert final avec les méta utilisateur (catégories, courrier_types, etc.).
    // Si refreshArticle a tourné, il a déjà posé title/html ; ici on ne les écrase
    // que si l'admin en a fourni explicitement.
    const [row] = await db
      .insert(legal_mentions)
      .values({
        code: resolvedCode.id,
        code_name: resolvedCode.name,
        article_ref: refUpper,
        article_title: article_title ?? null,
        article_html: article_html ?? null,
        courrier_types: courrier_types ?? [],
        dossier_types: dossier_types ?? [],
        categories: categories ?? [],
        contexte: contexte ?? null,
        fetched_at: new Date(),
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [legal_mentions.code, legal_mentions.article_ref],
        set: {
          // Ne pas écraser le titre/html fetché à l'instant si l'admin n'a rien donné.
          ...(article_title !== undefined ? { article_title } : {}),
          ...(article_html  !== undefined ? { article_html  } : {}),
          courrier_types: courrier_types ?? [],
          dossier_types: dossier_types ?? [],
          categories: categories ?? [],
          contexte: contexte ?? null,
          updated_at: new Date(),
        },
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/legal-mentions/:id", async (req, res) => {
  try {
    await db.delete(legal_mentions).where(eq(legal_mentions.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Articles manquants ───────────────────────────────────────────────────────
// Quand l'utilisateur clique sur une référence d'article que Légifrance ne
// renvoie pas, on enregistre la demande pour que l'admin la traite.

// Liste les demandes non résolues, triées par fréquence puis date récente —
// les références les plus cliquées remontent en haut.
superAdminRouter.get("/legal-mentions/missing", async (req, res) => {
  try {
    const includeResolved = String(req.query.include_resolved ?? "") === "1";
    const rows = await db
      .select()
      .from(legal_mentions_misses)
      .where(includeResolved ? sql`TRUE` : isNull(legal_mentions_misses.resolved_at))
      .orderBy(desc(legal_mentions_misses.miss_count), desc(legal_mentions_misses.last_seen_at));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Tente la création de l'article via Légifrance. Si succès : l'article est
// ajouté à `legal_mentions` et la demande est marquée "created". Si Légifrance
// renvoie 404 sur cette référence : on renvoie une erreur ciblée pour que
// l'admin sache que la référence est probablement mal orthographiée.
superAdminRouter.post("/legal-mentions/missing/:id/create", async (req: any, res) => {
  try {
    const [miss] = await db
      .select()
      .from(legal_mentions_misses)
      .where(eq(legal_mentions_misses.id, req.params.id))
      .limit(1);
    if (!miss) return res.status(404).json({ error: "Demande introuvable" });

    const fresh = await refreshArticle(miss.code_key, miss.article_ref);
    if (!fresh) {
      return res.status(404).json({
        error: `Article ${miss.article_ref} introuvable côté Légifrance — vérifie la référence (peut-être renumérotée, abrogée, ou hors champ ${miss.code_key}).`,
      });
    }

    const [updated] = await db
      .update(legal_mentions_misses)
      .set({
        resolved_at: new Date(),
        resolved_by: req.user?.id ?? null,
        resolution: "created",
      })
      .where(eq(legal_mentions_misses.id, req.params.id))
      .returning();

    // Renvoie aussi l'article fraîchement créé pour que le front puisse
    // l'ajouter à sa liste sans reload.
    const [article] = await db
      .select()
      .from(legal_mentions)
      .where(and(eq(legal_mentions.code, resolveCode(miss.code_key)!.id), eq(legal_mentions.article_ref, miss.article_ref)))
      .limit(1);

    res.json({ miss: updated, article });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Marque la demande comme non pertinente (référence erronée, faux positif…).
superAdminRouter.post("/legal-mentions/missing/:id/dismiss", async (req: any, res) => {
  try {
    const [updated] = await db
      .update(legal_mentions_misses)
      .set({
        resolved_at: new Date(),
        resolved_by: req.user?.id ?? null,
        resolution: "dismissed",
      })
      .where(eq(legal_mentions_misses.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Demande introuvable" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/legal-mentions/missing/:id", async (req, res) => {
  try {
    await db.delete(legal_mentions_misses).where(eq(legal_mentions_misses.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Coûts IA ────────────────────────────────────────────────────────────────

// Diagnostic : la table ai_usage_events existe-t-elle, et a-t-elle toutes les
// colonnes attendues ? Utile quand la page « Coûts IA » reste à zéro alors que
// la console Mistral facture — typiquement migration non appliquée.
superAdminRouter.get("/ai-cost/healthcheck", async (_req, res) => {
  try {
    const rows = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage_events'`,
    );
    const cols = (rows as unknown as { column_name: string }[]).map((r) => r.column_name);
    const required = [
      "id", "dossier_id", "commune_id", "user_id", "purpose", "model",
      "input_tokens", "output_tokens", "cost_eur", "duration_ms", "created_at",
    ];
    const missing = required.filter((c) => !cols.includes(c));
    let totalEvents = 0;
    let lastEventAt: Date | null = null;
    if (cols.length > 0 && missing.length === 0) {
      const [row] = await db
        .select({ events: count(), last_event_at: sql<Date>`MAX(${ai_usage_events.created_at})` })
        .from(ai_usage_events);
      totalEvents = Number(row?.events ?? 0);
      lastEventAt = row?.last_event_at ?? null;
    }
    res.json({
      table_exists: cols.length > 0,
      columns_present: cols.sort(),
      missing_columns: missing,
      total_events: totalEvents,
      last_event_at: lastEventAt,
      ok: cols.length > 0 && missing.length === 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// Indicateur temps réel : compteur du jour + activité des 5 dernières minutes.
// Le frontend (sidebar admin) le poll toutes les 30 s pour afficher un pouls
// dès qu'un appel IA est passé.
superAdminRouter.get("/ai-cost/live", async (_req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    const [[today], [last5m]] = await Promise.all([
      db.select({
        events: count(),
        cost_eur: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)`,
        last_event_at: sql<Date>`MAX(${ai_usage_events.created_at})`,
      }).from(ai_usage_events).where(gte(ai_usage_events.created_at, todayStart)),
      db.select({
        events: count(),
        cost_eur: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)`,
      }).from(ai_usage_events).where(gte(ai_usage_events.created_at, fiveMinAgo)),
    ]);

    res.json({
      today_events: Number(today?.events ?? 0),
      today_cost_eur: Number(today?.cost_eur ?? 0),
      last_5min_events: Number(last5m?.events ?? 0),
      last_5min_cost_eur: Number(last5m?.cost_eur ?? 0),
      last_event_at: today?.last_event_at ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Alertes Slack sur les coûts IA ────────────────────────────────────────
// Récupère la config (la ligne singleton, créée par la migration).
superAdminRouter.get("/ai-cost/alerts", async (_req, res) => {
  try {
    const [row] = await db.select().from(ai_alert_config).where(eq(ai_alert_config.id, 1)).limit(1);
    res.json(row ?? {
      slack_webhook_url: null,
      per_call_threshold_eur: null,
      daily_threshold_eur: null,
      daily_last_notified_at: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Met à jour les seuils + le webhook. Les valeurs null désactivent l'alerte.
superAdminRouter.put("/ai-cost/alerts", async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      slack_webhook_url?: string | null;
      per_call_threshold_eur?: number | null;
      daily_threshold_eur?: number | null;
    };

    const webhook = body.slack_webhook_url?.trim() || null;
    if (webhook && !/^https:\/\/hooks\.slack\.com\//.test(webhook)) {
      return res.status(400).json({ error: "Le webhook doit pointer vers hooks.slack.com (https)." });
    }
    const perCall = body.per_call_threshold_eur;
    const daily = body.daily_threshold_eur;
    const nonNegNum = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    };

    await db.insert(ai_alert_config).values({
      id: 1,
      slack_webhook_url: webhook,
      per_call_threshold_eur: nonNegNum(perCall),
      daily_threshold_eur: nonNegNum(daily),
      updated_at: new Date(),
    }).onConflictDoUpdate({
      target: ai_alert_config.id,
      set: {
        slack_webhook_url: webhook,
        per_call_threshold_eur: nonNegNum(perCall),
        daily_threshold_eur: nonNegNum(daily),
        updated_at: new Date(),
      },
    });
    invalidateAiAlertConfigCache();

    const [row] = await db.select().from(ai_alert_config).where(eq(ai_alert_config.id, 1)).limit(1);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Envoie un message de test au webhook configuré.
superAdminRouter.post("/ai-cost/alerts/test", async (_req, res) => {
  try {
    const [cfg] = await db.select().from(ai_alert_config).where(eq(ai_alert_config.id, 1)).limit(1);
    if (!cfg?.slack_webhook_url) {
      return res.status(400).json({ error: "Aucun webhook Slack configuré." });
    }
    const ok = await sendTestNotification(cfg.slack_webhook_url);
    if (!ok) return res.status(502).json({ error: "Slack a rejeté le message — vérifier le webhook." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Grille tarifaire IA (éditable depuis l'onglet Coûts IA) ───────────────
// L'onglet affiche un coût ESTIMÉ : l'admin peut aligner la grille sur les
// tarifs publiés par Mistral (cf. https://mistral.ai/pricing/) sans
// redéploiement. Les anciens événements gardent leur cost_eur ; les nouveaux
// utilisent la grille à jour. Le tarif effectivement appliqué à chaque
// événement est gelé dans ai_usage_events.input_rate_eur_per_m / output_rate.
superAdminRouter.get("/ai-cost/pricing", async (_req, res) => {
  try {
    const rows = await db.select().from(ai_pricing).orderBy(asc(ai_pricing.kind), asc(ai_pricing.model));
    res.json(rows);
  } catch (err) {
    console.error("[ai-cost/pricing GET]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /admin/ai-cost/pricing/:model — upsert d'un tarif. Le body accepte
// input_eur_per_m, output_eur_per_m, kind ('chat'|'embedding'), note.
superAdminRouter.put("/ai-cost/pricing/:model", async (req, res) => {
  try {
    const model = req.params.model.trim();
    if (!model) return res.status(400).json({ error: "Modèle manquant" });
    const body = (req.body ?? {}) as {
      kind?: string;
      input_eur_per_m?: number;
      output_eur_per_m?: number;
      note?: string | null;
    };
    const nonNeg = (v: unknown): number => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error("Tarif invalide (doit être un nombre ≥ 0)");
      }
      return n;
    };
    const kind = body.kind === "embedding" ? "embedding" : "chat";
    const input = nonNeg(body.input_eur_per_m);
    const output = kind === "embedding" ? 0 : nonNeg(body.output_eur_per_m);
    const note = typeof body.note === "string" ? body.note.trim() || null : null;
    const user = (req as { user?: { id?: string } }).user;

    await db.insert(ai_pricing).values({
      model,
      kind,
      input_eur_per_m: input,
      output_eur_per_m: output,
      note,
      updated_by: user?.id ?? null,
      updated_at: new Date(),
    }).onConflictDoUpdate({
      target: ai_pricing.model,
      set: {
        kind,
        input_eur_per_m: input,
        output_eur_per_m: output,
        note,
        updated_by: user?.id ?? null,
        updated_at: new Date(),
      },
    });
    invalidatePricingCache();
    const [row] = await db.select().from(ai_pricing).where(eq(ai_pricing.model, model)).limit(1);
    res.json(row);
  } catch (err) {
    console.error("[ai-cost/pricing PUT]", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// DELETE /admin/ai-cost/pricing/:model — retire un modèle de la grille.
// Le fallback en dur dans aiUsage.ts reprend le relais s'il est encore connu.
superAdminRouter.delete("/ai-cost/pricing/:model", async (req, res) => {
  try {
    await db.delete(ai_pricing).where(eq(ai_pricing.model, req.params.model));
    invalidatePricingCache();
    res.json({ ok: true });
  } catch (err) {
    console.error("[ai-cost/pricing DELETE]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Filtre temporel : ?period=7d|30d|all (défaut 30d) OU ?from=YYYY-MM-DD&to=YYYY-MM-DD
// (les deux dates sont incluses ; to+1 jour côté requête pour borne stricte).
function aiUsagePeriodRange(req: { query: { period?: string; from?: string; to?: string } }): { from: Date | null; to: Date | null } {
  const fromStr = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const toStr = typeof req.query.to === "string" ? req.query.to.trim() : "";
  const parse = (s: string): Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  if (fromStr || toStr) {
    const from = fromStr ? parse(fromStr) : null;
    let to: Date | null = toStr ? parse(toStr) : null;
    if (to) {
      // Borne haute incluse : on prend la fin du jour.
      to = new Date(to);
      to.setDate(to.getDate() + 1);
    }
    return { from, to };
  }
  const p = String(req.query.period ?? "30d");
  if (p === "all") return { from: null, to: null };
  const days = p === "7d" ? 7 : 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return { from: d, to: null };
}

// Vue d'ensemble : total cumulé + répartition par usage / par modèle.
superAdminRouter.get("/ai-cost/summary", async (req, res) => {
  try {
    const range = aiUsagePeriodRange(req);
    const dateConds = [];
    if (range.from) dateConds.push(gte(ai_usage_events.created_at, range.from));
    if (range.to) dateConds.push(lt(ai_usage_events.created_at, range.to));
    const cond = dateConds.length > 0 ? and(...dateConds) : undefined;
    const [[totals], byPurpose, byModel] = await Promise.all([
      db.select({
        events: count(),
        cost_eur: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)`,
        input_tokens: sql<number>`COALESCE(SUM(${ai_usage_events.input_tokens}), 0)`,
        output_tokens: sql<number>`COALESCE(SUM(${ai_usage_events.output_tokens}), 0)`,
      }).from(ai_usage_events).where(cond as never),
      db.select({
        purpose: ai_usage_events.purpose,
        events: count(),
        cost_eur: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)`,
      }).from(ai_usage_events).where(cond as never).groupBy(ai_usage_events.purpose),
      db.select({
        model: ai_usage_events.model,
        events: count(),
        cost_eur: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)`,
      }).from(ai_usage_events).where(cond as never).groupBy(ai_usage_events.model),
    ]);

    res.json({
      period: String(req.query.period ?? "30d"),
      totals: {
        events: Number(totals?.events ?? 0),
        cost_eur: Number(totals?.cost_eur ?? 0),
        input_tokens: Number(totals?.input_tokens ?? 0),
        output_tokens: Number(totals?.output_tokens ?? 0),
      },
      by_purpose: byPurpose.map((r) => ({ purpose: r.purpose, events: Number(r.events), cost_eur: Number(r.cost_eur) })),
      by_model: byModel.map((r) => ({ model: r.model, events: Number(r.events), cost_eur: Number(r.cost_eur) })),
    });
  } catch (err) {
    console.error("[ai-cost/summary]", { query: req.query, err });
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// Top des dossiers par coût IA (avec n° de dossier et commune pour identifier).
superAdminRouter.get("/ai-cost/by-dossier", async (req, res) => {
  try {
    const range = aiUsagePeriodRange(req);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const conds = [isNotNull(ai_usage_events.dossier_id)];
    if (range.from) conds.push(gte(ai_usage_events.created_at, range.from));
    if (range.to) conds.push(lt(ai_usage_events.created_at, range.to));

    const rows = await db
      .select({
        dossier_id: ai_usage_events.dossier_id,
        numero: dossiers.numero,
        type: dossiers.type,
        commune: dossiers.commune,
        status: dossiers.status,
        events: count(),
        cost_eur: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)`,
        last_event_at: sql<Date>`MAX(${ai_usage_events.created_at})`,
      })
      .from(ai_usage_events)
      .leftJoin(dossiers, eq(ai_usage_events.dossier_id, dossiers.id))
      .where(and(...conds))
      .groupBy(ai_usage_events.dossier_id, dossiers.numero, dossiers.type, dossiers.commune, dossiers.status)
      .orderBy(desc(sql`SUM(${ai_usage_events.cost_eur})`))
      .limit(limit);

    res.json(rows.map((r) => ({
      dossier_id: r.dossier_id,
      numero: r.numero,
      type: r.type,
      commune: r.commune,
      status: r.status,
      events: Number(r.events),
      cost_eur: Number(r.cost_eur),
      last_event_at: r.last_event_at,
    })));
  } catch (err) {
    console.error("[ai-cost/by-dossier]", { query: req.query, err });
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// Top des communes par coût IA, toutes finalités confondues (PLU, structuration,
// dossiers déposés sur cette commune…).
superAdminRouter.get("/ai-cost/by-commune", async (req, res) => {
  try {
    const range = aiUsagePeriodRange(req);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const conds = [isNotNull(ai_usage_events.commune_id)];
    if (range.from) conds.push(gte(ai_usage_events.created_at, range.from));
    if (range.to) conds.push(lt(ai_usage_events.created_at, range.to));

    const rows = await db
      .select({
        commune_id: ai_usage_events.commune_id,
        commune_name: communes.name,
        insee_code: communes.insee_code,
        events: count(),
        cost_eur: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)`,
        last_event_at: sql<Date>`MAX(${ai_usage_events.created_at})`,
      })
      .from(ai_usage_events)
      .leftJoin(communes, eq(ai_usage_events.commune_id, communes.id))
      .where(and(...conds))
      .groupBy(ai_usage_events.commune_id, communes.name, communes.insee_code)
      .orderBy(desc(sql`SUM(${ai_usage_events.cost_eur})`))
      .limit(limit);

    res.json(rows.map((r) => ({
      commune_id: r.commune_id,
      commune_name: r.commune_name,
      insee_code: r.insee_code,
      events: Number(r.events),
      cost_eur: Number(r.cost_eur),
      last_event_at: r.last_event_at,
    })));
  } catch (err) {
    console.error("[ai-cost/by-commune]", { query: req.query, err });
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// Détail d'une commune : répartition par usage et journal des 200 derniers
// appels imputés à cette commune.
superAdminRouter.get("/ai-cost/commune/:id", async (req, res) => {
  try {
    const communeId = req.params.id;
    const [comm, byPurpose, events] = await Promise.all([
      db.select({ id: communes.id, name: communes.name, insee_code: communes.insee_code })
        .from(communes).where(eq(communes.id, communeId)).limit(1),
      db.select({
        purpose: ai_usage_events.purpose,
        model: ai_usage_events.model,
        events: count(),
        cost_eur: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)`,
        input_tokens: sql<number>`COALESCE(SUM(${ai_usage_events.input_tokens}), 0)`,
        output_tokens: sql<number>`COALESCE(SUM(${ai_usage_events.output_tokens}), 0)`,
      }).from(ai_usage_events)
        .where(eq(ai_usage_events.commune_id, communeId))
        .groupBy(ai_usage_events.purpose, ai_usage_events.model),
      db.select().from(ai_usage_events)
        .where(eq(ai_usage_events.commune_id, communeId))
        .orderBy(desc(ai_usage_events.created_at))
        .limit(200),
    ]);

    res.json({
      commune: comm[0] ?? null,
      by_purpose: byPurpose.map((r) => ({
        purpose: r.purpose,
        model: r.model,
        events: Number(r.events),
        cost_eur: Number(r.cost_eur),
        input_tokens: Number(r.input_tokens),
        output_tokens: Number(r.output_tokens),
      })),
      events,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Détail d'un dossier : tous ses événements IA, regroupés par usage.
superAdminRouter.get("/ai-cost/dossier/:id", async (req, res) => {
  try {
    const dossierId = req.params.id;
    const [byPurpose, events] = await Promise.all([
      db.select({
        purpose: ai_usage_events.purpose,
        model: ai_usage_events.model,
        events: count(),
        cost_eur: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)`,
        input_tokens: sql<number>`COALESCE(SUM(${ai_usage_events.input_tokens}), 0)`,
        output_tokens: sql<number>`COALESCE(SUM(${ai_usage_events.output_tokens}), 0)`,
      }).from(ai_usage_events)
        .where(eq(ai_usage_events.dossier_id, dossierId))
        .groupBy(ai_usage_events.purpose, ai_usage_events.model),
      db.select().from(ai_usage_events)
        .where(eq(ai_usage_events.dossier_id, dossierId))
        .orderBy(desc(ai_usage_events.created_at))
        .limit(200),
    ]);

    res.json({
      by_purpose: byPurpose.map((r) => ({
        purpose: r.purpose,
        model: r.model,
        events: Number(r.events),
        cost_eur: Number(r.cost_eur),
        input_tokens: Number(r.input_tokens),
        output_tokens: Number(r.output_tokens),
      })),
      events,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Facturation / mini compte de résultat
// ════════════════════════════════════════════════════════════════════════════
// Trois ressources CRUD (catalogue de prestations, lignes facturées par
// collectivité, charges saisies) + trois vues d'agrégation (clients facturables,
// compte de résultat, CA par client). Toute l'arithmétique vit dans
// services/billing.ts (pure + testée) — ici on ne fait que charger/écrire.

const BILLING_CYCLES = ["one_shot", "monthly", "quarterly", "yearly", "usage"];
const COST_RECURRENCES = ["one_shot", "monthly", "quarterly", "yearly"];

function bnum(v: unknown, def = 0): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : def;
}
function bstr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
// Normalise une date "YYYY-MM-DD" ; renvoie null si invalide. `fallbackToday`
// renvoie la date du jour quand l'entrée est vide.
function bdate(v: unknown, fallbackToday = false): string | null {
  const s = bstr(v);
  if (!s) return fallbackToday ? new Date().toISOString().slice(0, 10) : null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
// Entier nullable : "" / absent → null, sinon entier (chiffres only).
function bint(v: unknown): number | null {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  const n = typeof v === "string" ? parseInt(v.replace(/[^\d-]/g, ""), 10) : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
// Id de l'utilisateur courant. Cast local : req.user est posé par requireAuth
// mais n'est pas typé sur Request dans ce routeur (cf. handlers `req: any`).
function actorId(req: AuthRequest): string | null {
  return req.user?.id ?? null;
}
function billingPeriod(req: { query: Record<string, unknown> }): Period {
  const preset = bstr(req.query.period) || "year";
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  return resolvePeriod(preset, new Date(), from, to);
}

// ─── Catalogue de prestations ────────────────────────────────────────────────
superAdminRouter.get("/billing/prestations", async (_req, res) => {
  try {
    const rows = await db.select().from(billing_prestations)
      .orderBy(asc(billing_prestations.sort_order), asc(billing_prestations.label));
    res.json(rows);
  } catch (err) {
    console.error("[billing/prestations GET]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.post("/billing/prestations", async (req, res) => {
  try {
    const code = bstr(req.body?.code);
    const label = bstr(req.body?.label);
    if (!code || !label) return res.status(400).json({ error: "Code et libellé requis." });
    const cycle = bstr(req.body?.billing_cycle) || "one_shot";
    if (!BILLING_CYCLES.includes(cycle)) return res.status(400).json({ error: "Cycle de facturation invalide." });
    const [row] = await db.insert(billing_prestations).values({
      code,
      label,
      description: bstr(req.body?.description) || null,
      default_unit_price_eur: bnum(req.body?.default_unit_price_eur),
      unit: bstr(req.body?.unit) || "forfait",
      default_vat_rate: bnum(req.body?.default_vat_rate, 20),
      billing_cycle: cycle,
      active: req.body?.active !== false,
      sort_order: Math.trunc(bnum(req.body?.sort_order)),
      updated_by: actorId(req),
    }).returning();
    await logAudit(req, "admin_billing_prestation_created", { metadata: { code } });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error && /unique|duplicate/i.test(err.message)
      ? "Ce code de prestation existe déjà." : "Erreur serveur";
    console.error("[billing/prestations POST]", err);
    res.status(/existe déjà/.test(msg) ? 409 : 500).json({ error: msg });
  }
});

superAdminRouter.put("/billing/prestations/:id", async (req, res) => {
  try {
    const cycle = bstr(req.body?.billing_cycle) || "one_shot";
    if (!BILLING_CYCLES.includes(cycle)) return res.status(400).json({ error: "Cycle de facturation invalide." });
    const label = bstr(req.body?.label);
    if (!label) return res.status(400).json({ error: "Libellé requis." });
    const [existing] = await db.select({ plan_id: billing_prestations.plan_id }).from(billing_prestations).where(eq(billing_prestations.id, req.params.id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Prestation introuvable." });
    if (existing.plan_id) return res.status(400).json({ error: "Prestation générée par la grille tarifaire — modifie le plan correspondant." });
    const [row] = await db.update(billing_prestations).set({
      label,
      description: bstr(req.body?.description) || null,
      default_unit_price_eur: bnum(req.body?.default_unit_price_eur),
      unit: bstr(req.body?.unit) || "forfait",
      default_vat_rate: bnum(req.body?.default_vat_rate, 20),
      billing_cycle: cycle,
      active: req.body?.active !== false,
      sort_order: Math.trunc(bnum(req.body?.sort_order)),
      updated_by: actorId(req),
      updated_at: new Date(),
    }).where(eq(billing_prestations.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Prestation introuvable." });
    await logAudit(req, "admin_billing_prestation_updated", { metadata: { id: req.params.id } });
    res.json(row);
  } catch (err) {
    console.error("[billing/prestations PUT]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/billing/prestations/:id", async (req, res) => {
  try {
    const [existing] = await db.select({ plan_id: billing_prestations.plan_id }).from(billing_prestations).where(eq(billing_prestations.id, req.params.id)).limit(1);
    if (existing?.plan_id) return res.status(400).json({ error: "Prestation générée par la grille tarifaire — supprime ou désactive le plan correspondant." });
    const [row] = await db.delete(billing_prestations).where(eq(billing_prestations.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Prestation introuvable." });
    await logAudit(req, "admin_billing_prestation_deleted", { metadata: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    console.error("[billing/prestations DELETE]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Lignes facturées (par collectivité) ─────────────────────────────────────
// Sélection enrichie du nom de la cible (commune OU EPCI) pour l'affichage.
const billingItemSelect = {
  id: billing_items.id,
  prestation_id: billing_items.prestation_id,
  plan_id: billing_items.plan_id,
  commune_id: billing_items.commune_id,
  epci_id: billing_items.epci_id,
  label: billing_items.label,
  quantity: billing_items.quantity,
  unit_price_eur: billing_items.unit_price_eur,
  vat_rate: billing_items.vat_rate,
  billing_cycle: billing_items.billing_cycle,
  start_date: billing_items.start_date,
  end_date: billing_items.end_date,
  status: billing_items.status,
  note: billing_items.note,
  created_at: billing_items.created_at,
  commune_name: communes.name,
  commune_insee: communes.insee_code,
  epci_name: epci.name,
};

function decorateItem<T extends { commune_id: string | null; epci_id: string | null; commune_name: string | null; epci_name: string | null }>(r: T) {
  return {
    ...r,
    client_type: r.commune_id ? "commune" : "epci",
    client_id: r.commune_id ?? r.epci_id,
    client_name: r.commune_name ?? r.epci_name ?? "—",
  };
}

superAdminRouter.get("/billing/items", async (req, res) => {
  try {
    const conds = [];
    const communeId = bstr(req.query.commune_id);
    const epciId = bstr(req.query.epci_id);
    if (communeId) conds.push(eq(billing_items.commune_id, communeId));
    if (epciId) conds.push(eq(billing_items.epci_id, epciId));
    const rows = await db.select(billingItemSelect).from(billing_items)
      .leftJoin(communes, eq(billing_items.commune_id, communes.id))
      .leftJoin(epci, eq(billing_items.epci_id, epci.id))
      .where(conds.length ? or(...conds) : undefined as never)
      .orderBy(desc(billing_items.created_at));
    res.json(rows.map(decorateItem));
  } catch (err) {
    console.error("[billing/items GET]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Valide + normalise un body de ligne facturée. Renvoie {error} ou {values}.
// `created_by` est posé par l'appelant (POST uniquement) pour ne pas l'écraser
// lors d'un PUT.
function parseItemBody(body: Record<string, unknown>): { error: string } | { values: typeof billing_items.$inferInsert } {
  const communeId = bstr(body.commune_id) || null;
  const epciId = bstr(body.epci_id) || null;
  if ((communeId && epciId) || (!communeId && !epciId)) {
    return { error: "Renseigner exactement une cible : une commune OU un EPCI." };
  }
  const label = bstr(body.label);
  if (!label) return { error: "Libellé requis." };
  const cycle = bstr(body.billing_cycle) || "one_shot";
  if (!BILLING_CYCLES.includes(cycle)) return { error: "Cycle de facturation invalide." };
  const start = bdate(body.start_date, true);
  if (!start) return { error: "Date de début invalide (format AAAA-MM-JJ)." };
  const end = bdate(body.end_date);
  if (bstr(body.end_date) && !end) return { error: "Date de fin invalide (format AAAA-MM-JJ)." };
  const status = bstr(body.status) || "active";
  if (!["active", "cancelled"].includes(status)) return { error: "Statut invalide." };
  return {
    values: {
      prestation_id: bstr(body.prestation_id) || null,
      plan_id: bstr(body.plan_id) || null,
      commune_id: communeId,
      epci_id: epciId,
      label,
      quantity: bnum(body.quantity, 1),
      unit_price_eur: bnum(body.unit_price_eur),
      vat_rate: bnum(body.vat_rate, 20),
      billing_cycle: cycle,
      start_date: start,
      end_date: end,
      status,
      note: bstr(body.note) || null,
    },
  };
}

superAdminRouter.post("/billing/items", async (req, res) => {
  try {
    const parsed = parseItemBody(req.body ?? {});
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    const [inserted] = await db.insert(billing_items)
      .values({ ...parsed.values, created_by: actorId(req) })
      .returning({ id: billing_items.id });
    const [row] = await db.select(billingItemSelect).from(billing_items)
      .leftJoin(communes, eq(billing_items.commune_id, communes.id))
      .leftJoin(epci, eq(billing_items.epci_id, epci.id))
      .where(eq(billing_items.id, inserted!.id));
    await logAudit(req, "admin_billing_item_created", { metadata: { id: inserted!.id, label: parsed.values.label } });
    res.status(201).json(decorateItem(row!));
  } catch (err) {
    console.error("[billing/items POST]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.put("/billing/items/:id", async (req, res) => {
  try {
    const parsed = parseItemBody(req.body ?? {});
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    const [updated] = await db.update(billing_items)
      .set({ ...parsed.values, updated_at: new Date() })
      .where(eq(billing_items.id, req.params.id)).returning({ id: billing_items.id });
    if (!updated) return res.status(404).json({ error: "Ligne introuvable." });
    const [row] = await db.select(billingItemSelect).from(billing_items)
      .leftJoin(communes, eq(billing_items.commune_id, communes.id))
      .leftJoin(epci, eq(billing_items.epci_id, epci.id))
      .where(eq(billing_items.id, req.params.id));
    await logAudit(req, "admin_billing_item_updated", { metadata: { id: req.params.id } });
    res.json(decorateItem(row!));
  } catch (err) {
    console.error("[billing/items PUT]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/billing/items/:id", async (req, res) => {
  try {
    const [row] = await db.delete(billing_items).where(eq(billing_items.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Ligne introuvable." });
    await logAudit(req, "admin_billing_item_deleted", { metadata: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    console.error("[billing/items DELETE]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Charges saisies ─────────────────────────────────────────────────────────
superAdminRouter.get("/billing/costs", async (_req, res) => {
  try {
    const rows = await db.select().from(billing_costs).orderBy(desc(billing_costs.incurred_on));
    res.json(rows);
  } catch (err) {
    console.error("[billing/costs GET]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

function parseCostBody(body: Record<string, unknown>): { error: string } | { values: typeof billing_costs.$inferInsert } {
  const label = bstr(body.label);
  if (!label) return { error: "Libellé requis." };
  const recurrence = bstr(body.recurrence) || "one_shot";
  if (!COST_RECURRENCES.includes(recurrence)) return { error: "Récurrence invalide." };
  const incurred = bdate(body.incurred_on, true);
  if (!incurred) return { error: "Date invalide (format AAAA-MM-JJ)." };
  const end = bdate(body.end_date);
  if (bstr(body.end_date) && !end) return { error: "Date de fin invalide (format AAAA-MM-JJ)." };
  return {
    values: {
      category: bstr(body.category) || "autre",
      label,
      amount_eur: bnum(body.amount_eur),
      vat_rate: bnum(body.vat_rate, 0),
      recurrence,
      incurred_on: incurred,
      end_date: end,
      note: bstr(body.note) || null,
    },
  };
}

superAdminRouter.post("/billing/costs", async (req, res) => {
  try {
    const parsed = parseCostBody(req.body ?? {});
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    const [row] = await db.insert(billing_costs)
      .values({ ...parsed.values, created_by: actorId(req) })
      .returning();
    await logAudit(req, "admin_billing_cost_created", { metadata: { label: parsed.values.label } });
    res.status(201).json(row);
  } catch (err) {
    console.error("[billing/costs POST]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.put("/billing/costs/:id", async (req, res) => {
  try {
    const parsed = parseCostBody(req.body ?? {});
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    const [row] = await db.update(billing_costs)
      .set({ ...parsed.values, updated_at: new Date() })
      .where(eq(billing_costs.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Charge introuvable." });
    await logAudit(req, "admin_billing_cost_updated", { metadata: { id: req.params.id } });
    res.json(row);
  } catch (err) {
    console.error("[billing/costs PUT]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/billing/costs/:id", async (req, res) => {
  try {
    const [row] = await db.delete(billing_costs).where(eq(billing_costs.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Charge introuvable." });
    await logAudit(req, "admin_billing_cost_deleted", { metadata: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    console.error("[billing/costs DELETE]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Clients facturables (communes + EPCI) pour les menus déroulants ──────────
superAdminRouter.get("/billing/clients", async (_req, res) => {
  try {
    const [comm, grp] = await Promise.all([
      db.select({ id: communes.id, name: communes.name, ref: communes.insee_code, population: communes.population }).from(communes).orderBy(asc(communes.name)),
      db.select({ id: epci.id, name: epci.name, ref: epci.siren, type: epci.type }).from(epci).orderBy(asc(epci.name)),
    ]);
    res.json({
      communes: comm.map((c) => ({ type: "commune", id: c.id, name: c.name, ref: c.ref, population: parsePopulation(c.population) })),
      epci: grp.map((e) => ({ type: "epci", id: e.id, name: e.name, ref: e.ref, epci_type: e.type })),
    });
  } catch (err) {
    console.error("[billing/clients GET]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Grille tarifaire (plans par palier de population) ───────────────────────
const PLAN_APPLIES = ["commune", "epci"];

function parsePlanBody(body: Record<string, unknown>): { error: string } | { values: typeof billing_plans.$inferInsert } {
  const code = bstr(body.code);
  const name = bstr(body.name);
  if (!code || !name) return { error: "Code et nom requis." };
  const applies = bstr(body.applies_to) || "commune";
  if (!PLAN_APPLIES.includes(applies)) return { error: "Cible invalide (commune ou epci)." };
  const popMin = bint(body.pop_min);
  const popMax = bint(body.pop_max);
  if (popMin != null && popMax != null && popMin > popMax) return { error: "Population min. supérieure à la population max." };
  return {
    values: {
      code, name,
      target_label: bstr(body.target_label) || null,
      pop_min: popMin,
      pop_max: popMax,
      applies_to: applies,
      monthly_price_eur: bnum(body.monthly_price_eur),
      annual_price_eur: bnum(body.annual_price_eur),
      onboarding_initial_eur: bnum(body.onboarding_initial_eur),
      onboarding_intermediate_eur: bnum(body.onboarding_intermediate_eur),
      dossiers_per_month: bint(body.dossiers_per_month),
      agents_included: bint(body.agents_included),
      support_level: bstr(body.support_level) || null,
      vat_rate: bnum(body.vat_rate, 20),
      active: body.active !== false,
      sort_order: Math.trunc(bnum(body.sort_order)),
    },
  };
}

// Composants facturables d'un plan, reflétés dans le catalogue (abonnement +
// onboarding). Servent à la génération/maj des prestations dérivées.
const PLAN_COMPONENTS: { key: string; label: string; unit: string; cycle: string; price: (p: typeof billing_plans.$inferSelect) => number; ord: number }[] = [
  { key: "abo_annuel",  label: "Abonnement annuel",        unit: "an",      cycle: "yearly",   price: (p) => p.annual_price_eur,           ord: 1 },
  { key: "abo_mensuel", label: "Abonnement mensuel",       unit: "mois",    cycle: "monthly",  price: (p) => p.monthly_price_eur,          ord: 2 },
  { key: "onb_initial", label: "Onboarding initial",       unit: "forfait", cycle: "one_shot", price: (p) => p.onboarding_initial_eur,      ord: 3 },
  { key: "onb_interm",  label: "Onboarding intermédiaire", unit: "forfait", cycle: "one_shot", price: (p) => p.onboarding_intermediate_eur, ord: 4 },
];

// Génère / met à jour (upsert par code déterministe) les prestations catalogue
// dérivées d'un plan. Appelée après chaque création/édition de plan.
async function syncPlanPrestations(plan: typeof billing_plans.$inferSelect): Promise<void> {
  for (const c of PLAN_COMPONENTS) {
    const shared = {
      label: `${plan.name} — ${c.label}`,
      default_unit_price_eur: c.price(plan),
      unit: c.unit,
      default_vat_rate: plan.vat_rate,
      billing_cycle: c.cycle,
      active: plan.active,
      sort_order: plan.sort_order * 10 + c.ord,
      plan_id: plan.id,
      plan_component: c.key,
    };
    await db.insert(billing_prestations)
      .values({ code: `plan_${plan.code}_${c.key}`, description: "Généré depuis la grille tarifaire", ...shared })
      .onConflictDoUpdate({ target: billing_prestations.code, set: { ...shared, updated_at: new Date() } });
  }
}

superAdminRouter.get("/billing/plans", async (_req, res) => {
  try {
    const rows = await db.select().from(billing_plans)
      .orderBy(asc(billing_plans.sort_order), asc(billing_plans.name));
    res.json(rows);
  } catch (err) {
    console.error("[billing/plans GET]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Rattachement automatique d'un client à son plan (par population pour une
// commune, palier EPCI pour un groupement). Le front l'utilise pour pré-remplir
// le prix d'une ligne facturée — l'admin garde la main pour modifier.
superAdminRouter.get("/billing/plans/resolve", async (req, res) => {
  try {
    const communeId = bstr(req.query.commune_id);
    const epciId = bstr(req.query.epci_id);
    const plans = await db.select().from(billing_plans);
    if (epciId) {
      return res.json({ client_type: "epci", population: null, plan: matchPlanForEpci(plans) });
    }
    if (communeId) {
      const [c] = await db.select({ population: communes.population })
        .from(communes).where(eq(communes.id, communeId)).limit(1);
      const population = parsePopulation(c?.population ?? null);
      return res.json({ client_type: "commune", population, plan: matchPlanForPopulation(plans, population) });
    }
    res.status(400).json({ error: "commune_id ou epci_id requis." });
  } catch (err) {
    console.error("[billing/plans/resolve]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.post("/billing/plans", async (req, res) => {
  try {
    const parsed = parsePlanBody(req.body ?? {});
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    const [row] = await db.insert(billing_plans)
      .values({ ...parsed.values, updated_by: actorId(req) }).returning();
    if (row) await syncPlanPrestations(row);
    await logAudit(req, "admin_billing_plan_created", { metadata: { code: parsed.values.code } });
    res.status(201).json(row);
  } catch (err) {
    const dup = err instanceof Error && /unique|duplicate/i.test(err.message);
    console.error("[billing/plans POST]", err);
    res.status(dup ? 409 : 500).json({ error: dup ? "Ce code de plan existe déjà." : "Erreur serveur" });
  }
});

// Régénère toutes les prestations catalogue depuis les plans (idempotent).
// Filet de sécurité si la génération de migration n'a pas tourné, ou après un
// changement groupé de tarifs.
superAdminRouter.post("/billing/plans/sync-catalogue", async (req, res) => {
  try {
    const plans = await db.select().from(billing_plans);
    for (const p of plans) await syncPlanPrestations(p);
    await logAudit(req, "admin_billing_catalogue_synced", { metadata: { plans: plans.length } });
    res.json({ plans: plans.length, prestations: plans.length * PLAN_COMPONENTS.length });
  } catch (err) {
    console.error("[billing/plans/sync-catalogue]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.put("/billing/plans/:id", async (req, res) => {
  try {
    const parsed = parsePlanBody(req.body ?? {});
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    const [row] = await db.update(billing_plans)
      .set({ ...parsed.values, updated_by: actorId(req), updated_at: new Date() })
      .where(eq(billing_plans.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Plan introuvable." });
    await syncPlanPrestations(row);
    await logAudit(req, "admin_billing_plan_updated", { metadata: { id: req.params.id } });
    res.json(row);
  } catch (err) {
    const dup = err instanceof Error && /unique|duplicate/i.test(err.message);
    console.error("[billing/plans PUT]", err);
    res.status(dup ? 409 : 500).json({ error: dup ? "Ce code de plan existe déjà." : "Erreur serveur" });
  }
});

superAdminRouter.delete("/billing/plans/:id", async (req, res) => {
  try {
    const [row] = await db.delete(billing_plans).where(eq(billing_plans.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Plan introuvable." });
    await logAudit(req, "admin_billing_plan_deleted", { metadata: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    console.error("[billing/plans DELETE]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Charge toutes les lignes facturées au format attendu par le moteur de calcul.
async function loadRevenueLines(): Promise<(RevenueLine & { commune_id: string | null; epci_id: string | null; commune_name: string | null; epci_name: string | null })[]> {
  return db.select({
    quantity: billing_items.quantity,
    unit_price_eur: billing_items.unit_price_eur,
    vat_rate: billing_items.vat_rate,
    billing_cycle: billing_items.billing_cycle,
    start_date: billing_items.start_date,
    end_date: billing_items.end_date,
    status: billing_items.status,
    commune_id: billing_items.commune_id,
    epci_id: billing_items.epci_id,
    commune_name: communes.name,
    epci_name: epci.name,
  }).from(billing_items)
    .leftJoin(communes, eq(billing_items.commune_id, communes.id))
    .leftJoin(epci, eq(billing_items.epci_id, epci.id));
}

// ─── Compte de résultat (vue d'ensemble agrégée) ─────────────────────────────
superAdminRouter.get("/billing/summary", async (req, res) => {
  try {
    const period = billingPeriod(req);
    const now = new Date();
    const [items, costs] = await Promise.all([loadRevenueLines(), db.select().from(billing_costs)]);

    const revenue = summarizeRevenue(items, period, now);
    const manual = summarizeCosts(costs as CostLine[], period, now);

    // Coûts IA déjà tracés : SUM sur la même fenêtre temporelle.
    const aiConds = [];
    if (period.from) aiConds.push(gte(ai_usage_events.created_at, period.from));
    if (period.to) {
      const toExcl = new Date(period.to);
      toExcl.setDate(toExcl.getDate() + 1); // borne haute incluse (fin de journée)
      aiConds.push(lt(ai_usage_events.created_at, toExcl));
    }
    const [aiAgg] = await db.select({ cost: sql<number>`COALESCE(SUM(${ai_usage_events.cost_eur}), 0)` })
      .from(ai_usage_events).where(aiConds.length ? and(...aiConds) : undefined as never);
    const ai_eur = round2(Number(aiAgg?.cost ?? 0));

    const charges_total_ht = round2(ai_eur + manual.total_ht);
    const net_ht = round2(revenue.total_ht - charges_total_ht);
    const margin_pct = revenue.total_ht > 0 ? round2((net_ht / revenue.total_ht) * 100) : 0;

    // Répartition des produits par cycle de facturation.
    const cycleMap = new Map<string, { ht: number; count: number }>();
    for (const it of items) {
      const ht = recognizedRevenueHt(it, period, now);
      if (!ht) continue;
      const cur = cycleMap.get(it.billing_cycle) ?? { ht: 0, count: 0 };
      cur.ht += ht; cur.count += 1;
      cycleMap.set(it.billing_cycle, cur);
    }

    // Répartition des charges par catégorie (IA = catégorie synthétique).
    const catMap = new Map<string, number>();
    if (ai_eur > 0) catMap.set("ia", ai_eur);
    for (const c of costs as CostLine[]) {
      const ht = recognizedCostHt(c, period, now);
      if (!ht) continue;
      const key = (c as { category?: string }).category ?? "autre";
      catMap.set(key, (catMap.get(key) ?? 0) + ht);
    }

    // Comptage clients facturés actifs + lignes actives.
    const activeClients = new Set<string>();
    let activeLines = 0;
    for (const it of items) {
      if ((it.status ?? "active") === "active") {
        activeLines += 1;
        const cid = it.commune_id ?? it.epci_id;
        if (cid) activeClients.add(cid);
      }
    }

    res.json({
      period: { preset: bstr(req.query.period) || "year", from: period.from?.toISOString().slice(0, 10) ?? null, to: period.to?.toISOString().slice(0, 10) ?? null },
      revenue,
      charges: {
        ai_eur,
        manual_ht: manual.total_ht,
        manual_vat_deductible: manual.vat_deductible,
        total_ht: charges_total_ht,
      },
      result: { net_ht, margin_pct },
      vat: {
        collected: revenue.vat_collected,
        deductible: manual.vat_deductible,
        net: round2(revenue.vat_collected - manual.vat_deductible),
      },
      revenue_by_cycle: [...cycleMap.entries()]
        .map(([cycle, v]) => ({ cycle, ht: round2(v.ht), count: v.count }))
        .sort((a, b) => b.ht - a.ht),
      charges_by_category: [...catMap.entries()]
        .map(([category, ht]) => ({ category, ht: round2(ht) }))
        .sort((a, b) => b.ht - a.ht),
      counts: { active_clients: activeClients.size, active_lines: activeLines },
    });
  } catch (err) {
    console.error("[billing/summary]", { query: req.query, err });
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// ─── CA par client (commune / EPCI) ──────────────────────────────────────────
superAdminRouter.get("/billing/by-client", async (req, res) => {
  try {
    const period = billingPeriod(req);
    const now = new Date();
    const items = await loadRevenueLines();

    type Agg = { client_type: string; client_id: string; client_name: string; recognized_ht: number; vat: number; mrr: number; lines: number };
    const map = new Map<string, Agg>();
    for (const it of items) {
      const clientId = it.commune_id ?? it.epci_id;
      if (!clientId) continue;
      const key = `${it.commune_id ? "commune" : "epci"}:${clientId}`;
      const agg = map.get(key) ?? {
        client_type: it.commune_id ? "commune" : "epci",
        client_id: clientId,
        client_name: it.commune_name ?? it.epci_name ?? "—",
        recognized_ht: 0, vat: 0, mrr: 0, lines: 0,
      };
      const ht = recognizedRevenueHt(it, period, now);
      agg.recognized_ht += ht;
      agg.vat += ht * ((it.vat_rate ?? 0) / 100);
      agg.mrr += computeMrr([it], now);
      agg.lines += 1;
      map.set(key, agg);
    }

    const rows = [...map.values()]
      .map((a) => ({
        client_type: a.client_type,
        client_id: a.client_id,
        client_name: a.client_name,
        recognized_ht: round2(a.recognized_ht),
        vat: round2(a.vat),
        recognized_ttc: round2(a.recognized_ht + a.vat),
        mrr: round2(a.mrr),
        arr: round2(a.mrr * 12),
        lines: a.lines,
      }))
      .sort((a, b) => b.recognized_ht - a.recognized_ht);

    res.json(rows);
  } catch (err) {
    console.error("[billing/by-client]", { query: req.query, err });
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});
