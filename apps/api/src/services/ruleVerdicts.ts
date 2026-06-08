import { extractFirstJson } from "./pieceAnalyzer.js";
import type { PieceExtraction } from "./pieceExtractor.js";
import { anthropicClient, callClaude } from "./aiUsage.js";

/**
 * Moteur de verdict par règle PLU.
 *
 * À partir :
 *   - des règles PLU applicables (chiffrées et qualitatives),
 *   - des extractions structurées de toutes les pièces déposées,
 *   - des synthèses des documents commune (OAP, PPRI, …),
 * produit pour CHAQUE règle un verdict typé avec citation traçable.
 *
 * Règles d'or :
 *   - "non_verifiable" est le verdict par défaut : on n'invente pas une mesure
 *     manquante.
 *   - Toute valeur "observée" DOIT pointer une pièce + une citation présente
 *     dans l'extraction de cette pièce.
 *   - Une règle non vérifiable explicite ce qu'il manque (« cote NGF du sol
 *     naturel absente sur le plan de coupe »).
 */

export type Verdict =
  | "conforme"
  | "non_conforme"
  | "non_verifiable"
  | "applicable_conditionnel"
  | "non_applicable";

export interface VerdictSource {
  piece_id: string;
  piece_nom: string;
  citation: string;
}

export interface RuleVerdict {
  rule_id: string;
  topic: string;
  article: string | null;
  sub_theme: string | null;
  rule_text_short: string;      // résumé court de la règle pour affichage
  verdict: Verdict;
  raison: string;               // explication ≤ 2 phrases
  manquant: string | null;      // si non_verifiable : ce qui manque pour trancher
  valeur_observee: { value: number; unit: string | null } | null;
  valeur_attendue: { min?: number | null; max?: number | null; exact?: number | null; unit?: string | null } | null;
  sources: VerdictSource[];
}

export interface RuleVerdictsReport {
  schema_version: 1;
  verdicts: RuleVerdict[];
  counts: {
    conforme: number;
    non_conforme: number;
    non_verifiable: number;
    applicable_conditionnel: number;
    non_applicable: number;
  };
  // Pièces utilisées comme source (avec leur extraction injectée dans le prompt)
  pieces_used: Array<{ id: string; nom: string; code_piece: string | null; piece_type: string }>;
  documents_commune_used: Array<{ id: string; name: string; type: string }>;
  model: string;
  duration_ms: number;
  warnings: string[];
}

export interface VerdictRuleInput {
  id: string;
  topic: string;
  article_number: number | null;
  sub_theme: string | null;
  rule_text: string;
  summary: string | null;
  value_min: number | null;
  value_max: number | null;
  value_exact: number | null;
  unit: string | null;
  cases?: Array<{ condition: string; value: number | null; unit: string | null }> | null;
  applies_if?: string[] | null;
  exceptions?: string | null;
}

export interface VerdictPieceInput {
  id: string;
  nom: string;
  code_piece: string | null;
  extraction: PieceExtraction | null;
}

export interface VerdictDocumentCommuneInput {
  id: string;
  name: string;
  type: string;
  synthese: string | null;
}

export interface VerdictContextInput {
  zone_code: string | null;
  commune: string | null;
  natures: string[];
  surface_plancher: number | null;
}

