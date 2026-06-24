import { useCallback, useEffect, useState } from "react";

/**
 * Booléen mémorisé dans `localStorage` — préférence utilisateur conservée entre
 * sessions et entre dossiers (même logique que `useInstructionViewMode`).
 *
 * Utilisé pour retenir l'état « plié / déplié » des barres d'outils des
 * visualiseurs de documents : si un instructeur replie les outils pour lire un
 * plan au calme, tous ses documents s'ouvrent ensuite dans cet état.
 *
 * Retourne `[valeur, setValeur, basculer]`.
 */
export function usePersistentBoolean(
  key: string,
  fallback = false,
): [boolean, (v: boolean) => void, () => void] {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch { /* localStorage indispo (private mode Safari, etc.) → défaut */ }
    return fallback;
  });

  useEffect(() => {
    try { window.localStorage.setItem(key, value ? "1" : "0"); } catch { /* idem */ }
  }, [key, value]);

  const toggle = useCallback(() => setValue((v) => !v), []);

  return [value, setValue, toggle];
}
