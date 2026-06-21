import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { Link } from "react-router-dom";

interface Dossier {
  id: string;
  numero: string;
  type: string;
  status: string;
  adresse?: string;
  commune?: string;
  description?: string;
  date_depot?: string;
  created_at: string;
  updated_at: string;
}

const STATUS: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  brouillon:           { label: "En préparation",            bg: "#F1F5F9", color: "#475569", dot: "#94A3B8" },
  soumis:              { label: "Déposé",                    bg: "#EFF6FF", color: "#1D4ED8", dot: "#3B82F6" },
  pre_instruction:     { label: "Pré-instruction",           bg: "#EEF2FF", color: "#4338CA", dot: "#6366F1" },
  incomplet:           { label: "Pièces manquantes",         bg: "#FFF7ED", color: "#C2410C", dot: "#F97316" },
  en_instruction:      { label: "En instruction",            bg: "#FAF5FF", color: "#6D28D9", dot: "#8B5CF6" },
  decision_en_cours:   { label: "Décision en cours",         bg: "#FEFCE8", color: "#A16207", dot: "#EAB308" },
  accepte:             { label: "Accordé",                   bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
  refuse:              { label: "Refusé",                    bg: "#FFF1F2", color: "#BE123C", dot: "#EF4444" },
  accord_prescription: { label: "Accordé avec prescriptions",bg: "#ECFDF5", color: "#065F46", dot: "#10B981" },
};

