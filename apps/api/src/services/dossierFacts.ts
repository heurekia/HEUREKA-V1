import { db } from "../db.js";
import { dossier_pieces_jointes, dossier_facts } from "@heureka-v1/db";
import { and, eq, isNull } from "drizzle-orm";
import type { PieceExtraction } from "./pieceExtractor.js";

// ─── Types ────────────────────────────────────────────────────────────

type FactSource = "citizen_declaration" | "document_extraction" | "instructor_entry" | "external_data";

export interface FactSourceRef {
  piece_id: string;
  field: string;
  piece_type: string;
  nom_piece?: string | null;
}

// Candidat émis par un seul couple (pièce, champ). `priority` permet de
// départager quand plusieurs pièces alimentent la même clé de fait — voir
// resolveDossierFacts plus bas.
export interface FactCandidate {
  key: string;
  value: unknown;
  unit?: string;
  source: FactSource;
  source_ref: FactSourceRef;
  confidence?: number;
  priority: number;
}

export interface DesiredFact {
  key: string;
  value: unknown;
  unit?: string;
  source: FactSource;
  source_ref: FactSourceRef;
  confidence?: number;
}

// ─── Mapping extraction → faits ──────────────────────────────────────
//
// Convention de source :
//   - CERFA = déclaration du pétitionnaire OCRisée → citizen_declaration.
//     Un fait issu du CERFA ne peut pas fonder un verdict bloquant côté
//     evaluator (politique de confiance déjà câblée dans hauteur.ts).
//   - Plans (coupe / masse / façade) = production architecte → on les
//     considère document_extraction (mesurable, opposable).
//
// Convention de priorité quand plusieurs pièces alimentent la même clé :
// plan > CERFA (la mesure prime sur la déclaration). Au sein des plans,
// faîtage > égout pour la hauteur (la règle PLU "hauteur max" vise
// usuellement le faîtage).

export interface PieceForFacts {
  id: string;
  nom: string;
  extraction_ia: PieceExtraction | null;
}

