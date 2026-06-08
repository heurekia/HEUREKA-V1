import fs from "fs";
import { callClaude } from "./aiUsage.js";

// ── Scores normalisés ────────────────────────────────────────────────────────
// 4 niveaux explicites — utilisés à la fois pour la pièce et pour le dossier.
// non_conforme = pièce inutilisable (mauvais type, illisible) ;
// incomplet    = utilisable mais des éléments réglementaires manquent ;
// acceptable   = utilisable, améliorations possibles ;
// conforme     = couvre les attentes réglementaires.
export type PieceScore = "conforme" | "acceptable" | "incomplet" | "non_conforme";

export interface NonConformite {
  regle: string;        // résumé de la règle non couverte (ex: "Recul ≥ 3 m des limites séparatives")
  article?: string;     // référence de l'article PLU/Code (ex: "UB 6", "R.431-9 CU")
  constate: string;     // ce qui apparaît sur le document
  attendu: string;      // ce qui devrait y figurer / valeur réglementaire
  gravite: "info" | "mineure" | "majeure";
}

export interface PieceAnalysis {
  score: PieceScore;
  commentaire: string;
  suggestions: string[];
  non_conformites?: NonConformite[];
  // null = analyse réglementaire non réalisée (ex: contexte non fourni, format non supporté)
  reglementaire?: boolean;
}

export interface RegulatoryRuleHint {
  topic: string;         // ex: "hauteur", "recul_voie", "stationnement"
  summary: string;       // règle condensée en une phrase
  article?: string;      // ex: "UB 6"
  value_exact?: number | null;
  value_min?: number | null;
  value_max?: number | null;
  unit?: string | null;
}

export interface PieceContext {
  // Informations sur la pièce attendue
  aide?: string;                  // texte d'aide officiel (depuis piecesRequises.ts)
  // Informations sur le dossier et la parcelle
  dossierType?: string;           // permis_de_construire, declaration_prealable, …
  natures?: string[];             // nature(s) des travaux
  surface?: number;               // surface plancher
  zone?: string;                  // zone PLU (UB, UC, A, N…)
  commune?: string;
  parcelle?: string;
  hasABF?: boolean;
  // Règles réglementaires applicables (pré-filtrées par l'orchestrateur)
  regles?: RegulatoryRuleHint[];
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const PDF_TYPE = "application/pdf";

// Limite de taille pour l'envoi à Claude (Anthropic accepte jusqu'à 32 Mo en base64).
// Au-delà on renvoie une analyse "non vérifiée" plutôt que d'échouer.
const MAX_INLINE_BYTES = 30 * 1024 * 1024;

function isAllowedImage(mime: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime);
}

function isPdf(mime: string): boolean {
  return mime === PDF_TYPE;
}

// Réponses LLM : on extrait le PREMIER bloc JSON valide. Les "{" en début de
// texte explicatif (rares mais possibles) sont gérés par la recherche glouton ↓.
export function extractFirstJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  // Recherche du "}" qui ferme l'objet — équilibre des accolades, en ignorant
  // les chaînes de caractères.
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
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export function normalizeScore(raw: unknown): PieceScore {
  const s = String(raw ?? "").toLowerCase().trim();
  if (s === "conforme") return "conforme";
  if (s === "acceptable") return "acceptable";
  if (s === "non_conforme" || s === "non conforme") return "non_conforme";
  if (s === "incomplet" || s === "incomplete") return "incomplet";
  return "acceptable";
}

function normalizeGravite(raw: unknown): NonConformite["gravite"] {
  const s = String(raw ?? "").toLowerCase().trim();
  if (s === "majeure" || s === "majeur" || s === "bloquante" || s === "bloquant") return "majeure";
  if (s === "mineure" || s === "mineur") return "mineure";
  return "info";
}

