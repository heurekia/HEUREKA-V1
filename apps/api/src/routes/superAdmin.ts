import { Router } from "express";
import { db } from "../db.js";
import { communes, epci, users, dossiers } from "@heureka-v1/db";
import { eq, sql, count, desc, and, isNull, isNotNull, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, requireRole } from "../middlewares/auth.js";

export const superAdminRouter = Router();

// All routes require authentication + admin role
superAdminRouter.use(requireAuth);
superAdminRouter.use(requireRole("admin"));

// ─── Dashboard ───────────────────────────────────────────────────────────────
superAdminRouter.get("/dashboard", async (_req, res) => {
  try {
    const [communeCount] = await db.select({ count: count() }).from(communes);
    const [agentCount] = await db
      .select({ count: count() })
      .from(users)
      .where(sql`role IN ('mairie', 'instructeur', 'admin') AND commune IS NOT NULL`);
    const [dossierCount] = await db
      .select({ count: count() })
      .from(dossiers)
      .where(sql`status NOT IN ('accepte', 'refuse', 'brouillon')`);
    const [epciCount] = await db.select({ count: count() }).from(epci);

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

// ─── Communes ────────────────────────────────────────────────────────────────
superAdminRouter.get("/communes", async (_req, res) => {
  try {
    const rows = await db
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
      .orderBy(communes.name);

    // Get user counts per commune
    const userCounts = await db
      .select({
        commune: users.commune,
        user_count: count(),
      })
      .from(users)
      .where(sql`role IN ('mairie', 'instructeur')`)
      .groupBy(users.commune);

    const userCountMap: Record<string, number> = {};
    for (const uc of userCounts) {
      if (uc.commune) userCountMap[uc.commune] = Number(uc.user_count);
    }

    // Get dossier counts per commune
    const dossierCounts = await db
      .select({
        commune: dossiers.commune,
        dossier_count: count(),
      })
      .from(dossiers)
      .groupBy(dossiers.commune);

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

    const [newCommune] = await db
      .insert(communes)
      .values({ name, insee_code, zip_code, email, telephone, logo_url, population, surface, departement, region, description, epci_id, instruction_mutualisee: false })
      .returning();

    res.status(201).json(newCommune);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.patch("/communes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body as Partial<{
      name: string;
      insee_code: string;
      zip_code: string;
      email: string;
      telephone: string;
      logo_url: string;
      population: string;
      surface: string;
      departement: string;
      region: string;
      description: string;
      epci_id: string | null;
      instruction_mutualisee: boolean;
    }>;

    const [updated] = await db
      .update(communes)
      .set({ ...fields, updated_at: new Date() })
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

    const result = epciList.map((e) => ({
      ...e,
      communes: communeList
        .filter((c) => c.epci_id === e.id)
        .map((c) => ({ id: c.id, name: c.name })),
    }));

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
    const fields = req.body as Partial<{
      name: string;
      siren: string;
      type: string;
      departement: string;
      region: string;
      logo_url: string;
    }>;

    const [updated] = await db
      .update(epci)
      .set({ ...fields, updated_at: new Date() })
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

// ─── Users ────────────────────────────────────────────────────────────────────
superAdminRouter.get("/users", async (req, res) => {
  try {
    const { commune, role } = req.query as { commune?: string; role?: string };

    const conditions = [];
    if (commune) conditions.push(eq(users.commune, commune));
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
        created_at: users.created_at,
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
    const { email, prenom, nom, role, commune, telephone } = req.body as {
      email?: string;
      prenom?: string;
      nom?: string;
      role?: string;
      commune?: string;
      telephone?: string;
    };

    if (!email || !prenom || !nom || !role) {
      return res.status(400).json({ error: "email, prenom, nom et role sont requis" });
    }

    const tempPassword = "Heureka2024!";
    const password_hash = await bcrypt.hash(tempPassword, 10);

    const [newUser] = await db
      .insert(users)
      .values({
        email,
        prenom,
        nom,
        role: role as "citoyen" | "mairie" | "instructeur" | "admin",
        commune,
        telephone,
        password_hash,
      })
      .returning();

    res.status(201).json({ ...newUser, tempPassword });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.patch("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { role, prenom, nom, commune, telephone } = req.body as Partial<{
      role: "citoyen" | "mairie" | "instructeur" | "admin";
      prenom: string;
      nom: string;
      commune: string | null;
      telephone: string;
    }>;

    const [updated] = await db
      .update(users)
      .set({ role, prenom, nom, commune, telephone, updated_at: new Date() })
      .where(eq(users.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(users).where(eq(users.id, id));
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
