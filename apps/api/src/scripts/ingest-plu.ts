/**
 * PLU Ingestion Script — general-purpose
 *
 * Extracts regulatory rules from any French PLU règlement PDF using a
 * two-pass Claude API strategy and stores them in the zone_regulatory_rules
 * table with validation_status = "brouillon" (requires instructeur review).
 *
 * Usage:
 *   # AI extraction from PDF (any commune)
 *   npx tsx src/scripts/ingest-plu.ts \
 *     --commune "Rochecorbon" --insee 37194 --zip 37210 \
 *     --pdf /path/to/reglement.pdf
 *
 *   # Verified seed for Ballan-Miré (validation_status = "valide")
 *   npx tsx src/scripts/ingest-plu.ts \
 *     --commune "Ballan-Miré" --insee 37018 --zip 37510 --seed
 *
 * Two-pass AI extraction:
 *   Pass 1  →  Identify all zone codes and labels from the document.
 *   Pass 2  →  For each zone, extract all regulatory rules (articles 1-14).
 */

import { db } from "../db.js";
import { zones, zone_regulatory_rules, communes } from "@heureka-v1/db";
import { eq, and } from "drizzle-orm";
import { execSync } from "child_process";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

// ── CLI args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has = (flag: string) => args.includes(flag);

const COMMUNE_NAME = get("--commune") ?? "Ballan-Miré";
const INSEE_CODE   = get("--insee")   ?? "37018";
const ZIP_CODE     = get("--zip")     ?? "37510";
const PDF_PATH     = get("--pdf");
const SEED_MODE    = has("--seed");
const DRY_RUN      = has("--dry-run");

// ── Types ──────────────────────────────────────────────────────────────────────

type RuleInput = {
  article_number: number;
  article_title?: string;
  topic: string;
  rule_text: string;
  value_min?: number | null;
  value_max?: number | null;
  value_exact?: number | null;
  unit?: string | null;
  conditions?: string | null;
  summary?: string | null;
};

type ZoneInput = {
  zone_code: string;
  zone_label: string;
  zone_type: string;
  summary: string;
  rules: RuleInput[];
};

// ── Ballan-Miré verified seed data ────────────────────────────────────────────
// Source: PLU-Ballan-Reglement.pdf, modification n°5, approved 29/01/2018.
// These rules are pre-validated — they skip the brouillon stage.

