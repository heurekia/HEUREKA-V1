import path from "path";
import { fileURLToPath } from "url";
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  dossiers,
  dossier_pieces_jointes,
  zone_regulatory_rules,
} from "@heureka-v1/db";
import { buildPiecesContext, getPiecesForType } from "../data/piecesRequises.js";
import { getStorageProvider } from "./storage.js";
import {
  analyzePiece,
  type PieceAnalysis,
  type PieceScore,
  type PieceContext,
  type RegulatoryRuleHint,
} from "./pieceAnalyzer.js";
import { loadZoneRulesWithInheritance } from "./zoneRules.js";
import {
  computeRuleVerdicts,
  type RuleVerdictsReport,
  type VerdictRuleInput,
  type VerdictPieceInput,
  type VerdictDocumentCommuneInput,
} from "./ruleVerdicts.js";
import { ilike } from "drizzle-orm";
// `and`, `eq` déjà importés en haut.
import { communes, commune_documents } from "@heureka-v1/db";
import type { PieceExtraction } from "./pieceExtractor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

// ── Mapping pièce → thèmes PLU vérifiables sur la pièce ──────────────────────
// Pour chaque famille de pièce, on liste les "topics" de règles que ce document
// peut effectivement servir à vérifier. Évite que Claude reçoive l'intégralité du
// PLU pour une simple photographie. Les topics correspondent à
// zone_regulatory_rules.topic et zone_regulatory_rules.sub_theme.
const PIECE_TOPICS: Record<string, string[]> = {
  // Plans de situation : aucun croisement réglementaire utile (seule la localisation compte)
  DP1: [],
  PC1: [],
  PD1: [],
  CU1: [],
  // Plan de masse : implantation, recul, emprise, stationnement, espaces verts, accès
  DP2: ["implantation", "recul", "recul_voie", "recul_limite", "emprise", "emprise_au_sol", "stationnement", "espaces_verts", "acces", "voirie"],
  PC2: ["implantation", "recul", "recul_voie", "recul_limite", "emprise", "emprise_au_sol", "stationnement", "espaces_verts", "acces", "voirie"],
  // Plan en coupe : hauteur, terrain naturel
  DP3: ["hauteur", "hauteur_max", "terrain_naturel"],
  PC3: ["hauteur", "hauteur_max", "terrain_naturel"],
  // Notice descriptive : matériaux, aspect extérieur, couleurs, toiture
  DP4: ["aspect_exterieur", "materiaux", "couleurs", "toiture", "facade", "cloture"],
  PC4: ["aspect_exterieur", "materiaux", "couleurs", "toiture", "facade", "cloture"],
  PD4: ["aspect_exterieur"],
  // Plans façades / toitures : aspect, matériaux, couleurs, ouvertures, hauteur, toiture
  DP5: ["aspect_exterieur", "materiaux", "couleurs", "toiture", "facade", "ouvertures", "hauteur"],
  PC5: ["aspect_exterieur", "materiaux", "couleurs", "toiture", "facade", "ouvertures", "hauteur"],
  // Insertion dans l'environnement : aspect, intégration paysagère
  DP6: ["aspect_exterieur", "integration", "paysage"],
  PC6: ["aspect_exterieur", "integration", "paysage"],
  // Photographies : situation contextuelle, intégration
  DP7: ["integration", "paysage"],
  PC7: ["integration", "paysage"],
  PD3: [],
  // ABF
  "DP-ABF-NDA": ["aspect_exterieur", "materiaux", "couleurs", "menuiseries", "abf"],
  "DP-ABF-FTM": ["materiaux", "menuiseries", "couleurs", "abf"],
};

// Si la pièce n'est pas mappée, on fournit un jeu de topics "généraliste"
// (aspect/implantation) plutôt qu'aucune règle — l'analyste IA décidera.
const DEFAULT_TOPICS = ["implantation", "aspect_exterieur"];

// Famille de pièce : tronc commun (DP1 → 1, PC2 → 2, …). Sert au fallback.
function pieceFamilyKey(code: string): string {
  const m = code.match(/^[A-Z]+(\d+)/);
  return m ? `_${m[1]}` : code;
}

