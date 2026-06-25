import { Router } from "express";
import { db } from "../../db.js";
import { dossiers, communes } from "@heureka-v1/db";
import { eq, desc, sql, ilike } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import { requireAuth } from "../../middlewares/auth.js";
import { requirePermission } from "../../middlewares/permissions.js";
import { analyseParcel } from "../../services/parcelAnalysis.js";
import {
  computeInstructionDelay,
  applyMonthsToDate,
  type DeadlineMetadata,
  type DeadlineServitude,
} from "../../services/instructionDelays.js";
import { refreshPluZones, pluEtagFor, filterZonesByInsee, PLU_CACHE_TTL_MS, type PluZonesGeoJson } from "../../services/pluZones.js";
import { fetchSitadelHistory } from "../../services/sitadelHistory.js";
import {
  resolveSitadelQueryForDossier,
  persistSitadelCache,
  SITADEL_CACHE_TTL_MS,
  INTERACTIVE_MAX_PER_SOURCE,
  type SitadelHistoryCache,
} from "../../services/sitadelPrefetch.js";

export const parcelleRouter = Router();

parcelleRouter.get("/map-dossiers", requirePermission("dossiers.read"), async (req: AuthRequest, res) => {
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

// Construit l'identifiant cadastral 14 caractères (ex. 37018000AI0217) à partir
// de la référence portée par le dossier (CERFA/OCR). Gère les références
// partielles (« AI 217 » → complétée avec l'INSEE de la commune) et
// multi-parcelles (« AI 217 & AI 218p » → on prend la 1re). Renvoie null si non
// interprétable (l'appelant retombe alors sur l'adresse).
function toCadastralRefId(parcelle: string | null | undefined, citycode: string | undefined): string | null {
  if (!parcelle) return null;
  const firstChunk = parcelle.split(/\s*(?:[&,;/]|\bet\b)\s*/i)[0] ?? parcelle;
  const raw = firstChunk.trim().replace(/\s+/g, "").toUpperCase();
  if (!raw) return null;
  if (/^\d{5}[A-Z0-9]{9,}$/.test(raw)) return raw; // déjà complet
  const m = /^([A-Z]{1,2})0*(\d{1,4})[A-Z]*$/.exec(raw); // « AI217 », « AI0217 », « AI218P »
  if (m && m[1] && m[2] && citycode) {
    return `${citycode}000${m[1].padStart(2, "0")}${m[2].padStart(4, "0")}`;
  }
  return null;
}

parcelleRouter.get("/dossiers/:id/analyse-parcelle", requirePermission("dossiers.read"), async (req: AuthRequest, res) => {
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
    // PRIORITÉ À LA RÉFÉRENCE CADASTRALE déclarée/OCRisée : une référence se
    // résout en parcelle EXACTE via l'IGN (findParcelByRef, dans analyseParcel),
    // bien plus fiable que le géocodage d'une adresse — qui peut tomber sur la
    // voirie ou une parcelle voisine et renvoyer une MAUVAISE section (ex. « ZL »
    // au lieu de « AI »). L'adresse reste utilisée en repli, et comme filet si la
    // référence ne se résout pas (cf. plus bas). Une correction manuelle (?q=)
    // ou un clic carte (?lat/lng) restent prioritaires sur tout.
    const communeAlreadyInAddr = !!dossier.commune && !!dossier.adresse &&
      dossier.adresse.toLowerCase().includes(dossier.commune.toLowerCase());
    const addrQuery = dossier.adresse
      ? (communeAlreadyInAddr ? dossier.adresse : `${dossier.adresse}${dossier.commune ? ", " + dossier.commune : ""}`)
      : null;
    const refId = qOverride ? null : toCadastralRefId(dossier.parcelle, citycode);
    const query: string | null = qOverride ? qOverride : (refId ?? addrQuery);

    if (!query) return res.status(422).json({ error: "Aucune adresse ni référence parcellaire sur ce dossier." });

    // ?zone= lets the instructeur manually override the PLU zone when GPU fails
    const zoneOverride = (req.query.zone as string | undefined)?.trim();

    // ?lat=&lng= lets the instructeur provide coordinates from a map click
    const latParam = parseFloat(req.query.lat as string);
    const lngParam = parseFloat(req.query.lng as string);
    const coords = !isNaN(latParam) && !isNaN(lngParam) ? { lat: latParam, lng: lngParam } : undefined;

    let analysis = await analyseParcel(query, { citycode, zoneOverride, coords });
    // Filet anti-régression : si on a privilégié la référence cadastrale mais
    // qu'elle ne s'est PAS résolue en parcelle OU n'a PAS déterminé de zone PLU,
    // on réessaie avec l'adresse (géocodage → coordonnées → zone), comportement
    // historique préservé. On ne le fait pas si l'instructeur a cliqué un point
    // sur la carte (?lat/lng) : son choix prime.
    if (refId && query === refId && addrQuery && !coords && (!analysis.parcel || !analysis.plu_zone)) {
      analysis = await analyseParcel(addrQuery, { citycode, zoneOverride, coords });
    }

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

      // Zone faisant foi : on aligne metadata.zone sur la zone géolocalisée (ou
      // l'override instructeur) résolue par l'analyse. Sans cela, metadata.zone
      // restait figée sur le snapshot du dépôt et l'analyse de conformité
      // appliquait les règles d'une zone obsolète, différente de celle affichée
      // dans l'onglet Parcelle.
      const resolvedZone = analysis.plu_zone?.zone_code ?? analysis.db_zone?.code ?? undefined;
      const prevZone = typeof (prevMeta as { zone?: unknown }).zone === "string"
        ? ((prevMeta as { zone: string }).zone)
        : undefined;
      const zoneChanged = !!resolvedZone && resolvedZone !== prevZone;

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

      if (servitudesChanged || zoneChanged || !dossier.date_limite_instruction || breakdownStale) {
        // Snapshot compact des risques (Géorisques) — clé canonique lue par le
        // moteur de pièces pour déclencher les attestations parasismique / argiles
        // (décret n°2023-1173 du 12/12/2023). Le détail complet reste dans
        // parcel_analysis ; cette clé stable évite d'avoir à le re-parser.
        const risks = analysis.risks
          ? { seismic_zone: analysis.risks.seismic_zone, clay_risk: analysis.risks.clay_risk, flood_risk: analysis.risks.flood_risk }
          : undefined;
        const newMeta: Record<string, unknown> = {
          ...prevMeta,
          servitudes,
          ...(risks ? { risks } : {}),
          parcel_analysis: analysis,
          // metadata.zone reste la clé canonique lue par la conformité et la
          // classification : on la maintient synchronisée avec la zone résolue.
          ...(resolvedZone ? { zone: resolvedZone } : {}),
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
// GET /mairie/dossiers/:id/sitadel-history[?scope=parcel|street|commune|auto]
// Récupère les autorisations d'urbanisme passées (PC, DP, PA, PD) via la base
// ouverte SITADEL (SDES). Le scope "auto" (défaut) cascade : parcelle exacte
// → même rue (ou lieu-dit) → toute la commune, et retient le premier niveau
// non vide. La réponse expose `effective_scope` pour que l'UI affiche le
// niveau réellement retenu.
//
// On préfère l'INSEE + cadastre issus du parcel_analysis déjà persisté dans
// le metadata du dossier (cf. endpoint analyse-parcelle ci-dessus). À défaut
// on tente de reconstruire le cadastre depuis dossier.parcelle / commune.

parcelleRouter.get("/dossiers/:id/sitadel-history", requirePermission("dossiers.read"), async (req: AuthRequest, res) => {
  try {
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const scopeParam = req.query.scope as string | undefined;
    const scope: "parcel" | "street" | "commune" | "auto" =
      scopeParam === "parcel" || scopeParam === "street" || scopeParam === "commune"
        ? scopeParam
        : "auto";
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";

    // Cache : on sert le snapshot pré-chargé à la création du dossier (scope
    // "auto") s'il est frais et qu'aucun rafraîchissement n'est forcé. Les
    // scopes explicites (boutons parcelle/rue/commune) déclenchent un appel live.
    const meta = (dossier.metadata ?? {}) as Record<string, unknown>;
    const cache = meta["sitadel_history"] as SitadelHistoryCache | undefined;
    if (!refresh && scope === "auto" && cache?.result && cache.fetched_at) {
      const ageMs = Date.now() - new Date(cache.fetched_at).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < SITADEL_CACHE_TTL_MS) {
        return res.json(cache.result);
      }
    }

    const q = await resolveSitadelQueryForDossier(dossier);
    if (!q) {
      return res.status(422).json({ error: "Code INSEE introuvable pour ce dossier." });
    }

    const result = await fetchSitadelHistory({
      insee_code: q.insee_code,
      cadastre: q.cadastre,
      street: q.street,
      scope,
      maxPerSource: INTERACTIVE_MAX_PER_SOURCE,
    });

    // Rafraîchit le cache uniquement pour le scope "auto" (celui qui est
    // pré-chargé et servi par défaut). Best-effort : un échec d'écriture ne
    // doit pas masquer le résultat à l'instructeur.
    if (scope === "auto") {
      persistSitadelCache(dossier.id, {
        result,
        insee_code: q.insee_code,
        scope: "auto",
        fetched_at: new Date().toISOString(),
      }).catch((e) =>
        console.error("[mairie/sitadel-history] persist cache:", e instanceof Error ? e.message : e),
      );
    }

    res.json(result);
  } catch (err) {
    console.error("[mairie/sitadel-history]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

parcelleRouter.patch("/dossiers/:id/adresse", requirePermission("dossiers.instruct"), requireAuth, async (req: AuthRequest, res) => {
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

parcelleRouter.get("/plu-zones", requirePermission("zones.read"), async (req: AuthRequest, res) => {
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
