/**
 * PLU Ingestion Script — v2
 *
 * Algorithm:
 *   1. Extract PDF text via pdftotext, split on form-feed (page boundaries)
 *   2. Filter pages: skip pages with < 300 chars (images, maps, schemas)
 *   3. Discover zones in the clean text (regex → Claude fallback)
 *   4. Segment text by zone
 *   5. Per zone: Claude tool_use with strict schema → one call, N rules
 *   6. Detect "renvoi au schéma" → flag needs_vision for manual review
 *   7. Store as validation_status = "brouillon" (never used without human sign-off)
 *
 * Usage:
 *   # Any commune from PDF
 *   npx tsx src/scripts/ingest-plu.ts \
 *     --commune "Rochecorbon" --insee 37194 --zip 37210 \
 *     --pdf /path/to/reglement.pdf
 *
 *   # Ballan-Miré verified seed (validation_status = "valide")
 *   npx tsx src/scripts/ingest-plu.ts \
 *     --commune "Ballan-Miré" --insee 37018 --zip 37510 --seed
 *
 *   # Dry-run: print without writing to DB
 *   ... --dry-run
 */

import { db } from "../db.js";
import { zones, zone_regulatory_rules, communes } from "@heureka-v1/db";
import { eq, and } from "drizzle-orm";
import { execSync } from "child_process";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

// ── CLI ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] ?? null : null; };
const has = (flag: string) => args.includes(flag);

const COMMUNE_NAME = get("--commune") ?? "Ballan-Miré";
const INSEE_CODE   = get("--insee")   ?? "37018";
const ZIP_CODE     = get("--zip")     ?? "37510";
const PDF_PATH     = get("--pdf");
const SEED_MODE    = has("--seed");
const DRY_RUN      = has("--dry-run");

// ── Types ──────────────────────────────────────────────────────────────────────

type RuleInput = {
  article_number?: number | null;
  article_title?: string;
  topic: string;
  rule_text: string;
  not_regulated?: boolean;
  value_min?: number | null;
  value_max?: number | null;
  value_exact?: number | null;
  unit?: string | null;
  conditions?: string | null;
  summary: string;
  needs_vision?: boolean;
};

type ZoneInput = {
  zone_code: string;
  zone_label: string;
  zone_type: string;
  summary: string;
  rules: RuleInput[];
};

// ── Claude tool definition ────────────────────────────────────────────────────
// Strict schema: Claude cannot hallucinate a format. Each field is typed.
// value_min / value_max / value_exact are optional so Claude can omit them
// (treated as null) rather than inventing values.

const SAVE_RULE_TOOL: Anthropic.Tool = {
  name: "save_rule",
  description: "Enregistre une règle réglementaire extraite d'un article du PLU.",
  input_schema: {
    type: "object" as const,
    properties: {
      article_number: {
        type: "integer",
        description: "Numéro de l'article (6, 7, 9, 10…). Null si l'article n'est pas numéroté.",
      },
      article_title: {
        type: "string",
        description: "Titre exact de l'article tel qu'il apparaît dans le texte.",
      },
      topic: {
        type: "string",
        enum: [
          "destinations", "terrain_min", "recul_voie", "recul_limite",
          "recul_batiments", "emprise_sol", "hauteur", "aspect",
          "stationnement", "espaces_verts", "cos", "general",
        ],
        description: "Catégorie réglementaire.",
      },
      rule_text: {
        type: "string",
        description: "Texte fidèle de la règle, reformulé pour la clarté si nécessaire.",
      },
      not_regulated: {
        type: "boolean",
        description: "True si l'article indique explicitement 'sans objet', 'non réglementé', ou similaire.",
      },
      value_min: {
        type: "number",
        description: "Valeur minimale numérique (ex: recul minimal de 3m → 3). Omettre si absent.",
      },
      value_max: {
        type: "number",
        description: "Valeur maximale numérique (ex: hauteur max 9m → 9). Omettre si absent.",
      },
      value_exact: {
        type: "number",
        description: "Valeur unique exacte. Omettre si absent.",
      },
      unit: {
        type: "string",
        enum: ["m", "%", "m²", "places"],
        description: "Unité de la valeur principale. Omettre si pas de valeur numérique.",
      },
      conditions: {
        type: "string",
        description: "Conditions, exceptions ou règles alternatives (ex: 'UBa: jamais en limite'). Omettre si aucune.",
      },
      summary: {
        type: "string",
        description: "Résumé de la règle en 10 mots maximum.",
      },
      needs_vision: {
        type: "boolean",
        description: "True si le texte renvoie à un schéma ou croquis pour la valeur numérique principale (ex: 'voir schéma ci-contre').",
      },
    },
    required: ["article_number", "article_title", "topic", "rule_text", "not_regulated", "summary", "needs_vision"],
  },
};

