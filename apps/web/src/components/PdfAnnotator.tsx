import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2,
  Highlighter, X, Eye, EyeOff, ShieldCheck, FileDown,
  Hand, MousePointer2, RotateCcw, RotateCw, Undo2,
} from "lucide-react";
import { api } from "../lib/api";

// Setup du worker pdfjs — sans ça pdf.js démarre un worker depuis un CDN
// (incompatible CSP) ou échoue silencieusement. On l'inclut via import.meta.url
// pour que Vite l'embarque dans le bundle au lieu d'un fetch externe.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// Mémoïsé en constante module pour éviter qu'à chaque rerender, pdfjs
// recharge tout (Document compare options par référence d'objet).
//
//  - withCredentials : cookies envoyés (cf. fix /api/uploads).
//  - disableRange / disableStream : pdfjs demande par défaut les pages en
//    byte ranges progressives. Nos routes streament le fichier d'un bloc
//    sans répondre aux Range headers, ce qui surface en "Missing PDF".
//  - useSystemFonts : permet à pdfjs d'utiliser les polices de l'OS quand
//    le PDF embarque des fonts qu'il sait pas substituer — utile pour les
//    plans d'architecte avec polices CAD propriétaires.
//  - canvasMaxAreaInBytes : remonte le plafond de surface canvas (défaut
//    ~67 Mpx). Sans ça, les calques raster haute résolution sur certains
//    plans d'architecte sont silencieusement omis du rendu.
const PDF_OPTIONS = {
  withCredentials: true,
  disableRange: true,
  disableStream: true,
  useSystemFonts: true,
  canvasMaxAreaInBytes: -1, // -1 = pas de limite
} as const;

type AnnotationKind = "correction" | "precision" | "jurisprudence" | "note_perso";
type AnnotationVisibility = "private" | "shared";

interface HighlightRect {
  page: number;
  x: number;       // % de la largeur de page
  y: number;       // % de la hauteur de page
  width: number;   // % largeur
  height: number;  // % hauteur
}

interface CapturedSelection {
  page: number;
  quote: string;
  rects: HighlightRect[];
  // Coordonnées viewport pour positionner le bouton flottant à côté de la sélection
  anchorX: number;
  anchorY: number;
}

/**
 * Visualiseur PDF avec couches text + annotations natives — base du système
 * d'annotation Adobe-like (3.C.3). Remplace l'iframe historique : on garde
 * désormais la main sur la sélection de texte, les surlignages persistants
 * et les popovers d'annotation au-dessus de la page.
 *
 * Architecture :
 *  - react-pdf rend chaque page sur un canvas + une couche text (sélectionnable)
 *  - La sélection texte est capturée via mouseup + window.getSelection()
 *  - Coordonnées normalisées en % de la page pour rester robustes au zoom
 *  - POST direct vers /api/mairie/documents/:docId/annotations quand on
 *    enregistre. Si pas de documentId fourni, le composant est lecture seule.
 */
interface Props {
  /** URL du PDF (route /api/mairie/documents/:id/pdf). */
  fileUrl: string;
  /** Page sur laquelle ouvrir le viewer. 1 par défaut. */
  initialPage?: number;
  /** UUID du commune_documents pour POST des annotations. Si absent →
   *  lecture seule (pas de capture de sélection ni de form). */
  documentId?: string;
  /** Callback appelé après création réussie — permet au parent de refresh
   *  la liste des annotations affichées en surlignage (3.C.3d). */
  onAnnotationCreated?: () => void;
  /** URL du fichier original déposé — quand fournie, on affiche un bouton
   *  "Télécharger l'original" et un tag "Aperçu retraité" si la variante
   *  servie est une version compat. Sert la transparence réglementaire
   *  sur les pièces du dossier dont le rendu transite par pdftocairo. */
  originalDownloadUrl?: string;
}

const KIND_LABELS: Record<AnnotationKind, string> = {
  correction: "Correction",
  precision: "Précision",
  jurisprudence: "Jurisprudence",
  note_perso: "Note perso",
};