const TYPE_LABELS: Record<string, string> = {
  permis_de_construire:    "Permis de Construire",
  permis_de_construire_mi: "Permis de Construire (Maison individuelle)",
  declaration_prealable:   "Déclaration Préalable",
  permis_amenager:         "Permis d'Aménager",
  permis_demolir:          "Permis de Démolir",
  permis_lotir:            "Permis de Lotir",
  certificat_urbanisme:    "Certificat d'Urbanisme",
  certificat_urbanisme_a:  "Certificat d'Urbanisme (informatif)",
  certificat_urbanisme_b:  "Certificat d'Urbanisme (opérationnel)",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

const CLOSED = ["accepte", "refuse"];

export function CitoyenDashboard() {
  const { user } = useAuth();
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    api.get<Dossier[]>("/dossiers")
      .then(setDossiers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const supprimerBrouillon = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Supprimer définitivement ce brouillon ? Cette action est irréversible.")) return;
    setDeletingId(id);
    try {
      await api.delete(`/dossiers/${id}`);
      setDossiers((prev) => prev.filter((d) => d.id !== id));
    } catch {
      alert("Erreur lors de la suppression. Veuillez réessayer.");
    } finally {
      setDeletingId(null);
    }
  };

  const active   = dossiers.filter((d) => !CLOSED.includes(d.status));
  const closed   = dossiers.filter((d) => CLOSED.includes(d.status));
  const needsAction = active.filter((d) => d.status === "incomplet" || d.status === "brouillon");

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "clamp(20px, 4vw, 36px) clamp(16px, 4vw, 24px)" }}>

      {/* ── Header ────────────────────────────────────────── */}
      <div className="dashboard-header">
        <div>
          <h1 style={{ fontSize: "clamp(20px, 5vw, 24px)", fontWeight: 800, color: "#0F172A", margin: 0 }}>
            Bonjour, {user?.prenom}
          </h1>
          <p style={{ fontSize: 14, color: "#64748b", marginTop: 4, margin: 0 }}>
            {loading
              ? "Chargement de vos dossiers…"
              : active.length > 0
                ? `${active.length} dossier${active.length > 1 ? "s" : ""} en cours`
                : "Aucun dossier en cours"}
          </p>
        </div>
        <Link
          to="/citoyen/nouvelle-demande"
          className="dashboard-new-btn"
        >
          + Nouvelle demande
        </Link>
      </div>
      <style>{`
        .dashboard-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 28px; gap: 16px; flex-wrap: wrap; }
        .dashboard-new-btn { display: inline-flex; align-items: center; gap: 7px; padding: 10px 20px; background: #4F46E5; color: white; border-radius: 10px; font-weight: 600; font-size: 13px; text-decoration: none; flex-shrink: 0; white-space: nowrap; }
        @media (max-width: 640px) {
          .dashboard-header { flex-direction: column; align-items: stretch; }
          .dashboard-new-btn { justify-content: center; width: 100%; padding: 12px 20px; }
        }
      `}</style>

      {/* ── Alerte action requise ──────────────────────────── */}
      {needsAction.length > 0 && (
        <div style={{
          background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 12,
          padding: "12px 18px", marginBottom: 20, fontSize: 13, color: "#92400E",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <span>
            {needsAction.filter((d) => d.status === "incomplet").length > 0 &&
              `${needsAction.filter((d) => d.status === "incomplet").length} dossier(s) en attente de pièces complémentaires. `}
            {needsAction.filter((d) => d.status === "brouillon").length > 0 &&
              `${needsAction.filter((d) => d.status === "brouillon").length} brouillon(s) non encore soumis à la mairie.`}
          </span>
        </div>
      )}

      {/* ── Dossiers en cours ─────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", margin: 0 }}>
            Dossiers en cours
            {!loading && active.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, background: "#EEF2FF", color: "#4F46E5", padding: "2px 8px", borderRadius: 20 }}>
                {active.length}
              </span>
            )}
          </h2>
          <Link to="/citoyen/mes-demandes" style={{ fontSize: 13, color: "#4F46E5", fontWeight: 600, textDecoration: "none" }}>
            Tout voir →
          </Link>
        </div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[1, 2].map((i) => (
              <div key={i} style={{ height: 68, borderRadius: 14, background: "#F1F5F9", animation: "pulse 1.5s ease-in-out infinite" }} />
            ))}
          </div>
        ) : active.length === 0 ? (
          <div style={{
            padding: "44px 24px", textAlign: "center", background: "#F8FAFC",
            borderRadius: 14, border: "2px dashed #CBD5E1",
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#374151", marginBottom: 6 }}>
              Aucun dossier en cours
            </p>
            <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 22 }}>
              Déposez votre première demande d'urbanisme en quelques minutes.
            </p>
            <Link
              to="/citoyen/nouvelle-demande"
              style={{ padding: "10px 24px", background: "#4F46E5", color: "white", borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: "none", display: "inline-block" }}
            >
              Commencer une demande →
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {active.map((d) => {
              const sc = STATUS[d.status] ?? STATUS["soumis"]!;
              return (
                <Link
                  key={d.id}
                  to={`/citoyen/mes-demandes/${d.id}`}
                  style={{ textDecoration: "none" }}
                >
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: 16,
                      padding: "16px 20px", background: "white",
                      borderRadius: 14, border: "1px solid #E2E8F0",
                      transition: "box-shadow 0.15s, border-color 0.15s",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 18px rgba(0,0,0,0.07)";
                      (e.currentTarget as HTMLDivElement).style.borderColor = "#C7D2FE";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = "";
                      (e.currentTarget as HTMLDivElement).style.borderColor = "#E2E8F0";
                    }}
                  >
                    {/* Status dot */}
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: sc.dot, flexShrink: 0 }} />

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                          {TYPE_LABELS[d.type] ?? d.type}
                        </span>
                        <span style={{
                          padding: "2px 10px", borderRadius: 20, fontSize: 11,
                          fontWeight: 700, background: sc.bg, color: sc.color,
                        }}>
                          {sc.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {d.numero}
                        {(() => {
                          const adr = d.adresse?.trim();
                          const com = d.commune?.trim();
                          // Évite "11 rue X, Tours · Tours" si la commune est déjà dans l'adresse
                          const full = adr && com && !adr.toLowerCase().includes(com.toLowerCase())
                            ? `${adr}, ${com}`
                            : (adr ?? com);
                          return full ? ` · ${full}` : "";
                        })()}
                        {d.date_depot
                          ? ` · Déposé le ${fmtDate(d.date_depot)}`
                          : ` · Créé le ${fmtDate(d.created_at)}`}
                      </div>
                    </div>

                    {/* Delete button (brouillon only) */}
                    {d.status === "brouillon" && (
                      <button
                        onClick={(e) => void supprimerBrouillon(e, d.id)}
                        disabled={deletingId === d.id}
                        title="Supprimer ce brouillon"
                        style={{
                          padding: "5px 9px", background: "transparent", border: "1px solid #FECACA",
                          borderRadius: 8, fontSize: 14, color: "#DC2626", cursor: "pointer",
                          flexShrink: 0, lineHeight: 1,
                        }}
                      >
                        {deletingId === d.id ? "…" : "🗑"}
                      </button>
                    )}

                    {/* Chevron */}
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#CBD5E1" strokeWidth={2.5} style={{ flexShrink: 0 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Dossiers clôturés (réduit) ─────────────────────── */}
      {!loading && closed.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: "0 0 10px" }}>
            Dossiers clôturés ({closed.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {closed.slice(0, 3).map((d) => {
              const sc = STATUS[d.status] ?? STATUS["soumis"]!;
              return (
                <Link key={d.id} to={`/citoyen/mes-demandes/${d.id}`} style={{ textDecoration: "none" }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "11px 16px", background: "#F8FAFC",
                    borderRadius: 10, border: "1px solid #F1F5F9",
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: sc.dot, opacity: 0.5, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "#64748b", flex: 1 }}>
                      {TYPE_LABELS[d.type] ?? d.type} · {d.numero}
                    </span>
                    <span style={{ padding: "1px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>
                      {sc.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Accès rapides ──────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {[
          { to: "/citoyen/messagerie",    emoji: "💬", title: "Messagerie",      sub: "Échangez avec les instructeurs" },
          { to: "/citoyen/mes-documents", emoji: "📄", title: "Mes documents",   sub: "Pièces justificatives déposées" },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            style={{
              textDecoration: "none", display: "flex", alignItems: "center", gap: 12,
              padding: "14px 18px", background: "white", borderRadius: 12, border: "1px solid #E2E8F0",
            }}
          >
            <span style={{ fontSize: 22, flexShrink: 0 }}>{item.emoji}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{item.title}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 1 }}>{item.sub}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
