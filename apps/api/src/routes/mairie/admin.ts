import { Router } from "express";
import { db } from "../../db.js";
import { dossiers, users, communes, zones, zone_regulatory_rules } from "@heureka-v1/db";
import { eq, sql, ilike, inArray, and, ne } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requireRole } from "../../middlewares/auth.js";
import { callAi, type AiToolDefinition } from "../../services/aiUsage.js";
import {
  computeInstructionDelay,
  applyMonthsToDate,
  type DeadlineMetadata,
  type DeadlineServitude,
  type DeadlineBreakdownItem,
} from "../../services/instructionDelays.js";
import { DELAI_INSTRUCTION_MOIS_DEFAUT, splitPdfBase64 } from "./_shared.js";

export const adminRouter = Router();

// ── Lookup INSEE via geo.api.gouv.fr (évite CORS côté navigateur) ──
adminRouter.get("/admin/insee-lookup", async (req: AuthRequest, res) => {
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
adminRouter.get("/admin/commune-details", async (req: AuthRequest, res) => {
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
adminRouter.patch("/admin/commune-details", requireRole("admin"), async (req: AuthRequest, res) => {
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
adminRouter.post("/admin/communes", requireRole("admin"), async (req: AuthRequest, res) => {
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
adminRouter.get("/admin/users", async (req: AuthRequest, res) => {
  try {
    const communeName = (req.query.commune as string ?? "").trim();
    if (!communeName) return res.status(400).json({ error: "Paramètre commune requis" });
    const rows = await db.select({
      id: users.id, email: users.email, prenom: users.prenom, nom: users.nom,
      role: users.role, commune: users.commune, telephone: users.telephone,
      role_config_id: users.role_config_id,
      created_at: users.created_at,
    }).from(users).where(and(ilike(users.commune, communeName), ne(users.role, "citoyen")));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Création d'un utilisateur (admin ou mairie pour leur commune) ──
adminRouter.post("/admin/users", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
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
    const { sendActivationEmail } = await import("../../services/mailer.js");
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
adminRouter.patch("/admin/users/:id", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
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
adminRouter.delete("/admin/users/:id", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
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

// ── Calcul / recalcul des dates échéance théoriques (admin) ───────────────
adminRouter.post("/admin/compute-deadlines", async (req: AuthRequest, res) => {
  try {
    const force = (req.body as { force?: boolean } | undefined)?.force === true;
    const baseQuery = db
      .select({ id: dossiers.id, type: dossiers.type, date_depot: dossiers.date_depot, date_completude: dossiers.date_completude, metadata: dossiers.metadata })
      .from(dossiers);
    const toUpdate = await (force
      ? baseQuery.where(sql`date_depot IS NOT NULL`)
      : baseQuery.where(sql`date_depot IS NOT NULL AND date_limite_instruction IS NULL`));

    let updated = 0;
    const breakdown_samples: Array<{ id: string; type: string; total_mois: number; breakdown: DeadlineBreakdownItem[] }> = [];
    for (const d of toUpdate) {
      const meta = (d.metadata as DeadlineMetadata | null) ?? null;
      const servitudes = (meta as { servitudes?: DeadlineServitude[] } | null)?.servitudes ?? null;
      const calc = computeInstructionDelay(d.type, meta, servitudes);
      const startDate = new Date((d.date_completude ?? d.date_depot)!);
      const deadline = applyMonthsToDate(startDate, calc.total_mois);
      const nextMeta = {
        ...((d.metadata as Record<string, unknown>) ?? {}),
        delai: {
          total_mois: calc.total_mois,
          breakdown: calc.breakdown,
          base_date: startDate.toISOString(),
          base_date_source: d.date_completude ? "completude" : "depot",
          computed_at: new Date().toISOString(),
        },
      };
      await db.update(dossiers)
        .set({ date_limite_instruction: deadline, metadata: nextMeta, updated_at: new Date() })
        .where(eq(dossiers.id, d.id));
      updated++;
      if (breakdown_samples.length < 5) {
        breakdown_samples.push({ id: d.id, type: d.type, total_mois: calc.total_mois, breakdown: calc.breakdown });
      }
    }

    res.json({
      ok: true, updated, force,
      breakdown_samples,
      rules_defaut: Object.entries(DELAI_INSTRUCTION_MOIS_DEFAUT).map(([type, mois]) => ({ type, delai_mois_defaut: mois })),
    });
  } catch (err) {
    console.error("[compute-deadlines]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Ingestion PLU depuis PDF (IA — admin uniquement) ──────────────────────────
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

const PLU_SAVE_RULE_TOOL: AiToolDefinition = {
  type: "function",
  function: {
    name: "save_rule",
    description: "Enregistre une règle réglementaire extraite d'un article du PLU.",
    parameters: {
      type: "object",
      properties: {
        article_number: { type: "number", description: "Numéro de l'article, décimal autorisé pour les PLU modernisés (6, 12.1, 12.2…). Null si non numéroté." },
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
  },
};

adminRouter.post("/admin/ingest-plu-pdf", async (req: AuthRequest, res) => {
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

    // Mistral Pixtral n'accepte pas le PDF nativement ; la conversion 1re page
    // PDF→PNG est faite côté aiUsage.ts (helper pdftoppm). Pas d'équivalent au
    // prompt caching Anthropic — chaque tronçon est ré-analysé from scratch.
    const pdfDocFor = (b64: string) => ({
      type: "document" as const,
      source: { type: "base64" as const, media_type: "application/pdf" as const, data: b64 },
    });

    // Phase 1 — Détection des zones, tronçon par tronçon (chaque zone est rattachée
    // au premier tronçon où sa section apparaît).
    send({ type: "phase", message: chunks.length > 1 ? `Détection des zones (${chunks.length} parties)…` : "Détection des zones…" });
    const detectChunk = async (c: number) => {
     try {
      const zoneMsg = await callAi(
        { purpose: "plu_zone_detect", userId: req.user?.id ?? null, communeId: commune.id },
        {
          model: "ai-smart",
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
        },
      );
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
      const ruleMsg = await callAi(
        { purpose: "plu_rule_extract", userId: req.user?.id ?? null, communeId: commune.id },
        {
          model: "ai-smart",
          max_tokens: 4000,
          tools: [PLU_SAVE_RULE_TOOL],
          tool_choice: "any",
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
        },
      );

      const rules: PluRuleInput[] = ruleMsg.content
        .filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use")
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
    // num() : l'IA renvoie parfois "" au lieu de null pour les colonnes sans
    // valeur. Postgres rejette "" sur double precision → l'INSERT crashait et
    // toute la transaction d'extraction PLU était perdue. Aligné sur le helper
    // de reglementation.ts:190.
    const num = (v: unknown): number | null =>
      v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

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
            value_min: num(rule.value_min),
            value_max: num(rule.value_max),
            value_exact: num(rule.value_exact),
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

// GET /mairie/admin/reglementation-status
// Diagnostic (lecture seule) : pour chaque commune, INSEE + nb de zones/règles
// + liste des codes de zone. Permet de voir à quelle commune des règles sont
// réellement rattachées (utile pour repérer des données mal associées).
adminRouter.get("/admin/reglementation-status", requireRole("mairie", "instructeur", "admin"), async (_req: AuthRequest, res) => {
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
