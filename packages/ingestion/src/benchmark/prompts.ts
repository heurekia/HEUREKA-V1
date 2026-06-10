/**
 * Prompts utilisés par le benchmark. Reproduits à l'identique de
 * apps/api/src/services/pieceAnalyzer.ts et pieceExtractor.ts (sans
 * importer le code applicatif pour garder le benchmark autonome).
 *
 * Si ces prompts évoluent en prod, mettre à jour ce fichier — sinon le
 * benchmark mesure une réalité décorrélée de la production.
 */

import type { PieceFixture } from "./types.js";

export const SYSTEM_ANALYZE = `Tu es expert en instruction de dossiers d'urbanisme. Tu analyses une pièce justificative déposée par un citoyen.
Réponds UNIQUEMENT en JSON valide :
{"score":"conforme"|"acceptable"|"incomplet"|"non_conforme","commentaire":"1-2 phrases sur la qualité et la conformité","suggestions":["suggestion concrète actionnable si nécessaire"]}
Critères : conforme = document clair, lisible et approprié au type demandé ; acceptable = utilisable mais améliorable ; incomplet = partiellement visible, amputé ou illisible en partie ; non_conforme = mauvais type de document ou totalement illisible.`;

export const SYSTEM_EXTRACT = `Tu es expert en instruction de dossiers d'urbanisme (Code de l'Urbanisme, CERFA, conventions de représentation des plans).

Ta mission : EXTRAIRE de manière STRUCTURÉE ce qui est VISIBLEMENT ÉCRIT, COTÉ ou ANNOTÉ sur la pièce fournie. Tu NE mesures PAS le plan, tu NE déduis PAS, tu LIS ce qui est explicitement noté.

RÈGLE D'OR — N'INVENTE RIEN :
- Si une valeur n'est pas explicitement écrite (cote, niveau NGF, surface, matériau) → mets null et signale-la dans "missing_elements".
- Si une dimension est mesurable à la règle mais n'est PAS cotée sur le plan → null + missing_elements. Tu ne mesures jamais.
- Si tu lis une cote mais elle est ambiguë (mal lisible, contradictoire avec une autre) → null + note explicite dans "notes".

SORTIE — UNIQUEMENT du JSON valide, sans markdown, sans préambule :
{
  "piece_type": "cerfa|plan_situation|plan_masse|plan_coupe|plan_facade|notice|photo|insertion|autre",
  "confidence_type": 0.0,
  "quality": "lisible|partiellement_lisible|illisible",
  "echelle": "1/200" | null,
  "nord_visible": true|false|null,
  "legende_visible": true|false|null,
  "cerfa": null | { "surface_terrain_m2": ..., "surface_plancher_creee_m2": ..., "emprise_sol_creee_m2": ..., "hauteur_max_m": ..., "destination": "habitation"|null },
  "plan_masse": null | { "recul_voie_m": ..., "reculs_limites_m": [3.5, 4.2], "emprise_au_sol_m2": ..., "longueur_batiment_m": ..., "largeur_batiment_m": ... },
  "plan_coupe": null | { "sol_naturel_ngf_m": ..., "egout_ngf_m": ..., "faitage_ngf_m": ..., "hauteur_egout_m": ..., "hauteur_faitage_m": ... },
  "plan_facade": null | { "materiaux_principaux": ["enduit blanc"], "teintes": ["RAL 9010"], "toiture_type": "deux pans"|null, "pente_toiture_deg": ... },
  "notice": null | { "description_projet": "...", "insertion_paysagere": "..." },
  "photo": null | { "contexte_decrit": "...", "point_vue": "..." },
  "missing_elements": [],
  "citations": [],
  "notes": null
}`;

export function buildContextText(piece: PieceFixture): string {
  const c = piece.context;
  const lines: string[] = [];
  if (c.dossierType) lines.push(`Type de demande : ${c.dossierType}`);
  if (c.natures?.length) lines.push(`Nature des travaux : ${c.natures.join(", ")}`);
  if (c.surface) lines.push(`Surface plancher projetée : ${c.surface} m²`);
  if (c.zone) lines.push(`Zone PLU : ${c.zone}`);
  if (c.commune) lines.push(`Commune : ${c.commune}`);
  if (c.aide) lines.push(`\nAttendu pour cette pièce :\n${c.aide}`);
  return lines.join("\n");
}

/** Tente d'extraire le PREMIER bloc JSON valide d'un texte. */
export function extractFirstJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === "\"") { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>; }
        catch { return null; }
      }
    }
  }
  return null;
}
