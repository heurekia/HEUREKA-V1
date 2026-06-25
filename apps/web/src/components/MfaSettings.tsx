import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";

/**
 * Panneau de gestion de la double authentification (TOTP) pour un compte
 * agent/admin. Autonome : à insérer dans une page de compte. Ne s'affiche pas
 * pour les comptes non éligibles (citoyens).
 */
export function MfaSettings() {
  const { user, refreshUser } = useAuth();
  const [setupQr, setSetupQr] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [showDisable, setShowDisable] = useState(false);
  const [disablePwd, setDisablePwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!user?.mfa_available) return null;

  const card: React.CSSProperties = { border: "1px solid #E5E7EB", borderRadius: 12, padding: 20, background: "white" };
  const btn = (bg: string): React.CSSProperties => ({ padding: "10px 18px", background: bg, color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 });
  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 14, outline: "none" };

  const startSetup = async () => {
    setBusy(true); setMsg(null); setBackupCodes(null);
    try {
      const r = await api.post<{ secret: string; qr_data_url: string }>("/auth/mfa/setup");
      setSetupSecret(r.secret); setSetupQr(r.qr_data_url); setCode("");
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" }); }
    finally { setBusy(false); }
  };

  const confirmEnable = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<{ backup_codes: string[] }>("/auth/mfa/enable", { code: code.trim() });
      setBackupCodes(r.backup_codes); setSetupQr(null); setSetupSecret(""); setCode("");
      await refreshUser();
      setMsg({ ok: true, text: "Double authentification activée." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Code invalide" }); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.post("/auth/mfa/disable", { password: disablePwd || undefined, code: code.trim() || undefined });
      await refreshUser();
      setShowDisable(false); setDisablePwd(""); setCode(""); setBackupCodes(null);
      setMsg({ ok: true, text: "Double authentification désactivée." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}>
      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#111827" }}>Double authentification (2FA)</h3>
        <p style={{ margin: 0, fontSize: 13, color: "#6B7280" }}>
          Renforce la sécurité de votre compte avec un code à usage unique généré par une
          application (Google Authenticator, Microsoft Authenticator, FreeOTP…).
        </p>
      </div>

      {msg && (
        <div style={{ fontSize: 13, padding: "8px 12px", borderRadius: 8, background: msg.ok ? "#ECFDF5" : "#FEF2F2", color: msg.ok ? "#065F46" : "#991B1B", border: `1px solid ${msg.ok ? "#A7F3D0" : "#FECACA"}` }}>{msg.text}</div>
      )}

      {/* Codes de secours affichés une seule fois après activation */}
      {backupCodes && (
        <div style={{ ...card, background: "#FFFBEB", borderColor: "#FDE68A" }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "#92400E" }}>
            Conservez ces codes de secours en lieu sûr — ils ne seront plus affichés.
          </p>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "#92400E" }}>
            Chacun est utilisable une seule fois si vous perdez l'accès à votre application.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontFamily: "monospace", fontSize: 14, color: "#111827" }}>
            {backupCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button style={{ ...btn("#4F46E5"), marginTop: 14 }} onClick={() => setBackupCodes(null)}>J'ai noté mes codes</button>
        </div>
      )}

      {/* État activé */}
      {user.mfa_enabled && !setupQr && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#065F46" }}>Activée</span>
          </div>
          {!showDisable ? (
            <button style={btn("#DC2626")} onClick={() => { setShowDisable(true); setMsg(null); }}>Désactiver</button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>Confirmez avec un code de votre application OU votre mot de passe :</p>
              <input style={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code à 6 chiffres" autoComplete="one-time-code" />
              <input style={input} type="password" value={disablePwd} onChange={(e) => setDisablePwd(e.target.value)} placeholder="Mot de passe (alternative)" />
              <div style={{ display: "flex", gap: 8 }}>
                <button style={btn("#DC2626")} disabled={busy} onClick={disable}>Confirmer la désactivation</button>
                <button style={{ ...btn("#6B7280") }} disabled={busy} onClick={() => { setShowDisable(false); setDisablePwd(""); setCode(""); }}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* État désactivé → bouton d'activation */}
      {!user.mfa_enabled && !setupQr && (
        <div><button style={btn("#4F46E5")} disabled={busy} onClick={startSetup}>Activer la double authentification</button></div>
      )}

      {/* Configuration en cours : QR + saisie du 1er code */}
      {setupQr && (
        <div style={card}>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "#374151" }}>
            1. Scannez ce QR code avec votre application d'authentification :
          </p>
          <img src={setupQr} alt="QR code MFA" style={{ width: 180, height: 180, display: "block", marginBottom: 12 }} />
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6B7280" }}>
            Saisie manuelle : <code style={{ fontFamily: "monospace", color: "#111827" }}>{setupSecret}</code>
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#374151" }}>2. Entrez le code affiché pour confirmer :</p>
          <input style={{ ...input, maxWidth: 200, letterSpacing: "0.2em", textAlign: "center" }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" autoComplete="one-time-code" autoFocus />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={btn("#4F46E5")} disabled={busy} onClick={confirmEnable}>Confirmer l'activation</button>
            <button style={btn("#6B7280")} disabled={busy} onClick={() => { setSetupQr(null); setSetupSecret(""); setCode(""); }}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}
