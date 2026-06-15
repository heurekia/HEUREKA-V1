import { useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Badge, statusLabels as _statusLabels } from "./ui/badge";
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  FileText,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";

void _statusLabels;

export interface PieceLite {
  id: string;
  nom: string;
  url: string;
  type: string;
  code_piece: string | null;
  instructeur_status: string | null;
}

interface Props {
  piece: PieceLite | null;
  // Quand l'utilisateur active "agrandir", on remonte l'événement pour qu'un
  // overlay parent prenne la main (full-screen lecture libre, sans tronquer la
  // documentation contextuelle). Optionnel.
  onExpand?: () => void;
}

const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200, 300] as const;
const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] ?? 300;

// Visualiseur inline de la pièce sélectionnée. Les PDF utilisent le viewer
// natif du navigateur (Chrome/Edge/Firefox supportent `#zoom=` dans le
// fragment d'URL — on l'utilise pour contrôler l'agrandissement sans dépendre
// d'une lib externe). Les images sont rendues avec une transformation CSS,
// pannable au sein du conteneur.
//
// Choix volontaire : pas de pdf.js ni de canvas custom. Le viewer du
// navigateur sait déjà rendre, paginer, copier-coller et imprimer un PDF —
// ré-implémenter tout cela en JS serait coûteux et inférieur en ergonomie.
export function PieceViewer({ piece, onExpand }: Props) {
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);

  const kind = useMemo<"pdf" | "image" | "other">(() => {
    if (!piece) return "other";
    const t = (piece.type ?? "").toLowerCase();
    if (t === "application/pdf" || piece.url.toLowerCase().endsWith(".pdf")) return "pdf";
    if (t.startsWith("image/")) return "image";
    return "other";
  }, [piece]);

  if (!piece) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[420px] text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200 p-8">
        <FileText className="w-10 h-10 mb-2" />
        <p className="text-sm">Sélectionnez une pièce à examiner.</p>
      </div>
    );
  }

  const zoomIn = () => {
    const next = ZOOM_LEVELS.find((z) => z > zoom);
    if (next != null) setZoom(next);
  };
  const zoomOut = () => {
    const prev = [...ZOOM_LEVELS].reverse().find((z) => z < zoom);
    if (prev != null) setZoom(prev);
  };
  const resetView = () => {
    setZoom(100);
    setRotation(0);
  };

  // URL avec fragment d'agrandissement — interprété par le viewer PDF natif
  // de Chromium / Firefox. La page reste fixe (pas de #page=) : c'est à
  // l'utilisateur de feuilleter.
  const pdfUrl = kind === "pdf" ? `${piece.url}#zoom=${zoom}&toolbar=1&navpanes=0` : piece.url;

  return (
    <div className="flex flex-col h-full min-h-[420px] rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Barre d'outils du viewer */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {kind === "pdf" ? (
            <FileText className="w-4 h-4 text-gray-400 shrink-0" />
          ) : kind === "image" ? (
            <ImageIcon className="w-4 h-4 text-gray-400 shrink-0" />
          ) : (
            <FileText className="w-4 h-4 text-gray-400 shrink-0" />
          )}
          {piece.code_piece && (
            <span className="font-mono text-[11px] text-gray-500 shrink-0">{piece.code_piece}</span>
          )}
          <span className="text-sm text-[#000020] truncate" title={piece.nom}>{piece.nom}</span>
          {piece.instructeur_status && (
            <Badge
              variant={
                piece.instructeur_status === "valide"
                  ? "success"
                  : piece.instructeur_status === "rejete"
                    ? "danger"
                    : "warning"
              }
            >
              {piece.instructeur_status === "valide"
                ? "Validée"
                : piece.instructeur_status === "rejete"
                  ? "Rejetée"
                  : "Complément demandé"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            title="Réduire"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-xs text-gray-600 w-12 text-center tabular-nums">{zoom}%</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            title="Agrandir"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          {kind === "image" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              title="Pivoter 90°"
            >
              <RotateCw className="w-4 h-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetView}
            title="100 %"
            className="text-[11px] px-2"
          >
            100&nbsp;%
          </Button>
          <a
            href={piece.url}
            download={piece.nom}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg hover:bg-gray-100 text-gray-600"
            title="Télécharger"
          >
            <Download className="w-4 h-4" />
          </a>
          <a
            href={piece.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg hover:bg-gray-100 text-gray-600"
            title="Ouvrir dans un nouvel onglet"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          {onExpand && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={onExpand}
              title="Plein écran"
            >
              <Maximize2 className="w-4 h-4" />
              Plein écran
            </Button>
          )}
        </div>
      </div>

      {/* Zone d'affichage du document */}
      <div className="flex-1 overflow-auto bg-gray-100">
        {kind === "pdf" && (
          // key sur l'URL : un changement de zoom force un nouveau load (le
          // fragment seul ne suffit pas systématiquement à reflow chez tous
          // les viewers). Ralentit peu, et garantit que +/- agit toujours.
          <iframe
            key={pdfUrl}
            src={pdfUrl}
            title={piece.nom}
            className="w-full h-full min-h-[420px] border-0 bg-white"
          />
        )}

        {kind === "image" && (
          <div className="w-full h-full min-h-[420px] flex items-start justify-center p-4">
            <img
              src={piece.url}
              alt={piece.nom}
              draggable={false}
              style={{
                transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                transformOrigin: "top center",
                transition: "transform 0.1s ease-out",
                maxWidth: "100%",
              }}
              className="select-none shadow-sm"
            />
          </div>
        )}

        {kind === "other" && (
          <div className="w-full h-full min-h-[420px] flex flex-col items-center justify-center text-gray-500 gap-3 p-8">
            <FileText className="w-10 h-10 text-gray-300" />
            <p className="text-sm">Prévisualisation non disponible pour ce type de fichier.</p>
            <a
              href={piece.url}
              download={piece.nom}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
              Télécharger {piece.nom}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// Overlay plein écran : couvre toute la page, ferme à l'Esc, et embarque
// son propre PieceViewer (qui retombe sur son propre toolbar).
export function PieceViewerFullscreen({
  piece,
  onClose,
}: {
  piece: PieceLite | null;
  onClose: () => void;
}) {
  if (!piece) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 flex flex-col p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex justify-end mb-2">
        <Button variant="default" size="sm" onClick={onClose}>
          Fermer (Échap)
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <PieceViewer piece={piece} />
      </div>
    </div>
  );
}
