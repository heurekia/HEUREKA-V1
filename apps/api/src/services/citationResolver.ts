/**
 * Résolveur de citation officielle.
 *
 * Problème : un finding déterministe sait quelle RÈGLE l'a produit et porte
 * son verbatim (`source_quote`), mais le segment structurel gravé à
 * l'extraction n'est PAS fiable pour pointer un endroit du PDF officiel :
 *   - le chemin d'extraction dominant (Pixtral page par page) ne le renseigne
 *     pas du tout ;
 *   - l'index RAG de production ne contient que des *chunks* (id
 *     "{docId}_CHUNK_n", avec page), pas les segments structurels ;
 *   - les segments structurels n'ont pas de page fiable.
 *
 * Solution : on retrouve le passage dans l'index RAG par recherche sémantique
 * du verbatim de la règle, puis on VALIDE que le verbatim s'y retrouve bien
 * (même garde-fou que ruleVerdicts : pas de citation fabriquée). On en tire un
 * SourceRef "document_segment" FIABLE : type de document matchable par le
 * viewer, page réelle, extrait vérifié. Si rien ne matche verbatim → on ne
 * fabrique aucun lien (le verbatim reste affiché en texte).
 */
import { db } from "../db.js";
import { communes, regulatory_documents, regulatory_findings, zone_regulatory_rules, dossiers } from "@heureka-v1/db";
import { eq, ilike } from "drizzle-orm";
import { searchInCommune } from "./ragService.js";
import type { SearchHit } from "@heureka-v1/ingestion/rag";

export interface ResolvedCitation {
  /** Id du chunk RAG d'origine (résolvable dans l'index de production). */
  segment_id: string;
  /** Type matché par le viewer (= regulatory_documents.type : "plu", "ppri"…). */
  doc_type: string;
  /** Page réelle (1-based) issue du chunk RAG. */
  page: number | null;
  /** Extrait verbatim validé (texte du chunk, tronqué pour l'affichage). */
  quote: string;
  document_id: string | null;
  document_name: string | null;
}

// ── Helpers purs (testables sans DB ni réseau) ──────────────────────────────

// Longueur minimale d'un verbatim pour être discriminant. En dessous, un
// "match" par inclusion serait du bruit (ex: "3 m" présent partout).
const MIN_QUOTE_LEN = 12;

export function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Le verbatim de la règle se retrouve-t-il dans le texte du passage ?
 * Tolérance bidirectionnelle (la règle peut être un extrait du chunk, ou le
 * chunk un extrait de la règle), insensible casse/espaces. Même esprit que la
 * validation de citation de ruleVerdicts.
 */
export function quoteFoundIn(quote: string, text: string): boolean {
  const q = normalizeForMatch(quote);
  const t = normalizeForMatch(text);
  if (q.length < MIN_QUOTE_LEN || t.length < MIN_QUOTE_LEN) return false;
  return t.includes(q) || q.includes(t);
}

/**
 * Type de document que le viewer sait matcher : il compare à
 * regulatory_documents.type ("plu", "plui", "ppri"…). Les chunks RAG portent
 * un doc_type plus fin ("plu_reglement") → on retient le préfixe avant "_".
 * Sert de repli quand le document officiel n'est pas rapprochable.
 */
export function docTypeForViewer(chunkDocType: string): string {
  const lower = (chunkDocType ?? "").toLowerCase();
  return lower.split("_")[0] || lower;
}

/**
 * Premier passage (le plus proche — les hits sont triés par distance) dont le
 * texte contient le verbatim de la règle. null si aucun ne matche → on ne
 * fabrique pas de lien.
 */
export function pickBestHit(quote: string, hits: SearchHit[]): SearchHit | null {
  for (const h of hits) {
    if (quoteFoundIn(quote, h.text)) return h;
  }
  return null;
}

