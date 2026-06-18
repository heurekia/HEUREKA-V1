import { Router } from "express";
import { db } from "../../db.js";
import { dossiers, communes } from "@heureka-v1/db";
import { eq, desc, sql, ilike } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requireAuth } from "../../middlewares/auth.js";
import { analyseParcel } from "../../services/parcelAnalysis.js";
import {
  computeInstructionDelay,
  applyMonthsToDate,
  type DeadlineMetadata,
  type DeadlineServitude,
} from "../../services/instructionDelays.js";
import { refreshPluZones, pluEtagFor, filterZonesByInsee, PLU_CACHE_TTL_MS, type PluZonesGeoJson } from "../../services/pluZones.js";
import { fetchSitadelHistory } from "../../services/sitadelHistory.js";

export const parcelleRouter = Router();

parcelleRouter.get("/map-dossiers", async (req: AuthRequest, res) => {
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
          ? sql`commune ILIKE ${commune} AND adresse IS NOT NULL AND status != 'brouillon'`
          : sql`adresse IS NOT NULL AND status != 'brouillon'`
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

parcelleRouter.get("/dossiers/:id/analyse-parcelle", async (req: AuthRequest, res) => {
  try {
    const qOverride = (req.query.q as string | undefined)?.trim();

    // Always fetch the dossier — we need commune info for the INSEE lookup even when
    // an address override is provided via ?q=, to constrain BAN to the right commune.
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const communeName = dossier.commune ?? null;

    // Look up commune INSEE code FIRST — needed to expand partial cadastral refs.
    // We require an EXACT case-insensitive match: a substring ilike("%Tours%") would
    // match "Joué-lès-Tours", "Saint-Pierre-des-Corps", etc. and silently send BAN
    // queries to the wrong commune.
    let citycode: string | undefined;
    if (communeName) {
      const [communeRow] = await db.select({ insee_code: communes.insee_code })
        .from(communes)
        .where(ilike(communes.name, communeName))
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

    // Persiste les servitudes dans le metadata du dossier et recalcule
    // date_limite_instruction : une SUP AC1/AC2/AC3/AC4 (ABF, SPR, site classé,
    // réserve) ajoute +1 mois au délai légal (R.423-24 b/c/d).
    // Sans persistance, le calcul d'échéance au dépôt ne voit pas ces
    // extensions et sous-estime la deadline.
    try {
      const servitudes: DeadlineServitude[] = (analysis.servitudes ?? []).map((s) => ({
        categorie: s.categorie,
        libelle: s.libelle,
      }));
      const prevMeta = (dossier.metadata as Record<string, unknown> | null) ?? {};
      const prevServitudes = Array.isArray((prevMeta as { servitudes?: unknown }).servitudes)
        ? ((prevMeta as { servitudes: DeadlineServitude[] }).servitudes)
        : [];
      const servitudesChanged =
        prevServitudes.length !== servitudes.length ||
        prevServitudes.some((p, i) => p.categorie !== servitudes[i]?.categorie);

      const baseDate = dossier.date_completude ?? dossier.date_depot;
      let breakdownStale = false;
      if (baseDate) {
        const calcCurrent = computeInstructionDelay(
          dossier.type,
          prevMeta as DeadlineMetadata,
          servitudes,
        );
        const prevDelai = (prevMeta as { delai?: { breakdown?: Array<{ label?: string; article?: string }> } }).delai;
        const prevBreakdown = prevDelai?.breakdown ?? [];
        breakdownStale =
          prevBreakdown.length !== calcCurrent.breakdown.length ||
          prevBreakdown.some((b, i) =>
            b.label !== calcCurrent.breakdown[i]?.label ||
            b.article !== calcCurrent.breakdown[i]?.article,
          );
      }

      if (servitudesChanged || !dossier.date_limite_instruction || breakdownStale) {
        const newMeta: Record<string, unknown> = {
          ...prevMeta,
          servitudes,
          parcel_analysis: analysis,
        };

        const patch: Record<string, unknown> = { metadata: newMeta, updated_at: new Date() };

        if (baseDate) {
          const calc = computeInstructionDelay(
            dossier.type,
            newMeta as DeadlineMetadata,
            servitudes,
          );
          patch.date_limite_instruction = applyMonthsToDate(new Date(baseDate), calc.total_mois);
          newMeta.delai = {
            total_mois: calc.total_mois,
            breakdown: calc.breakdown,
            base_date: new Date(baseDate).toISOString(),
            base_date_source: dossier.date_completude ? "completude" : "depot",
            computed_at: new Date().toISOString(),
          };
        }

        await db.update(dossiers).set(patch).where(eq(dossiers.id, dossier.id));
      }
    } catch (persistErr) {
      // Best-effort : un échec de persistance ne doit pas masquer le résultat
      // d'analyse à l'opérateur. La prochaine ouverture re-tentera.
      console.error("[mairie/parcelle] persist servitudes:", persistErr);
    }

    res.json(analysis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Historique SITADEL/ADS ──────────────────────────────────────────────────
// GET /mairie/dossiers/:id/sitadel-history[?scope=parcel|commune]
// Récupère les autorisations d'urbanisme délivrées par le passé sur la même
// parcelle (scope=parcel, défaut) ou sur la commune (scope=commune) via la
// base ouverte SITADEL publiée par le SDES.
//
// On préfère l'INSEE + cadastre issus du parcel_analysis déjà persisté dans
// le metadata du dossier (cf. endpoint analyse-parcelle ci-dessus). À défaut
// on tente de reconstruire le cadastre depuis dossier.parcelle / commune.

parcelleRouter.get("/dossiers/:id/sitadel-history", async (req: AuthRequest, res) => {
  try {
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const scope = (req.query.scope as string | undefined) === "commune" ? "commune" : "parcel";
    const meta = (dossier.metadata ?? {}) as Record<string, unknown>;
    const pa = meta["parcel_analysis"] as
      | { parcel?: { code_insee?: string; section?: string; numero?: string } }
      | undefined;

    // INSEE — priorité au cache analyse, sinon lookup nom commune.
    let inseeCode: string | undefined = pa?.parcel?.code_insee;
    if (!inseeCode && dossier.commune) {
      const [communeRow] = await db
        .select({ insee_code: communes.insee_code })
        .from(communes)
        .where(ilike(communes.name, dossier.commune))
        .limit(1);
      inseeCode = communeRow?.insee_code ?? undefined;
    }
    if (!inseeCode) {
      return res.status(422).json({ error: "Code INSEE introuvable pour ce dossier." });
    }

    // Cadastre — section/numéro pour filtrer sur la parcelle.
    const cadastre: Array<{ section: string; numero: string }> = [];
    if (pa?.parcel?.section && pa?.parcel?.numero) {
      cadastre.push({ section: pa.parcel.section, numero: pa.parcel.numero });
    } else if (dossier.parcelle) {
      // ex. "AB 142" ou "AB142" → { section: AB, numero: 142 }
      const m = /^([A-Z]{1,2})\s*0*(\d{1,4})$/i.exec(dossier.parcelle.trim());
      if (m && m[1] && m[2]) cadastre.push({ section: m[1].toUpperCase(), numero: m[2] });
    }

    const result = await fetchSitadelHistory({
      insee_code: inseeCode,
      cadastre,
      parcelOnly: scope === "parcel" && cadastre.length > 0,
    });

    res.json(result);
  } catch (err) {
    console.error("[mairie/sitadel-history]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

parcelleRouter.patch("/dossiers/:id/adresse", requireAuth, async (req: AuthRequest, res) => {
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

// ── Proxy APICarto GPU zones (évite le CORS côté navigateur) ─────────────────
// GET /mairie/plu-zones?insee_code=37018 (or legacy ?commune=Ballan-Miré)
// Cache à 3 niveaux : navigateur (ETag + max-age) → DB Postgres → upstream GPU.

// Headers HTTP : on autorise le cache navigateur 1h, puis stale-while-revalidate
// jusquà 7 jours — le navigateur sert la version cached instantanément et
// rafraîchit en tâche de fond.
const PLU_CACHE_CONTROL = "private, max-age=3600, stale-while-revalidate=604800";

parcelleRouter.get("/plu-zones", async (req: AuthRequest, res) => {
  // Déclaré avant try pour être accessible dans le catch (stale fallback)
  let communeRow: { id: string; plu_zones_geojson: unknown; plu_zones_cached_at: Date | null } | undefined;

  try {
    let inseeCode = (req.query.insee_code as string | undefined)?.trim();
    const communeName = (req.query.commune as string | undefined)?.trim();

    if (!inseeCode && !communeName) {
      return res.status(400).json({ error: "insee_code ou commune requis" });
    }

    // Résolution du code INSEE si non fourni (chemin legacy)
    if (!inseeCode && communeName) {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(communeName)}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(8000) }
      ).catch(() => null);
      if (r?.ok) inseeCode = ((await r.json()) as Array<{ code?: string }>)[0]?.code ?? undefined;
    }
    if (!inseeCode) return res.status(404).json({ error: "Commune non trouvée" });

    // `?refresh=1` force un re-fetch (utile après changement du PLU ou bug fix
    // côté pipeline d'extraction — sans attendre l'expiration du cache de 7 j).
    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

    // Charge le cache DB (survit aux redémarrages serveur)
    communeRow = (await db.select({ id: communes.id, plu_zones_geojson: communes.plu_zones_geojson, plu_zones_cached_at: communes.plu_zones_cached_at })
      .from(communes).where(eq(communes.insee_code, inseeCode)).limit(1))[0];

    const sendCached = (zones: unknown, cachedAt: Date | null, hitKind: "DB-HIT" | "STALE") => {
      // Re-filtre par INSEE à la lecture : ça nettoie les anciens caches qui
      // contiennent encore les zones limitrophes des communes voisines (avant
      // le fix du filtre). Pas de coût si déjà filtré.
      const cleaned = filterZonesByInsee(zones as PluZonesGeoJson, inseeCode!);
      const etag = pluEtagFor(inseeCode!, cachedAt);
      if (etag) res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", PLU_CACHE_CONTROL);
      res.setHeader("X-PLU-Cache", hitKind);
      if (etag && req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      return res.json(cleaned);
    };

    if (!forceRefresh && communeRow?.plu_zones_geojson && communeRow.plu_zones_cached_at) {
      const ageMs = Date.now() - communeRow.plu_zones_cached_at.getTime();
      if (ageMs < PLU_CACHE_TTL_MS) {
        return sendCached(communeRow.plu_zones_geojson, communeRow.plu_zones_cached_at, "DB-HIT");
      }
    }

    const wantDiag = req.query.diag === "1" || req.query.diag === "true";

    // Cache expiré, inexistant, ou refresh forcé → fetch upstream
    const result = await refreshPluZones(inseeCode);
    if (!result.ok) {
      if (communeRow?.plu_zones_geojson && !wantDiag) {
        return sendCached(communeRow.plu_zones_geojson, communeRow.plu_zones_cached_at, "STALE");
      }
      return res.status(result.status).json({ error: result.error, diag: result.diag });
    }

    const freshAt = new Date();
    const etag = pluEtagFor(inseeCode, freshAt);
    if (etag) res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", PLU_CACHE_CONTROL);
    res.setHeader("X-PLU-Cache", "MISS");
    if (wantDiag) res.json({ zones: result.zones, diag: result.diag });
    else res.json(result.zones);
  } catch (err) {
    console.error("[plu-zones proxy]", err);
    if (communeRow?.plu_zones_geojson) {
      res.setHeader("X-PLU-Cache", "STALE");
      return res.json(communeRow.plu_zones_geojson as object);
    }
    res.status(500).json({ error: "Erreur serveur", detail: String(err) });
  }
});
