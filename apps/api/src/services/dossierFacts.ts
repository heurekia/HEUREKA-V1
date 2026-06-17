import { db } from "../db.js";
import { dossier_pieces_jointes, dossier_facts, dossiers } from "@heureka-v1/db";
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

// ─── Mapping dossier → faits ─────────────────────────────────────────
//
// Ce que le wizard et l'enrichissement parcellaire produisent : natures
// de travaux déclarées, surface plancher, et — si la commune a été
// résolue par parcelAnalysis — zonage PLU, risques, servitudes. Ces
// dernières sont notées external_data (issues du GPU / IGN, pas
// d'une saisie utilisateur) ; les natures restent citizen_declaration.

export interface DossierForFacts {
  id: string;
  parcelle: string | null;
  commune: string | null;
  surface_plancher: string | null;
  metadata: unknown;
}

// Natures du wizard → tags d'applicabilité du moteur. Volontairement
// défensif : seules les natures connues produisent un tag, les autres
// ne créent pas d'entrée (ni vrai ni faux — la convention "absence ≠
// négation" est verrouillée dans le moteur côté applicability_tags).
const NATURE_TO_TAG: Record<string, string> = {
  agrandissement: "extension",
  petite_construction: "annexe",
  demolition: "demolition",
  changement_destination: "changement_destination",
  modification_aspect: "ravalement",
  surelevation: "surelevation",
};

export function extractFactsFromDossier(dossier: DossierForFacts): FactCandidate[] {
  const out: FactCandidate[] = [];
  const dossierRef = (field: string): FactSourceRef => ({
    piece_id: dossier.id, // on garde un ID — au sens "source attachée au dossier"
    field,
    piece_type: "dossier",
    nom_piece: null,
  });
  const meta = (dossier.metadata ?? {}) as Record<string, unknown>;

  // ── Natures de travaux (wizard) ─────────────────────────────────────
  const natures = readStringArray(meta.natures);
  if (natures.length > 0) {
    out.push({
      key: "nature_travaux",
      value: natures,
      source: "citizen_declaration",
      source_ref: dossierRef("metadata.natures"),
      confidence: 1,
      priority: 100,
    });
    // Booléens dérivés — exploités par les tags d'applicabilité.
    for (const n of natures) {
      const tag = NATURE_TO_TAG[n];
      if (tag) {
        out.push({
          key: tag,
          value: true,
          source: "citizen_declaration",
          source_ref: dossierRef(`metadata.natures[${n}]`),
          confidence: 1,
          priority: 100,
        });
      }
    }
  }

  // ── Surface plancher déclarée au wizard ────────────────────────────
  // Priorité 40 → sous le CERFA (50) qui a la même origine déclarative
  // mais est plus structuré. Sert de fallback si le CERFA n'a pas été
  // extrait ou ne porte pas la valeur.
  const sp = parseNumberLoose(dossier.surface_plancher);
  if (sp != null) {
    out.push({
      key: "surface_plancher_apres",
      value: sp,
      unit: "m2",
      source: "citizen_declaration",
      source_ref: dossierRef("surface_plancher"),
      confidence: 0.7,
      priority: 40,
    });
  }

  // ── Référence parcellaire ──────────────────────────────────────────
  if (dossier.parcelle && dossier.parcelle.trim() !== "") {
    out.push({
      key: "parcelle_ref",
      value: dossier.parcelle.trim(),
      source: "citizen_declaration",
      source_ref: dossierRef("parcelle"),
      confidence: 1,
      priority: 80,
    });
  }

  // ── Analyse parcellaire mise en cache dans metadata ────────────────
  // Quand le wizard a tourné parcelAnalysis et stocké le résultat, on a
  // une mine d'or : zonage_plu, risques, servitudes. Source =
  // external_data car ça vient du GPU / IGN, pas de l'utilisateur.
  const analysis = readObject(meta.parcel_analysis);
  if (analysis) {
    const pluZone = readObject(analysis.plu_zone);
    const zoneCode = pluZone?.zone_code;
    if (typeof zoneCode === "string" && zoneCode.trim() !== "") {
      out.push({
        key: "zonage_plu",
        value: [zoneCode.trim()],
        source: "external_data",
        source_ref: dossierRef("metadata.parcel_analysis.plu_zone.zone_code"),
        confidence: 1,
        priority: 100,
      });
    }
    const risks = readObject(analysis.risks);
    if (risks) {
      const flagged: string[] = [];
      if (typeof risks.flood_risk === "string" && ["fort", "moyen"].includes(risks.flood_risk)) flagged.push("inondation");
      if (typeof risks.clay_risk === "string" && ["fort", "moyen"].includes(risks.clay_risk)) flagged.push("retrait_gonflement_argiles");
      if (typeof risks.landslide_risk === "string" && ["fort", "moyen"].includes(risks.landslide_risk)) flagged.push("mouvement_terrain");
      if (flagged.length > 0) {
        out.push({
          key: "risques",
          value: flagged,
          source: "external_data",
          source_ref: dossierRef("metadata.parcel_analysis.risks"),
          confidence: 0.9,
          priority: 100,
        });
      }
    }
    // Servitudes : flag ABF si une SUP de catégorie AC1, AC2, AC3 (Monument
    // historique, Sites inscrits/classés) est présente.
    const sups = [...readArray(analysis.sup_surf), ...readArray(analysis.sup_lin)];
    const abfCategories = new Set(["AC1", "AC2", "AC3", "AC4"]);
    const hasAbf = sups.some((s) => {
      const o = readObject(s);
      return o && typeof o.categorie === "string" && abfCategories.has(o.categorie);
    });
    if (hasAbf) {
      out.push({
        key: "secteur_abf",
        value: true,
        source: "external_data",
        source_ref: dossierRef("metadata.parcel_analysis.sup_*"),
        confidence: 1,
        priority: 100,
      });
    }
    const sectorList = sups
      .map((s) => readObject(s)?.categorie)
      .filter((c): c is string => typeof c === "string" && c.trim() !== "");
    if (sectorList.length > 0) {
      out.push({
        key: "servitudes",
        value: [...new Set(sectorList)],
        source: "external_data",
        source_ref: dossierRef("metadata.parcel_analysis.sup_*"),
        confidence: 1,
        priority: 100,
      });
    }
  }

  return out;
}

