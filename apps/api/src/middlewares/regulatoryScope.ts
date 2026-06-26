import { db } from "../db.js";
import {
  communes,
  regulatory_documents,
  document_communes,
  zones,
  zone_regulatory_rules,
  document_segments,
  document_segment_annotations,
} from "@heureka-v1/db";
import { eq, inArray } from "drizzle-orm";
import { communeInScope, type CommuneScope } from "./dossierAccess.js";

/**
 * Contrôle de périmètre commune pour les ressources RÉGLEMENTAIRES (documents
 * PLU/PPRI/OAP, zones, règles, annotations, segments).
 *
 * Ces ressources ne sont PAS adressées par /dossiers/:id : le middleware
 * enforceDossierAccess (qui ne couvre que /dossiers/:id et /conversations/:dossierId)
 * ne les protège donc pas. Chaque route qui lit/écrit une de ces ressources par
 * son identifiant propre doit vérifier que sa commune — ou, pour un PLUi, l'une
 * des communes qu'elle couvre — appartient au périmètre de l'agent.
 *
 * On raisonne en NOMS de commune pour réutiliser la normalisation de
 * getCommuneScope/communeInScope (trim + lowercase). Admin → scope null → tout
 * passe (les fonctions court-circuitent à `true`).
 */

/** Noms des communes couvertes par un document : sa commune propriétaire, son
 *  porteur, et toutes les communes membres (cas PLUi via document_communes). */
async function communeNamesForDocument(documentId: string): Promise<string[]> {
  const [doc] = await db
    .select({
      commune_id: regulatory_documents.commune_id,
      porteur_commune_id: regulatory_documents.porteur_commune_id,
    })
    .from(regulatory_documents)
    .where(eq(regulatory_documents.id, documentId))
    .limit(1);
  if (!doc) return [];

  const ids = new Set<string>();
  if (doc.commune_id) ids.add(doc.commune_id);
  if (doc.porteur_commune_id) ids.add(doc.porteur_commune_id);
  const links = await db
    .select({ commune_id: document_communes.commune_id })
    .from(document_communes)
    .where(eq(document_communes.document_id, documentId));
  for (const l of links) ids.add(l.commune_id);
  if (ids.size === 0) return [];

  const rows = await db
    .select({ name: communes.name })
    .from(communes)
    .where(inArray(communes.id, [...ids]));
  return rows.map((r) => r.name).filter((n): n is string => !!n);
}

/** Noms des communes d'une zone : sa commune propre, ou (zone de PLUi sans
 *  commune_id) les communes de son document source. */
async function communeNamesForZone(zoneId: string): Promise<string[]> {
  const [z] = await db
    .select({ commune_id: zones.commune_id, source_document_id: zones.source_document_id })
    .from(zones)
    .where(eq(zones.id, zoneId))
    .limit(1);
  if (!z) return [];
  if (z.commune_id) {
    const [c] = await db
      .select({ name: communes.name })
      .from(communes)
      .where(eq(communes.id, z.commune_id))
      .limit(1);
    return c?.name ? [c.name] : [];
  }
  if (z.source_document_id) return communeNamesForDocument(z.source_document_id);
  return [];
}

function anyInScope(names: string[], scope: CommuneScope): boolean {
  return names.some((n) => communeInScope(n, scope));
}

/** Le document réglementaire est-il dans le périmètre de l'agent ? */
export async function documentInScope(documentId: string, scope: CommuneScope): Promise<boolean> {
  if (scope === null) return true;
  return anyInScope(await communeNamesForDocument(documentId), scope);
}

/** La zone est-elle dans le périmètre de l'agent ? */
export async function zoneInScope(zoneId: string, scope: CommuneScope): Promise<boolean> {
  if (scope === null) return true;
  return anyInScope(await communeNamesForZone(zoneId), scope);
}

/** La règle (via sa zone) est-elle dans le périmètre de l'agent ? */
export async function ruleInScope(ruleId: string, scope: CommuneScope): Promise<boolean> {
  if (scope === null) return true;
  const [r] = await db
    .select({ zone_id: zone_regulatory_rules.zone_id })
    .from(zone_regulatory_rules)
    .where(eq(zone_regulatory_rules.id, ruleId))
    .limit(1);
  if (!r) return false;
  return anyInScope(await communeNamesForZone(r.zone_id), scope);
}

/** L'annotation (via son document source) est-elle dans le périmètre ? */
export async function annotationInScope(annotationId: string, scope: CommuneScope): Promise<boolean> {
  if (scope === null) return true;
  const [a] = await db
    .select({ source_id: document_segment_annotations.source_id })
    .from(document_segment_annotations)
    .where(eq(document_segment_annotations.id, annotationId))
    .limit(1);
  if (!a?.source_id) return false;
  return anyInScope(await communeNamesForDocument(a.source_id), scope);
}

/** Le segment RAG (via son document source ou son INSEE) est-il dans le périmètre ? */
export async function segmentInScope(segmentId: string, scope: CommuneScope): Promise<boolean> {
  if (scope === null) return true;
  const [s] = await db
    .select({ source_document_id: document_segments.source_document_id, insee: document_segments.insee })
    .from(document_segments)
    .where(eq(document_segments.id, segmentId))
    .limit(1);
  if (!s) return false;
  if (s.source_document_id) return documentInScope(s.source_document_id, scope);
  if (s.insee) {
    const [c] = await db
      .select({ name: communes.name })
      .from(communes)
      .where(eq(communes.insee_code, s.insee))
      .limit(1);
    return communeInScope(c?.name, scope);
  }
  return false;
}