/** Tronque un passage pour l'affichage en tooltip. */
function truncateQuote(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ── Résolution (IO : RAG + lookup document) ─────────────────────────────────

export interface ResolvableRule {
  rule_id: string;
  /** Verbatim de la règle (source_quote, à défaut rule_text). */
  quote: string;
}

export interface ResolveTracking {
  dossierId?: string | null;
  communeId?: string | null;
  userId?: string | null;
}

/**
 * Résout les citations officielles d'un lot de règles, scopé à une commune.
 * Renvoie une map rule_id → citation pour les seules règles dont le verbatim a
 * été retrouvé ET validé dans l'index RAG. Best-effort : une règle non
 * résolue est simplement absente de la map (pas d'erreur, pas de lien mort).
 */
export async function resolveCitationsForRules(
  rules: ResolvableRule[],
  insee: string,
  tracking?: ResolveTracking,
): Promise<Map<string, ResolvedCitation>> {
  const out = new Map<string, ResolvedCitation>();
  // Cache des documents officiels (source_id → type/name) pour éviter de
  // re-requêter le même PLU à chaque règle.
  const docCache = new Map<string, { type: string; name: string | null } | null>();

  for (const r of rules) {
    const quote = (r.quote ?? "").trim();
    if (quote.length < MIN_QUOTE_LEN) continue;

    let hits: SearchHit[] = [];
    try {
      hits = await searchInCommune({
        query: quote,
        insee,
        top_k: 5,
        tracking: { purpose: "rag_citation_resolve", ...tracking },
      });
    } catch {
      // RAG indisponible → on dégrade (pas de lien pour cette règle).
      continue;
    }

    const hit = pickBestHit(quote, hits);
    if (!hit) continue;

    let docType = docTypeForViewer(hit.doc_type);
    let documentId: string | null = null;
    let documentName: string | null = null;

    // Le chunk RAG porte l'id du regulatory_document dans source_id : on en
    // tire le type EXACT (matchable par le viewer) et le nom officiel.
    const srcId = hit.source_id;
    if (srcId) {
      let doc = docCache.get(srcId);
      if (doc === undefined) {
        const [d] = await db
          .select({ type: regulatory_documents.type, name: regulatory_documents.name })
          .from(regulatory_documents)
          .where(eq(regulatory_documents.id, srcId))
          .limit(1);
        doc = d ? { type: (d.type ?? docType).toLowerCase(), name: d.name } : null;
        docCache.set(srcId, doc);
      }
      if (doc) {
        docType = doc.type;
        documentId = srcId;
        documentName = doc.name;
      }
    }

    out.set(r.rule_id, {
      segment_id: hit.segment_id,
      doc_type: docType,
      page: hit.page,
      quote: truncateQuote(hit.text),
      document_id: documentId,
      document_name: documentName,
    });
  }

  return out;
}

/** Résout l'INSEE d'une commune par son nom (même approche que le reste du code). */
export async function resolveInseeByCommuneName(name: string | null | undefined): Promise<string | null> {
  if (!name?.trim()) return null;
  const [comm] = await db
    .select({ insee: communes.insee_code })
    .from(communes)
    .where(ilike(communes.name, name))
    .limit(1);
  return comm?.insee ?? null;
}

// ── Enrichissement des findings d'une analyse ───────────────────────────────

type Ref = { type?: string; [k: string]: unknown };

function asRefs(v: unknown): Ref[] {
  return Array.isArray(v) ? (v as Ref[]) : [];
}

/**
 * Remplace l'éventuel renvoi "document_segment" (souvent le segment structurel
 * non fiable posé par l'évaluateur) par la citation résolue, en conservant les
 * autres sources (zone_rule, legal_article…). Ajoute le renvoi s'il n'y en
 * avait pas.
 */
function applyResolvedRef(refs: Ref[], resolved: ResolvedCitation): Ref[] {
  const docRef: Ref = {
    type: "document_segment",
    segment_id: resolved.segment_id,
    doc_type: resolved.doc_type,
    ...(resolved.page != null ? { page: resolved.page } : {}),
    quote: resolved.quote,
  };
  const others = refs.filter((r) => r.type !== "document_segment");
  return [...others, docRef];
}

/**
 * Enrichit les findings d'une analyse avec une citation officielle FIABLE.
 * Best-effort : si la commune n'est pas résolue ou si le RAG est indisponible,
 * on ne touche à rien (les findings gardent leur verbatim affiché en texte).
 * Renvoie le nombre de findings enrichis.
 */
export async function enrichAnalysisCitations(
  analysisId: string,
  dossierId: string,
  tracking?: ResolveTracking,
): Promise<number> {
  const [d] = await db
    .select({ commune: dossiers.commune })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);
  const insee = await resolveInseeByCommuneName(d?.commune ?? null);
  if (!insee) return 0;

  const findings = await db
    .select({
      id: regulatory_findings.id,
      legal_basis: regulatory_findings.legal_basis,
      source_refs: regulatory_findings.source_refs,
      rule_id: regulatory_findings.rule_id,
      quote: zone_regulatory_rules.source_quote,
      rule_text: zone_regulatory_rules.rule_text,
    })
    .from(regulatory_findings)
    .leftJoin(zone_regulatory_rules, eq(zone_regulatory_rules.id, regulatory_findings.rule_id))
    .where(eq(regulatory_findings.analysis_id, analysisId));

  // Dédoublonnage par règle : plusieurs findings peuvent partager une règle.
  const byRule = new Map<string, string>();
  for (const f of findings) {
    if (f.rule_id && !byRule.has(f.rule_id)) {
      byRule.set(f.rule_id, (f.quote || f.rule_text || "").trim());
    }
  }
  const resolvable = [...byRule.entries()].map(([rule_id, quote]) => ({ rule_id, quote }));
  if (resolvable.length === 0) return 0;

  const resolved = await resolveCitationsForRules(resolvable, insee, tracking);
  if (resolved.size === 0) return 0;

  let updated = 0;
  for (const f of findings) {
    if (!f.rule_id) continue;
    const citation = resolved.get(f.rule_id);
    if (!citation) continue;
    await db
      .update(regulatory_findings)
      .set({
        legal_basis: applyResolvedRef(asRefs(f.legal_basis), citation),
        source_refs: applyResolvedRef(asRefs(f.source_refs), citation),
        updated_at: new Date(),
      })
      .where(eq(regulatory_findings.id, f.id));
    updated++;
  }
  return updated;
}
