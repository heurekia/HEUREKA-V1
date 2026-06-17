import { Router } from "express";
import { db } from "../../db.js";
import { communes, zones, zone_regulatory_rules, document_segments, document_segment_annotations, ANNOTATION_KINDS } from "@heureka-v1/db";
import { eq, desc, and, sql, ilike, inArray } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requireRole } from "../../middlewares/auth.js";
import { streamAi, type AiContentBlock } from "../../services/aiUsage.js";
import { parseLooseArray } from "../../services/jsonExtract.js";
import { resolveCommuneIdFromUser } from "./_shared.js";

export const reglementationRouter = Router();

// ── Réglementation ────────────────────────────────────────────────────────────

// GET /mairie/reglementation?insee_code=37018 (or legacy ?commune_name=Ballan-Miré)
//
// Renvoie les zones et leurs règles. Filtre safe-by-default : seules les règles
// `validation_status = 'valide'` sont incluses. Tout caller qui doit voir les
// brouillons / rejetées (= UI de validation) doit passer `?include_drafts=true`
// explicitement. Les consommateurs « lecture » (carte, dashboards, futurs
// services) reçoivent ainsi par défaut un référentiel utilisable, sans risque
// de mélange visuel avec du contenu non validé.
reglementationRouter.get("/reglementation", async (req: AuthRequest, res) => {
  try {
    const communeName = (req.query.commune_name as string | undefined)?.trim();
    const inseeCode = (req.query.insee_code as string | undefined)?.trim();
    const includeDrafts = req.query.include_drafts === "true";
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
      const allRules = await db.select().from(zone_regulatory_rules)
        .where(eq(zone_regulatory_rules.zone_id, zone.id))
        .orderBy(zone_regulatory_rules.article_number);

      const stats = {
        total: allRules.length,
        valide: allRules.filter(r => r.validation_status === "valide").length,
        brouillon: allRules.filter(r => r.validation_status === "brouillon" || r.validation_status === "draft").length,
        rejete: allRules.filter(r => r.validation_status === "rejete").length,
      };

      const rules = includeDrafts
        ? allRules
        : allRules.filter(r => r.validation_status === "valide");

      return { ...zone, rules, stats };
    }));

    res.json({ commune, zones: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /mairie/reglementation?insee_code=37018
// Purge toutes les zones + règles d'une commune (ex. retirer des données résiduelles
// avant de réimporter le vrai PLU).
reglementationRouter.delete("/reglementation", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
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
reglementationRouter.patch("/reglementation/rules/:id", async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { rule_text, validation_status, value_min, value_max, value_exact, unit, conditions, exceptions, summary, instructor_note, topic, article_number, article_title, cases, applies_if, sub_theme, citizen_title, citizen_summary, citizen_relevant } = req.body as Record<string, unknown>;

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
    if (citizen_title !== undefined) patch.citizen_title = citizen_title;
    if (citizen_summary !== undefined) patch.citizen_summary = citizen_summary;
    if (citizen_relevant !== undefined) patch.citizen_relevant = citizen_relevant !== false;

    await db.update(zone_regulatory_rules).set(patch).where(eq(zone_regulatory_rules.id, id));
    const [updated] = await db.select().from(zone_regulatory_rules).where(eq(zone_regulatory_rules.id, id)).limit(1);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /mairie/reglementation/rules/:id
reglementationRouter.delete("/reglementation/rules/:id", async (req: AuthRequest, res) => {
  try {
    await db.delete(zone_regulatory_rules).where(eq(zone_regulatory_rules.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/reglementation/zones/:zoneId/rules — add a rule manually
reglementationRouter.post("/reglementation/zones/:zoneId/rules", async (req: AuthRequest, res) => {
  try {
    const zone_id = req.params.zoneId as string;
    const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.id, zone_id)).limit(1);
    if (!zone) return res.status(404).json({ error: "Zone non trouvée" });

    const { article_number, article_title, topic, rule_text, value_min, value_max, value_exact, unit, conditions, exceptions, summary, cases, applies_if, sub_theme, citizen_title, citizen_summary, citizen_relevant } = req.body as Record<string, unknown>;
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
      citizen_title: (citizen_title as string | undefined) ?? null,
      citizen_summary: (citizen_summary as string | undefined) ?? null,
      citizen_relevant: citizen_relevant !== false,
      validation_status: "brouillon",
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/reglementation/zones/:zoneId/rules/bulk — ajout en masse (sous-règles)
reglementationRouter.post("/reglementation/zones/:zoneId/rules/bulk", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
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
        citizen_title: str(r.citizen_title),
        citizen_summary: str(r.citizen_summary),
        citizen_relevant: r.citizen_relevant !== false,
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
//
// Streaming SSE : la passerelle (Railway/Cloudflare) coupe sans préavis une
// requête HTTP « silencieuse » qui dépasse ~100 s — l'utilisateur voit alors
// un 502 ALORS QUE Anthropic a déjà facturé la génération. Le stream Anthropic
// est forwardé au client en heartbeats SSE → la passerelle voit du trafic
// régulier → plus de 502. À la fin, on parse l'accumulé et on envoie les
// règles dans un événement `done`.
reglementationRouter.post("/reglementation/structure-article", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  const { text, zone_code, article_number, image_base64, image_media_type } = req.body as { text?: string; zone_code?: string; article_number?: number | string; image_base64?: string; image_media_type?: string };
  const hasImage = typeof image_base64 === "string" && image_base64.length > 0;
  if ((!text || text.trim().length < 5) && !hasImage) return res.status(400).json({ error: "Texte de l'article ou image requis" });

  // Image (tableau / croquis) → vision Pixtral.
  const userContent: AiContentBlock[] = [];
  if (hasImage) {
    const media = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image_media_type ?? "") ? image_media_type! : "image/png";
    userContent.push({ type: "image", source: { type: "base64", media_type: media, data: image_base64! } });
  }
  const prefix = `${zone_code ? `Zone ${zone_code}. ` : ""}${article_number ? `Article ${article_number}. ` : ""}`;
  userContent.push({ type: "text", text: `${prefix}\n\n${text ?? "(Voir le tableau / croquis fourni en image.)"}` });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as unknown as { flush?: () => void }).flush?.();
  };

  try {
    send({ type: "started" });

    const communeId = await resolveCommuneIdFromUser(req);

    let accumulated = "";
    let lastHeartbeat = Date.now();
    const stream = await streamAi(
      { purpose: "plu_article_structure", userId: req.user?.id ?? null, communeId },
      {
      model: "ai-smart",
      max_tokens: 6000,
      system: `Tu es un expert en droit de l'urbanisme français. On te donne le TEXTE d'UN article de règlement PLU (souvent long, avec sous-sections) ET/OU une IMAGE (tableau ou croquis).

Si une IMAGE est fournie : lis-la attentivement. Pour un TABLEAU (ex: stationnement art. 12 — colonne « Type »/« Destination » → colonne « Normes »), CHAQUE LIGNE devient une SOUS-RÈGLE (sub_theme = le type, ex: « Habitation », « Bureaux », « Commerce »). Les tranches/seuils d'une même ligne (ex: « 1 place/40 m² entre 300 et 1000 m² », « 1 place/30 m² au-delà de 1000 m² ») deviennent des "cases" (kind "parametre"). Pour un CROQUIS, décris la règle dans rule_text.

Structure le contenu et renvoie UNIQUEMENT un tableau JSON, sans autre texte. Format de chaque objet :
[
  {
    "sub_theme": string,            // numéro + intitulé de la sous-section, ex: "10.1 Calcul de la hauteur", "10.2 Tolérances", "10.3 Hauteurs relatives — prospect H ≤ L", "10.4 Secteurs UMr / UMs", "10.5 Secteur UMz"
    "article_number": number|null,
    "article_title": string,
    "topic": "interdictions|conditions|desserte_voies|desserte_reseaux|terrain_min|recul_voie|recul_limite|recul_batiments|emprise_sol|hauteur|aspect|stationnement|espaces_verts|cos|general",
    "rule_text": string,            // TEXTE QUALITATIF FIDÈLE de CETTE sous-règle (la prose EST la règle ; ne pas sur-résumer)
    "value_min": number|null, "value_max": number|null, "value_exact": number|null,
    "unit": "m|cm|%|m²|places"|null,
    "conditions": string|null,
    "exceptions": string|null,      // dérogations « sauf… / à l'exception de… / hormis… » PROPRES à cette sous-règle
    "summary": string,              // ≤ 15 mots, décrit CETTE sous-règle (pas l'article entier)
    "cases": [ { "condition": string, "value": number|null, "unit": "m|cm|%|m²|places"|null, "kind": "condition|parametre" } ],
    "applies_if": [ ],              // tags d'applicabilité, parmi : protege_l151_19, unesco, abf, inondable, extension, surelevation, ravalement, demolition, cloture_sur_rue, cloture_limite, annexe, devanture_commerciale, equipement_public. [] si général.
    "citizen_title": string,        // TITRE COURT citoyen (2–5 mots, sans jargon), ex: "Hauteur des maisons", "Clôtures sur la rue", "Places de parking"
    "citizen_summary": string,      // UNE phrase simple, concrète, en « vous », avec la valeur clé. Ex: "Votre maison ne peut pas dépasser 10 mètres de haut." Pas de jargon, pas de n° d'article.
    "citizen_relevant": boolean     // false pour les dispositions sans intérêt pour un particulier : articles « sans objet »/abrogés (loi ALUR : superficie minimale, COS), desserte par les réseaux, voiries internes. true par défaut.
  }
]

DÉCOUPAGE — RÈGLE IMPÉRATIVE :
- UN OBJET PAR SOUS-RÈGLE DISTINCTE de l'article. Un article qui couvre plusieurs thèmes (méthode de calcul, tolérances, règle du prospect, plafonds par secteur, retournement d'angle…) doit produire AUTANT d'objets que de sous-règles autoportantes. Ne fusionne PAS « tolérance », « prospect », « hauteur max en UMr/UMs » et « retournement d'angle UMz » en une règle unique : ce sont des régimes différents avec des valeurs différentes et des applicabilités différentes.
- Quand l'article fournit une sous-section numérotée (10.1, 10.2, …) ou un paragraphe clairement étiqueté (« Calcul : … », « Tolérance : … », « Hauteurs relatives : … », « En secteurs UMr et UMs : … », « Secteur UMz : … », « Retour sur voie adjacente : … »), CHAQUE bloc devient UN objet avec un sub_theme explicite.
- À l'inverse, NE découpe PAS une énumération à l'intérieur d'une même sous-règle : plusieurs valeurs conditionnelles d'une MÊME règle (ex: « 10 m sens unique / 13 m double sens ») = autant de "cases" dans la MÊME règle, JAMAIS une nouvelle règle.
- TABLEAU (image) : chaque LIGNE du tableau (type → norme) = un objet (comme avant).

AUTRES RÈGLES :
- "rule_text" : conserve le sens qualitatif (matériaux, teintes, prescriptions) — pour l'aspect (art. 11) c'est l'essentiel, ne le réduis PAS à un nombre. Reste SYNTHÉTIQUE sur les passages très longs.
- "exceptions" : repère les DÉROGATIONS de CETTE sous-règle (« sauf… », « à l'exception de… », « hormis… »). null si aucune.
- "applies_if" : tague une sous-règle qui ne s'applique qu'à un contexte spécifique. Pour des règles propres à un SECTEUR (UMr, UMs, UMz), précise-le dans sub_theme plutôt que dans applies_if (qui sert aux contextes parcellaires).
- VALEUR PRINCIPALE (value_*) = LE seuil de CETTE sous-règle. Respecte min ("≥") vs max ("≤"). NE MÉLANGE JAMAIS valeur et unité. Si rien de chiffré → value_* null.
- "cases" : à utiliser UNIQUEMENT pour des éléments porteurs d'une VALEUR chiffrée ou d'une vraie ALTERNATIVE conditionnelle au sein d'une MÊME sous-règle.
  NE crée PAS de cases pour une simple énumération QUALITATIVE sans valeur (liste d'occupations interdites, de matériaux…) : elle reste dans "rule_text".
- N'invente AUCUNE valeur. Articles 5 et 14 → "sans objet" (loi ALUR) ET citizen_relevant=false.
- VERSION CITOYEN ("citizen_title" + "citizen_summary") : OBLIGATOIRE par sous-règle, COMPRÉHENSIBLE par quelqu'un qui découvre l'urbanisme. Phrases courtes, mots du quotidien, valeur concrète mise en avant. Évite « emprise au sol » → dis « la surface que votre maison occupe au sol ». Ne recopie PAS les exceptions juridiques dans citizen_summary (elles restent dans "exceptions").`,
      messages: [{ role: "user", content: userContent }],
      },
    );

    // Forward des deltas de texte en heartbeats : la passerelle voit du
    // trafic, le client peut afficher une progression réelle. On limite à un
    // heartbeat toutes les 1.5 s pour ne pas saturer.
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        accumulated += event.delta.text;
        if (Date.now() - lastHeartbeat > 1500) {
          send({ type: "progress", chars: accumulated.length });
          lastHeartbeat = Date.now();
        }
      }
    }

    // Tracking ai_usage_events automatique lors de finalMessage().
    const finalMessage = await stream.finalMessage();
    const raw = accumulated || (finalMessage.content[0]?.text ?? "[]");
    const stopReason = finalMessage.stop_reason;

    // Parsing tolérant : si la réponse est tronquée (max_tokens), on récupère les
    // sous-règles COMPLÈTES en fermant l'array au dernier objet entier.
    const arr = parseLooseArray(raw);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const APPLIES = new Set(["protege_l151_19", "unesco", "abf", "inondable", "extension", "surelevation", "ravalement", "demolition", "cloture_sur_rue", "cloture_limite", "annexe", "devanture_commerciale", "equipement_public"]);
    let rules = (Array.isArray(arr) ? arr : [])
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
              // On ne garde QUE les cas porteurs d'une VALEUR chiffrée (pas de « — m » :
              // une énumération qualitative ou un seuil sans nombre reste dans rule_text).
              .filter((c) => c.condition && c.value != null)
          : [],
        applies_if: Array.isArray(r.applies_if)
          ? (r.applies_if as unknown[]).map(str).filter((t): t is string => !!t && APPLIES.has(t))
          : [],
        citizen_title: str(r.citizen_title),
        citizen_summary: str(r.citizen_summary),
        citizen_relevant: r.citizen_relevant !== false,
      }))
      .filter((r) => r.rule_text || r.summary);

    // Repli : rien d'exploitable → une sous-règle brute avec le texte collé.
    if (rules.length === 0) {
      rules.push({ sub_theme: null, article_number: article_number ? Number(article_number) : null, article_title: "", topic: "general", rule_text: (text ?? "").trim() || "Voir le tableau / croquis fourni.", value_min: null, value_max: null, value_exact: null, unit: null, conditions: null, exceptions: null, summary: "", cases: [], applies_if: [], citizen_title: null, citizen_summary: null, citizen_relevant: true });
    }

    // Diagnostic explicite si la sortie a été coupée — l'instructeur saura
    // qu'il doit raccourcir / découper plutôt que de retenter à l'identique
    // (et repayer les mêmes tokens).
    const diagnostic = stopReason === "max_tokens"
      ? "Réponse IA tronquée (limite de 6000 tokens atteinte). Les règles complètes ont été conservées ; pour récupérer la fin, soumettez le reste de l'article séparément."
      : undefined;

    send({ type: "done", rules, stop_reason: stopReason, diagnostic });
    res.end();
  } catch (err) {
    console.error("[structure-article]", err);
    send({ type: "error", message: err instanceof Error ? err.message : "Échec de l'analyse IA — réessayez ou saisissez manuellement." });
    res.end();
  }
});

// POST /mairie/reglementation/structure-zone
// « Agent » de structuration ZONE : l'instructeur colle le règlement COMPLET d'une
// zone (tous les articles, déjà résumés). Claude (Sonnet) renvoie une liste de
// (sous-)règles découpées par sous-section, chacune pré-remplie ET dotée de sa
// version « citoyen » (titre court + une phrase simple). L'instructeur valide.
//
// Streaming SSE : même justification que structure-article, accentuée ici par
// le max_tokens 16k qui peut prendre 2-3 min. Sans streaming la passerelle
// coupe systématiquement → 502 + facturation perdue.
reglementationRouter.post("/reglementation/structure-zone", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  const { text, zone_code } = req.body as { text?: string; zone_code?: string };
  // Le seuil bas accepte les chunks courts légitimes (Préambule, article
  // « sans objet ») produits par le découpage par article côté front.
  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: "Texte vide ou trop court — collez le règlement complet de la zone." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as unknown as { flush?: () => void }).flush?.();
  };

  try {
    send({ type: "started" });

    const communeId = await resolveCommuneIdFromUser(req);

    let accumulated = "";
    let lastHeartbeat = Date.now();
    const stream = await streamAi(
      { purpose: "plu_zone_structure", userId: req.user?.id ?? null, communeId },
      {
      model: "ai-smart",
      // Un règlement complet (14 articles × plusieurs sous-règles citoyen+mairie)
      // dépasse facilement 6 k tokens et provoquait des sorties tronquées. Avec
      // 16 k on couvre les zones les plus chargées sans surcoût significatif
      // (facturation au token réellement émis).
      max_tokens: 16000,
      system: `Tu es un expert en droit de l'urbanisme français. On te donne le texte d'UN article (ou d'un extrait) de règlement de PLU, souvent déjà résumé, avec valeurs et seuils.

Ta mission : découper ce texte en (SOUS-)RÈGLES exploitables, et pour CHACUNE produire EN PLUS une version « citoyen » en langage courant (pour un particulier qui n'y connaît rien).

DÉCOUPAGE — par SOUS-SECTION :
- Crée UNE règle par sous-section thématique cohérente (chaque puce / paragraphe distinct d'un article). Ex. Article 11 « Aspect » → 4 règles : Bâtiments protégés ; Façades et vitrines ; Toitures ; Clôtures. Article 9 « Emprise au sol » → règle générale + dérogations + extensions.
- Si un article ne contient qu'un seul thème, une seule règle suffit.
- IGNORE complètement les articles « sans objet » / abrogés (loi ALUR : superficie minimale, COS) et les articles « non réglementé ». Ne crée AUCUNE règle pour eux.

Renvoie UNIQUEMENT un tableau JSON, sans autre texte. Format de chaque objet :
[
  {
    "sub_theme": string,            // numéro + intitulé, ex: "7.1 Dans les 15 premiers mètres", "11.4 Clôtures", "12.1 Stationnement automobile"
    "article_number": number|null,  // n° d'article d'origine (1–16)
    "article_title": string,        // intitulé de l'article, ex: "Implantation par rapport aux limites séparatives"
    "topic": "interdictions|conditions|desserte_voies|desserte_reseaux|terrain_min|recul_voie|recul_limite|recul_batiments|emprise_sol|hauteur|aspect|stationnement|espaces_verts|cos|general",
    "rule_text": string,            // texte réglementaire fidèle et synthétique de la sous-règle
    "value_min": number|null, "value_max": number|null, "value_exact": number|null,
    "unit": "m|cm|%|m²|places"|null,
    "conditions": string|null,
    "exceptions": string|null,      // dérogations « sauf… / à l'exception de… / hormis… »
    "summary": string,              // résumé technique ≤ 15 mots (pour la mairie)
    "cases": [ { "condition": string, "value": number|null, "unit": "m|cm|%|m²|places"|null, "kind": "condition|parametre" } ],
    "applies_if": [ ],              // tags : protege_l151_19, unesco, abf, inondable, extension, surelevation, ravalement, demolition, cloture_sur_rue, cloture_limite, annexe, devanture_commerciale, equipement_public. [] si général.
    "citizen_title": string,        // TITRE COURT citoyen (2–5 mots, sans jargon), ex: "Hauteur des maisons", "Clôtures sur la rue", "Places de parking"
    "citizen_summary": string,      // UNE phrase simple, concrète, en « vous », avec la valeur clé. Ex: "Votre maison ne peut pas dépasser 10 mètres de haut." / "Un mur sur rue ne doit pas dépasser 1,80 m." Pas de jargon, pas de n° d'article.
    "citizen_relevant": boolean     // false UNIQUEMENT pour les dispositions purement techniques/administratives sans intérêt pour un particulier (ex: desserte réseaux, voiries internes de lotissement). true par défaut.
  }
]

RÈGLES DE STRUCTURATION :
- VALEUR PRINCIPALE (value_*) = LE seuil de la sous-règle dans une unité COHÉRENTE. Respecte min ("≥","au moins") vs max ("≤","ne dépasse pas"). NE MÉLANGE JAMAIS valeur et unité.
- "cases" : pour les seuils/alternatives chiffrés multiples d'une même sous-règle (ex: voirie 10 m sens unique / 13 m double sens → 2 cases ; stationnement commerces 0/40 m²/30 m² → cases). kind "condition" = alternative exclusive ; "parametre" = valeur cumulative. Pas de case sans valeur chiffrée.
- "applies_if" : tag de contexte (clôtures sur rue → cloture_sur_rue ; éléments protégés → protege_l151_19 ; UNESCO → unesco ; zone inondable → inondable ; extension → extension ; surélévation → surelevation).
- N'invente AUCUNE valeur. Reste fidèle au texte fourni.
- La version « citoyen » doit être COMPRÉHENSIBLE par quelqu'un qui découvre l'urbanisme : phrases courtes, mots du quotidien, valeur concrète mise en avant. Évite « emprise au sol », dis « la surface que votre maison occupe au sol ».`,
      messages: [{ role: "user", content: `${zone_code ? `Zone ${zone_code}.\n\n` : ""}${text}` }],
      },
    );

    // Forward des deltas en heartbeats : passerelle alive + progression visible.
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        accumulated += event.delta.text;
        if (Date.now() - lastHeartbeat > 1500) {
          send({ type: "progress", chars: accumulated.length });
          lastHeartbeat = Date.now();
        }
      }
    }

    // Tracking ai_usage_events automatique lors de finalMessage().
    const finalMessage = await stream.finalMessage();
    const raw = accumulated || (finalMessage.content[0]?.text ?? "");
    const stopReason = finalMessage.stop_reason;
    const arr = parseLooseArray(raw);
    // Trace de débogage utile : le modèle a parlé mais on n'extrait rien.
    // Pointe à coup sûr vers un nouveau format de sortie (wrapper inconnu,
    // fence non standard…) — le snippet permet d'adapter le parseur.
    if (arr.length === 0 && raw.trim().length > 10) {
      console.warn("[structure-zone] parseLooseArray returned 0 elements from non-empty response", {
        zone_code,
        stop_reason: stopReason,
        raw_length: raw.length,
        raw_head: raw.slice(0, 200),
        raw_tail: raw.slice(-200),
      });
    }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const APPLIES = new Set(["protege_l151_19", "unesco", "abf", "inondable", "extension", "surelevation", "ravalement", "demolition", "cloture_sur_rue", "cloture_limite", "annexe", "devanture_commerciale", "equipement_public"]);
    const rules = (Array.isArray(arr) ? arr : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        sub_theme: str(r.sub_theme),
        article_number: num(r.article_number),
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
              .filter((c) => c.condition && c.value != null)
          : [],
        applies_if: Array.isArray(r.applies_if)
          ? (r.applies_if as unknown[]).map(str).filter((t): t is string => !!t && APPLIES.has(t))
          : [],
        citizen_title: str(r.citizen_title),
        citizen_summary: str(r.citizen_summary),
        citizen_relevant: r.citizen_relevant !== false,
      }))
      .filter((r) => r.rule_text || r.summary);

    // Diagnostic explicite quand 0 règle : permet au front d'expliquer
    // précisément le problème à l'instructeur (parsing ko, troncature, article
    // « sans objet », règles dropées car rule_text/summary vides…).
    let diagnostic: string | undefined;
    if (rules.length === 0) {
      if (raw.trim().length === 0) {
        diagnostic = "Réponse IA vide.";
      } else if (arr.length === 0) {
        diagnostic = stopReason === "max_tokens"
          ? "Réponse IA tronquée (max_tokens atteint) et non récupérable. Réessayez ou réduisez la taille du texte."
          : "Réponse IA non parsable (format inattendu).";
      } else {
        diagnostic = `Aucune règle exploitable extraite (${arr.length} objet${arr.length > 1 ? "s" : ""} reçu${arr.length > 1 ? "s" : ""} sans rule_text ni summary). L'article est peut-être « sans objet » ou abrogé.`;
      }
    }

    send({ type: "done", rules, stop_reason: stopReason, diagnostic });
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[structure-zone]", msg);
    send({ type: "error", message: `Échec de l'analyse IA : ${msg}` });
    res.end();
  }
});

