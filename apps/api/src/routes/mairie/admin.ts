import { Router } from "express";
import { db } from "../../db.js";
import { dossiers, users, communes, zones, zone_regulatory_rules } from "@heureka-v1/db";
import { eq, sql, ilike, inArray, and, ne } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requireRole } from "../../middlewares/auth.js";
import { callAi, convertPdfPagesToPng, extractPdfText, type AiContentBlock, type AiToolDefinition } from "../../services/aiUsage.js";
import { partitionPagesByZone, chunkPages, assertTocCoverage, parseTocFromNativeText, toArticleInt, isUsableRule, type TocEntry } from "../../services/pluImport.js";
import { PDFDocument } from "pdf-lib";
import {
  computeInstructionDelay,
  applyMonthsToDate,
  type DeadlineMetadata,
  type DeadlineServitude,
  type DeadlineBreakdownItem,
} from "../../services/instructionDelays.js";
import { DELAI_INSTRUCTION_MOIS_DEFAUT } from "./_shared.js";

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
  // Endpoint legacy SSE. Conservé pour rétrocompat ; le nouveau front utilise
  // /admin/ingest-plu-pdf/start + /batch + /commit (cf. plus bas).
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

  // SSE heartbeat. La phase 2 enchaîne des appels Pixtral de 30-60 s pendant
  // lesquels aucun événement applicatif n'est émis. Sans trafic sur la socket,
  // un proxy avec idle timeout (Railway, Cloudflare, navigateur Safari) coupe
  // la connexion → côté client `fetch()` lève "Load failed". On envoie un
  // commentaire SSE toutes les 10 s pour garder la connexion vivante.
  const heartbeat = setInterval(() => {
    res.write(`: keepalive ${Date.now()}\n\n`);
    (res as unknown as { flush?: () => void }).flush?.();
  }, 10_000);

  // Le client a fermé l'onglet / coupé la connexion : on arrête l'extraction
  // pour ne pas continuer à brûler des tokens Mistral inutilement.
  let aborted = false;
  req.on("close", () => { aborted = true; });

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
    // réussie ET cohérente (cf. assertTocCoverage) — ainsi un import partiel
    // (LLM qui rate la moitié des zones) ne détruit jamais le référentiel
    // déjà validé.

    // Pixtral n'accepte pas le PDF natif. On rend toutes les pages en PNG via
    // pdftoppm (cf. services/aiUsage.ts → convertPdfPagesToPng), et on les
    // envoie sous forme de blocs `image` directement dans le content du message.
    // Le bug historique faisait le contraire : transmettre un blob PDF au
    // helper "document", qui ne convertissait QUE la première page — sur un
    // tronçon de 90 pages, 89 étaient invisibles à l'IA (article 12 inclus).
    const pdfBuffer = Buffer.from(pdf_base64, "base64");
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();

    const renderPagesAsBlocks = (firstPage: number, maxPages: number): AiContentBlock[] => {
      const pngs = convertPdfPagesToPng(pdfBuffer, { firstPage, maxPages, dpi: 150 });
      return pngs.map<AiContentBlock>((png) => ({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
      }));
    };

    // Phase 1 — Sommaire. On rend les 5 premières pages et on demande la liste
    // des zones avec leur page de début. Plus de "détection tronçon par
    // tronçon" : un seul appel ciblé qui pilote tout le découpage qui suit.
    send({ type: "phase", message: "Lecture du sommaire…" });
    const TOC_PAGES = Math.min(5, totalPages);
    const tocBlocks = renderPagesAsBlocks(1, TOC_PAGES);
    const tocMsg = await callAi(
      { purpose: "plu_toc_detect", userId: req.user?.id ?? null, communeId: commune.id },
      {
        model: "ai-smart",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            ...tocBlocks,
            {
              type: "text",
              text: `Ces ${TOC_PAGES} pages sont le début d'un règlement PLU français. Lis le SOMMAIRE et renvoie la liste de TOUTES les zones (UA, UC, UJ, UL, UM, UP, UX, AUs, A, N, Ni, Nj, 1AU…) avec leur page de DÉBUT de section dans le document (numérotation 1-indexée, alignée sur les pages PDF physiques).

Inclus les sous-zones ayant un règlement distinct. Pour chaque zone, type = "U" (urbaine) | "AU" (à urbaniser) | "A" (agricole) | "N" (naturelle).

Réponds UNIQUEMENT avec un JSON array, sans autre texte :
[{"code":"UA","label":"Zone UA – Centre ancien","type":"U","startPage":7}, …]

Si tu ne trouves pas de sommaire dans ces ${TOC_PAGES} pages, renvoie [].`,
            },
          ],
        }],
      },
    );
    const tocRaw = tocMsg.content[0]?.type === "text" ? tocMsg.content[0].text : "[]";
    const tocParsed = JSON.parse(tocRaw.match(/\[[\s\S]*?\]/)?.[0] ?? "[]") as Array<{
      code?: unknown; label?: unknown; type?: unknown; startPage?: unknown;
    }>;
    const toc: TocEntry[] = tocParsed.flatMap((e) => {
      const code = typeof e.code === "string" ? e.code.trim() : "";
      const startPage = Number(e.startPage);
      if (!code || !Number.isInteger(startPage)) return [];
      return [{
        code,
        label: typeof e.label === "string" ? e.label : code,
        type: typeof e.type === "string" ? e.type : "U",
        startPage,
      }];
    });

    if (toc.length === 0) {
      send({ type: "error", message: "Aucun sommaire détecté dans les premières pages. Vérifiez que c'est bien un règlement PLU avec sommaire." });
      return res.end();
    }

    const zoneRanges = partitionPagesByZone(toc, totalPages);
    send({ type: "zones_found", zones: zoneRanges.map((z) => ({ code: z.code, label: z.label, type: z.type })) });
    send({ type: "phase", message: `Sommaire : ${zoneRanges.length} zones identifiées (${zoneRanges.map(z => z.code).join(", ")}).` });

    // Phase 2 — Règles par zone. Pour chaque zone, on rend TOUTES ses pages
    // [startPage, endPage] en lots de PAGE_BATCH images Pixtral. Chaque lot
    // appelle save_rule autant de fois qu'il a vu d'articles ; on fusionne
    // les règles par (article_number, topic) en gardant la plus complète.
    const PAGE_BATCH = 8;

    const extractZone = async (zone: typeof zoneRanges[number]) => {
      const batches = chunkPages(zone.startPage, zone.endPage, PAGE_BATCH);
      const merged = new Map<string, PluRuleInput>();
      let visionCount = 0;
      let batchErrors = 0;

      for (let bi = 0; bi < batches.length; bi++) {
        if (aborted) break;
        const [first, last] = batches[bi]!;
        // Événement de progression par lot : permet à l'UI d'afficher l'avancée
        // intra-zone (UL = 12 lots) et — surtout — maintient le flux SSE actif
        // entre deux appels Pixtral pour qu'aucun proxy ne coupe la connexion.
        send({
          type: "zone_progress", zone: zone.code,
          batch: bi + 1, total_batches: batches.length,
          page_from: first, page_to: last,
        });
        try {
          const blocks = renderPagesAsBlocks(first, last - first + 1);
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
                  ...blocks,
                  {
                    type: "text",
                    text: `Ces pages font partie d'un règlement PLU français, section "Zone ${zone.code}" (${zone.label}). Extrais les règles de la ZONE ${zone.code} uniquement.

Pour CHAQUE article ou sous-article distinct présent dans ces pages, appelle save_rule UNE fois.
Correspondance article → topic :
  1/2 → destinations | 5 → terrain_min | 6 → recul_voie | 7 → recul_limite
  8 → recul_batiments | 9 → emprise_sol | 10 → hauteur | 11 → aspect
  12 → stationnement | 13 → espaces_verts | 14 → cos

- Lis ATTENTIVEMENT les tableaux (notamment l'article 12 stationnement, l'article 13 espaces verts) : chaque ligne du tableau peut être une règle distincte.
- Si l'article dit "sans objet" ou "non réglementé" → not_regulated = true, appelle quand même save_rule.
- Plusieurs valeurs selon sous-secteurs → valeur principale dans value_max, variantes dans conditions.
- Si la valeur numérique est dans un schéma graphique → needs_vision = true.
- Si la règle renvoie à un document externe (PPRI, PLH, cahier des charges ZAC, arrêté préfectoral, servitude…) → needs_external_doc = true, external_doc_name = nom exact.
- N'invente aucune valeur. Si incertain, omets value_min/max/exact.`,
                  },
                ],
              }],
            },
          );

          const batchRules = ruleMsg.content
            .filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use")
            .map(b => b.input as PluRuleInput);

          for (const r of batchRules) {
            if (!isUsableRule(r)) continue;
            // Fusion par (article_number, topic) : si la même règle ressort
            // dans deux lots (chevauchement de tableau, article à cheval),
            // on garde celle au rule_text le plus long (proxy "plus complet").
            const key = `${toArticleInt(r.article_number) ?? "x"}|${r.topic}`;
            const prev = merged.get(key);
            if (!prev || (r.rule_text?.length ?? 0) > (prev.rule_text?.length ?? 0)) {
              merged.set(key, r);
            }
            if (r.needs_vision || r.needs_external_doc) visionCount++;
          }
        } catch (e) {
          batchErrors++;
          console.error(`[ingest-plu-pdf] zone ${zone.code} lot p${first}-${last} échoué`, e);
        }
      }

      const rules = [...merged.values()];
      send({
        type: "zone_done", zone: zone.code,
        rules: rules.length, vision: visionCount,
        ...(batchErrors > 0 ? { warning: `${batchErrors} lot(s) en erreur sur ${batches.length}` } : {}),
      });
      return { zoneDef: zone, rules, visionCount };
    };

    // Concurrence bornée : 2 zones en parallèle (chaque zone ouvre déjà
    // plusieurs requêtes IA séquentielles via ses lots de pages).
    const extracted: Array<{ zoneDef: typeof zoneRanges[number]; rules: PluRuleInput[]; visionCount: number }> = [];
    const CONCURRENCY = 2;
    for (let i = 0; i < zoneRanges.length; i += CONCURRENCY) {
      if (aborted) break;
      const batch = zoneRanges.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(extractZone));
      extracted.push(...batchResults);
    }

    if (aborted) {
      console.warn("[ingest-plu-pdf] client déconnecté en cours d'extraction — abandon, aucune écriture DB.");
      return; // pas de transaction, pas de purge du référentiel existant.
    }

    // Garde-fou : si l'IA n'a réussi à extraire des règles que pour une
    // poignée de zones, on REFUSE d'écraser le référentiel existant. La
    // requête échoue clairement et la transaction d'écriture ne s'ouvre pas.
    assertTocCoverage(
      toc,
      extracted.map((e) => ({ code: e.zoneDef.code, ruleCount: e.rules.length })),
    );

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
          const articleInt = toArticleInt(rule.article_number);
          await tx.insert(zone_regulatory_rules).values({
            zone_id: zoneId,
            article_number: articleInt,
            article_title: rule.article_title ?? (articleInt != null ? `Article ${articleInt}` : ""),
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
  } finally {
    clearInterval(heartbeat);
  }

  res.end();
});