// Topics applicables pour un code de pièce, avec fallback par famille.
function topicsForPiece(code: string): string[] {
  if (code in PIECE_TOPICS) return PIECE_TOPICS[code]!;
  const fam = pieceFamilyKey(code);
  // Plans de masse (2), façades (5), coupes (3), notice (4)
  const map: Record<string, string[]> = {
    _1: [],
    _2: PIECE_TOPICS.DP2!,
    _3: PIECE_TOPICS.DP3!,
    _4: PIECE_TOPICS.DP4!,
    _5: PIECE_TOPICS.DP5!,
    _6: PIECE_TOPICS.DP6!,
    _7: PIECE_TOPICS.DP7!,
  };
  return map[fam] ?? DEFAULT_TOPICS;
}

// ── Structures de sortie ─────────────────────────────────────────────────────

export interface ConformitePieceReport {
  piece_id: string;
  code_piece: string | null;
  nom: string;
  score: PieceScore;
  commentaire: string;
  suggestions: string[];
  non_conformites: PieceAnalysis["non_conformites"];
  reglementaire: boolean;
  error?: string;
}

export interface ConformiteReport {
  schema_version: 1;
  score_global: PieceScore;
  score_pct: number;                 // 0-100, indicatif
  pieces_attendues: number;
  pieces_deposees: number;
  pieces_manquantes: Array<{ code: string; nom: string }>;
  pieces_analyses: ConformitePieceReport[];
  alertes_reglementaires: string[];  // ex: zone ABF, Natura 2000…
  synthese: string;                  // 2-3 phrases factuelles
  // Verdicts règle-par-règle issus du croisement extractions × règles PLU ×
  // synthèses commune. null si l'analyse fine n'a pas pu être exécutée
  // (ex : aucune règle PLU disponible).
  rule_verdicts: RuleVerdictsReport | null;
  model: string;
  duration_ms: number;
  analyzed_at: string;
  warnings: string[];                // erreurs non bloquantes (rules manquantes, etc.)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Filtre les règles PLU pertinentes pour le code de pièce demandé. Si on n'a
// aucun topic spécifique, on renvoie un jeu réduit (les règles "general").
function filterRulesForPiece(
  allRules: Array<typeof zone_regulatory_rules.$inferSelect>,
  pieceCode: string,
): RegulatoryRuleHint[] {
  const topics = topicsForPiece(pieceCode);
  const wanted = new Set(topics.map((t) => t.toLowerCase()));
  const matches = allRules.filter((r) => {
    const topic = (r.topic ?? "").toLowerCase();
    const sub = (r.sub_theme ?? "").toLowerCase();
    if (wanted.size === 0) return false;
    if (wanted.has(topic)) return true;
    if (sub && wanted.has(sub)) return true;
    // Match partiel : topic "recul_voie" matche le filtre "recul"
    for (const w of wanted) {
      if (topic.includes(w) || (sub && sub.includes(w))) return true;
    }
    return false;
  });
  // Limite à 12 règles pour ne pas saturer le prompt (priorité aux règles avec valeurs chiffrées)
  const sorted = matches.sort((a, b) => {
    const aHas = a.value_exact != null || a.value_min != null || a.value_max != null ? 1 : 0;
    const bHas = b.value_exact != null || b.value_min != null || b.value_max != null ? 1 : 0;
    return bHas - aHas;
  });
  return sorted.slice(0, 12).map((r) => ({
    topic: r.topic ?? "general",
    summary: r.summary ?? r.rule_text.slice(0, 220),
    article: r.article_number != null ? `Art. ${r.article_number}` : undefined,
    value_exact: r.value_exact,
    value_min: r.value_min,
    value_max: r.value_max,
    unit: r.unit,
  }));
}

// Convertit l'URL stockée ("/api/uploads/<file>") en chemin disque.
// Conservé pour rétrocompatibilité — toute nouvelle lecture passe désormais
// par le StorageProvider qui gère local et S3 indifféremment.
function urlToDiskPath(url: string): string | null {
  const filename = url.split("/").pop();
  if (!filename) return null;
  return path.join(UPLOADS_DIR, filename);
}

// Charge la zone PLU + ses règles valides, AVEC héritage des zones mères.
// Pour une parcelle en UBai, on récupère les règles UBai + UBa + UB, la plus
// spécifique gagnant par (article, topic, sub_theme).
async function loadZoneRules(
  zoneCode: string | undefined,
  commune: string | undefined,
): Promise<{ rules: Array<typeof zone_regulatory_rules.$inferSelect>; zoneFound: boolean; matchedChain: string[] }> {
  if (!zoneCode) return { rules: [], zoneFound: false, matchedChain: [] };
  const loaded = await loadZoneRulesWithInheritance(zoneCode, { communeNom: commune });
  return { rules: loaded.rules, zoneFound: loaded.zone !== null, matchedChain: loaded.matchedChain };
}

// ── Calcul du score global ───────────────────────────────────────────────────
// Pondérations : non_conforme = 0, incomplet = 0.4, acceptable = 0.7, conforme = 1.
// Pièces manquantes comptent comme 0. Score global = pire score parmi pièces
// présentes + impact pièces manquantes.
const SCORE_WEIGHT: Record<PieceScore, number> = {
  conforme: 1,
  acceptable: 0.7,
  incomplet: 0.4,
  non_conforme: 0,
};

export function computeGlobalScore(
  pieceScores: PieceScore[],
  manquantes: number,
  attendues: number,
): { score: PieceScore; pct: number } {
  if (attendues === 0) {
    return { score: "incomplet", pct: 0 };
  }
  const presentCount = attendues - manquantes;
  const presentSum = pieceScores.reduce((s, sc) => s + SCORE_WEIGHT[sc], 0);
  const pct = Math.round((presentSum / attendues) * 100);

  if (manquantes > 0) return { score: "incomplet", pct };
  if (pieceScores.includes("non_conforme")) return { score: "non_conforme", pct };
  if (pieceScores.includes("incomplet")) return { score: "incomplet", pct };
  if (pieceScores.includes("acceptable")) return { score: "acceptable", pct };
  if (presentCount > 0 && pieceScores.every((s) => s === "conforme")) return { score: "conforme", pct };
  return { score: "acceptable", pct };
}

// Synthèse texte simple (déterministe) — sert de fallback si on ne génère pas de
// synthèse via LLM (et de complément lisible pour l'instructeur dans tous les cas).
export function buildSynthese(
  scoreGlobal: PieceScore,
  pct: number,
  attendues: number,
  manquantes: number,
  ncMajeures: number,
): string {
  if (scoreGlobal === "conforme") {
    return `Dossier conforme : ${attendues} pièce${attendues > 1 ? "s" : ""} déposée${attendues > 1 ? "s" : ""}, aucune non-conformité majeure détectée. Pré-instruction recommandée.`;
  }
  if (scoreGlobal === "non_conforme") {
    return `Dossier non conforme : ${ncMajeures} non-conformité${ncMajeures > 1 ? "s" : ""} majeure${ncMajeures > 1 ? "s" : ""} détectée${ncMajeures > 1 ? "s" : ""}. Refus ou demande de pièces complémentaires à envisager.`;
  }
  if (manquantes > 0) {
    return `Dossier incomplet : ${manquantes} pièce${manquantes > 1 ? "s" : ""} requise${manquantes > 1 ? "s" : ""} manquante${manquantes > 1 ? "s" : ""}. Demande de pièces complémentaires nécessaire.`;
  }
  return `Score global : ${pct}%. Pièces déposées mais des éléments réglementaires à vérifier ou compléter. ${ncMajeures > 0 ? `${ncMajeures} non-conformité${ncMajeures > 1 ? "s" : ""} majeure${ncMajeures > 1 ? "s" : ""} signalée${ncMajeures > 1 ? "s" : ""}.` : ""}`.trim();
}

// ── Orchestrateur principal ──────────────────────────────────────────────────

const MODEL_ID = "claude-haiku-4-5-20251001";
// Garde-fou : analyse séquentielle des pièces avec un petit niveau de parallélisme
// pour ne pas saturer l'API Anthropic. Limite RPM Claude Haiku ~50/min.
const MAX_PARALLEL = 3;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Calcule l'analyse de conformité d'un dossier :
 *  1. Charge les pièces requises (CERFA) pour le type/contexte.
 *  2. Identifie les pièces manquantes.
 *  3. Charge les règles PLU applicables à la zone de la parcelle.
 *  4. Pour chaque pièce déposée, lance une analyse IA croisée (pièce ↔ règles ↔ CERFA).
 *  5. Agrège un score global + synthèse.
 *
 * Persiste le résultat dans `dossiers.conformite_analysis` et met à jour le statut
 * `conformite_status`. Sans pour autant changer le statut métier du dossier.
 */
export async function runDossierConformityAnalysis(dossierId: string): Promise<ConformiteReport> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  // 1. Charge le dossier
  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
  if (!dossier) {
    throw new Error("Dossier non trouvé");
  }

