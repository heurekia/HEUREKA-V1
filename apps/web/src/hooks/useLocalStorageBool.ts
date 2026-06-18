import { useCallback, useEffect, useState } from "react";

/**
 * Booléen persisté en localStorage. Utilisé pour les préférences de layout de
 * l'instructeur (panneaux repliés, etc.) afin qu'elles survivent entre dossiers
 * et rechargements. Dégrade silencieusement si localStorage est indisponible
 * (mode privé Safari…).
 */
export function useLocalStorageBool(
  key: string,
  defaultValue = false,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch { /* localStorage indispo → défaut */ }
    return defaultValue;
  });

  useEffect(() => {
    try { window.localStorage.setItem(key, value ? "1" : "0"); } catch { /* idem */ }
  }, [key, value]);

  const set = useCallback((v: boolean) => setValue(v), []);
  return [value, set];
}