// ── Ingestion PLU — API découpée en jobs (start / batch / commit) ───────────
//
// L'endpoint SSE ci-dessus reste pour rétrocompat, mais sur un PLU volumineux
// (Tours, 217 pages, 10 zones, ~50 lots d'images Pixtral à ~30 s chacun) le
// budget total dépasse celui de tout proxy HTTP (Railway ≈ 5 min). Résultat :
// la requête est tuée par le proxy bien avant que la première zone ne finisse,
// et Safari affiche "Load failed".
//
// Le découpage suivant rend chaque requête HTTP courte (≤ 60 s, généralement
// < 30 s) :
//   1) POST /admin/ingest-plu-pdf/start — uploade le PDF, extrait le sommaire,
//      stocke le PDF en RAM sous un jobId, renvoie la liste des zones avec
//      leurs lots de pages pré-calculés.
//   2) POST /admin/ingest-plu-pdf/batch — extrait UN lot de pages (8 max) pour
//      UNE zone, renvoie les règles. Le client orchestre ces appels avec sa
//      propre concurrence (4-8 en parallèle) et affiche la progression.
//   3) POST /admin/ingest-plu-pdf/commit — applique assertTocCoverage et écrit
//      la transaction DB en une fois.
//
// Le PDF reste en mémoire sous jobId pendant l'ingestion, avec une TTL d'1 h.
// Si l'API est redémarrée, le job est perdu et le client doit reprendre au
// /start — c'est acceptable (les écritures DB n'ont pas encore eu lieu, le
// référentiel existant n'est pas affecté).

