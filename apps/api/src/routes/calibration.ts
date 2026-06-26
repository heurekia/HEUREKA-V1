import { Router } from "express";
import type { Response } from "express";
import { db } from "../db.js";
import { zones, zone_regulatory_rules, communes } from "@heureka-v1/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { getCommuneScope, communeInScope } from "../middlewares/dossierAccess.js";
import { calculateBuildability, type BuildabilityInput } from "../services/buildability.js";

export const calibrationRouter = Router();

calibrationRouter.use(requireAuth);

/**
 * Vérifie qu'une zone appartient à une commune du scope de l'utilisateur.
 * Renvoie la zone ou null après avoir écrit la réponse 403/404 sur res.
 */
async function loadZoneInScope(req: AuthRequest, res: Response, zoneId: string) {
  const [row] = await db.select({
    id: zones.id,
    commune_id: zones.commune_id,
    commune_name: communes.name,
  })
    .from(zones)
    .leftJoin(communes, eq(zones.commune_id, communes.id))
    .where(eq(zones.id, zoneId))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Zone non trouvée" }); return null; }
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(row.commune_name, scope)) {
    res.status(404).json({ error: "Zone non trouvée" });
    return null;
  }
  return row;
}

/** Idem pour une règle : remonte à la zone puis check le scope. */
async function loadRuleInScope(req: AuthRequest, res: Response, ruleId: string) {
  const [row] = await db.select({
    rule_id: zone_regulatory_rules.id,
    zone_id: zone_regulatory_rules.zone_id,
    commune_name: communes.name,
  })
    .from(zone_regulatory_rules)
    .leftJoin(zones, eq(zone_regulatory_rules.zone_id, zones.id))
    .leftJoin(communes, eq(zones.commune_id, communes.id))
    .where(eq(zone_regulatory_rules.id, ruleId))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Règle non trouvée" }); return null; }
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(row.commune_name, scope)) {
    res.status(404).json({ error: "Règle non trouvée" });
    return null;
  }
  return row;
}

// Convention applicative : aucun autre statut n'est consommé par le moteur
// d'instruction. Toute valeur en dehors de cet ensemble est rejetée en 400
// pour éviter qu'un caller ne plante silencieusement une règle dans un
// statut invisible des filtres.
const VALID_STATUSES = new Set(["valide", "brouillon", "rejete"]);
function normalizeStatus(v: unknown): string | null | undefined {
  if (v === undefined) return undefined; // pas fourni → on n'écrit pas
  if (typeof v !== "string") return null; // signal d'erreur traité par le caller
  const s = v.trim();
  return VALID_STATUSES.has(s) ? s : null;
}

