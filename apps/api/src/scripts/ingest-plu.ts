/**
 * PLU Ingestion Script
 *
 * Extracts regulatory rules from a PLU règlement PDF using the Claude API
 * and stores them in the zone_regulatory_rules table.
 *
 * Usage:
 *   npx tsx src/scripts/ingest-plu.ts --commune ballan-mire --pdf /path/to/reglement.pdf
 *   npx tsx src/scripts/ingest-plu.ts --commune ballan-mire --seed   (uses hardcoded rules)
 *
 * The --seed flag bypasses AI extraction and uses the manually-verified rules
 * extracted from the Ballan-Miré PLU règlement (modification n°5, 29/01/2018).
 */

import { db } from "../db.js";
import { zones, zone_regulatory_rules, communes } from "@heureka-v1/db";
import { eq, and } from "drizzle-orm";
import { execSync } from "child_process";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

const args = process.argv.slice(2);
const COMMUNE_SLUG = args[args.indexOf("--commune") + 1] ?? "ballan-mire";
const PDF_PATH = args.includes("--pdf") ? args[args.indexOf("--pdf") + 1] : null;
const SEED_MODE = args.includes("--seed");
const DRY_RUN = args.includes("--dry-run");

// ── Hardcoded seed rules extracted from Ballan-Miré PLU (modification n°5) ──
// Source: PLU-Ballan-Reglement.pdf, approved 29/01/2018 by Tours Métropole Val de Loire