type IngestJob = {
  jobId: string;
  pdfBuffer: Buffer;
  totalPages: number;
  toc: TocEntry[];
  commune: { id: string; name: string; insee_code: string };
  userId: string | null;
  zones: Array<{
    code: string;
    label: string;
    type: string;
    startPage: number;
    endPage: number;
    batches: Array<{ index: number; firstPage: number; lastPage: number }>;
  }>;
  createdAt: number;
};

const INGEST_JOBS = new Map<string, IngestJob>();
const INGEST_JOB_TTL_MS = 60 * 60 * 1000; // 1 h

function gcIngestJobs() {
  const now = Date.now();
  for (const [id, j] of INGEST_JOBS) {
    if (now - j.createdAt > INGEST_JOB_TTL_MS) INGEST_JOBS.delete(id);
  }
}

function renderPagesAsBlocksFor(pdfBuffer: Buffer, firstPage: number, maxPages: number): AiContentBlock[] {
  // DPI 130 : compromis taille payload Mistral / lisibilité tableaux. À 150 le
  // payload (8 × ~350 KB base64) faisait dépasser le proxy nginx (504) sur
  // les batches lents — 130 réduit ~25 % le poids et la latence Pixtral.
  const pngs = convertPdfPagesToPng(pdfBuffer, { firstPage, maxPages, dpi: 130 });
  return pngs.map<AiContentBlock>((png) => ({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
  }));
}

