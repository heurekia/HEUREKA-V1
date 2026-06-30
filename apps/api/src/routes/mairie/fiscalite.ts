import { Router } from "express";
import { db } from "../../db.js";
import {
  communes,
  commune_fiscalite,
  fiscal_national_constants,
  zones,
} from "@heureka-v1/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { getCommuneScope, communeInScope } from "../../middlewares/dossierAccess.js";
import { resolveCommuneActiveZoneIds } from "../../services/communeZones.js";
import { resolveFiscaliteForCommune } from "../../services/fiscaliteResolver.js";
import {
  computeTaxeAmenagement,
  tranchesResidencePrincipale,
  assietteInstallation,
  type TrancheSurfaceTaxable,
  type InstallationTaxable,
} from "../../services/taxeAmenagement.js";

export const fiscaliteRouter = Router();

// Charge une commune par son code INSEE (clé naturelle utilisée côté front) ET
// vérifie qu'elle est dans le périmètre de l'appelant. Renvoie la commune, ou
// null après avoir répondu (404/403).
async function loadCommuneInScope(
  req: AuthRequest,
  res: import("express").Response,
  insee: string,
): Promise<{ id: string; name: string; insee_code: string } | null> {
  const [commune] = await db
    .select({ id: communes.id, name: communes.name, insee_code: communes.insee_code })
    .from(communes)
    .where(eq(communes.insee_code, insee))
    .limit(1);
  if (!commune) {
    res.status(404).json({ error: "Commune introuvable" });
    return null;
  }
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(commune.name, scope)) {
    res.status(403).json({ error: "Commune hors de votre périmètre" });
    return null;
  }
  return commune;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── GET fiscalité résolue (version en vigueur à la date) ──────────────────────
