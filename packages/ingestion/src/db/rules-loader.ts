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
  /** Sinon : type du document à upsert. Default "plu" (commune) / "plui" (EPCI). */
  type?: string;
  /** Nom affiché dans l'UI. Default dérivé du porteur. */
  name?: string;
  /** Nom du fichier source. Default "reglement.pdf". */
  originalFilename?: string;
}

/** Une commune membre à rattacher à un document PLUi. */
export interface MemberCommune {
  insee: string;
  name: string;
  zipCode?: string;
}

/**
 * Porteur intercommunal : le document est porté par un EPCI et rattaché à
 * toutes les communes membres fournies. Les zones sont créées UNE fois avec
 * commune_id = NULL (zones partagées) ; la résolution par commune se fait via
 * document_communes côté moteur (cf. Lot 4).
 */
export interface EpciPorteur {
  epci_id: string;
  /** Communes membres couvertes par ce PLUi (upsert + rattachement N:N). */
  communes: MemberCommune[];
}

export interface LoadRulesOptions {
  zipCode?: string;
  document?: LoadRulesDocumentInput;
  /**
   * Si fourni, bascule en mode PLUi : porteur = EPCI, zones partagées,
   * rattachement à toutes les communes membres. Les paramètres `insee` /
   * `communeName` de loadRules() sont alors ignorés pour le porteur (ils
   * peuvent rester vides). Sans ce champ, comportement communal historique.
   */
  epci?: EpciPorteur;
}

export interface LoadRulesResult {
  /** Commune porteuse (mode communal) ou null (mode PLUi). */
  commune_id: string | null;
  document_id: string;
  /** Communes rattachées au document (1 en communal, N en PLUi). */
  commune_ids: string[];
  zones: number;
  rules: number;
}

/** Upsert d'une commune par INSEE, renvoie la ligne (existante ou créée). */
async function upsertCommune(insee: string, name: string, zipCode?: string) {
  const existing = (await db.select().from(communes).where(eq(communes.insee_code, insee)).limit(1))[0];
  if (existing) return existing;
  return (
    await db
      .insert(communes)
      .values({ name, insee_code: insee, zip_code: zipCode ?? "" })
      .returning()
  )[0]!;
}

export async function loadRules(
  insee: string,
  communeName: string,
  zoneRules: ZoneRules[],
  opts: LoadRulesOptions = {},
): Promise<LoadRulesResult> {
  const isEpci = !!opts.epci;

  // 1) Résolution des communes.
  //  - Mode communal : 1 commune porteuse (= insee/communeName).
  //  - Mode PLUi : N communes membres ; pas de commune porteuse (porteur = EPCI).
  let porteurCommuneId: string | null;
  let attachedCommuneIds: string[];
  if (opts.epci) {
    const members = await Promise.all(
      opts.epci.communes.map((c) => upsertCommune(c.insee, c.name, c.zipCode)),
    );
    porteurCommuneId = null;
    attachedCommuneIds = members.map((c) => c.id);
  } else {
    const commune = await upsertCommune(insee, communeName, opts.zipCode);
    porteurCommuneId = commune.id;
    attachedCommuneIds = [commune.id];
  }

  // 2) Résolution / création du regulatory_document.
  //
  //  a) opts.document.id fourni → on l'utilise directement.
  //  b) sinon, on cherche un document existant pour le porteur + type. S'il
  //     existe, on le réutilise : la ré-ingestion remplace son contenu, ce qui
  //     évite d'accumuler N documents au fil des passes répétées.
  //  c) sinon, on crée un nouveau document avec le bon porteur.
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
    const docType = opts.document?.type ?? (isEpci ? "plui" : "plu");
    const docName =
      opts.document?.name ??
      (isEpci ? `${docType.toUpperCase()} (intercommunal)` : `${docType.toUpperCase()} ${communeName}`);
    const docFilename = opts.document?.originalFilename ?? "reglement.pdf";

    const matchPorteur = opts.epci
      ? eq(regulatory_documents.porteur_epci_id, opts.epci.epci_id)
      : eq(regulatory_documents.porteur_commune_id, porteurCommuneId!);

    const existing = (
      await db
        .select()
        .from(regulatory_documents)
        .where(and(matchPorteur, eq(regulatory_documents.type, docType)))
        .orderBy(desc(regulatory_documents.created_at))
        .limit(1)
    )[0];

    document =
      existing ??
      (
        await db
          .insert(regulatory_documents)
          .values({
            commune_id: porteurCommuneId, // NULL en mode PLUi
            porteur_commune_id: opts.epci ? null : porteurCommuneId,
            porteur_epci_id: opts.epci ? opts.epci.epci_id : null,
            type: docType,
            name: docName,
            original_filename: docFilename,
            status: "ingested",
            ingested_at: new Date(),
          })
          .returning()
      )[0]!;
  }

  // 3) Rattachement N:N document → communes. Idempotent (contrainte unique).
  if (attachedCommuneIds.length > 0) {
    await db
      .insert(document_communes)
      .values(attachedCommuneIds.map((commune_id) => ({ document_id: document!.id, commune_id })))
      .onConflictDoNothing();
  }

  // 4) Purge des zones/règles précédemment produites par CE document, puis
  //    réinsertion. Le scope est document, pas commune. En mode PLUi, les zones
  //    sont créées avec commune_id = NULL (zones partagées) ; la résolution par
  //    commune passe par document_communes côté moteur.
  const zoneCommuneId = porteurCommuneId; // NULL en mode PLUi
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
          commune_id: zoneCommuneId,
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
    commune_id: porteurCommuneId,
    document_id: document.id,
    commune_ids: attachedCommuneIds,
    zones: zoneRules.length,
    rules: ruleCount,
  };
}
