import { Router } from "express";
import { db } from "../db.js";
import { zones, zone_regulatory_rules } from "@heureka-v1/db";
import { eq, and } from "drizzle-orm";
import { calculateBuildability, type BuildabilityInput } from "../services/buildability.js";

export const publicRouter = Router();

// ── Analyse parcellaire publique (sans auth) ──
publicRouter.get("/analyse-parcelle/:parcelle", async (req, res) => {
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
        conformite_globale: null,
        message: "Zone réglementaire non trouvée pour cette parcelle.",
      });
    }

    const zone = foundZone[0]!;
    const rules = await db
      .select()
      .from(zone_regulatory_rules)
      .where(and(eq(zone_regulatory_rules.zone_id, zone.id), eq(zone_regulatory_rules.validation_status, "valide")))
      .orderBy(zone_regulatory_rules.article_number);

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

    const input: BuildabilityInput = {
      parcelSurfaceM2: 500,
      existingFootprintM2: 0,
      calculationVariables: calcVars,
    };

    const buildability = calculateBuildability(input);
    const conformite = rules.length > 0 ? Math.round(buildability.confidence * 100) : null;

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
