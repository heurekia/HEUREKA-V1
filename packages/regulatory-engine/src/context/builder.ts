import { db, dossiers, dossier_facts, zone_regulatory_rules, zones, communes, document_communes, regulatory_documents } from "@heureka-v1/db";
import { and, eq, isNull } from "drizzle-orm";
import { ENGINE_VERSION } from "../version.js";
import { deriveApplicabilityTags } from "./applicability_tags.js";
import { selectActiveDocumentIds, type CandidateDocument } from "./documentSelection.js";
import type {
  DossierFact,
  DossierSummary,
  FactSource,
  InstructionContext,
  ParcelleContext,
  ProjectContext,
} from "./types.js";

// Clés de faits minimales attendues pour pouvoir lancer une analyse utile.
// L'absence d'une de ces clés n'empêche pas la construction du contexte —
// elle est remontée dans `missing_facts` pour pilotage par l'instructeur.
// Cette liste évoluera : on commence volontairement minimaliste.
const REQUIRED_FACT_KEYS = [
  "destination_apres",
  "surface_plancher_apres",
  "hauteur",
  "emprise",
  "nature_travaux",
] as const;

export class ContextBuildError extends Error {
  constructor(message: string, readonly code: "dossier_not_found" | "invalid_input") {
    super(message);
    this.name = "ContextBuildError";
  }
}

export interface BuildContextOptions {
  // Si true, on retourne un contexte même si le dossier n'a pas de commune
  // résolue. Utile en mode 'shadow' au dépôt, où la commune est encore en
  // cours d'enrichissement.
  allowMissingCommune?: boolean;
}

// Charge un InstructionContext à partir d'un identifiant de dossier.
// Aucun appel IA, aucune écriture. Le builder est volontairement
// déterministe : à faits identiques, contexte identique.
export async function buildInstructionContext(
  dossierId: string,
  opts: BuildContextOptions = {},
): Promise<InstructionContext> {
  if (!dossierId) {
    throw new ContextBuildError("dossierId is required", "invalid_input");
  }

  const dossierRows = await db.select().from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
  const dossierRow = dossierRows[0];
  if (!dossierRow) {
    throw new ContextBuildError(`dossier ${dossierId} not found`, "dossier_not_found");
  }

  // Faits actifs GAGNANTS uniquement (superseded_at IS NULL AND is_winner).
  // Phase 1 : la table peut désormais contenir des candidats non-gagnants
  // pour alimenter le moteur de contradictions. Le moteur réglementaire ne
  // doit voir qu'un fait par clé pour garder ses verdicts déterministes.
  const factRows = await db
    .select()
    .from(dossier_facts)
    .where(and(
      eq(dossier_facts.dossier_id, dossierId),
      isNull(dossier_facts.superseded_at),
      eq(dossier_facts.is_winner, true),
    ));

  const facts: DossierFact[] = factRows.map((r) => ({
    key: r.key,
    value: r.value,
    unit: r.unit ?? undefined,
    source: r.source as FactSource,
    source_ref: (r.source_ref ?? undefined) as Record<string, unknown> | undefined,
    confidence: r.confidence ?? undefined,
    validated_by: r.validated_by ?? undefined,
    validated_at: r.validated_at?.toISOString(),
  }));

  const factByKey = new Map(facts.map((f) => [f.key, f]));

  const dossier: DossierSummary = {
    id: dossierRow.id,
    numero: dossierRow.numero,
    type: dossierRow.type,
    status: dossierRow.status,
    commune: dossierRow.commune ?? undefined,
    code_postal: dossierRow.code_postal ?? undefined,
    parcelle: dossierRow.parcelle ?? undefined,
    adresse: dossierRow.adresse ?? undefined,
    description: dossierRow.description ?? undefined,
    date_depot: dossierRow.date_depot?.toISOString(),
    date_completude: dossierRow.date_completude?.toISOString(),
    ai_consent: dossierRow.ai_consent,
  };

  // Pour l'instant, la couche parcelle est dérivée uniquement des faits
  // explicites. Les enrichissements GPU / documents commune arriveront
  // dans une itération suivante (palier 2).
  const parcelle: ParcelleContext = {
    parcelle_ref: dossier.parcelle,
    zonage_plu: asStringArray(factByKey.get("zonage_plu")?.value),
    secteurs: asStringArray(factByKey.get("secteurs")?.value),
    risques: asStringArray(factByKey.get("risques")?.value),
    servitudes: asStringArray(factByKey.get("servitudes")?.value),
    abf: asBoolean(factByKey.get("secteur_abf")?.value),
    oap: asStringArray(factByKey.get("oap")?.value),
  };

  const projet: ProjectContext = {
    nature_travaux: asStringArray(factByKey.get("nature_travaux")?.value),
    destination_avant: asString(factByKey.get("destination_avant")?.value),
    destination_apres: asString(factByKey.get("destination_apres")?.value),
    surface_creee: asNumber(factByKey.get("surface_creee")?.value),
    surface_plancher_apres: asNumber(factByKey.get("surface_plancher_apres")?.value),
    hauteur: asNumber(factByKey.get("hauteur")?.value),
    emprise: asNumber(factByKey.get("emprise")?.value),
    stationnement: asNumber(factByKey.get("stationnement")?.value),
    demolition: asBoolean(factByKey.get("demolition")?.value),
    extension: asBoolean(factByKey.get("extension")?.value),
    surelevation: asBoolean(factByKey.get("surelevation")?.value),
    annexe: asBoolean(factByKey.get("annexe")?.value),
    cloture: asBoolean(factByKey.get("cloture")?.value),
  };

  const applicability_tags = deriveApplicabilityTags(parcelle, projet);

  // Candidats : règles validées de la commune du dossier, filtrées plus
  // tard sur la zone par le RuleApplicabilityEngine. On reste large à ce
  // stade pour pouvoir afficher dans l'UI ce qui *aurait pu* s'appliquer.
  // Date de référence pour l'arbitrage de substitution PLU↔PLUi (Lot 5) : la
  // date de dépôt fait foi (cristallisation des droits d'urbanisme), à défaut
  // « maintenant ». Déterministe dès que date_depot est renseignée.
  const referenceDate = dossierRow.date_depot ?? new Date();
  const candidate_rule_ids = await loadCandidateRuleIds(dossier.commune, opts, referenceDate);

  const missing_facts = REQUIRED_FACT_KEYS.filter((k) => !factByKey.has(k));

  return {
    dossier,
    parcelle,
    projet,
    facts,
    applicability_tags,
    candidate_rule_ids,
    missing_facts,
    built_at: new Date().toISOString(),
    engine_version: ENGINE_VERSION,
  };
}

