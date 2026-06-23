// Éclatement d'un dépôt groupé : un seul fichier (PDF) déposé par l'agent est
// segmenté en plusieurs pièces réglementaires (CERFA, plan de masse, façades…).
//
// Deux étapes, volontairement découplées pour laisser la main à l'instructeur :
//   1. segmentBundle()      — propose un découpage (NE crée AUCUNE pièce).
//   2. applySegmentation()  — applique le découpage validé : découpe le PDF
//                             (pdf-lib), crée les pièces et les renvoie dans le
//                             pipeline OCR existant (queuePieceOcr).
//
// Le flux historique « 1 fichier = 1 pièce » (POST /pieces/upload) n'est pas
// touché : ce module est appelé uniquement par les routes /pieces/upload-bundle
// et /pieces/bundles/:id/apply.

import crypto from "crypto";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { db } from "../db.js";
import { dossier_pieces_jointes, dossier_piece_bundles } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import { callAi, convertPdfPagesToPng, extractPdfText } from "./aiUsage.js";
import {
  type PieceType,
  codeFromType,
  defaultPieceName,
} from "./pieceExtractor.js";
import { getStorageProvider } from "./storage.js";
import { queuePieceOcr } from "./pieceOcrQueue.js";

// ── Réglages ────────────────────────────────────────────────────────────────
const REVIEW_THRESHOLD = 0.7;     // sous ce score, le segment est marqué « à vérifier »
const MIN_CODE_CONFIDENCE = 0.35; // sous ce score, la page bascule en « autre »
const VISION_DPI = 100;           // basse résolution = passe de classification éco
const VISION_BATCH = 6;           // pages par appel vision (borne la taille du payload)
const MAX_PAGES = 60;             // au-delà, on ne segmente pas page à page (filet)

const VALID_TYPES: PieceType[] = [
  "cerfa", "plan_situation", "plan_masse", "plan_coupe",
  "plan_facade", "notice", "photo", "insertion", "autre",
];

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ProposedSegment {
  /** Code d'emplacement proposé (PCMI2 / PC2 / CERFA…) ou null si à classer. */
  code: string | null;
  type: PieceType;
  /** Pages du PDF source (1-indexé). Peut chevaucher un autre segment. */
  pages: number[];
  /** Nom normalisé proposé. */
  nom: string;
  /** Confiance moyenne 0..1. */
  confidence: number;
  /** Au moins une page est partagée avec une autre pièce (ex. PCMI2 + PCMI5). */
  shared: boolean;
  /** À soumettre explicitement à l'instructeur (faible confiance / ambigu). */
  needs_review: boolean;
}

export interface SegmentationResult {
  page_count: number;
  method: "text" | "vision" | "fallback";
  segments: ProposedSegment[];
}

interface PageClassification {
  page: number;          // 1-indexé
  types: PieceType[];    // 1 normalement, 2 si page partagée
  confidence: number;    // 0..1
  title: string;
}

interface Trace {
  dossierId?: string | null;
  communeId?: string | null;
  userId?: string | null;
}

// ── Prompt de classification ──────────────────────────────────────────────────
const SEGMENT_SYSTEM = `Tu es un agent d'instruction d'urbanisme expérimenté. On te transmet, page par page, le contenu d'un dossier déposé en UN SEUL fichier (CERFA + pièces type PCMI/PC/DP). Pour CHAQUE page, identifie à quelle(s) pièce(s) réglementaire(s) elle appartient.

Types possibles (et UNIQUEMENT ceux-là) :
- "cerfa" : formulaire CERFA de demande
- "plan_situation" : plan de situation du terrain
- "plan_masse" : plan de masse
- "plan_coupe" : plan en coupe du terrain / de la construction
- "plan_facade" : plan des façades et toitures
- "notice" : notice décrivant le terrain et le projet
- "photo" : photographie (environnement proche ou lointain)
- "insertion" : document graphique d'insertion (vue 3D, photomontage)
- "autre" : non reconnu / page de garde / pièce hors nomenclature

Règles :
- Une page peut appartenir à DEUX pièces si la planche le précise (ex. une même planche A3 porte le plan de masse ET les façades → "types": ["plan_masse","plan_facade"]).
- Les pièces s'étendent souvent sur plusieurs pages consécutives (ex. une notice de 6 pages).
- N'INVENTE RIEN : si tu n'es pas sûr, mets "autre" avec une confiance basse.
- "confidence" reflète ta certitude (0 = aucune, 1 = certaine).

Réponds en JSON STRICT, sans texte autour :
{ "pages": [ { "page": 1, "types": ["cerfa"], "confidence": 0.95, "title": "courte étiquette" } ] }`;

