import { useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { api, ApiError } from "../../lib/api";

const DEFAULT_TITLE = "Le système arrive prochainement";
const DEFAULT_MESSAGE =
  "La plateforme Heurekia ouvre bientôt. Si vous disposez d'un mot de passe d'accès, saisissez-le ci-dessous pour la découvrir en avant-première.";

// Logo Heurekia (hexagone) — repris de l'identité du back-office super-admin.
function HeurekiaLogo({ size = 72 }: { size?: number }) {
  return (
    <svg viewBox="0 0 34 34" fill="none" style={{ width: size, height: size }} aria-hidden>
      <polygon points="17,2 31,9.5 31,24.5 17,32 3,24.5 3,9.5" fill="#FFFFFF" opacity="0.18" stroke="#FFFFFF" strokeWidth="1.2" />
      <polygon points="17,7 27,12.5 27,23.5 17,29 7,23.5 7,12.5" fill="#FFFFFF" opacity="0.4" />
      <polygon points="17,11 23,14.5 23,21.5 17,25 11,21.5 11,14.5" fill="#FFFFFF" />
      <text x="17" y="21" textAnchor="middle" fontSize="9" fontWeight="800" fill="#4F46E5" fontFamily="sans-serif">H</text>
    </svg>
  );
}

/**
 * Page vitrine « bientôt en ligne ». Affichée par <ComingSoonGate> tant que le
 * portail public est verrouillé. Sur mot de passe correct, l'API pose un cookie
 * de déverrouillage et on appelle onUnlock() pour ré-afficher le site.
 */
export function ComingSoon({
  title,
  message,
  onUnlock,
}: {
  title: string | null;
  message: string | null;
  onUnlock: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const heading = title?.trim() || DEFAULT_TITLE;
  const body = message?.trim() || DEFAULT_MESSAGE;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/public/site-access", { password });
      onUnlock();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Mot de passe incorrect.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Trop de tentatives. Réessayez dans quelques minutes.");
      } else {
        setError("Une erreur est survenue. Réessayez.");
      }
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        background: "linear-gradient(135deg, #4F46E5 0%, #312E81 60%, #1E1B4B 100%)",
        color: "white",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <Helmet>
        <title>Heurekia — Bientôt disponible</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <HeurekiaLogo />
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.12em", marginTop: 16 }}>HEUREKIA</div>

        <h1 style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2, margin: "28px 0 12px" }}>{heading}</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.85, margin: 0 }}>{body}</p>

        <form onSubmit={handleSubmit} style={{ width: "100%", marginTop: 32 }}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe d'accès"
            autoFocus
            autoComplete="current-password"
            aria-label="Mot de passe d'accès"
            style={{
              width: "100%",
              padding: "13px 16px",
              fontSize: 15,
              borderRadius: 10,
              border: error ? "1px solid #FCA5A5" : "1px solid rgba(255,255,255,0.25)",
              background: "rgba(255,255,255,0.12)",
              color: "white",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {error && (
            <div style={{ color: "#FECACA", fontSize: 13, marginTop: 10 }}>{error}</div>
          )}
          <button
            type="submit"
            disabled={submitting || !password.trim()}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px 16px",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 10,
              border: "none",
              cursor: submitting || !password.trim() ? "not-allowed" : "pointer",
              background: "white",
              color: "#4F46E5",
              opacity: submitting || !password.trim() ? 0.6 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {submitting ? "Vérification…" : "Accéder au site"}
          </button>
        </form>

        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 36 }}>
          © {new Date().getFullYear()} Heurekia — L'urbanisme simplifié
        </div>
      </div>
    </div>
  );
}
