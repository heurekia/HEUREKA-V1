import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";

const TYPES = [
  { key: "question", label: "Question", icon: "❓" },
  { key: "bug", label: "Problème technique", icon: "🐞" },
  { key: "evolution", label: "Demande d'évolution", icon: "💡" },
  { key: "autre", label: "Autre", icon: "✉️" },
];

// Formulaire « Contacter le support » : envoie une demande d'aide à l'équipe
// support (POST /mairie/support). L'identité et le contexte (commune, rôle,
// page) sont joints automatiquement côté serveur pour accélérer le traitement.
export function SupportModal({ defaultType = "question", onClose }: { defaultType?: string; onClose: () => void }) {
  const { user } = useAuth();
  const [type, setType] = useState(defaultType);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!message.trim()) { setError("Merci de décrire votre demande."); return; }
    setSending(true); setError(null);
    try {
      await api.post("/mairie/support", { type, subject: subject.trim() || undefined, message: message.trim(), url: window.location.href });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Envoi impossible. Réessayez plus tard.");
    } finally { setSending(false); }
  };

  const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 9100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 520, boxShadow: "0 24px 70px rgba(0,0,0,0.28)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #E2E8F0" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>Contacter le support</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 22, color: "#94a3b8", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {sent ? (
          <div style={{ padding: "40px 28px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Demande envoyée</div>
            <div style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, marginBottom: 24 }}>
              Notre équipe vous répondra par email à <strong>{user?.email}</strong> dans les meilleurs délais.
            </div>
            <button onClick={onClose} style={{ padding: "10px 22px", borderRadius: 8, border: "none", background: "#4F46E5", color: "white", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Fermer</button>
          </div>
        ) : (
          <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>Type de demande</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {TYPES.map((t) => (
                  <button key={t.key} onClick={() => setType(t.key)} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13, textAlign: "left",
                    border: type === t.key ? "1px solid #4F46E5" : "1px solid #E2E8F0",
                    background: type === t.key ? "#EEF2FF" : "white",
                    color: type === t.key ? "#4F46E5" : "#374151", fontWeight: type === t.key ? 600 : 400,
                  }}>
                    <span>{t.icon}</span> {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 6 }}>Sujet (optionnel)</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Résumé en quelques mots" maxLength={200} style={inp} />
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 6 }}>Votre message</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Décrivez votre demande le plus précisément possible…" rows={5} maxLength={5000} style={{ ...inp, resize: "vertical", minHeight: 110 }} autoFocus />
            </div>

            <div style={{ fontSize: 11.5, color: "#94a3b8", background: "#F8FAFC", borderRadius: 8, padding: "10px 12px", lineHeight: 1.5 }}>
              ℹ️ Pour accélérer le traitement, votre nom{user?.commune ? ", votre commune" : ""}, votre rôle et la page consultée sont joints automatiquement.
              <br />Merci de ne pas inclure de données personnelles d'un pétitionnaire — référencez plutôt le numéro de dossier.
            </div>

            {error && <div style={{ fontSize: 13, color: "#DC2626", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px" }}>{error}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #E2E8F0", background: "white", color: "#64748b", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Annuler</button>
              <button onClick={submit} disabled={sending} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: sending ? "#A5B4FC" : "#4F46E5", color: "white", fontSize: 14, fontWeight: 700, cursor: sending ? "not-allowed" : "pointer" }}>
                {sending ? "Envoi…" : "Envoyer"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