// GET /mairie/documents/search?q=...&insee=...&doc_types=PPRI,OAP&top_k=5
reglementationRouter.get("/documents/search", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const query = (req.query.q as string | undefined)?.trim();
    const insee = (req.query.insee as string | undefined)?.trim();
    const doc_types = (req.query.doc_types as string | undefined)?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const top_k = req.query.top_k ? Math.min(Math.max(1, parseInt(req.query.top_k as string, 10)), 20) : 5;

    if (!query || !insee) return res.status(400).json({ error: "q et insee requis" });

    const { searchInCommune } = await import("../../services/ragService.js");
    const hits = await searchInCommune({ query, insee, doc_types, top_k });
    res.json({ query, insee, hits });
  } catch (err) {
    console.error("[rag-search]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// ── Annotations chunk-level (Phase 1 niveau B) ──────────────────────────────
const ANNOTATION_KINDS_SET = new Set(ANNOTATION_KINDS as readonly string[]);
const VALID_STATUSES_SET = new Set(["brouillon", "valide", "rejete"]);
const VISIBILITIES_SET = new Set(["private", "shared"]);

// GET /mairie/documents/:docId/segments — liste les chunks indexés d'un
// document avec leur métadonnée + annotations. Sert au visualiseur côté UI
// pour permettre à l'instructeur d'annoter passage par passage.
reglementationRouter.get("/documents/:docId/segments", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const docId = req.params.docId as string;
    const segs = await db.select({
      id: document_segments.id,
      segment_code: document_segments.segment_code,
      raw_text: document_segments.raw_text,
      metadata: document_segments.metadata,
      char_count: document_segments.char_count,
    })
      .from(document_segments)
      .where(sql`${document_segments.metadata}->>'source_id' = ${docId}`)
      .orderBy(document_segments.segment_code);

    // Annotations TOUTES STATUS (pas seulement validées) — l'instructeur
    // doit voir aussi les brouillons et rejets dans le visualiseur pour les
    // gérer.
    const segmentIds = segs.map((s) => s.id);
    const annsRows = segmentIds.length > 0
      ? await db.select().from(document_segment_annotations)
          .where(inArray(document_segment_annotations.segment_id, segmentIds))
      : [];
    const annsBySegment = new Map<string, typeof annsRows>();
    for (const a of annsRows) {
      // Cette vue n'agrège que les annotations chunk-level. Les annotations
      // PDF-level (segment_id null, 3.C.3) sont récupérées séparément côté UI
      // via GET /documents/:docId/annotations.
      if (!a.segment_id) continue;
      const arr = annsBySegment.get(a.segment_id) ?? [];
      arr.push(a);
      annsBySegment.set(a.segment_id, arr);
    }

    res.json(segs.map((s) => ({
      ...s,
      annotations: annsBySegment.get(s.id) ?? [],
    })));
  } catch (err) {
    console.error("[segments:list]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/documents/:docId/annotations — créer une annotation PDF-level
// (3.C.3). Pas de segment_id : la position visuelle est portée par page +
// quote + highlight_rects. Le RAG matchera ensuite par chevauchement texte
// au moment du search pour réinjecter l'annotation à côté du bon chunk.
reglementationRouter.post("/documents/:docId/annotations", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const docId = req.params.docId as string;
    const { kind, note, applies_if, visibility, page, quote, highlight_rects } = req.body as {
      kind?: string; note?: string; applies_if?: string[]; visibility?: string;
      page?: number; quote?: string; highlight_rects?: unknown[];
    };

    if (!note || !note.trim()) return res.status(400).json({ error: "note requise" });
    if (typeof page !== "number" || !Number.isFinite(page) || page < 1) {
      return res.status(400).json({ error: "page (>= 1) requise" });
    }
    const finalKind = kind && ANNOTATION_KINDS_SET.has(kind) ? kind : "note_perso";
    const finalVisibility = visibility && VISIBILITIES_SET.has(visibility) ? visibility : "private";
    const rects = Array.isArray(highlight_rects) ? highlight_rects : [];

    const [created] = await db.insert(document_segment_annotations).values({
      segment_id: null,
      source_id: docId,
      kind: finalKind,
      note: note.trim(),
      applies_if: Array.isArray(applies_if) ? applies_if : [],
      visibility: finalVisibility,
      validation_status: "brouillon",
      author_user_id: req.user?.id ?? null,
      page,
      quote: typeof quote === "string" ? quote.slice(0, 2000) : null,
      highlight_rects: rects,
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("[annotations:create-pdf]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /mairie/documents/:docId/annotations — liste toutes les annotations
// d'un document (tous statuts). Sert au panneau de validation côté UI et
// à la restauration des surlignages dans le viewer PDF.
reglementationRouter.get("/documents/:docId/annotations", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const docId = req.params.docId as string;
    const rows = await db.select().from(document_segment_annotations)
      .where(eq(document_segment_annotations.source_id, docId))
      .orderBy(desc(document_segment_annotations.created_at));
    res.json(rows);
  } catch (err) {
    console.error("[annotations:list]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/segments/:segmentId/annotations — créer une annotation.
// Le statut initial est "brouillon" — il faut une action explicite de
// validation pour qu'elle remonte dans le RAG.
reglementationRouter.post("/segments/:segmentId/annotations", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const segmentId = req.params.segmentId as string;
    const { kind, note, applies_if, visibility } = req.body as {
      kind?: string; note?: string; applies_if?: string[]; visibility?: string;
    };

    if (!note || !note.trim()) return res.status(400).json({ error: "note requise" });
    const finalKind = kind && ANNOTATION_KINDS_SET.has(kind) ? kind : "note_perso";
    // Défaut 'private' = opt-in explicite pour partager à l'IA.
    const finalVisibility = visibility && VISIBILITIES_SET.has(visibility) ? visibility : "private";

    // Récupère le segment pour reporter source_id (= commune_documents.id).
    const [seg] = await db.select({ id: document_segments.id, metadata: document_segments.metadata })
      .from(document_segments).where(eq(document_segments.id, segmentId)).limit(1);
    if (!seg) return res.status(404).json({ error: "Segment introuvable" });
    const meta = (seg.metadata ?? {}) as Record<string, unknown>;
    const sourceId = typeof meta.source_id === "string" ? meta.source_id : null;
    if (!sourceId) return res.status(400).json({ error: "Segment sans source_id (incohérence d'index)" });

    const [created] = await db.insert(document_segment_annotations).values({
      segment_id: segmentId,
      source_id: sourceId,
      kind: finalKind,
      note: note.trim(),
      applies_if: Array.isArray(applies_if) ? applies_if : [],
      visibility: finalVisibility,
      validation_status: "brouillon",
      author_user_id: req.user?.id ?? null,
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("[annotations:create]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /mairie/annotations/:id — modifier OU valider/rejeter.
// Toute modification de la note rebascule en brouillon (anti-édit silencieux).
reglementationRouter.patch("/annotations/:id", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { note, kind, applies_if, validation_status, visibility } = req.body as {
      note?: string; kind?: string; applies_if?: string[];
      validation_status?: "brouillon" | "valide" | "rejete";
      visibility?: "private" | "shared";
    };

    const patch: {
      note?: string; kind?: string; applies_if?: string[];
      validation_status?: string; validated_by?: string | null; validated_at?: Date | null;
      visibility?: string; updated_at: Date;
    } = { updated_at: new Date() };

    const noteChanged = note !== undefined;
    if (noteChanged) {
      if (!note.trim()) return res.status(400).json({ error: "note non vide requise" });
      patch.note = note.trim();
    }
    if (kind !== undefined) {
      if (!ANNOTATION_KINDS_SET.has(kind)) return res.status(400).json({ error: "kind invalide" });
      patch.kind = kind;
    }
    if (applies_if !== undefined) {
      if (!Array.isArray(applies_if)) return res.status(400).json({ error: "applies_if doit être un tableau" });
      patch.applies_if = applies_if;
    }
    if (visibility !== undefined) {
      if (!VISIBILITIES_SET.has(visibility)) return res.status(400).json({ error: "visibility invalide" });
      patch.visibility = visibility;
    }

    if (validation_status) {
      if (!VALID_STATUSES_SET.has(validation_status)) {
        return res.status(400).json({ error: "validation_status invalide" });
      }
      patch.validation_status = validation_status;
      if (validation_status === "valide") {
        if (!req.user?.id) return res.status(401).json({ error: "Authentification requise pour valider" });
        patch.validated_by = req.user.id;
        patch.validated_at = new Date();
      } else {
        patch.validated_by = null;
        patch.validated_at = null;
      }
    } else if (noteChanged || kind !== undefined || applies_if !== undefined) {
      // Édition de fond sans validation explicite → bascule auto en brouillon.
      patch.validation_status = "brouillon";
      patch.validated_by = null;
      patch.validated_at = null;
    }

    const [updated] = await db.update(document_segment_annotations).set(patch)
      .where(eq(document_segment_annotations.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Annotation introuvable" });
    res.json(updated);
  } catch (err) {
    console.error("[annotations:patch]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

reglementationRouter.delete("/annotations/:id", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(document_segment_annotations).where(eq(document_segment_annotations.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error("[annotations:delete]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

reglementationRouter.post(
  "/reglementation/import-canonical",
  requireRole("mairie", "instructeur", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const { parseCanonical, importCanonical } = await import("@heureka-v1/ingestion/canonical");
      const parsed = parseCanonical(req.body);
      if (!parsed.ok) {
        return res.status(400).json({
          error: "Format canonique invalide",
          schema_errors: parsed.errors,
        });
      }
      const result = await importCanonical(parsed.data!);
      res.json({
        ok: true,
        ...result,
        warnings: parsed.warnings ?? [],
      });
    } catch (err) {
      console.error("[import-canonical]", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
    }
  },
);

reglementationRouter.post("/reglementation/zones", async (req: AuthRequest, res) => {
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
reglementationRouter.delete("/reglementation/zones/:id", async (req: AuthRequest, res) => {
  try {
    await db.delete(zone_regulatory_rules).where(eq(zone_regulatory_rules.zone_id, req.params.id as string));
    await db.delete(zones).where(eq(zones.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// PATCH /mairie/reglementation/zones/:id — update zone label/summary
reglementationRouter.patch("/reglementation/zones/:id", async (req: AuthRequest, res) => {
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