const SYSTEM_PROMPT = `Tu es expert en instruction de dossiers d'urbanisme (Code de l'Urbanisme, PLU).

Mission : pour CHAQUE règle PLU fournie, rendre un VERDICT TYPÉ à partir UNIQUEMENT des extractions de pièces fournies et des synthèses de documents commune. Tu n'as accès qu'à ce qui est listé : tu n'inventes ni valeur, ni source, ni citation.

VERDICTS POSSIBLES :
- "conforme" : la valeur observée respecte le seuil, source traçable.
- "non_conforme" : la valeur observée viole le seuil, source traçable.
- "non_verifiable" : aucune extraction ne permet de trancher (cote absente, pièce manquante, valeur ambiguë).
- "applicable_conditionnel" : la règle ne s'applique que si un sous-cas projet est confirmé (extension, surélévation, ravalement…). Indiquer dans "raison".
- "non_applicable" : la règle ne concerne pas ce dossier (ex: règle pour ICPE, dossier pavillonnaire).

RÈGLES STRICTES :
- "non_verifiable" est ton verdict DÉFAUT en cas de doute.
- Toute "valeur_observee" doit pointer une PIÈCE (piece_id) ET reproduire une CITATION qui figure réellement dans l'extraction de cette pièce (champ "citations" de l'extraction). Si la citation n'existe pas → bascule en "non_verifiable" + précise "manquant".
- Si plusieurs pièces se contredisent sur une même règle, verdict "non_conforme" avec raison « incohérence inter-pièces : X dit 9 m, Y dit 10,2 m ».
- Les synthèses commune (OAP, PPRI, …) servent à PRÉCISER le verdict d'une règle mais n'autorisent pas à inventer une valeur de projet : elles informent le périmètre, pas la mesure.
- Respecte rigoureusement la sémantique min ("≥") vs max ("≤"). Une règle "hauteur max ≤ 9 m" + valeur observée 9,2 m = non_conforme.
- Pour les règles qualitatives sans valeur (matériaux, aspect…) : compare la description du projet (notice / plan_facade.materiaux) à ce qu'autorise la règle. Si l'extraction ne décrit pas le matériau, "non_verifiable".

CITATIONS — TRAÇABILITÉ :
- "sources" : liste des pièces qui ont fourni l'information. Pour chaque source : piece_id, piece_nom, et la citation EXACTE telle qu'extraite (depuis citations[] de l'extraction). NE PARAPHRASE PAS.
- Sans source valide → verdict = "non_verifiable" + "sources": [].

SORTIE — JSON UNIQUEMENT (pas de markdown, pas de préambule) :
{
  "verdicts": [
    {
      "rule_id": "<id de la règle PLU>",
      "verdict": "conforme|non_conforme|non_verifiable|applicable_conditionnel|non_applicable",
      "raison": "1-2 phrases factuelles",
      "manquant": null | "<ce qu'il manque pour trancher>",
      "valeur_observee": null | { "value": 4.2, "unit": "m" },
      "sources": [
        { "piece_id": "<id>", "piece_nom": "<nom>", "citation": "<texte exact lu sur la pièce>" }
      ]
    }
  ]
}`;

function formatRulesForPrompt(rules: VerdictRuleInput[]): string {
  return rules.map((r) => {
    const vals: string[] = [];
    if (r.value_exact != null) vals.push(`= ${r.value_exact}${r.unit ?? ""}`);
    if (r.value_min != null) vals.push(`≥ ${r.value_min}${r.unit ?? ""}`);
    if (r.value_max != null) vals.push(`≤ ${r.value_max}${r.unit ?? ""}`);
    const valStr = vals.length ? `  [${vals.join(", ")}]` : "";
    const art = r.article_number != null ? `Art. ${r.article_number}` : "Article n.c.";
    const sub = r.sub_theme ? ` — ${r.sub_theme}` : "";
    const tags = r.applies_if?.length ? `  applies_if: ${r.applies_if.join(",")}` : "";
    const exc = r.exceptions ? `\n    exceptions: ${r.exceptions}` : "";
    const cases = r.cases?.length
      ? `\n    cases: ${r.cases.map((c) => `${c.condition}${c.value != null ? ` → ${c.value}${c.unit ?? ""}` : ""}`).join(" | ")}`
      : "";
    const txt = r.rule_text.length > 600 ? r.rule_text.slice(0, 600) + "…" : r.rule_text;
    return `[${r.id}] ${art}${sub} (topic=${r.topic})${valStr}${tags}\n    ${txt}${exc}${cases}`;
  }).join("\n\n");
}

