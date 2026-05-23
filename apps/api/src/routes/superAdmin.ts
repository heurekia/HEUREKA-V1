import { Router } from "express";
import { db } from "../db.js";
import { communes, epci, users, dossiers, role_permissions, external_services, service_communes } from "@heureka-v1/db";
import { eq, sql, count, desc, and, isNull, isNotNull, ilike, asc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, requireRole } from "../middlewares/auth.js";

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
        role_config_id: users.role_config_id,
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
    const { email, prenom, nom, role, commune, telephone, role_config_id } = req.body as {
      email?: string;
      prenom?: string;
      nom?: string;
      role?: string;
      commune?: string;
      telephone?: string;
      role_config_id?: string;
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
        role_config_id: role_config_id ?? null,
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
    const { role, prenom, nom, commune, telephone, role_config_id } = req.body as Partial<{
      role: "citoyen" | "mairie" | "instructeur" | "admin";
      prenom: string;
      nom: string;
      commune: string | null;
      telephone: string;
      role_config_id: string | null;
    }>;

    const [updated] = await db
      .update(users)
      .set({ role, prenom, nom, commune, telephone, role_config_id, updated_at: new Date() })
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
    const { email, prenom, nom, telephone, password } = req.body as {
      email?: string; prenom?: string; nom?: string; telephone?: string; password?: string;
    };
    if (!email || !prenom || !nom || !password) {
      return res.status(400).json({ error: "email, prenom, nom et password sont requis" });
    }
    const [existing] = await db.select({ id: external_services.id }).from(external_services).where(eq(external_services.id, id));
    if (!existing) return res.status(404).json({ error: "Service introuvable" });

    const password_hash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(users).values({
      email, prenom, nom, telephone, password_hash,
      role: "service_externe" as const,
      service_id: id,
    }).returning({ id: users.id, email: users.email, prenom: users.prenom, nom: users.nom, telephone: users.telephone, created_at: users.created_at });
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
