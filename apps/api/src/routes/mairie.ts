import { Router } from "express";
import { db } from "../db.js";
import { dossiers, users, notifications, dossier_messages, zones, zone_regulatory_rules, communes } from "@heureka-v1/db";
import { eq, desc, and, sql, like, ilike } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { analyseParcel } from "../services/parcelAnalysis.js";
import Anthropic from "@anthropic-ai/sdk";

export const mairieRouter = Router();

mairieRouter.use(requireAuth);
mairieRouter.use(requireRole("mairie", "instructeur", "admin"));

// ── Dashboard stats ──
mairieRouter.get("/dashboard", async (_req: AuthRequest, res) => {
  try {
    const total = await db.select({ count: sql<number>`count(*)` }).from(dossiers);
    const parStatut = await db
      .select({ status: dossiers.status, count: sql<number>`count(*)` })
      .from(dossiers)
      .groupBy(dossiers.status);

    const recent = await db
      .select()
      .from(dossiers)
      .orderBy(desc(dossiers.updated_at))
      .limit(10);

    const pendingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(dossiers)
      .where(sql`status NOT IN ('accepte', 'refuse', 'brouillon')`);

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

    const sel = {
      id: dossiers.id, numero: dossiers.numero, type: dossiers.type, status: dossiers.status,
      adresse: dossiers.adresse, commune: dossiers.commune, code_postal: dossiers.code_postal,
      description: dossiers.description, date_depot: dossiers.date_depot,
      date_limite_instruction: dossiers.date_limite_instruction, created_at: dossiers.created_at,
      demandeur_prenom: users.prenom, demandeur_nom: users.nom,
    };

    let rows;
    if (search) {
      const pattern = `%${search}%`;
      rows = await db.select(sel).from(dossiers)
        .leftJoin(users, eq(dossiers.user_id, users.id))
        .where(sql`(dossiers.numero ILIKE ${pattern} OR dossiers.adresse ILIKE ${pattern} OR dossiers.commune ILIKE ${pattern} OR users.prenom ILIKE ${pattern} OR users.nom ILIKE ${pattern} OR CONCAT(users.prenom, ' ', users.nom) ILIKE ${pattern})`)
        .orderBy(desc(dossiers.created_at));
    } else if (status) {
      rows = await db.select(sel).from(dossiers)
        .leftJoin(users, eq(dossiers.user_id, users.id))
        .where(eq(dossiers.status, status as any))
        .orderBy(desc(dossiers.created_at));
    } else {
      rows = await db.select(sel).from(dossiers)
        .leftJoin(users, eq(dossiers.user_id, users.id))
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
    const [dossier] = await db
      .update(dossiers)
      .set({ status, updated_at: new Date() })
      .where(eq(dossiers.id, req.params.id as string))
      .returning();
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    res.json(dossier);
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

// ── Communes avec dossiers (pour le sélecteur de la carte) ──
mairieRouter.get("/communes", async (_req: AuthRequest, res) => {
  try {
    const rows = await db
      .selectDistinct({ commune: dossiers.commune })
      .from(dossiers)
      .where(sql`commune IS NOT NULL`)
      .orderBy(dossiers.commune);
    res.json(rows.map(r => r.commune).filter(Boolean));
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
          ? sql`commune ILIKE ${"%" + commune + "%"} AND adresse IS NOT NULL`
          : sql`adresse IS NOT NULL`
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
// NB: "non lu" = dernier message du citoyen sans réponse de la mairie/instructeur
mairieRouter.get("/conversations", async (_req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`
      WITH last_msg AS (
        SELECT DISTINCT ON (dossier_id) dossier_id, content, from_role, created_at
        FROM dossier_messages
        ORDER BY dossier_id, created_at DESC
      ),
      unread AS (
        SELECT dm.dossier_id, COUNT(*)::int AS cnt
        FROM dossier_messages dm
        WHERE dm.from_role = 'citoyen'
          AND dm.created_at > COALESCE((
            SELECT MAX(dm2.created_at) FROM dossier_messages dm2
            WHERE dm2.dossier_id = dm.dossier_id AND dm2.from_role != 'citoyen'
          ), '1970-01-01'::timestamp)
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
      ORDER BY lm.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Nombre total de messages non lus (pour le badge dashboard) ──
mairieRouter.get("/conversations/unread-count", async (_req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT COUNT(DISTINCT dm.dossier_id)::int AS count
      FROM dossier_messages dm
      WHERE dm.from_role = 'citoyen'
        AND dm.created_at > COALESCE((
          SELECT MAX(dm2.created_at) FROM dossier_messages dm2
          WHERE dm2.dossier_id = dm.dossier_id AND dm2.from_role != 'citoyen'
        ), '1970-01-01'::timestamp)
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

// ── Injection PLU Ballan-Miré (one-shot, admin seulement) ──
mairieRouter.post("/admin/seed-plu", async (_req: AuthRequest, res) => {
  type RuleInput = { art: number; title: string; topic: string; rule_text: string; vmin: number | null; vmax: number | null; unit: string | null; cond: string | null; summ: string };

  const ZONES_DATA: Array<{
    zone_code: string; zone_label: string; zone_type: string; summary: string; order: number;
    rules: RuleInput[];
  }> = [
    { zone_code: "UA", zone_label: "Zone UA – Centre ancien", zone_type: "U", order: 1,
      summary: "Cœur historique, bâti traditionnel dense en étoile autour de l'église.",
      rules: [
        { art: 6,  title: "Recul voirie",  topic: "recul_voie",   rule_text: "Recul entre 0 et 1 m, ou alignement sur construction voisine, ou recul minimal de 6 m.", vmin: 0,    vmax: 6,    unit: "m",   cond: null,                   summ: "0-1m ou alignement ou ≥6m" },
        { art: 7,  title: "Recul limites", topic: "recul_limite",  rule_text: "En limite séparative ou H/2 avec minimum 3 m.", vmin: 3, vmax: null, unit: "m", cond: "H/2 minimum 3m", summ: "En limite ou H/2 (min 3m)" },
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Emprise au sol non réglementée en zone UA.", vmin: null, vmax: null, unit: null, cond: null, summ: "Non réglementé" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "6,5 m à l'égout ou à l'acrotère ; 9 m au faîtage.", vmin: null, vmax: 6.5, unit: "m", cond: "Faîtage: 9m", summ: "6,5m égout / 9m faîtage" },
        { art: 12, title: "Stationnement", topic: "stationnement", rule_text: "2 places/logement ≥2P. 1 place/50m² activités. Commerces ≤100m² : 0 place.", vmin: null, vmax: null, unit: null, cond: null, summ: "2 places/logement (≥2P)" },
        { art: 13, title: "Espaces verts", topic: "espaces_verts", rule_text: "≥25% d'espaces libres en pleine terre. 1 arbre haute tige/100m².", vmin: 25, vmax: null, unit: "%", cond: null, summ: "≥25% pleine terre" },
      ]},
    { zone_code: "UB", zone_label: "Zone UB – Extensions du centre", zone_type: "U", order: 2,
      summary: "Extensions urbaines : collectifs R+3, mairie, ZAC des Prés, quartier gare.",
      rules: [
        { art: 6,  title: "Recul voirie",  topic: "recul_voie",   rule_text: "Recul minimal de 6 m.", vmin: 6, vmax: null, unit: "m", cond: null, summ: "≥6m" },
        { art: 7,  title: "Recul limites", topic: "recul_limite",  rule_text: "En limite séparative ou H/2 min 3 m. UBa : jamais en limite.", vmin: 3, vmax: null, unit: "m", cond: "UBa: jamais en limite", summ: "En limite ou H/2 (min 3m)" },
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Emprise au sol max 50%. UBai (inondable) : 10%.", vmin: null, vmax: 50, unit: "%", cond: "UBai: 10%", summ: "≤50% (UBai: 10%)" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "9 m à l'égout ; 14 m au faîtage (R+3).", vmin: null, vmax: 9, unit: "m", cond: "Faîtage: 14m", summ: "9m égout / 14m faîtage" },
        { art: 12, title: "Stationnement", topic: "stationnement", rule_text: "2 places/logement. Quota social : 20% pour 5-20 logts, 30% au-delà.", vmin: null, vmax: null, unit: null, cond: null, summ: "2 places/logement, quota social 20-30%" },
        { art: 13, title: "Espaces verts", topic: "espaces_verts", rule_text: "≥35% d'espaces libres en pleine terre.", vmin: 35, vmax: null, unit: "%", cond: null, summ: "≥35% pleine terre" },
      ]},
    { zone_code: "UC", zone_label: "Zone UC – Quartiers pavillonnaires", zone_type: "U", order: 3,
      summary: "Zone majoritaire : lotissements, ZAC des Prés, hameaux de Miré et des Vallées.",
      rules: [
        { art: 6,  title: "Recul voirie",  topic: "recul_voie",   rule_text: "Recul minimal de 3 m. RD751 : 45 m depuis l'axe.", vmin: 3, vmax: null, unit: "m", cond: "RD751: 45m depuis axe", summ: "≥3m (RD751: 45m)" },
        { art: 7,  title: "Recul limites", topic: "recul_limite",  rule_text: "En limite séparative ou H/2 min 3 m.", vmin: 3, vmax: null, unit: "m", cond: "H/2 minimum 3m", summ: "En limite ou H/2 (min 3m)" },
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Emprise au sol maximale de 50%.", vmin: null, vmax: 50, unit: "%", cond: null, summ: "≤50%" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "6,5 m à l'égout ; 9 m au faîtage (R+2).", vmin: null, vmax: 6.5, unit: "m", cond: "Faîtage: 9m", summ: "6,5m égout / 9m faîtage" },
        { art: 12, title: "Stationnement", topic: "stationnement", rule_text: "2 places/logement. Quota social : 20% dès 5 logements.", vmin: null, vmax: null, unit: null, cond: null, summ: "2 places/logement, quota social 20%" },
        { art: 13, title: "Espaces verts", topic: "espaces_verts", rule_text: "≥40% d'espaces libres en pleine terre.", vmin: 40, vmax: null, unit: "%", cond: null, summ: "≥40% pleine terre" },
      ]},
    { zone_code: "UD", zone_label: "Zone UD – Quartiers verdoyants", zone_type: "U", order: 4,
      summary: "Habitat très peu dense en espaces boisés. Terrain min 2000m². Limite séparative interdite.",
      rules: [
        { art: 5,  title: "Terrain min.",  topic: "terrain_min",  rule_text: "Superficie minimale des terrains constructibles : 2 000 m².", vmin: 2000, vmax: null, unit: "m²", cond: null, summ: "≥2 000m² par terrain" },
        { art: 6,  title: "Recul voirie",  topic: "recul_voie",   rule_text: "Recul minimal de 7 m.", vmin: 7, vmax: null, unit: "m", cond: null, summ: "≥7m" },
        { art: 7,  title: "Recul limites", topic: "recul_limite",  rule_text: "Implantation en limite séparative interdite. Recul H/2 min 3 m.", vmin: 3, vmax: null, unit: "m", cond: "Jamais en limite – H/2 min 3m", summ: "Jamais en limite, H/2 (min 3m)" },
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Emprise au sol maximale de 20%.", vmin: null, vmax: 20, unit: "%", cond: null, summ: "≤20%" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "6,5 m à l'égout ; 8,5 m au faîtage.", vmin: null, vmax: 6.5, unit: "m", cond: "Faîtage: 8.5m", summ: "6,5m égout / 8,5m faîtage" },
        { art: 12, title: "Stationnement", topic: "stationnement", rule_text: "2 places par logement de 2 pièces et plus.", vmin: null, vmax: null, unit: null, cond: null, summ: "2 places/logement" },
        { art: 13, title: "Espaces verts", topic: "espaces_verts", rule_text: "≥60% d'espaces libres en pleine terre.", vmin: 60, vmax: null, unit: "%", cond: null, summ: "≥60% pleine terre" },
      ]},
    { zone_code: "UZ", zone_label: "Zone UZ – ZAC de la Pasqueraie", zone_type: "U", order: 5,
      summary: "Habitat récent mixte. UZa : collectifs 14m. UZb : formes compactes 11m.",
      rules: [
        { art: 6,  title: "Recul voirie",  topic: "recul_voie",   rule_text: "Recul minimal de 5 m.", vmin: 5, vmax: null, unit: "m", cond: null, summ: "≥5m" },
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Emprise au sol max 50% (40% en UZa).", vmin: null, vmax: 50, unit: "%", cond: "UZa: 40%", summ: "≤50% (UZa: 40%)" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "14 m en UZa ; 11 m en UZb.", vmin: null, vmax: 14, unit: "m", cond: "UZb: 11m", summ: "14m (UZa) / 11m (UZb)" },
        { art: 13, title: "Espaces verts", topic: "espaces_verts", rule_text: "≥40% d'espaces libres en pleine terre.", vmin: 40, vmax: null, unit: "%", cond: null, summ: "≥40% pleine terre" },
      ]},
    { zone_code: "UX", zone_label: "Zone UX – Activités La Châtaigneraie", zone_type: "U", order: 6,
      summary: "Zone d'activités économiques. Reculs stricts RD751/RD751c.",
      rules: [
        { art: 6,  title: "Recul voirie",  topic: "recul_voie",   rule_text: "Recul 45 m depuis axe RD751 ; 25 m depuis RD751c.", vmin: 45, vmax: null, unit: "m", cond: "RD751: 45m axe; RD751c: 25m", summ: "45m (RD751) / 25m (RD751c)" },
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Emprise au sol maximale de 60%.", vmin: null, vmax: 60, unit: "%", cond: null, summ: "≤60%" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "Hauteur maximale de 10 m.", vmin: null, vmax: 10, unit: "m", cond: null, summ: "≤10m" },
      ]},
    { zone_code: "UY", zone_label: "Zone UY – Activités Carrefour en Touraine", zone_type: "U", order: 7,
      summary: "Grande zone d'activités. Hauteurs jusqu'à 15m.",
      rules: [
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Emprise au sol maximale de 50%.", vmin: null, vmax: 50, unit: "%", cond: null, summ: "≤50%" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "Hauteur maximale de 15 m.", vmin: null, vmax: 15, unit: "m", cond: null, summ: "≤15m" },
      ]},
    { zone_code: "UL", zone_label: "Zone UL – Sports et Loisirs", zone_type: "U", order: 8,
      summary: "Équipements sportifs : centre équestre, camping, base nautique.",
      rules: [
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Non réglementé.", vmin: null, vmax: null, unit: null, cond: null, summ: "Non réglementé" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "Non réglementé.", vmin: null, vmax: null, unit: null, cond: null, summ: "Non réglementé" },
      ]},
    { zone_code: "US", zone_label: "Zone US – Établissements sanitaires", zone_type: "U", order: 9,
      summary: "IEM Charlemagne, centre rééducation, SDIS.",
      rules: [
        { art: 7,  title: "Recul limites", topic: "recul_limite",  rule_text: "Recul de 10 m par rapport aux limites séparatives.", vmin: 10, vmax: null, unit: "m", cond: null, summ: "≥10m des limites" },
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Non réglementé.", vmin: null, vmax: null, unit: null, cond: null, summ: "Non réglementé" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "Non réglementé.", vmin: null, vmax: null, unit: null, cond: null, summ: "Non réglementé" },
      ]},
    { zone_code: "UV", zone_label: "Zone UV – Village Vacances", zone_type: "U", order: 10,
      summary: "Opération de village-vacances en cours.",
      rules: [
        { art: 6,  title: "Recul voirie",  topic: "recul_voie",   rule_text: "Recul minimal de 10 m.", vmin: 10, vmax: null, unit: "m", cond: null, summ: "≥10m" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "Hauteur maximale de 9 m au faîtage.", vmin: null, vmax: 9, unit: "m", cond: null, summ: "≤9m faîtage" },
      ]},
    { zone_code: "1AU", zone_label: "Zone 1AU – La Savatterie", zone_type: "AU", order: 11,
      summary: "Secteur résidentiel à urbaniser à court terme.",
      rules: [
        { art: 6,  title: "Recul voirie",  topic: "recul_voie",   rule_text: "Recul minimal de 5 m.", vmin: 5, vmax: null, unit: "m", cond: null, summ: "≥5m" },
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Emprise au sol maximale de 50%.", vmin: null, vmax: 50, unit: "%", cond: null, summ: "≤50%" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "7,5 m au faîtage.", vmin: null, vmax: 7.5, unit: "m", cond: null, summ: "≤7,5m faîtage" },
        { art: 13, title: "Espaces verts", topic: "espaces_verts", rule_text: "≥40% d'espaces libres en pleine terre.", vmin: 40, vmax: null, unit: "%", cond: null, summ: "≥40% pleine terre" },
      ]},
    { zone_code: "1AUZ", zone_label: "Zone 1AUZ – ZAC Pasqueraie 3e tranche", zone_type: "AU", order: 12,
      summary: "Dernière tranche ZAC Pasqueraie. 25% logements sociaux requis.",
      rules: [
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "10 à 14 m selon l'emplacement.", vmin: 10, vmax: 14, unit: "m", cond: null, summ: "10-14m selon emplacement" },
        { art: 13, title: "Espaces verts", topic: "espaces_verts", rule_text: "≥25% d'espaces libres en pleine terre.", vmin: 25, vmax: null, unit: "%", cond: null, summ: "≥25% pleine terre" },
      ]},
    { zone_code: "AUH", zone_label: "Zone AUH – Urbanisation future résidentielle", zone_type: "AU", order: 13,
      summary: "Non constructible sans révision PLU.",
      rules: [
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Extensions existantes uniquement : +50% max 50 m².", vmin: null, vmax: 50, unit: "m²", cond: "Extensions uniquement; révision PLU pour construire", summ: "Extensions seules (+50% max 50m²)" },
      ]},
    { zone_code: "AUY", zone_label: "Zone AUY – Urbanisation future économique", zone_type: "AU", order: 14,
      summary: "Extension future zone Carrefour en Touraine.",
      rules: [
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Extensions du bâti existant uniquement, limite 50%.", vmin: null, vmax: 50, unit: "%", cond: "Extensions bâti existant uniquement", summ: "Extensions seules (+50% existant)" },
      ]},
    { zone_code: "A", zone_label: "Zone A – Agricole", zone_type: "A", order: 15,
      summary: "Protège le potentiel agronomique. Secteurs Ad, Ah, Ap.",
      rules: [
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Libre pour l'exploitation. Ah : +50% max 50m². Ap : inconstructible.", vmin: null, vmax: null, unit: null, cond: "Ah: +50% max 50m²; Ap: inconstructible", summ: "Libre (Ah: +50% max 50m²; Ap: interdit)" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "4 m à l'égout pour les bâtiments d'habitation.", vmin: null, vmax: 4, unit: "m", cond: "Habitation; agricole libre; Ah annexes 3m", summ: "4m égout (habitation)" },
      ]},
    { zone_code: "N", zone_label: "Zone N – Naturelle et forestière", zone_type: "N", order: 16,
      summary: "Espaces naturels protégés. Secteurs Nh, Ng, Na, Nb, Nf.",
      rules: [
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Inconstructible. Secteurs : Nh (+50% max 50m²), Ng (20%), Na (5%), Nb (300m²), Nf (50%).", vmin: null, vmax: null, unit: null, cond: "Nh: +50% max 50m²; Ng: 20%; Na: 5%; Nb: 300m²", summ: "Inconstructible (secteurs tolérés)" },
        { art: 10, title: "Hauteur max.",  topic: "hauteur",       rule_text: "Non réglementé sauf : Nh (existant/3m annexes), Ng (5m), Nb/Na/Nf (6m).", vmin: null, vmax: null, unit: null, cond: "Nh 3m; Ng 5m; autres 6m", summ: "Libre (secteurs: Nh 3m; Ng 5m; autres 6m)" },
      ]},
    { zone_code: "NI", zone_label: "Zone NI – Inondable (vallée du Cher)", zone_type: "N", order: 17,
      summary: "Soumis au PPRI. NI1/NI2/NI3 selon aléa. Sous-sols interdits.",
      rules: [
        { art: 9,  title: "Emprise au sol",topic: "emprise_sol",   rule_text: "Extensions max 50 m² avec étage refuge obligatoire. Sous-sols interdits.", vmin: null, vmax: 50, unit: "m²", cond: "PPRI; étage refuge; sous-sols interdits", summ: "Extensions ≤50m² avec étage refuge" },
        { art: 10, title: "Hauteur / plancher", topic: "hauteur",  rule_text: "Plancher habitable surélevé d'au moins 0,50 m par rapport au sol naturel.", vmin: 0.5, vmax: null, unit: "m", cond: "Surélévation +0.50m NGF; étage refuge PHEC", summ: "Plancher +0.50m NGF; étage refuge" },
      ]},
  ];

  try {
    // Upsert commune — cherche d'abord par insee_code, puis par name (évite la contrainte UNIQUE)
    let commune = (await db.select().from(communes).where(eq(communes.insee_code, "37018")).limit(1))[0]
      ?? (await db.select().from(communes).where(ilike(communes.name, "Ballan-Miré")).limit(1))[0];
    if (!commune) {
      const [created] = await db.insert(communes).values({ name: "Ballan-Miré", insee_code: "37018", zip_code: "37510" }).returning();
      commune = created!;
    } else {
      await db.update(communes).set({ insee_code: "37018", zip_code: "37510" }).where(eq(communes.id, commune.id));
    }

    let zonesCreated = 0, rulesCreated = 0;

    for (const zd of ZONES_DATA) {
      // Upsert zone
      let zone = (await db.select().from(zones).where(and(eq(zones.commune_id, commune.id), eq(zones.zone_code, zd.zone_code))).limit(1))[0];
      if (!zone) {
        const [created] = await db.insert(zones).values({
          commune_id: commune.id, zone_code: zd.zone_code, zone_label: zd.zone_label,
          zone_type: zd.zone_type, summary: zd.summary, status: "active", is_active: true, display_order: zd.order,
        }).returning();
        zone = created!;
        zonesCreated++;
      } else {
        await db.update(zones).set({ zone_label: zd.zone_label, zone_type: zd.zone_type, summary: zd.summary, updated_at: new Date() }).where(eq(zones.id, zone.id));
      }

      // Upsert rules
      for (const r of zd.rules) {
        const existing = (await db.select().from(zone_regulatory_rules).where(and(eq(zone_regulatory_rules.zone_id, zone.id), eq(zone_regulatory_rules.topic, r.topic))).limit(1))[0];
        if (!existing) {
          await db.insert(zone_regulatory_rules).values({
            zone_id: zone.id, article_number: r.art, article_title: r.title,
            topic: r.topic, rule_text: r.rule_text, value_min: r.vmin, value_max: r.vmax,
            unit: r.unit, conditions: r.cond, summary: r.summ, validation_status: "valide",
          });
          rulesCreated++;
        } else {
          await db.update(zone_regulatory_rules).set({
            article_number: r.art, rule_text: r.rule_text, value_min: r.vmin, value_max: r.vmax,
            unit: r.unit, conditions: r.cond, summary: r.summ, validation_status: "valide", updated_at: new Date(),
          }).where(eq(zone_regulatory_rules.id, existing.id));
        }
      }
    }

    res.json({ ok: true, commune: commune.name, zones_created: zonesCreated, rules_created: rulesCreated, total_zones: ZONES_DATA.length, total_rules: ZONES_DATA.reduce((s, z) => s + z.rules.length, 0) });
  } catch (err) {
    console.error("[seed-plu]", err);
    const detail = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Erreur serveur : ${detail}` });
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
      needs_vision: { type: "boolean", description: "True si le texte renvoie à un schéma pour la valeur numérique principale." },
    },
    required: ["article_number","article_title","topic","rule_text","not_regulated","summary","needs_vision"],
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

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    const pdfDoc = {
      type: "document" as const,
      source: { type: "base64" as const, media_type: "application/pdf" as const, data: pdf_base64 },
    };

    // Phase 1 — Zone discovery
    const zoneMsg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          pdfDoc,
          {
            type: "text",
            text: `Ce document est un règlement PLU français.
Liste toutes les zones qui ont un règlement distinct (UA, UB, UC, 1AU, N, A, etc.).
Exclure les sous-secteurs sans règlement propre sauf s'ils ont un article complet dédié.
Répondre UNIQUEMENT avec un JSON array, sans autre texte :
[{"code":"UA","label":"Zone UA – Centre ancien","type":"U"},…]
Types : "U"=urbaine, "AU"=à urbaniser, "A"=agricole, "N"=naturelle.`,
          },
        ],
      }],
    });

    const zoneRaw = zoneMsg.content[0]?.type === "text" ? zoneMsg.content[0].text : "[]";
    const zoneDefs = JSON.parse(zoneRaw.match(/\[[\s\S]*?\]/)?.[0] ?? "[]") as Array<{ code: string; label: string; type: string }>;

    if (zoneDefs.length === 0) {
      return res.status(422).json({ error: "Aucune zone détectée dans le document. Vérifiez que c'est bien un règlement PLU textuel." });
    }

    // Phase 2 — Règles par zone
    const results: Array<{ zone: string; rules: number; vision: number }> = [];

    for (const zoneDef of zoneDefs) {
      const ruleMsg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        tools: [PLU_SAVE_RULE_TOOL],
        tool_choice: { type: "any" },
        messages: [{
          role: "user",
          content: [
            pdfDoc,
            {
              type: "text",
              text: `Ce document est un règlement PLU français. Extrais les règles de la ZONE ${zoneDef.code} uniquement.

Pour CHAQUE article présent dans la section Zone ${zoneDef.code}, appelle save_rule une fois.
Correspondance article → topic :
  1/2 → destinations | 5 → terrain_min | 6 → recul_voie | 7 → recul_limite
  8 → recul_batiments | 9 → emprise_sol | 10 → hauteur | 11 → aspect
  12 → stationnement | 13 → espaces_verts | 14 → cos

- Si l'article dit "sans objet" ou "non réglementé" → not_regulated = true, appelle quand même save_rule.
- Plusieurs valeurs selon sous-secteurs → valeur principale dans value_max, variantes dans conditions.
- Si le texte renvoie à un schéma pour la valeur numérique principale → needs_vision = true.
- N'invente aucune valeur. Si incertain, omets value_min/max/exact.`,
            },
          ],
        }],
      });

      const rules: PluRuleInput[] = ruleMsg.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map(b => b.input as PluRuleInput);

      // Upsert zone
      const [existingZone] = await db.select({ id: zones.id })
        .from(zones)
        .where(and(eq(zones.commune_id, commune.id), eq(zones.zone_code, zoneDef.code)))
        .limit(1);

      let zoneId: string;
      if (existingZone) {
        zoneId = existingZone.id;
        await db.update(zones).set({ zone_label: zoneDef.label, zone_type: zoneDef.type, updated_at: new Date() }).where(eq(zones.id, zoneId));
      } else {
        const [created] = await db.insert(zones).values({
          commune_id: commune.id,
          zone_code: zoneDef.code,
          zone_label: zoneDef.label,
          zone_type: zoneDef.type,
          summary: `Zone ${zoneDef.code} — extrait par IA, à valider`,
          status: "active",
          is_active: true,
        }).returning();
        zoneId = created!.id;
      }

      // Upsert rules
      let visionCount = 0;
      for (const rule of rules) {
        const [existingRule] = await db.select({ id: zone_regulatory_rules.id })
          .from(zone_regulatory_rules)
          .where(and(eq(zone_regulatory_rules.zone_id, zoneId), eq(zone_regulatory_rules.topic, rule.topic)))
          .limit(1);

        if (rule.needs_vision) visionCount++;

        const payload = {
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
          instructor_note: rule.needs_vision ? "⚠ La valeur est dans un schéma — à vérifier manuellement." : null,
          validation_status: "brouillon" as const,
        };

        if (existingRule) {
          await db.update(zone_regulatory_rules).set({ ...payload, updated_at: new Date() }).where(eq(zone_regulatory_rules.id, existingRule.id));
        } else {
          await db.insert(zone_regulatory_rules).values({ zone_id: zoneId, ...payload });
        }
      }

      results.push({ zone: zoneDef.code, rules: rules.length, vision: visionCount });
    }

    res.json({
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
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
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

// PATCH /mairie/reglementation/rules/:id — validate, edit or reject a rule
mairieRouter.patch("/reglementation/rules/:id", async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { rule_text, validation_status, value_min, value_max, value_exact, unit, conditions, summary, instructor_note, topic, article_number, article_title } = req.body as Record<string, unknown>;

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
    if (summary !== undefined) patch.summary = summary;
    if (instructor_note !== undefined) patch.instructor_note = instructor_note;
    if (topic !== undefined) patch.topic = topic;
    if (article_number !== undefined) patch.article_number = article_number;
    if (article_title !== undefined) patch.article_title = article_title;

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

    const { article_number, article_title, topic, rule_text, value_min, value_max, value_exact, unit, conditions, summary } = req.body as Record<string, unknown>;
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
      summary: (summary as string | undefined) ?? null,
      validation_status: "brouillon",
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
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
//
// Stratégie : trouver d'abord la partition du document PLU/PLUi de la commune,
// puis récupérer les zones filtrées par cette partition + polygone commune.
// Cela garantit qu'on n'affiche jamais les zones d'une commune voisine.
mairieRouter.get("/plu-zones", async (req: AuthRequest, res) => {
  try {
    let inseeCode = (req.query.insee_code as string | undefined)?.trim();
    const communeName = (req.query.commune as string | undefined)?.trim();

    if (!inseeCode && !communeName) {
      return res.status(400).json({ error: "insee_code ou commune requis" });
    }

    // Résolution du code INSEE si non fourni
    if (!inseeCode && communeName) {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(communeName)}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) inseeCode = ((await r.json()) as Array<{ code?: string }>)[0]?.code ?? undefined;
    }

    // Contour de la commune (utilisé pour la requête géographique)
    const lookupQ = inseeCode ? `code=${encodeURIComponent(inseeCode)}` : `nom=${encodeURIComponent(communeName!)}`;
    const geoR = await fetch(
      `https://geo.api.gouv.fr/communes?${lookupQ}&fields=contour&format=geojson&geometry=contour&limit=1`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!geoR.ok) return res.status(502).json({ error: "Erreur geo.api.gouv.fr" });
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
    // La partition est l'identifiant unique du document PLU/PLUi dans le GPU.
    // Elle garantit qu'on ne récupère que les zones de CE document, pas celles
    // d'une commune voisine dont le polygone chevauche la requête.

    let partition: string | undefined;

    // A) PLU communal classique : partition = "{INSEE}_PLU"
    if (!partition && inseeCode) {
      const candidate = `${inseeCode}_PLU`;
      const r = await fetch(
        `https://apicarto.ign.fr/api/gpu/zone-urba?partition=${encodeURIComponent(candidate)}&_limit=1`,
        { signal: AbortSignal.timeout(8000) }
      ).catch(() => null);
      if (r?.ok) {
        const j = await r.json() as { features?: unknown[] };
        if ((j.features?.length ?? 0) > 0) partition = candidate;
      }
    }

    // B) Endpoint /document avec le centroïde de la commune
    if (!partition) {
      const r = await fetch(
        `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(ptGeom)}`,
        { signal: AbortSignal.timeout(8000) }
      ).catch(() => null);
      if (r?.ok) {
        type Doc = { features?: Array<{ properties: { partition?: string; etat?: string } }> };
        const docs = ((await r.json()) as Doc).features ?? [];
        const doc = docs.find(f => f.properties.etat === "approuve")
          ?? docs.find(f => !!f.properties.partition)
          ?? docs[0];
        partition = doc?.properties.partition ?? undefined;
      }
    }

    // C) PLUi intercommunal : récupérer le SIREN de l'EPCI → partition = "{SIREN}_PLUI"
    if (!partition && inseeCode) {
      const epciR = await fetch(
        `https://geo.api.gouv.fr/communes/${encodeURIComponent(inseeCode)}/epcis?fields=code&limit=5`,
        { signal: AbortSignal.timeout(8000) }
      ).catch(() => null);
      if (epciR?.ok) {
        const epcis = (await epciR.json()) as Array<{ code?: string }>;
        for (const epci of epcis) {
          if (!epci.code || partition) continue;
          const candidate = `${epci.code}_PLUI`;
          const r = await fetch(
            `https://apicarto.ign.fr/api/gpu/zone-urba?partition=${encodeURIComponent(candidate)}&_limit=1`,
            { signal: AbortSignal.timeout(8000) }
          ).catch(() => null);
          if (r?.ok) {
            const j = await r.json() as { features?: unknown[] };
            if ((j.features?.length ?? 0) > 0) partition = candidate;
          }
        }
      }
    }

    if (!partition) {
      return res.status(404).json({ error: "Aucune zone PLU disponible pour cette commune sur le Géoportail de l'Urbanisme" });
    }

    // ── Récupération des zones filtrées par partition + polygone commune ──────
    const params = new URLSearchParams({ partition, _limit: "1000" });
    params.set("geom", communeGeom);
    const zoneR = await fetch(
      `https://apicarto.ign.fr/api/gpu/zone-urba?${params.toString()}`,
      { signal: AbortSignal.timeout(25000) }
    );
    if (!zoneR.ok) {
      const body = await zoneR.text().catch(() => "");
      return res.status(502).json({ error: `Erreur APICarto zone-urba (HTTP ${zoneR.status})`, detail: body.slice(0, 300) });
    }
    const zoneJson = await zoneR.json() as { type?: string; features?: unknown[] };
    if (!zoneJson.features?.length) {
      return res.status(404).json({ error: "Aucune zone PLU disponible pour cette commune sur le Géoportail de l'Urbanisme" });
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(zoneJson);
  } catch (err) {
    console.error("[plu-zones proxy]", err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err) });
  }
});
