import { useEffect, useState } from "react";

/**
 * Suit une media query CSS et renvoie `true` quand elle correspond.
 * SSR-safe (renvoie `false` tant que `window` n'est pas disponible).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * `true` sous le seuil mobile (par défaut 640px, breakpoint `sm` de Tailwind).
 * Sert à basculer une mise en page inline (grilles, lignes flex) en colonne
 * sur petit écran SANS toucher au rendu desktop : au-dessus du seuil, le hook
 * renvoie `false` et les valeurs d'origine sont conservées telles quelles.
 */
export function useIsMobile(maxWidthPx = 640): boolean {
  return useMediaQuery(`(max-width: ${maxWidthPx}px)`);
}
