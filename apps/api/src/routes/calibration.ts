import { Router } from "express";
import { db } from "../db.js";
import { zones, zone_regulatory_rules } from "@heureka-v1/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { calculateBuildability, type BuildabilityInput } from "../services/buildability.js";

export const calibrationRouter = Router();

calibrationRouter.use(requireAuth);

// ── Lister les zones ──
calibrationRouter.get("/zones", async (_req: AuthRequest, res) => {
  try {
    const list = await db.select().from(zones).orderBy(zones.zone_code);
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Détail d'une zone avec ses règles ──
calibrationRouter.get("/zones/:id", async (req: AuthRequest, res) => {
  try {
    const [zone] = await db.select().from(zones).where(eq(zones.id, req.params.id as string)).limit(1);
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
    const b = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = { updated_at: new Date() };
    // Numeric + classification fields
    for (const f of ["topic", "rule_text", "value_min", "value_max", "value_exact", "unit", "validation_status", "article_number"] as const) {
      if (b[f] !== undefined) updates[f] = b[f];
    }
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

    // Verify the zone exists before inserting (FK + clearer error than a 500)
    const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.id, zone_id)).limit(1);
    if (!zone) return res.status(404).json({ error: "Zone non trouvée" });

    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

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
        // Manually added by an instructor → trusted, marked validated by default
        validation_status: str(b.validation_status) ?? "valide",
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
calibrationRouter.get("/analyse-parcelle/:parcelle", async (req: AuthRequest, res) => {
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
