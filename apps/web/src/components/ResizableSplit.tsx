import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Split horizontal 2 panneaux avec poignée de redimensionnement à la souris.
 * Pas de dépendance externe : `react-split-pane` n'est plus maintenu et
 * importer 200 ko pour ça serait abusif.
 *
 * La position est exprimée en pourcentage (0-100) pour rester valide quand
 * la fenêtre est redimensionnée. Min 20 % / max 80 % pour qu'un panneau ne
 * disparaisse jamais entièrement.
 */
interface Props {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Pourcentage initial occupé par le panneau gauche. Défaut : 50. */
  defaultLeftPct?: number;
  /** Clé localStorage si on veut persister la position entre sessions. */
  storageKey?: string;
}

const MIN_PCT = 20;
const MAX_PCT = 80;

export function ResizableSplit({ left, right, defaultLeftPct = 50, storageKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState<number>(() => {
    if (storageKey && typeof window !== "undefined") {
      const raw = window.localStorage.getItem(storageKey);
      const n = raw ? Number(raw) : NaN;
      if (!Number.isNaN(n) && n >= MIN_PCT && n <= MAX_PCT) return n;
    }
    return defaultLeftPct;
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!storageKey) return;
    try { window.localStorage.setItem(storageKey, String(leftPct)); } catch { /* ignore */ }
  }, [leftPct, storageKey]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box) return;
      const pct = ((e.clientX - box.left) / box.width) * 100;
      setLeftPct(Math.max(MIN_PCT, Math.min(MAX_PCT, pct)));
    };
    const onUp = () => setDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  return (
    <div
      ref={containerRef}
      className="flex w-full h-full"
      style={{ userSelect: dragging ? "none" : "auto", cursor: dragging ? "col-resize" : "auto" }}
    >
      <div style={{ width: `${leftPct}%` }} className="min-w-0 h-full overflow-hidden">{left}</div>
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={() => setLeftPct(defaultLeftPct)}
        className="w-1 bg-gray-200 hover:bg-heureka-500 cursor-col-resize shrink-0 transition-colors"
        title="Glisser pour redimensionner · double-clic pour 50/50"
        aria-label="Redimensionner les panneaux"
      />
      <div style={{ width: `${100 - leftPct}%` }} className="min-w-0 h-full overflow-hidden">{right}</div>
    </div>
  );
}