function formatExtractionForPrompt(ext: PieceExtraction): string {
  const lines: string[] = [`piece_type=${ext.piece_type} (confidence=${ext.confidence_type.toFixed(2)}), quality=${ext.quality}`];
  if (ext.echelle) lines.push(`echelle=${ext.echelle}`);
  if (ext.nord_visible != null) lines.push(`nord_visible=${ext.nord_visible}`);
  if (ext.cerfa) {
    const c = ext.cerfa;
    const parts: string[] = [];
    if (c.surface_terrain_m2 != null) parts.push(`surface_terrain=${c.surface_terrain_m2}m²`);
    if (c.surface_plancher_existante_m2 != null) parts.push(`SP_existante=${c.surface_plancher_existante_m2}m²`);
    if (c.surface_plancher_creee_m2 != null) parts.push(`SP_creee=${c.surface_plancher_creee_m2}m²`);
    if (c.emprise_sol_existante_m2 != null) parts.push(`emprise_existante=${c.emprise_sol_existante_m2}m²`);
    if (c.emprise_sol_creee_m2 != null) parts.push(`emprise_creee=${c.emprise_sol_creee_m2}m²`);
    if (c.hauteur_max_m != null) parts.push(`hauteur_max=${c.hauteur_max_m}m`);
    if (c.destination) parts.push(`destination=${c.destination}`);
    if (c.nb_logements != null) parts.push(`nb_logements=${c.nb_logements}`);
    if (c.nb_places_stationnement != null) parts.push(`places_stationnement=${c.nb_places_stationnement}`);
    if (parts.length) lines.push(`cerfa: ${parts.join(", ")}`);
  }
  if (ext.plan_masse) {
    const p = ext.plan_masse;
    const parts: string[] = [];
    if (p.recul_voie_m != null) parts.push(`recul_voie=${p.recul_voie_m}m`);
    if (p.reculs_limites_m?.length) parts.push(`reculs_limites=[${p.reculs_limites_m.join(", ")}]m`);
    if (p.distances_entre_batiments_m?.length) parts.push(`distances_bat=[${p.distances_entre_batiments_m.join(", ")}]m`);
    if (p.emprise_au_sol_m2 != null) parts.push(`emprise_au_sol=${p.emprise_au_sol_m2}m²`);
    if (p.longueur_batiment_m != null) parts.push(`longueur=${p.longueur_batiment_m}m`);
    if (p.largeur_batiment_m != null) parts.push(`largeur=${p.largeur_batiment_m}m`);
    if (parts.length) lines.push(`plan_masse: ${parts.join(", ")}`);
  }
  if (ext.plan_coupe) {
    const p = ext.plan_coupe;
    const parts: string[] = [];
    if (p.sol_naturel_ngf_m != null) parts.push(`SN_NGF=${p.sol_naturel_ngf_m}m`);
    if (p.egout_ngf_m != null) parts.push(`egout_NGF=${p.egout_ngf_m}m`);
    if (p.faitage_ngf_m != null) parts.push(`faitage_NGF=${p.faitage_ngf_m}m`);
    if (p.acrotere_ngf_m != null) parts.push(`acrotere_NGF=${p.acrotere_ngf_m}m`);
    if (p.hauteur_egout_m != null) parts.push(`H_egout=${p.hauteur_egout_m}m`);
    if (p.hauteur_faitage_m != null) parts.push(`H_faitage=${p.hauteur_faitage_m}m`);
    if (p.hauteur_acrotere_m != null) parts.push(`H_acrotere=${p.hauteur_acrotere_m}m`);
    if (p.pente_terrain_pct != null) parts.push(`pente=${p.pente_terrain_pct}%`);
    if (parts.length) lines.push(`plan_coupe: ${parts.join(", ")}`);
  }
  if (ext.plan_facade) {
    const p = ext.plan_facade;
    const parts: string[] = [];
    if (p.materiaux_principaux?.length) parts.push(`materiaux=[${p.materiaux_principaux.join(", ")}]`);
    if (p.teintes?.length) parts.push(`teintes=[${p.teintes.join(", ")}]`);
    if (p.toiture_type) parts.push(`toiture=${p.toiture_type}`);
    if (p.pente_toiture_deg != null) parts.push(`pente_toit=${p.pente_toiture_deg}°`);
    if (parts.length) lines.push(`plan_facade: ${parts.join(", ")}`);
  }
  if (ext.notice) {
    if (ext.notice.description_projet) lines.push(`notice.description: ${ext.notice.description_projet.slice(0, 240)}`);
    if (ext.notice.materiaux_decrits?.length) lines.push(`notice.materiaux: ${ext.notice.materiaux_decrits.join(", ")}`);
  }
  if (ext.missing_elements.length) lines.push(`missing: ${ext.missing_elements.join(" ; ")}`);
  if (ext.citations.length) lines.push(`citations: ${ext.citations.map((c) => `"${c}"`).join(" | ")}`);
  return lines.join("\n  ");
}