// POST /admin/ingest-plu-pdf/start
adminRouter.post("/admin/ingest-plu-pdf/start", async (req: AuthRequest, res) => {
  try {
    gcIngestJobs();
    const { commune_name, insee_code, zip_code, pdf_base64 } = req.body as {
      commune_name?: string; insee_code?: string; zip_code?: string; pdf_base64?: string;
    };
    if (!commune_name || !insee_code || !pdf_base64) {
      return res.status(400).json({ error: "commune_name, insee_code et pdf_base64 requis" });
    }

    // Upsert commune (identique au legacy)
    let commune = (await db.select().from(communes).where(eq(communes.insee_code, insee_code)).limit(1))[0];
    if (!commune) {
      const [created] = await db.insert(communes).values({ name: commune_name, insee_code, zip_code: zip_code ?? "" }).returning();
      commune = created!;
    } else {
      await db.update(communes).set({ name: commune_name, zip_code: zip_code ?? commune.zip_code ?? "", updated_at: new Date() }).where(eq(communes.id, commune.id));
    }

    const pdfBuffer = Buffer.from(pdf_base64, "base64");
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();

    // Phase 1 — Sommaire.
    // Voie rapide : texte natif via pdftotext (~1 s). Couvre la quasi-totalité
    // des PLU français (sommaire structuré "Dispositions applicables à la
    // zone XX ... page N"). Évite l'appel Pixtral qui faisait dépasser /start
    // de la limite proxy nginx (60 s → 504 Gateway Time-out).
    // Fallback Pixtral si pdftotext n'est pas installé OU si le sommaire
    // natif n'identifie pas au moins 3 zones (PDF scanné, ou structure
    // inhabituelle).
    const tocPages = Math.min(15, totalPages);
    const nativeText = extractPdfText(pdfBuffer, { firstPage: 1, lastPage: tocPages });
    let toc: TocEntry[] = nativeText ? parseTocFromNativeText(nativeText) : [];

    if (toc.length === 0) {
      // Bascule Pixtral. Sur PDF normal, on n'arrive ici que pour des PLU à
      // sommaire inhabituel — coût modéré et acceptable.
      const TOC_PAGES = Math.min(5, totalPages);
      const tocBlocks = renderPagesAsBlocksFor(pdfBuffer, 1, TOC_PAGES);
      const tocMsg = await callAi(
        { purpose: "plu_toc_detect", userId: req.user?.id ?? null, communeId: commune.id },
        {
          model: "ai-smart",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              ...tocBlocks,
              { type: "text", text: `Ces ${TOC_PAGES} pages sont le début d'un règlement PLU français. Lis le SOMMAIRE et renvoie la liste de TOUTES les zones (UA, UC, UJ, UL, UM, UP, UX, AUs, A, N, Ni, Nj, 1AU…) avec leur page de DÉBUT de section dans le document (numérotation 1-indexée, alignée sur les pages PDF physiques).

Inclus les sous-zones ayant un règlement distinct. Pour chaque zone, type = "U" (urbaine) | "AU" (à urbaniser) | "A" (agricole) | "N" (naturelle).

Réponds UNIQUEMENT avec un JSON array, sans autre texte :
[{"code":"UA","label":"Zone UA – Centre ancien","type":"U","startPage":7}, …]

Si tu ne trouves pas de sommaire dans ces ${TOC_PAGES} pages, renvoie [].` },
            ],
          }],
        },
      );
      const tocRaw = tocMsg.content[0]?.type === "text" ? tocMsg.content[0].text : "[]";
      const tocParsed = JSON.parse(tocRaw.match(/\[[\s\S]*?\]/)?.[0] ?? "[]") as Array<{
        code?: unknown; label?: unknown; type?: unknown; startPage?: unknown;
      }>;
      toc = tocParsed.flatMap((e) => {
        const code = typeof e.code === "string" ? e.code.trim() : "";
        const startPage = Number(e.startPage);
        if (!code || !Number.isInteger(startPage)) return [];
        return [{
          code,
          label: typeof e.label === "string" ? e.label : code,
          type: typeof e.type === "string" ? e.type : "U",
          startPage,
        }];
      });
    }

    if (toc.length === 0) {
      return res.status(422).json({ error: "Aucun sommaire détecté dans les premières pages. Vérifiez que c'est bien un règlement PLU avec sommaire." });
    }

    const zoneRanges = partitionPagesByZone(toc, totalPages);
    // PAGE_BATCH = 3 : marge confortable sous les 60 s du proxy nginx. Pixtral
    // sur 3 images répond en 15-20 s typiquement. Le nombre de batches monte
    // (Tours ≈ 70) mais le client orchestre CONCURRENCY=4 → temps total OK.
    const PAGE_BATCH = 3;
    const zones_out = zoneRanges.map((z) => ({
      code: z.code, label: z.label, type: z.type,
      startPage: z.startPage, endPage: z.endPage,
      batches: chunkPages(z.startPage, z.endPage, PAGE_BATCH)
        .map(([first, last], i) => ({ index: i, firstPage: first, lastPage: last })),
    }));

    const jobId = `${commune.insee_code}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    INGEST_JOBS.set(jobId, {
      jobId, pdfBuffer, totalPages, toc,
      commune: { id: commune.id, name: commune.name, insee_code: commune.insee_code },
      userId: req.user?.id ?? null,
      zones: zones_out,
      createdAt: Date.now(),
    });

    res.json({
      jobId,
      commune: { id: commune.id, name: commune.name, insee_code: commune.insee_code },
      totalPages,
      zones: zones_out,
    });
  } catch (err) {
    console.error("[ingest-plu-pdf/start]", err);
    const status = (err as { status?: number })?.status;
    const transient = status === 429 || status === 529 || (typeof status === "number" && status >= 500);
    res.status(transient ? 503 : 500).json({
      error: transient
        ? "Le service d'extraction IA est momentanément indisponible. Réessayez dans quelques instants."
        : (err instanceof Error ? err.message : String(err)),
    });
  }
});

// POST /admin/ingest-plu-pdf/batch — extrait UN lot de pages.
adminRouter.post("/admin/ingest-plu-pdf/batch", async (req: AuthRequest, res) => {
  try {
    const { jobId, zoneCode, batchIndex } = req.body as { jobId?: string; zoneCode?: string; batchIndex?: number };
    if (!jobId || !zoneCode || !Number.isInteger(batchIndex)) {
      return res.status(400).json({ error: "jobId, zoneCode et batchIndex (int) requis" });
    }
    const job = INGEST_JOBS.get(jobId);
    if (!job) return res.status(404).json({ error: "Job introuvable ou expiré. Reprenez à l'étape /start." });

    const zone = job.zones.find((z) => z.code === zoneCode);
    if (!zone) return res.status(404).json({ error: `Zone ${zoneCode} absente du job` });
    const batch = zone.batches[batchIndex!];
    if (!batch) return res.status(404).json({ error: `Lot ${batchIndex} absent de la zone ${zoneCode}` });

    const blocks = renderPagesAsBlocksFor(job.pdfBuffer, batch.firstPage, batch.lastPage - batch.firstPage + 1);
    const ruleMsg = await callAi(
      { purpose: "plu_rule_extract", userId: job.userId, communeId: job.commune.id },
      {
        model: "ai-smart",
        max_tokens: 4000,
        tools: [PLU_SAVE_RULE_TOOL],
        tool_choice: "any",
        messages: [{
          role: "user",
          content: [
            ...blocks,
            { type: "text", text: `Ces pages font partie d'un règlement PLU français, section "Zone ${zone.code}" (${zone.label}). Extrais les règles de la ZONE ${zone.code} uniquement.

