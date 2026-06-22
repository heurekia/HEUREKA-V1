/**
 * Résolution de la HAUTEUR MAXIMALE d'une parcelle depuis le « plan des hauteurs ».
 *
 * Contexte : pour certaines communes (ex. Tours), le règlement ÉCRIT ne chiffre
 * pas la hauteur — il renvoie au document graphique « plan des hauteurs », où la
 * hauteur max est portée par des polygones (un par secteur de hauteur). Cette
 * couche est déposée comme document `plan_hauteurs` (regulatory_documents.geojson)
 * et résolue ici, par parcelle, pour COMPLÉTER la règle de hauteur et la
 * constructibilité.
 *
 * On réutilise `findZonesForParcel` (intersection surfacique parcelle ∩ polygones,
 * couverture %, détection « à cheval ») en mappant `hauteur_txt` → `libelle`, pour
 * ne pas dupliquer la logique géométrique déjà testée.
 */
import type { Geometry } from "geojson";
import { and, desc, eq, or } from "drizzle-orm";
import { db, communes, regulatory_documents } from "@heureka-v1/db";
import { findZonesForParcel, type PluZonesGeoJson } from "./pluZones.js";

// Catégories du plan des hauteurs (cf. légende du règlement graphique Tours) :
// une valeur chiffrée OU un renvoi (article 10 du règlement, plan masse), ou
// « non fixée ». Seul `metres` porte une hauteur exploitable telle quelle.
export type HeightCategory =
  | "metres"
  | "article_10_reglement"
  | "non_fixee"
  | "renvoi_plan_masse"
  | "autre";

export interface HeightFeature {
  type: "Feature";
  properties: { hauteur_txt?: string; hauteur_m?: number | null; categorie?: string } | null;
  geometry: Geometry;
}
export interface HeightFeatureCollection {
  type: "FeatureCollection";
  features: HeightFeature[];
}

export interface ParcelHeightShare {
  hauteur_txt: string;
  hauteur_m: number | null;
  categorie: HeightCategory;
  couverture_pct: number;
}

export interface ParcelHeight {
  /** Hauteur max chiffrée (m) de la zone dominante, ou null pour un renvoi/non fixée. */
  hauteur_m: number | null;
  /** Libellé brut de la zone dominante ("18 m", "art. 10 RU", "Non fixée", "PM"). */
  hauteur_txt: string;
  categorie: HeightCategory;
  /** Vrai si la parcelle couvre ≥ 2 secteurs de hauteur distincts. */
  a_cheval: boolean;
  /** Répartition par secteur de hauteur touché, triée par couverture décroissante. */
  repartition: ParcelHeightShare[];
}

// Interprète le libellé d'un secteur de hauteur. Aligné sur le parsing de
// l'ingestion (script ingest-plan-hauteurs) : "18 m" → 18 / metres ; les renvois
// (art. 10, plan masse) et "Non fixée" n'ont pas de valeur chiffrée.
export function parseHeightTxt(txt: string | null | undefined): { hauteur_m: number | null; categorie: HeightCategory } {
  const t = (txt ?? "").trim();
  const m = /^(\d+(?:[.,]\d+)?)\s*m/i.exec(t);
  if (m) return { hauteur_m: parseFloat(m[1]!.replace(",", ".")), categorie: "metres" };
  const tl = t.toLowerCase();
  if (tl.includes("art") && tl.includes("10")) return { hauteur_m: null, categorie: "article_10_reglement" };
  if (tl.includes("non fix")) return { hauteur_m: null, categorie: "non_fixee" };
  if (t === "PM" || tl.includes("plan masse")) return { hauteur_m: null, categorie: "renvoi_plan_masse" };
  return { hauteur_m: null, categorie: "autre" };
}

// Phrase d'explication pour un renvoi (catégorie non chiffrée).
export function describeHeightCategory(categorie: HeightCategory): string {
  switch (categorie) {
    case "article_10_reglement":
      return "hauteur définie par l'article 10 du règlement écrit (renvoi)";
    case "renvoi_plan_masse":
      return "hauteur renvoyée à un plan masse (art. R.151-40)";
    case "non_fixee":
      return "hauteur non fixée par le plan des hauteurs";
    default:
      return "hauteur non déterminée par le plan des hauteurs";
  }
}

/**
 * Résout la hauteur d'une parcelle contre une couche « plan des hauteurs ».
 * Pur et déterministe. Renvoie null si la couche ou la géométrie manque, ou si
 * la parcelle n'intersecte aucun secteur de hauteur.
 */
export function resolveParcelHeight(
  layer: HeightFeatureCollection | null | undefined,
  parcelGeom: Geometry | null | undefined,
): ParcelHeight | null {
  if (!layer?.features?.length || !parcelGeom) return null;

  // Réutilise le résolveur surfacique (couverture %, à cheval) en exposant
  // `hauteur_txt` comme `libelle` — la valeur est ré-interprétée ensuite.
  const asZones: PluZonesGeoJson = {
    type: "FeatureCollection",
    features: layer.features.map((f) => ({
      type: "Feature",
      properties: { libelle: String((f.properties ?? {}).hauteur_txt ?? "") },
      geometry: f.geometry,
    })),
  };

  const zoning = findZonesForParcel(asZones, parcelGeom);
  if (!zoning.dominant) return null;

  const repartition: ParcelHeightShare[] = zoning.zones.map((z) => {
    const p = parseHeightTxt(z.zone_code);
    return { hauteur_txt: z.zone_code, hauteur_m: p.hauteur_m, categorie: p.categorie, couverture_pct: z.couverture_pct };
  });
  const dom = parseHeightTxt(zoning.dominant.zone_code);
  return {
    hauteur_m: dom.hauteur_m,
    hauteur_txt: zoning.dominant.zone_code,
    categorie: dom.categorie,
    a_cheval: zoning.a_cheval,
    repartition,
  };
}

/**
 * Charge la couche « plan des hauteurs » déposée pour une commune (par INSEE).
 * Renvoie la FeatureCollection ou null si aucune n'est déposée. On privilégie un
 * document validé puis le plus récent.
 */
export async function loadCommuneHeightLayer(inseeCode: string): Promise<HeightFeatureCollection | null> {
  const [commune] = await db
    .select({ id: communes.id })
    .from(communes)
    .where(eq(communes.insee_code, inseeCode))
    .limit(1);
  if (!commune) return null;

  const [doc] = await db
    .select({ geojson: regulatory_documents.geojson, validation_status: regulatory_documents.validation_status })
    .from(regulatory_documents)
    .where(
      and(
        eq(regulatory_documents.type, "plan_hauteurs"),
        or(
          eq(regulatory_documents.porteur_commune_id, commune.id),
          eq(regulatory_documents.commune_id, commune.id),
        ),
      ),
    )
    // « valide » d'abord (true trie après false en asc → desc place valide en tête), puis le plus récent.
    .orderBy(desc(regulatory_documents.validation_status), desc(regulatory_documents.created_at))
    .limit(1);

  const fc = doc?.geojson as HeightFeatureCollection | null | undefined;
  return fc && Array.isArray(fc.features) ? fc : null;
}

/** Charge + résout en une étape. Renvoie null si pas de couche ou pas d'intersection. */
export async function resolveCommuneParcelHeight(
  inseeCode: string,
  parcelGeom: Geometry | null | undefined,
): Promise<ParcelHeight | null> {
  if (!parcelGeom) return null;
  const layer = await loadCommuneHeightLayer(inseeCode);
  return resolveParcelHeight(layer, parcelGeom);
}
