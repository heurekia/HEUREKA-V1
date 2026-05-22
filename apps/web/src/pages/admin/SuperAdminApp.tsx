import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DashboardStats {
  communes: number;
  agents: number;
  dossiersEnCours: number;
  epci: number;
}

interface Commune {
  id: string;
  name: string;
  insee_code: string;
  zip_code: string | null;
  email: string | null;
  telephone: string | null;
  logo_url: string | null;
  population: string | null;
  surface: string | null;
  departement: string | null;
  region: string | null;
  description: string | null;
  epci_id: string | null;
  epci_name: string | null;
  user_count: number;
  dossier_count: number;
}

interface Epci {
  id: string;
  name: string;
  siren: string | null;
  type: string;
  departement: string | null;
  region: string | null;
  logo_url: string | null;
  communes: { id: string; name: string }[];
}

interface UserItem {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  role: string;
  commune: string | null;
  telephone: string | null;
  created_at: string;
}

interface InseeCandidate {
  nom: string;
  insee: string;
  zip: string;
  departement: string;
  region: string;
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  sidebar: "#0F172A",
  sidebarHover: "#1E293B",
  accent: "#4F46E5",
  accentHover: "#4338CA",
  accentLight: "#EEF2FF",
  white: "#FFFFFF",
  bg: "#F8FAFC",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#0F172A",
  textMuted: "#64748B",
  textLight: "#94A3B8",
  green: "#10B981",
  greenBg: "#ECFDF5",
  orange: "#F59E0B",
  orangeBg: "#FFFBEB",
  red: "#EF4444",
  redBg: "#FEF2F2",
  blue: "#3B82F6",
  blueBg: "#EFF6FF",
  purple: "#8B5CF6",
  purpleBg: "#F5F3FF",
};

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ size = 24 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, border: `${size / 8}px solid ${C.border}`,
      borderTopColor: C.accent, borderRadius: "50%",
      animation: "spin 0.7s linear infinite",
    }} />
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      background: type === "success" ? C.green : C.red,
      color: "white", borderRadius: 12, padding: "12px 20px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.15)", fontSize: 14, fontWeight: 600,
      display: "flex", alignItems: "center", gap: 10, maxWidth: 360,
      animation: "slideUp 0.2s ease",
    }}>
      <span>{type === "success" ? "✓" : "✕"}</span>
      <span style={{ flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", color: "white", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
    </div>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.white, borderRadius: 16, padding: 32, maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <h3 style={{ margin: "0 0 12px", color: C.text, fontSize: 18, fontWeight: 700 }}>Confirmation</h3>
        <p style={{ margin: "0 0 24px", color: C.textMuted, fontSize: 15, lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.text, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            Annuler
          </button>
          <button onClick={onConfirm} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: C.red, color: "white", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function Modal({ title, children, onClose, width = 520 }: { title: string; children: React.ReactNode; onClose: () => void; width?: number }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 8000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: C.white, borderRadius: 16, width: "100%", maxWidth: width, maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Form Field ───────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
      {children}
    </div>
  );
}

function validateField(type: string, value: string): "valid" | "invalid" | null {
  if (!value) return null;
  if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? "valid" : "invalid";
  if (type === "tel") {
    const digits = value.replace(/[\s.()-]/g, "");
    return /^(\+33|0033)?[1-9]\d{8}$/.test(digits) ? "valid" : "invalid";
  }
  return null;
}

function formatTel(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+33") && digits.length <= 12) {
    return digits.replace(/(\+33)(\d{1})(\d{2})(\d{2})(\d{2})(\d{0,2})/, (_, p1, p2, p3, p4, p5, p6) =>
      [p1 + p2, p3, p4, p5, p6].filter(Boolean).join(" "));
  }
  if (digits.startsWith("0") && digits.length <= 10) {
    return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  }
  return raw;
}

function Input({ value, onChange, placeholder, type = "text", disabled, readOnly }: {
  value: string; onChange?: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean; readOnly?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const status = touched && !disabled && !readOnly ? validateField(type, value) : null;
  const borderColor = status === "valid" ? C.green : status === "invalid" ? C.red : C.border;
  const defaultPlaceholder = type === "email" ? "nom@commune.fr" : type === "tel" ? "06 12 34 56 78" : placeholder;

  const handleChange = (raw: string) => {
    if (!onChange) return;
    onChange(type === "tel" ? formatTel(raw) : raw);
  };

  const displayValue = type === "tel" ? formatTel(value) : value;

  return (
    <div style={{ position: "relative" }}>
      <input
        type={type === "tel" ? "tel" : type}
        value={displayValue}
        onChange={e => handleChange(e.target.value)}
        placeholder={placeholder ?? defaultPlaceholder}
        disabled={disabled}
        readOnly={readOnly}
        style={{
          width: "100%", boxSizing: "border-box", padding: "10px 12px",
          paddingRight: status ? 32 : 12,
          border: `1px solid ${borderColor}`, borderRadius: 8, fontSize: 14,
          color: C.text, background: disabled || readOnly ? C.bg : C.white,
          outline: "none", transition: "border-color 0.15s",
        }}
        onFocus={e => { if (!disabled && !readOnly) e.target.style.borderColor = status === "invalid" ? C.red : C.accent; }}
        onBlur={e => { setTouched(true); e.target.style.borderColor = borderColor; }}
      />
      {status && (
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: status === "valid" ? C.green : C.red, pointerEvents: "none" }}>
          {status === "valid" ? "✓" : "✕"}
        </span>
      )}
      {status === "invalid" && (
        <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>
          {type === "email" ? "Format invalide — ex : mairie@commune.fr" : "Format invalide — ex : 06 12 34 56 78"}
        </div>
      )}
    </div>
  );
}

function Select({ value, onChange, children, disabled }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        width: "100%", boxSizing: "border-box", padding: "10px 12px",
        border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14,
        color: C.text, background: C.white, outline: "none", cursor: "pointer",
      }}
    >
      {children}
    </select>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, color, background: bg }}>
      {label}
    </span>
  );
}