// ── Parsing robuste de la réponse LLM ────────────────────────────────────────
function normalizeTypes(v: unknown): PieceType[] {
  const arr = Array.isArray(v) ? v : (typeof v === "string" ? [v] : []);
  const out: PieceType[] = [];
  for (const x of arr) {
    const t = String(x).toLowerCase().trim();
    if ((VALID_TYPES as string[]).includes(t) && !out.includes(t as PieceType)) {
      out.push(t as PieceType);
    }
  }
  return out.length ? out : ["autre"];
}

function clamp01(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

function parsePageClassifications(text: string, pageOffset: number): PageClassification[] {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    // Tolérance : extraire le premier objet JSON d'un éventuel emballage.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { obj = JSON.parse(m[0]); } catch { return []; }
  }
  const pages = (obj as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return [];
  const out: PageClassification[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i] as Record<string, unknown>;
    // Numéro de page : on fait confiance à l'index d'ordre + offset du lot,
    // pour ne pas dépendre d'un numéro halluciné par le modèle.
    const page = pageOffset + i + 1;
    out.push({
      page,
      types: normalizeTypes(p.types ?? p.type),
      confidence: clamp01(p.confidence),
      title: typeof p.title === "string" ? p.title.slice(0, 120) : "",
    });
  }
  return out;
}

// ── Classification par le texte (gratuit quand le PDF a une couche texte) ────
async function classifyByText(
  pageTexts: string[],
  dossierType: string | null,
  trace: Trace,
): Promise<PageClassification[]> {
  const blocks = pageTexts
    .map((t, i) => `--- PAGE ${i + 1} ---\n${(t || "").slice(0, 700).trim() || "(page sans texte)"}`)
    .join("\n\n");
  const msg = await callAi(
    { purpose: "bundle_segment", dossierId: trace.dossierId, communeId: trace.communeId, userId: trace.userId },
    {
      model: "ai-smart",
      max_tokens: Math.min(4000, 400 + pageTexts.length * 60),
      system: SEGMENT_SYSTEM,
      messages: [{
        role: "user",
        content: `Dossier de type : ${dossierType ?? "inconnu"}. Voici le contenu page par page :\n\n${blocks}`,
      }],
    },
  );
  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  return parsePageClassifications(text, 0);
}

// ── Classification par la vision (PDF scanné sans couche texte) ──────────────
async function classifyByVision(
  buffer: Buffer,
  pageCount: number,
  dossierType: string | null,
  trace: Trace,
): Promise<PageClassification[]> {
  const total = Math.min(pageCount, MAX_PAGES);
  const all: PageClassification[] = [];
  for (let start = 0; start < total; start += VISION_BATCH) {
    const firstPage = start + 1;
    const count = Math.min(VISION_BATCH, total - start);
    let pngs: Buffer[];
    try {
      pngs = convertPdfPagesToPng(buffer, { firstPage, maxPages: count, dpi: VISION_DPI });
    } catch (err) {
      console.warn("[pieceSegmenter] convertPdfPagesToPng a échoué:", err instanceof Error ? err.message : err);
      break;
    }
    const content: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }> = [
      { type: "text", text: `Voici ${pngs.length} page(s), dans l'ordre (ce sont les pages ${firstPage} à ${firstPage + pngs.length - 1} du dossier). Classe-les en respectant cet ordre.` },
    ];
    for (const png of pngs) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
    }
    const msg = await callAi(
      { purpose: "bundle_segment", dossierId: trace.dossierId, communeId: trace.communeId, userId: trace.userId },
      {
        model: "ai-smart",
        max_tokens: 400 + count * 80,
        system: SEGMENT_SYSTEM,
        messages: [{ role: "user", content }],
      },
    );
    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    all.push(...parsePageClassifications(text, start));
  }
  // Filet : pages au-delà du plafond → « autre » à vérifier.
  for (let p = total + 1; p <= pageCount; p++) {
    all.push({ page: p, types: ["autre"], confidence: 0.2, title: "" });
  }
  return all;
}

