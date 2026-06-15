import { Router } from "express";
import { db } from "../../db.js";
import { dossiers, users, communes, user_communes } from "@heureka-v1/db";
import { eq, sql } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requireAuth } from "../../middlewares/auth.js";

export const communesRouter = Router();

// ── Communes de l'utilisateur connecté ──
// Admin : voit toutes les communes en DB (cohérent avec son rôle "voit tout").
// Mairie/instructeur : restreint via user_communes, sinon fallback sur la
// commune principale.
communesRouter.get("/my-communes", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role = req.user!.role;

    if (role === "admin") {
      const all = await db
        .select({ name: communes.name, insee_code: communes.insee_code })
        .from(communes)
        .orderBy(communes.name);
      return res.json(all);
    }

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
// Filtré par utilisateur sauf pour les admins : un user mairie/instructeur ne
// doit voir QUE les communes auxquelles il a accès (sinon le sélecteur de la
// Carte montrait toute la France et permettait de "sélectionner" une commune
// hors de ses droits → refresh = retour sur sa commune principale par défaut).
communesRouter.get("/communes", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role = req.user!.role;

    if (role === "admin") {
      const rows = await db.select({ name: communes.name }).from(communes).orderBy(communes.name);
      const names = rows.map(r => r.name);
      if (names.length) return res.json(names);
      const fallback = await db.selectDistinct({ commune: dossiers.commune }).from(dossiers).where(sql`commune IS NOT NULL`).orderBy(dossiers.commune);
      return res.json(fallback.map(r => r.commune).filter(Boolean));
    }

    // Mairie / instructeur : restreindre aux communes liées via user_communes,
    // sinon fallback sur la commune principale du user.
    const linked = await db
      .select({ name: communes.name })
      .from(user_communes)
      .innerJoin(communes, eq(user_communes.commune_id, communes.id))
      .where(eq(user_communes.user_id, userId))
      .orderBy(communes.name);
    if (linked.length > 0) return res.json(linked.map(r => r.name));

    const [user] = await db.select({ commune: users.commune }).from(users).where(eq(users.id, userId)).limit(1);
    res.json(user?.commune ? [user.commune] : []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des communes avec code INSEE (pour la carte et le sélecteur) ──
communesRouter.get("/commune-list", async (_req: AuthRequest, res) => {
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

// ── GET /api/mairie/commune-users?commune=... ────────────────────────────────
// Returns users with access to a commune (via user_communes OR users.commune)
communesRouter.get("/commune-users", requireAuth, async (req: AuthRequest, res) => {
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
