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

// Sources: PLU-Ballan-Reglement.pdf (modification n°5, 29/01/2018) + NotebookLM analysis (2026-05-19)
// Corrections vs initial draft: UB/UC/UD/UZ/1AU pleine terre ratios, UD terrain min + hauteur,
// UB social housing quotas, added zones UZ/UX/UY/UL/US/UV/1AUZ/AUH/AUY/NI.

type ZoneInput = {
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
};

const BALLAN_MIRE_ZONES: ZoneInput[] = [
  // ── ZONES URBAINES RÉSIDENTIELLES ─────────────────────────────────────────
  {
    zone_code: "UA",
    zone_label: "Zone UA – Centre ancien",
    zone_type: "U",
    summary: "Cœur historique de Ballan-Miré, bâti traditionnel dense en étoile autour de l'église.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul entre 0 et 1 mètre, ou alignement sur construction voisine, ou recul minimal de 6 mètres. Un élément d'architecture (mur, grille) doit souligner l'alignement en cas de recul.", value_min: 0, value_max: 6, unit: "m", summary: "0-1m ou alignement ou ≥6m" },
      { article_number: 7, topic: "recul_limite", rule_text: "En limite séparative ou à distance ≥ moitié de la hauteur avec un minimum de 3 mètres.", value_min: 3, unit: "m", conditions: "H/2 minimum 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol non réglementée en zone UA, pour respecter l'imbrication historique.", summary: "Non réglementé" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale : 6,5 mètres à l'égout de toiture ou à l'acrotère ; 9 mètres au faîtage. Une hauteur différente est admise si elle n'excède pas le bâtiment voisin le plus proche.", value_max: 6.5, unit: "m", conditions: "Toiture-terrasse: 6.5m; faîtage: 9m", summary: "6,5m égout / 9m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "1 place par logement d'1 pièce ; 2 places pour logement de 2 pièces et plus. Activités : 1 place/50m² SP. Commerces ≤100m² : aucune place. Vélos : 1 emplacement/logement.", summary: "2 places/logement (≥2P), 1/50m² activités" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 25% d'espaces libres en pleine terre. 1 arbre de haute tige pour 100m² d'espaces libres. 1 arbre pour 50m² de parking.", value_min: 25, unit: "%", summary: "≥25% pleine terre" },
    ],
  },
  {
    zone_code: "UB",
    zone_label: "Zone UB – Extensions du centre",
    zone_type: "U",
    summary: "Extensions urbaines du centre : collectifs R+3, nouvelle mairie, ZAC des Prés, quartier gare. Quota logements sociaux imposé (20-30%).",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul minimal de 6 mètres par rapport aux voies.", value_min: 6, unit: "m", summary: "≥6m" },
      { article_number: 7, topic: "recul_limite", rule_text: "En limite séparative ou à distance ≥ moitié de la hauteur avec un minimum de 3 mètres. Secteur UBa : recul H/2 min 3m, jamais en limite.", value_min: 3, unit: "m", conditions: "UBa: jamais en limite – H/2 min 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 50% de la superficie du terrain. Secteur UBai (inondable) : limitée à 10%.", value_max: 50, unit: "%", conditions: "UBai: 10%", summary: "≤50% (UBai: 10%)" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale : 9 mètres à l'égout de toiture ou à l'acrotère ; 14 mètres au faîtage (R+3).", value_max: 9, unit: "m", conditions: "Faîtage: 14m", summary: "9m égout / 14m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "2 places par logement (1 pour logements aidés). 1 place/50m² SP pour activités. Quota social : 20% pour 5-20 logements, 30% au-delà. Pré-équipement recharge électrique obligatoire.", summary: "2 places/logement, quota social 20-30%" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 35% d'espaces libres en pleine terre. 1 arbre de haute tige pour 100m² d'espaces libres.", value_min: 35, unit: "%", summary: "≥35% pleine terre" },
    ],
  },
  {
    zone_code: "UC",
    zone_label: "Zone UC – Quartiers pavillonnaires",
    zone_type: "U",
    summary: "Zone majoritaire de la commune : lotissements, ZAC des Prés, hameaux de Miré et des Vallées. Quota social 20% dès 5 logements.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul minimal de 3 mètres. RD751 : recul minimal de 45 mètres par rapport à l'axe de la voie.", value_min: 3, unit: "m", conditions: "RD751: 45m depuis axe", summary: "≥3m (RD751: 45m)" },
      { article_number: 7, topic: "recul_limite", rule_text: "En limite séparative ou à distance ≥ moitié de la hauteur avec un minimum de 3 mètres.", value_min: 3, unit: "m", conditions: "H/2 minimum 3m", summary: "En limite ou H/2 (min 3m)" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 50% de la superficie du terrain.", value_max: 50, unit: "%", summary: "≤50%" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale : 6,5 mètres à l'égout de toiture ou à l'acrotère ; 9 mètres au faîtage (R+2).", value_max: 6.5, unit: "m", conditions: "Faîtage: 9m", summary: "6,5m égout / 9m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "2 places par logement (1 pour logements aidés). 1 place/50m² SP pour activités. Quota social : 20% dès 5 logements.", summary: "2 places/logement, quota social 20%" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 40% d'espaces libres en pleine terre. 1 arbre de haute tige pour 100m².", value_min: 40, unit: "%", summary: "≥40% pleine terre" },
    ],
  },
  {
    zone_code: "UD",
    zone_label: "Zone UD – Quartiers verdoyants (Haute Lande, Miré)",
    zone_type: "U",
    summary: "Habitat individuel très peu dense en espaces boisés. Taille minimale terrain 2 000m². Implantation en limite séparative interdite.",
    rules: [
      { article_number: 5, topic: "terrain_min", rule_text: "Superficie minimale des terrains constructibles : 2 000 m².", value_min: 2000, unit: "m²", summary: "≥2 000m² par terrain" },
      { article_number: 6, topic: "recul_voie", rule_text: "Recul minimal de 7 mètres par rapport aux voies et emprises publiques.", value_min: 7, unit: "m", summary: "≥7m" },
      { article_number: 7, topic: "recul_limite", rule_text: "Implantation en limite séparative interdite. Recul minimum égal à la demi-hauteur du bâtiment avec un minimum de 3 mètres.", value_min: 3, unit: "m", conditions: "Jamais en limite – H/2 min 3m", summary: "Jamais en limite, H/2 (min 3m)" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 20% de la superficie du terrain.", value_max: 20, unit: "%", summary: "≤20%" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale : 6,5 mètres à l'égout de toiture ou à l'acrotère ; 8,5 mètres au faîtage.", value_max: 6.5, unit: "m", conditions: "Faîtage: 8.5m", summary: "6,5m égout / 8,5m faîtage" },
      { article_number: 12, topic: "stationnement", rule_text: "2 places par logement de 2 pièces et plus.", summary: "2 places/logement" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 60% d'espaces libres en pleine terre. Maintien obligatoire des arbres existants.", value_min: 60, unit: "%", summary: "≥60% pleine terre" },
    ],
  },
  {
    zone_code: "UZ",
    zone_label: "Zone UZ – ZAC de la Pasqueraie",
    zone_type: "U",
    summary: "Zone d'habitat récent mixte. UZa : collectifs R+3-4 (14m). UZb : formes compactes en continuité du centre.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul minimal de 5 mètres.", value_min: 5, unit: "m", summary: "≥5m" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 50% (40% dans le sous-secteur UZa de logements collectifs).", value_max: 50, unit: "%", conditions: "UZa: 40%", summary: "≤50% (UZa: 40%)" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale : 14 mètres dans le secteur UZa, 11 mètres dans le secteur UZb.", value_max: 14, unit: "m", conditions: "UZb: 11m", summary: "14m (UZa) / 11m (UZb)" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 40% d'espaces libres en pleine terre.", value_min: 40, unit: "%", summary: "≥40% pleine terre" },
    ],
  },
  // ── ZONES URBAINES SPÉCIALISÉES ────────────────────────────────────────────
  {
    zone_code: "UX",
    zone_label: "Zone UX – Activités La Châtaigneraie",
    zone_type: "U",
    summary: "Zone d'activités économiques diversifiées. Reculs stricts RD751/RD751c. Traitement architectural façades imposé.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul de 45 mètres par rapport à l'axe de la RD751. Recul de 25 mètres par rapport à la RD751c. Aucun accès individuel autorisé sur la RD751c.", value_min: 45, unit: "m", conditions: "RD751: 45m axe; RD751c: 25m", summary: "45m (RD751) / 25m (RD751c)" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 60% de la superficie du terrain.", value_max: 60, unit: "%", summary: "≤60%" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale de 10 mètres.", value_max: 10, unit: "m", summary: "≤10m" },
      { article_number: 12, topic: "stationnement", rule_text: "1 place/50m² SP. Pré-équipement recharge électrique obligatoire.", summary: "1 place/50m²" },
    ],
  },
  {
    zone_code: "UY",
    zone_label: "Zone UY – Activités Carrefour en Touraine",
    zone_type: "U",
    summary: "Grande zone d'activités économiques. Hauteurs jusqu'à 15m. Intégration paysagère des façades sur grand axe.",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 50% de la superficie du terrain.", value_max: 50, unit: "%", summary: "≤50%" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale de 15 mètres.", value_max: 15, unit: "m", summary: "≤15m" },
    ],
  },
  {
    zone_code: "UL",
    zone_label: "Zone UL – Sports et Loisirs",
    zone_type: "U",
    summary: "Équipements sportifs et de loisirs : centre équestre, camping, base nautique, centres de loisirs. Intégration paysagère prioritaire.",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol non réglementée pour permettre l'adaptation aux besoins des équipements.", summary: "Non réglementé" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur non réglementée pour permettre l'adaptation aux besoins des équipements.", summary: "Non réglementé" },
    ],
  },
  {
    zone_code: "US",
    zone_label: "Zone US – Établissements sanitaires et sociaux",
    zone_type: "U",
    summary: "IEM Charlemagne, centre rééducation cardiaque Bois Gibert, centre formation SDIS, captage eau (USf). Recul 10m des limites.",
    rules: [
      { article_number: 7, topic: "recul_limite", rule_text: "Recul de 10 mètres par rapport aux limites séparatives.", value_min: 10, unit: "m", summary: "≥10m des limites" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol non réglementée pour s'adapter aux besoins spécifiques des équipements.", summary: "Non réglementé" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur non réglementée pour s'adapter aux besoins spécifiques des équipements.", summary: "Non réglementé" },
    ],
  },
  {
    zone_code: "UV",
    zone_label: "Zone UV – Village Vacances",
    zone_type: "U",
    summary: "Opération de village-vacances en cours. Recul 10m des voies.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul minimal de 10 mètres par rapport aux voies.", value_min: 10, unit: "m", summary: "≥10m" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale de 9 mètres au faîtage.", value_max: 9, unit: "m", summary: "≤9m faîtage" },
    ],
  },
  // ── ZONES À URBANISER ──────────────────────────────────────────────────────
  {
    zone_code: "1AU",
    zone_label: "Zone 1AU – La Savatterie (à urbaniser immédiat)",
    zone_type: "AU",
    summary: "Secteur résidentiel à urbaniser à court terme dans le vallon. Hauteur réduite pour intégration paysagère.",
    rules: [
      { article_number: 6, topic: "recul_voie", rule_text: "Recul minimal de 5 mètres.", value_min: 5, unit: "m", summary: "≥5m" },
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol maximale de 50%.", value_max: 50, unit: "%", summary: "≤50%" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale de 7,5 mètres au faîtage pour s'insérer dans le vallon.", value_max: 7.5, unit: "m", summary: "≤7,5m faîtage" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 40% d'espaces libres en pleine terre.", value_min: 40, unit: "%", summary: "≥40% pleine terre" },
    ],
  },
  {
    zone_code: "1AUZ",
    zone_label: "Zone 1AUZ – ZAC Pasqueraie 3e tranche",
    zone_type: "AU",
    summary: "Dernière tranche de la ZAC de la Pasqueraie. Habitat collectif et individuel. 25% logements sociaux requis.",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol selon secteur, cohérente avec la ZAC existante.", summary: "Variable selon secteur" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur variable selon l'emplacement : 10 à 14 mètres.", value_min: 10, value_max: 14, unit: "m", summary: "10-14m selon emplacement" },
      { article_number: 13, topic: "espaces_verts", rule_text: "Au moins 25% d'espaces libres en pleine terre.", value_min: 25, unit: "%", summary: "≥25% pleine terre" },
    ],
  },
  {
    zone_code: "AUH",
    zone_label: "Zone AUH – Urbanisation future résidentielle",
    zone_type: "AU",
    summary: "Secteurs futurs (Les Galbrunes, La Butorderie, L'Aigrefin). Non constructibles sans révision PLU. Extensions bâti existant +50% max 50m² tolérées.",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Seules les extensions des constructions existantes sont autorisées : +50% de l'emprise existante avec un maximum de 50m². Toute nouvelle construction nécessite une révision du PLU.", value_max: 50, unit: "m²", conditions: "Extensions uniquement; révision PLU pour construire", summary: "Extensions seules (+50% max 50m²)" },
    ],
  },
  {
    zone_code: "AUY",
    zone_label: "Zone AUY – Urbanisation future économique",
    zone_type: "AU",
    summary: "Extension future de la zone d'activités Carrefour en Touraine. Inconstructible sauf extensions existantes.",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Seules les extensions des constructions existantes sont autorisées dans la limite de 50% de l'emprise existante. Toute nouvelle construction nécessite une modification du PLU.", value_max: 50, unit: "%", conditions: "Extensions bâti existant uniquement", summary: "Extensions seules (+50% existant)" },
    ],
  },
  // ── ZONES AGRICOLES ────────────────────────────────────────────────────────
  {
    zone_code: "A",
    zone_label: "Zone A – Agricole",
    zone_type: "A",
    summary: "Protège le potentiel agronomique et paysager. Secteurs : Ad (diversification), Ah (habitat isolé +50m²), Ap (protection paysagère stricte – inconstructible).",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Emprise au sol non réglementée pour l'exploitation agricole. Ah : extension limitée à 50% de l'emprise existante avec maximum 50m². Ad : nouvelles constructions ≤50% de l'emprise existante.", summary: "Libre (Ah: +50% max 50m²; Ap: inconstructible)" },
      { article_number: 10, topic: "hauteur", rule_text: "Hauteur maximale de 4 mètres à l'égout de toiture pour les bâtiments à usage d'habitation. Pas de limite pour les bâtiments agricoles. Secteur Ah : extensions à la hauteur du bâtiment existant ; annexes 3m max.", value_max: 4, unit: "m", conditions: "Habitation seule; agricole libre; Ah annexes 3m", summary: "4m égout (habitation)" },
    ],
  },
  // ── ZONES NATURELLES ───────────────────────────────────────────────────────
  {
    zone_code: "N",
    zone_label: "Zone N – Naturelle et forestière",
    zone_type: "N",
    summary: "Espaces naturels et boisés protégés. Secteurs : Nh (bâti existant +50m²), Ng (golf 20%), Na (gens du voyage 5%), Nb (club canin 300m²), Nf (forage 50%).",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Inconstructible en principe. Secteurs tolérés : Nh (+50% max 50m²), Ng (20%), Na (5%), Nb (300m²), Nf (50%).", summary: "Inconstructible (secteurs: Nh/Ng/Na/Nb/Nf)" },
      { article_number: 10, topic: "hauteur", rule_text: "Non réglementé sauf : Nh (hauteur existant; annexes 3m), Ng (5m max), Nb et Na (6m max), Nf (6m max).", summary: "Libre (secteurs: Nh ext./3m; Ng 5m; autres 6m)" },
    ],
  },
  {
    zone_code: "NI",
    zone_label: "Zone NI – Inondable (vallée du Cher)",
    zone_type: "N",
    summary: "Val de Tours–Val de Luynes, soumis au PPRI. NI1 (aléa faible à fort), NI2 (aléa fort fréquent), NI3 (lit du Cher – très fort). Sous-sols interdits.",
    rules: [
      { article_number: 9, topic: "emprise_sol", rule_text: "Extensions très limitées du bâti existant uniquement : maximum 50m² sous conditions strictes. Toute extension doit prévoir un étage refuge au-dessus des plus hautes eaux connues.", value_max: 50, unit: "m²", conditions: "PPRI; étage refuge obligatoire; sous-sols interdits", summary: "Extensions ≤50m² avec étage refuge" },
      { article_number: 10, topic: "hauteur", rule_text: "Plancher habitable des nouvelles constructions surélevé d'au moins 0,50 mètre par rapport au sol naturel. Étage refuge obligatoire au-dessus des plus hautes eaux connues.", value_min: 0.5, unit: "m", conditions: "Surélévation +0.50m NGF; étage refuge PHEC", summary: "Plancher +0.50m NGF; étage refuge PHEC" },
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