// ?at=YYYY-MM-DD pour rejouer la fiscalité à une date passée (cristallisation).
fiscaliteRouter.get("/communes/:insee/fiscalite", async (req: AuthRequest, res) => {
  try {
    const commune = await loadCommuneInScope(req, res, req.params.insee as string);
    if (!commune) return;
    const atDate = parseDate(req.query.at) ?? undefined;
    const resolved = await resolveFiscaliteForCommune(commune.id, { atDate });
    res.json({ commune: { id: commune.id, name: commune.name, insee_code: commune.insee_code }, fiscalite: resolved });
  } catch (err) {
    console.error("[fiscalite] GET résolue:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── GET zones PLU de la commune (pour rattacher les secteurs à taux majoré) ───
// Les secteurs fiscaux ne sont pas le zonage PLU, mais ils s'y rattachent en
// pratique : on propose les zones réelles de la commune plutôt qu'un libellé
// libre, ce qui permet le matching parcelle→secteur via la zone déjà résolue.
fiscaliteRouter.get("/communes/:insee/zones", async (req: AuthRequest, res) => {
  try {
    const commune = await loadCommuneInScope(req, res, req.params.insee as string);
    if (!commune) return;
    const zoneIds = await resolveCommuneActiveZoneIds(commune.id);
    if (zoneIds.length === 0) return res.json([]);
    const rows = await db
      .select({ zone_code: zones.zone_code, zone_label: zones.zone_label, zone_type: zones.zone_type })
      .from(zones)
      .where(inArray(zones.id, zoneIds))
      .orderBy(zones.display_order, zones.zone_code);
    // Dédup par code (un même code peut apparaître via plusieurs sources).
    const seen = new Set<string>();
    const distinct = rows.filter((z) => {
      if (seen.has(z.zone_code)) return false;
      seen.add(z.zone_code);
      return true;
    });
    res.json(distinct);
  } catch (err) {
    console.error("[fiscalite] GET zones:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── GET historique des versions (cristallisation / audit) ─────────────────────
fiscaliteRouter.get("/communes/:insee/fiscalite/history", async (req: AuthRequest, res) => {
  try {
    const commune = await loadCommuneInScope(req, res, req.params.insee as string);
    if (!commune) return;
    const rows = await db
      .select()
      .from(commune_fiscalite)
      .where(eq(commune_fiscalite.commune_id, commune.id))
      .orderBy(desc(commune_fiscalite.effective_from));
    res.json(rows);
  } catch (err) {
    console.error("[fiscalite] GET history:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── PUT : crée une NOUVELLE VERSION validée de la fiscalité communale ──────────
// Réservé au responsable commune (rôle mairie) et à l'admin — pas aux
// instructeurs. La version en vigueur précédente est clôturée (effective_to) :
// on ne réécrit jamais une version, pour préserver la cristallisation.
fiscaliteRouter.put("/communes/:insee/fiscalite", async (req: AuthRequest, res) => {
  try {
    if (req.user!.role !== "mairie" && req.user!.role !== "admin") {
      return res.status(403).json({ error: "Seul un responsable de la commune peut modifier la fiscalité." });
    }
    const commune = await loadCommuneInScope(req, res, req.params.insee as string);
    if (!commune) return;

    const body = req.body as Record<string, unknown>;
    const part = num(body.part_communale_rate);
    if (part == null || part < 0) {
      return res.status(400).json({ error: "Taux de part communale invalide (nombre ≥ 0 attendu, en %)." });
    }
    if (part > 20) {
      return res.status(400).json({ error: "Taux de part communale > 20 % : au-delà du plafond légal (art. 1635 quater E CGI)." });
    }
    // Secteurs / exonérations : tableaux libres (validés côté UI), tolérés vides.
    const secteurs = Array.isArray(body.secteurs_taux_majore) ? body.secteurs_taux_majore : null;
    const exonerations = Array.isArray(body.exonerations_facultatives)
      ? (body.exonerations_facultatives as unknown[]).map(String)
      : null;
    const deliberationRef = typeof body.deliberation_ref === "string" ? body.deliberation_ref.trim() || null : null;
    const deliberationDate = parseDate(body.deliberation_date);
    const effectiveFrom = parseDate(body.effective_from) ?? new Date();

    // Garde-fou cristallisation : interdit d'antidater AVANT la version ouverte
    // en cours (sinon chevauchement de fenêtres incohérent).
    const [open] = await db
      .select({ effective_from: commune_fiscalite.effective_from })
      .from(commune_fiscalite)
      .where(and(
        eq(commune_fiscalite.commune_id, commune.id),
        eq(commune_fiscalite.status, "valide"),
        isNull(commune_fiscalite.effective_to),
      ))
      .limit(1);
    if (open && effectiveFrom <= open.effective_from) {
      return res.status(409).json({
        error: "La date d'effet doit être postérieure à celle de la version actuellement en vigueur.",
        version_en_vigueur_depuis: open.effective_from,
      });
    }

    const created = await db.transaction(async (tx) => {
      // Clôture la (les) version(s) ouverte(s).
      await tx
        .update(commune_fiscalite)
        .set({ effective_to: effectiveFrom, updated_at: new Date() })
        .where(and(
          eq(commune_fiscalite.commune_id, commune.id),
          eq(commune_fiscalite.status, "valide"),
          isNull(commune_fiscalite.effective_to),
        ));
      const [row] = await tx
        .insert(commune_fiscalite)
        .values({
          commune_id: commune.id,
          part_communale_rate: part,
          secteurs_taux_majore: secteurs as never,
          exonerations_facultatives: exonerations as never,
          deliberation_ref: deliberationRef,
          deliberation_date: deliberationDate,
          effective_from: effectiveFrom,
          effective_to: null,
          status: "valide",
          validated_by: req.user!.id,
          validated_at: new Date(),
          created_by: req.user!.id,
        })
        .returning();
      return row;
    });

    const resolved = await resolveFiscaliteForCommune(commune.id);
    res.status(201).json({ created, fiscalite: resolved });
  } catch (err) {
    console.error("[fiscalite] PUT:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── GET constantes nationales (lecture, pour affichage/aperçu) ────────────────
// ?year=2026 pour un millésime précis, sinon toutes (les plus récentes d'abord).
fiscaliteRouter.get("/fiscalite/constantes", async (req: AuthRequest, res) => {
  try {
    const year = num(req.query.year);
    if (year != null) {
      const [row] = await db
        .select()
        .from(fiscal_national_constants)
        .where(eq(fiscal_national_constants.year, year))
        .limit(1);
      return res.json(row ?? null);
    }
    const rows = await db
      .select()
      .from(fiscal_national_constants)
      .orderBy(desc(fiscal_national_constants.year));
    res.json(rows);
  } catch (err) {
    console.error("[fiscalite] GET constantes:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── POST aperçu de calcul (chaîne complète résolveur → calcul) ────────────────
// Body : { surface_m2, residence_principale?, piscine_m2?, stationnement_places?,
//          exoneration_communale?, at? }. Sert l'aperçu temps réel de l'onglet.
fiscaliteRouter.post("/communes/:insee/fiscalite/preview", async (req: AuthRequest, res) => {
  try {
    const commune = await loadCommuneInScope(req, res, req.params.insee as string);
    if (!commune) return;
    const body = req.body as Record<string, unknown>;
    const atDate = parseDate(body.at) ?? undefined;
    const resolved = await resolveFiscaliteForCommune(commune.id, { atDate });
    if (!resolved.constantes) {
      return res.json({ fiscalite: resolved, calcul: null, note: "Constantes nationales absentes pour ce millésime — aperçu indisponible." });
    }

    const surface = num(body.surface_m2) ?? 0;
    const residencePrincipale = body.residence_principale === true;
    const surfaces: TrancheSurfaceTaxable[] = residencePrincipale
      ? tranchesResidencePrincipale(surface)
      : surface > 0
        ? [{ surface_m2: surface, abattement: false, libelle: "Surface taxable" }]
        : [];

    const installations: InstallationTaxable[] = [];
    const piscine = num(body.piscine_m2);
    if (piscine && piscine > 0 && resolved.forfait_piscine_m2) {
      installations.push(assietteInstallation("Piscine", piscine, resolved.forfait_piscine_m2));
    }
    const places = num(body.stationnement_places);
    if (places && places > 0 && resolved.forfait_stationnement_min) {
      installations.push(assietteInstallation("Stationnement extérieur", places, resolved.forfait_stationnement_min));
    }

    const calcul = computeTaxeAmenagement({
      surfaces,
      installations,
      constantes: resolved.constantes,
      taux_communal_pct: resolved.taux_communal_pct ?? 0,
      taux_departemental_pct: resolved.taux_departemental_pct ?? 0,
      exoneration_communale: body.exoneration_communale === true,
    });

    res.json({ fiscalite: resolved, calcul });
  } catch (err) {
    console.error("[fiscalite] POST preview:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
