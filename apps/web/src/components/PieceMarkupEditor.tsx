import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  MousePointer2, Circle, Square, ArrowUpRight, Pen, Type as TypeIcon,
  Trash2, X, Eye, EyeOff, Save, Send, Download, ChevronLeft, ChevronRight, Loader2,
  Ruler, MoveHorizontal, Hexagon,
} from "lucide-react";
import { api, ApiError } from "../lib/api";

// Worker pdfjs embarqué par Vite (cf. PdfAnnotator) — pas de fetch CDN (CSP).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const PDF_OPTIONS = {
  withCredentials: true,
  disableRange: true,
  disableStream: true,
  useSystemFonts: true,
  canvasMaxAreaInBytes: -1,
} as const;

// ── Modèle d'une marque (annotation vectorielle) ───────────────────────────
type ToolKind = "ellipse" | "rect" | "arrow" | "freehand" | "text" | "scale" | "measure" | "polygon";
type Tool = "select" | ToolKind;
/** Segments (géométrie {x1,y1,x2,y2}) : flèche, échelle, mesure. */
const SEGMENT_TOOLS = new Set<ToolKind>(["arrow", "scale", "measure"]);
interface Pt { x: number; y: number }
/** Géométrie en % de page (0–100). Forme selon le tool. */
type Geometry = Record<string, number | Pt[]>;
/** `meters` n'est porté que par l'outil "scale" : longueur réelle du segment. */
interface MarkStyle { color: string; strokeWidth: number; fontSize?: number; meters?: number }
interface Mark {
  id: string;
  tool: ToolKind;
  page: number;
  geometry: Geometry;
  style: MarkStyle;
  comment: string;
  visibility: "interne" | "citoyen";
}

export interface GedDocument {
  id: string;
  nom: string;
  url: string;
  type: string;
  taille: number;
  shared_with_citizen?: boolean;
}

interface PieceLite { id: string; nom: string; url: string; type: string }
interface Props {
  dossierId: string;
  piece: PieceLite;
  onClose: () => void;
  /** Appelé après chaque export réussi vers la GED. */
  onExported?: (doc: GedDocument) => void;
  /** Rendu intégré (remplit le conteneur parent) plutôt qu'en overlay plein
   *  écran. Utilisé pour annoter directement dans le visualiseur de pièce. */
  embedded?: boolean;
}

const COLORS = ["#DC2626", "#EA580C", "#CA8A04", "#16A34A", "#2563EB", "#111827"];
const WIDTHS = [2, 3, 5, 8];

const num = (v: number | Pt[] | undefined, fb = 0): number => (typeof v === "number" ? v : fb);
const pts = (v: number | Pt[] | undefined): Pt[] => (Array.isArray(v) ? v : []);

// ── Échelle & mesures ──────────────────────────────────────────────────────
// Les coords sont en % de page (anisotrope) : on reconvertit en pixels via les
// dimensions rendues W,H pour calculer une vraie longueur euclidienne. Le ratio
// mètres/pixel est dérivé du segment d'échelle dans le MÊME repère W,H, donc le
// résultat en mètres est invariant au zoom (W,H se simplifient).
function segLenPx(g: Geometry, W: number, H: number): number {
  const dx = (num(g.x2) - num(g.x1)) / 100 * W;
  const dy = (num(g.y2) - num(g.y1)) / 100 * H;
  return Math.hypot(dx, dy);
}
/** Mètres par pixel de la page, d'après le segment d'échelle calibré. */
function metersPerPx(scaleMark: Mark | null, W: number, H: number): number | null {
  if (!scaleMark || typeof scaleMark.style.meters !== "number" || scaleMark.style.meters <= 0) return null;
  const len = segLenPx(scaleMark.geometry, W, H);
  return len > 0 ? scaleMark.style.meters / len : null;
}
function fmtLen(m: number): string {
  if (!Number.isFinite(m)) return "—";
  if (m >= 1000) return `${(m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} km`;
  return `${m.toLocaleString("fr-FR", { maximumFractionDigits: m < 10 ? 2 : 1 })} m`;
}
function fmtArea(a: number): string {
  if (!Number.isFinite(a)) return "—";
  if (a >= 10000) return `${(a / 10000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ha`;
  return `${a.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} m²`;
}
/** Dimensions réelles d'un rectangle (largeur, hauteur, aire) si l'échelle est posée. */
function rectMeters(g: Geometry, mpp: number, W: number, H: number): { w: number; h: number; area: number } {
  const w = Math.abs(num(g.width)) / 100 * W * mpp;
  const h = Math.abs(num(g.height)) / 100 * H * mpp;
  return { w, h, area: w * h };
}