// ── Step 1+2 — PDF extraction + page filter ───────────────────────────────────

function extractCleanText(pdfPath: string): string {
  console.log("  Extraction du texte PDF (pdftotext)…");
  const raw = execSync(`pdftotext "${pdfPath}" -`, {
    encoding: "utf-8",
    maxBuffer: 30 * 1024 * 1024,
  });

  // pdftotext uses form-feed (\f) as page separator
  const pages = raw.split("\f");
  const total = pages.length;

  const useful = pages.filter(p => p.trim().length > 300);
  const skipped = total - useful.length;

  console.log(`  → ${total} pages, ${skipped} ignorées (images/cartes/schémas), ${useful.length} pages réglementaires`);

  if (useful.length === 0) {
    throw new Error("Aucune page textuelle détectée. Le document est peut-être entièrement scanné — utilisez Claude Vision.");
  }

  return useful.join("\n\n");
}

// ── Step 3 — Zone discovery ───────────────────────────────────────────────────

async function discoverZones(
  text: string,
  client: Anthropic,
): Promise<Array<{ code: string; label: string; type: string }>> {

  // Regex scan first (fast, no API cost)
  const found = new Map<string, boolean>();
  const patterns = [
    /(?:^|\n)[ \t]*(?:ZONE|Zone)[ \t]+([A-Z][A-Z0-9]{0,5})[ \t]*(?:[-–—\n])/gm,
    /(?:^|\n)[ \t]*([1-9][A-Z]{2,4}|[A-Z]{1,2}[a-z]?)[ \t]*[-–—][ \t]*(?:Zone|ZONE)/gm,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const code = (m[1] ?? "").trim();
      if (code.length >= 1 && code.length <= 6) found.set(code, true);
    }
  }

  const regexCodes = [...found.keys()];
  if (regexCodes.length >= 2) {
    console.log(`  → Regex : ${regexCodes.length} zones détectées (${regexCodes.join(", ")})`);
    return regexCodes.map(code => ({
      code,
      label: `Zone ${code}`,
      type: code.startsWith("AU") || /^[12]AU/.test(code) ? "AU"
          : code.startsWith("A")  ? "A"
          : code.startsWith("N")  ? "N"
          : "U",
    }));
  }

  // Claude fallback on first 10 000 chars
  console.log("  → Regex insuffisante — identification des zones par Claude…");
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: `Voici le début d'un règlement PLU français.
Liste toutes les zones qui ont un règlement distinct (UA, UB, 1AU, N, NI, A, etc.).
Exclure les sous-secteurs sans règlement propre.
Répondre UNIQUEMENT avec un JSON array :
[{"code":"UA","label":"Zone UA – Centre ancien","type":"U"},…]
Types : "U"=urbaine, "AU"=à urbaniser, "A"=agricole, "N"=naturelle.

TEXTE :
${text.slice(0, 10000)}`,
    }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "[]";
  const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? "[]") as Array<{ code: string; label: string; type: string }>;
  console.log(`  → Claude : ${arr.length} zones (${arr.map(z => z.code).join(", ")})`);
  return arr;
}

