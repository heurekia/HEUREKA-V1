/**
 * Moteur de documentation contextuelle pour l'instructeur.
 *
 * Objectif : permettre à l'instructeur, pendant qu'il consulte une pièce d'un
 * dossier (plan de masse, façades, photographies…), de voir instantanément
 * les références réglementaires applicables — sans quitter le visualiseur.
 *
 * Conception délibérée :
 *  - 100 % algorithmique, AUCUN appel IA. Le déclenchement et le filtrage des
 *    références reposent sur des règles métier explicites et journalisables —
 *    indispensable pour la justification juridique d'une décision d'instruction.
 *  - L'engine reste pur (pas d'effet de bord) tant que possible : la couche
 *    DB charge les règles candidates, l'engine les filtre selon le contexte.
 *  - Structure extensible : un futur moteur IA pourra suggérer des références
 *    additionnelles, mais l'algorithme déterministe reste la source de
 *    vérité par défaut.
 *
 * Architecture :
 *  - PIECE_TOPICS : mapping pure-données piece_code → topics réglementaires
 *  - PIECE_LABELS : libellé humain par code de pièce (pour l'UI)
 *  - buildDocumentationContext : agrège commune, parcelle, zone, projet,
 *    servitudes, ABF, OAP — depuis dossier + analyse parcellaire
 *  - listApplicableReferences : retourne les références filtrées par zone,
 *    par tags d'applicabilité, et (optionnellement) par topics d'une pièce
 *  - getReferenceDetail : renvoie le détail complet (texte, page, source URL)
 */

import { db } from "../db.js";
import {
  dossiers,
  dossier_pieces_jointes,
  communes,
  zones,
  zone_regulatory_rules,
  regulatory_documents,
  documentation_favoris,
} from "@heureka-v1/db";
import { eq, and, ilike, or } from "drizzle-orm";

// ── Types publics ────────────────────────────────────────────────────────────

export interface DocumentationContext {
  commune: string | null;
  insee_code: string | null;
  parcelle: string | null;
  zone: string | null;
  zones_disponibles: string[];
  type_dossier: string | null;
  nature_projet: string[];
  servitudes: string[];
  presence_abf: boolean;
  oap_concernees: string[];
  // Pièce actuellement consultée (si transmise) — utilisée pour filtrer les
  // topics réglementaires affichés.
  piece_id: string | null;
  piece_code: string | null;
  piece_nom: string | null;
  piece_topics: string[];
}

export interface DocumentationReference {
  id_regle: string;
  titre: string;
  type: "plu_rule" | "commune_document" | "oap" | "servitude" | "code_urbanisme";
  source: string;
  zone: string | null;
  commune: string | null;
  texte: string;
  page: string | null;
  url_document: string | null;
  conditions: string[];
  // Métadonnées internes utiles à l'UI mais sans valeur juridique propre.
  topic?: string;
  sub_theme?: string | null;
  article_number?: number | null;
  // Origine du déclenchement (par quelle règle métier la référence est
  // remontée). Sert la traçabilité — l'instructeur peut expliquer pourquoi
  // une référence figure dans sa liste.
  matched_by: {
    rule: "zone_match" | "applies_if" | "piece_topic" | "fallback_commune";
    detail: string;
  };
}

// ── Mapping pièce → topics réglementaires ────────────────────────────────────
//
// Source : arrêté du 13 février 2020 + bordereaux CERFA. Chaque code de pièce
// déclenche les topics que l'instructeur examine concrètement sur ce document.
// Convention DPx / PCx alignée avec apps/api/src/data/piecesRequises.ts.
//
// Une pièce sans entrée explicite tombe sur DEFAULT_TOPICS — large mais utile
// pour les pièces atypiques (dossier d'incidences, attestations…).
const DEFAULT_TOPICS = ["general"] as const;