export function PdfAnnotator({ fileUrl, initialPage = 1, documentId, onAnnotationCreated, originalDownloadUrl }: Props) {
  const [numPages, setNumPages] = useState<number | null>(null);
  // `page` est désormais la page la plus visible dans le scroll continu —
  // dérivée du scrollTop, pas la seule page rendue. Sert au compteur en barre
  // d'outils et reste la valeur cible pour scrollToPage.
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  // Map page → div wrapper, alimentée par les refs callbacks ci-dessous.
  // Permet à scrollToPage et au scroll-listener de retrouver chaque page.
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // "compat" si la route /api/uploads sert la version re-encodée par
  // pdftocairo (JPEG 2000 → JPEG), "original" sinon. Lu depuis le header
  // X-Pdf-Variant via une requête HEAD légère au mount. Sert à afficher
  // la transparence réglementaire dans la barre d'outils.
  const [servedVariant, setServedVariant] = useState<"compat" | "original" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mode d'interaction : "select" = sélection texte (annotations), "hand" =
  // pan au clic-glissé (utile quand le PDF est zoomé / pivoté). Le mode hand
  // suspend la capture de sélection pour ne pas créer d'annotations fantômes
  // pendant qu'on déplace la vue.
  const [tool, setTool] = useState<"select" | "hand">("select");
  // Rotation de lecture, locale au visualiseur. N'altère ni le fichier
  // stocké ni l'analyse OCR — c'est une commodité d'affichage pour les PDFs
  // déposés en paysage ou tête-bêche. Persistée par utilisateur via
  // localStorage : préférence de vue, distincte de l'orientation canonique
  // du fichier qui, elle, est détectée à l'ingestion.
  const persistenceKey = documentId ?? null;
  const ROTATION_STORAGE_PREFIX = "heureka:pdfviewer:rotation:";
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(() => {
    if (typeof window === "undefined" || !persistenceKey) return 0;
    try {
      const raw = window.localStorage.getItem(ROTATION_STORAGE_PREFIX + persistenceKey);
      const n = raw ? parseInt(raw, 10) : 0;
      return (n === 90 || n === 180 || n === 270 ? n : 0) as 0 | 90 | 180 | 270;
    } catch {
      return 0;
    }
  });
  // État interne du drag en mode hand. Pas dans le state React (pas de
  // rendu déclenché par le drag, on touche directement scrollLeft/Top).
  const panRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  // Annotation state
  const [selection, setSelection] = useState<CapturedSelection | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formKind, setFormKind] = useState<AnnotationKind>("note_perso");
  const [formVisibility, setFormVisibility] = useState<AnnotationVisibility>("private");
  const [formNote, setFormNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Quand l'appelant change la page (ex : depuis une citation cliquée),
  // on scroll vers la page cible. setPage est inutile : le scroll-listener
  // mettra à jour le compteur lui-même quand la page atteindra la vue.
  useEffect(() => {
    if (numPages == null) return;
    // Petit délai pour laisser react-pdf finir de poser la première vague de
    // pages — sans ça la cible n'a pas encore son offsetTop final.
    const id = window.setTimeout(() => scrollToPage(initialPage), 50);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPage, numPages]);

  // Raccourcis clavier — actifs uniquement quand le focus n'est pas dans un
  // champ texte (sinon "r" rentrerait dans la textarea de l'annotation).
  //   r      : pivoter à droite     R / Shift+R : pivoter à gauche
  //   0      : réinitialiser la rotation
  //   h      : outil main           v : outil sélection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case "r":
          setRotation((r) => (((r + 90) % 360) as 0 | 90 | 180 | 270));
          break;
        case "R":
          setRotation((r) => (((r + 270) % 360) as 0 | 90 | 180 | 270));
          break;
        case "0":
          setRotation(0);
          break;
        case "h":
        case "H":
          setTool("hand");
          setSelection(null);
          break;
        case "v":
        case "V":
          setTool("select");
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Détection variant (compat/original) — uniquement pour les fichiers
  // qui ont un bouton "Télécharger l'original" (= pièces du dossier).
  // Sans originalDownloadUrl on n'a rien à afficher, donc on évite la
  // requête HEAD inutile.
  useEffect(() => {
    if (!originalDownloadUrl) { setServedVariant(null); return; }
    let cancelled = false;
    fetch(fileUrl, { method: "HEAD", credentials: "include" })
      .then((r) => {
        if (cancelled) return;
        const v = r.headers.get("X-Pdf-Variant");
        setServedVariant(v === "compat" ? "compat" : "original");
      })
      .catch(() => { if (!cancelled) setServedVariant(null); });
    return () => { cancelled = true; };
  }, [fileUrl, originalDownloadUrl]);

  // Scroll vers le haut de la page p dans le conteneur scrollable. Les pages
  // sont rendues en continu : on ne change pas la page rendue, on déplace la
  // vue. `block: "start"` aligne le haut de la page sur le haut du viewport.
  const scrollToPage = (p: number) => {
    if (numPages == null) return;
    const target = pageRefs.current.get(Math.max(1, Math.min(numPages, p)));
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  // Wrapper conservé pour les chevrons et l'input — sémantique : "saute à
  // cette page" en scrollant, et nettoie la capture courante.
  const goToPage = (p: number) => {
    if (numPages == null) return;
    const next = Math.max(1, Math.min(numPages, p));
    scrollToPage(next);
    setSelection(null);
    setShowForm(false);
  };

  const SCALES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  const zoomIn = () => {
    const next = SCALES.find((s) => s > scale);
    if (next != null) setScale(next);
  };
  const zoomOut = () => {
    const prev = [...SCALES].reverse().find((s) => s < scale);
    if (prev != null) setScale(prev);
  };

  // Rotation à droite / gauche par incréments de 90°. On normalise dans
  // [0, 360) via le modulo signé pour ne jamais passer rotate={-90}.
  const rotateRight = () => setRotation((r) => (((r + 90) % 360) as 0 | 90 | 180 | 270));
  const rotateLeft = () => setRotation((r) => (((r + 270) % 360) as 0 | 90 | 180 | 270));
  const resetRotation = () => setRotation(0);

  // Persist la rotation côté navigateur. On retire la clé quand on revient
  // à 0 plutôt que d'écrire "0" pour éviter d'encombrer localStorage avec
  // une entrée par document jamais pivoté.
  useEffect(() => {
    if (typeof window === "undefined" || !persistenceKey) return;
    try {
      const key = ROTATION_STORAGE_PREFIX + persistenceKey;
      if (rotation === 0) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, String(rotation));
    } catch {
      // Quota plein ou storage désactivé (Safari privé) : on dégrade
      // silencieusement, la rotation reste fonctionnelle en mémoire.
    }
  }, [persistenceKey, rotation]);

  // Met à jour `page` selon le scroll : la page la plus centrale est
  // considérée comme "courante" pour le compteur de la barre d'outils.
  // Throttled via requestAnimationFrame pour rester économe pendant le scroll.
  useEffect(() => {
    if (numPages == null) return;
    const container = containerRef.current;
    if (!container) return;
    let rafId: number | null = null;
    const compute = () => {
      rafId = null;
      // Point de référence : un tiers depuis le haut du conteneur. Ressenti
      // plus naturel que le centre exact — la page qu'on lit occupe
      // typiquement le haut du viewport.
      const ref = container.scrollTop + container.clientHeight / 3;
      let best = { page: 1, dist: Infinity };
      pageRefs.current.forEach((el, p) => {
        const top = el.offsetTop;
        const bottom = top + el.offsetHeight;
        const dist = ref >= top && ref <= bottom
          ? 0
          : Math.min(Math.abs(ref - top), Math.abs(ref - bottom));
        if (dist < best.dist) best = { page: p, dist };
      });
      setPage((cur) => (cur === best.page ? cur : best.page));
    };
    const onScroll = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(compute);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    // Calcul initial une fois les pages mises en page.
    const initId = window.setTimeout(compute, 100);
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafId != null) cancelAnimationFrame(rafId);
      window.clearTimeout(initId);
    };
  }, [numPages, scale, rotation]);

  // Drag-to-pan en mode hand. On capture sur le conteneur scrollable et on
  // ajuste scrollLeft/scrollTop selon le delta souris. setPointerCapture
  // garantit qu'on garde les events même si le curseur sort du conteneur
  // pendant le drag.
  const onPanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== "hand") return;
    const el = containerRef.current;
    if (!el) return;
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const el = containerRef.current;
    if (!pan || !el) return;
    el.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX);
    el.scrollTop = pan.scrollTop - (e.clientY - pan.startY);
  };
  const onPanEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (panRef.current && el && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    panRef.current = null;
  };

  // Capture de la sélection texte. Déclenchée au mouseup global pour ne pas
  // rater le cas où l'utilisateur termine sa sélection en dehors de la page.
  // Si pas de documentId → pas de capture (mode lecture). En mode "hand" on
  // ignore aussi : le drag pour scroller ne doit jamais créer d'annotation.
  useEffect(() => {
    if (!documentId) return;
    if (tool !== "select") return;
    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const quote = sel.toString().trim();
      if (!quote) return;

      const range = sel.getRangeAt(0);
      // Dans le scroll continu, plusieurs pages coexistent dans le DOM : on
      // retrouve la bonne via l'ancêtre `.react-pdf__Page` du début de
      // sélection, qui porte data-page-number.
      const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
      const pageEl = startNode?.closest(".react-pdf__Page") as HTMLElement | null;
      if (!pageEl) return;
      const pageNumber = parseInt(pageEl.dataset.pageNumber || "0", 10);
      if (!pageNumber) return;

      const pageRect = pageEl.getBoundingClientRect();
      const clientRects = Array.from(range.getClientRects());
      if (clientRects.length === 0) return;

      // On ne garde que les rects qui chevauchent la page de départ — si la
      // sélection s'étend sur la page suivante, ces rects-là sont tronqués.
      // Acceptable pour la v1 : on annote sur la première page.
      const inside = clientRects.filter((r) =>
        r.width > 0 && r.height > 0 &&
        r.right > pageRect.left && r.left < pageRect.right &&
        r.bottom > pageRect.top && r.top < pageRect.bottom
      );
      if (inside.length === 0) return;

      const rects: HighlightRect[] = inside.map((r) => ({
        page: pageNumber,
        x: ((r.left - pageRect.left) / pageRect.width) * 100,
        y: ((r.top - pageRect.top) / pageRect.height) * 100,
        width: (r.width / pageRect.width) * 100,
        height: (r.height / pageRect.height) * 100,
      }));

      const lastRect = inside[inside.length - 1]!;
      setSelection({
        page: pageNumber,
        quote: quote.slice(0, 2000),
        rects,
        anchorX: lastRect.right,
        anchorY: lastRect.bottom,
      });
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [documentId, tool]);

  const openForm = () => {
    setFormKind("note_perso");
    setFormVisibility("private");
    setFormNote("");
    setSaveError(null);
    setShowForm(true);
  };

  const cancelAnnotation = () => {
    setShowForm(false);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const saveAnnotation = async () => {
    if (!documentId || !selection) return;
    if (!formNote.trim()) {
      setSaveError("La note ne peut pas être vide.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.post(`/mairie/documents/${documentId}/annotations`, {
        page: selection.page,
        quote: selection.quote,
        highlight_rects: selection.rects,
        kind: formKind,
        note: formNote.trim(),
        visibility: formVisibility,
      });
      cancelAnnotation();
      onAnnotationCreated?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-100 relative">
      {/* Barre d'outils */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white text-xs text-gray-700 shrink-0">
        <button
          type="button"
          onClick={() => goToPage(page - 1)}
          disabled={page <= 1}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Page précédente"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="tabular-nums min-w-[60px] text-center">
          {page} / {numPages ?? "…"}
        </span>
        <button
          type="button"
          onClick={() => goToPage(page + 1)}
          disabled={numPages == null || page >= numPages}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Page suivante"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <button type="button" onClick={zoomOut} disabled={scale <= SCALES[0]!} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" title="Réduire">
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="tabular-nums min-w-[40px] text-center">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={zoomIn} disabled={scale >= SCALES[SCALES.length - 1]!} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" title="Agrandir">
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        {/* Toggle outil sélection / main. En mode main, le clic-glissé
            déplace la vue (utile zoomé) et la sélection texte est suspendue. */}
        <button
          type="button"
          onClick={() => setTool("select")}
          className={`p-1 rounded ${tool === "select" ? "bg-heureka-100 text-heureka-700" : "hover:bg-gray-100"}`}
          title="Outil sélection — annoter le texte (V)"
          aria-pressed={tool === "select"}
        >
          <MousePointer2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => { setTool("hand"); setSelection(null); }}
          className={`p-1 rounded ${tool === "hand" ? "bg-heureka-100 text-heureka-700" : "hover:bg-gray-100"}`}
          title="Outil main — déplacer la vue au clic-glissé (H)"
          aria-pressed={tool === "hand"}
        >
          <Hand className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        {/* Rotation de lecture : locale au visualiseur, ne modifie pas le PDF
            stocké. Pour normaliser l'orientation côté analyse, il faudra une
            action séparée "corriger l'orientation" (cf. roadmap). */}
        <button type="button" onClick={rotateLeft} className="p-1 rounded hover:bg-gray-100" title="Pivoter à gauche (Maj+R)">
          <RotateCcw className="w-4 h-4" />
        </button>
        <button type="button" onClick={rotateRight} className="p-1 rounded hover:bg-gray-100" title="Pivoter à droite (R)">
          <RotateCw className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={resetRotation}
          disabled={rotation === 0}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Réinitialiser la rotation (0)"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        {/* Indicateur d'angle — n'apparaît qu'en rotation non nulle pour ne
            pas alourdir la barre en lecture standard. Tabular-nums évite que
            le « ° » ne saute selon le chiffre affiché. */}
        {rotation !== 0 && (
          <span className="tabular-nums text-[10px] font-semibold text-heureka-700 bg-heureka-50 border border-heureka-200 rounded px-1.5 py-0.5">
            {rotation}°
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* Tag de transparence réglementaire : visible UNIQUEMENT quand
              une variante compat est servie. Permet à l'instructeur de
              savoir au coup d'œil qu'il regarde une vue retraitée et que
              le fichier original reste accessible. */}
          {servedVariant === "compat" && originalDownloadUrl && (
            <span
              title="Le PDF affiché est une variante re-encodée pour le viewer (le JPEG 2000 d'origine empêche pdf.js de tout rendre). Le fichier déposé par le pétitionnaire est conservé tel quel et téléchargeable via le bouton ↓ ; il reste la référence officielle."
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-semibold rounded cursor-help"
            >
              <ShieldCheck className="w-3 h-3" /> Aperçu retraité
            </span>
          )}
          <input
            type="number"
            min={1}
            max={numPages ?? 1}
            value={page}
            onChange={(e) => goToPage(parseInt(e.target.value, 10) || 1)}
            className="w-14 px-1 py-0.5 text-xs border border-gray-200 rounded text-center"
            title="Aller à la page"
          />
          {originalDownloadUrl && (
            <a
              href={`${originalDownloadUrl}${originalDownloadUrl.includes("?") ? "&" : "?"}variant=original`}
              download
              className="p-1 rounded hover:bg-gray-100 text-gray-500"
              title="Télécharger le PDF original déposé (référence officielle)"
            >
              <FileDown className="w-4 h-4" />
            </a>
          )}
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-gray-100 text-gray-500"
            title="Ouvrir dans un nouvel onglet"
          >
            <Maximize2 className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Zone d'affichage du PDF. En mode hand : curseur grab/grabbing,
          user-select bloqué pour que le drag ne déclenche pas de sélection
          texte fantôme sur la couche react-pdf__Text. */}
      <div
        ref={containerRef}
        onPointerDown={onPanStart}
        onPointerMove={onPanMove}
        onPointerUp={onPanEnd}
        onPointerCancel={onPanEnd}
        className={`flex-1 overflow-auto flex justify-center p-4 ${tool === "hand" ? "cursor-grab active:cursor-grabbing select-none" : ""}`}
        style={tool === "hand" ? { touchAction: "none" } : undefined}
      >
        {error ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3 max-w-md self-start mt-8">
            Impossible d'ouvrir le PDF : {error}
          </div>
        ) : (
          <Document
            file={fileUrl}
            // withCredentials: true → cookies de session envoyés avec le fetch
            // interne de pdfjs. Sans ça, les pièces du dossier servies par
            // /api/uploads/:key (protégées par requireAuth) renvoient 401 et
            // react-pdf surface "Unexpected server response (500)".
            options={PDF_OPTIONS}
            onLoadSuccess={({ numPages }) => { setNumPages(numPages); setError(null); }}
            onLoadError={(err) => setError(err.message)}
            loading={<div className="text-sm text-gray-400 mt-12">Chargement du PDF…</div>}
            className="self-start flex flex-col gap-4"
          >
            {numPages != null && Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
              <div
                key={p}
                ref={(el) => {
                  if (el) pageRefs.current.set(p, el);
                  else pageRefs.current.delete(p);
                }}
                data-page-wrapper={p}
              >
                <Page
                  pageNumber={p}
                  scale={scale}
                  rotate={rotation}
                  renderAnnotationLayer={true}
                  renderTextLayer={true}
                  className="shadow-lg"
                />
              </div>
            ))}
          </Document>
        )}
      </div>

      {/* Bouton flottant "Annoter" — apparaît à côté de la sélection */}
      {documentId && selection && !showForm && (
        <button
          type="button"
          onClick={openForm}
          style={{
            position: "fixed",
            // Évite que le bouton sorte du viewport à droite
            left: Math.min(selection.anchorX, window.innerWidth - 140),
            top: selection.anchorY + 6,
            zIndex: 50,
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-heureka-500 hover:bg-heureka-600 text-white text-xs font-semibold rounded-lg shadow-lg"
        >
          <Highlighter className="w-3.5 h-3.5" /> Annoter
        </button>
      )}

      {/* Mini-form d'annotation — overlay à droite du viewer */}
      {documentId && selection && showForm && (
        <div
          style={{ position: "absolute", top: 50, right: 12, width: 320, zIndex: 60 }}
          className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500">Annoter le passage</div>
            <button type="button" onClick={cancelAnnotation} className="text-gray-400 hover:text-gray-700">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Citation */}
          <div className="text-xs text-gray-600 italic border-l-2 border-yellow-300 bg-yellow-50/50 pl-2 py-1 rounded-r max-h-20 overflow-y-auto">
            « {selection.quote.slice(0, 200)}{selection.quote.length > 200 ? "…" : ""} »
          </div>
          <div className="text-[10px] text-gray-400 -mt-1">Page {selection.page}</div>

          {/* Toggle visibilité */}
          <div className={`flex items-center gap-2 p-2 rounded-lg border ${formVisibility === "shared" ? "bg-green-50 border-green-200" : "bg-violet-50 border-violet-200"}`}>
            <div className="flex-1">
              <div className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                {formVisibility === "shared" ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {formVisibility === "shared" ? "Partagée à l'IA" : "Privée"}
              </div>
              <div className="text-[10px] text-gray-600 mt-0.5">
                {formVisibility === "shared"
                  ? "Pourra alimenter les futures instructions, après validation."
                  : "Visible par toi seul. L'IA ne la verra jamais."}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFormVisibility((v) => v === "private" ? "shared" : "private")}
              className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${formVisibility === "shared" ? "bg-green-500" : "bg-gray-300"}`}
              aria-label="Basculer privé/partagé"
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formVisibility === "shared" ? "translate-x-[18px]" : "translate-x-0.5"}`} />
            </button>
          </div>

          {/* Chips de kind */}
          <div className="flex flex-wrap gap-1">
            {(Object.keys(KIND_LABELS) as AnnotationKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFormKind(k)}
                className={`text-[11px] px-2 py-1 rounded border ${formKind === k ? "bg-heureka-500 text-white border-heureka-500" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>

          {/* Textarea */}
          <textarea
            value={formNote}
            onChange={(e) => setFormNote(e.target.value)}
            placeholder="Ta note…"
            rows={3}
            className="w-full text-xs border border-gray-200 rounded-lg p-2 resize-y focus:outline-none focus:ring-2 focus:ring-heureka-500/30"
            autoFocus
          />

          {saveError && (
            <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{saveError}</div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelAnnotation}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={saveAnnotation}
              disabled={saving || !formNote.trim()}
              className="text-xs px-3 py-1.5 rounded bg-heureka-500 text-white font-semibold hover:bg-heureka-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
