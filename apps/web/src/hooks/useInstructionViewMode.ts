import { useCallback, useEffect, useState } from "react";

/**
 * Mode d'affichage de la vue Instruction d'un dossier.
 *
 *  - `apercu`  : layout 3 colonnes (pièces · viewer · documentation) — défaut historique
 *  - `compare` : 2 viewers côte à côte (pièce ↔ document réglementaire), pour confronter
 *                un plan à une règle du PLU sans alterner. Les panneaux latéraux passent
 *                en bandes escamotées.
 *  - `lecture` : 1 viewer plein écran sur fond papier, sidebars en bandes. Pour lire un
 *                document longuement sans distraction (objectif : casser le réflexe d'imprimer).
 */
export type InstructionViewMode = "apercu" | "compare" | "lecture";

const STORAGE_KEY = "heureka.instructionViewMode";

function load(): InstructionViewMode {
  if (typeof window === "undefined") return "apercu";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "apercu" || raw === "compare" || raw === "lecture") return raw;
  } catch { /* localStorage indispo (private mode Safari, etc.) → défaut */ }
  return "apercu";
}

/**
 * Mémorise le mode de l'instructeur entre dossiers. Préférence utilisateur,
 * pas réglage par dossier : si Marie aime travailler en Comparer, tous ses
 * dossiers s'ouvrent dans ce mode.
 */
export function useInstructionViewMode(): [InstructionViewMode, (m: InstructionViewMode) => void] {
  const [mode, setModeState] = useState<InstructionViewMode>(() => load());

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* idem */ }
  }, [mode]);

  const setMode = useCallback((m: InstructionViewMode) => setModeState(m), []);

  return [mode, setMode];
}