// Sync complet : dossier + pièces. Best-effort sur chaque source. Quand
// une pièce n'a pas d'extraction (IA non lancée, refus citoyen…), elle
// est simplement ignorée.
export async function syncDossierFacts(dossierId: string): Promise<SyncReport> {
  const [dossier] = await db
    .select({
      id: dossiers.id,
      parcelle: dossiers.parcelle,
      commune: dossiers.commune,
      surface_plancher: dossiers.surface_plancher,
      metadata: dossiers.metadata,
    })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);

  const candidates: FactCandidate[] = [];
  if (dossier) {
    candidates.push(...extractFactsFromDossier(dossier as DossierForFacts));
  }

  const pieces = await db
    .select({ id: dossier_pieces_jointes.id, nom: dossier_pieces_jointes.nom, extraction_ia: dossier_pieces_jointes.extraction_ia })
    .from(dossier_pieces_jointes)
    .where(and(
      eq(dossier_pieces_jointes.dossier_id, dossierId),
      isNull(dossier_pieces_jointes.archived_at),
    ));
  for (const p of pieces) {
    const piece: PieceForFacts = { id: p.id, nom: p.nom, extraction_ia: p.extraction_ia as PieceExtraction | null };
    candidates.push(...extractFactsFromPiece(piece));
  }

  const desired = resolveDossierFacts(candidates);
  return applyDossierFacts(dossierId, desired);
}

// Alias conservé pour les appelants existants ; pointe sur la sync
// complète qui inclut désormais aussi le dossier lui-même.
export const syncDossierFactsFromPieces = syncDossierFacts;

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

// ─── Lecture defensive de metadata jsonb ─────────────────────────────
// metadata est `unknown` à l'usage — on ne fait jamais confiance à la
// forme. Si la valeur n'est pas dans le type attendu, on renvoie une
// version vide et le caller s'adapte.

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

function readObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function readArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parseNumberLoose(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const trimmed = v.trim().replace(",", ".");
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