function StatusBadge({ commune }: { commune: Commune }) {
  if (commune.email && commune.logo_url) return <Badge label="Configurée" color={C.green} bg={C.greenBg} />;
  if (commune.email || commune.logo_url) return <Badge label="En cours" color={C.orange} bg={C.orangeBg} />;
  return <Badge label="À configurer" color={C.textMuted} bg={C.bg} />;
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") return <Badge label="Admin" color={C.purple} bg={C.purpleBg} />;
  if (role === "mairie") return <Badge label="Mairie" color={C.blue} bg={C.blueBg} />;
  if (role === "instructeur") return <Badge label="Instructeur" color={C.green} bg={C.greenBg} />;
  return <Badge label="Citoyen" color={C.textMuted} bg={C.bg} />;
}

// ─── INSEE Lookup Widget ──────────────────────────────────────────────────────
function InseeWidget({ onSelect }: { onSelect: (c: InseeCandidate) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InseeCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const data = await api.get<InseeCandidate[]>(`/admin/insee-lookup?nom=${encodeURIComponent(q)}`);
      setResults(data);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 350);
    return () => clearTimeout(t);
  }, [query, search]);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Input value={query} onChange={setQuery} placeholder="Rechercher une commune…" />
        {loading && <Spinner size={18} />}
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden",
        }}>
          {results.map((r) => (
            <button
              key={r.insee}
              onClick={() => { onSelect(r); setQuery(r.nom); setOpen(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                background: "none", border: "none", cursor: "pointer", borderBottom: `1px solid ${C.border}`,
                fontSize: 14, color: C.text,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.bg)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <strong>{r.nom}</strong>
              <span style={{ color: C.textMuted, marginLeft: 8, fontSize: 12 }}>{r.insee} · {r.zip} · {r.departement}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const navItems = [
  { path: "/admin", exact: true, icon: "⊞", label: "Vue d'ensemble" },
  { path: "/admin/communes", icon: "🏛", label: "Communes" },
  { path: "/admin/groupements", icon: "🤝", label: "Groupements" },
  { path: "/admin/utilisateurs", icon: "👥", label: "Utilisateurs" },
  { path: "/admin/configuration", icon: "⚙", label: "Configuration" },
];

function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const initials = user ? `${user.prenom[0] ?? ""}${user.nom[0] ?? ""}`.toUpperCase() : "AD";
  const fullName = user ? `${user.prenom} ${user.nom}` : "Admin";

  return (
    <div style={{
      width: 240, flexShrink: 0, background: C.sidebar, height: "100vh",
      position: "fixed", left: 0, top: 0, display: "flex", flexDirection: "column",
      zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, flexShrink: 0 }}>
            <svg viewBox="0 0 34 34" fill="none" style={{ width: "100%", height: "100%" }}>
              <polygon points="17,2 31,9.5 31,24.5 17,32 3,24.5 3,9.5" fill="#4F46E5" opacity="0.2" stroke="#4F46E5" strokeWidth="1.5" />
              <polygon points="17,7 27,12.5 27,23.5 17,29 7,23.5 7,12.5" fill="#4F46E5" opacity="0.5" />
              <polygon points="17,11 23,14.5 23,21.5 17,25 11,21.5 11,14.5" fill="#4F46E5" />
              <text x="17" y="21" textAnchor="middle" fontSize="9" fontWeight="800" fill="white" fontFamily="sans-serif">H</text>
            </svg>
          </div>
          <div>
            <div style={{ color: "white", fontWeight: 800, fontSize: 15, letterSpacing: "0.06em" }}>HEUREKA</div>
            <div style={{ color: "#475569", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 1 }}>Platform</div>
          </div>
        </div>
      </div>

      {/* User Info */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%", background: C.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "white", fontSize: 13, fontWeight: 700, flexShrink: 0,
          }}>{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "white", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fullName}</div>
            <div style={{ color: "#475569", fontSize: 11, marginTop: 1 }}>Super Admin</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        {navItems.map((item) => {
          const isActive = item.exact
            ? location.pathname === item.path
            : location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 14px", borderRadius: 8, border: "none",
                cursor: "pointer", textAlign: "left", width: "100%",
                background: isActive ? C.accent : "transparent",
                color: isActive ? "white" : "#94A3B8",
                fontSize: 14, fontWeight: isActive ? 600 : 400,
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "white"; } }}
              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94A3B8"; } }}
            >
              <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Logout */}
      <div style={{ padding: "12px 12px 20px" }}>
        <button
          onClick={() => { logout(); navigate("/mairie/login"); }}
          style={{
            display: "flex", alignItems: "center", gap: 12, width: "100%",
            padding: "10px 14px", borderRadius: 8, border: "none",
            background: "transparent", color: "#64748B", cursor: "pointer",
            fontSize: 14, fontWeight: 400,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; e.currentTarget.style.color = "#FCA5A5"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#64748B"; }}
        >
          <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>⏻</span>
          <span>Se déconnecter</span>
        </button>
      </div>
    </div>
  );
}

// ─── Page Shell ───────────────────────────────────────────────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginLeft: 240, minHeight: "100vh", background: C.bg }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 32px" }}>
        {children}
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color, bg }: { label: string; value: number | string; icon: string; color: string; bg: string }) {
  return (
    <div style={{ background: C.white, borderRadius: 12, padding: "20px 24px", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>{label}</div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingCommunes, setLoadingCommunes] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<DashboardStats>("/admin/dashboard")
      .then(setStats)
      .catch(() => setError("Impossible de charger les statistiques"))
      .finally(() => setLoadingStats(false));

    api.get<Commune[]>("/admin/communes")
      .then((c) => setCommunes(c.slice(0, 6)))
      .catch(() => {})
      .finally(() => setLoadingCommunes(false));
  }, []);

  return (
    <PageShell>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 800, color: C.text }}>
          Bonjour, {user?.prenom ?? "Admin"} — Plateforme HEUREKA
        </h1>
        <p style={{ margin: 0, color: C.textMuted, fontSize: 15 }}>
          Tableau de bord super-administrateur · {new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}`, color: C.red, borderRadius: 10, padding: "12px 16px", marginBottom: 24, fontSize: 14 }}>{error}</div>
      )}

      {/* Stats */}
      {loadingStats ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>
      ) : stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
          <StatCard label="Communes actives" value={stats.communes} icon="🏛" color={C.blue} bg={C.blueBg} />
          <StatCard label="Agents" value={stats.agents} icon="👤" color={C.purple} bg={C.purpleBg} />
          <StatCard label="Dossiers en cours" value={stats.dossiersEnCours} icon="📋" color={C.orange} bg={C.orangeBg} />
          <StatCard label="Groupements EPCI" value={stats.epci} icon="🤝" color={C.green} bg={C.greenBg} />
        </div>
      )}

      {/* Quick communes */}
      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>Communes récentes</h2>
          <button
            onClick={() => navigate("/admin/communes")}
            style={{ padding: "8px 16px", background: C.accentLight, color: C.accent, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
          >
            Gérer les communes →
          </button>
        </div>
        {loadingCommunes ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>
        ) : communes.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏛</div>
            <p style={{ margin: 0 }}>Aucune commune pour le moment.</p>
            <button onClick={() => navigate("/admin/communes")} style={{ marginTop: 12, padding: "8px 20px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
              Ajouter une commune
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: C.border }}>
            {communes.map((c) => (
              <div
                key={c.id}
                onClick={() => navigate(`/admin/communes/${c.id}`)}
                style={{ background: C.white, padding: 20, cursor: "pointer", transition: "background 0.1s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.bg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = C.white)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{c.name}</span>
                  <StatusBadge commune={c} />
                </div>
                <div style={{ fontSize: 12, color: C.textMuted }}>
                  INSEE: {c.insee_code} · {c.user_count} agent{c.user_count !== 1 ? "s" : ""} · {c.dossier_count} dossier{c.dossier_count !== 1 ? "s" : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

// ─── Communes List ────────────────────────────────────────────────────────────
function CommunesList() {
  const navigate = useNavigate();
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const [form, setForm] = useState({ name: "", insee_code: "", zip_code: "", departement: "", region: "" });

  const load = useCallback(() => {
    setLoading(true);
    api.get<Commune[]>("/admin/communes")
      .then(setCommunes)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = communes.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.insee_code.includes(search)
  );

  const handleAdd = async () => {
    if (!form.name || !form.insee_code || !form.zip_code) {
      setToast({ msg: "Nom, INSEE et code postal sont requis", type: "error" });
      return;
    }
    try {
      await api.post("/admin/communes", form);
      setToast({ msg: "Commune ajoutée avec succès", type: "success" });
      setShowModal(false);
      setForm({ name: "", insee_code: "", zip_code: "", departement: "", region: "" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  return (
    <PageShell>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: C.text }}>Communes</h1>
          <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>{communes.length} commune{communes.length !== 1 ? "s" : ""} enregistrée{communes.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: "10px 20px", background: C.accent, color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.accentHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = C.accent)}
        >
          + Ajouter une commune
        </button>
      </div>

      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom ou code INSEE…"
            style={{ width: "100%", maxWidth: 360, padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, outline: "none", color: C.text }}
          />
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: C.textMuted }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏛</div>
            <p style={{ margin: 0, fontSize: 16 }}>{search ? "Aucune commune ne correspond à cette recherche." : "Aucune commune enregistrée."}</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Commune", "INSEE", "Code postal", "EPCI", "Agents", "Dossiers", "Statut", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{ fontWeight: 600, color: C.text }}>{c.name}</span>
                  </td>
                  <td style={{ padding: "14px 16px", color: C.textMuted, fontSize: 13 }}>{c.insee_code}</td>
                  <td style={{ padding: "14px 16px", color: C.textMuted, fontSize: 13 }}>{c.zip_code ?? "—"}</td>
                  <td style={{ padding: "14px 16px", color: C.textMuted, fontSize: 13 }}>{c.epci_name ?? "—"}</td>
                  <td style={{ padding: "14px 16px", color: C.textMuted, fontSize: 13, textAlign: "center" }}>{c.user_count}</td>
                  <td style={{ padding: "14px 16px", color: C.textMuted, fontSize: 13, textAlign: "center" }}>{c.dossier_count}</td>
                  <td style={{ padding: "14px 16px" }}><StatusBadge commune={c} /></td>
                  <td style={{ padding: "14px 16px" }}>
                    <button
                      onClick={() => navigate(`/admin/communes/${c.id}`)}
                      style={{ padding: "6px 14px", background: C.accentLight, color: C.accent, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                    >
                      Paramétrer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <Modal title="Ajouter une commune" onClose={() => setShowModal(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Field label="Nom de la commune *">
              <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Ex: Tours" />
            </Field>
            <Field label="Recherche INSEE">
              <InseeWidget onSelect={(c) => setForm({ ...form, name: c.nom, insee_code: c.insee, zip_code: c.zip, departement: c.departement, region: c.region })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Code INSEE *">
                <Input value={form.insee_code} onChange={(v) => setForm({ ...form, insee_code: v })} placeholder="37261" />
              </Field>
              <Field label="Code postal *">
                <Input value={form.zip_code} onChange={(v) => setForm({ ...form, zip_code: v })} placeholder="37000" />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Département">
                <Input value={form.departement} onChange={(v) => setForm({ ...form, departement: v })} placeholder="Indre-et-Loire" />
              </Field>
              <Field label="Région">
                <Input value={form.region} onChange={(v) => setForm({ ...form, region: v })} placeholder="Centre-Val de Loire" />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.text }}>
                Annuler
              </button>
              <button onClick={handleAdd} style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                Créer la commune
              </button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

// ─── Commune Detail (Stepper) ─────────────────────────────────────────────────
const STEPS = ["Identité", "Contact", "Logo", "Groupement", "Utilisateurs", "Finaliser"];

function CommuneDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [commune, setCommune] = useState<Commune | null>(null);
  const [epciList, setEpciList] = useState<Epci[]>([]);
  const [communeUsers, setCommuneUsers] = useState<UserItem[]>([]);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showCreateEpci, setShowCreateEpci] = useState(false);
  const [newEpci, setNewEpci] = useState({ name: "", siren: "", type: "CC" });

  // Step forms
  const [step1, setStep1] = useState({ name: "", insee_code: "", zip_code: "", departement: "", region: "" });
  const [step2, setStep2] = useState({ email: "", telephone: "", description: "" });
  const [step3, setStep3] = useState({ logo_url: "" });
  const [step4, setStep4] = useState({ epci_id: "" });
  const [newUser, setNewUser] = useState({ prenom: "", nom: "", email: "", role: "mairie", telephone: "" });

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [all, epciData] = await Promise.all([
        api.get<Commune[]>("/admin/communes"),
        api.get<Epci[]>("/admin/epci"),
      ]);
      const found = all.find((c) => c.id === id) ?? null;
      setCommune(found);
      if (found) {
        setStep1({ name: found.name, insee_code: found.insee_code, zip_code: found.zip_code ?? "", departement: found.departement ?? "", region: found.region ?? "" });
        setStep2({ email: found.email ?? "", telephone: found.telephone ?? "", description: found.description ?? "" });
        setStep3({ logo_url: found.logo_url ?? "" });
        setStep4({ epci_id: found.epci_id ?? "" });

        const users = await api.get<UserItem[]>(`/admin/users?commune=${encodeURIComponent(found.name)}`);
        setCommuneUsers(users.filter((u) => u.role !== "citoyen"));
      }
      setEpciList(epciData);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const save = async (data: Record<string, string | null | undefined>) => {
    if (!id) return;
    setSaving(true);
    try {
      await api.patch(`/admin/communes/${id}`, data);
      setToast({ msg: "Modifications enregistrées", type: "success" });
      loadData();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddUser = async () => {
    if (!commune) return;
    try {
      const result = await api.post<{ tempPassword: string } & UserItem>("/admin/users", { ...newUser, commune: commune.name });
      setToast({ msg: `Agent créé. Mot de passe temporaire: ${result.tempPassword}`, type: "success" });
      setShowAddUser(false);
      setNewUser({ prenom: "", nom: "", email: "", role: "mairie", telephone: "" });
      loadData();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  const handleCreateEpci = async () => {
    try {
      const created = await api.post<Epci>("/admin/epci", newEpci);
      await api.patch(`/admin/communes/${id}`, { epci_id: created.id });
      setStep4({ epci_id: created.id });
      setToast({ msg: "Groupement créé et associé", type: "success" });
      setShowCreateEpci(false);
      setNewEpci({ name: "", siren: "", type: "CC" });
      loadData();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  if (loading) return <PageShell><div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spinner size={40} /></div></PageShell>;
  if (!commune) return <PageShell><div style={{ color: C.red, padding: 40 }}>Commune introuvable.</div></PageShell>;

  const allFilled = commune.email && commune.logo_url && commune.telephone && commune.departement;

  return (
    <PageShell>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
        <button onClick={() => navigate("/admin/communes")} style={{ padding: "8px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", color: C.textMuted, fontSize: 13, fontWeight: 500 }}>
          ← Retour
        </button>
        <div>
          <h1 style={{ margin: "0 0 2px", fontSize: 22, fontWeight: 800, color: C.text }}>{commune.name}</h1>
          <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>INSEE: {commune.insee_code}</p>
        </div>
      </div>

      {/* Stepper */}
      <div style={{ display: "flex", gap: 0, marginBottom: 28, background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(i)}
            style={{
              flex: 1, padding: "14px 8px", border: "none", cursor: "pointer",
              background: step === i ? C.accent : "transparent",
              color: step === i ? "white" : i < step ? C.green : C.textMuted,
              fontSize: 13, fontWeight: step === i ? 700 : 500,
              borderRight: i < STEPS.length - 1 ? `1px solid ${C.border}` : "none",
              transition: "background 0.15s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <span style={{
              width: 20, height: 20, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700,
              background: step === i ? "rgba(255,255,255,0.2)" : i < step ? C.greenBg : C.bg,
              color: step === i ? "white" : i < step ? C.green : C.textMuted,
            }}>
              {i < step ? "✓" : i + 1}
            </span>
            {s}
          </button>
        ))}
      </div>

      {/* Step Cards */}
      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: 28 }}>

        {/* Step 0: Identité */}
        {step === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: C.text }}>Identité de la commune</h3>
            <Field label="Nom (lecture seule)">
              <Input value={step1.name} readOnly />
            </Field>
            <Field label="Rechercher INSEE">
              <InseeWidget onSelect={(c) => setStep1({ ...step1, insee_code: c.insee, zip_code: c.zip, departement: c.departement, region: c.region })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Code INSEE">
                <Input value={step1.insee_code} onChange={(v) => setStep1({ ...step1, insee_code: v })} />
              </Field>
              <Field label="Code postal">
                <Input value={step1.zip_code} onChange={(v) => setStep1({ ...step1, zip_code: v })} />
              </Field>
              <Field label="Département">
                <Input value={step1.departement} onChange={(v) => setStep1({ ...step1, departement: v })} />
              </Field>
              <Field label="Région">
                <Input value={step1.region} onChange={(v) => setStep1({ ...step1, region: v })} />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => save({ insee_code: step1.insee_code, zip_code: step1.zip_code, departement: step1.departement, region: step1.region })}
                disabled={saving}
                style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button onClick={() => setStep(1)} style={{ padding: "10px 24px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
                Suivant →
              </button>
            </div>
          </div>
        )}

        {/* Step 1: Contact */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: C.text }}>Informations de contact</h3>
            <Field label="Email de la mairie">
              <Input type="email" value={step2.email} onChange={(v) => setStep2({ ...step2, email: v })} placeholder="mairie@commune.fr" />
            </Field>
            <Field label="Téléphone">
              <Input value={step2.telephone} onChange={(v) => setStep2({ ...step2, telephone: v })} placeholder="02 47 xx xx xx" />
            </Field>
            <Field label="Description">
              <textarea
                value={step2.description}
                onChange={(e) => setStep2({ ...step2, description: e.target.value })}
                placeholder="Présentation de la commune…"
                rows={4}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, color: C.text, resize: "vertical", outline: "none" }}
              />
            </Field>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(0)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
                ← Précédent
              </button>
              <button
                onClick={() => save({ email: step2.email, telephone: step2.telephone, description: step2.description })}
                disabled={saving}
                style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button onClick={() => setStep(2)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
                Suivant →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Logo */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: C.text }}>Logo de la commune</h3>
            <Field label="URL du logo">
              <Input value={step3.logo_url} onChange={(v) => setStep3({ logo_url: v })} placeholder="https://…/logo.png" />
            </Field>
            {step3.logo_url && (
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 80, height: 80, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
                  <img src={step3.logo_url} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onError={(e) => (e.currentTarget.style.display = "none")} />
                </div>
                <span style={{ color: C.textMuted, fontSize: 13 }}>Aperçu du logo</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(1)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
                ← Précédent
              </button>
              <button
                onClick={() => save({ logo_url: step3.logo_url })}
                disabled={saving}
                style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button onClick={() => setStep(3)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
                Suivant →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Groupement */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: C.text }}>Groupement EPCI</h3>
            <Field label="Groupement">
              <Select value={step4.epci_id} onChange={(v) => setStep4({ epci_id: v })}>
                <option value="">— Aucun groupement —</option>
                {epciList.map((e) => (
                  <option key={e.id} value={e.id}>{e.name} ({e.type})</option>
                ))}
              </Select>
            </Field>
            <div>
              <button
                onClick={() => setShowCreateEpci(!showCreateEpci)}
                style={{ padding: "8px 16px", background: C.accentLight, color: C.accent, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >
                {showCreateEpci ? "Annuler" : "+ Créer un nouveau groupement"}
              </button>
            </div>
            {showCreateEpci && (
              <div style={{ background: C.bg, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 12 }}>
                <h4 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: C.text }}>Nouveau groupement</h4>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
                  <Field label="Nom *">
                    <Input value={newEpci.name} onChange={(v) => setNewEpci({ ...newEpci, name: v })} placeholder="CC Val de Loire" />
                  </Field>
                  <Field label="SIREN">
                    <Input value={newEpci.siren} onChange={(v) => setNewEpci({ ...newEpci, siren: v })} placeholder="200xxxxxx" />
                  </Field>
                  <Field label="Type">
                    <Select value={newEpci.type} onChange={(v) => setNewEpci({ ...newEpci, type: v })}>
                      <option value="CC">CC</option>
                      <option value="CA">CA</option>
                      <option value="CU">CU</option>
                      <option value="Métropole">Métropole</option>
                      <option value="SAN">SAN</option>
                      <option value="Autre">Autre</option>
                    </Select>
                  </Field>
                </div>
                <button onClick={handleCreateEpci} style={{ alignSelf: "flex-start", padding: "8px 20px", background: C.green, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                  Créer et associer
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(2)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
                ← Précédent
              </button>
              <button
                onClick={() => save({ epci_id: step4.epci_id || null })}
                disabled={saving}
                style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button onClick={() => setStep(4)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
                Suivant →
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Utilisateurs */}
        {step === 4 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>Agents ({communeUsers.length})</h3>
              <button
                onClick={() => setShowAddUser(true)}
                style={{ padding: "8px 16px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}
              >
                + Ajouter un agent
              </button>
            </div>
            {communeUsers.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: C.textMuted, background: C.bg, borderRadius: 10 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
                <p style={{ margin: 0 }}>Aucun agent pour cette commune.</p>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    {["Nom", "Email", "Rôle", "Téléphone"].map((h) => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {communeUsers.map((u) => (
                    <tr key={u.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "10px 12px", fontWeight: 600, color: C.text }}>{u.prenom} {u.nom}</td>
                      <td style={{ padding: "10px 12px", color: C.textMuted, fontSize: 13 }}>{u.email}</td>
                      <td style={{ padding: "10px 12px" }}><RoleBadge role={u.role} /></td>
                      <td style={{ padding: "10px 12px", color: C.textMuted, fontSize: 13 }}>{u.telephone ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(3)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
                ← Précédent
              </button>
              <button onClick={() => setStep(5)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
                Suivant →
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Finaliser */}
        {step === 5 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: C.text }}>Récapitulatif</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "Nom", ok: !!commune.name, value: commune.name },
                { label: "Code INSEE", ok: !!commune.insee_code, value: commune.insee_code },
                { label: "Code postal", ok: !!commune.zip_code, value: commune.zip_code ?? "—" },
                { label: "Email", ok: !!commune.email, value: commune.email ?? "Non renseigné" },
                { label: "Téléphone", ok: !!commune.telephone, value: commune.telephone ?? "Non renseigné" },
                { label: "Logo", ok: !!commune.logo_url, value: commune.logo_url ? "Configuré" : "Non configuré" },
                { label: "Groupement EPCI", ok: !!commune.epci_id, value: commune.epci_name ?? "Non rattaché" },
                { label: "Agents", ok: communeUsers.length > 0, value: `${communeUsers.length} agent(s)` },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: item.ok ? C.greenBg : C.bg, borderRadius: 8, border: `1px solid ${item.ok ? "#A7F3D0" : C.border}` }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{item.label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: C.textMuted }}>{item.value}</span>
                    <span style={{ fontSize: 16 }}>{item.ok ? "✅" : "⚠️"}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: "16px 20px", background: allFilled ? C.greenBg : C.orangeBg, borderRadius: 10, border: `1px solid ${allFilled ? "#A7F3D0" : "#FDE68A"}` }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: allFilled ? C.green : C.orange }}>
                {allFilled ? "✅ Commune complètement configurée !" : "⚠️ Des informations sont encore manquantes."}
              </p>
              {!allFilled && (
                <p style={{ margin: "6px 0 0", fontSize: 13, color: C.textMuted }}>
                  Complétez les étapes email, logo et téléphone pour finaliser la configuration.
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(4)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
                ← Précédent
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showAddUser && (
        <Modal title="Ajouter un agent" onClose={() => setShowAddUser(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Prénom *">
                <Input value={newUser.prenom} onChange={(v) => setNewUser({ ...newUser, prenom: v })} />
              </Field>
              <Field label="Nom *">
                <Input value={newUser.nom} onChange={(v) => setNewUser({ ...newUser, nom: v })} />
              </Field>
            </div>
            <Field label="Email *">
              <Input type="email" value={newUser.email} onChange={(v) => setNewUser({ ...newUser, email: v })} />
            </Field>
            <Field label="Rôle *">
              <Select value={newUser.role} onChange={(v) => setNewUser({ ...newUser, role: v })}>
                <option value="mairie">Mairie</option>
                <option value="instructeur">Instructeur</option>
              </Select>
            </Field>
            <Field label="Téléphone">
              <Input value={newUser.telephone} onChange={(v) => setNewUser({ ...newUser, telephone: v })} />
            </Field>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setShowAddUser(false)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.text }}>
                Annuler
              </button>
              <button onClick={handleAddUser} style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                Créer l'agent
              </button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

// ─── Groupements ──────────────────────────────────────────────────────────────
function Groupements() {
  const [epciList, setEpciList] = useState<Epci[]>([]);
  const [allCommunes, setAllCommunes] = useState<Commune[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", siren: "", type: "CC", departement: "", region: "" });
  const [editMode, setEditMode] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [epci, communes] = await Promise.all([
      api.get<Epci[]>("/admin/epci"),
      api.get<Commune[]>("/admin/communes"),
    ]);
    setEpciList(epci);
    setAllCommunes(communes);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name) { setToast({ msg: "Le nom est requis", type: "error" }); return; }
    try {
      await api.post("/admin/epci", form);
      setToast({ msg: "Groupement créé", type: "success" });
      setShowCreate(false);
      setForm({ name: "", siren: "", type: "CC", departement: "", region: "" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/admin/epci/${id}`);
      setToast({ msg: "Groupement supprimé", type: "success" });
      setConfirmDelete(null);
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
      setConfirmDelete(null);
    }
  };

  const handleEdit = async (id: string) => {
    try {
      await api.patch(`/admin/epci/${id}`, editForm);
      setToast({ msg: "Groupement mis à jour", type: "success" });
      setEditMode(null);
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  const handleAssignCommune = async (communeId: string, epciId: string | null) => {
    try {
      await api.patch(`/admin/communes/${communeId}`, { epci_id: epciId });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  const typeColors: Record<string, { color: string; bg: string }> = {
    CC: { color: C.blue, bg: C.blueBg },
    CA: { color: C.purple, bg: C.purpleBg },
    CU: { color: C.orange, bg: C.orangeBg },
    Métropole: { color: C.red, bg: C.redBg },
    SAN: { color: C.green, bg: C.greenBg },
    Autre: { color: C.textMuted, bg: C.bg },
  };

  return (
    <PageShell>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {confirmDelete && <ConfirmDialog message="Supprimer ce groupement ? Cette action est irréversible." onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: C.text }}>Groupements EPCI</h1>
          <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>{epciList.length} groupement{epciList.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{ padding: "10px 20px", background: C.accent, color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.accentHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = C.accent)}
        >
          {showCreate ? "Annuler" : "+ Créer un groupement"}
        </button>
      </div>

      {showCreate && (
        <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: 24, marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700, color: C.text }}>Nouveau groupement</h3>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
            <Field label="Nom *">
              <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="CC Val de Loire" />
            </Field>
            <Field label="SIREN">
              <Input value={form.siren} onChange={(v) => setForm({ ...form, siren: v })} placeholder="200xxxxxx" />
            </Field>
            <Field label="Type">
              <Select value={form.type} onChange={(v) => setForm({ ...form, type: v })}>
                {["CC", "CA", "CU", "Métropole", "SAN", "Autre"].map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Département">
              <Input value={form.departement} onChange={(v) => setForm({ ...form, departement: v })} placeholder="Indre-et-Loire" />
            </Field>
            <Field label="Région">
              <Input value={form.region} onChange={(v) => setForm({ ...form, region: v })} placeholder="Centre-Val de Loire" />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={handleCreate} style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
              Créer
            </button>
            <button onClick={() => setShowCreate(false)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner /></div>
      ) : epciList.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: 60, textAlign: "center", color: C.textMuted }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🤝</div>
          <p style={{ margin: 0, fontSize: 16 }}>Aucun groupement EPCI créé.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {epciList.map((e) => {
            const tc = typeColors[e.type] ?? typeColors["Autre"] ?? { color: C.textMuted, bg: C.bg };
            const isExpanded = expandedId === e.id;
            const isEditing = editMode === e.id;
            const unassigned = allCommunes.filter((c) => !c.epci_id);

            return (
              <div key={e.id} style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", cursor: "pointer" }}
                  onClick={() => setExpandedId(isExpanded ? null : e.id)}>
                  <span style={{ fontSize: 20 }}>🤝</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{e.name}</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                      {e.communes.length} commune{e.communes.length !== 1 ? "s" : ""}
                      {e.siren && ` · SIREN: ${e.siren}`}
                    </div>
                  </div>
                  <Badge label={e.type} color={tc.color} bg={tc.bg} />
                  <span style={{ color: C.textMuted, fontSize: 12 }}>{isExpanded ? "▲" : "▼"}</span>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${C.border}`, padding: 20 }}>
                    {isEditing ? (
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                        <Field label="Nom">
                          <Input value={editForm.name ?? e.name} onChange={(v) => setEditForm({ ...editForm, name: v })} />
                        </Field>
                        <Field label="SIREN">
                          <Input value={editForm.siren ?? (e.siren ?? "")} onChange={(v) => setEditForm({ ...editForm, siren: v })} />
                        </Field>
                        <Field label="Type">
                          <Select value={editForm.type ?? e.type} onChange={(v) => setEditForm({ ...editForm, type: v })}>
                            {["CC", "CA", "CU", "Métropole", "SAN", "Autre"].map((t) => <option key={t} value={t}>{t}</option>)}
                          </Select>
                        </Field>
                        <div style={{ gridColumn: "1/-1", display: "flex", gap: 12 }}>
                          <button onClick={() => handleEdit(e.id)} style={{ padding: "8px 20px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                            Enregistrer
                          </button>
                          <button onClick={() => setEditMode(null)} style={{ padding: "8px 16px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 13, color: C.text, fontWeight: 600 }}>
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ marginBottom: 12 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.textMuted }}>Communes membres:</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {e.communes.length === 0 ? (
                              <span style={{ fontSize: 13, color: C.textLight }}>Aucune commune rattachée</span>
                            ) : e.communes.map((c) => (
                              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: C.accentLight, borderRadius: 20 }}>
                                <span style={{ fontSize: 13, color: C.accent, fontWeight: 500 }}>{c.name}</span>
                                <button
                                  onClick={(ev) => { ev.stopPropagation(); handleAssignCommune(c.id, null); }}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: C.accent, fontSize: 14, padding: 0, lineHeight: 1 }}
                                >×</button>
                              </div>
                            ))}
                          </div>
                        </div>
                        {unassigned.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: C.textMuted }}>Ajouter une commune:</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                              {unassigned.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={(ev) => { ev.stopPropagation(); handleAssignCommune(c.id, e.id); }}
                                  style={{ padding: "4px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, cursor: "pointer", fontSize: 13, color: C.textMuted, fontWeight: 500 }}
                                  onMouseEnter={(ev) => { ev.currentTarget.style.background = C.accentLight; ev.currentTarget.style.borderColor = C.accent; ev.currentTarget.style.color = C.accent; }}
                                  onMouseLeave={(ev) => { ev.currentTarget.style.background = C.bg; ev.currentTarget.style.borderColor = C.border; ev.currentTarget.style.color = C.textMuted; }}
                                >+ {c.name}</button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 10 }}>
                          <button
                            onClick={(ev) => { ev.stopPropagation(); setEditMode(e.id); setEditForm({ name: e.name, siren: e.siren ?? "", type: e.type }); }}
                            style={{ padding: "7px 16px", background: C.accentLight, color: C.accent, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                          >
                            Modifier
                          </button>
                          <button
                            onClick={(ev) => { ev.stopPropagation(); setConfirmDelete(e.id); }}
                            style={{ padding: "7px 16px", background: C.redBg, color: C.red, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

// ─── Utilisateurs ─────────────────────────────────────────────────────────────
function Utilisateurs() {
  const [usersData, setUsersData] = useState<UserItem[]>([]);
  const [allCommunes, setAllCommunes] = useState<Commune[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [filterCommune, setFilterCommune] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [search, setSearch] = useState("");
  const [editRole, setEditRole] = useState<{ id: string; role: string } | null>(null);
  const [form, setForm] = useState({ prenom: "", nom: "", email: "", role: "mairie", commune: "", telephone: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCommune) params.set("commune", filterCommune);
    if (filterRole) params.set("role", filterRole);
    const [users, communes] = await Promise.all([
      api.get<UserItem[]>(`/admin/users?${params.toString()}`),
      api.get<Commune[]>("/admin/communes"),
    ]);
    setUsersData(users);
    setAllCommunes(communes);
    setLoading(false);
  }, [filterCommune, filterRole]);

  useEffect(() => { load(); }, [load]);

  const filtered = usersData.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${u.prenom} ${u.nom} ${u.email}`.toLowerCase().includes(q);
  });

  const stats = {
    total: usersData.length,
    mairie: usersData.filter((u) => u.role === "mairie").length,
    instructeur: usersData.filter((u) => u.role === "instructeur").length,
    admin: usersData.filter((u) => u.role === "admin").length,
  };

  const handleCreate = async () => {
    if (!form.prenom || !form.nom || !form.email || !form.role) {
      setToast({ msg: "Tous les champs obligatoires sont requis", type: "error" }); return;
    }
    try {
      const result = await api.post<{ tempPassword: string } & UserItem>("/admin/users", form);
      setToast({ msg: `Utilisateur créé ! Mot de passe temporaire : ${result.tempPassword}`, type: "success" });
      setShowModal(false);
      setForm({ prenom: "", nom: "", email: "", role: "mairie", commune: "", telephone: "" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/admin/users/${id}`);
      setToast({ msg: "Utilisateur supprimé", type: "success" });
      setConfirmDelete(null);
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
      setConfirmDelete(null);
    }
  };

  const handleRoleUpdate = async (id: string, role: string) => {
    try {
      await api.patch(`/admin/users/${id}`, { role });
      setToast({ msg: "Rôle mis à jour", type: "success" });
      setEditRole(null);
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  return (
    <PageShell>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {confirmDelete && <ConfirmDialog message="Supprimer cet utilisateur définitivement ?" onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: C.text }}>Utilisateurs</h1>
          <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>{stats.total} utilisateur{stats.total !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: "10px 20px", background: C.accent, color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.accentHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = C.accent)}
        >
          + Ajouter un utilisateur
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="Total" value={stats.total} icon="👥" color={C.text} bg={C.bg} />
        <StatCard label="Mairie" value={stats.mairie} icon="🏛" color={C.blue} bg={C.blueBg} />
        <StatCard label="Instructeurs" value={stats.instructeur} icon="📋" color={C.green} bg={C.greenBg} />
        <StatCard label="Admins" value={stats.admin} icon="⭐" color={C.purple} bg={C.purpleBg} />
      </div>

      {/* Filters */}
      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: "16px 20px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          style={{ flex: 1, minWidth: 180, padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, outline: "none", color: C.text }}
        />
        <select
          value={filterCommune}
          onChange={(e) => setFilterCommune(e.target.value)}
          style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, color: C.text, background: C.white, cursor: "pointer", outline: "none" }}
        >
          <option value="">Toutes communes</option>
          {allCommunes.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, color: C.text, background: C.white, cursor: "pointer", outline: "none" }}
        >
          <option value="">Tous rôles</option>
          <option value="admin">Admin</option>
          <option value="mairie">Mairie</option>
          <option value="instructeur">Instructeur</option>
          <option value="citoyen">Citoyen</option>
        </select>
        {(filterCommune || filterRole || search) && (
          <button onClick={() => { setFilterCommune(""); setFilterRole(""); setSearch(""); }} style={{ padding: "8px 14px", background: C.redBg, color: C.red, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            Réinitialiser
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: C.textMuted }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
            <p style={{ margin: 0, fontSize: 16 }}>Aucun utilisateur trouvé.</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Nom Prénom", "Email", "Rôle", "Commune", "Créé le", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.accentLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>
                        {u.prenom[0]}{u.nom[0]}
                      </div>
                      <span style={{ fontWeight: 600, color: C.text }}>{u.prenom} {u.nom}</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", color: C.textMuted, fontSize: 13 }}>{u.email}</td>
                  <td style={{ padding: "12px 16px" }}>
                    {editRole?.id === u.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <select
                          value={editRole.role}
                          onChange={(e) => setEditRole({ ...editRole, role: e.target.value })}
                          style={{ padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, color: C.text, background: C.white, outline: "none" }}
                        >
                          <option value="admin">Admin</option>
                          <option value="mairie">Mairie</option>
                          <option value="instructeur">Instructeur</option>
                          <option value="citoyen">Citoyen</option>
                        </select>
                        <button onClick={() => handleRoleUpdate(u.id, editRole.role)} style={{ padding: "4px 10px", background: C.green, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✓</button>
                        <button onClick={() => setEditRole(null)} style={{ padding: "4px 8px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", fontSize: 12 }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <RoleBadge role={u.role} />
                        <button onClick={() => setEditRole({ id: u.id, role: u.role })} style={{ background: "none", border: "none", cursor: "pointer", color: C.textLight, fontSize: 12, padding: 2 }}>✏️</button>
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", color: C.textMuted, fontSize: 13 }}>{u.commune ?? "—"}</td>
                  <td style={{ padding: "12px 16px", color: C.textMuted, fontSize: 13 }}>
                    {new Date(u.created_at).toLocaleDateString("fr-FR")}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <button
                      onClick={() => setConfirmDelete(u.id)}
                      style={{ padding: "6px 12px", background: C.redBg, color: C.red, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create modal */}
      {showModal && (
        <Modal title="Ajouter un utilisateur" onClose={() => setShowModal(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Prénom *">
                <Input value={form.prenom} onChange={(v) => setForm({ ...form, prenom: v })} />
              </Field>
              <Field label="Nom *">
                <Input value={form.nom} onChange={(v) => setForm({ ...form, nom: v })} />
              </Field>
            </div>
            <Field label="Email *">
              <Input type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Rôle *">
                <Select value={form.role} onChange={(v) => setForm({ ...form, role: v })}>
                  <option value="admin">Admin</option>
                  <option value="mairie">Mairie</option>
                  <option value="instructeur">Instructeur</option>
                  <option value="citoyen">Citoyen</option>
                </Select>
              </Field>
              <Field label="Commune">
                <Select value={form.commune} onChange={(v) => setForm({ ...form, commune: v })}>
                  <option value="">— Aucune —</option>
                  {allCommunes.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Téléphone">
              <Input value={form.telephone} onChange={(v) => setForm({ ...form, telephone: v })} />
            </Field>
            <div style={{ background: C.orangeBg, border: `1px solid #FDE68A`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.orange }}>
              Le mot de passe temporaire sera <strong>Heureka2024!</strong>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.text }}>
                Annuler
              </button>
              <button onClick={handleCreate} style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                Créer
              </button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

// ─── Configuration ────────────────────────────────────────────────────────────
function Configuration() {
  const cards = [
    { icon: "⚙️", title: "Paramètres plateforme", desc: "Configurez les paramètres généraux de la plateforme HEUREKA." },
    { icon: "🔒", title: "Sécurité", desc: "Gestion des politiques de sécurité, 2FA, sessions et accès." },
    { icon: "📧", title: "Emails & notifications", desc: "Templates d'emails, règles de notification et intégrations SMTP." },
    { icon: "📊", title: "Logs d'activité", desc: "Historique des actions, audits et traçabilité des opérations." },
  ];

  return (
    <PageShell>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: C.text }}>Configuration</h1>
        <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>Paramètres avancés de la plateforme</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {cards.map((card) => (
          <div key={card.title} style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: 28, opacity: 0.8 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, background: C.accentLight, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
                {card.icon}
              </div>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: C.text }}>{card.title}</h3>
                <p style={{ margin: 0, fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>{card.desc}</p>
              </div>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", background: C.bg, borderRadius: 20, border: `1px solid ${C.border}` }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.textLight, display: "inline-block" }} />
              <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 600 }}>À venir</span>
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export function SuperAdminApp() {
  return (
    <div style={{ display: "flex", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        * { box-sizing: border-box; }
      `}</style>
      <Sidebar />
      <div style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/communes" element={<CommunesList />} />
          <Route path="/communes/:id" element={<CommuneDetail />} />
          <Route path="/groupements" element={<Groupements />} />
          <Route path="/utilisateurs" element={<Utilisateurs />} />
          <Route path="/configuration" element={<Configuration />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </div>
  );
}
