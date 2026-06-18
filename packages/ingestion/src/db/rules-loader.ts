/**
 * Rules loader — écrit les règles structurées dans les tables LUES par l'analyse
 * citoyen (`zones` + `zone_regulatory_rules`), en statut "brouillon" pour
 * validation par l'instructeur. Purge + insertion transactionnelles et
 * idempotentes par DOCUMENT (rejouer remplace proprement).
 *
 * Lot 3 : la purge n'est plus indexée sur commune_id mais sur source_document_id.
 * Conséquence : ré-ingérer un PLU ne touche plus aux zones/règles d'un autre
 * document (PPRI, OAP avec règles structurées…). Un regulatory_document est
 * résolu ou créé à l'entrée et propagé sur chaque zone/règle nouvellement
 * insérée.
 */
import {
  db,
  communes,
  zones,
  zone_regulatory_rules,
  regulatory_documents,
  document_communes,
} from "@heureka-v1/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { ZoneRules } from "../structure/structurer.ts";

export interface LoadRulesDocumentInput {
  /** Si fourni, on utilise CE document — pas de lookup, pas de création. */
  id?: string;
  /** Sinon : type du document à upsert pour la commune. Default "plu". */
  type?: string;
  /** Nom affiché dans l'UI. Default "<TYPE> <Commune>". */
  name?: string;
  /** Nom du fichier source. Default "reglement.pdf". */
  originalFilename?: string;
}

export interface LoadRulesOptions {
  zipCode?: string;
  document?: LoadRulesDocumentInput;
}

export interface LoadRulesResult {
  commune_id: string;
  document_id: string;
  zones: number;
  rules: number;
}

export async function loadRules(
  insee: string,
  communeName: string,
  zoneRules: ZoneRules[],
  opts: LoadRulesOptions = {},
): Promise<LoadRulesResult> {
  // 1) Upsert commune
  let commune = (await db.select().from(communes).where(eq(communes.insee_code, insee)).limit(1))[0];
  if (!commune) {
    commune = (
      await db
        .insert(communes)
        .values({ name: communeName, insee_code: insee, zip_code: opts.zipCode ?? "" })
        .returning()
    )[0]!;
  }

  // 2) Résolution / création du regulatory_document
  //
  // Trois cas :
  //  a) opts.document.id fourni → on l'utilise directement (le caller a déjà créé
  //     le document via une route d'upload, par exemple).
  //  b) sinon, on cherche un document existant pour (commune, type). S'il existe,
  //     on le réutilise : la ré-ingestion remplace son contenu, ce qui évite
  //     d'accumuler N documents au fil des passes répétées.
  //  c) sinon, on crée un nouveau document avec le porteur = commune.
  let document: typeof regulatory_documents.$inferSelect | undefined;
  if (opts.document?.id) {
    document = (
      await db
        .select()
        .from(regulatory_documents)
        .where(eq(regulatory_documents.id, opts.document.id))
        .limit(1)
    )[0];
    if (!document) throw new Error(`regulatory_document introuvable : ${opts.document.id}`);
  } else {
    const docType = opts.document?.type ?? "plu";
    const docName = opts.document?.name ?? `${docType.toUpperCase()} ${communeName}`;
    const docFilename = opts.document?.originalFilename ?? "reglement.pdf";

    const existing = (
      await db
        .select()
        .from(regulatory_documents)
        .where(
          and(
            eq(regulatory_documents.commune_id, commune.id),
            eq(regulatory_documents.type, docType),
          ),
        )
        .orderBy(desc(regulatory_documents.created_at))
        .limit(1)
    )[0];

    document =
      existing ??
      (
        await db
          .insert(regulatory_documents)
          .values({
            commune_id: commune.id,
            porteur_commune_id: commune.id,
            type: docType,
            name: docName,
            original_filename: docFilename,
            status: "ingested",
            ingested_at: new Date(),
          })
          .returning()
      )[0]!;
  }

  // 3) Rattachement N:N document → commune. Idempotent (ON CONFLICT DO NOTHING
  //    via la contrainte unique document_communes_unique).
  await db
    .insert(document_communes)
    .values({ document_id: document.id, commune_id: commune.id })
    .onConflictDoNothing();

  // 4) Purge des zones/règles précédemment produites par CE document, puis
  //    réinsertion. Le scope est document, pas commune : les autres documents
  //    de la commune (PPRI, OAP avec règles structurées) ne sont pas touchés.
  let ruleCount = 0;
  await db.transaction(async (tx) => {
    const old = await tx
      .select({ id: zones.id })
      .from(zones)
      .where(eq(zones.source_document_id, document!.id));
    if (old.length > 0) {
      await tx
        .delete(zone_regulatory_rules)
        .where(inArray(zone_regulatory_rules.zone_id, old.map((z) => z.id)));
      await tx.delete(zones).where(eq(zones.source_document_id, document!.id));
    }

    for (let i = 0; i < zoneRules.length; i++) {
      const zr = zoneRules[i]!;
      const [zone] = await tx
        .insert(zones)
        .values({
          commune_id: commune!.id,
          source_document_id: document!.id,
          zone_code: zr.zone_code,
          zone_label: zr.zone_label,
          zone_type: zr.zone_type,
          summary: `Zone ${zr.zone_code} — extrait par IA, à valider`,
          status: "active",
          is_active: true,
          display_order: i,
        })
        .returning();

      for (const r of zr.rules) {
        await tx.insert(zone_regulatory_rules).values({
          zone_id: zone!.id,
          source_document_id: document!.id,
          article_number: r.article_number,
          article_title: r.article_title || (r.article_number ? `Article ${r.article_number}` : ""),
          topic: r.topic,
          rule_text: r.rule_text,
          conditions: r.conditions,
          summary: r.summary,
          value_min: r.value_min,
          value_max: r.value_max,
          value_exact: r.value_exact,
          unit: r.unit,
          cases: r.cases ?? [],
          applies_if: r.applies_if ?? [],
          sub_theme: r.sub_theme,
          instructor_note: r.instructor_note,
          validation_status: "brouillon",
        });
        ruleCount++;
      }
    }
  });

  return {
    commune_id: commune.id,
    document_id: document.id,
    zones: zoneRules.length,
    rules: ruleCount,
  };
}