const BALLAN_MIRE_ZONES: Array<{
  zone_code: string;
  zone_label: string;
  zone_type: string;
  summary: string;
  rules: Array<{
    article_number: number;
    topic: string;
    rule_text: string;
    value_min?: number;
    value_max?: number;
    value_exact?: number;
    unit?: string;
    conditions?: string;
    summary?: string;
  }>;
}> = [
  {
    zone_code: "UA",
    zone_label: "Zone UA – Centre ancien",
    zone_type: "U",
    summary: "Centre ancien de Ballan-Miré, bâti traditionnel dense, implantation majoritairement à l'alignement.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul entre 0 et 1 mètre, ou alignement sur construction voisine, ou recul minimal de 6 mètres.", value_min: 0, value_max: 6, unit: "m", summary: "0-1m ou ≥6m" },
      { article_number: 7, topic: "recul_limite", rule_text: "En limite séparative ou à distance ≥ moitié de la hauteur avec un minimum de 3 mètres.", value_min: 3, unit: "m", conditions: "H/2 minimum 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol non réglementée en zone UA.", summary: "Non réglementé" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale : 6,5 mètres à l'égout de toiture ou à l'acrotère ; 9 mètres au faîtage.", value_max: 6.5, unit: "m", summary: "6,5m égout / 9m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "1 place par logement d'1 pièce ; 2 places pour logement de 2 pièces et plus. Activités : 1 place/50m² SP. Commerces ≤100m² : aucune place.", summary: "2 places/logement (≥2P), 1 place/50m² activités" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 25% d'espaces libres en pleine terre. 1 arbre de haute tige pour 100m² d'espaces libres.", value_min: 25, unit: "%", summary: "≥25% pleine terre" },
    ],
  },
  {
    zone_code: "UB",
    zone_label: "Zone UB – Extensions du centre",
    zone_type: "U",
    summary: "Extensions du centre existantes ou futures : collectifs RDC+3, équipements, nouveaux quartiers.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul minimal de 6 mètres par rapport aux voies.", value_min: 6, unit: "m", summary: "≥6m" },
      { article_number: 7, topic: "recul_limite", rule_text: "En limite séparative ou à distance ≥ moitié de la hauteur avec un minimum de 3 mètres. Secteur UBai : jamais en limite, recul H/2 min 3m.", value_min: 3, unit: "m", conditions: "H/2 minimum 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 50% de la superficie du terrain. Secteur UBai : limitée à 10%.", value_max: 50, unit: "%", summary: "50% (UBai: 10%)" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale : 9 mètres à l'égout de toiture ou à l'acrotère ; 14 mètres au faîtage.", value_max: 9, unit: "m", summary: "9m égout / 14m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "2 places par logement de 2 pièces et plus. 1 place/50m² SP pour les activités. Vélos : 1 emplacement/logement.", summary: "2 places/logement (≥2P)" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 25% d'espaces libres en pleine terre. 1 arbre de haute tige pour 100m².", value_min: 25, unit: "%", summary: "≥25% pleine terre" },
    ],
  },
  {
    zone_code: "UC",
    zone_label: "Zone UC – Habitat pavillonnaire récent",
    zone_type: "U",
    summary: "Zones pavillonnaires récentes avec COS libre et règles de recul plus souples.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul minimal de 3 mètres. Le long de la RD751 : recul minimal de 40 mètres par rapport à l'axe de la voie.", value_min: 3, unit: "m", conditions: "RD751: 40m depuis axe", summary: "≥3m (RD751: 40m)" },
      { article_number: 7, topic: "recul_limite", rule_text: "En limite séparative ou à distance ≥ moitié de la hauteur avec un minimum de 3 mètres.", value_min: 3, unit: "m", conditions: "H/2 minimum 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 50% de la superficie du terrain.", value_max: 50, unit: "%", summary: "≤50%" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale : 6,5 mètres à l'égout de toiture ou à l'acrotère ; 9 mètres au faîtage.", value_max: 6.5, unit: "m", summary: "6,5m égout / 9m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "2 places par logement de 2 pièces et plus. Activités : 1 place/50m² SP.", summary: "2 places/logement (≥2P)" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 25% d'espaces libres en pleine terre.", value_min: 25, unit: "%", summary: "≥25% pleine terre" },
    ],
  },
  {
    zone_code: "UD",
    zone_label: "Zone UD – Habitat diffus périphérique",
    zone_type: "U",
    summary: "Habitat diffus en périphérie, grandes parcelles, faible densité.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul minimal de 7 mètres par rapport aux voies et emprises publiques.", value_min: 7, unit: "m", summary: "≥7m" },
      { article_number: 7, topic: "recul_limite", rule_text: "En limite séparative ou à distance ≥ moitié de la hauteur avec un minimum de 3 mètres.", value_min: 3, unit: "m", conditions: "H/2 minimum 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 20% de la superficie du terrain.", value_max: 20, unit: "%", summary: "≤20%" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale : 6,5 mètres à l'égout de toiture ou à l'acrotère ; 9 mètres au faîtage.", value_max: 6.5, unit: "m", summary: "6,5m égout / 9m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "2 places par logement de 2 pièces et plus.", summary: "2 places/logement" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 25% d'espaces libres en pleine terre.", value_min: 25, unit: "%", summary: "≥25% pleine terre" },
    ],
  },
  {
    zone_code: "1AU",
    zone_label: "Zone 1AU – À urbaniser à court terme",
    zone_type: "AU",
    summary: "Zones à urbaniser à court terme, ouvertes à l'urbanisation sous conditions.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul minimal de 5 mètres.", value_min: 5, unit: "m", summary: "≥5m" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 50%.", value_max: 50, unit: "%", summary: "≤50%" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale : 9 mètres à l'égout de toiture ou à l'acrotère.", value_max: 9, unit: "m", summary: "9m égout" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 25% d'espaces libres en pleine terre.", value_min: 25, unit: "%", summary: "≥25% pleine terre" },
    ],
  },
  {
    zone_code: "A",
    zone_label: "Zone A – Agricole",
    zone_type: "A",
    summary: "Zone agricole protégée. Constructibilité très limitée aux seuls bâtiments nécessaires à l'exploitation agricole.",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol non réglementée sauf secteur Ah (50% max 50m²) et Ad (50% de l'existant).", summary: "Non réglementé (sauf secteurs Ah/Ad)" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale de 4 mètres à l'égout de toiture pour les bâtiments d'habitation. Annexes secteur Ah : 3m maximum.", value_max: 4, unit: "m", summary: "4m égout (habitation)" },
    ],
  },
  {
    zone_code: "N",
    zone_label: "Zone N – Naturelle",
    zone_type: "N",
    summary: "Zone naturelle et forestière protégée. Constructibilité très restreinte.",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol non réglementée sauf secteurs : Nh (50% max 50m²), Ng (20%), Nb (300m²), Na (5%), Nf (50%).", summary: "Non réglementé (sauf secteurs)" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur non réglementée sauf secteurs : Nh (hauteur existant / annexes 3m), Ng (5m), Nb/Na/Nf (6m).", summary: "Non réglementé (sauf secteurs)" },
    ],
  },
];

