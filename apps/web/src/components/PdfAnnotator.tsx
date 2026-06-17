import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

// Setup du worker pdfjs — sans ça pdf.js démarre un worker depuis un CDN
// (incompatible CSP) ou échoue silencieusement. On l'inclut via import.meta.url
// pour que Vite l'embarque dans le bundle au lieu d'un fetch externe.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/**
 * Visualiseur PDF avec couches text + annotations natives — base du système
 * d'annotation Adobe-like (3.C.3). Remplace l'iframe historique : on garde
 * désormais la main sur la sélection de texte (3.C.3c), les surlignages
 * persistants (3.C.3d) et les popovers d'annotation au-dessus de la page.
 *
 * Architecture :
 *  - react-pdf rend chaque page sur un canvas + une couche text (sélectionnable)
 *  - La sélection texte est capturée via mouseup + window.getSelection()
 *  - Les surlignages enregistrés sont restitués via un overlay positionné
 *    aux coordonnées en pourcentage de la page (robuste au zoom)
 */
interface Props {
  /** URL du PDF (route /api/mairie/documents/:id/pdf). */
  fileUrl: string;
  /** Page sur laquelle ouvrir le viewer. 1 par défaut. */
  initialPage?: number;
}

export function PdfAnnotator({ fileUrl, initialPage = 1 }: Props) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="flex flex-col h-full bg-gray-100">
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
    </div>
  );
}