export function parsePieceAnalysis(text: string): PieceAnalysis {
  const obj = extractFirstJson(text);
  if (!obj || typeof obj !== "object") {
    return {
      score: "acceptable",
      commentaire: "Analyse non concluante — réponse IA non exploitable.",
      suggestions: [],
    };
  }
  const o = obj as Record<string, unknown>;
  const suggestions = Array.isArray(o.suggestions)
    ? (o.suggestions as unknown[]).map(String).filter(Boolean)
    : [];
  const ncRaw = Array.isArray(o.non_conformites) ? (o.non_conformites as unknown[]) : [];
  const non_conformites: NonConformite[] = [];
  for (const n of ncRaw) {
    if (!n || typeof n !== "object") continue;
    const r = n as Record<string, unknown>;
    const regle = String(r.regle ?? "").trim();
    if (!regle) continue;
    const nc: NonConformite = {
      regle,
      constate: String(r.constate ?? "").trim(),
      attendu: String(r.attendu ?? "").trim(),
      gravite: normalizeGravite(r.gravite),
    };
    if (r.article) nc.article = String(r.article);
    non_conformites.push(nc);
  }

  return {
    score: normalizeScore(o.score),
    commentaire: String(o.commentaire ?? "").trim() || "Analyse effectuée.",
    suggestions,
    non_conformites: non_conformites.length > 0 ? non_conformites : undefined,
  };
}

