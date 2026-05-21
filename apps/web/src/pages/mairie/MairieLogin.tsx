import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

export function MairieLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const u = await login(email, password);
      if (u.role === "mairie" || u.role === "instructeur" || u.role === "admin") {
        navigate("/mairie", { replace: true });
      } else {
        setError("Ce portail est réservé aux agents de mairie et instructeurs.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Identifiants incorrects");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f1629 0%, #1a2540 50%, #0f1629 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Background decoration */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: "10%", right: "10%", width: 300, height: 300, background: "#4F46E5", borderRadius: "50%", opacity: 0.04, filter: "blur(80px)" }} />
        <div style={{ position: "absolute", bottom: "15%", left: "8%", width: 250, height: 250, background: "#7C3AED", borderRadius: "50%", opacity: 0.05, filter: "blur(60px)" }} />
      </div>

      <div style={{ width: "100%", maxWidth: 440, position: "relative" }}>
        {/* Card */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 20,
          padding: "40px 40px 36px",
          backdropFilter: "blur(20px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
        }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <div style={{ width: 44, height: 44, flexShrink: 0 }}>
              <svg viewBox="0 0 34 34" fill="none" style={{ width: "100%", height: "100%" }}>
                <polygon points="17,2 31,9.5 31,24.5 17,32 3,24.5 3,9.5" fill="#4F46E5" opacity="0.15" stroke="#4F46E5" strokeWidth="1.5"/>
                <polygon points="17,7 27,12.5 27,23.5 17,29 7,23.5 7,12.5" fill="#4F46E5" opacity="0.4"/>
                <polygon points="17,11 23,14.5 23,21.5 17,25 11,21.5 11,14.5" fill="#4F46E5"/>
                <text x="17" y="21" textAnchor="middle" fontSize="9" fontWeight="800" fill="white" fontFamily="sans-serif">H</text>
              </svg>
            </div>
            <div>
              <div style={{ color: "white", fontWeight: 800, fontSize: 20, letterSpacing: "0.05em", lineHeight: 1 }}>HEUREKA</div>
              <div style={{ color: "#64748b", fontSize: 11, marginTop: 2, letterSpacing: "0.08em", textTransform: "uppercase" }}>Espace Mairie</div>
            </div>
          </div>

          {/* Heading */}
          <h1 style={{ color: "white", fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Connexion</h1>
          <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 28px", lineHeight: 1.5 }}>
            Accédez au portail de gestion des autorisations d'urbanisme.
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {error && (
              <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#FCA5A5", borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
                {error}
              </div>
            )}

            <div>
              <label style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 6, letterSpacing: "0.04em" }}>
                ADRESSE EMAIL
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="agent@mairie.fr"
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10, padding: "11px 14px", color: "white", fontSize: 14,
                  outline: "none", transition: "border-color 0.15s",
                }}
                onFocus={e => (e.target.style.borderColor = "#4F46E5")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
              />
            </div>

            <div>
              <label style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 6, letterSpacing: "0.04em" }}>
                MOT DE PASSE
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10, padding: "11px 14px", color: "white", fontSize: 14,
                  outline: "none", transition: "border-color 0.15s",
                }}
                onFocus={e => (e.target.style.borderColor = "#4F46E5")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 4,
                width: "100%", padding: "12px 0",
                background: loading ? "#3730a3" : "#4F46E5",
                color: "white", border: "none", borderRadius: 10,
                fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
                transition: "background 0.15s", letterSpacing: "0.02em",
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#4338CA"; }}
              onMouseLeave={e => { if (!loading) e.currentTarget.style.background = "#4F46E5"; }}
            >
              {loading ? "Connexion en cours…" : "Se connecter"}
            </button>
          </form>

          {/* Footer */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
            <p style={{ color: "#475569", fontSize: 12, margin: 0 }}>
              Portail réservé aux agents municipaux.{" "}
              <a href="/login" style={{ color: "#818cf8", textDecoration: "none" }}>Accès citoyen →</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