export function extractFactsFromPiece(piece: PieceForFacts): FactCandidate[] {
  const ext = piece.extraction_ia;
  if (!ext) return [];
  const out: FactCandidate[] = [];
  const baseRef = (field: string): FactSourceRef => ({
    piece_id: piece.id,
    field,
    piece_type: ext.piece_type,
    nom_piece: piece.nom,
  });
  const conf = ext.confidence_type;

  // ── CERFA : déclarations citoyenne ─────────────────────────────────
  if (ext.cerfa) {
    const c = ext.cerfa;
    pushIfNumber(out, "surface_terrain", c.surface_terrain_m2, "m2", "citizen_declaration", baseRef("cerfa.surface_terrain_m2"), conf, 50);
    pushIfNumber(out, "surface_plancher_existante", c.surface_plancher_existante_m2, "m2", "citizen_declaration", baseRef("cerfa.surface_plancher_existante_m2"), conf, 50);
    pushIfNumber(out, "surface_plancher_creee", c.surface_plancher_creee_m2, "m2", "citizen_declaration", baseRef("cerfa.surface_plancher_creee_m2"), conf, 50);
    if (c.surface_plancher_existante_m2 != null || c.surface_plancher_creee_m2 != null) {
      const sum = (c.surface_plancher_existante_m2 ?? 0) + (c.surface_plancher_creee_m2 ?? 0);
      out.push({
        key: "surface_plancher_apres",
        value: sum,
        unit: "m2",
        source: "citizen_declaration",
        source_ref: baseRef("cerfa.surface_plancher_existante_m2+creee_m2"),
        confidence: conf,
        priority: 50,
      });
    }
    pushIfNumber(out, "emprise_existante", c.emprise_sol_existante_m2, "m2", "citizen_declaration", baseRef("cerfa.emprise_sol_existante_m2"), conf, 50);
    pushIfNumber(out, "emprise_creee", c.emprise_sol_creee_m2, "m2", "citizen_declaration", baseRef("cerfa.emprise_sol_creee_m2"), conf, 50);
    if (c.emprise_sol_existante_m2 != null || c.emprise_sol_creee_m2 != null) {
      out.push({
        key: "emprise",
        value: (c.emprise_sol_existante_m2 ?? 0) + (c.emprise_sol_creee_m2 ?? 0),
        unit: "m2",
        source: "citizen_declaration",
        source_ref: baseRef("cerfa.emprise_sol_existante_m2+creee_m2"),
        confidence: conf,
        priority: 50,
      });
    }
    pushIfNumber(out, "hauteur", c.hauteur_max_m, "m", "citizen_declaration", baseRef("cerfa.hauteur_max_m"), conf, 50);
    pushIfString(out, "destination_apres", c.destination, undefined, "citizen_declaration", baseRef("cerfa.destination"), conf, 60);
    pushIfNumber(out, "nb_logements", c.nb_logements, null, "citizen_declaration", baseRef("cerfa.nb_logements"), conf, 60);
    pushIfNumber(out, "stationnement", c.nb_places_stationnement, null, "citizen_declaration", baseRef("cerfa.nb_places_stationnement"), conf, 50);
    pushIfBoolean(out, "architecte_obligatoire", c.architecte_obligatoire, "citizen_declaration", baseRef("cerfa.architecte_obligatoire"), conf, 60);
  }

  // ── Plan de masse : mesures opposables ─────────────────────────────
  if (ext.plan_masse) {
    const p = ext.plan_masse;
    pushIfNumber(out, "recul_voie", p.recul_voie_m, "m", "document_extraction", baseRef("plan_masse.recul_voie_m"), conf, 100);
    if (Array.isArray(p.reculs_limites_m) && p.reculs_limites_m.length > 0) {
      out.push({
        key: "reculs_limites",
        value: p.reculs_limites_m,
        unit: "m",
        source: "document_extraction",
        source_ref: baseRef("plan_masse.reculs_limites_m"),
        confidence: conf,
        priority: 100,
      });
    }
    pushIfNumber(out, "emprise", p.emprise_au_sol_m2, "m2", "document_extraction", baseRef("plan_masse.emprise_au_sol_m2"), conf, 100);
  }

  // ── Plan de coupe : hauteurs ───────────────────────────────────────
  // Convention PLU : "hauteur max" vise usuellement le faîtage. Égout sert
  // de fallback si seule cette cote est lisible. NGF brut n'est PAS posé
  // comme fait "hauteur" — c'est une cote altimétrique, l'evaluator
  // hauteur refuse explicitement les NGF (cf. hauteur.ts).
  if (ext.plan_coupe) {
    const p = ext.plan_coupe;
    pushIfNumber(out, "hauteur", p.hauteur_faitage_m, "m", "document_extraction", baseRef("plan_coupe.hauteur_faitage_m"), conf, 120);
    pushIfNumber(out, "hauteur", p.hauteur_egout_m, "m", "document_extraction", baseRef("plan_coupe.hauteur_egout_m"), conf, 100);
    pushIfNumber(out, "hauteur_acrotere", p.hauteur_acrotere_m, "m", "document_extraction", baseRef("plan_coupe.hauteur_acrotere_m"), conf, 100);
    pushIfNumber(out, "pente_terrain", p.pente_terrain_pct, "pct", "document_extraction", baseRef("plan_coupe.pente_terrain_pct"), conf, 100);
  }

  // ── Plan de façade : aspect ────────────────────────────────────────
  if (ext.plan_facade) {
    const p = ext.plan_facade;
    if (Array.isArray(p.materiaux_principaux) && p.materiaux_principaux.length > 0) {
      out.push({ key: "materiaux", value: p.materiaux_principaux, source: "document_extraction", source_ref: baseRef("plan_facade.materiaux_principaux"), confidence: conf, priority: 100 });
    }
    if (Array.isArray(p.teintes) && p.teintes.length > 0) {
      out.push({ key: "teintes", value: p.teintes, source: "document_extraction", source_ref: baseRef("plan_facade.teintes"), confidence: conf, priority: 100 });
    }
    pushIfString(out, "toiture_type", p.toiture_type, undefined, "document_extraction", baseRef("plan_facade.toiture_type"), conf, 100);
    pushIfNumber(out, "pente_toiture", p.pente_toiture_deg, "deg", "document_extraction", baseRef("plan_facade.pente_toiture_deg"), conf, 100);
  }

  return out;
}

// ─── Résolution : un fait actif par clé ──────────────────────────────
//
// Quand plusieurs candidats existent pour la même clé, on prend celui de
// plus haute priorité. Égalité de priorité → plus haute confidence. Égalité
// totale → premier rencontré (stable).
export function resolveDossierFacts(candidates: FactCandidate[]): DesiredFact[] {
  const byKey = new Map<string, FactCandidate>();
  for (const c of candidates) {
    const existing = byKey.get(c.key);
    if (!existing) {
      byKey.set(c.key, c);
      continue;
    }
    if (c.priority > existing.priority) {
      byKey.set(c.key, c);
      continue;
    }
    if (c.priority === existing.priority && (c.confidence ?? 0) > (existing.confidence ?? 0)) {
      byKey.set(c.key, c);
    }
  }
  return [...byKey.values()].map((c) => ({
    key: c.key,
    value: c.value,
    unit: c.unit,
    source: c.source,
    source_ref: c.source_ref,
    confidence: c.confidence,
  }));
}