Pour CHAQUE article ou sous-article distinct présent dans ces pages, appelle save_rule UNE fois.
Correspondance article → topic :
  1/2 → destinations | 5 → terrain_min | 6 → recul_voie | 7 → recul_limite
  8 → recul_batiments | 9 → emprise_sol | 10 → hauteur | 11 → aspect
  12 → stationnement | 13 → espaces_verts | 14 → cos

- Lis ATTENTIVEMENT les tableaux (notamment l'article 12 stationnement, l'article 13 espaces verts) : chaque ligne du tableau peut être une règle distincte.
- Si l'article dit "sans objet" ou "non réglementé" → not_regulated = true, appelle quand même save_rule.
- Plusieurs valeurs selon sous-secteurs → valeur principale dans value_max, variantes dans conditions.
- Si la valeur numérique est dans un schéma graphique → needs_vision = true.
- Si la règle renvoie à un document externe (PPRI, PLH, cahier des charges ZAC, arrêté préfectoral, servitude…) → needs_external_doc = true, external_doc_name = nom exact.
- N'invente aucune valeur. Si incertain, omets value_min/max/exact.` },
          ],
        }],
      },
    );
    const rules = ruleMsg.content
      .filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use")
      .map((b) => b.input as PluRuleInput);
    const visionCount = rules.filter((r) => r.needs_vision || r.needs_external_doc).length;
    res.json({ rules, visionCount, batch });
  } catch (err) {
    console.error("[ingest-plu-pdf/batch]", err);
    const status = (err as { status?: number })?.status;
    const transient = status === 429 || status === 529 || (typeof status === "number" && status >= 500);
    res.status(transient ? 503 : 500).json({
      error: transient
        ? "Service IA momentanément indisponible — réessayez ce lot."
        : (err instanceof Error ? err.message : String(err)),
      transient,
    });
  }
});