const BALLAN_MIRE_ZONES: ZoneInput[] = [
  {
    zone_code: "UA", zone_label: "Zone UA – Centre ancien", zone_type: "U",
    summary: "Cœur historique, bâti traditionnel dense en étoile autour de l'église.",
    rules: [
      { article_number: 6,  topic: "recul_voie",   rule_text: "Recul entre 0 et 1 m, ou alignement sur construction voisine, ou recul minimal de 6 m. Un élément d'architecture doit souligner l'alignement en cas de recul.", value_min: 0, value_max: 6, unit: "m", summary: "0-1m ou alignement ou ≥6m" },
      { article_number: 7,  topic: "recul_limite",  rule_text: "En limite séparative ou à distance ≥ moitié de la hauteur avec un minimum de 3 m.", value_min: 3, unit: "m", conditions: "H/2 minimum 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Emprise au sol non réglementée en zone UA.", summary: "Non réglementé" },
      { article_number: 10, topic: "hauteur",       rule_text: "Hauteur maximale : 6,5 m à l'égout ou à l'acrotère ; 9 m au faîtage. Une hauteur différente est admise si elle n'excède pas le bâtiment voisin le plus proche.", value_max: 6.5, unit: "m", conditions: "Faîtage: 9m", summary: "6,5m égout / 9m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "1 place/logement 1P ; 2 places pour ≥2P. Activités : 1 place/50m² SP. Commerces ≤100m² : 0 place. Vélos : 1 emplacement/logement.", summary: "2 places/logement (≥2P), 1/50m² activités" },
      { article_number: 13, topic: "espaces_verts", rule_text: "≥25% d'espaces libres en pleine terre. 1 arbre haute tige/100m² d'espaces libres.", value_min: 25, unit: "%", summary: "≥25% pleine terre" },
    ],
  },
  {
    zone_code: "UB", zone_label: "Zone UB – Extensions du centre", zone_type: "U",
    summary: "Extensions urbaines : collectifs R+3, nouvelle mairie, ZAC des Prés, quartier gare. Quota social 20-30%.",
    rules: [
      { article_number: 6,  topic: "recul_voie",   rule_text: "Recul minimal de 6 m par rapport aux voies.", value_min: 6, unit: "m", summary: "≥6m" },
      { article_number: 7,  topic: "recul_limite",  rule_text: "En limite séparative ou H/2 min 3 m. Secteur UBa : jamais en limite — H/2 min 3 m.", value_min: 3, unit: "m", conditions: "UBa: jamais en limite – H/2 min 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Emprise au sol max 50%. Secteur UBai (inondable) : limité à 10%.", value_max: 50, unit: "%", conditions: "UBai: 10%", summary: "≤50% (UBai: 10%)" },
      { article_number: 10, topic: "hauteur",       rule_text: "9 m à l'égout ou à l'acrotère ; 14 m au faîtage (R+3).", value_max: 9, unit: "m", conditions: "Faîtage: 14m", summary: "9m égout / 14m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "2 places/logement (1 pour logements aidés). Quota social : 20% pour 5-20 logements, 30% au-delà. Pré-équipement recharge électrique obligatoire.", summary: "2 places/logement, quota social 20-30%" },
      { article_number: 13, topic: "espaces_verts", rule_text: "≥35% d'espaces libres en pleine terre. 1 arbre haute tige/100m².", value_min: 35, unit: "%", summary: "≥35% pleine terre" },
    ],
  },
  {
    zone_code: "UC", zone_label: "Zone UC – Quartiers pavillonnaires", zone_type: "U",
    summary: "Zone majoritaire : lotissements, ZAC des Prés, hameaux de Miré et des Vallées. Quota social 20% dès 5 logements.",
    rules: [
      { article_number: 6,  topic: "recul_voie",   rule_text: "Recul minimal de 3 m. RD751 : 45 m depuis l'axe de la voie.", value_min: 3, unit: "m", conditions: "RD751: 45m depuis axe", summary: "≥3m (RD751: 45m)" },
      { article_number: 7,  topic: "recul_limite",  rule_text: "En limite séparative ou H/2 min 3 m.", value_min: 3, unit: "m", conditions: "H/2 minimum 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Emprise au sol maximale de 50%.", value_max: 50, unit: "%", summary: "≤50%" },
      { article_number: 10, topic: "hauteur",       rule_text: "6,5 m à l'égout ; 9 m au faîtage (R+2).", value_max: 6.5, unit: "m", conditions: "Faîtage: 9m", summary: "6,5m égout / 9m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "2 places/logement. Quota social : 20% dès 5 logements.", summary: "2 places/logement, quota social 20%" },
      { article_number: 13, topic: "espaces_verts", rule_text: "≥40% d'espaces libres en pleine terre. 1 arbre haute tige/100m².", value_min: 40, unit: "%", summary: "≥40% pleine terre" },
    ],
  },
  {
    zone_code: "UD", zone_label: "Zone UD – Quartiers verdoyants (Haute Lande, Miré)", zone_type: "U",
    summary: "Habitat individuel très peu dense en espaces boisés. Terrain min 2 000 m². Limite séparative interdite.",
    rules: [
      { article_number: 5,  topic: "terrain_min",  rule_text: "Superficie minimale des terrains constructibles : 2 000 m².", value_min: 2000, unit: "m²", summary: "≥2 000m² par terrain" },
      { article_number: 6,  topic: "recul_voie",   rule_text: "Recul minimal de 7 m par rapport aux voies et emprises publiques.", value_min: 7, unit: "m", summary: "≥7m" },
      { article_number: 7,  topic: "recul_limite",  rule_text: "Implantation en limite séparative interdite. Recul min H/2 avec minimum 3 m.", value_min: 3, unit: "m", conditions: "Jamais en limite – H/2 min 3m", summary: "Jamais en limite, H/2 (min 3m)" },
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Emprise au sol maximale de 20%.", value_max: 20, unit: "%", summary: "≤20%" },
      { article_number: 10, topic: "hauteur",       rule_text: "6,5 m à l'égout ; 8,5 m au faîtage.", value_max: 6.5, unit: "m", conditions: "Faîtage: 8.5m", summary: "6,5m égout / 8,5m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "2 places par logement de 2 pièces et plus.", summary: "2 places/logement" },
      { article_number: 13, topic: "espaces_verts", rule_text: "≥60% d'espaces libres en pleine terre. Maintien obligatoire des arbres existants.", value_min: 60, unit: "%", summary: "≥60% pleine terre" },
    ],
  },
  {
    zone_code: "UZ", zone_label: "Zone UZ – ZAC de la Pasqueraie", zone_type: "U",
    summary: "Zone d'habitat récent mixte. UZa : collectifs R+3-4 (14m). UZb : formes compactes.",
    rules: [
      { article_number: 6,  topic: "recul_voie",   rule_text: "Recul minimal de 5 m.", value_min: 5, unit: "m", summary: "≥5m" },
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Emprise au sol max 50% (40% en UZa — logements collectifs).", value_max: 50, unit: "%", conditions: "UZa: 40%", summary: "≤50% (UZa: 40%)" },
      { article_number: 10, topic: "hauteur",       rule_text: "14 m en UZa ; 11 m en UZb.", value_max: 14, unit: "m", conditions: "UZb: 11m", summary: "14m (UZa) / 11m (UZb)" },
      { article_number: 13, topic: "espaces_verts", rule_text: "≥40% d'espaces libres en pleine terre.", value_min: 40, unit: "%", summary: "≥40% pleine terre" },
    ],
  },
  {
    zone_code: "UX", zone_label: "Zone UX – Activités La Châtaigneraie", zone_type: "U",
    summary: "Zone d'activités économiques. Reculs stricts RD751/RD751c.",
    rules: [
      { article_number: 6,  topic: "recul_voie",   rule_text: "45 m depuis l'axe RD751 ; 25 m depuis la RD751c. Aucun accès individuel sur RD751c.", value_min: 45, unit: "m", conditions: "RD751: 45m axe; RD751c: 25m", summary: "45m (RD751) / 25m (RD751c)" },
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Emprise au sol max 60%.", value_max: 60, unit: "%", summary: "≤60%" },
      { article_number: 10, topic: "hauteur",       rule_text: "Hauteur maximale de 10 m.", value_max: 10, unit: "m", summary: "≤10m" },
      { article_number: 12, topic: "stationnement", rule_text: "1 place/50m² SP. Pré-équipement recharge électrique obligatoire.", summary: "1 place/50m²" },
    ],
  },
  {
    zone_code: "UY", zone_label: "Zone UY – Activités Carrefour en Touraine", zone_type: "U",
    summary: "Grande zone d'activités. Hauteurs jusqu'à 15 m.",
    rules: [
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Emprise au sol max 50%.", value_max: 50, unit: "%", summary: "≤50%" },
      { article_number: 10, topic: "hauteur",       rule_text: "Hauteur maximale de 15 m.", value_max: 15, unit: "m", summary: "≤15m" },
    ],
  },
  {
    zone_code: "UL", zone_label: "Zone UL – Sports et Loisirs", zone_type: "U",
    summary: "Équipements sportifs et de loisirs : centre équestre, camping, base nautique.",
    rules: [
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Emprise au sol non réglementée pour les équipements sportifs et de loisirs.", summary: "Non réglementé" },
      { article_number: 10, topic: "hauteur",       rule_text: "Hauteur non réglementée pour les équipements sportifs et de loisirs.", summary: "Non réglementé" },
    ],
  },
  {
    zone_code: "US", zone_label: "Zone US – Établissements sanitaires et sociaux", zone_type: "U",
    summary: "IEM Charlemagne, centre de rééducation, SDIS, captage eau (USf).",
    rules: [
      { article_number: 7,  topic: "recul_limite",  rule_text: "Recul de 10 m par rapport aux limites séparatives.", value_min: 10, unit: "m", summary: "≥10m des limites" },
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Non réglementé pour les équipements sanitaires.", summary: "Non réglementé" },
      { article_number: 10, topic: "hauteur",       rule_text: "Non réglementé pour les équipements sanitaires.", summary: "Non réglementé" },
    ],
  },
  {
    zone_code: "UV", zone_label: "Zone UV – Village Vacances", zone_type: "U",
    summary: "Opération de village-vacances en cours.",
    rules: [
      { article_number: 6,  topic: "recul_voie",   rule_text: "Recul minimal de 10 m par rapport aux voies.", value_min: 10, unit: "m", summary: "≥10m" },
      { article_number: 10, topic: "hauteur",       rule_text: "Hauteur maximale de 9 m au faîtage.", value_max: 9, unit: "m", summary: "≤9m faîtage" },
    ],
  },
  {
    zone_code: "1AU", zone_label: "Zone 1AU – La Savatterie", zone_type: "AU",
    summary: "Secteur résidentiel à urbaniser à court terme dans le vallon.",
    rules: [
      { article_number: 6,  topic: "recul_voie",   rule_text: "Recul minimal de 5 m.", value_min: 5, unit: "m", summary: "≥5m" },
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Emprise au sol max 50%.", value_max: 50, unit: "%", summary: "≤50%" },
      { article_number: 10, topic: "hauteur",       rule_text: "Hauteur maximale de 7,5 m au faîtage pour s'insérer dans le vallon.", value_max: 7.5, unit: "m", summary: "≤7,5m faîtage" },
      { article_number: 13, topic: "espaces_verts", rule_text: "≥40% d'espaces libres en pleine terre.", value_min: 40, unit: "%", summary: "≥40% pleine terre" },
    ],
  },
  {
    zone_code: "1AUZ", zone_label: "Zone 1AUZ – ZAC Pasqueraie 3e tranche", zone_type: "AU",
    summary: "Dernière tranche ZAC Pasqueraie. 25% logements sociaux requis.",
    rules: [
      { article_number: 9,  topic: "emprise_sol",   rule_text: "Emprise au sol cohérente avec la ZAC existante, selon secteur.", summary: "Variable selon secteur" },
      { article_number: 10, topic: "hauteur",       rule_text: "Hauteur variable selon l'emplacement : 10 à 14 m.", value_min: 10, value_max: 14, unit: "m", summary: "10-14m selon emplacement" },
      { article_number: 13, topic: "espaces_verts", rule_text: "≥25% d'espaces libres en pleine terre.", value_min: 25, unit: "%", summary: "≥25% pleine terre" },
    ],
  },
  {
    zone_code: "AUH", zone_label: "Zone AUH – Urbanisation future résidentielle", zone_type: "AU",
    summary: "Secteurs futurs (Les Galbrunes, La Butorderie). Inconstructible sans révision PLU.",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Extensions uniquement : +50% de l'emprise existante, max 50 m². Nouvelle construction = révision PLU obligatoire.", value_max: 50, unit: "m²", conditions: "Extensions uniquement; révision PLU pour construire", summary: "Extensions seules (+50% max 50m²)" },
    ],
  },
  {
    zone_code: "AUY", zone_label: "Zone AUY – Urbanisation future économique", zone_type: "AU",
    summary: "Extension future zone activités Carrefour. Inconstructible sauf extensions.",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Extensions du bâti existant uniquement : +50% de l'emprise existante. Nouvelle construction = modification PLU obligatoire.", value_max: 50, unit: "%", conditions: "Extensions bâti existant uniquement", summary: "Extensions seules (+50% existant)" },
    ],
  },
  {
    zone_code: "A", zone_label: "Zone A – Agricole", zone_type: "A",
    summary: "Protège le potentiel agronomique. Ad (diversification), Ah (habitat isolé), Ap (protection paysagère — inconstructible).",
    rules: [
      { article_number: 9,  topic: "emprise_sol", rule_text: "Libre pour l'exploitation agricole. Ah : +50% de l'emprise existante max 50 m². Ap : inconstructible.", summary: "Libre (Ah: +50% max 50m²; Ap: inconstructible)" },
      { article_number: 10, topic: "hauteur",     rule_text: "4 m à l'égout pour les habitations. Pas de limite pour les bâtiments agricoles. Ah annexes : 3 m max.", value_max: 4, unit: "m", conditions: "Habitation seule; agricole libre; Ah annexes 3m", summary: "4m égout (habitation)" },
    ],
  },
  {
    zone_code: "N", zone_label: "Zone N – Naturelle et forestière", zone_type: "N",
    summary: "Espaces naturels et boisés protégés. Nh (bâti +50m²), Ng (golf 20%), Na (gens du voyage 5%), Nb, Nf.",
    rules: [
      { article_number: 9,  topic: "emprise_sol", rule_text: "Inconstructible en principe. Secteurs tolérés : Nh (+50% max 50 m²), Ng (20%), Na (5%), Nb (300 m²), Nf (50%).", summary: "Inconstructible (secteurs: Nh/Ng/Na/Nb/Nf)" },
      { article_number: 10, topic: "hauteur",     rule_text: "Non réglementé sauf : Nh (hauteur existant; annexes 3 m), Ng (5 m max), Nb/Na/Nf (6 m max).", summary: "Libre (Nh ext./3m; Ng 5m; autres 6m)" },
    ],
  },
  {
    zone_code: "NI", zone_label: "Zone NI – Inondable (vallée du Cher)", zone_type: "N",
    summary: "Val de Tours–Val de Luynes, PPRI. NI1 (aléa faible à fort), NI2 (fort fréquent), NI3 (lit du Cher).",
    rules: [
      { article_number: 9,  topic: "emprise_sol", rule_text: "Extensions très limitées : max 50 m² sous conditions strictes PPRI. Étage refuge au-dessus des plus hautes eaux connues obligatoire.", value_max: 50, unit: "m²", conditions: "PPRI; étage refuge; sous-sols interdits", summary: "Extensions ≤50m² avec étage refuge" },
      { article_number: 10, topic: "hauteur",     rule_text: "Plancher habitable surélevé d'au moins 0,50 m par rapport au sol naturel. Étage refuge obligatoire au-dessus des PHEC.", value_min: 0.5, unit: "m", conditions: "Surélévation +0.50m NGF; étage refuge PHEC", summary: "Plancher +0.50m NGF; étage refuge PHEC" },
    ],
  },
];

// ── Pass 1 — Zone discovery ────────────────────────────────────────────────────

async function discoverZones(
  pdfText: string,
  client: Anthropic,
): Promise<Array<{ code: string; label: string; type: string }>> {
  // First try a fast regex scan (works for most standard French PLUs)
  const regexFound = new Map<string, boolean>();
  const patterns = [
    /(?:^|\n)\s*(?:ZONE|Zone)\s+([A-Z][A-Z0-9]*(?:[a-z][A-Z0-9]*)?)\s*(?:[-–—]|\n)/gm,
    /(?:^|\n)\s*([A-Z][A-Z0-9]*)\s*[-–—]\s*(?:Zone|ZONE)\s+/gm,
  ];
  for (const re of patterns) {
    for (const m of pdfText.matchAll(re)) {
      if (m[1] && m[1].length >= 1 && m[1].length <= 6) regexFound.set(m[1], true);
    }
  }

  // If regex found ≥2 zones, trust it and enrich via Claude
  const regexCodes = [...regexFound.keys()];
  if (regexCodes.length >= 2) {
    console.log(`  → Regex detected ${regexCodes.length} zones: ${regexCodes.join(", ")}`);
    // Enrich with labels + types using Claude
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Voici les codes de zones détectés dans un PLU français: ${regexCodes.join(", ")}.
Pour chaque code, déduis le type de zone (U, AU, A ou N — premier caractère significatif du code) et propose un label court.
Retourne UNIQUEMENT un JSON array: [{"code":"UA","label":"Zone UA – …","type":"U"}, …]
Règles: type = "U" si commence par U, "AU" si commence par AU ou 1AU ou 2AU, "A" si commence par A (hors AU), "N" si commence par N.`,
      }],
    });
    try {
      const text = msg.content[0]?.type === "text" ? msg.content[0].text : "[]";
      const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]") as Array<{ code: string; label: string; type: string }>;
      if (arr.length > 0) return arr;
    } catch { /* fall through */ }
  }

  // Fallback: full Claude zone discovery from first 10000 chars
  console.log("  → Regex insufficient — using Claude for zone discovery…");
  const sample = pdfText.slice(0, 10000);
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [{
      role: "user",
      content: `Tu es expert en documents d'urbanisme français. Voici le début d'un règlement PLU.
Identifie TOUTES les zones qui ont un règlement distinct dans ce document (UA, UB, UC, N, A, 1AU, NI, etc.).
N'inclus PAS les sous-secteurs qui n'ont pas de règlement propre (ex: UBa si UBa est juste mentionné dans UB).
Pour chaque zone:
  - code: code exact (ex: "UA", "1AU", "NI")
  - label: libellé court (ex: "Zone UA – Centre ancien")
  - type: "U" | "AU" | "A" | "N" (classification réglementaire)

Retourne UNIQUEMENT un JSON array. Exemple:
[{"code":"UA","label":"Zone UA – Centre ancien","type":"U"},{"code":"N","label":"Zone N – Naturelle","type":"N"}]

TEXTE DU PLU:
${sample}`,
    }],
  });

  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "[]";
  try {
    const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]") as Array<{ code: string; label: string; type: string }>;
    console.log(`  → Claude detected ${arr.length} zones: ${arr.map(z => z.code).join(", ")}`);
    return arr;
  } catch {
    console.error("  ✗ Zone discovery failed — check PDF quality");
    return [];
  }
}

// ── Pass 2 — Extract rules for one zone ───────────────────────────────────────

async function extractZoneRules(
  zoneCode: string,
  zoneText: string,
  client: Anthropic,
): Promise<RuleInput[]> {
  const prompt = `Tu es expert en droit de l'urbanisme français.
Voici le texte du règlement PLU pour la zone ${zoneCode}.
Extrais toutes les règles quantitatives des articles suivants:

| Article | Topic (identifiant) |
|---------|---------------------|
| Art 1-2 | "destinations"      |
| Art 5   | "terrain_min"       |
| Art 6   | "recul_voie"        |
| Art 7   | "recul_limite"      |
| Art 8   | "recul_batiments"   |
| Art 9   | "emprise_sol"       |
| Art 10  | "hauteur"           |
| Art 11  | "aspect"            |
| Art 12  | "stationnement"     |
| Art 13  | "espaces_verts"     |
| Art 14  | "cos"               |

Pour chaque article présent, retourne un objet JSON:
{
  "article_number": <number>,
  "article_title": <string — titre de l'article tel qu'il apparaît>,
  "topic": <identifiant ci-dessus>,
  "rule_text": <texte fidèle ou reformulé de manière concise>,
  "value_min": <number | null>,
  "value_max": <number | null>,
  "value_exact": <number | null>,
  "unit": "m" | "%" | "m²" | "places" | null,
  "conditions": <cas particuliers, secteurs spéciaux, ou null>,
  "summary": <résumé en 10 mots max>
}

Règles importantes:
- Si "Non réglementé" ou "sans objet", inclus quand même la règle avec values à null.
- Si plusieurs valeurs selon secteurs (ex: "UC: 50%, UCa: 40%"), mets la valeur principale et les variantes dans "conditions".
- Inclus UNIQUEMENT les articles présents dans le texte.
- Réponds UNIQUEMENT avec un JSON array valide, sans texte autour.

TEXTE:
${zoneText.slice(0, 14000)}`;

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "[]";
    const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]") as RuleInput[];
    return arr;
  } catch (e) {
    console.error(`  ✗ Rule extraction failed for zone ${zoneCode}:`, e);
    return [];
  }
}

// ── Find zone text section in full PDF ────────────────────────────────────────

function extractZoneSection(fullText: string, zoneCode: string, allCodes: string[]): string {
  // Build patterns that match common French PLU zone headers
  const escaped = zoneCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerPatterns = [
    new RegExp(`(?:^|\\n)[ \\t]*(?:ZONE|Zone)[ \\t]+${escaped}[ \\t]*(?:[-–—]|\\n)`, "m"),
    new RegExp(`(?:^|\\n)[ \\t]*${escaped}[ \\t]*[-–—][ \\t]*(?:Zone|ZONE|zone)`, "m"),
    new RegExp(`(?:^|\\n)[ \\t]*CHAPITRE[^\\n]*[ \\t]+${escaped}\\b`, "m"),
    new RegExp(`(?:^|\\n)[ \\t]*${escaped}\\b[^\\n]*\\n[ \\t]*DISPOSITIONS`, "m"),
  ];

  let startIdx = -1;
  for (const re of headerPatterns) {
    const m = fullText.match(re);
    if (m?.index !== undefined) { startIdx = m.index; break; }
  }
  if (startIdx === -1) return "";

  // Find the end: start of the next zone section
  const otherCodes = allCodes.filter(c => c !== zoneCode);
  let endIdx = fullText.length;
  for (const other of otherCodes) {
    const escapedOther = other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\n)[ \\t]*(?:ZONE|Zone)[ \\t]+${escapedOther}[ \\t]*(?:[-–—]|\\n)`, "m");
    const m = fullText.slice(startIdx + 200).match(re);
    if (m?.index !== undefined) {
      const candidate = startIdx + 200 + m.index;
      if (candidate < endIdx) endIdx = candidate;
    }
  }

  return fullText.slice(startIdx, Math.min(endIdx, startIdx + 18000));
}

// ── DB upsert ──────────────────────────────────────────────────────────────────

async function upsertZoneAndRules(
  commune_id: string,
  zoneData: ZoneInput,
  validationStatus: "valide" | "brouillon",
): Promise<void> {
  // Upsert zone
  const [existing] = await db.select({ id: zones.id })
    .from(zones)
    .where(and(eq(zones.commune_id, commune_id), eq(zones.zone_code, zoneData.zone_code)))
    .limit(1);

  let zone_id: string;
  if (existing) {
    zone_id = existing.id;
    await db.update(zones)
      .set({ zone_label: zoneData.zone_label, zone_type: zoneData.zone_type, summary: zoneData.summary, updated_at: new Date() })
      .where(eq(zones.id, zone_id));
    console.log(`  ↻ Zone ${zoneData.zone_code} mise à jour`);
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
    console.log(`  + Zone ${zoneData.zone_code} créée`);
  }

  // Upsert rules
  let newCount = 0, updateCount = 0;
  for (const rule of zoneData.rules) {
    const [existingRule] = await db.select({ id: zone_regulatory_rules.id })
      .from(zone_regulatory_rules)
      .where(and(eq(zone_regulatory_rules.zone_id, zone_id), eq(zone_regulatory_rules.topic, rule.topic)))
      .limit(1);

    const payload = {
      article_number: rule.article_number ?? null,
      article_title: rule.article_title ?? `Article ${rule.article_number}`,
      topic: rule.topic,
      rule_text: rule.rule_text,
      value_min: rule.value_min ?? null,
      value_max: rule.value_max ?? null,
      value_exact: rule.value_exact ?? null,
      unit: rule.unit ?? null,
      conditions: rule.conditions ?? null,
      summary: rule.summary ?? null,
      validation_status: validationStatus,
    };

    if (existingRule) {
      await db.update(zone_regulatory_rules).set({ ...payload, updated_at: new Date() }).where(eq(zone_regulatory_rules.id, existingRule.id));
      updateCount++;
    } else {
      await db.insert(zone_regulatory_rules).values({ zone_id, ...payload });
      newCount++;
    }
    console.log(`    • [${validationStatus}] ${rule.topic}: ${rule.summary ?? rule.rule_text.slice(0, 60)}`);
  }
  console.log(`    → ${newCount} créée(s), ${updateCount} mise(s) à jour`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏙️  Ingestion PLU — ${COMMUNE_NAME} (INSEE ${INSEE_CODE})`);

  const mode = SEED_MODE ? "seed (règles Ballan-Miré vérifiées)" : PDF_PATH ? `extraction IA → ${PDF_PATH}` : "seed (défaut)";
  console.log(`Mode: ${mode}${DRY_RUN ? " [DRY RUN]" : ""}\n`);

  // Upsert commune
  let commune = (await db.select().from(communes).where(eq(communes.insee_code, INSEE_CODE)).limit(1))[0];
  if (!commune) {
    if (DRY_RUN) {
      console.log(`[DRY RUN] Commune créée : ${COMMUNE_NAME} (${INSEE_CODE})`);
    } else {
      const [created] = await db.insert(communes).values({ name: COMMUNE_NAME, insee_code: INSEE_CODE, zip_code: ZIP_CODE }).returning();
      commune = created!;
      console.log(`✓ Commune créée : ${COMMUNE_NAME} (${INSEE_CODE})`);
    }
  } else {
    console.log(`✓ Commune trouvée : ${commune.name}`);
  }

  // Seed mode (Ballan-Miré)
  if (SEED_MODE || !PDF_PATH) {
    if (INSEE_CODE !== "37018") {
      console.warn("⚠  --seed contient uniquement les règles de Ballan-Miré (37018). Pour une autre commune, utilisez --pdf.");
    }
    console.log(`\nTraitement de ${BALLAN_MIRE_ZONES.length} zones (règles vérifiées)...\n`);
    for (const z of BALLAN_MIRE_ZONES) {
      if (!DRY_RUN && commune) await upsertZoneAndRules(commune.id, z, "valide");
      else console.log(`[DRY RUN] Zone ${z.zone_code}: ${z.rules.length} règle(s)`);
    }
    console.log(`\n✅ Seed terminé — ${BALLAN_MIRE_ZONES.length} zones, ${COMMUNE_NAME}`);
    return;
  }

  // PDF extraction mode
  if (!fs.existsSync(PDF_PATH)) { console.error(`✗ Fichier non trouvé : ${PDF_PATH}`); process.exit(1); }

  console.log("Extraction du texte PDF (pdftotext)…");
  let pdfText: string;
  try {
    pdfText = execSync(`pdftotext "${PDF_PATH}" -`, { encoding: "utf-8", maxBuffer: 30 * 1024 * 1024 });
  } catch (e) {
    console.error("✗ pdftotext échoué. Assurez-vous que poppler-utils est installé (apt install poppler-utils).", e);
    process.exit(1);
  }
  console.log(`  → ${pdfText.length.toLocaleString()} caractères extraits\n`);

  const client = new Anthropic();

  // Pass 1 — Zone discovery
  console.log("Pass 1 — Identification des zones…");
  const discoveredZones = await discoverZones(pdfText, client);
  if (discoveredZones.length === 0) {
    console.error("✗ Aucune zone identifiée. Vérifiez la qualité du PDF (scan OCR requis ?).");
    process.exit(1);
  }
  console.log(`  ✓ ${discoveredZones.length} zones identifiées\n`);

  // Pass 2 — Rule extraction per zone
  const allCodes = discoveredZones.map(z => z.code);
  let totalRules = 0;

  for (const zoneInfo of discoveredZones) {
    console.log(`\nZone ${zoneInfo.code} — ${zoneInfo.label}`);

    const zoneText = extractZoneSection(pdfText, zoneInfo.code, allCodes);
    if (!zoneText) {
      console.warn(`  ⚠ Section de texte introuvable pour ${zoneInfo.code} — zone ignorée`);
      continue;
    }
    console.log(`  → Section de ${zoneText.length} caractères`);

    const rules = await extractZoneRules(zoneInfo.code, zoneText, client);
    if (rules.length === 0) {
      console.warn(`  ⚠ Aucune règle extraite pour ${zoneInfo.code}`);
      continue;
    }
    console.log(`  → ${rules.length} règle(s) extraite(s)`);

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
      rules.forEach(r => console.log(`    [DRY RUN] • ${r.topic}: ${r.summary ?? r.rule_text.slice(0, 60)}`));
    }
    totalRules += rules.length;
  }

  console.log(`\n✅ Extraction IA terminée — ${discoveredZones.length} zones, ${totalRules} règles`);
  if (!DRY_RUN) {
    console.log(`   → Statut : "brouillon" — en attente de validation par l'instructeur dans HEUREKA`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