function formatPiecesForPrompt(pieces: VerdictPieceInput[]): string {
  if (!pieces.length) return "(aucune pièce avec extraction disponible)";
  return pieces.map((p) => {
    const head = `Pièce [${p.id}] "${p.nom}"${p.code_piece ? ` (code ${p.code_piece})` : ""}`;
    if (!p.extraction) return `${head}\n  (extraction non réalisée)`;
    return `${head}\n  ${formatExtractionForPrompt(p.extraction)}`;
  }).join("\n\n");
}

function formatCommuneDocsForPrompt(docs: VerdictDocumentCommuneInput[]): string {
  const usable = docs.filter((d) => d.synthese?.trim());
  if (!usable.length) return "(aucune synthèse de document commune)";
  return usable.map((d) => `[${d.type.toUpperCase()}] ${d.name}\n  ${d.synthese!.trim()}`).join("\n\n");
}

// Index citations par pièce pour validation post-LLM (rejet d'une citation
// inventée par le modèle).
function buildCitationIndex(pieces: VerdictPieceInput[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const p of pieces) {
    const set = new Set<string>();
    if (p.extraction?.citations) {
      for (const c of p.extraction.citations) set.add(c.trim());
    }
    idx.set(p.id, set);
  }
  return idx;
}

function normalizeCitation(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function citationMatches(claimed: string, known: Set<string>): boolean {
  const c = normalizeCitation(claimed);
  if (!c) return false;
  for (const k of known) {
    const n = normalizeCitation(k);
    if (!n) continue;
    if (n === c) return true;
    // tolérance : la citation revendiquée doit être contenue dans une citation extraite (ou inversement)
    if (n.includes(c) || c.includes(n)) return true;
  }
  return false;
}

function valOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const VALID_VERDICTS: Verdict[] = ["conforme", "non_conforme", "non_verifiable", "applicable_conditionnel", "non_applicable"];
function normalizeVerdict(v: unknown): Verdict {
  const s = String(v ?? "").toLowerCase().trim().replace(/\s+/g, "_");
  return (VALID_VERDICTS as string[]).includes(s) ? (s as Verdict) : "non_verifiable";
}

export async function computeRuleVerdicts(args: {
  rules: VerdictRuleInput[];
  pieces: VerdictPieceInput[];
  documentsCommune: VerdictDocumentCommuneInput[];
  context: VerdictContextInput;
  trace?: { dossierId?: string | null; userId?: string | null };
}): Promise<RuleVerdictsReport> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const pieces_used = args.pieces.filter((p) => p.extraction).map((p) => ({
    id: p.id,
    nom: p.nom,
    code_piece: p.code_piece,
    piece_type: p.extraction!.piece_type,
  }));
  const documents_commune_used = args.documentsCommune
    .filter((d) => d.synthese?.trim())
    .map((d) => ({ id: d.id, name: d.name, type: d.type }));

  if (!args.rules.length) {
    return {
      schema_version: 1,
      verdicts: [],
      counts: { conforme: 0, non_conforme: 0, non_verifiable: 0, applicable_conditionnel: 0, non_applicable: 0 },
      pieces_used,
      documents_commune_used,
      model: "n/a",
      duration_ms: 0,
      warnings: ["Aucune règle PLU à vérifier — analyse non exécutée."],
    };
  }

  const ctxLines: string[] = [];
  if (args.context.zone_code) ctxLines.push(`Zone PLU : ${args.context.zone_code}`);
  if (args.context.commune) ctxLines.push(`Commune : ${args.context.commune}`);
  if (args.context.natures.length) ctxLines.push(`Nature(s) des travaux : ${args.context.natures.join(", ")}`);
  if (args.context.surface_plancher != null) ctxLines.push(`Surface plancher projetée : ${args.context.surface_plancher} m²`);

  const userText = `${ctxLines.join("\n")}

==================== RÈGLES PLU À VÉRIFIER ====================
${formatRulesForPrompt(args.rules)}

==================== EXTRACTIONS DES PIÈCES DÉPOSÉES ====================
${formatPiecesForPrompt(args.pieces)}

==================== SYNTHÈSES DES DOCUMENTS COMMUNE ====================
${formatCommuneDocsForPrompt(args.documentsCommune)}

==================== INSTRUCTIONS ====================
Rends UN verdict par règle ci-dessus. Cite uniquement des extraits qui figurent dans le bloc "citations" de la pièce concernée. À défaut, verdict "non_verifiable" + précise "manquant".`;

  const model = "claude-sonnet-4-6";
  const client = anthropicClient({ maxRetries: 2, timeout: 120_000 });
  const msg = await callClaude(
    { purpose: "rule_verdicts", dossierId: args.trace?.dossierId, userId: args.trace?.userId },
    {
      model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    },
    client,
  );

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  const parsed = extractFirstJson(raw) as Record<string, unknown> | null;
  const verdictsRaw = parsed && Array.isArray(parsed.verdicts) ? (parsed.verdicts as unknown[]) : [];

  // Index pour la validation des citations.
  const citationIndex = buildCitationIndex(args.pieces);
  const pieceNomById = new Map(args.pieces.map((p) => [p.id, p.nom]));

  // Construction des verdicts complets (rule_text, article, etc.) à partir des règles d'entrée.
  const ruleById = new Map(args.rules.map((r) => [r.id, r]));

  const out: RuleVerdict[] = [];
  for (const r of args.rules) {
    const found = verdictsRaw.find((v): v is Record<string, unknown> =>
      !!v && typeof v === "object" && (v as Record<string, unknown>).rule_id === r.id);
    let verdict: Verdict = "non_verifiable";
    let raison = "Aucune extraction ne permet de trancher.";
    let manquant: string | null = null;
    let valeur_observee: RuleVerdict["valeur_observee"] = null;
    let sources: VerdictSource[] = [];

    if (found) {
      verdict = normalizeVerdict(found.verdict);
      raison = strOrNull(found.raison) ?? raison;
      manquant = strOrNull(found.manquant);
      const vo = found.valeur_observee as Record<string, unknown> | null | undefined;
      if (vo && typeof vo === "object" && valOrNull(vo.value) != null) {
        valeur_observee = { value: valOrNull(vo.value)!, unit: strOrNull(vo.unit) };
      }
      const srcRaw = Array.isArray(found.sources) ? (found.sources as unknown[]) : [];
      for (const s of srcRaw) {
        if (!s || typeof s !== "object") continue;
        const o = s as Record<string, unknown>;
        const pid = strOrNull(o.piece_id);
        const citation = strOrNull(o.citation);
        if (!pid || !citation) continue;
        const known = citationIndex.get(pid);
        if (!known) continue;
        if (!citationMatches(citation, known)) {
          warnings.push(`Citation rejetée (non trouvée dans l'extraction) pour règle ${r.id} : "${citation.slice(0, 80)}"`);
          continue;
        }
        sources.push({
          piece_id: pid,
          piece_nom: pieceNomById.get(pid) ?? strOrNull(o.piece_nom) ?? "—",
          citation,
        });
      }
      // Si le verdict revendique une valeur observée mais aucune source valide
      // ne reste après filtrage, on rétrograde en non_verifiable.
      if ((verdict === "conforme" || verdict === "non_conforme") && sources.length === 0) {
        warnings.push(`Verdict ${verdict} rétrogradé en non_verifiable (aucune source vérifiable) pour règle ${r.id}.`);
        verdict = "non_verifiable";
        valeur_observee = null;
        if (!manquant) manquant = "Citation invérifiable.";
      }
    } else {
      warnings.push(`Règle ${r.id} non traitée par le modèle — verdict non_verifiable par défaut.`);
    }

    const rule = ruleById.get(r.id)!;
    out.push({
      rule_id: r.id,
      topic: rule.topic,
      article: rule.article_number != null ? `Art. ${rule.article_number}` : null,
      sub_theme: rule.sub_theme,
      rule_text_short: rule.summary ?? rule.rule_text.slice(0, 180),
      verdict,
      raison,
      manquant,
      valeur_observee,
      valeur_attendue: (rule.value_min != null || rule.value_max != null || rule.value_exact != null)
        ? { min: rule.value_min, max: rule.value_max, exact: rule.value_exact, unit: rule.unit }
        : null,
      sources,
    });
  }

  const counts = out.reduce(
    (acc, v) => { acc[v.verdict] = (acc[v.verdict] ?? 0) + 1; return acc; },
    { conforme: 0, non_conforme: 0, non_verifiable: 0, applicable_conditionnel: 0, non_applicable: 0 } as Record<Verdict, number>,
  );

  return {
    schema_version: 1,
    verdicts: out,
    counts,
    pieces_used,
    documents_commune_used,
    model,
    duration_ms: Date.now() - startedAt,
    warnings,
  };
}