// ─── Application en base ─────────────────────────────────────────────
//
// Règles :
//   - Si un fait actif existe et a `source = "instructor_entry"`, on NE
//     l'écrase PAS — la saisie humaine reste la vérité. On ne logue même
//     pas un conflit ici (l'UI peut afficher l'écart si besoin).
//   - Si un fait actif existe avec la même source auto-extraite et la
//     même value, on ne touche à rien (idempotent).
//   - Sinon, on marque l'ancien comme superseded_at = now() et on insère
//     le nouveau. Une transaction conviendrait mais Drizzle 0.45 n'offre
//     pas d'API transactionnelle fluide ici — on accepte le risque
//     d'incohérence transitoire car le moteur ne fonde aucun verdict sur
//     un fait obsolète (il filtre superseded_at IS NULL).

export interface SyncReport {
  inserted: number;
  superseded: number;
  skipped_instructor: number;
  kept_identical: number;
}

export async function applyDossierFacts(
  dossierId: string,
  desired: DesiredFact[],
): Promise<SyncReport> {
  const report: SyncReport = { inserted: 0, superseded: 0, skipped_instructor: 0, kept_identical: 0 };
  if (desired.length === 0) return report;

  const activeRows = await db
    .select()
    .from(dossier_facts)
    .where(and(eq(dossier_facts.dossier_id, dossierId), isNull(dossier_facts.superseded_at)));
  const activeByKey = new Map(activeRows.map((r) => [r.key, r]));

  const now = new Date();
  for (const fact of desired) {
    const existing = activeByKey.get(fact.key);

    if (existing) {
      if (existing.source === "instructor_entry") {
        report.skipped_instructor++;
        continue;
      }
      if (existing.source === fact.source && jsonEqual(existing.value, fact.value)) {
        report.kept_identical++;
        continue;
      }
      await db
        .update(dossier_facts)
        .set({ superseded_at: now, updated_at: now })
        .where(eq(dossier_facts.id, existing.id));
      report.superseded++;
    }

    await db.insert(dossier_facts).values({
      dossier_id: dossierId,
      key: fact.key,
      value: fact.value as object,
      unit: fact.unit ?? null,
      source: fact.source,
      source_ref: fact.source_ref as object,
      confidence: fact.confidence ?? null,
    });
    report.inserted++;
  }

  return report;
}

// Sync complet à partir des pièces du dossier. Best-effort : si une pièce
// n'a pas d'extraction (IA non lancée, refus du citoyen, échec…), elle est
// simplement ignorée — pas d'erreur, juste rien à ajouter.
export async function syncDossierFactsFromPieces(dossierId: string): Promise<SyncReport> {
  const pieces = await db
    .select({ id: dossier_pieces_jointes.id, nom: dossier_pieces_jointes.nom, extraction_ia: dossier_pieces_jointes.extraction_ia })
    .from(dossier_pieces_jointes)
    .where(eq(dossier_pieces_jointes.dossier_id, dossierId));

  const candidates: FactCandidate[] = [];
  for (const p of pieces) {
    const piece: PieceForFacts = { id: p.id, nom: p.nom, extraction_ia: p.extraction_ia as PieceExtraction | null };
    candidates.push(...extractFactsFromPiece(piece));
  }
  const desired = resolveDossierFacts(candidates);
  return applyDossierFacts(dossierId, desired);
}

// ─── Helpers ─────────────────────────────────────────────────────────

function pushIfNumber(
  out: FactCandidate[],
  key: string,
  value: number | null | undefined,
  unit: string | null | undefined,
  source: FactSource,
  source_ref: FactSourceRef,
  confidence: number,
  priority: number,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.push({ key, value, unit: unit ?? undefined, source, source_ref, confidence, priority });
  }
}

function pushIfString(
  out: FactCandidate[],
  key: string,
  value: string | null | undefined,
  unit: string | undefined,
  source: FactSource,
  source_ref: FactSourceRef,
  confidence: number,
  priority: number,
): void {
  if (typeof value === "string" && value.trim() !== "") {
    out.push({ key, value: value.trim(), unit, source, source_ref, confidence, priority });
  }
}

function pushIfBoolean(
  out: FactCandidate[],
  key: string,
  value: boolean | null | undefined,
  source: FactSource,
  source_ref: FactSourceRef,
  confidence: number,
  priority: number,
): void {
  if (typeof value === "boolean") {
    out.push({ key, value, source, source_ref, confidence, priority });
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  // Comparaison structurelle simple ; suffit pour les valeurs scalaires et
  // tableaux courts qu'on stocke en jsonb. Pas adapté aux objets profonds
  // avec ordre de clés indéfini — pas un usage actuel.
  return JSON.stringify(a) === JSON.stringify(b);
}
