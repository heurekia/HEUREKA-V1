import { Router } from "express";
import { db } from "../../db.js";
import { dossiers, users, communes, zones, zone_regulatory_rules, regulatory_documents, document_communes } from "@heureka-v1/db";
import { eq, sql, ilike, inArray, and, ne } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requireRole } from "../../middlewares/auth.js";
import { callAi, convertPdfPagesToPng, extractPdfText, type AiContentBlock, type AiToolDefinition } from "../../services/aiUsage.js";
import { partitionPagesByZone, chunkPages, assertTocCoverage, parseTocFromNativeText, toArticleInt, isUsableRule, dedupeRules, mergeRulesByZoneCode, normalizeZoneCode, zoneTypeFromCode, type TocEntry } from "../../services/pluImport.js";
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
  citizen_title?: string | null;
  citizen_summary?: string | null;
  citizen_relevant?: boolean;
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
        summary: { type: "string", description: "Résumé technique en 10 mots maximum (usage interne instructeur)." },
        citizen_title: { type: "string", description: "Titre court de la règle, en langage courant, destiné aux particuliers (≤ 8 mots, sans jargon juridique). Ex: « Stationnement pour logements individuels »." },
        citizen_summary: { type: "string", description: "Explication COMPLÈTE de la règle en langage courant, 3 à 6 phrases. Inclut explicitement : la règle de fond, les conditions et exceptions, les valeurs chiffrées avec leur unité, et — si needs_vision = true — une description précise du schéma/croquis (ce qu'il représente, ce qu'il autorise/interdit). Phrases complètes, pas de bullets, pas de compact, pas de jargon." },
        citizen_relevant: { type: "boolean", description: "False seulement si la disposition n'a aucune utilité pour un particulier (procédure administrative pure, articles internes à l'administration). True par défaut." },
        needs_vision: { type: "boolean", description: "True si la règle renvoie à un schéma/croquis graphique du document (calcul de hauteur, implantation, types de lucarnes, etc.)." },
        needs_external_doc: { type: "boolean", description: "True si la règle renvoie explicitement à un document externe (PPRI, PLH, cahier des charges ZAC, servitude…)." },
        external_doc_name: { type: "string", description: "Nom du document externe référencé (ex: 'PPRI', 'PLH', 'cahier des charges ZAC'). Remplir si needs_external_doc = true." },
      },
      required: ["article_number","article_title","topic","rule_text","not_regulated","summary","citizen_title","citizen_summary","needs_vision","needs_external_doc"],
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
      const allRules: PluRuleInput[] = [];
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

- Lis ATTENTIVEMENT les tableaux (notamment l'article 12 stationnement, l'article 13 espaces verts) : chaque ligne du tableau = une règle distincte → un appel save_rule par ligne.
- Un même article peut porter PLUSIEURS règles distinctes selon la destination (habitation, commerce, bureaux, artisanat, hôtellerie…). Émets UN save_rule par destination / catégorie, avec son propre rule_text et sa propre valeur. Ne fusionne pas tout dans une seule règle.
- Si l'article dit "sans objet" ou "non réglementé" → not_regulated = true, appelle quand même save_rule.
- Plusieurs valeurs selon sous-secteurs géographiques (UA1 vs UA2…) → 1 save_rule par sous-secteur si possible, sinon valeur principale dans value_max + variantes dans conditions.
- Si la règle renvoie à un schéma/croquis graphique → needs_vision = true.
- Si la règle renvoie à un document externe (PPRI, PLH, cahier des charges ZAC, arrêté préfectoral, servitude…) → needs_external_doc = true, external_doc_name = nom exact.
- N'invente aucune valeur. Si incertain, omets value_min/max/exact.

