import { useState } from "react";
import { useAuth, type User } from "../hooks/useAuth";

/**
 * 2e étape de connexion quand la MFA est activée : saisie du code TOTP (ou d'un
 * code de secours). Style sombre, aligné sur les écrans de login mairie/admin.
 */
export function MfaLoginStep({ ticket, onVerified }: { ticket: string; onVerified: (u: User) => void }) {
  const { verifyMfaLogin } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const u = await verifyMfaLogin(ticket, code.trim());
      onVerified(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Code invalide");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
        Saisissez le code à 6 chiffres de votre application d'authentification
        (ou l'un de vos codes de secours).
      </p>
      {error && (
        <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#FCA5A5", borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          {error}
        </div>
      )}
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
        autoFocus
        inputMode="text"
        autoComplete="one-time-code"
        placeholder="123 456"
        style={{
          width: "100%", boxSizing: "border-box",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10, padding: "11px 14px", color: "white", fontSize: 18,
          letterSpacing: "0.25em", textAlign: "center", outline: "none",
        }}
      />
      <button
        type="submit"
        disabled={loading}
        style={{
          width: "100%", padding: "12px 0",
          background: loading ? "#3730a3" : "#4F46E5",
          color: "white", border: "none", borderRadius: 10,
          fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Vérification…" : "Vérifier"}
      </button>
    </form>
  );
}