export const PIECE_TOPICS: Record<string, readonly string[]> = {
  // ── Déclaration Préalable ────────────────────────────────────────
  // DP1 — Plan de situation
  DP1: ["general"],
  // DP2 — Plan de masse
  DP2: ["recul_voie", "recul_limite", "recul_batiments", "emprise_sol", "stationnement", "desserte_voies", "espaces_verts"],
  // DP3 — Plan en coupe
  DP3: ["hauteur", "recul_batiments"],
  // DP4 — Notice descriptive
  DP4: ["aspect", "destinations", "general"],
  // DP5 — Plans façades / toitures
  DP5: ["aspect", "hauteur"],
  // DP6 — Document graphique d'insertion
  DP6: ["aspect", "general"],
  // DP7 — Photographies
  DP7: ["aspect", "general"],
  // DP8 — Consultation ABF
  DP8: ["aspect"],
  "DP-ABF-NDA": ["aspect"],
  "DP-ABF-FTM": ["aspect"],

  // ── Permis de Construire ────────────────────────────────────────
  PC1: ["general"],
  PC2: ["recul_voie", "recul_limite", "recul_batiments", "emprise_sol", "stationnement", "desserte_voies", "espaces_verts"],
  PC3: ["hauteur", "recul_batiments"],
  PC4: ["aspect", "destinations", "general"],
  PC5: ["aspect", "hauteur"],
  PC6: ["aspect", "general"],
  PC7: ["aspect", "general"],
  PC8: ["general"], // RE2020 — peu de topics PLU
  PC16: ["general"],
  PC28: ["emprise_sol", "general"],
  PC29: ["desserte_voies", "desserte_reseaux"],
  PC39: ["aspect", "general"],
  PC40: ["general"],
  PC47: ["general"],

  // ── Permis de Démolir ───────────────────────────────────────────
  PD1: ["general"],
  PD2: ["emprise_sol", "general"],
  PD3: ["aspect"],
  PD4: ["aspect", "general"],

  // ── Certificat d'Urbanisme ──────────────────────────────────────
  CU1: ["general"],
  CU2: ["general"],
};

export const PIECE_LABELS: Record<string, string> = {
  DP1: "Plan de situation",
  DP2: "Plan de masse",
  DP3: "Plan en coupe",
  DP4: "Notice descriptive",
  DP5: "Plans façades / toitures",
  DP6: "Document graphique d'insertion",
  DP7: "Photographies",
  DP8: "Consultation ABF",
  PC1: "Plan de situation",
  PC2: "Plan de masse",
  PC3: "Plan en coupe",
  PC4: "Notice descriptive",
  PC5: "Plans façades / toitures",
  PC6: "Document graphique d'insertion",
  PC7: "Photographies",
  PD1: "Plan de situation (démolition)",
  PD2: "Plan de masse (démolition)",
  PD3: "Photographies à démolir",
  PD4: "Notice de démolition",
  CU1: "Plan de situation (CU)",
  CU2: "Plan sommaire (CU)",
};

export function topicsForPieceCode(code: string | null | undefined): string[] {
  if (!code) return [...DEFAULT_TOPICS];
  return [...(PIECE_TOPICS[code] ?? DEFAULT_TOPICS)];
}

// ── Mapping servitude → catégorie lisible ────────────────────────────────────
//
// Liste exhaustive des catégories de servitudes d'utilité publique (annexe
// du Code de l'Urbanisme). On ne référence ici que les libellés utiles à
// l'instructeur pour identifier rapidement la nature d'une SUP.
const SERVITUDE_LABELS: Record<string, string> = {
  AC1: "Monuments historiques classés (ABF)",
  AC2: "Sites classés et inscrits",
  AC3: "Réserves naturelles",
  AC4: "Sites patrimoniaux remarquables (SPR)",
  AS1: "Conservation des eaux (captages)",
  EL3: "Halage et marchepied",
  EL7: "Alignement (voirie)",
  EL11: "Routes express et déviations",
  I3: "Canalisations gaz",
  I4: "Canalisations électriques",
  I5: "Canalisations hydrocarbures",
  PM1: "Risques naturels (PPRN / PPRI)",
  PM2: "Installations classées",
  PM3: "Risques technologiques (PPRT)",
  PT1: "Transmissions radioélectriques (protection contre les perturbations)",
  PT2: "Transmissions radioélectriques (protection contre les obstacles)",
  PT3: "Communications téléphoniques et télégraphiques",
  T1: "Voies ferrées",
  T4: "Aérodromes (balisage)",
  T5: "Aérodromes (dégagements)",
  T7: "Relations aériennes (en dehors des servitudes T4/T5)",
};