// POST /admin/ingest-plu-pdf/commit — écrit la transaction.
adminRouter.post("/admin/ingest-plu-pdf/commit", async (req: AuthRequest, res) => {
  try {
    const { jobId, zoneResults } = req.body as {
      jobId?: string;
      zoneResults?: Array<{ zoneCode: string; rules: PluRuleInput[]; visionCount?: number }>;
    };
    if (!jobId || !Array.isArray(zoneResults)) {
      return res.status(400).json({ error: "jobId et zoneResults requis" });
    }
    const job = INGEST_JOBS.get(jobId);
    if (!job) return res.status(404).json({ error: "Job introuvable ou expiré." });

    // Fusion par (article_number, topic) intra-zone : le client peut envoyer
    // plusieurs règles avec la même clé (chevauchements de tableau, article à
    // cheval sur deux lots) — on garde la plus complète, comme dans l'ancien
    // flux monolithique.
    const merged = zoneResults.map((zr) => {
      const m = new Map<string, PluRuleInput>();
      for (const r of zr.rules) {
        if (!isUsableRule(r)) continue;
        const key = `${toArticleInt(r.article_number) ?? "x"}|${r.topic}`;
        const prev = m.get(key);
        if (!prev || (r.rule_text?.length ?? 0) > (prev.rule_text?.length ?? 0)) m.set(key, r);
      }
      const zoneDef = job.zones.find((z) => z.code === zr.zoneCode);
      return { zoneDef, rules: [...m.values()], visionCount: zr.visionCount ?? 0 };
    }).filter((e): e is { zoneDef: NonNullable<typeof e.zoneDef>; rules: PluRuleInput[]; visionCount: number } => !!e.zoneDef);

    // Garde-fou : si l'IA n'a réussi à extraire des règles que pour une
    // poignée de zones, on REFUSE d'écraser le référentiel existant.
    assertTocCoverage(
      job.toc,
      merged.map((e) => ({ code: e.zoneDef.code, ruleCount: e.rules.length })),
    );

    const num = (v: unknown): number | null =>
      v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

    await db.transaction(async (tx) => {
      const oldZones = await tx.select({ id: zones.id }).from(zones).where(eq(zones.commune_id, job.commune.id));
      if (oldZones.length > 0) {
        await tx.delete(zone_regulatory_rules).where(inArray(zone_regulatory_rules.zone_id, oldZones.map((z) => z.id)));
        await tx.delete(zones).where(eq(zones.commune_id, job.commune.id));
      }
      for (const { zoneDef, rules } of merged) {
        const [created] = await tx.insert(zones).values({
          commune_id: job.commune.id,
          zone_code: zoneDef.code,
          zone_label: zoneDef.label,
          zone_type: zoneDef.type,
          summary: `Zone ${zoneDef.code} — extrait par IA, à valider`,
          status: "active",
          is_active: true,
        }).returning();
        const zoneId = created!.id;
        for (const rule of rules) {
          const articleInt = toArticleInt(rule.article_number);
          await tx.insert(zone_regulatory_rules).values({
            zone_id: zoneId,
            article_number: articleInt,
            article_title: rule.article_title ?? (articleInt != null ? `Article ${articleInt}` : ""),
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

    // Job consommé — on libère la RAM (PDF buffer).
    INGEST_JOBS.delete(jobId);

    const detail = merged.map((e) => ({ zone: e.zoneDef.code, rules: e.rules.length, vision: e.visionCount }));
    res.json({
      ok: true,
      commune: job.commune.name,
      insee_code: job.commune.insee_code,
      zones: detail.length,
      rules: detail.reduce((s, z) => s + z.rules, 0),
      needs_review: detail.reduce((s, z) => s + z.vision, 0),
      detail,
    });
  } catch (err) {
    console.error("[ingest-plu-pdf/commit]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
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
