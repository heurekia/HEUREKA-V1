import { Router } from "express";
import { db } from "../db.js";
import { communes, epci, users, dossiers, role_permissions, external_services, service_communes, user_communes, audit_logs, password_tokens, dossier_pieces_jointes, legal_mentions, ai_usage_events, ai_alert_config } from "@heureka-v1/db";
import { invalidateAiAlertConfigCache, sendTestNotification } from "../services/aiAlerts.js";
import { CODE_URBANISME_ID, CODE_URBANISME_NAME, refreshArticle, resolveCode } from "../services/legifrance.js";
import { eq, sql, count, desc, and, isNull, isNotNull, ilike, asc, gte, lt, inArray } from "drizzle-orm";
import crypto from "crypto";
import { sendActivationEmail } from "../services/mailer.js";
import bcrypt from "bcryptjs";
import { requireAuth, requireRole } from "../middlewares/auth.js";
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
      .returning();

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

    const [updated] = await db
      .update(users)
      .set({ role, prenom, nom, commune, commune_insee, telephone, role_config_id, updated_at: new Date() })
      .where(eq(users.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Utilisateur introuvable" });
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
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

superAdminRouter.delete("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [target] = await db.select({ email: users.email }).from(users).where(eq(users.id, id)).limit(1);
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
superAdminRouter.get("/audit-logs", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = 50;
    const offset = (page - 1) * limit;
    const action = typeof req.query.action === "string" && req.query.action.length > 0
      ? req.query.action
      : undefined;
    const sinceRaw = typeof req.query.since === "string" && req.query.since.length > 0
      ? req.query.since
      : undefined;
    const sinceDate = sinceRaw ? new Date(sinceRaw) : undefined;

    const conditions = [];
    if (action) conditions.push(eq(audit_logs.action, action));
    if (sinceDate && !Number.isNaN(sinceDate.getTime())) {
      conditions.push(gte(audit_logs.created_at, sinceDate));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [total]] = await Promise.all([
      db.select({
        id: audit_logs.id,
        user_id: audit_logs.user_id,
        email: audit_logs.email,
        action: audit_logs.action,
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

    res.json({ rows, total: Number(total?.count ?? 0), page, limit });
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

superAdminRouter.post("/legal-mentions", async (req, res) => {
  try {
    const { article_ref, article_title, article_html, courrier_types, dossier_types, categories, contexte } = req.body as {
      article_ref?: string;
      article_title?: string;
      article_html?: string;
      courrier_types?: string[];
      dossier_types?: string[];
      categories?: string[];
      contexte?: string;
    };
    if (!article_ref?.trim()) return res.status(400).json({ error: "article_ref requis" });

    const [row] = await db
      .insert(legal_mentions)
      .values({
        code: CODE_URBANISME_ID,
        code_name: CODE_URBANISME_NAME,
        article_ref: article_ref.trim().toUpperCase(),
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
          article_title: article_title ?? null,
          article_html: article_html ?? null,
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

// ─── Coûts IA ────────────────────────────────────────────────────────────────

// Diagnostic : la table ai_usage_events existe-t-elle, et a-t-elle toutes les
// colonnes attendues ? Utile quand la page « Coûts IA » reste à zéro alors que
// la console Anthropic facture — typiquement migration non appliquée.
superAdminRouter.get("/ai-cost/healthcheck", async (_req, res) => {
  try {
    const rows = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage_events'`,
    );
    const cols = (rows as unknown as { column_name: string }[]).map((r) => r.column_name);
    const required = [
      "id", "dossier_id", "commune_id", "user_id", "purpose", "model",
      "input_tokens", "output_tokens", "cache_read_input_tokens",
      "cache_creation_input_tokens", "cost_eur", "duration_ms", "created_at",
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
        cache_read_tokens: sql<number>`COALESCE(SUM(${ai_usage_events.cache_read_input_tokens}), 0)`,
        cache_creation_tokens: sql<number>`COALESCE(SUM(${ai_usage_events.cache_creation_input_tokens}), 0)`,
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
        cache_read_tokens: Number(totals?.cache_read_tokens ?? 0),
        cache_creation_tokens: Number(totals?.cache_creation_tokens ?? 0),
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
