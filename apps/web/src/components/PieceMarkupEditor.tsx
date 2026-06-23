import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  MousePointer2, Circle, Square, ArrowUpRight, Pen, Type as TypeIcon,
  Trash2, X, Eye, EyeOff, Save, Send, Download, ChevronLeft, ChevronRight, Loader2,
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
type ToolKind = "ellipse" | "rect" | "arrow" | "freehand" | "text";
type Tool = "select" | ToolKind;
interface Pt { x: number; y: number }
/** Géométrie en % de page (0–100). Forme selon le tool. */
type Geometry = Record<string, number | Pt[]>;
interface MarkStyle { color: string; strokeWidth: number; fontSize?: number }
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
}

const COLORS = ["#DC2626", "#EA580C", "#CA8A04", "#16A34A", "#2563EB", "#111827"];
const WIDTHS = [2, 3, 5, 8];

const num = (v: number | Pt[] | undefined, fb = 0): number => (typeof v === "number" ? v : fb);
const pts = (v: number | Pt[] | undefined): Pt[] => (Array.isArray(v) ? v : []);

/** Boîte englobante d'une marque, en % — sert au hit-test et au placement du label. */
function bboxOf(m: Mark): { x: number; y: number; w: number; h: number } {
  const g = m.geometry;
  if (m.tool === "ellipse" || m.tool === "rect") {
    return { x: num(g.x), y: num(g.y), w: num(g.width), h: num(g.height) };
  }
  if (m.tool === "arrow") {
    const x1 = num(g.x1), y1 = num(g.y1), x2 = num(g.x2), y2 = num(g.y2);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  if (m.tool === "freehand") {
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
  if (m.tool === "arrow") {
    return { x1: num(g.x1) + dx, y1: num(g.y1) + dy, x2: num(g.x2) + dx, y2: num(g.y2) + dy };
  }
  if (m.tool === "freehand") {
    return { points: pts(g.points).map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  return { x: num(g.x) + dx, y: num(g.y) + dy };
}

/** Dessine une marque sur un canvas 2D (export aplati). Coords % → px via W,H ;
 *  `k` met l'épaisseur du trait à l'échelle de l'export. */
function drawMarkOnCanvas(ctx: CanvasRenderingContext2D, m: Mark, W: number, H: number, k: number) {
  const g = m.geometry;
  const px = (v: number) => (v / 100) * W;
  const py = (v: number) => (v / 100) * H;
  ctx.strokeStyle = m.style.color;
  ctx.fillStyle = m.style.color;
  ctx.lineWidth = m.style.strokeWidth * k;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (m.tool === "ellipse") {
    const x = px(num(g.x)), y = py(num(g.y)), w = px(num(g.width)), h = py(num(g.height));
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (m.tool === "rect") {
    ctx.strokeRect(px(num(g.x)), py(num(g.y)), px(num(g.width)), py(num(g.height)));
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
  }

  // Libellé du commentaire à côté de la marque (texte du citoyen).
  if (m.comment) {
    const fontPx = (m.style.fontSize ?? 14) * k;
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    const bb = bboxOf(m);
    const lx = px(bb.x), ly = py(bb.y) - 4 * k;
    const metrics = ctx.measureText(m.comment);
    const padX = 6 * k, padY = 4 * k, lineH = fontPx * 1.25;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(lx, ly - lineH, metrics.width + padX * 2, lineH + padY);
    ctx.fillStyle = m.style.color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(m.comment, lx + padX, ly - padY);
  }
}

export function PieceMarkupEditor({ dossierId, piece, onClose, onExported }: Props) {
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

  const stageRef = useRef<HTMLDivElement>(null);  // conteneur scrollable (mesure largeur)
  const mediaRef = useRef<HTMLDivElement>(null);   // wrapper média + svg (mesure taille rendue)
  const imgRef = useRef<HTMLImageElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const draftRef = useRef<Mark | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; orig: Geometry } | null>(null);
  const [, force] = useState(0);

  const marksOnPage = useMemo(() => marks.filter((m) => m.page === page), [marks, page]);
  const selected = useMemo(() => marks.find((m) => m.id === selectedId) ?? null, [marks, selectedId]);

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
            style: { color: st.color ?? "#DC2626", strokeWidth: st.strokeWidth ?? 3, fontSize: st.fontSize ?? 14 },
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
    try {
      const created = await api.post<{ id: string }>(
        `/mairie/dossiers/${dossierId}/pieces/${piece.id}/annotations`,
        { tool: m.tool, page: m.page, geometry: m.geometry, style: m.style, comment: m.comment, visibility: m.visibility },
      );
      setMarks((prev) => prev.map((x) => (x.id === m.id ? { ...x, id: created.id } : x)));
      setSelectedId((cur) => (cur === m.id ? created.id : cur));
    } catch {
      setError("Échec de l'enregistrement de l'annotation.");
    }
  };
  const persistUpdate = async (m: Mark) => {
    if (m.id.startsWith("tmp-")) return;
    try {
      await api.patch(`/mairie/dossiers/${dossierId}/pieces/${piece.id}/annotations/${m.id}`, {
        geometry: m.geometry, style: m.style, comment: m.comment, visibility: m.visibility, page: m.page,
      });
    } catch { /* silencieux : la marque reste en mémoire */ }
  };

  // ── Gestes de tracé / sélection ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toPct(e);
    if (!p) return;
    svgRef.current?.setPointerCapture(e.pointerId);

    if (tool === "select") {
      // Hit-test du plus récent au plus ancien.
      const hit = [...marksOnPage].reverse().find((m) => {
        const bb = bboxOf(m);
        const pad = 1.5;
        return p.x >= bb.x - pad && p.x <= bb.x + bb.w + pad && p.y >= bb.y - pad && p.y <= bb.y + bb.h + pad;
      });
      setSelectedId(hit?.id ?? null);
      if (hit) dragRef.current = { id: hit.id, startX: p.x, startY: p.y, orig: hit.geometry };
      return;
    }

    const base: Mark = {
      id: `tmp-${Date.now()}`,
      tool: tool as ToolKind,
      page,
      style: { color, strokeWidth: width, fontSize: 14 },
      comment: "",
      visibility: "citoyen",
      geometry: {},
    };
    if (tool === "ellipse" || tool === "rect") base.geometry = { x: p.x, y: p.y, width: 0, height: 0 };
    else if (tool === "arrow") base.geometry = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
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
    } else if (draft.tool === "arrow") {
      draft.geometry = { x1: num(g.x1), y1: num(g.y1), x2: p.x, y2: p.y };
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
    if ((draft.tool === "ellipse" || draft.tool === "rect" || draft.tool === "arrow") && bb.w < 0.6 && bb.h < 0.6) {
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
    void persistCreate(normalized);
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
    const toDraw = marks.filter((m) => m.page === page && (includeInternal || m.visibility === "citoyen"));
    for (const m of toDraw) drawMarkOnCanvas(ctx, m, srcW, srcH, k);
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
    try { await runExport(); flashToast("Document annoté enregistré dans la GED."); }
    catch (e) { setError(e instanceof Error ? e.message : "Échec de l'export"); }
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
    } else if (m.tool === "text") {
      shape = (
        <text x={X(num(g.x))} y={Y(num(g.y))} fill={m.style.color} fontSize={(m.style.fontSize ?? 14)} fontWeight={600} style={halo}>
          {m.comment || "Texte…"}
        </text>
      );
    }
    // Étiquette du commentaire (hors marque texte) pour le repérage à l'écran.
    const bb = bboxOf(m);
    const label = m.comment && m.tool !== "text" ? (
      <text x={X(bb.x)} y={Y(bb.y) - 4} fill={m.style.color} fontSize={12} fontWeight={600} style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 }}>
        {m.comment.length > 40 ? `${m.comment.slice(0, 40)}…` : m.comment}
      </text>
    ) : null;
    return <g key={m.id}>{shape}{label}</g>;
  };

  const TOOLS: { key: Tool; icon: React.ReactNode; label: string }[] = [
    { key: "select", icon: <MousePointer2 size={16} />, label: "Sélectionner / déplacer" },
    { key: "ellipse", icon: <Circle size={16} />, label: "Entourer" },
    { key: "rect", icon: <Square size={16} />, label: "Encadrer" },
    { key: "arrow", icon: <ArrowUpRight size={16} />, label: "Flèche" },
    { key: "freehand", icon: <Pen size={16} />, label: "Dessin libre" },
    { key: "text", icon: <TypeIcon size={16} />, label: "Texte / commentaire" },
  ];

  const btn = (active: boolean): React.CSSProperties => ({
    width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: 8, cursor: "pointer", border: "1px solid", color: active ? "white" : "#475569",
    borderColor: active ? "#4F46E5" : "#E2E8F0", background: active ? "#4F46E5" : "white",
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.55)", display: "flex", flexDirection: "column" }}>
      <div style={{ margin: "2.5vh auto", width: "min(1500px, 96vw)", height: "95vh", background: "white", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}>
        {/* En-tête */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid #E2E8F0" }}>
          <strong style={{ fontSize: 14, color: "#0F172A" }}>Annoter — {piece.nom}</strong>
          <span style={{ fontSize: 11, color: "#64748b", background: "#F1F5F9", padding: "2px 8px", borderRadius: 999 }}>
            Remplace Inkscape / Foxit · les marques « citoyen » seront envoyées
          </span>
          <button type="button" onClick={onClose} title="Fermer" style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: "#64748b" }}>
            <X size={20} />
          </button>
        </div>

        {/* Barre d'outils */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 16px", borderBottom: "1px solid #EEF2F7", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {TOOLS.map((t) => (
              <button key={t.key} type="button" title={t.label} onClick={() => { setTool(t.key); if (t.key !== "select") setSelectedId(null); }} style={btn(tool === t.key)}>
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
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 11.5, color: "#64748b", display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={includeInternal} onChange={(e) => setIncludeInternal(e.target.checked)} />
              Inclure mes notes internes à l'export
            </label>
            <button type="button" onClick={handleExport} disabled={busy !== null} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #E2E8F0", background: "white", color: "#334155", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy === "export" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Enregistrer (GED)
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
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  style={{ position: "absolute", top: 0, left: 0, cursor: tool === "select" ? "move" : "crosshair", touchAction: "none" }}
                >
                  {marksOnPage.map(renderMark)}
                </svg>
              )}
            </div>
          </div>

          {/* Panneau latéral : marque sélectionnée */}
          <div style={{ width: 280, borderLeft: "1px solid #E2E8F0", padding: 14, overflowY: "auto", background: "white" }}>
            {selected ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>Annotation</div>
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
                <div style={{ marginTop: 10, fontSize: 11.5 }}>
                  {marks.length} marque{marks.length > 1 ? "s" : ""} · {marks.filter((m) => m.visibility === "citoyen").length} visible(s) par le citoyen
                </div>
                <div style={{ marginTop: 14, padding: 10, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 11, color: "#64748b" }}>
                  Échelle, mesures de distances et polygones à sommets déplaçables arrivent dans une prochaine étape.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modale d'envoi citoyen */}
      {sendOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }} onClick={() => busy === null && setSendOpen(false)}>
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
        <a href={lastDoc.url} target="_blank" rel="noopener noreferrer" title="Ouvrir le dernier export"
          style={{ position: "fixed", bottom: 18, left: 18, zIndex: 1100, display: "inline-flex", alignItems: "center", gap: 6, background: "white", border: "1px solid #E2E8F0", borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, color: "#334155", boxShadow: "0 6px 20px rgba(0,0,0,0.18)", textDecoration: "none" }}>
          <Download size={15} /> {lastDoc.nom}
        </a>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 1200, background: "#0F172A", color: "white", padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