// ── Step 4 — Zone text extraction ────────────────────────────────────────────

function sliceZone(fullText: string, code: string, allCodes: string[]): string {
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const starts = [
    new RegExp(`(?:^|\\n)[ \\t]*(?:ZONE|Zone)[ \\t]+${esc}[ \\t]*(?:[-–—]|\\n)`, "m"),
    new RegExp(`(?:^|\\n)[ \\t]*${esc}[ \\t]*[-–—][ \\t]*(?:Zone|ZONE)`, "m"),
    new RegExp(`(?:^|\\n)[ \\t]*(?:TITRE|CHAPITRE)[^\\n]*${esc}\\b`, "m"),
  ];

  let startIdx = -1;
  for (const re of starts) {
    const m = fullText.match(re);
    if (m?.index !== undefined) { startIdx = m.index; break; }
  }
  if (startIdx === -1) return "";

  // End = start of next zone
  let endIdx = fullText.length;
  for (const other of allCodes.filter(c => c !== code)) {
    const esc2 = other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\n)[ \\t]*(?:ZONE|Zone)[ \\t]+${esc2}[ \\t]*(?:[-–—]|\\n)`, "m");
    const m = fullText.slice(startIdx + 200).match(re);
    if (m?.index !== undefined) {
      const candidate = startIdx + 200 + m.index;
      if (candidate < endIdx) endIdx = candidate;
    }
  }

  return fullText.slice(startIdx, Math.min(endIdx, startIdx + 20000));
}

// ── Step 5 — Rule extraction via tool_use ────────────────────────────────────

async function extractRules(
  zoneCode: string,
  zoneText: string,
  client: Anthropic,
): Promise<RuleInput[]> {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    tools: [SAVE_RULE_TOOL],
    tool_choice: { type: "any" },
    messages: [{
      role: "user",
      content: `Tu es expert en droit de l'urbanisme français.
Voici le règlement de la zone ${zoneCode} d'un PLU.

Pour CHAQUE article présent (1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14…), appelle save_rule une fois.
Correspondance article → topic :
  1/2 → destinations | 5 → terrain_min | 6 → recul_voie | 7 → recul_limite
  8 → recul_batiments | 9 → emprise_sol | 10 → hauteur | 11 → aspect
  12 → stationnement | 13 → espaces_verts | 14 → cos

Règles importantes :
- Si l'article dit "sans objet" ou "non réglementé" → not_regulated = true, appelle quand même save_rule.
- Si plusieurs valeurs selon secteurs (ex: UC 50%, UCa 40%) → valeur principale dans value_max, variantes dans conditions.
- Si le texte dit "voir schéma" ou "comme indiqué au document graphique" pour une valeur numérique → needs_vision = true.
- N'invente aucune valeur. Si tu n'es pas certain, omets value_min/max/exact.

TEXTE DE LA ZONE ${zoneCode} :
${zoneText}`,
    }],
  });

  const rules: RuleInput[] = msg.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map(b => b.input as RuleInput);

  return rules;
}

// ── DB upsert ──────────────────────────────────────────────────────────────────

async function upsertZoneAndRules(
  commune_id: string,
  zoneData: ZoneInput,
  validationStatus: "valide" | "brouillon",
): Promise<void> {
  const [existing] = await db.select({ id: zones.id })
    .from(zones)
    .where(and(eq(zones.commune_id, commune_id), eq(zones.zone_code, zoneData.zone_code)))
    .limit(1);

  let zone_id: string;
  if (existing) {
    zone_id = existing.id;
    await db.update(zones).set({
      zone_label: zoneData.zone_label, zone_type: zoneData.zone_type,
      summary: zoneData.summary, updated_at: new Date(),
    }).where(eq(zones.id, zone_id));
    process.stdout.write(`  ↻ ${zoneData.zone_code}`);
  } else {
    const [created] = await db.insert(zones).values({
      commune_id, zone_code: zoneData.zone_code, zone_label: zoneData.zone_label,
      zone_type: zoneData.zone_type, summary: zoneData.summary,
      status: "active", is_active: true,
    }).returning();
    zone_id = created!.id;
    process.stdout.write(`  + ${zoneData.zone_code}`);
  }

  let visionCount = 0;
  for (const rule of zoneData.rules) {
    const [existingRule] = await db.select({ id: zone_regulatory_rules.id })
      .from(zone_regulatory_rules)
      .where(and(
        eq(zone_regulatory_rules.zone_id, zone_id),
        eq(zone_regulatory_rules.topic, rule.topic),
      ))
      .limit(1);

    const instructorNote = rule.needs_vision
      ? "⚠ La valeur numérique est dans un schéma — à vérifier manuellement."
      : null;
    if (rule.needs_vision) visionCount++;

    const payload = {
      article_number: rule.article_number ?? null,
      article_title: rule.article_title ?? (rule.article_number ? `Article ${rule.article_number}` : ""),
      topic: rule.topic,
      rule_text: rule.rule_text,
      value_min: rule.value_min ?? null,
      value_max: rule.value_max ?? null,
      value_exact: rule.value_exact ?? null,
      unit: rule.unit ?? null,
      conditions: rule.conditions ?? null,
      summary: rule.summary,
      instructor_note: instructorNote,
      validation_status: validationStatus,
    };

    if (existingRule) {
      await db.update(zone_regulatory_rules)
        .set({ ...payload, updated_at: new Date() })
        .where(eq(zone_regulatory_rules.id, existingRule.id));
    } else {
      await db.insert(zone_regulatory_rules).values({ zone_id, ...payload });
    }
  }

  const visionNote = visionCount > 0 ? ` (${visionCount} ⚠ schéma)` : "";
  console.log(` — ${zoneData.rules.length} règles [${validationStatus}]${visionNote}`);
}

// ── Ballan-Miré seed data (pre-validated) ────────────────────────────────────

const BALLAN_MIRE_SEED: ZoneInput[] = [
  { zone_code: "UA", zone_label: "Zone UA – Centre ancien", zone_type: "U", summary: "Cœur historique, bâti traditionnel dense en étoile autour de l'église.",
    rules: [
      { article_number: 6,  article_title: "Implantation / voies",   topic: "recul_voie",   rule_text: "Recul entre 0 et 1 m, ou alignement sur construction voisine, ou recul minimal de 6 m.", value_min: 0, value_max: 6, unit: "m", summary: "0-1m ou alignement ou ≥6m" },
      { article_number: 7,  article_title: "Implantation / limites",  topic: "recul_limite",  rule_text: "En limite séparative ou H/2 avec minimum 3 m.", value_min: 3, unit: "m", conditions: "H/2 minimum 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9,  article_title: "Emprise au sol",          topic: "emprise_sol",   rule_text: "Emprise au sol non réglementée en zone UA.", not_regulated: true, summary: "Non réglementé" },
      { article_number: 10, article_title: "Hauteur maximale",        topic: "hauteur",       rule_text: "6,5 m à l'égout ou à l'acrotère ; 9 m au faîtage.", value_max: 6.5, unit: "m", conditions: "Faîtage: 9m", summary: "6,5m égout / 9m faîtage" },
      { article_number: 12, article_title: "Stationnement",           topic: "stationnement", rule_text: "2 places/logement ≥2P. 1 place/50m² activités. Commerces ≤100m² : 0 place.", summary: "2 places/logement (≥2P)" },
      { article_number: 13, article_title: "Espaces libres",          topic: "espaces_verts", rule_text: "≥25% d'espaces libres en pleine terre. 1 arbre haute tige/100m².", value_min: 25, unit: "%", summary: "≥25% pleine terre" },
    ]},
  { zone_code: "UB", zone_label: "Zone UB – Extensions du centre", zone_type: "U", summary: "Extensions urbaines : collectifs R+3, mairie, ZAC des Prés, quartier gare. Quota social 20-30%.",
    rules: [
      { article_number: 6,  article_title: "Implantation / voies",   topic: "recul_voie",   rule_text: "Recul minimal de 6 m.", value_min: 6, unit: "m", summary: "≥6m" },
      { article_number: 7,  article_title: "Implantation / limites",  topic: "recul_limite",  rule_text: "En limite séparative ou H/2 min 3 m. UBa : jamais en limite.", value_min: 3, unit: "m", conditions: "UBa: jamais en limite – H/2 min 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9,  article_title: "Emprise au sol",          topic: "emprise_sol",   rule_text: "Emprise au sol max 50%. UBai (inondable) : 10%.", value_max: 50, unit: "%", conditions: "UBai: 10%", summary: "≤50% (UBai: 10%)" },
      { article_number: 10, article_title: "Hauteur maximale",        topic: "hauteur",       rule_text: "9 m à l'égout ; 14 m au faîtage (R+3).", value_max: 9, unit: "m", conditions: "Faîtage: 14m", summary: "9m égout / 14m faîtage" },
      { article_number: 12, article_title: "Stationnement",           topic: "stationnement", rule_text: "2 places/logement. Quota social : 20% pour 5-20 logements, 30% au-delà.", summary: "2 places/logement, quota social 20-30%" },
      { article_number: 13, article_title: "Espaces libres",          topic: "espaces_verts", rule_text: "≥35% d'espaces libres en pleine terre.", value_min: 35, unit: "%", summary: "≥35% pleine terre" },
    ]},
  { zone_code: "UC", zone_label: "Zone UC – Quartiers pavillonnaires", zone_type: "U", summary: "Zone majoritaire : lotissements, ZAC des Prés, hameaux de Miré et des Vallées.",
    rules: [
      { article_number: 6,  article_title: "Implantation / voies",   topic: "recul_voie",   rule_text: "Recul minimal de 3 m. RD751 : 45 m depuis l'axe.", value_min: 3, unit: "m", conditions: "RD751: 45m depuis axe", summary: "≥3m (RD751: 45m)" },
      { article_number: 7,  article_title: "Implantation / limites",  topic: "recul_limite",  rule_text: "En limite séparative ou H/2 min 3 m.", value_min: 3, unit: "m", conditions: "H/2 minimum 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9,  article_title: "Emprise au sol",          topic: "emprise_sol",   rule_text: "Emprise au sol maximale de 50%.", value_max: 50, unit: "%", summary: "≤50%" },
      { article_number: 10, article_title: "Hauteur maximale",        topic: "hauteur",       rule_text: "6,5 m à l'égout ; 9 m au faîtage (R+2).", value_max: 6.5, unit: "m", conditions: "Faîtage: 9m", summary: "6,5m égout / 9m faîtage" },
      { article_number: 12, article_title: "Stationnement",           topic: "stationnement", rule_text: "2 places/logement. Quota social : 20% dès 5 logements.", summary: "2 places/logement, quota social 20%" },
      { article_number: 13, article_title: "Espaces libres",          topic: "espaces_verts", rule_text: "≥40% d'espaces libres en pleine terre.", value_min: 40, unit: "%", summary: "≥40% pleine terre" },
    ]},
  { zone_code: "UD", zone_label: "Zone UD – Quartiers verdoyants", zone_type: "U", summary: "Habitat très peu dense. Terrain min 2 000 m². Limite séparative interdite.",
    rules: [
      { article_number: 5,  article_title: "Superficie minimale",     topic: "terrain_min",  rule_text: "Superficie minimale : 2 000 m².", value_min: 2000, unit: "m²", summary: "≥2 000m²" },
      { article_number: 6,  article_title: "Implantation / voies",   topic: "recul_voie",   rule_text: "Recul minimal de 7 m.", value_min: 7, unit: "m", summary: "≥7m" },
      { article_number: 7,  article_title: "Implantation / limites",  topic: "recul_limite",  rule_text: "Implantation en limite séparative interdite. H/2 min 3 m.", value_min: 3, unit: "m", conditions: "Jamais en limite – H/2 min 3m", summary: "Jamais en limite, H/2 (min 3m)" },
      { article_number: 9,  article_title: "Emprise au sol",          topic: "emprise_sol",   rule_text: "Emprise au sol maximale de 20%.", value_max: 20, unit: "%", summary: "≤20%" },
      { article_number: 10, article_title: "Hauteur maximale",        topic: "hauteur",       rule_text: "6,5 m à l'égout ; 8,5 m au faîtage.", value_max: 6.5, unit: "m", conditions: "Faîtage: 8.5m", summary: "6,5m égout / 8,5m faîtage" },
      { article_number: 12, article_title: "Stationnement",           topic: "stationnement", rule_text: "2 places par logement de 2 pièces et plus.", summary: "2 places/logement" },
      { article_number: 13, article_title: "Espaces libres",          topic: "espaces_verts", rule_text: "≥60% d'espaces libres en pleine terre.", value_min: 60, unit: "%", summary: "≥60% pleine terre" },
    ]},
  { zone_code: "A", zone_label: "Zone A – Agricole", zone_type: "A", summary: "Protection agronomique. Secteurs Ad, Ah, Ap.",
    rules: [
      { article_number: 9,  article_title: "Emprise au sol", topic: "emprise_sol", rule_text: "Libre pour exploitation agricole. Ah : +50% max 50 m². Ap : inconstructible.", not_regulated: false, conditions: "Ah: +50% max 50m²; Ap: inconstructible", summary: "Libre (Ah: +50% max 50m²)" },
      { article_number: 10, article_title: "Hauteur",        topic: "hauteur",     rule_text: "4 m à l'égout pour les habitations. Agricole : libre. Ah annexes : 3 m max.", value_max: 4, unit: "m", conditions: "Habitation; agricole libre; Ah annexes 3m", summary: "4m égout (habitation)" },
    ]},
  { zone_code: "N", zone_label: "Zone N – Naturelle et forestière", zone_type: "N", summary: "Espaces naturels protégés. Secteurs Nh, Ng, Na, Nb, Nf.",
    rules: [
      { article_number: 9,  article_title: "Emprise au sol", topic: "emprise_sol", rule_text: "Inconstructible. Nh (+50% max 50 m²), Ng (20%), Na (5%), Nb (300 m²), Nf (50%).", not_regulated: false, conditions: "Nh: +50% max 50m²; Ng: 20%; Na: 5%", summary: "Inconstructible (secteurs tolérés)" },
      { article_number: 10, article_title: "Hauteur",        topic: "hauteur",     rule_text: "Non réglementé sauf : Nh (existant/3 m annexes), Ng (5 m), Nb/Na/Nf (6 m).", not_regulated: false, conditions: "Nh 3m; Ng 5m; autres 6m", summary: "Libre (secteurs limités)" },
    ]},
  { zone_code: "NI", zone_label: "Zone NI – Inondable (vallée du Cher)", zone_type: "N", summary: "Soumis au PPRI. Sous-sols interdits.",
    rules: [
      { article_number: 9,  article_title: "Emprise au sol", topic: "emprise_sol", rule_text: "Extensions max 50 m² avec étage refuge. Sous-sols interdits.", value_max: 50, unit: "m²", conditions: "PPRI; étage refuge; sous-sols interdits", summary: "Extensions ≤50m² avec étage refuge" },
      { article_number: 10, article_title: "Hauteur / plancher", topic: "hauteur", rule_text: "Plancher habitable surélevé d'au moins 0,50 m / sol naturel. Étage refuge obligatoire.", value_min: 0.5, unit: "m", conditions: "Surélévation +0.50m NGF; étage refuge PHEC", summary: "Plancher +0.50m NGF" },
    ]},
];

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏙️  Ingestion PLU — ${COMMUNE_NAME} (INSEE ${INSEE_CODE})`);
  const mode = SEED_MODE || !PDF_PATH ? "seed vérifié Ballan-Miré" : `extraction PDF → ${PDF_PATH}`;
  console.log(`Mode : ${mode}${DRY_RUN ? "  [DRY RUN]" : ""}\n`);

  // Upsert commune
  let commune = (await db.select().from(communes).where(eq(communes.insee_code, INSEE_CODE)).limit(1))[0];
  if (!commune) {
    if (!DRY_RUN) {
      [commune] = await db.insert(communes).values({ name: COMMUNE_NAME, insee_code: INSEE_CODE, zip_code: ZIP_CODE }).returning();
    }
    console.log(`✓ Commune créée : ${COMMUNE_NAME} (${INSEE_CODE})`);
  } else {
    console.log(`✓ Commune : ${commune.name}`);
  }

  // ── Seed mode ──
  if (SEED_MODE || !PDF_PATH) {
    if (INSEE_CODE !== "37018") console.warn("⚠  Seed = règles Ballan-Miré uniquement. Pour une autre commune, utilisez --pdf.");
    console.log(`\n${BALLAN_MIRE_SEED.length} zones à traiter…`);
    for (const z of BALLAN_MIRE_SEED) {
      if (!DRY_RUN && commune) await upsertZoneAndRules(commune.id, z, "valide");
      else console.log(`  [DRY RUN] ${z.zone_code} — ${z.rules.length} règles`);
    }
    console.log(`\n✅ Seed terminé\n`);
    return;
  }

  // ── PDF mode ──
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`✗ Fichier introuvable : ${PDF_PATH}`); process.exit(1);
  }

  let cleanText: string;
  try {
    cleanText = extractCleanText(PDF_PATH);
  } catch (e) {
    console.error(`✗ ${e}`); process.exit(1);
  }

  const client = new Anthropic();

  // Step 3: zone discovery
  console.log("\nIdentification des zones…");
  const discoveredZones = await discoverZones(cleanText, client);
  if (!discoveredZones.length) {
    console.error("✗ Aucune zone trouvée. Vérifiez le document (bon fichier ? règlement écrit ?)");
    process.exit(1);
  }
  console.log(`✓ ${discoveredZones.length} zones\n`);

  const allCodes = discoveredZones.map(z => z.code);
  let totalRules = 0, totalVision = 0;

  for (const zoneInfo of discoveredZones) {
    process.stdout.write(`Zone ${zoneInfo.code}…`);

    const zoneText = sliceZone(cleanText, zoneInfo.code, allCodes);
    if (!zoneText) {
      console.log(` ⚠ section introuvable — ignorée`);
      continue;
    }

    let rules: RuleInput[];
    try {
      rules = await extractRules(zoneInfo.code, zoneText, client);
    } catch (e) {
      console.log(` ✗ erreur Claude : ${e}`);
      continue;
    }

    if (!rules.length) {
      console.log(` ⚠ aucune règle extraite`);
      continue;
    }

    const visionCount = rules.filter(r => r.needs_vision).length;
    totalRules  += rules.length;
    totalVision += visionCount;

    const zoneData: ZoneInput = {
      zone_code: zoneInfo.code,
      zone_label: zoneInfo.label,
      zone_type: zoneInfo.type,
      summary: "",
      rules,
    };

    if (!DRY_RUN && commune) {
      await upsertZoneAndRules(commune.id, zoneData, "brouillon");
    } else {
      console.log(` [DRY RUN] ${rules.length} règles${visionCount ? ` (${visionCount} ⚠ schéma)` : ""}`);
    }
  }

  console.log(`\n✅ Extraction terminée`);
  console.log(`   ${discoveredZones.length} zones · ${totalRules} règles · statut : brouillon`);
  if (totalVision > 0) {
    console.log(`   ⚠ ${totalVision} règles à vérifier manuellement (valeur dans un schéma)`);
  }
  console.log();
}

main().catch(e => { console.error(e); process.exit(1); });