// ── Regroupement déterministe : pages classées → segments (1 par code) ───────
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function groupSegments(perPage: PageClassification[], dossierType: string | null): ProposedSegment[] {
  // Pages portant >1 type = pages partagées (planche multi-pièces).
  const sharedPages = new Set<number>();
  for (const pc of perPage) if (pc.types.filter((t) => t !== "autre").length > 1) sharedPages.add(pc.page);

  const byType = new Map<PieceType, number[]>();
  const autre: PageClassification[] = [];
  for (const pc of perPage) {
    const known = pc.types.filter((t) => t !== "autre");
    if (known.length === 0 || pc.confidence < MIN_CODE_CONFIDENCE) {
      autre.push(pc);
      continue;
    }
    for (const t of known) {
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(pc.page);
    }
  }

  const confByPage = new Map<number, number>();
  for (const pc of perPage) confByPage.set(pc.page, pc.confidence);

  const segments: ProposedSegment[] = [];
  for (const [type, pages] of byType) {
    const uniq = [...new Set(pages)].sort((a, b) => a - b);
    const confs = uniq.map((p) => confByPage.get(p) ?? 0.5);
    const avg = confs.reduce((a, b) => a + b, 0) / confs.length;
    const shared = uniq.some((p) => sharedPages.has(p));
    const code = codeFromType(type, dossierType);
    segments.push({
      code,
      type,
      pages: uniq,
      nom: defaultPieceName(code, type, uniq),
      confidence: round2(avg),
      shared,
      // photo : code proche/lointaine ambigu → toujours à confirmer.
      needs_review: avg < REVIEW_THRESHOLD || shared || type === "photo" || code === null,
    });
  }

  // Pages « autre » : une pièce par page, à reclasser manuellement.
  for (const pc of autre) {
    segments.push({
      code: null,
      type: "autre",
      pages: [pc.page],
      nom: defaultPieceName(null, "autre", [pc.page]),
      confidence: round2(pc.confidence),
      shared: sharedPages.has(pc.page),
      needs_review: true,
    });
  }

  segments.sort((a, b) => (a.pages[0] ?? 0) - (b.pages[0] ?? 0));
  return segments;
}

function fallbackSingleSegment(pageCount: number): ProposedSegment {
  const pages = Array.from({ length: Math.max(1, pageCount) }, (_, i) => i + 1);
  return {
    code: null,
    type: "autre",
    pages,
    nom: defaultPieceName(null, "autre", pages),
    confidence: 0.2,
    shared: false,
    needs_review: true,
  };
}

// ── Étape 1 : proposer un découpage ──────────────────────────────────────────
export async function segmentBundle(
  buffer: Buffer,
  mimeType: string,
  dossierType: string | null,
  trace: Trace,
): Promise<SegmentationResult> {
  // Image seule (non PDF) : pas de découpage possible → une pièce unique.
  if (!/pdf/i.test(mimeType)) {
    return { page_count: 1, method: "fallback", segments: [fallbackSingleSegment(1)] };
  }

  let pageCount = 0;
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    pageCount = doc.getPageCount();
  } catch (err) {
    console.warn("[pieceSegmenter] PDF illisible:", err instanceof Error ? err.message : err);
    return { page_count: 1, method: "fallback", segments: [fallbackSingleSegment(1)] };
  }
  if (pageCount <= 1) {
    return { page_count: pageCount || 1, method: "fallback", segments: [fallbackSingleSegment(pageCount || 1)] };
  }

  // Texte natif en une seule passe (pdftotext insère \f entre les pages).
  const raw = extractPdfText(buffer) ?? "";
  const chunks = raw.split("\f");
  const pageTexts: string[] = Array.from({ length: pageCount }, (_, i) => chunks[i] ?? "");
  const hasText = pageTexts.join("").replace(/\s/g, "").length > 60;

  let perPage: PageClassification[];
  let method: "text" | "vision";
  try {
    if (hasText) {
      perPage = await classifyByText(pageTexts, dossierType, trace);
      method = "text";
    } else {
      perPage = await classifyByVision(buffer, pageCount, dossierType, trace);
      method = "vision";
    }
  } catch (err) {
    console.error("[pieceSegmenter] classification a échoué:", err instanceof Error ? err.message : err);
    return { page_count: pageCount, method: "fallback", segments: [fallbackSingleSegment(pageCount)] };
  }

  const segments = groupSegments(perPage, dossierType);
  if (segments.length === 0) {
    return { page_count: pageCount, method: "fallback", segments: [fallbackSingleSegment(pageCount)] };
  }
  return { page_count: pageCount, method, segments };
}