  // 2. Verrou : refuse les exécutions concurrentes
  if (dossier.conformite_status === "running") {
    throw new Error("Une analyse est déjà en cours pour ce dossier");
  }
  await db
    .update(dossiers)
    .set({ conformite_status: "running", updated_at: new Date() })
    .where(eq(dossiers.id, dossierId));

  try {
    // 3. Pièces attendues (déterministe)
    const meta = (dossier.metadata as Record<string, unknown>) ?? {};
    const natures = Array.isArray(meta.natures) ? (meta.natures as string[]) : [];
    const surface = parseFloat(dossier.surface_plancher ?? "0") || 0;
    const servitudes = Array.isArray(meta.servitudes) ? (meta.servitudes as Array<{ categorie?: string; libelle?: string }>) : undefined;
    const situational = (meta.situational && typeof meta.situational === "object"
      ? meta.situational as {
          isLotissement?: boolean;
          isERP?: boolean;
          hasDefrichement?: boolean;
          isNatura2000?: boolean;
          isClimateResilience?: boolean;
        }
      : undefined);
    const piecesCtx = buildPiecesContext(natures, surface, servitudes, undefined, situational);
    const piecesAttendues = getPiecesForType(dossier.type, piecesCtx).filter((p) => p.requis);

    // 4. Pièces déposées
    const piecesDeposees = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.dossier_id, dossierId));
    const piecesParCode = new Map<string, typeof piecesDeposees[number]>();
    for (const p of piecesDeposees) if (p.code_piece) piecesParCode.set(p.code_piece, p);

    // 5. Manquantes
    const manquantes = piecesAttendues
      .filter((p) => !piecesParCode.has(p.code))
      .map((p) => ({ code: p.code, nom: p.nom }));

    // 6. Zone PLU + règles
    const zoneCode = (meta.zone as string | undefined) ?? undefined;
    const commune = dossier.commune ?? undefined;
    // Résolution de l'ID de commune pour l'imputation des coûts IA (nullable :
    // si le nom de commune du dossier ne matche aucune commune en base, on
    // continue sans imputation — le dossier_id reste, lui, toujours présent).
    let resolvedCommuneId: string | null = null;
    if (commune) {
      const [c] = await db.select({ id: communes.id }).from(communes).where(ilike(communes.name, commune)).limit(1);
      resolvedCommuneId = c?.id ?? null;
    }
    const { rules, zoneFound, matchedChain } = await loadZoneRules(zoneCode, commune);
    if (zoneCode && !zoneFound) {
      warnings.push(`Aucune zone PLU ingérée pour "${zoneCode}" sur ${commune ?? "cette commune"}. Analyse réalisée sans règles PLU.`);
    } else if (!zoneCode) {
      warnings.push("Zone PLU non renseignée sur le dossier — analyse réalisée sans croisement PLU.");
    } else if (rules.length === 0) {
      warnings.push(`Zone "${zoneCode}" trouvée mais sans règles validées. Analyse réalisée sans croisement PLU.`);
    } else if (matchedChain.length > 1) {
      warnings.push(`Règles héritées : ${matchedChain.join(" → ")} (les règles du secteur prévalent sur celles de la zone mère).`);
    }

    // 7. Construit l'index des pièces attendues par code (pour récupérer l'aide)
    const attenduesParCode = new Map(piecesAttendues.map((p) => [p.code, p]));

    // 8. Analyse pièce par pièce
    const piecesAnalyses = await mapWithConcurrency(piecesDeposees, MAX_PARALLEL, async (p) => {
      const code = p.code_piece ?? "";
      const attendue = code ? attenduesParCode.get(code) : undefined;
      const reglesPiece = filterRulesForPiece(rules, code);
      const ctx: PieceContext = {
        aide: attendue?.aide,
        dossierType: dossier.type,
        natures,
        surface: surface || undefined,
        zone: zoneCode,
        commune,
        parcelle: dossier.parcelle ?? undefined,
        hasABF: piecesCtx.hasABF,
        regles: reglesPiece,
      };
      // Lecture du fichier via StorageProvider (local OU S3). On retombe sur
      // le chemin disque pour les très anciens enregistrements si jamais
      // l'URL est cassée.
      const storage = getStorageProvider();
      let pieceBuffer: Buffer | null = null;
      try {
        pieceBuffer = await storage.getBuffer(storage.keyFromUrl(p.url));
      } catch {
        // Fallback legacy : tente le chemin disque historique.
        const diskPath = urlToDiskPath(p.url);
        if (diskPath) {
          try { pieceBuffer = await import("node:fs").then((fs) => fs.promises.readFile(diskPath)); }
          catch { pieceBuffer = null; }
        }
      }
      let result: ConformitePieceReport;
      if (!pieceBuffer) {
        result = {
          piece_id: p.id,
          code_piece: p.code_piece,
          nom: p.nom,
          score: "non_conforme",
          commentaire: "Fichier non localisable sur le serveur.",
          suggestions: ["Re-déposer la pièce."],
          non_conformites: undefined,
          reglementaire: false,
          error: "FILE_NOT_FOUND",
        };
      } else {
        try {
          const analysis = await analyzePiece(pieceBuffer, p.type, p.nom, code, ctx, { dossierId, communeId: resolvedCommuneId });
          result = {
            piece_id: p.id,
            code_piece: p.code_piece,
            nom: p.nom,
            score: analysis.score,
            commentaire: analysis.commentaire,
            suggestions: analysis.suggestions,
            non_conformites: analysis.non_conformites,
            reglementaire: analysis.reglementaire ?? false,
          };
          // Persiste l'analyse mise à jour sur la pièce (utilisable côté UI dépôt aussi)
          await db
            .update(dossier_pieces_jointes)
            .set({ analyse_ia: analysis })
            .where(eq(dossier_pieces_jointes.id, p.id));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result = {
            piece_id: p.id,
            code_piece: p.code_piece,
            nom: p.nom,
            score: "acceptable",
            commentaire: "Analyse automatique indisponible — vérification manuelle requise.",
            suggestions: [],
            non_conformites: undefined,
            reglementaire: false,
            error: msg.slice(0, 200),
          };
        }
      }
      return result;
    });

    // 9. Score global
    const scores = piecesAnalyses.map((p) => p.score);
    const { score: scoreGlobal, pct } = computeGlobalScore(scores, manquantes.length, piecesAttendues.length);
    const ncMajeures = piecesAnalyses.reduce(
      (n, p) => n + (p.non_conformites?.filter((nc) => nc.gravite === "majeure").length ?? 0),
      0,
    );

    // 9bis. Verdicts règle-par-règle (croisement extractions × règles PLU × synthèses commune).
    // Filet : on n'exécute que s'il y a au moins une règle ET au moins une pièce.
    let ruleVerdicts: RuleVerdictsReport | null = null;
    try {
      if (rules.length > 0 && piecesDeposees.length > 0) {
        // Pré-filtre des règles : on écarte celles marquées "non pertinent citoyen"
        // ET les règles "general" sans valeur (pas exploitables côté verdict typé).
        const targetRules: VerdictRuleInput[] = rules
          .filter((r) => r.validation_status === "valide")
          .filter((r) => {
            const hasValue = r.value_exact != null || r.value_min != null || r.value_max != null;
            if (hasValue) return true;
            // règles qualitatives gardées : aspect, interdictions, conditions
            return ["aspect", "interdictions", "conditions", "destinations"].includes(r.topic ?? "");
          })
          .slice(0, 40) // borne pour le prompt
          .map((r) => ({
            id: r.id,
            topic: r.topic ?? "general",
            article_number: r.article_number,
            sub_theme: r.sub_theme ?? null,
            rule_text: r.rule_text,
            summary: r.summary,
            value_min: r.value_min,
            value_max: r.value_max,
            value_exact: r.value_exact,
            unit: r.unit,
            cases: (r.cases ?? null) as VerdictRuleInput["cases"],
            applies_if: (r.applies_if ?? null) as string[] | null,
            exceptions: r.exceptions ?? null,
          }));

        const verdictPieces: VerdictPieceInput[] = piecesDeposees.map((p) => ({
          id: p.id,
          nom: p.nom,
          code_piece: p.code_piece,
          extraction: (p.extraction_ia as PieceExtraction | null) ?? null,
        }));

        // Synthèses des documents commune (OAP, PPRI…) pour la commune du dossier
        let documentsCommune: VerdictDocumentCommuneInput[] = [];
        if (commune) {
          const [comm] = await db
            .select({ id: communes.id })
            .from(communes)
            .where(ilike(communes.name, commune))
            .limit(1);
          if (comm) {
            // Gate juridique : ne lire QUE les synthèses validées par un humain.
            // Une synthèse "brouillon" ou "rejete" ne doit jamais alimenter un
            // verdict d'instruction.
            const docs = await db
              .select({
                id: commune_documents.id,
                name: commune_documents.name,
                type: commune_documents.type,
                synthese: commune_documents.synthese,
              })
              .from(commune_documents)
              .where(and(
                eq(commune_documents.commune_id, comm.id),
                eq(commune_documents.validation_status, "valide"),
              ));
            documentsCommune = docs;
          }
        }

        ruleVerdicts = await computeRuleVerdicts({
          rules: targetRules,
          pieces: verdictPieces,
          documentsCommune,
          context: {
            zone_code: zoneCode ?? null,
            commune: commune ?? null,
            natures,
            surface_plancher: surface || null,
          },
          trace: { dossierId, communeId: resolvedCommuneId },
        });
      } else if (rules.length === 0) {
        warnings.push("Verdicts règle-par-règle non générés : aucune règle PLU indexée pour cette zone.");
      } else {
        warnings.push("Verdicts règle-par-règle non générés : aucune pièce déposée.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Verdicts règle-par-règle échoués : ${msg.slice(0, 200)}`);
    }

    // 10. Alertes réglementaires contextuelles
    const alertes: string[] = [];
    if (piecesCtx.hasABF) alertes.push("Périmètre ABF : avis Architecte des Bâtiments de France obligatoire (+1 mois sur le délai d'instruction, R.423-24 b)).");
    if (piecesCtx.isNatura2000) alertes.push("Site Natura 2000 : évaluation d'incidence requise.");
    if (piecesCtx.isERP) alertes.push("ERP : dossiers accessibilité et sécurité incendie exigés.");
    if (piecesCtx.isClimateResilience) alertes.push("Loi Climat & Résilience (R.171-35) : attestation obligatoire.");

    const synthese = buildSynthese(scoreGlobal, pct, piecesAttendues.length, manquantes.length, ncMajeures);

    const report: ConformiteReport = {
      schema_version: 1,
      score_global: scoreGlobal,
      score_pct: pct,
      pieces_attendues: piecesAttendues.length,
      pieces_deposees: piecesDeposees.length,
      pieces_manquantes: manquantes,
      pieces_analyses: piecesAnalyses,
      alertes_reglementaires: alertes,
      synthese,
      rule_verdicts: ruleVerdicts,
      model: MODEL_ID,
      duration_ms: Date.now() - startedAt,
      analyzed_at: new Date().toISOString(),
      warnings,
    };

    await db
      .update(dossiers)
      .set({
        conformite_analysis: report,
        conformite_status: "done",
        conformite_analyzed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(dossiers.id, dossierId));

    return report;
  } catch (err) {
    await db
      .update(dossiers)
      .set({
        conformite_status: "failed",
        conformite_analyzed_at: new Date(),
        conformite_analysis: {
          schema_version: 1,
          error: err instanceof Error ? err.message : String(err),
          analyzed_at: new Date().toISOString(),
        },
        updated_at: new Date(),
      })
      .where(eq(dossiers.id, dossierId));
    throw err;
  }
}

/**
 * Lance l'analyse en tâche de fond, sans bloquer l'appelant. Retourne immédiatement.
 * Utilisé lors de la soumission citoyen → mairie pour ne pas bloquer la requête HTTP
 * (l'analyse peut prendre 30 s à 2 min selon le nombre de pièces).
 */
export function runDossierConformityAnalysisBackground(dossierId: string): void {
  // Promesse non-attendue : capture l'erreur pour éviter unhandledRejection.
  // L'état "failed" est déjà persisté dans la fonction principale.
  void runDossierConformityAnalysis(dossierId).catch((err) => {
    console.error(`[conformite] analyse en tâche de fond échouée pour ${dossierId}:`, err);
  });
}