// ── Lister les zones (restreint au scope commune des agents) ──
calibrationRouter.get("/zones", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const scope = await getCommuneScope(req.user!.id, req.user!.role);
    const rows = await db.select({
      id: zones.id, commune_id: zones.commune_id, zone_code: zones.zone_code,
      zone_label: zones.zone_label, zone_type: zones.zone_type, summary: zones.summary,
      geometry: zones.geometry, status: zones.status, constraints: zones.constraints,
      parent_zone_code: zones.parent_zone_code, is_active: zones.is_active,
      display_order: zones.display_order, created_at: zones.created_at, updated_at: zones.updated_at,
      commune_name: communes.name,
    })
      .from(zones)
      .leftJoin(communes, eq(zones.commune_id, communes.id))
      .orderBy(zones.zone_code);
    const filtered = scope === null ? rows : rows.filter(r => communeInScope(r.commune_name, scope));
    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Détail d'une zone avec ses règles (scope commune) ──
calibrationRouter.get("/zones/:id", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const inScope = await loadZoneInScope(req, res, String(req.params.id ?? ""));
    if (!inScope) return;
    const [zone] = await db.select().from(zones).where(eq(zones.id, inScope.id)).limit(1);
    if (!zone) return res.status(404).json({ error: "Zone non trouvée" });
    const rules = await db
      .select()
      .from(zone_regulatory_rules)
      .where(eq(zone_regulatory_rules.zone_id, zone.id))
      .orderBy(zone_regulatory_rules.article_number);
    res.json({ ...zone, rules });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Mettre à jour une règle ──
calibrationRouter.patch("/rules/:id", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    if (!await loadRuleInScope(req, res, String(req.params.id ?? ""))) return;
    const b = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = { updated_at: new Date() };
    // Numeric + classification fields
    for (const f of ["topic", "rule_text", "value_min", "value_max", "value_exact", "unit", "article_number"] as const) {
      if (b[f] !== undefined) updates[f] = b[f];
    }
    // validation_status est traité à part : on rejette les valeurs hors
    // convention pour ne pas créer de règle invisible des filtres.
    const status = normalizeStatus(b.validation_status);
    if (status === null) {
      return res.status(400).json({ error: "validation_status invalide (attendu : valide | brouillon | rejete)" });
    }
    if (status !== undefined) updates.validation_status = status;
    // Qualitative / textual fields (aspect extérieur : matériaux, couleurs, menuiseries, clôtures…)
    for (const f of ["article_title", "conditions", "exceptions", "summary", "instructor_note"] as const) {
      if (b[f] !== undefined) updates[f] = b[f];
    }
    const [rule] = await db
      .update(zone_regulatory_rules)
      .set(updates)
      .where(eq(zone_regulatory_rules.id, req.params.id as string))
      .returning();
    if (!rule) return res.status(404).json({ error: "Règle non trouvée" });
    res.json(rule);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Ajouter une règle manuellement (instructeur) ──
// Permet à un instructeur de compléter le règlement extrait par l'IA — notamment
// les règles qualitatives (aspect : matériaux, couleurs, menuiseries, clôtures).
calibrationRouter.post("/rules", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    const zone_id = typeof b.zone_id === "string" ? b.zone_id : null;
    const rule_text = typeof b.rule_text === "string" ? b.rule_text.trim() : "";
    if (!zone_id) return res.status(400).json({ error: "zone_id requis" });
    if (!rule_text) return res.status(400).json({ error: "rule_text requis" });

    // Verify the zone exists AND appartient au scope de l'utilisateur.
    if (!await loadZoneInScope(req, res, zone_id)) return;

    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

    // Saisie manuelle par un instructeur authentifié → marquée "valide" par
    // défaut (l'acte de poster vaut validation). On valide quand même la valeur
    // si fournie explicitement, pour rejeter toute chaîne hors convention.
    const status = normalizeStatus(b.validation_status);
    if (status === null) {
      return res.status(400).json({ error: "validation_status invalide (attendu : valide | brouillon | rejete)" });
    }

    const [rule] = await db
      .insert(zone_regulatory_rules)
      .values({
        zone_id,
        topic: str(b.topic) ?? "general",
        rule_text,
        article_number: num(b.article_number),
        article_title: str(b.article_title),
        conditions: str(b.conditions),
        exceptions: str(b.exceptions),
        summary: str(b.summary),
        value_min: num(b.value_min),
        value_max: num(b.value_max),
        value_exact: num(b.value_exact),
        unit: str(b.unit),
        instructor_note: str(b.instructor_note),
        validation_status: status ?? "valide",
      })
      .returning();
    res.status(201).json(rule);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Supprimer une règle ──
calibrationRouter.delete("/rules/:id", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    if (!await loadRuleInScope(req, res, String(req.params.id ?? ""))) return;
    const [deleted] = await db
      .delete(zone_regulatory_rules)
      .where(eq(zone_regulatory_rules.id, req.params.id as string))
      .returning({ id: zone_regulatory_rules.id });
    if (!deleted) return res.status(404).json({ error: "Règle non trouvée" });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Analyse parcellaire complète ──
// Réservée aux agents, comme les autres routes calibration : elle renvoie les
// règles réglementaires validées d'une zone. Sans requireRole, un citoyen /
// service_externe authentifié pouvait l'appeler (incohérent avec /zones & co).
calibrationRouter.get("/analyse-parcelle/:parcelle", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const parcelleRef = req.params.parcelle as string;
    const zoneCode = parcelleRef.slice(0, 2).toUpperCase();

    const foundZone = await db.select().from(zones).where(eq(zones.zone_code, zoneCode)).limit(1);
    if (foundZone.length === 0) {
      return res.json({
        parcelle: parcelleRef,
        zone: null,
        rules: [],
        buildability: null,
        conformite: null,
        message: "Zone réglementaire non trouvée pour cette parcelle.",
      });
    }

    const zone = foundZone[0]!;
    const rules = await db
      .select()
      .from(zone_regulatory_rules)
      .where(and(eq(zone_regulatory_rules.zone_id, zone.id), eq(zone_regulatory_rules.validation_status, "valide")))
      .orderBy(zone_regulatory_rules.article_number);

    // Extraire les variables de calcul à partir des règles
    const calcVars: BuildabilityInput["calculationVariables"] = {
      maxFootprintRatio: null,
      maxHeightM: null,
      minSetbackFromRoadM: null,
      minSetbackFromBoundariesM: null,
      parkingRules: null,
      greenSpaceRatio: null,
    };

    for (const rule of rules) {
      if (rule.topic === "emprise_sol") {
        calcVars.maxFootprintRatio = rule.value_exact ?? rule.value_max ?? null;
      }
      if (rule.topic === "hauteur") {
        calcVars.maxHeightM = rule.value_exact ?? rule.value_max ?? null;
      }
      if (rule.topic === "recul_voie") {
        calcVars.minSetbackFromRoadM = rule.value_exact ?? rule.value_min ?? null;
      }
      if (rule.topic === "recul_limite") {
        calcVars.minSetbackFromBoundariesM = rule.value_exact ?? rule.value_min ?? null;
      }
      if (rule.topic === "stationnement" && rule.rule_text) {
        calcVars.parkingRules = rule.rule_text;
      }
      if (rule.topic === "espaces_verts") {
        calcVars.greenSpaceRatio = rule.value_exact ?? rule.value_max ?? null;
      }
    }

    // Parcelle par défaut 500m² sans construction existante
    const input: BuildabilityInput = {
      parcelSurfaceM2: 500,
      existingFootprintM2: 0,
      calculationVariables: calcVars,
    };

    const buildability = calculateBuildability(input);

    // Score de conformité basé sur le nombre de règles trouvées et la confiance
    const conformite = rules.length > 0
      ? Math.round(buildability.confidence * 100)
      : null;

    res.json({
      parcelle: parcelleRef,
      zone: {
        id: zone.id,
        code: zone.zone_code,
        label: zone.zone_label,
        type: zone.zone_type,
      },
      rules,
      buildability,
      conformite_globale: conformite,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