// ── AI extraction from PDF ────────────────────────────────────────────────────

async function extractRulesWithAI(pdfText: string, zone_code: string): Promise<typeof BALLAN_MIRE_ZONES[0]["rules"]> {
  const client = new Anthropic();

  const prompt = `Tu es un expert en droit de l'urbanisme français.
Voici le texte du règlement PLU pour la zone ${zone_code}.
Extrais les règles quantitatives pour les articles suivants uniquement :
- Article 6 (recul voirie) → topic: "recul_voie"
- Article 7 (recul limites séparatives) → topic: "recul_limite"
- Article 9 (emprise au sol) → topic: "emprise_sol"
- Article 10 (hauteur maximale) → topic: "hauteur"
- Article 12 (stationnement) → topic: "stationnement"
- Article 13 (espaces verts) → topic: "espaces_verts"

Pour chaque règle, retourne un JSON array avec les champs :
{
  "article_number": number,
  "topic": string,
  "rule_text": string (texte exact ou reformulé fidèlement),
  "value_min": number | null,
  "value_max": number | null,
  "value_exact": number | null,
  "unit": "m" | "%" | "m²" | null,
  "conditions": string | null (cas particuliers, secteurs spéciaux),
  "summary": string (résumé en 10 mots max)
}

Si une règle dit "Non réglementé", inclus-la quand même avec value_min/max/exact à null.
Réponds UNIQUEMENT avec le JSON array, sans texte supplémentaire.

TEXTE DU RÈGLEMENT :
${pdfText.slice(0, 8000)}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const content = message.content[0]!;
  if (content.type !== "text") return [];

  try {
    const jsonMatch = content.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error(`Failed to parse AI response for zone ${zone_code}`);
    return [];
  }
}

// ── DB upsert ──────────────────────────────────────────────────────────────────

async function upsertZoneAndRules(
  commune_id: string,
  zoneData: typeof BALLAN_MIRE_ZONES[0],
): Promise<void> {
  // Upsert zone
  const existing = await db.select().from(zones)
    .where(and(eq(zones.commune_id, commune_id), eq(zones.zone_code, zoneData.zone_code)))
    .limit(1);

  let zone_id: string;
  if (existing[0]) {
    zone_id = existing[0].id;
    await db.update(zones)
      .set({ zone_label: zoneData.zone_label, zone_type: zoneData.zone_type, summary: zoneData.summary, updated_at: new Date() })
      .where(eq(zones.id, zone_id));
    console.log(`  ↻ Mise à jour zone ${zoneData.zone_code}`);
  } else {
    const [created] = await db.insert(zones).values({
      commune_id,
      zone_code: zoneData.zone_code,
      zone_label: zoneData.zone_label,
      zone_type: zoneData.zone_type,
      summary: zoneData.summary,
      status: "active",
      is_active: true,
    }).returning();
    zone_id = created!.id;
    console.log(`  + Création zone ${zoneData.zone_code}`);
  }

  // Upsert rules
  for (const rule of zoneData.rules) {
    const existingRule = await db.select().from(zone_regulatory_rules)
      .where(and(
        eq(zone_regulatory_rules.zone_id, zone_id),
        eq(zone_regulatory_rules.topic, rule.topic),
      ))
      .limit(1);

    if (existingRule[0]) {
      await db.update(zone_regulatory_rules).set({
        article_number: rule.article_number,
        rule_text: rule.rule_text,
        value_min: rule.value_min ?? null,
        value_max: rule.value_max ?? null,
        value_exact: rule.value_exact ?? null,
        unit: rule.unit ?? null,
        conditions: rule.conditions ?? null,
        summary: rule.summary ?? null,
        validation_status: "valide",
        updated_at: new Date(),
      }).where(eq(zone_regulatory_rules.id, existingRule[0].id));
    } else {
      await db.insert(zone_regulatory_rules).values({
        zone_id,
        article_number: rule.article_number,
        article_title: `Article ${rule.article_number}`,
        topic: rule.topic,
        rule_text: rule.rule_text,
        value_min: rule.value_min ?? null,
        value_max: rule.value_max ?? null,
        value_exact: rule.value_exact ?? null,
        unit: rule.unit ?? null,
        conditions: rule.conditions ?? null,
        summary: rule.summary ?? null,
        validation_status: "valide",
      });
    }
    console.log(`    • ${rule.topic}: ${rule.summary ?? rule.rule_text.slice(0, 50)}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏙️  Ingestion PLU — ${COMMUNE_SLUG.toUpperCase()}`);
  console.log(`Mode: ${SEED_MODE ? "seed (règles manuelles)" : PDF_PATH ? "extraction IA" : "seed (défaut)"}\n`);

  // Find or create commune
  const communeName = COMMUNE_SLUG.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const inseeCode = COMMUNE_SLUG === "ballan-mire" ? "37018" : "00000";

  let commune = (await db.select().from(communes).where(eq(communes.insee_code, inseeCode)).limit(1))[0];
  if (!commune) {
    const [created] = await db.insert(communes).values({
      name: communeName,
      insee_code: inseeCode,
      zip_code: "37510",
    }).returning();
    commune = created!;
    console.log(`✓ Commune créée : ${communeName} (${inseeCode})`);
  } else {
    console.log(`✓ Commune trouvée : ${commune.name}`);
  }

  const zonesToProcess = SEED_MODE || !PDF_PATH ? BALLAN_MIRE_ZONES : [];

  if (PDF_PATH && !SEED_MODE) {
    // AI extraction mode
    console.log(`\nExtraction du texte du PDF...`);
    let pdfText: string;
    try {
      pdfText = execSync(`pdftotext "${PDF_PATH}" -`, { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 });
    } catch (e) {
      console.error("Erreur pdftotext:", e);
      process.exit(1);
    }

    // Parse zones from PDF text
    const zoneMatches = pdfText.matchAll(/RÈGLEMENT – ZONE ([A-Z0-9]+)\n([\s\S]*?)(?=RÈGLEMENT – ZONE [A-Z0-9]+|$)/g);
    for (const match of zoneMatches) {
      const zone_code = match[1]!;
      const zoneText = match[2]!;
      console.log(`\nExtraction IA pour zone ${zone_code}...`);
      const rules = await extractRulesWithAI(zoneText, zone_code);
      if (rules.length > 0) {
        zonesToProcess.push({ zone_code, zone_label: `Zone ${zone_code}`, zone_type: zone_code[0] ?? "U", summary: "", rules });
      }
    }
  }

  console.log(`\nTraitement de ${zonesToProcess.length} zones...\n`);
  for (const zoneData of zonesToProcess) {
    if (!DRY_RUN) {
      await upsertZoneAndRules(commune.id, zoneData);
    } else {
      console.log(`[DRY RUN] Zone ${zoneData.zone_code}: ${zoneData.rules.length} règles`);
    }
  }

  console.log(`\n✅ Ingestion terminée — ${zonesToProcess.length} zones, commune ${communeName}`);
}

main().catch(e => { console.error(e); process.exit(1); });
