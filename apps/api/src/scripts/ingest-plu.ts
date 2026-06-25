/**
 * PLU Ingestion Script — v2
 *
 * Algorithm:
 *   1. Extract PDF text via pdftotext, split on form-feed (page boundaries)
 *   2. Filter pages: skip pages with < 300 chars (images, maps, schemas)
 *   3. Discover zones in the clean text (regex → LLM fallback)
 *   4. Segment text by zone
 *   5. Per zone: LLM tool_use with strict schema → one call, N rules
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
import { execFileSync } from "child_process";
import fs from "fs";
import { callAi, type AiToolDefinition } from "../services/aiUsage.js";

// ── CLI ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] ?? null : null; };
const has = (flag: string) => args.includes(flag);

const COMMUNE_NAME = get("--commune") ?? "Ballan-Miré";
const INSEE_CODE   = get("--insee")   ?? "37018";
const ZIP_CODE     = get("--zip")     ?? "37510";
const PDF_PATH     = get("--pdf");
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

// ── Outil de fonction (format OpenAI / Mistral) ───────────────────────────────
// Schéma strict : le modèle ne peut pas inventer le format. value_min /
// value_max / value_exact sont optionnels pour qu'il puisse les omettre
// (traité comme null) plutôt qu'inventer une valeur.

const SAVE_RULE_TOOL: AiToolDefinition = {
  type: "function",
  function: {
    name: "save_rule",
    description: "Enregistre une règle réglementaire extraite d'un article du PLU.",
    parameters: {
      type: "object",
      properties: {
        article_number: { type: "number", description: "Numéro de l'article, décimal autorisé pour les PLU modernisés (6, 7, 12.1, 12.2…). Null si l'article n'est pas numéroté." },
        article_title: { type: "string", description: "Titre exact de l'article tel qu'il apparaît dans le texte." },
        topic: {
          type: "string",
          enum: ["destinations","terrain_min","recul_voie","recul_limite","recul_batiments","emprise_sol","hauteur","aspect","stationnement","espaces_verts","cos","general"],
          description: "Catégorie réglementaire.",
        },
        rule_text: { type: "string", description: "Texte fidèle de la règle, reformulé pour la clarté si nécessaire." },
        not_regulated: { type: "boolean", description: "True si l'article indique explicitement 'sans objet', 'non réglementé', ou similaire." },
        value_min: { type: "number", description: "Valeur minimale numérique (ex: recul minimal de 3m → 3). Omettre si absent." },
        value_max: { type: "number", description: "Valeur maximale numérique (ex: hauteur max 9m → 9). Omettre si absent." },
        value_exact: { type: "number", description: "Valeur unique exacte. Omettre si absent." },
        unit: { type: "string", enum: ["m","%","m²","places"], description: "Unité de la valeur principale. Omettre si pas de valeur numérique." },
        conditions: { type: "string", description: "Conditions, exceptions ou règles alternatives (ex: 'UBa: jamais en limite'). Omettre si aucune." },
        summary: { type: "string", description: "Résumé de la règle en 10 mots maximum." },
        needs_vision: { type: "boolean", description: "True si le texte renvoie à un schéma ou croquis pour la valeur numérique principale (ex: 'voir schéma ci-contre')." },
      },
      required: ["article_number","article_title","topic","rule_text","not_regulated","summary","needs_vision"],
    },
  },
};

// ── Step 1+2 — PDF extraction + page filter ───────────────────────────────────

function extractCleanText(pdfPath: string): string {
  console.log("  Extraction du texte PDF (pdftotext)…");
  const raw = execFileSync("pdftotext", [pdfPath, "-"], {
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
    throw new Error("Aucune page textuelle détectée. Le document est peut-être entièrement scanné — utilisez Pixtral Vision via la route mairie/admin/ingest-plu-pdf.");
  }

  return useful.join("\n\n");
}

// ── Step 3 — Zone discovery ───────────────────────────────────────────────────

async function discoverZones(
  text: string,
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

  // Fallback Mistral sur les 10 000 premiers caractères
  console.log("  → Regex insuffisante — identification des zones par Mistral…");
  const msg = await callAi(
    { purpose: "plu_zone_discover_cli" },
    {
      model: "ai-smart",
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
    },
  );

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "[]";
  const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? "[]") as Array<{ code: string; label: string; type: string }>;
  console.log(`  → Mistral : ${arr.length} zones (${arr.map(z => z.code).join(", ")})`);
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
): Promise<RuleInput[]> {
  const msg = await callAi(
    { purpose: "plu_rule_extract_cli" },
    {
    model: "ai-smart",
    max_tokens: 4000,
    tools: [SAVE_RULE_TOOL],
    tool_choice: "any",
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
    },
  );

  const rules: RuleInput[] = msg.content
    .filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use")
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


// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏙️  Ingestion PLU — ${COMMUNE_NAME} (INSEE ${INSEE_CODE})`);
  // La réglementation provient EXCLUSIVEMENT de l'ingestion documentaire — aucune donnée en dur.
  if (!PDF_PATH) {
    console.error("✗ --pdf <chemin> requis : la réglementation est extraite du document PLU, il n'existe pas de jeu de règles codé en dur.");
    process.exit(1);
  }
  console.log(`Mode : extraction PDF → ${PDF_PATH}${DRY_RUN ? "  [DRY RUN]" : ""}\n`);

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

  // ── PDF mode (unique source : le document) ──
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`✗ Fichier introuvable : ${PDF_PATH}`); process.exit(1);
  }

  let cleanText: string;
  try {
    cleanText = extractCleanText(PDF_PATH);
  } catch (e) {
    console.error(`✗ ${e}`); process.exit(1);
  }

  // Step 3: zone discovery
  console.log("\nIdentification des zones…");
  const discoveredZones = await discoverZones(cleanText);
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
      rules = await extractRules(zoneInfo.code, zoneText);
    } catch (e) {
      console.log(` ✗ erreur Mistral : ${e}`);
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
