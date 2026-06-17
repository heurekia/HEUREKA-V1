import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2,
  Highlighter, X, Eye, EyeOff,
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
const PDF_OPTIONS = { withCredentials: true } as const;

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
}

const KIND_LABELS: Record<AnnotationKind, string> = {
  correction: "Correction",
  precision: "Précision",
  jurisprudence: "Jurisprudence",
  note_perso: "Note perso",
};

export function PdfAnnotator({ fileUrl, initialPage = 1, documentId, onAnnotationCreated }: Props) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Annotation state
  const [selection, setSelection] = useState<CapturedSelection | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formKind, setFormKind] = useState<AnnotationKind>("note_perso");
  const [formVisibility, setFormVisibility] = useState<AnnotationVisibility>("private");
  const [formNote, setFormNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Quand l'appelant change la page (ex : depuis une citation cliquée),
  // on s'aligne. Sans cet effet on resterait sur la page initiale du mount.
  useEffect(() => {
    setPage(initialPage);
  }, [initialPage]);

  // Saute à une page en réinitialisant le scroll en haut du conteneur.
  const goToPage = (p: number) => {
    if (numPages == null) return;
    const next = Math.max(1, Math.min(numPages, p));
    setPage(next);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    // Toute capture en cours est invalidée par un changement de page
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

  // Capture de la sélection texte. Déclenchée au mouseup global pour ne pas
  // rater le cas où l'utilisateur termine sa sélection en dehors de la page.
  // Si pas de documentId → pas de capture (mode lecture).
  useEffect(() => {
    if (!documentId) return;
    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const quote = sel.toString().trim();
      if (!quote) return;

      // Trouve la page courante via le DOM react-pdf
      const pageEl = containerRef.current?.querySelector(".react-pdf__Page") as HTMLElement | null;
      if (!pageEl) return;
      const pageRect = pageEl.getBoundingClientRect();
      const range = sel.getRangeAt(0);
      const clientRects = Array.from(range.getClientRects());
      if (clientRects.length === 0) return;

      // On ne garde que les rects qui chevauchent la page (sinon on capture
      // des sélections qui partent de la marge ou d'un autre élément).
      const inside = clientRects.filter((r) =>
        r.width > 0 && r.height > 0 &&
        r.right > pageRect.left && r.left < pageRect.right &&
        r.bottom > pageRect.top && r.top < pageRect.bottom
      );
      if (inside.length === 0) return;

      const rects: HighlightRect[] = inside.map((r) => ({
        page,
        x: ((r.left - pageRect.left) / pageRect.width) * 100,
        y: ((r.top - pageRect.top) / pageRect.height) * 100,
        width: (r.width / pageRect.width) * 100,
        height: (r.height / pageRect.height) * 100,
      }));

      const lastRect = inside[inside.length - 1]!;
      setSelection({
        page,
        quote: quote.slice(0, 2000),
        rects,
        anchorX: lastRect.right,
        anchorY: lastRect.bottom,
      });
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [documentId, page]);

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
        <div className="ml-auto flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={numPages ?? 1}
            value={page}
            onChange={(e) => goToPage(parseInt(e.target.value, 10) || 1)}
            className="w-14 px-1 py-0.5 text-xs border border-gray-200 rounded text-center"
            title="Aller à la page"
          />
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

      {/* Zone d'affichage du PDF */}
      <div ref={containerRef} className="flex-1 overflow-auto flex justify-center p-4">
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
            className="self-start"
          >
            <Page
              pageNumber={page}
              scale={scale}
              renderAnnotationLayer={true}
              renderTextLayer={true}
              className="shadow-lg"
            />
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
