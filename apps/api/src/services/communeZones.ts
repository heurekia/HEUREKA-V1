/**
 * Résolution des zones applicables à une commune, PLUi-aware.
 *
 * Une commune « voit » deux familles de zones :
 *  1. ses zones communales propres (zones.commune_id = la commune) — PLU
 *     communal, comportement historique ;
 *  2. les zones partagées des documents intercommunaux (PLUi/PLUm) qui lui
 *     sont rattachés via document_communes — ces zones ont commune_id = NULL
 *     et sont reliées par source_document_id.
 *
 * On renvoie l'UNION des identifiants de zones. Le pattern est strictement un
 * sur-ensemble de l'ancienne requête `zones.commune_id = X` : aucune zone
 * communale ne peut disparaître, on ne fait qu'ajouter les zones PLUi.
 */
import { db, zones, document_communes } from "@heureka-v1/db";
import { and, eq } from "drizzle-orm";

export async function resolveCommuneZoneIds(communeId: string): Promise<string[]> {
  const ids = new Set<string>();

  const own = await db
    .select({ id: zones.id })
    .from(zones)
    .where(eq(zones.commune_id, communeId));
  for (const z of own) ids.add(z.id);

  const shared = await db
    .select({ id: zones.id })
    .from(zones)
    .innerJoin(document_communes, eq(document_communes.document_id, zones.source_document_id))
    .where(eq(document_communes.commune_id, communeId));
  for (const z of shared) ids.add(z.id);

  return Array.from(ids);
}

/**
 * Variante restreinte aux zones actives, utile aux vues de gestion / affichage
 * qui n'exposent que les zones publiables.
 */
export async function resolveCommuneActiveZoneIds(communeId: string): Promise<string[]> {
  const ids = new Set<string>();

  const own = await db
    .select({ id: zones.id })
    .from(zones)
    .where(and(eq(zones.commune_id, communeId), eq(zones.is_active, true)));
  for (const z of own) ids.add(z.id);

  const shared = await db
    .select({ id: zones.id })
    .from(zones)
    .innerJoin(document_communes, eq(document_communes.document_id, zones.source_document_id))
    .where(and(eq(document_communes.commune_id, communeId), eq(zones.is_active, true)));
  for (const z of shared) ids.add(z.id);

  return Array.from(ids);
}