// ── Étape 2 : appliquer le découpage validé ──────────────────────────────────
export interface ApplySegmentInput {
  code: string | null;
  type: PieceType;
  pages: number[];
  nom: string;
  confidence?: number | null;
}

function extFromMime(mime: string): string {
  if (/pdf/i.test(mime)) return ".pdf";
  if (/jpe?g/i.test(mime)) return ".jpg";
  if (/png/i.test(mime)) return ".png";
  if (/gif/i.test(mime)) return ".gif";
  if (/webp/i.test(mime)) return ".webp";
  if (/tiff?/i.test(mime)) return ".tif";
  return "";
}

export async function applySegmentation(args: {
  bundle: { id: string; url: string; storage_key: string; type: string; nom: string };
  segments: ApplySegmentInput[];
  dossierId: string;
  dossierOwnerId: string;
  appliedBy: string | null;
  trace: Trace;
}): Promise<{ created: number; pieceIds: string[] }> {
  const { bundle, segments, dossierId, dossierOwnerId, appliedBy, trace } = args;
  const storage = getStorageProvider();
  const src = await storage.getBuffer(bundle.storage_key);
  const isPdf = /pdf/i.test(bundle.type);

  let srcDoc: PDFDocument | null = null;
  if (isPdf) {
    try {
      srcDoc = await PDFDocument.load(src, { ignoreEncryption: true });
    } catch (err) {
      console.warn("[pieceSegmenter] applySegmentation: PDF source illisible, copie intégrale:", err instanceof Error ? err.message : err);
      srcDoc = null;
    }
  }

  const pieceIds: string[] = [];
  for (const seg of segments) {
    let buf: Buffer;
    let mime = bundle.type;
    let key: string;

    const validPages = (seg.pages ?? []).filter((p) => Number.isInteger(p) && p >= 1);
    if (srcDoc && validPages.length > 0) {
      const out = await PDFDocument.create();
      const indices = validPages
        .map((p) => p - 1)
        .filter((i) => i >= 0 && i < srcDoc!.getPageCount());
      if (indices.length === 0) continue;
      const copied = await out.copyPages(srcDoc, indices);
      copied.forEach((pg) => out.addPage(pg));
      buf = Buffer.from(await out.save());
      mime = "application/pdf";
      key = `${crypto.randomUUID()}.pdf`;
    } else {
      // Non-PDF (image) ou PDF illisible : on rattache le fichier source entier.
      buf = src;
      key = `${crypto.randomUUID()}${extFromMime(mime) || path.extname(bundle.nom)}`;
    }

    const stored = await storage.put({ key, body: buf, mime });
    const [piece] = await db
      .insert(dossier_pieces_jointes)
      .values({
        dossier_id: dossierId,
        // Propriétaire du dossier, comme l'upload individuel (garde-fou IDOR).
        user_id: dossierOwnerId,
        nom: seg.nom,
        url: stored.url,
        type: mime,
        taille: buf.length,
        code_piece: seg.code,
        ocr_status: "pending",
        source_bundle_id: bundle.id,
        source_pages: validPages,
        code_piece_source: "auto",
        nom_origine: bundle.nom,
        classification_confidence: seg.confidence ?? null,
      })
      .returning();

    if (piece) {
      pieceIds.push(piece.id);
      // Repasse dans le pipeline OCR existant — analyse + extraction par pièce,
      // avec le bon code_piece comme indice de type attendu.
      queuePieceOcr({
        pieceId: piece.id,
        dossierId,
        fileBuffer: buf,
        mimeType: mime,
        nom_piece: seg.nom,
        code_piece: seg.code ?? "",
        trace: { dossierId, userId: trace.userId ?? null, communeId: trace.communeId ?? null },
      });
    }
  }

  await db
    .update(dossier_piece_bundles)
    .set({
      status: "applied",
      applied_at: new Date(),
      applied_by: appliedBy,
      proposed_segments: { applied: true, segments },
    })
    .where(eq(dossier_piece_bundles.id, bundle.id))
    .catch((err) => {
      console.warn("[pieceSegmenter] maj bundle applied a échoué:", err instanceof Error ? err.message : err);
    });

  return { created: pieceIds.length, pieceIds };
}