CHAMPS « CITOYEN » (citizen_title + citizen_summary) — OBLIGATOIRES, à rédiger SOIGNEUSEMENT :
- citizen_title : titre court (≤ 8 mots) en langage courant. Ex : « Stationnement pour logements individuels », « Hauteur maximale des annexes », « Implantation en limite de propriété ».
- citizen_summary : explication COMPLÈTE en 3 à 6 phrases, langage courant, niveau « particulier qui veut construire chez lui ». Inclus EXPLICITEMENT : la règle, les conditions, les exceptions, les valeurs chiffrées avec unité, ET — si needs_vision = true — décris le schéma associé (ce qu'il montre, ce qu'il autorise, ce qu'il interdit). Phrases complètes, JAMAIS de version 10 mots compacte, pas de bullets, pas de jargon juridique.
- Exemple acceptable (article 7, recul limites) : « Selon la profondeur par rapport à la voie, l'implantation est autorisée soit d'une limite à l'autre, soit avec un retrait minimal. Sur les 20 premiers mètres : retrait de 3 m minimum (ou H/2) pour moins de 3 logements ; 5 m (ou 1,5 × H) pour 3 logements et plus. Au-delà de 20 mètres, l'implantation en limite séparative est interdite. Exceptions : annexes, jumelages, extensions de constructions déjà en limite. Les piscines doivent rester à 3 m minimum. Le schéma associé illustre le calcul de H sur terrain plat ou en pente, et la zone des 20 mètres depuis la voie. »
- citizen_relevant : false UNIQUEMENT si la disposition est purement administrative (procédure dépôt de permis…). True sinon.`,
                  },
                ],
              }],
            },
          );

          const batchRules = ruleMsg.content
            .filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use")
            .map(b => b.input as PluRuleInput);

          // On accumule tel quel ; la déduplication se fait en fin de zone
          // sur le texte de règle (cf. dedupeRules), pas sur (article, topic)
          // — sinon les multiples règles d'un même article (article 12
          // stationnement : habitation / commerce / bureaux / artisanat /
          // hôtellerie / etc.) seraient écrasées les unes sur les autres.
          allRules.push(...batchRules);
        } catch (e) {
          batchErrors++;
          console.error(`[ingest-plu-pdf] zone ${zone.code} lot p${first}-${last} échoué`, e);
        }
      }

      const rules = dedupeRules(allRules);
      const visionCount = rules.filter(r => r.needs_vision || r.needs_external_doc).length;
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
            citizen_title: rule.citizen_title?.trim() || null,
            citizen_summary: rule.citizen_summary?.trim() || null,
            citizen_relevant: rule.citizen_relevant !== false,
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
// Le découpage suivant garde la requête HTTP courte et déporte le gros du
// travail sur un worker serveur :
//   1) POST /admin/ingest-plu-pdf/start — uploade le(s) PDF, détecte le(s)
//      sommaire(s), stocke le job en RAM sous un jobId et LANCE le worker
//      runIngestJob en arrière-plan (extraction de tous les lots → synthèse
//      → assertTocCoverage → écriture DB en UNE transaction).
//   2) GET /admin/ingest-plu-pdf/status?jobId=… — polling : avancée des lots,
//      phase, puis résultat ou erreur. Le worker poursuit même si le client
//      ferme l'onglet.
//
// Le(s) PDF reste(nt) en mémoire sous jobId pendant l'ingestion (TTL 1 h, libéré
// dès la fin du worker). Si l'API redémarre, le job est perdu et le client
// reprend au /start — acceptable, car la transaction DB n'a lieu qu'à la toute
// fin : tant qu'elle n'a pas réussi, le référentiel existant n'est pas affecté.

// Un segment = UN PDF du PLUi. Un PLUi peut être livré en plusieurs fichiers
// (découpé par type de zone : U / AU / A / N, ou par tomes). Chaque PDF est
// autonome : sa propre numérotation de pages (1-indexée sur SON buffer) et son
// propre sommaire. Les règles de tous les segments sont accumulées puis écrites
// en UNE seule transaction (cf. runIngestJob), purge comprise — sinon ingérer
// un 2e PDF effacerait les zones du 1er.
type IngestSegment = {
  segmentIndex: number;
  pdfBuffer: Buffer;
  totalPages: number;
  zones: Array<{
    code: string;
    label: string;
    type: string;
    startPage: number;
    endPage: number;
    batches: Array<{ index: number; firstPage: number; lastPage: number }>;
  }>;
};

type IngestJob = {
  jobId: string;
  // Liste des PDF du PLUi (1 ou plusieurs). Mono-PDF = un seul segment.
  segments: IngestSegment[];
  // Sommaire global = union des sommaires de chaque segment, dédupliqué par
  // code de zone. Sert au garde-fou assertTocCoverage : la couverture est
  // évaluée sur l'ENSEMBLE des zones attendues, tous PDF confondus.
  toc: TocEntry[];
  // Commune de référence : sert au logging/imputation des coûts IA et au mode
  // legacy (PLU communal sans document explicite). En mode document, c'est
  // la première commune rattachée — un porteur arbitraire mais cohérent.
  commune: { id: string; name: string; insee_code: string };
  // Contexte document : présent quand l'ingestion cible un regulatory_document
  // existant (créé en amont via /admin/epci/:id/documents ou similaire).
  // Quand absent, fallback legacy : le commit purge/insère par commune_id sans
  // tagger source_document_id (préservé pour ne pas casser l'écran d'import
  // PLU communal historique).
  document?: {
    id: string;
    porteur: "commune" | "epci";
    // Communes membres rattachées via document_communes. En mode PLU communal
    // (porteur="commune"), un seul élément.
    communeIds: string[];
  };
  userId: string | null;
  // État du worker en arrière-plan (cf. runIngestJob). Le client interroge
  // /status pour suivre l'avancée sans tenir une connexion HTTP longue, ce qui
  // permet de fermer l'onglet ou de changer de page sans interrompre
  // l'extraction.
  status: "running" | "done" | "error";
  phase: string;
  // Clé composite `${segmentIndex}::${code}` : deux PDF peuvent porter le même
  // code de zone (ou être simplement traités séparément), on isole donc leur
  // état d'avancement par segment. La fusion par code intervient au commit.
  zoneState: Map<string, { doneBatches: number; rules: PluRuleInput[]; visionCount: number }>;
  result?: { zones: number; rules: number; needs_review: number; detail: Array<{ zone: string; rules: number; vision: number }> };
  error?: string;
  createdAt: number;
};

const INGEST_JOBS = new Map<string, IngestJob>();
const INGEST_JOB_TTL_MS = 60 * 60 * 1000; // 1 h
// Plafond du nombre de PDF par ingestion (un PLUi découpé tient largement
// dedans : U/AU/A/N = 4, ou quelques tomes). Garde-fou mémoire + taille body.
const MAX_PDFS_PER_INGEST = 20;

function gcIngestJobs() {
  const now = Date.now();
  for (const [id, j] of INGEST_JOBS) {
    // Pour un job actif, on prolonge le TTL : tant qu'il tourne, on ne le
    // supprime pas. La purge ne vise que les jobs `done`/`error` non lus.
    if (j.status === "running") continue;
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

// Détecte le sommaire (liste des zones + page de début) d'UN PDF de PLU.
// Voie rapide : texte natif via pdftotext (~1 s, couvre la quasi-totalité des
// PLU français). Repli Pixtral si pdftotext absent ou sommaire inhabituel (PDF
// scanné). Extrait en helper pour être appelé une fois par segment quand un
// PLUi est livré en plusieurs PDF (cf. IngestSegment).
async function detectPluToc(
  pdfBuffer: Buffer,
  totalPages: number,
  ctx: { userId: string | null; communeId: string },
  manualEntries: Array<{ code?: unknown; label?: unknown; type?: unknown; startPage?: unknown }> = [],
): Promise<TocEntry[]> {
  // Voie manuelle prioritaire : si l'opérateur a saisi les ancres zone→page
  // (PLUi volumineux ou sommaire atypique/scanné que la détection auto ne sait
  // pas lire), on les utilise telles quelles et on saute la détection.
  if (manualEntries.length > 0) {
    const manual = manualEntries.flatMap((e) => {
      const code = typeof e?.code === "string" ? normalizeZoneCode(e.code) : "";
      const startPage = Number(e?.startPage);
      if (!code || !Number.isInteger(startPage) || startPage < 1 || startPage > totalPages) return [];
      const type = typeof e?.type === "string" && e.type ? e.type : zoneTypeFromCode(code);
      const label = typeof e?.label === "string" && e.label.trim() ? e.label.trim() : `Zone ${code}`;
      return [{ code, label, type, startPage }];
    });
    // Retour direct (même vide → le caller traduit en 400 "sommaire manuel
    // invalide"). On ne retombe pas sur l'auto-détection : l'opérateur a fait
    // un choix explicite.
    return dedupeTocByCode(manual);
  }

  const tocPages = Math.min(15, totalPages);
  const nativeText = extractPdfText(pdfBuffer, { firstPage: 1, lastPage: tocPages });
  let toc: TocEntry[] = nativeText ? parseTocFromNativeText(nativeText) : [];

  if (toc.length === 0) {
    // Bascule Pixtral. Sur PDF normal, on n'arrive ici que pour des PLU à
    // sommaire inhabituel — coût modéré et acceptable.
    const TOC_PAGES = Math.min(5, totalPages);
    const tocBlocks = renderPagesAsBlocksFor(pdfBuffer, 1, TOC_PAGES);
    const tocMsg = await callAi(
      { purpose: "plu_toc_detect", userId: ctx.userId, communeId: ctx.communeId },
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
      const code = typeof e.code === "string" ? normalizeZoneCode(e.code) : "";
      const startPage = Number(e.startPage);
      if (!code || !Number.isInteger(startPage)) return [];
      return [{
        code,
        label: typeof e.label === "string" ? e.label : `Zone ${code}`,
        type: typeof e.type === "string" && e.type ? e.type : zoneTypeFromCode(code),
        startPage,
      }];
    });
  }

  // Dédup par code : deux ancres de même code dans UN segment (sommaire manuel
  // au code répété, ou hallucination Pixtral) provoqueraient une collision de
  // clé zoneState (`${segmentIndex}::${code}`) et un routage de lot ambigu
  // (seg.zones.find renvoie le 1er). On garde l'ancre à la plus petite page.
  return dedupeTocByCode(toc);
}

// Garde, par code, l'entrée à la plus petite startPage (le début réel de la
// section ; une 2e occurrence du même code est une coquille de sommaire).
function dedupeTocByCode(entries: TocEntry[]): TocEntry[] {
  const byCode = new Map<string, TocEntry>();
  for (const e of entries) {
    const prev = byCode.get(e.code);
    if (!prev || e.startPage < prev.startPage) byCode.set(e.code, e);
  }
  return [...byCode.values()];
}

// POST /admin/ingest-plu-pdf/start
//
// Deux modes de déclenchement, mutuellement exclusifs :
//  - Mode legacy (PLU communal) : { commune_name, insee_code, zip_code?,
//    pdf_base64 } — upsert la commune, ingestion non-document-aware
//    (commune_id à la purge, pas de source_document_id).
//  - Mode document (PLUi/PLUm/PPRI/…) : { doc_id, pdf_base64 } — l'extraction
//    est rattachée à un regulatory_document préalablement créé. Le commit
//    purge/insère par source_document_id, pose commune_id NULL si porteur
//    EPCI (zones partagées) ou commune.id si porteur commune. Les communes
//    rattachées sont lues depuis document_communes.
adminRouter.post("/admin/ingest-plu-pdf/start", async (req: AuthRequest, res) => {
  try {
    gcIngestJobs();
    const { commune_name, insee_code, zip_code, pdf_base64, pdfs_base64, doc_id, manual_toc } = req.body as {
      commune_name?: string; insee_code?: string; zip_code?: string;
      pdf_base64?: string; pdfs_base64?: string[]; doc_id?: string;
      // Saisie manuelle des ancres zone→page : repli quand la détection auto du
      // sommaire échoue (PLUi volumineux, sommaire atypique ou scanné).
      manual_toc?: Array<{ code?: unknown; label?: unknown; type?: unknown; startPage?: unknown }>;
    };
    // Un PLUi peut arriver en plusieurs PDF (découpé par type de zone ou par
    // tome). `pdfs_base64` est le contrat multi-fichiers ; `pdf_base64` reste
    // accepté pour la rétrocompatibilité (mono-PDF) → toujours ramené à un
    // tableau de buffers.
    const pdfList = Array.isArray(pdfs_base64) && pdfs_base64.length > 0
      ? pdfs_base64
      : pdf_base64 ? [pdf_base64] : [];
    if (pdfList.length === 0) {
      return res.status(400).json({ error: "pdf_base64 ou pdfs_base64 requis" });
    }
    // Borne le nombre de PDF : chaque buffer est gardé en RAM pendant tout le
    // job (INGEST_JOBS) et le body cumulé doit tenir sous la limite express.json
    // de la route (cf. app.ts). Au-delà, on refuse proprement plutôt que de
    // risquer un 413 opaque ou une pression mémoire.
    if (pdfList.length > MAX_PDFS_PER_INGEST) {
      return res.status(400).json({
        error: `Trop de fichiers (${pdfList.length}). Maximum ${MAX_PDFS_PER_INGEST} PDF par ingestion — regroupez ou ingérez en plusieurs fois.`,
      });
    }

    // Résolution du contexte d'ingestion : document explicite ou commune legacy.
    let commune: typeof communes.$inferSelect;
    let documentCtx: NonNullable<IngestJob["document"]> | undefined;
    if (doc_id) {
      // Mode document : on lit le porteur et les communes rattachées.
      const [doc] = await db.select().from(regulatory_documents).where(eq(regulatory_documents.id, doc_id)).limit(1);
      if (!doc) return res.status(404).json({ error: "Document réglementaire introuvable" });

      const rattachements = await db
        .select({ commune_id: document_communes.commune_id })
        .from(document_communes)
        .where(eq(document_communes.document_id, doc.id));
      const communeIds = rattachements.map((r) => r.commune_id);
      if (communeIds.length === 0) {
        return res.status(400).json({ error: "Document sans commune rattachée — rattachez au moins une commune avant d'ingérer." });
      }

      // On choisit une commune de référence pour le logging/imputation des
      // coûts IA. En mode PLU communal historique, le porteur_commune_id ;
      // en mode EPCI (porteur_epci_id), la première commune membre — choix
      // arbitraire mais cohérent (toutes seront couvertes par le document).
      const refCommuneId = doc.porteur_commune_id ?? communeIds[0]!;
      const [refCommune] = await db.select().from(communes).where(eq(communes.id, refCommuneId)).limit(1);
      if (!refCommune) {
        return res.status(500).json({ error: "Commune de référence introuvable (incohérence DB)" });
      }
      commune = refCommune;
      documentCtx = {
        id: doc.id,
        porteur: doc.porteur_epci_id ? "epci" : "commune",
        communeIds,
      };
    } else {
      // Mode legacy : on garde le contrat strict {commune_name, insee_code}.
      if (!commune_name || !insee_code) {
        return res.status(400).json({ error: "doc_id OU (commune_name + insee_code) requis" });
      }
      const existing = (await db.select().from(communes).where(eq(communes.insee_code, insee_code)).limit(1))[0];
      if (!existing) {
        const [created] = await db.insert(communes).values({ name: commune_name, insee_code, zip_code: zip_code ?? "" }).returning();
        commune = created!;
      } else {
        await db.update(communes).set({ name: commune_name, zip_code: zip_code ?? existing.zip_code ?? "", updated_at: new Date() }).where(eq(communes.id, existing.id));
        commune = existing;
      }
    }

    // Phase 1 — Sommaire, segment par segment (un segment = un PDF).
    // Chaque PDF est autonome : sa propre numérotation et son propre sommaire.
    // PAGE_BATCH = 3 : marge confortable sous les 60 s du proxy nginx. Pixtral
    // sur 3 images répond en 15-20 s typiquement.
    const PAGE_BATCH = 3;
    const userId = req.user?.id ?? null;
    // Saisie manuelle des ancres zone→page : repli quand la détection auto
    // échoue. Les pages saisies dépendent de la numérotation d'UN fichier →
    // on ne l'applique qu'en mode mono-PDF.
    const manualEntries = Array.isArray(manual_toc) ? manual_toc : [];
    const singlePdf = pdfList.length === 1;
    const segments: IngestSegment[] = [];
    const unionToc: TocEntry[] = [];
    const seenTocCodes = new Set<string>();
    let lastTotalPages = 0;

    // Phase 1 — détection du sommaire, un segment = un PDF, EN PARALLÈLE.
    // Chaque detectPluToc est indépendant et peut déclencher un appel Pixtral
    // lent (~15-20 s) ; les enchaîner ferait dépasser le proxy nginx (60 s →
    // 504) dès qu'on a plusieurs PDF scannés. Promise.all conserve l'ordre
    // d'origine → segmentIndex stable.
    const detected = await Promise.all(pdfList.map(async (b64) => {
      const pdfBuffer = Buffer.from(b64, "base64");
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
      const totalPages = pdfDoc.getPageCount();
      const toc = await detectPluToc(
        pdfBuffer, totalPages,
        { userId, communeId: commune.id },
        singlePdf ? manualEntries : [],
      );
      return { pdfBuffer, totalPages, toc };
    }));

    const failedSegments: number[] = []; // positions 1-indexées des PDF sans sommaire
    detected.forEach((d, idx) => {
      lastTotalPages = d.totalPages;
      const zoneRanges = d.toc.length > 0 ? partitionPagesByZone(d.toc, d.totalPages) : [];
      if (zoneRanges.length === 0) { failedSegments.push(idx + 1); return; }
      const segmentIndex = segments.length;
      const zones_out = zoneRanges.map((z) => ({
        code: z.code, label: z.label, type: z.type,
        startPage: z.startPage, endPage: z.endPage,
        batches: chunkPages(z.startPage, z.endPage, PAGE_BATCH)
          .map(([first, last], i) => ({ index: i, firstPage: first, lastPage: last })),
      }));
      segments.push({ segmentIndex, pdfBuffer: d.pdfBuffer, totalPages: d.totalPages, zones: zones_out });

      // unionToc = zones RÉELLEMENT retenues (zoneRanges), pas le toc brut : une
      // ancre hors plage écartée par partitionPagesByZone ne doit pas être
      // comptée comme « zone manquante » par assertTocCoverage.
      for (const z of zoneRanges) {
        if (seenTocCodes.has(z.code)) continue;
        seenTocCodes.add(z.code);
        unionToc.push({ code: z.code, label: z.label, type: z.type, startPage: z.startPage });
      }
    });

    if (singlePdf) {
      // Mode mono-PDF : retours fins du flux historique pour que le front
      // bascule sur la saisie manuelle (sommaire manuel invalide → 400 ; aucune
      // détection → 422 no_toc + totalPages pour proposer le formulaire).
      if (segments.length === 0) {
        if (manualEntries.length > 0) {
          return res.status(400).json({
            error: `Sommaire manuel invalide : indiquez au moins une zone avec un code et une page de début comprise entre 1 et ${lastTotalPages}.`,
          });
        }
        return res.status(422).json({
          error: "Aucun sommaire détecté dans les premières pages. Vérifiez que c'est bien un règlement PLU avec sommaire.",
          code: "no_toc",
          totalPages: lastTotalPages,
        });
      }
    } else if (failedSegments.length > 0) {
      // Multi-PDF : on REFUSE d'ignorer en silence un PDF sans sommaire — ce
      // serait une perte de données, car le garde-fou de couverture est aveugle
      // aux zones d'un PDF jamais analysé. On échoue en nommant les fichiers
      // fautifs, sans rien écrire en base.
      return res.status(422).json({
        code: "segment_no_toc",
        failedSegments,
        error: `Sommaire introuvable dans ${failedSegments.length} PDF (position ${failedSegments.join(", ")}). `
          + "Retirez les annexes sans règlement, ou importez ce(s) fichier(s) séparément pour saisir le sommaire à la main. "
          + "Aucune donnée n'a été modifiée.",
      });
    }

    const jobId = `${commune.insee_code}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const zoneState = new Map<string, { doneBatches: number; rules: PluRuleInput[]; visionCount: number }>();
    for (const seg of segments) {
      for (const z of seg.zones) {
        zoneState.set(`${seg.segmentIndex}::${z.code}`, { doneBatches: 0, rules: [], visionCount: 0 });
      }
    }
    const job: IngestJob = {
      jobId, segments, toc: unionToc,
      commune: { id: commune.id, name: commune.name, insee_code: commune.insee_code },
      document: documentCtx,
      userId,
      status: "running",
      phase: "Extraction des règles…",
      zoneState,
      createdAt: Date.now(),
    };
    INGEST_JOBS.set(jobId, job);

    // Lance le worker en arrière-plan SANS attendre. Le client n'a qu'à
    // interroger /status pour suivre la progression — il peut fermer l'onglet
    // ou naviguer ailleurs, l'extraction continue côté serveur jusqu'à
    // l'écriture en DB.
    void runIngestJob(job).catch((err) => {
      console.error("[ingest-plu-pdf] worker uncaught", err);
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.phase = "Erreur";
    });

    // Liste à plat des zones (avec leur segment) — le front n'en lit que la
    // longueur pour l'affichage, mais segmentIndex permet aussi à un client
    // d'orchestrer /batch lui-même.
    const zonesFlat = segments.flatMap((s) =>
      s.zones.map((z) => ({ segmentIndex: s.segmentIndex, ...z })));
    res.json({
      jobId,
      commune: { id: commune.id, name: commune.name, insee_code: commune.insee_code },
      segments: segments.map((s) => ({ segmentIndex: s.segmentIndex, totalPages: s.totalPages })),
      totalPages: segments.reduce((acc, s) => acc + s.totalPages, 0),
      zones: zonesFlat,
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

// Worker arrière-plan : extrait tous les lots de toutes les zones, puis
// commit la transaction DB. Ne renvoie rien — le client lit l'avancée via
// /status. Tant que le process Node tourne, le job continue, indépendamment
// de la connexion HTTP qui a lancé /start (l'utilisateur peut fermer l'onglet).
async function runIngestJob(job: IngestJob): Promise<void> {
  // Aplatit tous les lots de tous les segments en une queue, traité par un
  // pool de workers. Chaque entrée porte son segmentIndex pour rendre les pages
  // depuis le bon PDF.
  const queue: Array<{ segmentIndex: number; zoneCode: string; batchIndex: number }> = [];
  for (const seg of job.segments)
    for (const z of seg.zones)
      for (const b of z.batches)
        queue.push({ segmentIndex: seg.segmentIndex, zoneCode: z.code, batchIndex: b.index });

  let next = 0;
  let firstError: Error | null = null;
  // Concurrence serveur volontairement modeste (3) : reste sous le rate limit
  // Mistral et évite de saturer le tier prod sur une seule ingestion.
  const SERVER_CONCURRENCY = 3;
  const MAX_RETRY = 2;

  const processBatch = async (segmentIndex: number, zoneCode: string, batchIndex: number): Promise<void> => {
    const seg = job.segments[segmentIndex]!;
    const zone = seg.zones.find((z) => z.code === zoneCode)!;
    const batch = zone.batches[batchIndex]!;
    const blocks = renderPagesAsBlocksFor(seg.pdfBuffer, batch.firstPage, batch.lastPage - batch.firstPage + 1);
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

- Lis ATTENTIVEMENT les tableaux (notamment l'article 12 stationnement, l'article 13 espaces verts) : chaque ligne du tableau = une règle distincte → un appel save_rule par ligne.
- Un même article peut porter PLUSIEURS règles distinctes selon la destination (habitation, commerce, bureaux, artisanat, hôtellerie…). Émets UN save_rule par destination / catégorie, avec son propre rule_text et sa propre valeur. Ne fusionne pas tout dans une seule règle.
- Si l'article dit "sans objet" ou "non réglementé" → not_regulated = true, appelle quand même save_rule.
- Plusieurs valeurs selon sous-secteurs géographiques (UA1 vs UA2…) → 1 save_rule par sous-secteur si possible, sinon valeur principale dans value_max + variantes dans conditions.
- Si la règle renvoie à un schéma/croquis graphique → needs_vision = true.
- Si la règle renvoie à un document externe (PPRI, PLH, cahier des charges ZAC, arrêté préfectoral, servitude…) → needs_external_doc = true, external_doc_name = nom exact.
- N'invente aucune valeur. Si incertain, omets value_min/max/exact.

CHAMPS « CITOYEN » (citizen_title + citizen_summary) — OBLIGATOIRES, à rédiger SOIGNEUSEMENT :
- citizen_title : titre court (≤ 8 mots) en langage courant. Ex : « Stationnement pour logements individuels », « Hauteur maximale des annexes », « Implantation en limite de propriété ».
- citizen_summary : explication COMPLÈTE en 3 à 6 phrases, langage courant, niveau « particulier qui veut construire chez lui ». Inclus EXPLICITEMENT : la règle, les conditions, les exceptions, les valeurs chiffrées avec unité, ET — si needs_vision = true — décris le schéma associé (ce qu'il montre, ce qu'il autorise, ce qu'il interdit). Phrases complètes, JAMAIS de version 10 mots compacte, pas de bullets, pas de jargon juridique.
- Exemple acceptable (article 7, recul limites) : « Selon la profondeur par rapport à la voie, l'implantation est autorisée soit d'une limite à l'autre, soit avec un retrait minimal. Sur les 20 premiers mètres : retrait de 3 m minimum (ou H/2) pour moins de 3 logements ; 5 m (ou 1,5 × H) pour 3 logements et plus. Au-delà de 20 mètres, l'implantation en limite séparative est interdite. Exceptions : annexes, jumelages, extensions de constructions déjà en limite. Les piscines doivent rester à 3 m minimum. Le schéma associé illustre le calcul de H sur terrain plat ou en pente, et la zone des 20 mètres depuis la voie. »
- citizen_relevant : false UNIQUEMENT si la disposition est purement administrative (procédure dépôt de permis…). True sinon.` },
          ],
        }],
      },
    );
    const rules = ruleMsg.content
      .filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use")
      .map((b) => b.input as PluRuleInput);
    const visionCount = rules.filter((r) => r.needs_vision || r.needs_external_doc).length;
    const st = job.zoneState.get(`${segmentIndex}::${zoneCode}`)!;
    st.rules.push(...rules);
    st.visionCount += visionCount;
    st.doneBatches += 1;
  };

  const worker = async () => {
    while (true) {
      if (firstError) return;
      const i = next++;
      if (i >= queue.length) return;
      const { segmentIndex, zoneCode, batchIndex } = queue[i]!;
      let attempt = 0;
      while (true) {
        try {
          await processBatch(segmentIndex, zoneCode, batchIndex);
          break;
        } catch (e) {
          const status = (e as { status?: number })?.status;
          const transient = status === 429 || status === 529 || (typeof status === "number" && status >= 500);
          if (transient && attempt < MAX_RETRY) {
            await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
            attempt++;
            continue;
          }
          console.error(`[ingest-plu-pdf] worker ${zoneCode} lot ${batchIndex} échoué`, e);
          firstError = e as Error;
          return;
        }
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: SERVER_CONCURRENCY }, worker));
    if (firstError) throw firstError;

    // Fusion inter-segments par code de zone : un PLUi en plusieurs PDF produit
    // un état par (segment, zone) ; on regroupe les règles d'un même code (cf.
    // mergeRulesByZoneCode) avant déduplication.
    // Déduplication finale par texte de règle (cf. dedupeRules). Crucial :
    // on NE déduplique PAS par (article, topic) — un même article peut porter
    // plusieurs règles distinctes (article 12 stationnement par destination,
    // article 11 aspect par élément, etc.).
    const groups = mergeRulesByZoneCode(
      job.segments.flatMap((seg) =>
        seg.zones.map((z) => ({
          code: z.code, label: z.label, type: z.type,
          rules: job.zoneState.get(`${seg.segmentIndex}::${z.code}`)!.rules,
        })),
      ),
    );
    const merged = groups.map((g) => {
      const rules = dedupeRules(g.rules);
      const visionCount = rules.filter(r => r.needs_vision || r.needs_external_doc).length;
      return { zoneDef: g.zoneDef, rules, visionCount };
    });

    assertTocCoverage(job.toc, merged.map((e) => ({ code: e.zoneDef.code, ruleCount: e.rules.length })));

    job.phase = "Enregistrement…";

    // Deux régimes selon le mode du job (cf. doc dans /commit) — la logique
    // est identique : on factorise plus tard si un 3e site apparaît.
    const isDocMode = !!job.document;
    const isEpciDoc = job.document?.porteur === "epci";
    const sourceDocumentId = job.document?.id ?? null;
    const zoneCommuneId = isEpciDoc ? null : job.commune.id;
    const numCoerce = (v: unknown): number | null =>
      v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

    await db.transaction(async (tx) => {
      if (isDocMode) {
        const oldZones = await tx.select({ id: zones.id }).from(zones).where(eq(zones.source_document_id, sourceDocumentId!));
        if (oldZones.length > 0) {
          await tx.delete(zone_regulatory_rules).where(inArray(zone_regulatory_rules.zone_id, oldZones.map((z) => z.id)));
          await tx.delete(zones).where(eq(zones.source_document_id, sourceDocumentId!));
        }
      } else {
        const oldZones = await tx.select({ id: zones.id }).from(zones).where(eq(zones.commune_id, job.commune.id));
        if (oldZones.length > 0) {
          await tx.delete(zone_regulatory_rules).where(inArray(zone_regulatory_rules.zone_id, oldZones.map((z) => z.id)));
          await tx.delete(zones).where(eq(zones.commune_id, job.commune.id));
        }
      }

      for (const { zoneDef, rules } of merged) {
        const [created] = await tx.insert(zones).values({
          commune_id: isDocMode ? zoneCommuneId : job.commune.id,
          source_document_id: sourceDocumentId,
          zone_code: zoneDef.code,
          zone_label: zoneDef.label,
          zone_type: zoneDef.type,
          summary: null,
          status: "active",
          is_active: true,
        }).returning();
        const zoneId = created!.id;
        for (const rule of rules) {
          const articleInt = toArticleInt(rule.article_number);
          await tx.insert(zone_regulatory_rules).values({
            zone_id: zoneId,
            source_document_id: sourceDocumentId,
            article_number: articleInt,
            article_title: rule.article_title ?? (articleInt != null ? `Article ${articleInt}` : ""),
            topic: rule.topic,
            rule_text: rule.rule_text,
            value_min: numCoerce(rule.value_min),
            value_max: numCoerce(rule.value_max),
            value_exact: numCoerce(rule.value_exact),
            unit: rule.unit ?? null,
            conditions: rule.conditions ?? null,
            summary: rule.summary,
            citizen_title: rule.citizen_title?.trim() || null,
            citizen_summary: rule.citizen_summary?.trim() || null,
            citizen_relevant: rule.citizen_relevant !== false,
            instructor_note: [
              rule.needs_vision ? "⚠ Valeur dans un schéma graphique — à vérifier manuellement." : null,
              rule.needs_external_doc ? `⚠ Valeur définie dans un document externe : ${rule.external_doc_name ?? "document non identifié"} — à reporter manuellement.` : null,
            ].filter(Boolean).join(" | ") || null,
            validation_status: "brouillon" as const,
          });
        }
      }

      // Marquage du document comme ingéré (mode document uniquement).
      if (isDocMode) {
        await tx.update(regulatory_documents)
          .set({ status: "ingested", ingested_at: new Date(), updated_at: new Date() })
          .where(eq(regulatory_documents.id, sourceDocumentId!));
      }
    });

    const detail = merged.map((e) => ({ zone: e.zoneDef.code, rules: e.rules.length, vision: e.visionCount }));
    job.result = {
      zones: detail.length,
      rules: detail.reduce((s, z) => s + z.rules, 0),
      needs_review: detail.reduce((s, z) => s + z.vision, 0),
      detail,
    };
    job.status = "done";
    job.phase = "Terminé";
  } catch (e) {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
    job.phase = "Erreur";
  } finally {
    // Libère les PDF (mémoire) dans TOUS les cas — succès comme erreur. Sans le
    // finally, un échec d'extraction laissait tous les buffers (potentiellement
    // plusieurs dizaines de Mo × N segments) épinglés dans INGEST_JOBS jusqu'au
    // GC TTL (1 h). Le résultat/erreur reste consultable via /status entre-temps.
    for (const seg of job.segments) seg.pdfBuffer = Buffer.alloc(0);
  }
}

// GET /admin/ingest-plu-pdf/status?jobId=… — état courant du job (polling).
adminRouter.get("/admin/ingest-plu-pdf/status", async (req: AuthRequest, res) => {
  gcIngestJobs();
  const jobId = String(req.query.jobId ?? "");
  if (!jobId) return res.status(400).json({ error: "jobId requis" });
  const job = INGEST_JOBS.get(jobId);
  if (!job) return res.status(404).json({ error: "Job introuvable ou expiré" });

  // Une entrée par (segment, zone). Le front somme total_batches/done_batches
  // pour la barre de progression — l'agrégation par somme reste correcte même
  // quand un même code apparaît dans plusieurs PDF.
  const zonesStatus = job.segments.flatMap((seg) =>
    seg.zones.map((z) => {
      const st = job.zoneState.get(`${seg.segmentIndex}::${z.code}`);
      const done_batches = st?.doneBatches ?? 0;
      return {
        segmentIndex: seg.segmentIndex,
        code: z.code,
        label: z.label,
        type: z.type,
        total_batches: z.batches.length,
        done_batches,
        rules_so_far: st?.rules.length ?? 0,
        vision_so_far: st?.visionCount ?? 0,
        done: done_batches >= z.batches.length,
      };
    }),
  );
  res.json({
    jobId: job.jobId,
    status: job.status,
    phase: job.phase,
    commune: job.commune,
    zones: zonesStatus,
    result: job.result ?? null,
    error: job.error ?? null,
  });
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