function buildContextSection(ctx?: PieceContext): string {
  if (!ctx) return "";
  const lines: string[] = [];
  if (ctx.dossierType) lines.push(`Type de demande : ${ctx.dossierType}`);
  if (ctx.natures?.length) lines.push(`Nature des travaux : ${ctx.natures.join(", ")}`);
  if (ctx.surface) lines.push(`Surface plancher projetée : ${ctx.surface} m²`);
  if (ctx.zone) lines.push(`Zone PLU : ${ctx.zone}`);
  if (ctx.commune) lines.push(`Commune : ${ctx.commune}`);
  if (ctx.parcelle) lines.push(`Parcelle : ${ctx.parcelle}`);
  if (ctx.hasABF) lines.push("Périmètre ABF : OUI (consultation Architecte des Bâtiments de France requise)");
  if (ctx.aide) lines.push(`\nAttendu pour cette pièce :\n${ctx.aide}`);
  if (ctx.regles?.length) {
    lines.push("\nRègles PLU applicables à croiser avec le document :");
    for (const r of ctx.regles) {
      const vals: string[] = [];
      if (r.value_exact != null) vals.push(`= ${r.value_exact}${r.unit ?? ""}`);
      if (r.value_min != null) vals.push(`≥ ${r.value_min}${r.unit ?? ""}`);
      if (r.value_max != null) vals.push(`≤ ${r.value_max}${r.unit ?? ""}`);
      const valStr = vals.length ? ` [${vals.join(", ")}]` : "";
      const ref = r.article ? ` (${r.article})` : "";
      lines.push(`  • [${r.topic}]${ref} ${r.summary}${valStr}`);
    }
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT_BASIC = `Tu es expert en instruction de dossiers d'urbanisme. Tu analyses une pièce justificative déposée par un citoyen.
Réponds UNIQUEMENT en JSON valide :
{"score":"conforme"|"acceptable"|"incomplet"|"non_conforme","commentaire":"1-2 phrases sur la qualité et la conformité","suggestions":["suggestion concrète actionnable si nécessaire"]}
Critères : conforme = document clair, lisible et approprié au type demandé ; acceptable = utilisable mais améliorable ; incomplet = partiellement visible, amputé ou illisible en partie ; non_conforme = mauvais type de document ou totalement illisible.`;

const SYSTEM_PROMPT_REGULATORY = `Tu es expert en instruction de dossiers d'urbanisme (Code de l'Urbanisme + PLU). Tu analyses UNE pièce justificative déposée par un pétitionnaire en CROISANT son contenu avec :
1. ce qui est attendu pour ce type de pièce (CERFA),
2. les règles du PLU applicables à la parcelle (fournies dans le contexte),
3. les éventuelles servitudes (ABF, etc.).

Ta mission :
- Vérifier que le document est du BON type (ex : un "plan de masse" doit être une vue de dessus avec cotes, pas une photo).
- Vérifier qu'il est LISIBLE et COMPLET (cotes présentes, échelle indiquée, légende, …).
- Quand c'est possible (cotes visibles, dimensions, hauteurs, distances), VÉRIFIER que les valeurs respectent les règles PLU fournies. Si une règle ne peut pas être vérifiée avec ce document (ex : règle de stationnement non vérifiable sur une coupe), ne l'invente PAS comme non-conformité.
- Lister les NON-CONFORMITÉS détectées avec la règle, l'article si donné, ce qui est constaté, ce qui est attendu et la gravité (info | mineure | majeure).

Réponds UNIQUEMENT en JSON valide, sans markdown, sans texte d'introduction :
{
  "score": "conforme" | "acceptable" | "incomplet" | "non_conforme",
  "commentaire": "1-2 phrases factuelles à destination de l'instructeur",
  "suggestions": ["suggestion concrète si améliorations attendues"],
  "non_conformites": [
    { "regle": "...", "article": "...", "constate": "...", "attendu": "...", "gravite": "info|mineure|majeure" }
  ]
}

Règles strictes :
- Score "non_conforme" UNIQUEMENT si le document est inutilisable (mauvais type ou totalement illisible).
- Score "incomplet" si éléments réglementaires manquants ou non-conformité majeure détectée.
- Score "acceptable" si utilisable avec réserves mineures.
- Score "conforme" si rien à signaler.
- N'invente JAMAIS une non-conformité que tu ne peux pas démontrer à partir du document.
- Si une règle PLU citée n'est PAS vérifiable sur ce type de pièce, ne la mentionne pas.
- Ton factuel, neutre, professionnel — pas de formules de politesse.`;

/**
 * Analyse une pièce justificative déposée.
 *
 * - Sans `ctx` : analyse "express" (qualité visuelle), utilisée au dépôt côté citoyen.
 * - Avec `ctx` : analyse réglementaire approfondie (croisée avec PLU + CERFA), utilisée
 *   côté mairie au moment de l'instruction.
 *
 * Supporte images (JPG/PNG/GIF/WEBP) et PDF. Tout autre format renvoie une analyse
 * "acceptable" non vérifiée plutôt que d'échouer.
 */
export async function analyzePiece(
  filePath: string,
  mimeType: string,
  nomPiece: string,
  codePiece: string,
  ctx?: PieceContext,
  trace?: { dossierId?: string | null; userId?: string | null },
): Promise<PieceAnalysis> {
  const isImg = isAllowedImage(mimeType);
  const isPdfFile = isPdf(mimeType);

  if (!isImg && !isPdfFile) {
    return {
      score: "acceptable",
      commentaire: "Document reçu. Vérification visuelle non disponible pour ce format — un instructeur vérifiera le contenu.",
      suggestions: [],
      reglementaire: false,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return {
      score: "non_conforme",
      commentaire: "Fichier introuvable sur le serveur.",
      suggestions: ["Re-déposer la pièce."],
      reglementaire: false,
    };
  }
  if (stat.size > MAX_INLINE_BYTES) {
    return {
      score: "acceptable",
      commentaire: `Document trop volumineux (${(stat.size / 1024 / 1024).toFixed(1)} Mo) pour analyse automatique — un instructeur vérifiera manuellement.`,
      suggestions: ["Compresser le PDF ou réduire la résolution des images."],
      reglementaire: false,
    };
  }

  const base64 = fs.readFileSync(filePath).toString("base64");
  const useRegulatory = !!ctx && !!(ctx.regles?.length || ctx.zone || ctx.aide);
  const system = useRegulatory ? SYSTEM_PROMPT_REGULATORY : SYSTEM_PROMPT_BASIC;
  const contextText = buildContextSection(ctx);
  const userText = [
    `Pièce demandée : ${nomPiece}${codePiece ? ` (code ${codePiece})` : ""}`,
    contextText,
  ].filter(Boolean).join("\n\n");

  const documentBlock = isPdfFile
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 } };

  const msg = await callClaude(
    { purpose: "piece_analyze", dossierId: trace?.dossierId, userId: trace?.userId },
    {
      model: "claude-haiku-4-5-20251001",
      max_tokens: useRegulatory ? 1500 : 500,
      system,
      messages: [{
        role: "user",
        content: [documentBlock, { type: "text", text: userText }],
      }],
    },
  );

  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  const parsed = parsePieceAnalysis(text);
  return { ...parsed, reglementaire: useRegulatory };
}
