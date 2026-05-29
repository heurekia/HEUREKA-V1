/**
 * Rules loader — écrit les règles structurées dans les tables LUES par l'analyse
 * citoyen (`zones` + `zone_regulatory_rules`), en statut "brouillon" pour
 * validation par l'instructeur. Purge + insertion transactionnelles et
 * idempotentes par commune (rejouer remplace proprement).
 */
import { db, communes, zones, zone_regulatory_rules } from "@heureka-v1/db";
import { eq, inArray } from "drizzle-orm";
import type { ZoneRules } from "../structure/structurer.ts";

export interface LoadRulesResult {
  commune_id: string;
  zones: number;
  rules: number;
}

export async function loadRules(
  insee: string,
  communeName: string,
  zoneRules: ZoneRules[],
  opts: { zipCode?: string } = {},
): Promise<LoadRulesResult> {
  // Upsert commune
  let commune = (await db.select().from(communes).where(eq(communes.insee_code, insee)).limit(1))[0];
  if (!commune) {
    commune = (
      await db.insert(communes).values({ name: communeName, insee_code: insee, zip_code: opts.zipCode ?? "" }).returning()
    )[0]!;
  }

  let ruleCount = 0;
  await db.transaction(async (tx) => {
    const old = await tx.select({ id: zones.id }).from(zones).where(eq(zones.commune_id, commune!.id));
    if (old.length > 0) {
      await tx.delete(zone_regulatory_rules).where(inArray(zone_regulatory_rules.zone_id, old.map((z) => z.id)));
      await tx.delete(zones).where(eq(zones.commune_id, commune!.id));
    }

    for (let i = 0; i < zoneRules.length; i++) {
      const zr = zoneRules[i]!;
      const [zone] = await tx
        .insert(zones)
        .values({
          commune_id: commune!.id,
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
          instructor_note: r.instructor_note,
          validation_status: "brouillon",
        });
        ruleCount++;
      }
    }
  });

  return { commune_id: commune.id, zones: zoneRules.length, rules: ruleCount };
}