/** Boîte englobante d'une marque, en % — sert au hit-test et au placement du label. */
function bboxOf(m: Mark): { x: number; y: number; w: number; h: number } {
  const g = m.geometry;
  if (m.tool === "ellipse" || m.tool === "rect") {
    return { x: num(g.x), y: num(g.y), w: num(g.width), h: num(g.height) };
  }
  if (SEGMENT_TOOLS.has(m.tool)) {
    const x1 = num(g.x1), y1 = num(g.y1), x2 = num(g.x2), y2 = num(g.y2);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  if (m.tool === "freehand" || m.tool === "polygon") {
    const ps = pts(g.points);
    if (ps.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
  }
  // text
  return { x: num(g.x), y: num(g.y), w: 0, h: 0 };
}

/** Décale toute la géométrie de (dx, dy) en % — pour le déplacement (select). */
function translateGeometry(m: Mark, dx: number, dy: number): Geometry {
  const g = m.geometry;
  if (m.tool === "ellipse" || m.tool === "rect") {
    return { ...g, x: num(g.x) + dx, y: num(g.y) + dy };
  }
  if (SEGMENT_TOOLS.has(m.tool)) {
    return { ...g, x1: num(g.x1) + dx, y1: num(g.y1) + dy, x2: num(g.x2) + dx, y2: num(g.y2) + dy };
  }
  if (m.tool === "freehand" || m.tool === "polygon") {
    return { points: pts(g.points).map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  return { x: num(g.x) + dx, y: num(g.y) + dy };
}

// ── Polygones : aire (shoelace) et périmètre en pixels du repère W,H ────────
function polyAreaPx(ps: Pt[], W: number, H: number): number {
  if (ps.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!, q = ps[(i + 1) % ps.length]!;
    a += (p.x / 100 * W) * (q.y / 100 * H) - (q.x / 100 * W) * (p.y / 100 * H);
  }
  return Math.abs(a) / 2;
}
function polyPerimeterPx(ps: Pt[], W: number, H: number): number {
  let per = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!, q = ps[(i + 1) % ps.length]!;
    per += Math.hypot((q.x - p.x) / 100 * W, (q.y - p.y) / 100 * H);
  }
  return per;
}
function polyCentroid(ps: Pt[]): Pt {
  if (ps.length === 0) return { x: 0, y: 0 };
  const sx = ps.reduce((s, p) => s + p.x, 0), sy = ps.reduce((s, p) => s + p.y, 0);
  return { x: sx / ps.length, y: sy / ps.length };
}

/** Sommets éditables d'une marque (polygone, ou extrémités d'un segment). */
function handlesOf(m: Mark): { key: string; x: number; y: number }[] {
  if (m.tool === "polygon") return pts(m.geometry.points).map((p, i) => ({ key: `p${i}`, x: p.x, y: p.y }));
  if (SEGMENT_TOOLS.has(m.tool)) {
    const g = m.geometry;
    return [{ key: "a", x: num(g.x1), y: num(g.y1) }, { key: "b", x: num(g.x2), y: num(g.y2) }];
  }
  return [];
}
/** Repositionne un sommet identifié par `key` à la position `p` (en %). */
function setVertex(m: Mark, key: string, p: Pt): Geometry {
  if (m.tool === "polygon") {
    const ps = [...pts(m.geometry.points)];
    const i = parseInt(key.slice(1), 10);
    if (i >= 0 && i < ps.length) ps[i] = { x: p.x, y: p.y };
    return { points: ps };
  }
  if (SEGMENT_TOOLS.has(m.tool)) {
    const g = m.geometry;
    return key === "a" ? { ...g, x1: p.x, y1: p.y } : { ...g, x2: p.x, y2: p.y };
  }
  return m.geometry;
}

/** Dessine une marque sur un canvas 2D (export aplati). Coords % → px via W,H ;
 *  `k` met l'épaisseur du trait à l'échelle de l'export ; `mpp` = mètres/px de
 *  la page (échelle), `null` si non calibrée. */
function drawMarkOnCanvas(ctx: CanvasRenderingContext2D, m: Mark, W: number, H: number, k: number, mpp: number | null) {
  const g = m.geometry;
  const px = (v: number) => (v / 100) * W;
  const py = (v: number) => (v / 100) * H;
  ctx.strokeStyle = m.style.color;
  ctx.fillStyle = m.style.color;
  ctx.lineWidth = m.style.strokeWidth * k;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Étiquette : fond blanc translucide + texte dans la couleur de la marque.
  const drawLabel = (text: string, lx: number, ly: number) => {
    const fontPx = (m.style.fontSize ?? 14) * k;
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width;
    const padX = 6 * k, padY = 4 * k, lineH = fontPx * 1.25;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(lx, ly - lineH, w + padX * 2, lineH + padY);
    ctx.fillStyle = m.style.color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, lx + padX, ly - padY);
  };

  if (m.tool === "ellipse") {
    const x = px(num(g.x)), y = py(num(g.y)), w = px(num(g.width)), h = py(num(g.height));
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (m.tool === "rect") {
    ctx.strokeRect(px(num(g.x)), py(num(g.y)), px(num(g.width)), py(num(g.height)));
    if (mpp) {
      const d = rectMeters(g, mpp, W, H);
      drawLabel(`${fmtLen(d.w)} × ${fmtLen(d.h)} · ${fmtArea(d.area)}`, px(num(g.x)), py(num(g.y)) - 2 * k);
    }
  } else if (m.tool === "arrow") {
    const x1 = px(num(g.x1)), y1 = py(num(g.y1)), x2 = px(num(g.x2)), y2 = py(num(g.y2));
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const head = 10 * k + m.style.strokeWidth * k;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
    ctx.closePath(); ctx.fill();
  } else if (m.tool === "freehand") {
    const ps = pts(g.points);
    if (ps.length > 1) {
      ctx.beginPath();
      ctx.moveTo(px(ps[0]!.x), py(ps[0]!.y));
      for (const p of ps.slice(1)) ctx.lineTo(px(p.x), py(p.y));
      ctx.stroke();
    }
  } else if (m.tool === "polygon") {
    const ps = pts(g.points);
    if (ps.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(px(ps[0]!.x), py(ps[0]!.y));
      for (const p of ps.slice(1)) ctx.lineTo(px(p.x), py(p.y));
      ctx.closePath();
      ctx.save(); ctx.globalAlpha = 0.08; ctx.fill(); ctx.restore();
      ctx.stroke();
      if (mpp && ps.length >= 3) {
        const c = polyCentroid(ps);
        const area = polyAreaPx(ps, W, H) * mpp * mpp;
        const per = polyPerimeterPx(ps, W, H) * mpp;
        drawLabel(`${fmtArea(area)} · ${fmtLen(per)}`, px(c.x), py(c.y));
      }
    }
  } else if (m.tool === "scale" || m.tool === "measure") {
    const x1 = px(num(g.x1)), y1 = py(num(g.y1)), x2 = px(num(g.x2)), y2 = py(num(g.y2));
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    // Repères perpendiculaires aux extrémités (style cote).
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const t = 6 * k + m.style.strokeWidth * k;
    const nx = Math.cos(ang + Math.PI / 2) * t, ny = Math.sin(ang + Math.PI / 2) * t;
    ctx.beginPath();
    ctx.moveTo(x1 - nx, y1 - ny); ctx.lineTo(x1 + nx, y1 + ny);
    ctx.moveTo(x2 - nx, y2 - ny); ctx.lineTo(x2 + nx, y2 + ny);
    ctx.stroke();
    const label = m.tool === "scale"
      ? `Échelle : ${fmtLen(num(m.style.meters))}`
      : (mpp ? fmtLen(segLenPx(g, W, H) * mpp) : "(échelle requise)");
    drawLabel(label, (x1 + x2) / 2, (y1 + y2) / 2 - 4 * k);
  }

  // Libellé du commentaire à côté de la marque (texte du citoyen / contenu d'un
  // outil « texte »). Les outils de mesure portent déjà leur propre étiquette.
  if (m.comment) {
    const bb = bboxOf(m);
    drawLabel(m.comment, px(bb.x), py(bb.y) - 4 * k);
  }
}

export function PieceMarkupEditor({ dossierId, piece, onClose, onExported, embedded = false }: Props) {
  const isImage = (piece.type ?? "").toLowerCase().startsWith("image/");
  const isPdf = (piece.type === "application/pdf") || piece.nom.toLowerCase().endsWith(".pdf");

  const [marks, setMarks] = useState<Mark[]>([]);
  const [tool, setTool] = useState<Tool>("ellipse");
  const [color, setColor] = useState(COLORS[0]!);
  const [width, setWidth] = useState(WIDTHS[1]!);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [renderWidth, setRenderWidth] = useState(800);
  const [includeInternal, setIncludeInternal] = useState(false);
  const [busy, setBusy] = useState<null | "export" | "send">(null);
  const [error, setError] = useState<string | null>(null);
  const [lastDoc, setLastDoc] = useState<GedDocument | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendText, setSendText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  // Avant / après : masque le calque d'annotations pour comparer à l'original.
  const [showOriginal, setShowOriginal] = useState(false);
  // Indicateur de persistance d'une marque (les annotations sont enregistrées
  // sur le dossier en continu — pas besoin de télécharger).
  const [savingMark, setSavingMark] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);  // conteneur scrollable (mesure largeur)
  const mediaRef = useRef<HTMLDivElement>(null);   // wrapper média + svg (mesure taille rendue)
  const imgRef = useRef<HTMLImageElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const draftRef = useRef<Mark | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; orig: Geometry } | null>(null);
  // Sommet en cours de déplacement (polygone / extrémité de segment).
  const vertexDragRef = useRef<{ id: string; key: string } | null>(null);
  // Polygone en cours de tracé (clic-à-clic) + position du curseur (élastique).
  const [polyDraft, setPolyDraft] = useState<{ points: Pt[] } | null>(null);
  const [hoverPt, setHoverPt] = useState<Pt | null>(null);
  const [, force] = useState(0);

  // Calibrage d'échelle : segment de référence en attente de saisie + champ.
  const [scaleDraftId, setScaleDraftId] = useState<string | null>(null);
  const [scaleInput, setScaleInput] = useState("");

  const marksOnPage = useMemo(() => marks.filter((m) => m.page === page), [marks, page]);
  const selected = useMemo(() => marks.find((m) => m.id === selectedId) ?? null, [marks, selectedId]);
  // Segment d'échelle actif de la page (le plus récent calibré) + ratio m/px.
  const pageScaleMark = useMemo(
    () => [...marks].reverse().find((m) => m.tool === "scale" && m.page === page && typeof m.style.meters === "number" && (m.style.meters as number) > 0) ?? null,
    [marks, page],
  );
  const pageMpp = useMemo(
    () => metersPerPx(pageScaleMark, mediaSize.w, mediaSize.h),
    [pageScaleMark, mediaSize.w, mediaSize.h],
  );

  // ── Chargement des annotations existantes ──
  useEffect(() => {
    let cancelled = false;
    api.get<Mark[]>(`/mairie/dossiers/${dossierId}/pieces/${piece.id}/annotations`)
      .then((rows) => {
        if (cancelled) return;
        setMarks(rows.map((r) => {
          const st = (r.style ?? {}) as Partial<MarkStyle>;
          return {
            id: r.id,
            tool: r.tool,
            page: r.page ?? 1,
            geometry: (r.geometry ?? {}) as Geometry,
            style: { color: st.color ?? "#DC2626", strokeWidth: st.strokeWidth ?? 3, fontSize: st.fontSize ?? 14, meters: typeof st.meters === "number" ? st.meters : undefined },
            comment: r.comment ?? "",
            visibility: r.visibility === "citoyen" ? "citoyen" : "interne",
          };
        }));
      })
      .catch(() => { /* pièce sans annotation : liste vide */ });
    return () => { cancelled = true; };
  }, [dossierId, piece.id]);

  // ── Mesure de la largeur de rendu (PDF rendu à la largeur du conteneur) ──
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setRenderWidth(Math.max(320, Math.min(1400, el.clientWidth - 32)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Mesure de la taille rendue du média (pour caler le calque SVG) ──
  const remeasureMedia = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMediaSize((prev) => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
  }, []);
  useEffect(() => {
    remeasureMedia();
    const el = mediaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(remeasureMedia);
    ro.observe(el);
    return () => ro.disconnect();
  }, [remeasureMedia, renderWidth, page, isImage, isPdf]);

  const flashToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2600); };

  // ── Conversion pointeur → % de page ──
  const toPct = (e: React.PointerEvent): Pt | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    };
  };

  const persistCreate = async (m: Mark) => {
    setSavingMark(true);
    try {
      const created = await api.post<{ id: string }>(
        `/mairie/dossiers/${dossierId}/pieces/${piece.id}/annotations`,
        { tool: m.tool, page: m.page, geometry: m.geometry, style: m.style, comment: m.comment, visibility: m.visibility },
      );
      setMarks((prev) => prev.map((x) => (x.id === m.id ? { ...x, id: created.id } : x)));
      setSelectedId((cur) => (cur === m.id ? created.id : cur));
    } catch {
      setError("Échec de l'enregistrement de l'annotation.");
    } finally {
      setSavingMark(false);
    }
  };
  const persistUpdate = async (m: Mark) => {
    if (m.id.startsWith("tmp-")) return;
    setSavingMark(true);
    try {
      await api.patch(`/mairie/dossiers/${dossierId}/pieces/${piece.id}/annotations/${m.id}`, {
        geometry: m.geometry, style: m.style, comment: m.comment, visibility: m.visibility, page: m.page,
      });
    } catch { /* silencieux : la marque reste en mémoire */ }
    finally { setSavingMark(false); }
  };

  // ── Polygone (tracé clic-à-clic) ──
  const finalizePoly = async () => {
    if (!polyDraft || polyDraft.points.length < 3) return;
    const m: Mark = {
      id: `tmp-${Date.now()}`,
      tool: "polygon",
      page,
      geometry: { points: polyDraft.points },
      style: { color, strokeWidth: width, fontSize: 14 },
      comment: "",
      visibility: "citoyen",
    };
    setPolyDraft(null);
    setHoverPt(null);
    setMarks((prev) => [...prev, m]);
    setSelectedId(m.id);
    await persistCreate(m);
  };
  const cancelPoly = () => { setPolyDraft(null); setHoverPt(null); };

  // ── Gestes de tracé / sélection ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toPct(e);
    if (!p) return;
    svgRef.current?.setPointerCapture(e.pointerId);

    if (tool === "select") {
      // 1) Déplacement d'un sommet de la marque déjà sélectionnée (polygone /
      //    extrémité de segment) : on teste les poignées en premier.
      if (selected) {
        const hitH = handlesOf(selected).find((h) =>
          Math.hypot((p.x - h.x) / 100 * mediaSize.w, (p.y - h.y) / 100 * mediaSize.h) < 10);
        if (hitH) { vertexDragRef.current = { id: selected.id, key: hitH.key }; return; }
      }
      // 2) Sélection + déplacement du corps (du plus récent au plus ancien).
      const hit = [...marksOnPage].reverse().find((m) => {
        const bb = bboxOf(m);
        const pad = 1.5;
        return p.x >= bb.x - pad && p.x <= bb.x + bb.w + pad && p.y >= bb.y - pad && p.y <= bb.y + bb.h + pad;
      });
      setSelectedId(hit?.id ?? null);
      if (hit) dragRef.current = { id: hit.id, startX: p.x, startY: p.y, orig: hit.geometry };
      return;
    }

    // Polygone : clic pour ajouter un sommet ; clic sur le 1er sommet (ou Entrée)
    // pour fermer ; Échap pour annuler.
    if (tool === "polygon") {
      setSelectedId(null);
      if (!polyDraft) { setPolyDraft({ points: [p] }); setHoverPt(p); return; }
      const first = polyDraft.points[0];
      const closeDist = first ? Math.hypot((p.x - first.x) / 100 * mediaSize.w, (p.y - first.y) / 100 * mediaSize.h) : Infinity;
      if (polyDraft.points.length >= 3 && closeDist < 12) { void finalizePoly(); return; }
      setPolyDraft({ points: [...polyDraft.points, p] });
      return;
    }

    const base: Mark = {
      id: `tmp-${Date.now()}`,
      tool: tool as ToolKind,
      page,
      style: { color, strokeWidth: width, fontSize: 14 },
      comment: "",
      // L'échelle est une aide de calibrage → interne par défaut. Le reste est
      // destiné au citoyen (basculable ensuite).
      visibility: tool === "scale" ? "interne" : "citoyen",
      geometry: {},
    };
    if (tool === "ellipse" || tool === "rect") base.geometry = { x: p.x, y: p.y, width: 0, height: 0 };
    else if ((SEGMENT_TOOLS as Set<string>).has(tool)) base.geometry = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    else if (tool === "freehand") base.geometry = { points: [{ x: p.x, y: p.y }] };
    else if (tool === "text") base.geometry = { x: p.x, y: p.y };

    if (tool === "text") {
      // Le texte se crée d'un clic puis s'édite dans le panneau latéral.
      setMarks((prev) => [...prev, base]);
      setSelectedId(base.id);
      void persistCreate(base);
      return;
    }
    draftRef.current = base;
    setMarks((prev) => [...prev, base]);
    setSelectedId(base.id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toPct(e);
    if (!p) return;

    // Déplacement d'un sommet.
    if (vertexDragRef.current) {
      const { id, key } = vertexDragRef.current;
      setMarks((prev) => prev.map((m) => (m.id === id ? { ...m, geometry: setVertex(m, key, p) } : m)));
      return;
    }
    // Élastique du polygone en cours de tracé.
    if (polyDraft) { setHoverPt(p); return; }

    if (dragRef.current) {
      const d = dragRef.current;
      const dx = p.x - d.startX, dy = p.y - d.startY;
      const orig: Mark = { ...(marks.find((m) => m.id === d.id) as Mark), geometry: d.orig };
      const geo = translateGeometry(orig, dx, dy);
      setMarks((prev) => prev.map((m) => (m.id === d.id ? { ...m, geometry: geo } : m)));
      return;
    }

    const draft = draftRef.current;
    if (!draft) return;
    const g = draft.geometry;
    if (draft.tool === "ellipse" || draft.tool === "rect") {
      draft.geometry = { x: num(g.x), y: num(g.y), width: p.x - num(g.x), height: p.y - num(g.y) };
    } else if (SEGMENT_TOOLS.has(draft.tool)) {
      draft.geometry = { ...g, x1: num(g.x1), y1: num(g.y1), x2: p.x, y2: p.y };
    } else if (draft.tool === "freehand") {
      const ps = pts(g.points);
      const last = ps[ps.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.4) ps.push({ x: p.x, y: p.y });
      draft.geometry = { points: ps };
    }
    setMarks((prev) => prev.map((m) => (m.id === draft.id ? { ...m, geometry: { ...draft.geometry } } : m)));
    force((n) => n + 1);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    svgRef.current?.releasePointerCapture(e.pointerId);
    // Fin de déplacement d'un sommet → persistance.
    if (vertexDragRef.current) {
      const id = vertexDragRef.current.id;
      vertexDragRef.current = null;
      const m = marks.find((x) => x.id === id);
      if (m) void persistUpdate(m);
      return;
    }
    if (dragRef.current) {
      const id = dragRef.current.id;
      dragRef.current = null;
      const m = marks.find((x) => x.id === id);
      if (m) void persistUpdate(m);
      return;
    }
    const draft = draftRef.current;
    draftRef.current = null;
    if (!draft) return;
    // Normalise les rect/ellipse à dimensions négatives, ignore les tracés nuls.
    const bb = bboxOf({ ...draft });
    if ((draft.tool === "ellipse" || draft.tool === "rect" || SEGMENT_TOOLS.has(draft.tool)) && bb.w < 0.6 && bb.h < 0.6) {
      setMarks((prev) => prev.filter((m) => m.id !== draft.id));
      setSelectedId(null);
      return;
    }
    let normalized = draft;
    if (draft.tool === "ellipse" || draft.tool === "rect") {
      const g = draft.geometry;
      const x = Math.min(num(g.x), num(g.x) + num(g.width));
      const y = Math.min(num(g.y), num(g.y) + num(g.height));
      normalized = { ...draft, geometry: { x, y, width: Math.abs(num(g.width)), height: Math.abs(num(g.height)) } };
      setMarks((prev) => prev.map((m) => (m.id === draft.id ? normalized : m)));
    }
    // L'échelle exige la saisie de la longueur réelle → on ouvre le calibrage,
    // la persistance se fait à la validation de la modale.
    if (draft.tool === "scale") {
      setScaleDraftId(draft.id);
      setScaleInput("");
      return;
    }
    void persistCreate(normalized);
  };

  // ── Calibrage d'échelle ──
  const confirmScale = async () => {
    const meters = parseFloat(scaleInput.replace(",", "."));
    if (!scaleDraftId || !Number.isFinite(meters) || meters <= 0) {
      setError("Saisissez une longueur réelle valide (en mètres).");
      return;
    }
    const draftMark = marks.find((m) => m.id === scaleDraftId);
    if (!draftMark) { setScaleDraftId(null); return; }
    const finalized: Mark = { ...draftMark, style: { ...draftMark.style, meters } };
    // Une seule échelle active par page : on retire les anciennes (état + API).
    const stale = marks.filter((m) => m.tool === "scale" && m.page === draftMark.page && m.id !== draftMark.id);
    setMarks((prev) => prev
      .filter((m) => !stale.some((s) => s.id === m.id))
      .map((m) => (m.id === finalized.id ? finalized : m)));
    setScaleDraftId(null);
    setScaleInput("");
    for (const s of stale) {
      if (!s.id.startsWith("tmp-")) {
        try { await api.delete(`/mairie/dossiers/${dossierId}/pieces/${piece.id}/annotations/${s.id}`); } catch { /* ignore */ }
      }
    }
    await persistCreate(finalized);
  };
  const cancelScale = () => {
    if (scaleDraftId) setMarks((prev) => prev.filter((m) => m.id !== scaleDraftId));
    setScaleDraftId(null);
    setScaleInput("");
    setSelectedId(null);
  };

  // ── Mutations sur la marque sélectionnée ──
  const updateSelected = (patch: Partial<Mark>) => {
    if (!selected) return;
    const next = { ...selected, ...patch, style: { ...selected.style, ...(patch.style ?? {}) } };
    setMarks((prev) => prev.map((m) => (m.id === selected.id ? next : m)));
    void persistUpdate(next);
  };
  const deleteSelected = async () => {
    if (!selected) return;
    const id = selected.id;
    setMarks((prev) => prev.filter((m) => m.id !== id));
    setSelectedId(null);
    if (!id.startsWith("tmp-")) {
      try { await api.delete(`/mairie/dossiers/${dossierId}/pieces/${piece.id}/annotations/${id}`); } catch { /* ignore */ }
    }
  };

  // Raccourcis pendant le tracé d'un polygone : Entrée = fermer, Échap = annuler.
  useEffect(() => {
    if (!polyDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); void finalizePoly(); }
      else if (e.key === "Escape") { cancelPoly(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polyDraft]);

  // ── Compositing → PNG → export GED ──
  const compositeToBlob = useCallback(async (): Promise<Blob> => {
    // Bitmap source : canvas pdf.js (PDF) ou <img> (image), tous deux same-origin.
    let srcW: number, srcH: number;
    let drawSource: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
    if (isPdf) {
      const canvas = mediaRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) throw new Error("Page PDF non rendue");
      srcW = canvas.width; srcH = canvas.height;
      drawSource = (ctx, w, h) => ctx.drawImage(canvas, 0, 0, w, h);
    } else {
      const img = imgRef.current;
      if (!img) throw new Error("Image non chargée");
      srcW = img.naturalWidth || img.clientWidth;
      srcH = img.naturalHeight || img.clientHeight;
      drawSource = (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h);
    }
    const out = document.createElement("canvas");
    out.width = srcW; out.height = srcH;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("Canvas non disponible");
    drawSource(ctx, srcW, srcH);
    // Épaisseur de trait à l'échelle de l'export (rendu écran → bitmap source).
    const k = mediaSize.w > 0 ? srcW / mediaSize.w : 1;
    // Ratio m/px recalculé dans le repère du bitmap source (cohérent avec les
    // longueurs dessinées au même W,H).
    const scaleMark = [...marks].reverse().find((m) => m.tool === "scale" && m.page === page && typeof m.style.meters === "number" && (m.style.meters as number) > 0) ?? null;
    const exportMpp = metersPerPx(scaleMark, srcW, srcH);
    const toDraw = marks.filter((m) => m.page === page && (includeInternal || m.visibility === "citoyen"));
    for (const m of toDraw) drawMarkOnCanvas(ctx, m, srcW, srcH, k, exportMpp);
    return await new Promise<Blob>((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("Échec de la génération de l'image"))), "image/png"),
    );
  }, [isPdf, marks, page, includeInternal, mediaSize.w]);

  const runExport = useCallback(async (): Promise<GedDocument> => {
    const blob = await compositeToBlob();
    const form = new FormData();
    form.append("file", blob, "annotation.png");
    form.append("nom", piece.nom);
    form.append("format", "pdf");
    const doc = await api.upload<GedDocument>(
      `/mairie/dossiers/${dossierId}/pieces/${piece.id}/annotations/export`, form,
    );
    setLastDoc(doc);
    onExported?.(doc);
    return doc;
  }, [compositeToBlob, dossierId, piece.id, piece.nom, onExported]);

  const handleExport = async () => {
    setBusy("export"); setError(null);
    try { await runExport(); flashToast("Version annotée enregistrée sur le dossier (GED)."); }
    catch (e) { setError(e instanceof Error ? e.message : "Échec de l'enregistrement"); }
    finally { setBusy(null); }
  };

  const handleSend = async () => {
    setBusy("send"); setError(null);
    try {
      const doc = lastDoc ?? await runExport();
      await api.post(`/mairie/conversations/${dossierId}`, {
        content: sendText.trim(),
        attachment_document_ids: [doc.id],
      });
      setSendOpen(false); setSendText("");
      flashToast("Pièce annotée envoyée au citoyen.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec de l'envoi");
    } finally { setBusy(null); }
  };

  // ── Rendu d'une marque en SVG (px = % × taille média) ──
  const renderMark = (m: Mark) => {
    const g = m.geometry;
    const W = mediaSize.w, H = mediaSize.h;
    const X = (v: number) => (v / 100) * W;
    const Y = (v: number) => (v / 100) * H;
    const isSel = m.id === selectedId;
    const common = {
      stroke: m.style.color, strokeWidth: m.style.strokeWidth, fill: "none",
      strokeLinejoin: "round" as const, strokeLinecap: "round" as const,
      opacity: m.visibility === "interne" ? 0.85 : 1,
      strokeDasharray: m.visibility === "interne" ? "6 4" : undefined,
    };
    const halo = isSel ? { filter: "drop-shadow(0 0 2px #6366F1)" } : undefined;
    let shape: React.ReactNode = null;
    if (m.tool === "ellipse") {
      shape = <ellipse cx={X(num(g.x) + num(g.width) / 2)} cy={Y(num(g.y) + num(g.height) / 2)} rx={Math.abs(X(num(g.width)) / 2)} ry={Math.abs(Y(num(g.height)) / 2)} {...common} style={halo} />;
    } else if (m.tool === "rect") {
      shape = <rect x={X(num(g.x))} y={Y(num(g.y))} width={Math.abs(X(num(g.width)))} height={Math.abs(Y(num(g.height)))} {...common} style={halo} />;
    } else if (m.tool === "arrow") {
      const x1 = X(num(g.x1)), y1 = Y(num(g.y1)), x2 = X(num(g.x2)), y2 = Y(num(g.y2));
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = 10 + m.style.strokeWidth;
      shape = (
        <g {...(halo ?? {})}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
          <polygon
            points={`${x2},${y2} ${x2 - head * Math.cos(ang - Math.PI / 6)},${y2 - head * Math.sin(ang - Math.PI / 6)} ${x2 - head * Math.cos(ang + Math.PI / 6)},${y2 - head * Math.sin(ang + Math.PI / 6)}`}
            fill={m.style.color} stroke="none"
          />
        </g>
      );
    } else if (m.tool === "freehand") {
      shape = <polyline points={pts(g.points).map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} {...common} style={halo} />;
    } else if (m.tool === "polygon") {
      shape = <polygon points={pts(g.points).map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} {...common} fill={m.style.color} fillOpacity={0.08} style={halo} />;
    } else if (m.tool === "scale" || m.tool === "measure") {
      const x1 = X(num(g.x1)), y1 = Y(num(g.y1)), x2 = X(num(g.x2)), y2 = Y(num(g.y2));
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const t = 6 + m.style.strokeWidth;
      const nx = Math.cos(ang + Math.PI / 2) * t, ny = Math.sin(ang + Math.PI / 2) * t;
      shape = (
        <g {...(halo ?? {})}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
          <line x1={x1 - nx} y1={y1 - ny} x2={x1 + nx} y2={y1 + ny} {...common} strokeDasharray={undefined} />
          <line x1={x2 - nx} y1={y2 - ny} x2={x2 + nx} y2={y2 + ny} {...common} strokeDasharray={undefined} />
        </g>
      );
    } else if (m.tool === "text") {
      shape = (
        <text x={X(num(g.x))} y={Y(num(g.y))} fill={m.style.color} fontSize={(m.style.fontSize ?? 14)} fontWeight={600} style={halo}>
          {m.comment || "Texte…"}
        </text>
      );
    }

    // Étiquette de mesure (échelle / distance / surface) calculée à la volée.
    const labelStyle = { paintOrder: "stroke" as const, stroke: "white", strokeWidth: 3 };
    let measureText: string | null = null;
    let measureAt: { x: number; y: number } | null = null;
    if (m.tool === "scale") {
      measureText = `Échelle : ${fmtLen(num(m.style.meters))}`;
      measureAt = { x: (X(num(g.x1)) + X(num(g.x2))) / 2, y: (Y(num(g.y1)) + Y(num(g.y2))) / 2 - 6 };
    } else if (m.tool === "measure") {
      measureText = pageMpp ? fmtLen(segLenPx(g, W, H) * pageMpp) : "Définir l'échelle";
      measureAt = { x: (X(num(g.x1)) + X(num(g.x2))) / 2, y: (Y(num(g.y1)) + Y(num(g.y2))) / 2 - 6 };
    } else if (m.tool === "rect" && pageMpp) {
      const d = rectMeters(g, pageMpp, W, H);
      measureText = `${fmtLen(d.w)} × ${fmtLen(d.h)} · ${fmtArea(d.area)}`;
      measureAt = { x: X(num(g.x)), y: Y(num(g.y)) - 6 };
    } else if (m.tool === "polygon" && pageMpp) {
      const ps = pts(g.points);
      if (ps.length >= 3) {
        const c = polyCentroid(ps);
        measureText = `${fmtArea(polyAreaPx(ps, W, H) * pageMpp * pageMpp)} · ${fmtLen(polyPerimeterPx(ps, W, H) * pageMpp)}`;
        measureAt = { x: X(c.x), y: Y(c.y) };
      }
    }
    const measureLabel = measureText && measureAt ? (
      <text x={measureAt.x} y={measureAt.y} fill={m.style.color} fontSize={13} fontWeight={700} style={labelStyle}>{measureText}</text>
    ) : null;

    // Étiquette du commentaire (hors marque texte) pour le repérage à l'écran.
    const bb = bboxOf(m);
    const label = m.comment && m.tool !== "text" ? (
      <text x={X(bb.x)} y={Y(bb.y) - (measureText ? 22 : 4)} fill={m.style.color} fontSize={12} fontWeight={600} style={labelStyle}>
        {m.comment.length > 40 ? `${m.comment.slice(0, 40)}…` : m.comment}
      </text>
    ) : null;
    return <g key={m.id}>{shape}{measureLabel}{label}</g>;
  };

  const TOOLS: { key: Tool; icon: React.ReactNode; label: string }[] = [
    { key: "select", icon: <MousePointer2 size={16} />, label: "Sélectionner / déplacer" },
    { key: "ellipse", icon: <Circle size={16} />, label: "Entourer" },
    { key: "rect", icon: <Square size={16} />, label: "Encadrer" },
    { key: "arrow", icon: <ArrowUpRight size={16} />, label: "Flèche" },
    { key: "freehand", icon: <Pen size={16} />, label: "Dessin libre" },
    { key: "polygon", icon: <Hexagon size={16} />, label: "Polygone — clic à clic, sommets déplaçables" },
    { key: "text", icon: <TypeIcon size={16} />, label: "Texte / commentaire" },
    { key: "scale", icon: <Ruler size={16} />, label: "Échelle — tracer un segment de longueur connue" },
    { key: "measure", icon: <MoveHorizontal size={16} />, label: "Mesurer une distance" },
  ];

  const btn = (active: boolean): React.CSSProperties => ({
    width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: 8, cursor: "pointer", border: "1px solid", color: active ? "white" : "#475569",
    borderColor: active ? "#4F46E5" : "#E2E8F0", background: active ? "#4F46E5" : "white",
  });

  // Intégré : remplit le conteneur du visualiseur (pas d'overlay). Sinon :
  // overlay plein écran autonome (fenêtre modale).
  const rootStyle: React.CSSProperties = embedded
    ? { position: "relative", width: "100%", height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }
    : { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.55)", display: "flex", flexDirection: "column" };
  const panelStyle: React.CSSProperties = embedded
    ? { width: "100%", height: "100%", minHeight: 0, background: "white", overflow: "hidden", display: "flex", flexDirection: "column" }
    : { margin: "2.5vh auto", width: "min(1500px, 96vw)", height: "95vh", background: "white", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.4)" };

  return (
    <div style={rootStyle}>
      <div style={panelStyle}>
        {/* En-tête */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid #E2E8F0" }}>
          <strong style={{ fontSize: 14, color: "#0F172A" }}>Annoter — {piece.nom}</strong>
          {/* Les annotations sont persistées sur le dossier à chaque geste : on
              le rend visible pour lever l'idée qu'il faut « télécharger » pour
              enregistrer. */}
          <span style={{ fontSize: 11, fontWeight: 600, color: savingMark ? "#B45309" : "#15803D", background: savingMark ? "#FEF3C7" : "#F0FDF4", border: `1px solid ${savingMark ? "#FCD34D" : "#86EFAC"}`, padding: "2px 8px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 5 }}>
            {savingMark ? <Loader2 size={12} className="spin" /> : "✓"} {savingMark ? "Enregistrement…" : "Enregistré sur le dossier"}
          </span>
          <button type="button" onClick={onClose} title="Fermer l'annotation (les marques restent enregistrées)" style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: "#64748b" }}>
            <X size={20} />
          </button>
        </div>

        {/* Barre d'outils */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 16px", borderBottom: "1px solid #EEF2F7", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {TOOLS.map((t) => (
              <button key={t.key} type="button" title={t.label} onClick={() => { setTool(t.key); if (t.key !== "select") setSelectedId(null); if (t.key !== "polygon" && polyDraft) cancelPoly(); }} style={btn(tool === t.key)}>
                {t.icon}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 24, background: "#E2E8F0" }} />
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            {COLORS.map((c) => (
              <button key={c} type="button" title={c} onClick={() => { setColor(c); if (selected) updateSelected({ style: { ...selected.style, color: c } }); }}
                style={{ width: 22, height: 22, borderRadius: "50%", background: c, cursor: "pointer", border: color === c ? "3px solid #0F172A" : "2px solid white", boxShadow: "0 0 0 1px #E2E8F0" }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            {WIDTHS.map((w) => (
              <button key={w} type="button" title={`Épaisseur ${w}`} onClick={() => { setWidth(w); if (selected) updateSelected({ style: { ...selected.style, strokeWidth: w } }); }}
                style={{ ...btn(width === w), width: 30 }}>
                <span style={{ display: "inline-block", width: 16, height: w, borderRadius: 2, background: width === w ? "white" : "#475569" }} />
              </button>
            ))}
          </div>
          {isPdf && numPages > 1 && (
            <>
              <div style={{ width: 1, height: 24, background: "#E2E8F0" }} />
              <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#475569" }}>
                <button type="button" style={btn(false)} disabled={page <= 1} onClick={() => { setPage((p) => Math.max(1, p - 1)); setSelectedId(null); }}><ChevronLeft size={16} /></button>
                <span style={{ minWidth: 64, textAlign: "center" }}>Page {page}/{numPages}</span>
                <button type="button" style={btn(false)} disabled={page >= numPages} onClick={() => { setPage((p) => Math.min(numPages, p + 1)); setSelectedId(null); }}><ChevronRight size={16} /></button>
              </div>
            </>
          )}
          <div style={{ width: 1, height: 24, background: "#E2E8F0" }} />
          <button
            type="button"
            onClick={() => { setTool("scale"); setSelectedId(null); }}
            title="Tracez un segment de longueur connue (un mur coté, la barre d'échelle…) pour calibrer la page, puis utilisez l'outil Mesure"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600,
              borderRadius: 999, padding: "5px 10px", cursor: "pointer", border: "1px solid",
              borderColor: pageMpp ? "#86EFAC" : "#FCD34D", background: pageMpp ? "#F0FDF4" : "#FFFBEB",
              color: pageMpp ? "#15803D" : "#B45309",
            }}
          >
            <Ruler size={14} /> {pageMpp ? `Échelle : ${fmtLen(num(pageScaleMark?.style.meters))}` : "Échelle non définie"}
          </button>
          {/* Avant / Après : masque ou affiche le calque d'annotations. */}
          <div style={{ display: "inline-flex", border: "1px solid #E2E8F0", borderRadius: 8, overflow: "hidden" }} title="Comparer l'original (Avant) et la version annotée (Après)">
            <button type="button" onClick={() => setShowOriginal(true)}
              style={{ padding: "6px 10px", border: "none", fontSize: 11.5, fontWeight: 700, cursor: "pointer", background: showOriginal ? "#0F172A" : "white", color: showOriginal ? "white" : "#475569", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Eye size={13} /> Avant
            </button>
            <button type="button" onClick={() => setShowOriginal(false)}
              style={{ padding: "6px 10px", border: "none", borderLeft: "1px solid #E2E8F0", fontSize: 11.5, fontWeight: 700, cursor: "pointer", background: !showOriginal ? "#4F46E5" : "white", color: !showOriginal ? "white" : "#475569" }}>
              Après
            </button>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 11.5, color: "#64748b", display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={includeInternal} onChange={(e) => setIncludeInternal(e.target.checked)} />
              Inclure mes notes internes à l'export
            </label>
            <button type="button" onClick={handleExport} disabled={busy !== null} title="Enregistre la version annotée (aplatie) dans la GED du dossier — aucun téléchargement nécessaire" style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #E2E8F0", background: "white", color: "#334155", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy === "export" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Enregistrer sur le dossier
            </button>
            <button type="button" onClick={() => setSendOpen(true)} disabled={busy !== null} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "#4F46E5", color: "white", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
              <Send size={15} /> Envoyer au citoyen
            </button>
          </div>
        </div>

        {error && <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 12, padding: "6px 16px", borderBottom: "1px solid #FECACA" }}>{error}</div>}

        {/* Corps : scène + panneau latéral */}
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div ref={stageRef} style={{ flex: 1, minWidth: 0, overflow: "auto", background: "#0F172A0A", display: "flex", justifyContent: "center", padding: 16 }}>
            <div ref={mediaRef} style={{ position: "relative", alignSelf: "flex-start", lineHeight: 0 }}>
              {isImage ? (
                <img ref={imgRef} src={piece.url} alt={piece.nom} onLoad={remeasureMedia} style={{ width: renderWidth, height: "auto", display: "block" }} />
              ) : isPdf ? (
                <Document file={piece.url} options={PDF_OPTIONS} onLoadSuccess={({ numPages }) => setNumPages(numPages)} loading={<div style={{ padding: 40, fontSize: 13, color: "#64748b" }}>Chargement du PDF…</div>}>
                  <Page pageNumber={page} width={renderWidth} renderTextLayer={false} renderAnnotationLayer={false} onRenderSuccess={remeasureMedia} />
                </Document>
              ) : (
                <div style={{ padding: 40, fontSize: 13, color: "#94a3b8" }}>Format non annotable.</div>
              )}
              {/* Calque SVG des marques, calé sur la taille rendue du média. */}
              {mediaSize.w > 0 && (
                <svg
                  ref={svgRef}
                  width={mediaSize.w}
                  height={mediaSize.h}
                  onPointerDown={showOriginal ? undefined : onPointerDown}
                  onPointerMove={showOriginal ? undefined : onPointerMove}
                  onPointerUp={showOriginal ? undefined : onPointerUp}
                  style={{ position: "absolute", top: 0, left: 0, cursor: showOriginal ? "default" : tool === "select" ? "move" : "crosshair", touchAction: "none", pointerEvents: showOriginal ? "none" : "auto" }}
                >
                  {!showOriginal && marksOnPage.map(renderMark)}
                  {/* Poignées de sommets de la marque sélectionnée (déplaçables). */}
                  {!showOriginal && selected && selected.page === page && handlesOf(selected).map((h) => (
                    <circle key={h.key} cx={(h.x / 100) * mediaSize.w} cy={(h.y / 100) * mediaSize.h} r={5}
                      fill="white" stroke={selected.style.color} strokeWidth={2} style={{ pointerEvents: "none" }} />
                  ))}
                  {/* Polygone en cours de tracé : segments posés + élastique + sommets. */}
                  {!showOriginal && polyDraft && (() => {
                    const X = (v: number) => (v / 100) * mediaSize.w, Y = (v: number) => (v / 100) * mediaSize.h;
                    const ptsArr = polyDraft.points;
                    const last = ptsArr[ptsArr.length - 1];
                    return (
                      <g style={{ pointerEvents: "none" }}>
                        {ptsArr.length > 1 && (
                          <polyline points={ptsArr.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} fill="none" stroke={color} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" />
                        )}
                        {hoverPt && last && (
                          <line x1={X(last.x)} y1={Y(last.y)} x2={X(hoverPt.x)} y2={Y(hoverPt.y)} stroke={color} strokeWidth={width} strokeDasharray="5 4" opacity={0.7} />
                        )}
                        {ptsArr.map((p, i) => (
                          <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={i === 0 ? 6 : 4} fill={i === 0 ? color : "white"} stroke={color} strokeWidth={2} />
                        ))}
                      </g>
                    );
                  })()}
                </svg>
              )}
            </div>
          </div>

          {/* Panneau latéral : marque sélectionnée */}
          <div style={{ width: 280, borderLeft: "1px solid #E2E8F0", padding: 14, overflowY: "auto", background: "white" }}>
            {selected ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                  {selected.tool === "scale" ? "Échelle" : selected.tool === "measure" ? "Mesure" : "Annotation"}
                </div>
                {selected.tool === "scale" && (
                  <div>
                    <label style={{ fontSize: 11.5, color: "#475569", fontWeight: 600 }}>Longueur réelle du segment</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <input
                        type="number" min={0} step="0.01"
                        value={typeof selected.style.meters === "number" ? selected.style.meters : ""}
                        onChange={(e) => { const v = parseFloat(e.target.value); updateSelected({ style: { ...selected.style, meters: Number.isFinite(v) && v > 0 ? v : undefined } }); }}
                        style={{ width: 110, fontSize: 13, border: "1px solid #E2E8F0", borderRadius: 8, padding: "6px 8px" }}
                      />
                      <span style={{ fontSize: 13, color: "#475569" }}>mètres</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Définit le ratio de la page : toutes les mesures et surfaces s'y réfèrent.</div>
                  </div>
                )}
                {selected.tool === "measure" && (
                  <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 11.5, color: "#64748b" }}>Distance</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#0F172A" }}>
                      {pageMpp ? fmtLen(segLenPx(selected.geometry, mediaSize.w, mediaSize.h) * pageMpp) : "—"}
                    </div>
                    {!pageMpp && <div style={{ fontSize: 11, color: "#B45309", marginTop: 4 }}>Définissez d'abord l'échelle de la page.</div>}
                  </div>
                )}
                {selected.tool === "rect" && pageMpp && (() => {
                  const d = rectMeters(selected.geometry, pageMpp, mediaSize.w, mediaSize.h);
                  return (
                    <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 11.5, color: "#64748b" }}>Dimensions · surface</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{fmtLen(d.w)} × {fmtLen(d.h)}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#0F172A" }}>{fmtArea(d.area)}</div>
                    </div>
                  );
                })()}
                <div>
                  <label style={{ fontSize: 11.5, color: "#475569", fontWeight: 600 }}>Commentaire</label>
                  <textarea
                    value={selected.comment}
                    onChange={(e) => updateSelected({ comment: e.target.value })}
                    placeholder={selected.tool === "text" ? "Texte affiché…" : "Commentaire pour le citoyen…"}
                    rows={4}
                    style={{ width: "100%", marginTop: 4, fontSize: 13, border: "1px solid #E2E8F0", borderRadius: 8, padding: 8, resize: "vertical" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11.5, color: "#475569", fontWeight: 600 }}>Visibilité</label>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {(["citoyen", "interne"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => updateSelected({ visibility: v })}
                        style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 8px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                          border: "1px solid", borderColor: selected.visibility === v ? (v === "citoyen" ? "#16A34A" : "#7C3AED") : "#E2E8F0",
                          background: selected.visibility === v ? (v === "citoyen" ? "#F0FDF4" : "#F5F3FF") : "white",
                          color: selected.visibility === v ? (v === "citoyen" ? "#15803D" : "#6D28D9") : "#475569" }}>
                        {v === "citoyen" ? <Eye size={14} /> : <EyeOff size={14} />} {v === "citoyen" ? "Citoyen" : "Interne"}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                    {selected.visibility === "citoyen" ? "Incluse dans le document envoyé au citoyen." : "Note de travail — jamais envoyée (sauf si vous cochez « inclure mes notes »)."}
                  </div>
                </div>
                <button type="button" onClick={deleteSelected} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", borderRadius: 8, padding: "8px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                  <Trash2 size={15} /> Supprimer
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, color: "#475569", marginBottom: 6 }}>Comment annoter</div>
                Choisissez un outil, tracez sur le document. Cliquez « Sélectionner » pour déplacer une marque, lui ajouter un commentaire et choisir si le citoyen la verra.
                <div style={{ marginTop: 8 }}>
                  Vos annotations sont <b>enregistrées automatiquement sur le dossier</b> (aucun téléchargement requis). Basculez <b>Avant / Après</b> pour comparer à l'original, puis « Enregistrer sur le dossier » (version aplatie dans la GED) ou « Envoyer au citoyen ».
                </div>
                <div style={{ marginTop: 10, fontSize: 11.5 }}>
                  {marks.length} marque{marks.length > 1 ? "s" : ""} · {marks.filter((m) => m.visibility === "citoyen").length} visible(s) par le citoyen
                </div>
                <div style={{ marginTop: 14, padding: 10, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 11, color: "#64748b", lineHeight: 1.55 }}>
                  <b>Mesures</b> : tracez d'abord une <b>Échelle</b> (segment de longueur connue — un mur coté, la barre d'échelle du plan), saisissez sa longueur réelle ; ensuite l'outil <b>Mesure</b> donne les distances, et les <b>rectangles</b> comme les <b>polygones</b> affichent leur surface. <b>Polygone</b> : cliquez pour poser les sommets, cliquez le 1ᵉʳ point (ou Entrée) pour fermer ; sélectionnez-le ensuite pour déplacer ses sommets.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modale de calibrage d'échelle */}
      {scaleDraftId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2150 }}>
          <div style={{ width: "min(440px, 92vw)", background: "white", borderRadius: 12, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Ruler size={18} /> Calibrer l'échelle
            </div>
            <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 14 }}>
              Quelle est la longueur réelle du segment que vous venez de tracer ? (par ex. un mur coté à 10 m, ou la barre d'échelle du plan)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number" min={0} step="0.01" autoFocus
                value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void confirmScale(); if (e.key === "Escape") cancelScale(); }}
                placeholder="ex. 10"
                style={{ flex: 1, fontSize: 15, border: "1px solid #E2E8F0", borderRadius: 8, padding: "9px 12px" }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#475569" }}>mètres</span>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={cancelScale} style={{ border: "1px solid #E2E8F0", background: "white", color: "#475569", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Annuler</button>
              <button type="button" onClick={() => void confirmScale()} style={{ border: "none", background: "#4F46E5", color: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Définir l'échelle</button>
            </div>
          </div>
        </div>
      )}

      {/* Modale d'envoi citoyen */}
      {sendOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100 }} onClick={() => busy === null && setSendOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 92vw)", background: "white", borderRadius: 12, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Envoyer la pièce annotée au citoyen</div>
            <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 12 }}>
              Le document aplati (annotations « citoyen » uniquement) sera enregistré dans la GED et joint à un message interne adressé au pétitionnaire.
            </div>
            <textarea value={sendText} onChange={(e) => setSendText(e.target.value)} rows={4} placeholder="Message d'accompagnement (optionnel)…"
              style={{ width: "100%", fontSize: 13, border: "1px solid #E2E8F0", borderRadius: 8, padding: 10, resize: "vertical" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setSendOpen(false)} disabled={busy !== null} style={{ border: "1px solid #E2E8F0", background: "white", color: "#475569", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Annuler</button>
              <button type="button" onClick={handleSend} disabled={busy !== null} style={{ border: "none", background: "#4F46E5", color: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, opacity: busy ? 0.6 : 1 }}>
                {busy === "send" ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Envoyer
              </button>
            </div>
          </div>
        </div>
      )}

      {lastDoc && (
        <div style={{ position: "fixed", bottom: 18, left: 18, zIndex: 2100, display: "inline-flex", alignItems: "center", gap: 10, background: "white", border: "1px solid #86EFAC", borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, color: "#15803D", boxShadow: "0 6px 20px rgba(0,0,0,0.18)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>✓ Enregistré sur le dossier</span>
          <a href={lastDoc.url} target="_blank" rel="noopener noreferrer" title="Ouvrir la version annotée" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#4F46E5", textDecoration: "none" }}>
            <Eye size={14} /> Ouvrir
          </a>
          <a href={lastDoc.url} download title="Télécharger (optionnel)" style={{ display: "inline-flex", color: "#64748b" }}>
            <Download size={14} />
          </a>
        </div>
      )}

      {/* Aide contextuelle pendant le tracé d'un polygone. */}
      {polyDraft && (
        <div style={{ position: "fixed", top: 96, left: "50%", transform: "translateX(-50%)", zIndex: 1150, background: "#0F172A", color: "white", padding: "7px 16px", borderRadius: 999, fontSize: 12, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
          Polygone — cliquez pour ajouter des sommets · cliquez le 1ᵉʳ point ou <b>Entrée</b> pour fermer · <b>Échap</b> pour annuler ({polyDraft.points.length} pt{polyDraft.points.length > 1 ? "s" : ""})
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 1200, background: "#0F172A", color: "white", padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