export function libelleServitude(categorie: string | null | undefined, fallback?: string | null): string {
  if (!categorie) return fallback ?? "Servitude";
  const upper = categorie.toUpperCase();
  return SERVITUDE_LABELS[upper] ?? fallback ?? `Servitude ${upper}`;
}

// ── Construction du contexte documentaire ────────────────────────────────────

interface BuildContextOptions {
  pieceId?: string | null;
}

interface DossierRowLite {
  id: string;
  type: string;
  parcelle: string | null;
  commune: string | null;
  description: string | null;
  metadata: unknown;
  conformite_analysis: unknown;
}

// Inspecte le JSON `metadata` (souvent peuplé par le wizard citoyen) pour en
// extraire la nature des travaux. Renvoie un tableau de chaînes humaines.
function extractNatureProjet(dossier: DossierRowLite): string[] {
  const meta = (dossier.metadata ?? {}) as Record<string, unknown>;
  const natures = Array.isArray(meta.natures_travaux)
    ? (meta.natures_travaux as unknown[]).filter((x): x is string => typeof x === "string")
    : Array.isArray(meta.natures)
      ? (meta.natures as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
  if (natures.length > 0) return natures;
  if (dossier.description) return [dossier.description];
  return [];
}

// Inspecte l'analyse de conformité (calculée à la soumission) pour récupérer
// les alertes réglementaires détectées — souvent : ABF, OAP, PPRI.
function extractAlertesReglementaires(dossier: DossierRowLite): string[] {
  const ca = dossier.conformite_analysis as { alertes_reglementaires?: unknown } | null;
  if (!ca || !Array.isArray(ca.alertes_reglementaires)) return [];
  return (ca.alertes_reglementaires as unknown[]).filter((x): x is string => typeof x === "string");
}

export async function buildDocumentationContext(
  dossierId: string,
  opts: BuildContextOptions = {},
): Promise<DocumentationContext> {
  const [dossier] = await db
    .select({
      id: dossiers.id,
      type: dossiers.type,
      parcelle: dossiers.parcelle,
      commune: dossiers.commune,
      description: dossiers.description,
      metadata: dossiers.metadata,
      conformite_analysis: dossiers.conformite_analysis,
    })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);

  if (!dossier) {
    throw new Error(`Dossier ${dossierId} non trouvé`);
  }

  let inseeCode: string | null = null;
  let zonesDisponibles: string[] = [];
  if (dossier.commune) {
    const [commune] = await db
      .select({ id: communes.id, insee_code: communes.insee_code })
      .from(communes)
      .where(ilike(communes.name, dossier.commune))
      .limit(1);
    if (commune) {
      inseeCode = commune.insee_code;
      const zoneRows = await db
        .select({ zone_code: zones.zone_code })
        .from(zones)
        .where(and(eq(zones.commune_id, commune.id), eq(zones.is_active, true)));
      zonesDisponibles = zoneRows.map((z) => z.zone_code);
    }
  }

  // Zone : prend d'abord la valeur déclarée dans metadata.zone_plu, puis le
  // fait éventuellement extrait, puis null si rien n'est résolu.
  const meta = (dossier.metadata ?? {}) as Record<string, unknown>;
  const zoneFromMeta = typeof meta.zone_plu === "string" && meta.zone_plu.trim()
    ? meta.zone_plu.trim()
    : null;

  let piece: { id: string; code_piece: string | null; nom: string } | null = null;
  if (opts.pieceId) {
    const [row] = await db
      .select({
        id: dossier_pieces_jointes.id,
        code_piece: dossier_pieces_jointes.code_piece,
        nom: dossier_pieces_jointes.nom,
      })
      .from(dossier_pieces_jointes)
      .where(and(
        eq(dossier_pieces_jointes.id, opts.pieceId),
        eq(dossier_pieces_jointes.dossier_id, dossierId),
      ))
      .limit(1);
    piece = row ?? null;
  }

  // Détection grossière mais robuste : on cherche AC*/PM* dans les alertes
  // de conformité (cf. analyse parcellaire qui les peuple).
  const alertes = extractAlertesReglementaires(dossier);
  const presenceAbf = alertes.some((a) => /abf|ac1|ac4|monument|inscrit|class[ée]/i.test(a));
  const oapAlertes = alertes
    .filter((a) => /oap|orientation[s]? d'am[ée]nagement/i.test(a))
    .map((a) => a.replace(/^OAP\s*[:–-]\s*/i, "").trim());
  const servitudesAlertes = alertes.filter((a) => /servitude|ppri|pprn|ac\d|pm\d|el\d|pt\d/i.test(a));

  return {
    commune: dossier.commune ?? null,
    insee_code: inseeCode,
    parcelle: dossier.parcelle ?? null,
    zone: zoneFromMeta,
    zones_disponibles: zonesDisponibles,
    type_dossier: dossier.type,
    nature_projet: extractNatureProjet(dossier),
    servitudes: servitudesAlertes,
    presence_abf: presenceAbf,
    oap_concernees: oapAlertes,
    piece_id: piece?.id ?? null,
    piece_code: piece?.code_piece ?? null,
    piece_nom: piece?.nom ?? (piece?.code_piece ? PIECE_LABELS[piece.code_piece] ?? null : null),
    piece_topics: piece?.code_piece ? topicsForPieceCode(piece.code_piece) : [],
  };
}

// ── Listage des références applicables ───────────────────────────────────────

interface ListReferencesOptions {
  pieceId?: string | null;
  // topics demandés explicitement (force un filtrage indépendamment de la pièce)
  topics?: string[] | null;
}

export async function listApplicableReferences(
  dossierId: string,
  opts: ListReferencesOptions = {},
): Promise<{ context: DocumentationContext; references: DocumentationReference[] }> {
  const context = await buildDocumentationContext(dossierId, { pieceId: opts.pieceId });
  const refs: DocumentationReference[] = [];

  // Topics ciblés : si une pièce est consultée → ses topics ; sinon, l'instructeur
  // veut tout voir et on ne filtre pas par topic.
  const topicFilter = opts.topics && opts.topics.length > 0
    ? new Set(opts.topics)
    : context.piece_topics.length > 0
      ? new Set(context.piece_topics)
      : null;

  // 1) Règles PLU validées de la commune.
  if (context.commune) {
    const [commune] = await db
      .select({ id: communes.id })
      .from(communes)
      .where(ilike(communes.name, context.commune))
      .limit(1);

    if (commune) {
      const ruleRows = await db
        .select({
          rule_id: zone_regulatory_rules.id,
          zone_code: zones.zone_code,
          zone_label: zones.zone_label,
          article_number: zone_regulatory_rules.article_number,
          article_title: zone_regulatory_rules.article_title,
          topic: zone_regulatory_rules.topic,
          sub_theme: zone_regulatory_rules.sub_theme,
          rule_text: zone_regulatory_rules.rule_text,
          summary: zone_regulatory_rules.summary,
          conditions: zone_regulatory_rules.conditions,
          exceptions: zone_regulatory_rules.exceptions,
          applies_if: zone_regulatory_rules.applies_if,
        })
        .from(zone_regulatory_rules)
        .innerJoin(zones, eq(zones.id, zone_regulatory_rules.zone_id))
        .where(and(
          eq(zones.commune_id, commune.id),
          eq(zone_regulatory_rules.validation_status, "valide"),
        ));

      // Filtre zone : si la parcelle est zonée, on garde la zone et toutes les
      // règles communes (sub_theme général). Sinon, fallback : on remonte tout
      // le règlement de la commune avec un drapeau de provenance.
      const zoneSelected = context.zone;
      for (const r of ruleRows) {
        const zoneMatched = !zoneSelected || r.zone_code === zoneSelected;
        if (!zoneMatched) continue;

        if (topicFilter && !topicFilter.has(r.topic) && !topicFilter.has("general")) {
          continue;
        }

        // applies_if : si le tag dépend d'un contexte (ex. "abf"), on l'écarte
        // quand le contexte n'a pas le tag correspondant. Pour rester explicable,
        // on n'écarte JAMAIS une règle sans applies_if (cas le plus fréquent).
        const appliesIf = Array.isArray(r.applies_if) ? r.applies_if as string[] : [];
        if (appliesIf.length > 0) {
          if (appliesIf.includes("abf") && !context.presence_abf) continue;
        }

        const titre = formatRuleTitle(r);
        refs.push({
          id_regle: `rule:${r.rule_id}`,
          titre,
          type: "plu_rule",
          source: `PLU ${context.commune}`,
          zone: r.zone_code,
          commune: context.commune,
          texte: r.rule_text,
          page: null,
          url_document: null,
          conditions: buildConditionsList(r.conditions, r.exceptions, appliesIf),
          topic: r.topic,
          sub_theme: r.sub_theme,
          article_number: r.article_number ?? null,
          matched_by: {
            rule: zoneSelected ? "zone_match" : "fallback_commune",
            detail: zoneSelected
              ? `Zone ${zoneSelected} de la parcelle`
              : `Zone non résolue — règlement complet de ${context.commune}`,
          },
        });
      }
    }
  }

  // 2) Documents communaux validés (OAP, PPRI, PEB…).
  if (context.commune) {
    const [commune] = await db
      .select({ id: communes.id })
      .from(communes)
      .where(ilike(communes.name, context.commune))
      .limit(1);
    if (commune) {
      const docs = await db
        .select({
          id: regulatory_documents.id,
          type: regulatory_documents.type,
          name: regulatory_documents.name,
          synthese: regulatory_documents.synthese,
        })
        .from(regulatory_documents)
        .where(and(
          eq(regulatory_documents.commune_id, commune.id),
          eq(regulatory_documents.validation_status, "valide"),
        ));

      for (const d of docs) {
        const typeUpper = (d.type ?? "").toLowerCase();
        const isOap = typeUpper === "oap";
        // OAP : ne remontent que si l'analyse parcellaire a détecté qu'une OAP
        // concerne la parcelle (ou si on est en mode "tout afficher").
        if (isOap && context.oap_concernees.length === 0 && context.zone) continue;

        refs.push({
          id_regle: `doc:${d.id}`,
          titre: d.name,
          type: isOap ? "oap" : "commune_document",
          source: `${typeUpper.toUpperCase()} ${context.commune}`,
          zone: null,
          commune: context.commune,
          texte: d.synthese ?? "Synthèse non encore rédigée — ouvrir le document source.",
          page: null,
          url_document: `/api/mairie/commune-documents/${d.id}/file`,
          conditions: [],
          matched_by: {
            rule: "zone_match",
            detail: isOap ? "OAP concernée" : `Document communal ${typeUpper.toUpperCase()}`,
          },
        });
      }
    }
  }

  // 3) Servitudes détectées dans l'analyse parcellaire.
  for (const s of context.servitudes) {
    const upperMatch = s.match(/[A-Z]{1,3}\d/);
    const code = upperMatch ? upperMatch[0].toUpperCase() : null;
    const titre = libelleServitude(code, s);
    refs.push({
      id_regle: `servitude:${code ?? s.replace(/\s+/g, "_").toLowerCase()}`,
      titre,
      type: "servitude",
      source: "Servitude d'utilité publique",
      zone: null,
      commune: context.commune,
      texte: s,
      page: null,
      url_document: null,
      conditions: [],
      matched_by: {
        rule: "applies_if",
        detail: "Servitude détectée par l'analyse parcellaire",
      },
    });
  }

  // 4) ABF dédié — si présence ABF mais aucune SUP AC déjà listée.
  if (context.presence_abf && !refs.some((r) => r.id_regle.startsWith("servitude:AC"))) {
    refs.push({
      id_regle: "servitude:AC1",
      titre: "Servitude AC1 — Monuments historiques (ABF)",
      type: "servitude",
      source: "Servitude d'utilité publique",
      zone: null,
      commune: context.commune,
      texte: "Le projet est situé dans le périmètre de protection d'un monument historique. L'avis de l'Architecte des Bâtiments de France (ABF) est requis. Le délai d'instruction est prolongé d'un mois (art. R.423-24 b CU).",
      page: null,
      url_document: null,
      conditions: ["Projet en périmètre ABF (consultation obligatoire)"],
      matched_by: {
        rule: "applies_if",
        detail: "Présence ABF détectée",
      },
    });
  }

  // Tri stable : règles PLU par n° d'article puis sub_theme ; puis documents,
  // puis servitudes. Ordre fait sens pour l'instructeur qui descend du PLU
  // vers les SUP.
  refs.sort((a, b) => {
    const typeOrder = { plu_rule: 0, oap: 1, commune_document: 2, servitude: 3, code_urbanisme: 4 };
    const da = typeOrder[a.type] - typeOrder[b.type];
    if (da !== 0) return da;
    const an = a.article_number ?? 999;
    const bn = b.article_number ?? 999;
    if (an !== bn) return an - bn;
    return (a.sub_theme ?? "").localeCompare(b.sub_theme ?? "");
  });

  return { context, references: refs };
}

function formatRuleTitle(r: {
  zone_code: string;
  article_number: number | null;
  article_title: string | null;
  sub_theme: string | null;
  topic: string;
  summary: string | null;
}): string {
  const num = r.article_number != null ? `${r.zone_code}${r.article_number}` : r.zone_code;
  const base = r.article_title?.trim() || r.sub_theme?.trim() || topicLabel(r.topic);
  return `${num} — ${base}`;
}

function topicLabel(topic: string): string {
  const dict: Record<string, string> = {
    interdictions: "Interdictions",
    conditions: "Conditions",
    desserte_voies: "Desserte par les voies",
    desserte_reseaux: "Desserte par les réseaux",
    terrain_min: "Terrain minimum",
    recul_voie: "Implantation par rapport aux voies",
    recul_limite: "Implantation par rapport aux limites séparatives",
    recul_batiments: "Implantation des constructions entre elles",
    emprise_sol: "Emprise au sol",
    hauteur: "Hauteur",
    aspect: "Aspect extérieur",
    stationnement: "Stationnement",
    espaces_verts: "Espaces libres et plantations",
    cos: "COS",
    destinations: "Destinations",
    general: "Disposition générale",
  };
  return dict[topic] ?? topic;
}

function buildConditionsList(
  conditions: string | null,
  exceptions: string | null,
  appliesIf: string[],
): string[] {
  const list: string[] = [];
  if (conditions) list.push(`Conditions : ${conditions}`);
  if (exceptions) list.push(`Exceptions : ${exceptions}`);
  if (appliesIf.length > 0) list.push(`S'applique si : ${appliesIf.join(", ")}`);
  return list;
}

// ── Détail d'une référence ───────────────────────────────────────────────────

export async function getReferenceDetail(referenceId: string): Promise<DocumentationReference | null> {
  const [kind, id] = referenceId.split(":", 2);
  if (!kind || !id) return null;

  if (kind === "rule") {
    const [row] = await db
      .select({
        rule_id: zone_regulatory_rules.id,
        zone_code: zones.zone_code,
        commune_id: zones.commune_id,
        article_number: zone_regulatory_rules.article_number,
        article_title: zone_regulatory_rules.article_title,
        topic: zone_regulatory_rules.topic,
        sub_theme: zone_regulatory_rules.sub_theme,
        rule_text: zone_regulatory_rules.rule_text,
        summary: zone_regulatory_rules.summary,
        conditions: zone_regulatory_rules.conditions,
        exceptions: zone_regulatory_rules.exceptions,
        applies_if: zone_regulatory_rules.applies_if,
      })
      .from(zone_regulatory_rules)
      .innerJoin(zones, eq(zones.id, zone_regulatory_rules.zone_id))
      .where(eq(zone_regulatory_rules.id, id))
      .limit(1);
    if (!row) return null;
    // commune_id peut être NULL pour une zone de PLUi (portée intercommunale,
    // pas de commune unique). On ne résout le nom de commune que s'il existe.
    const [commune] = row.commune_id
      ? await db
          .select({ name: communes.name })
          .from(communes)
          .where(eq(communes.id, row.commune_id))
          .limit(1)
      : [];
    const appliesIf = Array.isArray(row.applies_if) ? row.applies_if as string[] : [];
    return {
      id_regle: `rule:${row.rule_id}`,
      titre: formatRuleTitle(row),
      type: "plu_rule",
      source: `PLU ${commune?.name ?? ""}`.trim() || "PLU",
      zone: row.zone_code,
      commune: commune?.name ?? null,
      texte: row.rule_text,
      page: null,
      url_document: null,
      conditions: buildConditionsList(row.conditions, row.exceptions, appliesIf),
      topic: row.topic,
      sub_theme: row.sub_theme,
      article_number: row.article_number ?? null,
      matched_by: { rule: "zone_match", detail: `Article ${row.article_number ?? ""} zone ${row.zone_code}` },
    };
  }

  if (kind === "doc") {
    const [row] = await db
      .select({
        id: regulatory_documents.id,
        type: regulatory_documents.type,
        name: regulatory_documents.name,
        synthese: regulatory_documents.synthese,
        commune_id: regulatory_documents.commune_id,
      })
      .from(regulatory_documents)
      .where(eq(regulatory_documents.id, id))
      .limit(1);
    if (!row) return null;
    const [commune] = await db
      .select({ name: communes.name })
      .from(communes)
      .where(eq(communes.id, row.commune_id))
      .limit(1);
    const isOap = (row.type ?? "").toLowerCase() === "oap";
    return {
      id_regle: `doc:${row.id}`,
      titre: row.name,
      type: isOap ? "oap" : "commune_document",
      source: `${(row.type ?? "").toUpperCase()} ${commune?.name ?? ""}`.trim(),
      zone: null,
      commune: commune?.name ?? null,
      texte: row.synthese ?? "Synthèse non encore rédigée — ouvrir le document source.",
      page: null,
      url_document: `/api/mairie/commune-documents/${row.id}/file`,
      conditions: [],
      matched_by: { rule: "zone_match", detail: isOap ? "OAP concernée" : "Document communal validé" },
    };
  }

  return null;
}

// ── Recherche plein-texte ────────────────────────────────────────────────────
//
// Recherche déterministe (SQL ILIKE) sur les références accessibles à
// l'instructeur. La recherche RAG (sémantique) reste exposée à part via
// /mairie/documents/search — on n'en mélange pas les sémantiques (juridique
// vs heuristique) dans le même endpoint.
export async function searchReferences(
  inseeCode: string,
  query: string,
): Promise<DocumentationReference[]> {
  const cleaned = query.trim();
  if (cleaned.length < 2) return [];

  const [commune] = await db
    .select({ id: communes.id, name: communes.name })
    .from(communes)
    .where(eq(communes.insee_code, inseeCode))
    .limit(1);
  if (!commune) return [];

  const pattern = `%${cleaned}%`;
  const ruleRows = await db
    .select({
      rule_id: zone_regulatory_rules.id,
      zone_code: zones.zone_code,
      article_number: zone_regulatory_rules.article_number,
      article_title: zone_regulatory_rules.article_title,
      topic: zone_regulatory_rules.topic,
      sub_theme: zone_regulatory_rules.sub_theme,
      rule_text: zone_regulatory_rules.rule_text,
      summary: zone_regulatory_rules.summary,
      conditions: zone_regulatory_rules.conditions,
      exceptions: zone_regulatory_rules.exceptions,
      applies_if: zone_regulatory_rules.applies_if,
    })
    .from(zone_regulatory_rules)
    .innerJoin(zones, eq(zones.id, zone_regulatory_rules.zone_id))
    .where(and(
      eq(zones.commune_id, commune.id),
      eq(zone_regulatory_rules.validation_status, "valide"),
      or(
        ilike(zone_regulatory_rules.rule_text, pattern),
        ilike(zone_regulatory_rules.summary, pattern),
        ilike(zone_regulatory_rules.article_title, pattern),
        ilike(zone_regulatory_rules.sub_theme, pattern),
      ),
    ))
    .limit(20);

  const docRows = await db
    .select({
      id: regulatory_documents.id,
      type: regulatory_documents.type,
      name: regulatory_documents.name,
      synthese: regulatory_documents.synthese,
    })
    .from(regulatory_documents)
    .where(and(
      eq(regulatory_documents.commune_id, commune.id),
      eq(regulatory_documents.validation_status, "valide"),
      or(
        ilike(regulatory_documents.name, pattern),
        ilike(regulatory_documents.synthese, pattern),
      ),
    ))
    .limit(10);

  const out: DocumentationReference[] = [];
  for (const r of ruleRows) {
    const appliesIf = Array.isArray(r.applies_if) ? r.applies_if as string[] : [];
    out.push({
      id_regle: `rule:${r.rule_id}`,
      titre: formatRuleTitle(r),
      type: "plu_rule",
      source: `PLU ${commune.name}`,
      zone: r.zone_code,
      commune: commune.name,
      texte: r.rule_text,
      page: null,
      url_document: null,
      conditions: buildConditionsList(r.conditions, r.exceptions, appliesIf),
      topic: r.topic,
      sub_theme: r.sub_theme,
      article_number: r.article_number ?? null,
      matched_by: { rule: "zone_match", detail: `Recherche « ${cleaned} »` },
    });
  }
  for (const d of docRows) {
    const typeUpper = (d.type ?? "").toUpperCase();
    out.push({
      id_regle: `doc:${d.id}`,
      titre: d.name,
      type: (d.type ?? "").toLowerCase() === "oap" ? "oap" : "commune_document",
      source: `${typeUpper} ${commune.name}`,
      zone: null,
      commune: commune.name,
      texte: d.synthese ?? "",
      page: null,
      url_document: `/api/mairie/commune-documents/${d.id}/file`,
      conditions: [],
      matched_by: { rule: "zone_match", detail: `Recherche « ${cleaned} »` },
    });
  }
  return out;
}

// ── Favoris ──────────────────────────────────────────────────────────────────

export interface DocumentationFavori {
  id: string;
  reference_id: string;
  reference_type: string;
  titre: string;
  source: string | null;
  created_at: Date;
}

export async function listFavoris(dossierId: string, userId: string): Promise<DocumentationFavori[]> {
  const rows = await db
    .select({
      id: documentation_favoris.id,
      reference_id: documentation_favoris.reference_id,
      reference_type: documentation_favoris.reference_type,
      titre: documentation_favoris.titre,
      source: documentation_favoris.source,
      created_at: documentation_favoris.created_at,
    })
    .from(documentation_favoris)
    .where(and(
      eq(documentation_favoris.dossier_id, dossierId),
      eq(documentation_favoris.user_id, userId),
    ));
  return rows;
}

export async function addFavori(params: {
  dossierId: string;
  userId: string;
  referenceId: string;
  referenceType: string;
  titre: string;
  source: string | null;
}): Promise<DocumentationFavori> {
  // On utilise ON CONFLICT DO NOTHING via la contrainte unique (dossier, user,
  // reference) puis on relit l'enregistrement — l'idempotence évite à l'UI
  // d'avoir à se soucier d'un double clic.
  await db
    .insert(documentation_favoris)
    .values({
      dossier_id: params.dossierId,
      user_id: params.userId,
      reference_id: params.referenceId,
      reference_type: params.referenceType,
      titre: params.titre,
      source: params.source,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(documentation_favoris)
    .where(and(
      eq(documentation_favoris.dossier_id, params.dossierId),
      eq(documentation_favoris.user_id, params.userId),
      eq(documentation_favoris.reference_id, params.referenceId),
    ))
    .limit(1);
  return row!;
}

export async function removeFavori(params: {
  dossierId: string;
  userId: string;
  referenceId: string;
}): Promise<void> {
  await db
    .delete(documentation_favoris)
    .where(and(
      eq(documentation_favoris.dossier_id, params.dossierId),
      eq(documentation_favoris.user_id, params.userId),
      eq(documentation_favoris.reference_id, params.referenceId),
    ));
}