async function loadCandidateRuleIds(
  commune: string | undefined,
  opts: BuildContextOptions,
  referenceDate: Date,
): Promise<string[]> {
  if (!commune) {
    if (opts.allowMissingCommune) return [];
    return [];
  }
  // Résoudre la commune par nom — best effort. Une fois `commune_insee`
  // peuplé sur tous les dossiers, on pourra basculer sur INSEE.
  const communeRows = await db.select({ id: communes.id })
    .from(communes)
    .where(eq(communes.name, commune))
    .limit(1);
  const communeRow = communeRows[0];
  if (!communeRow) return [];

  // Résolution via deux chemins unionnés, pour supporter les PLUi sans casser
  // les règles existantes :
  //
  //  1) document_communes → rules.source_document_id : voie « moderne ». Couvre
  //     nativement les PLUi (1 document → N communes via document_communes)
  //     et reste équivalente aux PLU strictement communaux (1 document →
  //     1 commune). Toute règle ingérée par loadRules() depuis le Lot 3
  //     passe par ce chemin. C'est ce chemin qui porte l'ARBITRAGE de
  //     substitution (Lot 5, cf. plus bas).
  //
  //  2) zones.commune_id, restreint à source_document_id IS NULL : fallback
  //     pour les règles créées manuellement via POST /reglementation/zones/
  //     :zoneId/rules qui ne posent pas de source_document_id. Garantit qu'on
  //     ne perd aucune règle pré-Lot 3 ou créée à la main. Hors périmètre de
  //     l'arbitrage (pas de document, donc pas de famille) : toujours gardées.
  const ruleIds = new Set<string>();

  // Chemin 1 : on récupère les règles AVEC les métadonnées de leur document
  // source (type + fenêtre d'effet), pour arbitrer la substitution PLU↔PLUi.
  const fromDocument = await db
    .select({
      id: zone_regulatory_rules.id,
      document_id: zone_regulatory_rules.source_document_id,
      doc_type: regulatory_documents.type,
      effective_from: regulatory_documents.effective_from,
      effective_to: regulatory_documents.effective_to,
      created_at: regulatory_documents.created_at,
    })
    .from(zone_regulatory_rules)
    .innerJoin(
      document_communes,
      eq(document_communes.document_id, zone_regulatory_rules.source_document_id),
    )
    .innerJoin(
      regulatory_documents,
      eq(regulatory_documents.id, zone_regulatory_rules.source_document_id),
    )
    .where(and(
      eq(document_communes.commune_id, communeRow.id),
      eq(zone_regulatory_rules.validation_status, "valide"),
    ));

  // Arbitrage substitution (Lot 5) : parmi les documents de famille PLU
  // couvrant cette commune, on ne garde que celui en vigueur à `referenceDate` ;
  // les autres familles (PPRI, OAP…) se superposent normalement.
  const docsById = new Map<string, CandidateDocument>();
  for (const r of fromDocument) {
    if (r.document_id && !docsById.has(r.document_id)) {
      docsById.set(r.document_id, {
        documentId: r.document_id,
        type: r.doc_type,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        createdAt: r.created_at,
      });
    }
  }
  const allowedDocIds = selectActiveDocumentIds([...docsById.values()], referenceDate);
  for (const r of fromDocument) {
    if (r.document_id && allowedDocIds.has(r.document_id)) ruleIds.add(r.id);
  }

  const fromZoneFallback = await db
    .select({ id: zone_regulatory_rules.id })
    .from(zone_regulatory_rules)
    .innerJoin(zones, eq(zones.id, zone_regulatory_rules.zone_id))
    .where(and(
      eq(zones.commune_id, communeRow.id),
      eq(zone_regulatory_rules.validation_status, "valide"),
      isNull(zone_regulatory_rules.source_document_id),
    ));
  for (const r of fromZoneFallback) ruleIds.add(r.id);

  return Array.from(ruleIds);
}

// ── Coercions défensives ──
// Les faits sont en JSONB : on ne fait confiance à rien sans vérifier.
function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
function asBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length === v.length ? out : undefined;
}
