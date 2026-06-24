import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { ComingSoon } from "../pages/public/ComingSoon";

interface SiteStatus {
  comingSoon: boolean;
  unlocked: boolean;
  title: string | null;
  message: string | null;
}

// Verrou du portail public. Tant que l'état n'est pas connu, on n'affiche RIEN
// du site réel (sinon le contenu « fuiterait » une fraction de seconde avant le
// verrou). Une fois l'état chargé :
//   - mode actif + non déverrouillé → page vitrine ;
//   - sinon → site normal.
// Le super-admin (app.heurekia.com) n'est jamais enveloppé par ce composant : il
// reste donc toujours joignable pour désactiver le mode.
export function ComingSoonGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SiteStatus | null>(null);

  const load = useCallback(() => {
    api
      .get<SiteStatus>("/public/site-status")
      .then(setStatus)
      // Fail-open : si le statut est injoignable, on n'enferme pas le visiteur.
      .catch(() => setStatus({ comingSoon: false, unlocked: true, title: null, message: null }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Splash neutre aux couleurs de la marque pendant le chargement du statut.
  if (!status) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #4F46E5 0%, #312E81 60%, #1E1B4B 100%)",
        }}
      />
    );
  }

  if (status.comingSoon && !status.unlocked) {
    return <ComingSoon title={status.title} message={status.message} onUnlock={load} />;
  }

  return <>{children}</>;
}
