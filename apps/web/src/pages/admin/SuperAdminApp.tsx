import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { CATEGORIES } from "@heureka-v1/shared";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DashboardStats {
  communes: number;
  agents: number;
  dossiersEnCours: number;
  epci: number;
}

interface RolePermission {
  id: string;
  name: string;
  label: string;
  base_role: string;
  description: string | null;
  color: string;
  permissions: string[];
  is_system: boolean;
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
  instruction_mutualisee: boolean;
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
  commune_insee: string | null;
  telephone: string | null;
  role_config_id: string | null;
  created_at: string;
  activation_pending: boolean;
}

interface InseeCandidate {
  nom: string;
  insee: string;
  zip: string;
  departement: string;
  region: string;
}

interface EpciCandidate {
  nom: string;
  siren: string;
  type: string;
}

interface EpciImportResult {
  epci: { id: string; name: string; type: string; siren: string | null };
  created: string[];
  attached: string[];
  already_member: string[];
  errors: { commune: string; error: string }[];
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
    return /^(0[1-9]\d{8}|(\+33|0033)[1-9]\d{8})$/.test(digits) ? "valid" : "invalid";
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
  { path: "/admin/roles", icon: "🔑", label: "Rôles" },
  { path: "/admin/utilisateurs", icon: "👥", label: "Utilisateurs" },
  { path: "/admin/services", icon: "🔗", label: "Services annexes" },
  { path: "/admin/couts-ia", icon: "💶", label: "Coûts IA" },
  { path: "/admin/audit", icon: "🔒", label: "Audit sécurité" },
  { path: "/admin/conformite", icon: "🛡", label: "Conformité RGPD" },
  { path: "/admin/configuration", icon: "⚙", label: "Configuration" },
];

// ─── Indicateur temps réel d'activité IA ─────────────────────────────────────
// Pill cliquable en pied de sidebar : montre le coût IA cumulé du jour et
// pulse quand un appel a eu lieu dans les 5 dernières minutes. Auto-refresh
// toutes les 30 s. Pour pouvoir surveiller la conso d'un coup d'œil.
interface AiLive {
  today_events: number;
  today_cost_eur: number;
  last_5min_events: number;
  last_5min_cost_eur: number;
  last_event_at: string | null;
}

function AiLiveWidget() {
  const navigate = useNavigate();
  const [data, setData] = useState<AiLive | null>(null);
  const [prevEventAt, setPrevEventAt] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () => {
      api.get<AiLive>("/admin/ai-cost/live")
        .then((d) => {
          if (cancelled) return;
          setData(d);
          if (d.last_event_at && d.last_event_at !== prevEventAt) {
            setPulse(true);
            setTimeout(() => !cancelled && setPulse(false), 1500);
            setPrevEventAt(d.last_event_at);
          }
        })
        .catch(() => { /* silencieux : ne pas polluer la sidebar */ });
    };
    fetchOnce();
    const t = setInterval(fetchOnce, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [prevEventAt]);

  if (!data) return null;
  const recentlyActive = data.last_5min_events > 0;
  const cost = data.today_cost_eur;
  const fmt = cost < 0.01 ? `${(cost * 100).toFixed(2)} c€` : `${cost.toFixed(cost < 1 ? 3 : 2)} €`;

  return (
    <div style={{ padding: "0 12px 12px" }}>
      <style>{`
        @keyframes aiPulse { 0%{box-shadow:0 0 0 0 rgba(16,185,129,0.6)} 70%{box-shadow:0 0 0 8px rgba(16,185,129,0)} 100%{box-shadow:0 0 0 0 rgba(16,185,129,0)} }
      `}</style>
      <button
        onClick={() => navigate("/admin/couts-ia")}
        title={data.last_event_at ? `Dernier appel : ${new Date(data.last_event_at).toLocaleString("fr-FR")}` : "Aucun appel IA aujourd'hui"}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)", cursor: "pointer", color: "#CBD5E1",
          textAlign: "left", fontSize: 12,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      >
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: recentlyActive ? "#10B981" : "#475569",
          flexShrink: 0,
          animation: pulse ? "aiPulse 1.5s ease-out" : "none",
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "white", fontSize: 13, fontWeight: 700, lineHeight: 1.1 }}>
            {fmt}
            <span style={{ color: "#64748B", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
              aujourd'hui
            </span>
          </div>
          <div style={{ color: "#64748B", fontSize: 10.5, marginTop: 2 }}>
            {data.today_events} appel{data.today_events > 1 ? "s" : ""}
            {recentlyActive && <span style={{ color: "#10B981", marginLeft: 6 }}>● {data.last_5min_events} dans les 5 min</span>}
          </div>
        </div>
      </button>
    </div>
  );
}

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
            <div style={{ color: "white", fontWeight: 800, fontSize: 15, letterSpacing: "0.06em" }}>HEUREKIA</div>
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

      {/* Live AI activity widget */}
      <AiLiveWidget />

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
          Bonjour, {user?.prenom ?? "Admin"} — Plateforme HEUREKIA
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
                  <td style={{ padding: "14px 16px", fontSize: 13 }}>
                    {c.epci_name
                      ? <div>
                          <span style={{ color: C.text }}>{c.epci_name}</span>
                          <div style={{ marginTop: 3 }}>
                            {c.instruction_mutualisee
                              ? <Badge label="Mutualisée" color={C.accent} bg={C.accentLight} />
                              : <Badge label="Communale" color={C.textMuted} bg={C.bg} />}
                          </div>
                        </div>
                      : <span style={{ color: C.textMuted }}>—</span>}
                  </td>
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
  const [step4, setStep4] = useState({ epci_id: "", instruction_mutualisee: false });
  const [newUser, setNewUser] = useState({ prenom: "", nom: "", email: "", role: "mairie", telephone: "" });
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editUserForm, setEditUserForm] = useState({ prenom: "", nom: "", email: "", role: "mairie", telephone: "" });
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<string | null>(null);

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
        setStep4({ epci_id: found.epci_id ?? "", instruction_mutualisee: found.instruction_mutualisee ?? false });

        const users = await api.get<UserItem[]>(`/admin/users?commune=${encodeURIComponent(found.name)}`);
        setCommuneUsers(users.filter((u) => u.role !== "citoyen"));
      }
      setEpciList(epciData);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const save = async (data: Record<string, string | boolean | null | undefined>) => {
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
      await api.post("/admin/users", { ...newUser, commune: commune.name });
      setToast({ msg: `Invitation envoyée à ${newUser.email} — lien valable 7 jours.`, type: "success" });
      setShowAddUser(false);
      setNewUser({ prenom: "", nom: "", email: "", role: "mairie", telephone: "" });
      loadData();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  const handleEditUser = async () => {
    if (!editingUser) return;
    try {
      await api.patch(`/admin/users/${editingUser.id}`, editUserForm);
      setToast({ msg: "Agent mis à jour", type: "success" });
      setEditingUser(null);
      loadData();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await api.delete(`/admin/users/${userId}`);
      setToast({ msg: "Agent supprimé", type: "success" });
      setConfirmDeleteUser(null);
      loadData();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  const handleCreateEpci = async () => {
    try {
      const created = await api.post<Epci>("/admin/epci", newEpci);
      await api.patch(`/admin/communes/${id}`, { epci_id: created.id });
      setStep4({ ...step4, epci_id: created.id });
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
              <Input type="tel" value={step2.telephone} onChange={(v) => setStep2({ ...step2, telephone: v })} />
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
            <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>Téléversez un fichier (recommandé) ou saisissez une URL. Les images hébergées sur des sites externes peuvent ne pas s'afficher en raison de restrictions de hotlinking.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Upload */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <label style={{ padding: "9px 18px", background: C.accentLight, color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>
                  📁 Téléverser un fichier
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => setStep3({ logo_url: reader.result as string });
                    reader.readAsDataURL(f);
                  }} />
                </label>
                <span style={{ color: C.textMuted, fontSize: 13 }}>ou</span>
                <Input value={step3.logo_url.startsWith("data:") ? "" : step3.logo_url} onChange={(v) => setStep3({ logo_url: v })} placeholder="https://…/logo.png" />
              </div>
              {step3.logo_url && (
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 80, height: 80, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, position: "relative" }}>
                    <img src={step3.logo_url} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{step3.logo_url.startsWith("data:") ? "Fichier téléversé ✓" : "Aperçu du logo"}</div>
                    {step3.logo_url.startsWith("data:") && (
                      <button onClick={() => setStep3({ logo_url: "" })} style={{ fontSize: 12, color: C.red, background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 4 }}>Supprimer</button>
                    )}
                  </div>
                </div>
              )}
            </div>
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
              <Select value={step4.epci_id} onChange={(v) => setStep4({ ...step4, epci_id: v, instruction_mutualisee: v ? step4.instruction_mutualisee : false })}>
                <option value="">— Aucun groupement —</option>
                {epciList.map((e) => (
                  <option key={e.id} value={e.id}>{e.name} ({e.type})</option>
                ))}
              </Select>
            </Field>

            {step4.epci_id && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Service d'instruction</div>
                {[
                  { value: false, title: "Instruction communale", desc: "La commune gère son propre service urbanisme, indépendamment du groupement." },
                  { value: true,  title: "Instruction mutualisée", desc: "Les dossiers sont instruits par le service urbanisme du groupement." },
                ].map((opt) => {
                  const active = step4.instruction_mutualisee === opt.value;
                  return (
                    <div
                      key={String(opt.value)}
                      onClick={() => setStep4({ ...step4, instruction_mutualisee: opt.value })}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: active ? C.accentLight : C.bg, border: `1px solid ${active ? C.accent : C.border}`, borderRadius: 10, cursor: "pointer", userSelect: "none" }}
                    >
                      <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${active ? C.accent : C.border}`, background: active ? C.accent : "white", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {active && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "white" }} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: active ? C.accent : C.text }}>{opt.title}</div>
                        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{opt.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
                onClick={() => save({ epci_id: step4.epci_id || null, instruction_mutualisee: step4.instruction_mutualisee })}
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
                    {["Nom", "Email", "Rôle", "Téléphone", ""].map((h) => (
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
                      <td style={{ padding: "10px 12px", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            onClick={() => { setEditingUser(u); setEditUserForm({ prenom: u.prenom, nom: u.nom, email: u.email, role: u.role, telephone: u.telephone ?? "" }); }}
                            style={{ padding: "4px 10px", fontSize: 12, fontWeight: 600, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", color: C.text }}
                          >Modifier</button>
                          <button
                            onClick={() => setConfirmDeleteUser(u.id)}
                            style={{ padding: "4px 10px", fontSize: 12, fontWeight: 600, background: "transparent", border: `1px solid #FCA5A5`, borderRadius: 6, cursor: "pointer", color: C.red }}
                          >Supprimer</button>
                        </div>
                      </td>
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
                { label: "Instruction", ok: true, value: commune.epci_id ? (commune.instruction_mutualisee ? "Mutualisée (groupement)" : "Communale (propre service)") : "Communale" },
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
              <Input type="tel" value={newUser.telephone} onChange={(v) => setNewUser({ ...newUser, telephone: v })} />
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

      {editingUser && (
        <Modal title={`Modifier ${editingUser.prenom} ${editingUser.nom}`} onClose={() => setEditingUser(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Prénom *">
                <Input value={editUserForm.prenom} onChange={(v) => setEditUserForm({ ...editUserForm, prenom: v })} />
              </Field>
              <Field label="Nom *">
                <Input value={editUserForm.nom} onChange={(v) => setEditUserForm({ ...editUserForm, nom: v })} />
              </Field>
            </div>
            <Field label="Email *">
              <Input type="email" value={editUserForm.email} onChange={(v) => setEditUserForm({ ...editUserForm, email: v })} />
            </Field>
            <Field label="Rôle *">
              <Select value={editUserForm.role} onChange={(v) => setEditUserForm({ ...editUserForm, role: v })}>
                <option value="mairie">Mairie</option>
                <option value="instructeur">Instructeur</option>
              </Select>
            </Field>
            <Field label="Téléphone">
              <Input type="tel" value={editUserForm.telephone} onChange={(v) => setEditUserForm({ ...editUserForm, telephone: v })} />
            </Field>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setEditingUser(null)} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.text }}>
                Annuler
              </button>
              <button onClick={handleEditUser} style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                Enregistrer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDeleteUser && (
        <ConfirmDialog
          message="Supprimer cet agent ? Cette action est irréversible."
          onConfirm={() => handleDeleteUser(confirmDeleteUser)}
          onCancel={() => setConfirmDeleteUser(null)}
        />
      )}
    </PageShell>
  );
}

// ─── Documents réglementaires portés par un EPCI ──────────────────────────────
// Encart imbriqué dans la fiche d'un groupement : liste les documents (PLUi,
// PLUm, etc.) portés par l'EPCI avec leur couverture (X/Y communes membres),
// et permet d'en créer de nouveaux. L'ingestion effective des règles reste
// pilotée par la CLI `pnpm ingest --doc-id <id>` (extraction PDF en ligne =
// lot ultérieur).

interface RegulatoryDocumentLite {
  id: string;
  type: string;
  name: string;
  original_filename: string;
  synthese: string | null;
  status: string;
  validation_status: string;
  ingested_at: string | null;
  created_at: string;
  communes_couvertes: string[];
  communes_membres_total: number;
}

// Types portés par un EPCI. Volontairement restreint au sous-ensemble utile :
// PLU (communal) est exclu côté UI superadmin — un PLU communal se crée
// depuis l'onglet documents d'une commune, pas d'un EPCI.
const EPCI_DOCUMENT_TYPES = [
  { value: "plui", label: "PLUi — Plan local d'urbanisme intercommunal" },
  { value: "plum", label: "PLUm — Plan local d'urbanisme métropolitain" },
  { value: "ppri", label: "PPRI — Plan de prévention des risques d'inondation" },
  { value: "pprt", label: "PPRT — Plan de prévention des risques technologiques" },
  { value: "oap", label: "OAP — Orientation d'aménagement et de programmation" },
  { value: "peb", label: "PEB — Plan d'exposition au bruit" },
  { value: "plh", label: "PLH — Programme local de l'habitat" },
  { value: "zac", label: "ZAC — Zone d'aménagement concerté" },
  { value: "autre", label: "Autre document réglementaire" },
] as const;

function EpciDocuments({ epciId, members }: { epciId: string; members: { id: string; name: string }[] }) {
  const [docs, setDocs] = useState<RegulatoryDocumentLite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Périmètre de couverture : `null` = toutes les membres (cas par défaut),
  // sinon un Set des id de communes effectivement cochées. Cette séparation
  // évite de pré-cocher 44 cases au montage du formulaire.
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [form, setForm] = useState({ type: "plui", name: "", original_filename: "" });

  // ── Flow d'ingestion PDF d'un document existant ──────────────────────────
  // Étape 1 : on uploade le PDF en base64 via /start (le worker serveur
  // extrait les règles en arrière-plan).
  // Étape 2 : on poll /status toutes les 2 s jusqu'à done|error.
  // À la fin, on rafraîchit la liste pour refléter le status=ingested.
  const [ingest, setIngest] = useState<{
    docId: string;
    docName: string;
    jobId: string | null;
    phase: string;
    zonesDone: number;
    zonesTotal: number;
    error: string | null;
  } | null>(null);
  // Saisie manuelle du sommaire : activée quand /start renvoie 422 no_toc
  // (détection auto impossible sur un PLUi volumineux ou un sommaire atypique).
  // On garde le PDF déjà encodé en base64 pour relancer /start sans re-lire le
  // fichier, et la liste des ancres zone→page éditées par l'opérateur.
  const [manualToc, setManualToc] = useState<{
    docId: string;
    docName: string;
    pdfBase64: string;
    totalPages: number;
    rows: Array<{ code: string; startPage: string }>;
    submitting: boolean;
    error: string | null;
  } | null>(null);
  const ingestTargetRef = useRef<{ id: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Polling : on garde un timer en ref pour pouvoir l'annuler proprement
  // (changement d'EPCI, démontage, ingestion suivante).
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.get<RegulatoryDocumentLite[]>(`/admin/epci/${epciId}/documents`);
      setDocs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [epciId]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ type: "plui", name: "", original_filename: "" });
    setSelection(null);
    setCreating(false);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError("Le nom du document est requis"); return; }
    const commune_ids = selection ? Array.from(selection) : undefined;
    if (commune_ids && commune_ids.length === 0) {
      setError("Sélectionnez au moins une commune");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/admin/epci/${epciId}/documents`, {
        type: form.type,
        name: form.name.trim(),
        original_filename: form.original_filename.trim() || undefined,
        commune_ids,
      });
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de la création");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCommune = (id: string) => {
    setSelection((prev) => {
      // Premier toggle depuis l'état « toutes » : on bascule en mode liste
      // explicite, et on pré-coche toutes les autres communes (le clic
      // décoche celle-là, comme attendu).
      if (prev === null) {
        const all = new Set(members.map((m) => m.id));
        all.delete(id);
        return all;
      }
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const pollIngestStatus = useCallback((jobId: string, docId: string, docName: string) => {
    const tick = async () => {
      try {
        const r = await fetch(`/api/mairie/admin/ingest-plu-pdf/status?jobId=${encodeURIComponent(jobId)}`, {
          credentials: "include",
        });
        if (!r.ok) throw new Error(`status HTTP ${r.status}`);
        const data = await r.json() as {
          status: "running" | "done" | "error";
          phase: string;
          zones?: Array<{ code: string; total_batches: number; done_batches: number }>;
          error?: string;
        };
        const totalBatches = data.zones?.reduce((s, z) => s + z.total_batches, 0) ?? 0;
        const doneBatches = data.zones?.reduce((s, z) => s + z.done_batches, 0) ?? 0;
        setIngest((prev) => prev && prev.docId === docId ? {
          ...prev,
          phase: data.phase || prev.phase,
          zonesDone: doneBatches,
          zonesTotal: totalBatches,
        } : prev);

        if (data.status === "done") {
          setIngest(null);
          await load();
          return;
        }
        if (data.status === "error") {
          setIngest((prev) => prev && prev.docId === docId ? {
            ...prev,
            error: data.error ?? "Erreur d'extraction",
          } : prev);
          return;
        }
        // Toujours en cours → re-arme le timer.
        pollTimerRef.current = window.setTimeout(tick, 2000);
      } catch (e) {
        // Erreur réseau transitoire : on retente une fois, puis on abandonne.
        setIngest((prev) => prev && prev.docId === docId ? {
          ...prev,
          error: e instanceof Error ? e.message : "Erreur réseau",
        } : prev);
      }
    };
    pollTimerRef.current = window.setTimeout(tick, 1500);
  }, [load]);

  const handleIngestStart = (doc: RegulatoryDocumentLite) => {
    ingestTargetRef.current = { id: doc.id, name: doc.name };
    fileInputRef.current?.click();
  };

  // ── Édition / suppression d'un document existant ────────────────────────
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ type: "plui", name: "", original_filename: "" });
  const [editSelection, setEditSelection] = useState<Set<string>>(new Set());
  const [editInitialSelection, setEditInitialSelection] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const openEdit = (doc: RegulatoryDocumentLite) => {
    setEditingDocId(doc.id);
    setEditForm({
      type: doc.type,
      name: doc.name,
      original_filename: doc.original_filename === "—" ? "" : doc.original_filename,
    });
    const sel = new Set(doc.communes_couvertes);
    setEditSelection(sel);
    setEditInitialSelection(sel);
    setError(null);
  };

  const closeEdit = () => {
    setEditingDocId(null);
    setError(null);
  };

  const toggleEditCommune = (id: string) => {
    setEditSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleEditSubmit = async (docId: string) => {
    if (!editForm.name.trim()) { setError("Le nom du document est requis"); return; }
    if (editSelection.size === 0) { setError("Au moins une commune doit être rattachée"); return; }
    setActionSubmitting(true);
    setError(null);
    try {
      // PATCH infos d'abord, PUT périmètre ensuite. Les deux endpoints ont
      // leurs validations propres ; en cas d'échec sur le second, le PATCH
      // est conservé — ce qui est acceptable car aucun n'est destructif.
      await api.patch(`/admin/epci/${epciId}/documents/${docId}`, {
        type: editForm.type,
        name: editForm.name.trim(),
        original_filename: editForm.original_filename.trim() || undefined,
      });
      const selChanged = editSelection.size !== editInitialSelection.size
        || Array.from(editSelection).some((id) => !editInitialSelection.has(id));
      if (selChanged) {
        await api.put(`/admin/epci/${epciId}/documents/${docId}/communes`, {
          commune_ids: Array.from(editSelection),
        });
      }
      closeEdit();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de la mise à jour");
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleDelete = async (docId: string) => {
    setActionSubmitting(true);
    setError(null);
    try {
      await api.delete(`/admin/epci/${epciId}/documents/${docId}`);
      setConfirmDeleteId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de la suppression");
    } finally {
      setActionSubmitting(false);
    }
  };

  // Lance (ou relance) l'extraction. `manualTocEntries` est fourni uniquement
  // au second essai, après que la détection auto a échoué et que l'opérateur a
  // saisi les ancres zone→page à la main.
  const startIngest = async (
    docId: string,
    docName: string,
    pdfBase64: string,
    manualTocEntries?: Array<{ code: string; startPage: number }>,
  ) => {
    setIngest({
      docId,
      docName,
      jobId: null,
      phase: "Lecture du sommaire…",
      zonesDone: 0,
      zonesTotal: 0,
      error: null,
    });
    try {
      const startResp = await api.post<{ jobId: string; zones: Array<{ code: string }> }>(
        "/mairie/admin/ingest-plu-pdf/start",
        { doc_id: docId, pdf_base64: pdfBase64, ...(manualTocEntries ? { manual_toc: manualTocEntries } : {}) },
        { timeoutMs: 120_000 },
      );
      setManualToc(null);
      setIngest((prev) => prev ? {
        ...prev,
        jobId: startResp.jobId,
        phase: `Extraction des règles (${startResp.zones.length} zones)…`,
        zonesTotal: startResp.zones.length,
      } : prev);
      pollIngestStatus(startResp.jobId, docId, docName);
    } catch (e) {
      // Détection auto du sommaire impossible → on bascule sur la saisie
      // manuelle plutôt que d'afficher une erreur sans issue.
      if (e instanceof ApiError && e.status === 422 && (e.body as { code?: string })?.code === "no_toc") {
        const totalPages = Number((e.body as { totalPages?: number })?.totalPages) || 0;
        setIngest(null);
        setManualToc((prev) => prev
          ? { ...prev, totalPages: totalPages || prev.totalPages, submitting: false }
          : { docId, docName, pdfBase64, totalPages, rows: [{ code: "", startPage: "" }], submitting: false, error: null });
        return;
      }
      const msg = e instanceof Error ? e.message : "Erreur lors du démarrage";
      if (manualTocEntries) {
        // Échec d'une relance manuelle (ex. page hors plage rejetée côté API) :
        // on garde le formulaire ouvert avec le message, sans encart séparé.
        setIngest(null);
        setManualToc((prev) => prev ? { ...prev, submitting: false, error: msg } : prev);
      } else {
        setIngest((prev) => prev ? { ...prev, error: msg } : prev);
      }
    }
  };

  const handleFileSelected = async (file: File | null) => {
    if (!file || !ingestTargetRef.current) return;
    const target = ingestTargetRef.current;
    ingestTargetRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = ""; // permet de re-sélectionner le même fichier

    setIngest({
      docId: target.id,
      docName: target.name,
      jobId: null,
      phase: "Lecture du PDF…",
      zonesDone: 0,
      zonesTotal: 0,
      error: null,
    });

    // Conversion ArrayBuffer → base64 par chunks pour gérer ~30 Mo sans
    // saturer la stack JS (apply spread limité aux gros tableaux).
    const buf = new Uint8Array(await file.arrayBuffer());
    const CHUNK = 32768;
    const chunks: string[] = [];
    for (let i = 0; i < buf.length; i += CHUNK) {
      chunks.push(String.fromCharCode(...buf.subarray(i, i + CHUNK)));
    }
    const pdf_base64 = btoa(chunks.join(""));

    await startIngest(target.id, target.name, pdf_base64);
  };

  // ── Helpers de la saisie manuelle du sommaire ──────────────────────────────
  const addManualRow = () =>
    setManualToc((p) => p ? { ...p, rows: [...p.rows, { code: "", startPage: "" }] } : p);
  const removeManualRow = (i: number) =>
    setManualToc((p) => p ? { ...p, rows: p.rows.filter((_, idx) => idx !== i) } : p);
  const updateManualRow = (i: number, field: "code" | "startPage", value: string) =>
    setManualToc((p) => p ? { ...p, rows: p.rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r) } : p);

  const submitManualToc = async () => {
    if (!manualToc) return;
    const entries = manualToc.rows
      .map((r) => ({ code: r.code.trim(), startPage: Number(r.startPage) }))
      .filter((r) =>
        r.code !== "" &&
        Number.isInteger(r.startPage) &&
        r.startPage >= 1 &&
        (manualToc.totalPages === 0 || r.startPage <= manualToc.totalPages));
    if (entries.length === 0) {
      setManualToc((p) => p ? { ...p, error: "Indiquez au moins une zone avec un code et une page de début valide." } : p);
      return;
    }
    setManualToc((p) => p ? { ...p, submitting: true, error: null } : p);
    const { docId, docName, pdfBase64 } = manualToc;
    await startIngest(docId, docName, pdfBase64, entries);
    // Si startIngest a re-déclenché un no_toc (improbable en manuel) ou une
    // erreur, manualToc est déjà ré-armé/effacé par startIngest. On retombe ici
    // seulement en cas de succès (manualToc null) — rien à faire.
    setManualToc((p) => p ? { ...p, submitting: false } : p);
  };

  const typeLabel = (t: string) => EPCI_DOCUMENT_TYPES.find((d) => d.value === t)?.label.split(" — ")[0] ?? t.toUpperCase();
  const statusColors: Record<string, { color: string; bg: string }> = {
    uploaded: { color: C.textMuted, bg: C.bg },
    ingested: { color: C.green, bg: C.greenBg },
    error: { color: C.red, bg: C.redBg },
  };
  const validationColors: Record<string, { color: string; bg: string }> = {
    valide: { color: C.green, bg: C.greenBg },
    brouillon: { color: C.orange, bg: C.orangeBg },
    rejete: { color: C.red, bg: C.redBg },
  };

  return (
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px dashed ${C.border}` }}>
      {confirmDeleteId && (
        <ConfirmDialog
          message={`Supprimer ce document réglementaire ? Les zones et règles qui en proviennent seront également supprimées. Cette action est irréversible.`}
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
      {/* Input file caché, partagé par tous les boutons « Importer un PDF ».
          Le doc cible est résolu via ingestTargetRef au moment du click. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>
          📜 Documents réglementaires <span style={{ color: C.textMuted, fontWeight: 400 }}>· {docs?.length ?? 0}</span>
        </h4>
        {!creating && (
          <button
            onClick={(ev) => { ev.stopPropagation(); setCreating(true); setError(null); }}
            style={{ padding: "6px 12px", background: C.accent, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
          >
            + Créer un document
          </button>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: "8px 12px", background: C.redBg, color: C.red, borderRadius: 6, fontSize: 12 }}>
          {error}
        </div>
      )}

      {creating && (
        <div onClick={(ev) => ev.stopPropagation()} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
            <Field label="Type">
              <Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} disabled={submitting}>
                {EPCI_DOCUMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Nom du document *">
              <Input
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                placeholder={form.type === "plui" ? "PLUi de la communauté de communes du …" : `${typeLabel(form.type)} …`}
                disabled={submitting}
              />
            </Field>
            <Field label="Nom du fichier source (optionnel)">
              <Input
                value={form.original_filename}
                onChange={(v) => setForm({ ...form, original_filename: v })}
                placeholder="reglement-plui.pdf"
                disabled={submitting}
              />
            </Field>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.textMuted }}>Communes couvertes</span>
              <span style={{ fontSize: 12, color: C.textLight }}>
                {selection === null
                  ? `Toutes (${members.length})`
                  : `${selection.size} / ${members.length}`}
              </span>
              {selection !== null && (
                <button
                  type="button"
                  onClick={() => setSelection(null)}
                  style={{ marginLeft: "auto", background: "none", border: "none", color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}
                >
                  Toutes les communes
                </button>
              )}
            </div>
            {members.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>
                Aucune commune rattachée à ce groupement — rattachez au moins une commune avant de créer un document.
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {members.map((m) => {
                  const active = selection === null || selection.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleCommune(m.id)}
                      disabled={submitting}
                      style={{
                        padding: "4px 10px",
                        background: active ? C.accentLight : C.white,
                        border: `1px solid ${active ? C.accent : C.border}`,
                        borderRadius: 16,
                        cursor: "pointer",
                        fontSize: 12,
                        color: active ? C.accent : C.textMuted,
                        fontWeight: 500,
                      }}
                    >
                      {active ? "✓ " : ""}{m.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleSubmit}
              disabled={submitting || members.length === 0}
              style={{
                padding: "8px 16px",
                background: members.length === 0 ? C.border : C.accent,
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: members.length === 0 ? "not-allowed" : "pointer",
                fontSize: 13,
                fontWeight: 700,
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "Création…" : "Créer le document"}
            </button>
            <button
              onClick={resetForm}
              disabled={submitting}
              style={{ padding: "8px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", fontSize: 13, color: C.text, fontWeight: 600 }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 16, textAlign: "center" }}><Spinner size={16} /></div>
      ) : !docs || docs.length === 0 ? (
        <div style={{ padding: "12px 14px", background: C.bg, borderRadius: 8, fontSize: 13, color: C.textMuted, fontStyle: "italic" }}>
          Aucun document réglementaire porté par ce groupement.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {docs.map((d) => {
            const sc = statusColors[d.status] ?? statusColors["uploaded"]!;
            const vc = validationColors[d.validation_status] ?? validationColors["brouillon"]!;
            const isIngesting = ingest?.docId === d.id;
            const isManualToc = manualToc?.docId === d.id;
            const isEditing = editingDocId === d.id;
            const progressPct = ingest && ingest.zonesTotal > 0
              ? Math.round((ingest.zonesDone / ingest.zonesTotal) * 100)
              : 0;
            return (
              <div key={d.id} style={{ background: C.white, border: `1px solid ${isIngesting || isManualToc || isEditing ? C.accent : C.border}`, borderRadius: 8, padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                      {typeLabel(d.type)} <span style={{ color: C.textMuted, fontWeight: 400 }}>· {d.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                      {d.communes_couvertes.length} / {d.communes_membres_total} commune{d.communes_membres_total !== 1 ? "s" : ""} couverte{d.communes_couvertes.length !== 1 ? "s" : ""}
                      {d.ingested_at && ` · ingéré le ${new Date(d.ingested_at).toLocaleDateString("fr-FR")}`}
                    </div>
                  </div>
                  <Badge label={d.status} color={sc.color} bg={sc.bg} />
                  <Badge label={d.validation_status} color={vc.color} bg={vc.bg} />
                  {!isIngesting && !isManualToc && !isEditing && !ingest && !manualToc && d.status === "uploaded" && (
                    <button
                      onClick={(ev) => { ev.stopPropagation(); handleIngestStart(d); }}
                      style={{ padding: "6px 12px", background: C.accent, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                    >
                      📥 Importer un PDF
                    </button>
                  )}
                  {!isIngesting && !isManualToc && !isEditing && (
                    <>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); openEdit(d); }}
                        style={{ padding: "6px 10px", background: C.accentLight, color: C.accent, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                      >
                        Modifier
                      </button>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); setConfirmDeleteId(d.id); }}
                        style={{ padding: "6px 10px", background: C.redBg, color: C.red, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                      >
                        Supprimer
                      </button>
                    </>
                  )}
                </div>

                {isEditing && (
                  <div onClick={(ev) => ev.stopPropagation()} style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
                      <Field label="Type">
                        <Select value={editForm.type} onChange={(v) => setEditForm({ ...editForm, type: v })} disabled={actionSubmitting}>
                          {EPCI_DOCUMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </Select>
                      </Field>
                      <Field label="Nom du document *">
                        <Input value={editForm.name} onChange={(v) => setEditForm({ ...editForm, name: v })} disabled={actionSubmitting} />
                      </Field>
                      <Field label="Nom du fichier source (optionnel)">
                        <Input value={editForm.original_filename} onChange={(v) => setEditForm({ ...editForm, original_filename: v })} disabled={actionSubmitting} />
                      </Field>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>
                        Communes couvertes <span style={{ color: C.textLight, fontWeight: 400 }}>· {editSelection.size} / {members.length}</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {members.map((m) => {
                          const active = editSelection.has(m.id);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => toggleEditCommune(m.id)}
                              disabled={actionSubmitting}
                              style={{
                                padding: "4px 10px",
                                background: active ? C.accentLight : C.white,
                                border: `1px solid ${active ? C.accent : C.border}`,
                                borderRadius: 16,
                                cursor: "pointer",
                                fontSize: 12,
                                color: active ? C.accent : C.textMuted,
                                fontWeight: 500,
                              }}
                            >
                              {active ? "✓ " : ""}{m.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => handleEditSubmit(d.id)}
                        disabled={actionSubmitting}
                        style={{ padding: "8px 16px", background: C.accent, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: actionSubmitting ? 0.6 : 1 }}
                      >
                        {actionSubmitting ? "Enregistrement…" : "Enregistrer"}
                      </button>
                      <button
                        onClick={closeEdit}
                        disabled={actionSubmitting}
                        style={{ padding: "8px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", fontSize: 13, color: C.text, fontWeight: 600 }}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}

                {isIngesting && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                    {ingest.error ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, padding: "8px 12px", background: C.redBg, color: C.red, borderRadius: 6, fontSize: 12 }}>
                          ⚠ {ingest.error}
                        </div>
                        <button
                          onClick={(ev) => { ev.stopPropagation(); setIngest(null); }}
                          style={{ padding: "6px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", fontSize: 12, color: C.text, fontWeight: 600 }}
                        >
                          Fermer
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, color: C.accent, marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>{ingest.phase}</span>
                          {ingest.zonesTotal > 0 && (
                            <span style={{ fontWeight: 600 }}>{ingest.zonesDone} / {ingest.zonesTotal} lots</span>
                          )}
                        </div>
                        <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            height: "100%",
                            width: `${progressPct}%`,
                            background: C.accent,
                            transition: "width 0.3s ease",
                          }} />
                        </div>
                        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 8, fontStyle: "italic" }}>
                          L'extraction tourne côté serveur — vous pouvez fermer cette section, elle continuera. À la fin, la liste se rafraîchit automatiquement.
                        </div>
                      </>
                    )}
                  </div>
                )}

                {isManualToc && !isIngesting && manualToc && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 4 }}>
                      Sommaire non détecté automatiquement — saisie manuelle
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
                      Indiquez chaque zone (code et page de début de sa section dans le PDF).
                      La fin de chaque zone est déduite du début de la suivante.
                      {manualToc.totalPages > 0 && ` Le document fait ${manualToc.totalPages} pages.`}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                      <div style={{ display: "flex", gap: 8, fontSize: 10, color: C.textMuted, fontWeight: 600, paddingLeft: 2 }}>
                        <span style={{ flex: 1 }}>CODE ZONE (UA, AUs, A, N…)</span>
                        <span style={{ width: 120 }}>PAGE DE DÉBUT</span>
                        <span style={{ width: 28 }} />
                      </div>
                      {manualToc.rows.map((row, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            value={row.code}
                            onChange={(e) => updateManualRow(i, "code", e.target.value)}
                            placeholder="ex : UA"
                            style={{ flex: 1, padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, outline: "none", boxSizing: "border-box" }}
                          />
                          <input
                            type="number"
                            min={1}
                            max={manualToc.totalPages || undefined}
                            value={row.startPage}
                            onChange={(e) => updateManualRow(i, "startPage", e.target.value)}
                            placeholder="ex : 12"
                            style={{ width: 120, padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, outline: "none", boxSizing: "border-box" }}
                          />
                          <button
                            onClick={(ev) => { ev.stopPropagation(); removeManualRow(i); }}
                            disabled={manualToc.rows.length === 1}
                            title="Retirer cette ligne"
                            style={{ width: 28, height: 28, background: C.redBg, color: C.red, border: "none", borderRadius: 6, cursor: manualToc.rows.length === 1 ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, opacity: manualToc.rows.length === 1 ? 0.4 : 1 }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={(ev) => { ev.stopPropagation(); addManualRow(); }}
                      style={{ padding: "5px 10px", background: C.accentLight, color: C.accent, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, marginBottom: 10 }}
                    >
                      + Ajouter une zone
                    </button>

                    {manualToc.error && (
                      <div style={{ marginBottom: 10, padding: "8px 12px", background: C.redBg, color: C.red, borderRadius: 6, fontSize: 12 }}>
                        ⚠ {manualToc.error}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); submitManualToc(); }}
                        disabled={manualToc.submitting}
                        style={{ padding: "7px 14px", background: C.accent, color: "white", border: "none", borderRadius: 6, cursor: manualToc.submitting ? "wait" : "pointer", fontSize: 12, fontWeight: 600, opacity: manualToc.submitting ? 0.6 : 1 }}
                      >
                        {manualToc.submitting ? "Lancement…" : "Lancer l'extraction"}
                      </button>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); setManualToc(null); }}
                        disabled={manualToc.submitting}
                        style={{ padding: "7px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", fontSize: 12, color: C.text, fontWeight: 600 }}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Import EPCI officiel ─────────────────────────────────────────────────────
// Recherche un EPCI dans le référentiel officiel (geo.api.gouv.fr), prévisualise
// ses communes membres, puis crée le groupement + crée/rattache toutes les
// communes cochées en un seul appel. Remplace la saisie commune par commune.
function EpciImportPanel({ onDone, onCancel }: { onDone: (r: EpciImportResult) => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EpciCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  const [selected, setSelected] = useState<EpciCandidate | null>(null);
  const [epciForm, setEpciForm] = useState({ name: "", type: "CC", departement: "", region: "" });
  const [members, setMembers] = useState<InseeCandidate[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setSearching(true);
    try {
      const data = await api.get<EpciCandidate[]>(`/admin/epci-lookup?nom=${encodeURIComponent(q)}`);
      setResults(data);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 350);
    return () => clearTimeout(t);
  }, [query, search]);

  const pickEpci = async (e: EpciCandidate) => {
    setSelected(e);
    setQuery(e.nom);
    setOpen(false);
    setError(null);
    setLoadingMembers(true);
    setMembers([]);
    try {
      const data = await api.get<InseeCandidate[]>(`/admin/epci-communes?siren=${encodeURIComponent(e.siren)}`);
      setMembers(data);
      setChecked(Object.fromEntries(data.map((c) => [c.insee, true])));
      // Pré-remplit l'en-tête du groupement depuis la première commune membre.
      setEpciForm({
        name: e.nom,
        type: e.type || "CC",
        departement: data[0]?.departement ?? "",
        region: data[0]?.region ?? "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la récupération des communes");
    } finally {
      setLoadingMembers(false);
    }
  };

  const checkedCount = members.filter((c) => checked[c.insee]).length;
  const allChecked = members.length > 0 && checkedCount === members.length;

  const handleImport = async () => {
    const communes = members.filter((c) => checked[c.insee]);
    if (communes.length === 0) { setError("Sélectionnez au moins une commune"); return; }
    if (!epciForm.name.trim()) { setError("Le nom du groupement est requis"); return; }
    setImporting(true);
    setError(null);
    try {
      const result = await api.post<EpciImportResult>("/admin/epci/import", {
        epci: {
          name: epciForm.name.trim(),
          siren: selected?.siren,
          type: epciForm.type,
          departement: epciForm.departement || undefined,
          region: epciForm.region || undefined,
        },
        communes,
      });
      onDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'import");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: 24, marginBottom: 24 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: C.text }}>Importer un EPCI officiel</h3>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: C.textMuted }}>
        Recherchez l'EPCI dans le référentiel national : ses communes membres seront créées et rattachées automatiquement.
      </p>

      <Field label="Rechercher un EPCI">
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Input value={query} onChange={(v) => { setQuery(v); setSelected(null); }} placeholder="CC du Golfe, Métropole de Lyon…" />
            {searching && <Spinner size={18} />}
          </div>
          {open && results.length > 0 && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
              background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden",
            }}>
              {results.map((r) => (
                <button
                  key={r.siren}
                  onClick={() => pickEpci(r)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                    background: "none", border: "none", cursor: "pointer", borderBottom: `1px solid ${C.border}`,
                    fontSize: 14, color: C.text,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.bg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <strong>{r.nom}</strong>
                  <span style={{ color: C.textMuted, marginLeft: 8, fontSize: 12 }}>{r.type} · SIREN {r.siren}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Field>

      {loadingMembers && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 0", color: C.textMuted, fontSize: 14 }}>
          <Spinner size={18} /> Récupération des communes membres…
        </div>
      )}

      {selected && !loadingMembers && members.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
            <Field label="Nom du groupement *">
              <Input value={epciForm.name} onChange={(v) => setEpciForm({ ...epciForm, name: v })} />
            </Field>
            <Field label="Type">
              <Select value={epciForm.type} onChange={(v) => setEpciForm({ ...epciForm, type: v })}>
                {["CC", "CA", "CU", "Métropole", "SAN", "Autre"].map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Département">
              <Input value={epciForm.departement} onChange={(v) => setEpciForm({ ...epciForm, departement: v })} />
            </Field>
            <Field label="Région">
              <Input value={epciForm.region} onChange={(v) => setEpciForm({ ...epciForm, region: v })} />
            </Field>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.textMuted }}>
              Communes membres ({checkedCount}/{members.length} sélectionnée{checkedCount !== 1 ? "s" : ""})
            </span>
            <button
              onClick={() => setChecked(Object.fromEntries(members.map((c) => [c.insee, !allChecked])))}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.accent, fontSize: 13, fontWeight: 600 }}
            >
              {allChecked ? "Tout décocher" : "Tout cocher"}
            </button>
          </div>

          <div style={{
            maxHeight: 280, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8,
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 2, padding: 6, background: C.bg,
          }}>
            {members.map((c) => (
              <label key={c.insee} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6,
                cursor: "pointer", background: checked[c.insee] ? C.accentLight : C.white, fontSize: 13,
              }}>
                <input
                  type="checkbox"
                  checked={!!checked[c.insee]}
                  onChange={(ev) => setChecked({ ...checked, [c.insee]: ev.target.checked })}
                  style={{ accentColor: C.accent, cursor: "pointer" }}
                />
                <span style={{ color: C.text, fontWeight: 500 }}>{c.nom}</span>
                <span style={{ color: C.textLight, fontSize: 11, marginLeft: "auto" }}>{c.insee}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: "10px 14px", background: C.redBg, color: C.red, borderRadius: 8, fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button
          onClick={handleImport}
          disabled={importing || checkedCount === 0}
          style={{
            padding: "10px 24px", background: importing || checkedCount === 0 ? C.textLight : C.accent, color: "white",
            border: "none", borderRadius: 8, cursor: importing || checkedCount === 0 ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          {importing && <Spinner size={16} />}
          {importing ? "Import en cours…" : `Importer ${checkedCount} commune${checkedCount !== 1 ? "s" : ""}`}
        </button>
        <button onClick={onCancel} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.text, fontWeight: 600 }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// ─── Groupements ──────────────────────────────────────────────────────────────
function Groupements() {
  const [epciList, setEpciList] = useState<Epci[]>([]);
  const [allCommunes, setAllCommunes] = useState<Commune[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
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

  const handleImportDone = (r: EpciImportResult) => {
    setShowImport(false);
    const parts: string[] = [];
    if (r.created.length) parts.push(`${r.created.length} créée${r.created.length !== 1 ? "s" : ""}`);
    if (r.attached.length) parts.push(`${r.attached.length} rattachée${r.attached.length !== 1 ? "s" : ""}`);
    if (r.already_member.length) parts.push(`${r.already_member.length} déjà membre${r.already_member.length !== 1 ? "s" : ""}`);
    if (r.errors.length) parts.push(`${r.errors.length} en erreur`);
    setToast({
      msg: `${r.epci.name} : ${parts.join(", ") || "aucune commune"}`,
      type: r.errors.length ? "error" : "success",
    });
    setExpandedId(r.epci.id);
    load();
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
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => { setShowImport(!showImport); setShowCreate(false); }}
            style={{ padding: "10px 20px", background: showImport ? C.bg : C.accentLight, color: C.accent, border: `1px solid ${showImport ? C.border : C.accentLight}`, borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
          >
            {showImport ? "Annuler" : "⚡ Importer un EPCI officiel"}
          </button>
          <button
            onClick={() => { setShowCreate(!showCreate); setShowImport(false); }}
            style={{ padding: "10px 20px", background: C.accent, color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.accentHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = C.accent)}
          >
            {showCreate ? "Annuler" : "+ Créer un groupement"}
          </button>
        </div>
      </div>

      {showImport && <EpciImportPanel onDone={handleImportDone} onCancel={() => setShowImport(false)} />}

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
                    {/* Documents réglementaires portés par cet EPCI — encart
                        autonome qui fetch ses propres données et gère son
                        propre formulaire de création. */}
                    <EpciDocuments epciId={e.id} members={e.communes} />
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
  const [activeTab, setActiveTab] = useState<"tous" | "mairie" | "instructeur" | "citoyen" | "admin">("tous");
  const [search, setSearch] = useState("");
  const [editRole, setEditRole] = useState<{ id: string; role: string } | null>(null);
  const [communesModal, setCommunesModal] = useState<{ id: string; name: string } | null>(null);
  const [userCommuneIds, setUserCommuneIds] = useState<Set<string>>(new Set());
  const [formCommuneIds, setFormCommuneIds] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ prenom: "", nom: "", email: "", role: "mairie", telephone: "" });
  const [resendingId, setResendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCommune) params.set("commune", filterCommune);
    const [users, communes] = await Promise.all([
      api.get<UserItem[]>(`/admin/users?${params.toString()}`),
      api.get<Commune[]>("/admin/communes"),
    ]);
    setUsersData(users);
    setAllCommunes(communes);
    setLoading(false);
  }, [filterCommune]);

  useEffect(() => { load(); }, [load]);

  const counts = {
    tous: usersData.length,
    mairie: usersData.filter((u) => u.role === "mairie").length,
    instructeur: usersData.filter((u) => u.role === "instructeur").length,
    citoyen: usersData.filter((u) => u.role === "citoyen").length,
    admin: usersData.filter((u) => u.role === "admin").length,
  };

  const filtered = usersData.filter((u) => {
    if (activeTab !== "tous" && u.role !== activeTab) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return `${u.prenom} ${u.nom} ${u.email}`.toLowerCase().includes(q);
  });

  const handleCreate = async () => {
    if (!form.prenom || !form.nom || !form.email || !form.role) {
      setToast({ msg: "Tous les champs obligatoires sont requis", type: "error" }); return;
    }
    try {
      await api.post("/admin/users", { ...form, communeIds: [...formCommuneIds] });
      setToast({ msg: `Invitation envoyée à ${form.email} — lien valable 7 jours.`, type: "success" });
      setShowModal(false);
      setForm({ prenom: "", nom: "", email: "", role: "mairie", telephone: "" });
      setFormCommuneIds(new Set());
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

  const handleResend = async (id: string, email: string) => {
    setResendingId(id);
    try {
      await api.post(`/admin/users/${id}/resend-invitation`);
      setToast({ msg: `Invitation renvoyée à ${email}`, type: "success" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur lors du renvoi", type: "error" });
    } finally {
      setResendingId(null);
    }
  };

  const openCommunesModal = async (u: UserItem) => {
    const ids = await api.get<string[]>(`/admin/users/${u.id}/communes`);
    if (ids.length === 0 && u.commune) {
      // Pre-select the existing primary commune if no user_communes row yet
      const match = allCommunes.find((c) => c.name.toLowerCase() === u.commune!.toLowerCase());
      if (match) ids.push(match.id);
    }
    setUserCommuneIds(new Set(ids));
    setCommunesModal({ id: u.id, name: `${u.prenom} ${u.nom}` });
  };

  const saveCommunesModal = async () => {
    if (!communesModal) return;
    try {
      // PUT /communes syncs commune + commune_insee automatically from the first selected commune
      await api.put(`/admin/users/${communesModal.id}/communes`, { ids: [...userCommuneIds] });
      setToast({ msg: "Communes mises à jour", type: "success" });
      setCommunesModal(null);
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" });
    }
  };

  return (
    <PageShell>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {confirmDelete && <ConfirmDialog message="Supprimer cet utilisateur définitivement ?" onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: C.text }}>Utilisateurs</h1>
          <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>{counts.tous} utilisateur{counts.tous !== 1 ? "s" : ""}</p>
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

      {/* Tabs */}
      {(() => {
        const tabs: { key: typeof activeTab; label: string; icon: string; color: string; bg: string }[] = [
          { key: "tous", label: "Tous", icon: "👥", color: C.text, bg: C.bg },
          { key: "mairie", label: "Mairie", icon: "🏛", color: C.blue, bg: C.blueBg },
          { key: "instructeur", label: "Instructeurs", icon: "📋", color: C.green, bg: C.greenBg },
          { key: "citoyen", label: "Citoyens", icon: "🏠", color: "#D97706", bg: "#FEF3C7" },
          { key: "admin", label: "Admins", icon: "⭐", color: C.purple, bg: C.purpleBg },
        ];
        return (
          <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: `2px solid ${C.border}`, paddingBottom: 0 }}>
            {tabs.map((t) => {
              const isActive = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={{
                    padding: "10px 16px", border: "none", background: "none", cursor: "pointer",
                    fontSize: 13, fontWeight: isActive ? 700 : 500,
                    color: isActive ? t.color : C.textMuted,
                    borderBottom: isActive ? `3px solid ${t.color}` : "3px solid transparent",
                    marginBottom: -2, transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                  <span style={{ background: isActive ? t.bg : C.bg, color: isActive ? t.color : C.textMuted, borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>
                    {counts[t.key]}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Filters */}
      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par nom ou email…"
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
        {(filterCommune || search) && (
          <button onClick={() => { setFilterCommune(""); setSearch(""); }} style={{ padding: "8px 14px", background: C.redBg, color: C.red, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
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
                {["Nom Prénom", "Email", "Rôle", "Créé le", "Actions"].map((h) => (
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
                      <div>
                        <span style={{ fontWeight: 600, color: C.text }}>{u.prenom} {u.nom}</span>
                        {u.activation_pending && (
                          <div style={{ fontSize: 11, color: "#92400E", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 4, padding: "1px 6px", marginTop: 2, display: "inline-block" }}>
                            ⏳ En attente d'activation
                          </div>
                        )}
                      </div>
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
                  <td style={{ padding: "12px 16px", color: C.textMuted, fontSize: 13 }}>
                    {new Date(u.created_at).toLocaleDateString("fr-FR")}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {u.activation_pending && (
                        <button
                          onClick={() => handleResend(u.id, u.email)}
                          disabled={resendingId === u.id}
                          style={{ padding: "6px 10px", background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A", borderRadius: 6, cursor: resendingId === u.id ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600 }}
                          title="Renvoyer l'email d'invitation"
                        >
                          ✉ {resendingId === u.id ? "…" : "Renvoyer"}
                        </button>
                      )}
                      <button
                        onClick={() => openCommunesModal(u)}
                        style={{ padding: "6px 10px", background: C.accentLight, color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                        title="Gérer les communes"
                      >
                        🏛 Communes
                      </button>
                      <button
                        onClick={() => setConfirmDelete(u.id)}
                        style={{ padding: "6px 12px", background: C.redBg, color: C.red, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create modal */}
      {showModal && (
        <Modal title="Ajouter un utilisateur" onClose={() => { setShowModal(false); setFormCommuneIds(new Set()); }}>
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
            <Field label="Rôle *">
              <Select value={form.role} onChange={(v) => setForm({ ...form, role: v })}>
                <option value="admin">Admin</option>
                <option value="mairie">Mairie</option>
                <option value="instructeur">Instructeur</option>
                <option value="citoyen">Citoyen</option>
              </Select>
            </Field>
            <Field label={`Communes${formCommuneIds.size > 0 ? ` (${formCommuneIds.size} sélectionnée${formCommuneIds.size > 1 ? "s" : ""})` : ""}`}>
              <CoverageSelector allCommunes={allCommunes} selectedIds={formCommuneIds} onChange={setFormCommuneIds} />
            </Field>
            <Field label="Téléphone">
              <Input type="tel" value={form.telephone} onChange={(v) => setForm({ ...form, telephone: v })} />
            </Field>
            <div style={{ background: "#EFF6FF", border: `1px solid #BFDBFE`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#1D4ED8" }}>
              ✉️ Un email d'invitation sera envoyé à cette adresse avec un lien d'activation valable 7 jours.
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => { setShowModal(false); setFormCommuneIds(new Set()); }} style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.text }}>
                Annuler
              </button>
              <button onClick={handleCreate} style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                Créer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Communes modal */}
      {communesModal && (
        <Modal title={`Communes — ${communesModal.name}`} onClose={() => setCommunesModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>
              Sélectionnez les communes auxquelles cet utilisateur a accès. La commune principale reste celle définie dans son profil.
            </p>
            <CoverageSelector allCommunes={allCommunes} selectedIds={userCommuneIds} onChange={setUserCommuneIds} />
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => setCommunesModal(null)} style={{ padding: "9px 18px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.text }}>
                Annuler
              </button>
              <button onClick={() => void saveCommunesModal()} style={{ padding: "9px 22px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                Enregistrer
              </button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

// ─── Rôles & Permissions ──────────────────────────────────────────────────────
const PERMISSION_MODULES = [
  { group: "Dossiers", items: [
    { key: "dossiers.read",     label: "Consulter les dossiers",  desc: "Voir la liste et le détail des dossiers" },
    { key: "dossiers.instruct", label: "Instruire",               desc: "Changer le statut, ajouter des événements" },
    { key: "dossiers.decision", label: "Émettre une décision",    desc: "Accepter, refuser ou prescrire un dossier" },
  ]},
  { group: "Communication", items: [
    { key: "messagerie", label: "Messagerie",  desc: "Envoyer et recevoir des messages" },
    { key: "documents",  label: "Documents",   desc: "Consulter et télécharger les pièces jointes" },
  ]},
  { group: "Planification", items: [
    { key: "calendrier", label: "Calendrier",     desc: "Gérer les événements et délais réglementaires" },
    { key: "stats",      label: "Statistiques",   desc: "Tableaux de bord et indicateurs" },
    { key: "dashboard",  label: "Tableau de bord",desc: "Accès au dashboard de la commune" },
  ]},
  { group: "Réglementation", items: [
    { key: "zones.read", label: "Consulter le PLU", desc: "Accès en lecture au règlement de zonage" },
    { key: "zones.edit", label: "Modifier le PLU",  desc: "Créer et éditer les zones et règles PLU" },
  ]},
  { group: "Administration", items: [
    { key: "utilisateurs", label: "Gestion des agents",   desc: "Créer, modifier et désactiver les agents" },
    { key: "parametres",   label: "Paramètres commune",   desc: "Modifier les informations de la commune" },
  ]},
];

const ALL_PERM_KEYS = PERMISSION_MODULES.flatMap(m => m.items.map(i => i.key));
const PERM_LABEL: Record<string, string> = Object.fromEntries(PERMISSION_MODULES.flatMap(m => m.items.map(i => [i.key, i.label])));

interface RoleFormState { label: string; name: string; base_role: string; description: string; color: string; permissions: string[] }

function RoleFormPanel({ form, setForm, isSystem }: { form: RoleFormState; setForm: React.Dispatch<React.SetStateAction<RoleFormState>>; isSystem?: boolean }) {
  const toggle = (key: string) =>
    setForm(f => ({ ...f, permissions: f.permissions.includes(key) ? f.permissions.filter(p => p !== key) : [...f.permissions, key] }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Nom d'affichage *">
          <Input value={form.label} onChange={(v) => setForm(f => ({ ...f, label: v }))} placeholder="Ex : Instructeur senior" />
        </Field>
        <Field label="Rôle de base *">
          <Select value={form.base_role} onChange={(v) => setForm(f => ({ ...f, base_role: v }))}>
            {isSystem
              ? <option value={form.base_role}>{form.base_role === "mairie" ? "Mairie" : "Instructeur"}</option>
              : <><option value="instructeur">Instructeur</option><option value="mairie">Mairie</option></>}
          </Select>
        </Field>
      </div>
      <Field label="Description">
        <Input value={form.description} onChange={(v) => setForm(f => ({ ...f, description: v }))} placeholder="Courte description du profil" />
      </Field>
      <Field label="Couleur du badge">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="color" value={form.color} onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))}
            style={{ width: 40, height: 34, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", padding: 2 }} />
          <span style={{ padding: "3px 10px", borderRadius: 6, background: `${form.color}20`, color: form.color, fontSize: 12, fontWeight: 700 }}>
            {form.label || "Aperçu"}
          </span>
        </div>
      </Field>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 10 }}>
          Permissions — {form.permissions.length} / {ALL_PERM_KEYS.length} sélectionnées
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {PERMISSION_MODULES.map(group => (
            <div key={group.group}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>{group.group}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {group.items.map(item => {
                  const on = form.permissions.includes(item.key);
                  return (
                    <div key={item.key} onClick={() => toggle(item.key)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: on ? C.accentLight : C.bg, borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? C.accent : C.border}`, userSelect: "none" }}>
                      <div style={{ width: 16, height: 16, borderRadius: 4, background: on ? C.accent : "white", border: `2px solid ${on ? C.accent : C.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {on && <span style={{ color: "white", fontSize: 9, fontWeight: 900 }}>✓</span>}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: on ? C.accent : C.text }}>{item.label}</div>
                        <div style={{ fontSize: 11, color: C.textMuted }}>{item.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const BLANK_ROLE_FORM: RoleFormState = { label: "", name: "", base_role: "instructeur", description: "", color: "#0891B2", permissions: [] };

function Roles() {
  const [roleList, setRoleList] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [editingRole, setEditingRole] = useState<RolePermission | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [form, setForm] = useState<RoleFormState>(BLANK_ROLE_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRoleList(await api.get<RolePermission[]>("/admin/roles")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      if (editingRole) {
        await api.patch(`/admin/roles/${editingRole.id}`, form);
        setToast({ msg: "Rôle mis à jour", type: "success" });
        setEditingRole(null);
      } else {
        const name = form.name || form.label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_");
        await api.post("/admin/roles", { ...form, name });
        setToast({ msg: "Rôle créé", type: "success" });
        setShowCreate(false);
      }
      load();
    } catch (e) { setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" }); }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/admin/roles/${id}`);
      setToast({ msg: "Rôle supprimé", type: "success" });
      setConfirmDelete(null);
      load();
    } catch (e) { setToast({ msg: e instanceof Error ? e.message : "Erreur", type: "error" }); }
  };

  return (
    <PageShell>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {confirmDelete && <ConfirmDialog message="Supprimer ce rôle ? Les utilisateurs qui le possèdent garderont leur rôle de base." onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: C.text }}>Rôles & Permissions</h1>
          <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>Définissez les profils d'accès assignables par les responsables de commune.</p>
        </div>
        <button onClick={() => { setForm(BLANK_ROLE_FORM); setShowCreate(true); }}
          style={{ padding: "10px 20px", background: C.accent, color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
          + Créer un rôle
        </button>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spinner size={40} /></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {roleList.map(role => (
            <div key={role.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: `${role.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                {role.base_role === "mairie" ? "🏛" : "📋"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{role.label}</span>
                  {role.is_system && <span style={{ fontSize: 10, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 6px", color: C.textMuted, fontWeight: 600 }}>🔒 Système</span>}
                  <span style={{ padding: "3px 8px", borderRadius: 6, background: `${role.color}20`, color: role.color, fontSize: 11, fontWeight: 700 }}>
                    {role.base_role === "mairie" ? "Mairie" : "Instructeur"}
                  </span>
                </div>
                {role.description && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>{role.description}</div>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(role.permissions as string[]).map(p => (
                    <span key={p} style={{ padding: "2px 7px", background: `${role.color}15`, color: role.color, fontSize: 10, fontWeight: 600, borderRadius: 4 }}>
                      {PERM_LABEL[p] ?? p}
                    </span>
                  ))}
                  {role.permissions.length === 0 && <span style={{ fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>Aucune permission</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => { setEditingRole(role); setForm({ label: role.label, name: role.name, base_role: role.base_role, description: role.description ?? "", color: role.color, permissions: [...role.permissions] }); }}
                  style={{ padding: "6px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.text }}>
                  Modifier
                </button>
                {!role.is_system && (
                  <button onClick={() => setConfirmDelete(role.id)}
                    style={{ padding: "6px 14px", background: C.redBg, color: C.red, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(showCreate || editingRole) && (
        <Modal title={editingRole ? `Modifier · ${editingRole.label}` : "Créer un rôle"} onClose={() => { setShowCreate(false); setEditingRole(null); }}>
          <RoleFormPanel form={form} setForm={setForm} isSystem={editingRole?.is_system} />
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}>
            <button onClick={() => { setShowCreate(false); setEditingRole(null); }}
              style={{ padding: "10px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.text }}>
              Annuler
            </button>
            <button onClick={handleSave}
              style={{ padding: "10px 24px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
              {editingRole ? "Enregistrer" : "Créer le rôle"}
            </button>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

// ─── Configuration ────────────────────────────────────────────────────────────
interface LegalMentionRow {
  id: string;
  code: string;       // LEGITEXT id
  code_name: string;
  article_ref: string;
  article_title: string | null;
  article_html: string | null;
  courrier_types: string[];
  dossier_types: string[];
  categories: string[];
  contexte: string | null;
  updated_at: string;
  fetched_at?: string;
}

interface MissingArticleRow {
  id: string;
  code_key: string;     // CU / CCH / CE
  article_ref: string;
  first_seen_at: string;
  last_seen_at: string;
  miss_count: number;
  resolved_at: string | null;
  resolution: "created" | "dismissed" | null;
}

// Map LEGITEXT id → clé courte (CU/CCH/CE) pour l'affichage et le filtrage.
// Doit rester aligné avec apps/api/src/services/legifrance.ts → resolveCode.
const CODE_KEY_BY_LEGITEXT: Record<string, "CU" | "CCH" | "CE"> = {
  LEGITEXT000006074075: "CU",
  LEGITEXT000006074096: "CCH",
  LEGITEXT000006074220: "CE",
};
const CODE_LABEL: Record<string, string> = {
  CU:  "Code de l'urbanisme",
  CCH: "Code de la construction",
  CE:  "Code de l'environnement",
};

const COURRIER_TYPE_OPTIONS = [
  { value: "pieces_complementaires", label: "Pièces complémentaires" },
  { value: "refus", label: "Refus" },
  { value: "non_opposition", label: "Non-opposition / accord" },
  { value: "majoration_delai", label: "Majoration de délai" },
  { value: "daact", label: "DAACT / achèvement" },
  { value: "sursis", label: "Sursis à statuer" },
  { value: "notification", label: "Notification de décision" },
];
const DOSSIER_TYPE_OPTIONS = [
  { value: "DP", label: "DP — Déclaration préalable" },
  { value: "PC", label: "PC — Permis de construire" },
  { value: "PA", label: "PA — Permis d'aménager" },
  { value: "PD", label: "PD — Permis de démolir" },
  { value: "CU", label: "CU — Certificat d'urbanisme" },
];

// ─── Conformité RGPD ────────────────────────────────────────────────────────
// Page récapitulative à destination des admins, DSI et DPD. Liste les
// mesures techniques et organisationnelles en place pour garantir la
// conformité RGPD et l'IA Act sur l'analyse automatisée des pièces.
// Source de vérité : docs/security/conformite-dsi.md (référencé pour traçage).
function Conformite() {
  type MesureStatut = "actif" | "doc" | "a_faire";
  interface Mesure {
    titre: string;
    description: string;
    reference: string;     // article RGPD / CCSC / source réglementaire
    statut: MesureStatut;
    code_ref?: string;     // fichier code qui implémente la mesure
  }
  interface Section {
    icone: string;
    titre: string;
    sous_titre: string;
    couleur: string;
    bg: string;
    mesures: Mesure[];
  }

  const sections: Section[] = [
    {
      icone: "🤖",
      titre: "Analyse IA des pièces déposées",
      sous_titre: "Encadrement du recours à un LLM tiers (Mistral La Plateforme) sur le contenu des dossiers",
      couleur: "#4F46E5",
      bg: "#EEF2FF",
      mesures: [
        {
          titre: "Consentement explicite du citoyen (opt-out)",
          description: "Bandeau d'information détaillé affiché à l'étape « pièces » du dépôt. Le citoyen peut refuser l'analyse IA à tout moment via une case à cocher — ses pièces sont alors transmises à l'instructeur sans aucun appel LLM.",
          reference: "RGPD art. 13 + art. 22",
          statut: "actif",
          code_ref: "NouvelleDemandeWizard.tsx · step 7",
        },
        {
          titre: "Minimisation des données envoyées au LLM",
          description: "Le nom de fichier d'origine du citoyen (souvent « permis-Jean-Dupont.pdf ») est retiré et remplacé par la rubrique métier (« Plan de masse »). Le numéro de parcelle complet est tronqué à la section cadastrale. Aucun nom, prénom, email, téléphone ou adresse postale n'est passé au modèle.",
          reference: "RGPD art. 5.1.c (minimisation)",
          statut: "actif",
          code_ref: "pieceAnalyzer.ts · sanitizePieceName + maskParcelle",
        },
        {
          titre: "Trace par empreinte (hash SHA-256)",
          description: "Chaque appel IA est journalisé dans ai_usage_events avec l'empreinte SHA-256 du fichier envoyé. Permet de prouver / réfuter qu'un fichier précis a été soumis, sans dupliquer le contenu personnel en base d'audit.",
          reference: "RGPD art. 30 + 32",
          statut: "actif",
          code_ref: "aiUsage.ts · file_hash",
        },
        {
          titre: "Trace par pièce (ai_processed)",
          description: "La table dossier_pieces_jointes porte un booléen ai_processed indiquant si l'IA a effectivement été appelée sur la pièce. Permet de reconstituer le périmètre du traitement automatisé pièce par pièce.",
          reference: "RGPD art. 30",
          statut: "actif",
          code_ref: "schema/dossier_pieces_jointes.ts",
        },
        {
          titre: "Trace au niveau du dossier (ai_consent)",
          description: "Colonne ai_consent + ai_consent_at sur la table dossiers : enregistre la dernière décision explicite du pétitionnaire avec horodatage. Préservé même si le dossier est par la suite consulté en lecture seule.",
          reference: "RGPD art. 7.1 (preuve du consentement)",
          statut: "actif",
          code_ref: "schema/dossiers.ts",
        },
        {
          titre: "Décision humaine systématique",
          description: "L'IA produit un avis qualitatif (conforme / acceptable / incomplet / non_conforme) et une extraction structurée. Aucune décision n'est rendue automatiquement : un instructeur humain valide chaque pièce et chaque dossier. Le bandeau citoyen l'indique explicitement.",
          reference: "RGPD art. 22 (décision automatisée)",
          statut: "actif",
          code_ref: "pieceAnalyzer.ts · prompts + MairieApp",
        },
      ],
    },
    {
      icone: "🔐",
      titre: "Sécurité technique",
      sous_titre: "Confidentialité, intégrité et disponibilité",
      couleur: "#059669",
      bg: "#ECFDF5",
      mesures: [
        {
          titre: "Chiffrement en transit (HTTPS forcé)",
          description: "HTTPS imposé par l'hébergeur en production, HSTS activé (max-age=15552000) via Helmet.",
          reference: "PGSSI § Transport",
          statut: "actif",
          code_ref: "app.ts · helmet",
        },
        {
          titre: "Headers de sécurité HTTP",
          description: "Helmet configuré avec CSP stricte, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy no-referrer.",
          reference: "CCSC Art. 11.3",
          statut: "actif",
          code_ref: "app.ts",
        },
        {
          titre: "Authentification JWT en cookie HttpOnly",
          description: "Token signé HS256, stocké en cookie HttpOnly / Secure / SameSite=Strict (pas en localStorage). Mots de passe hashés bcrypt (coût 10).",
          reference: "PGSSI § 2.3",
          statut: "actif",
          code_ref: "auth.ts",
        },
        {
          titre: "Requêtes SQL paramétrées",
          description: "Toutes les requêtes passent par Drizzle ORM : impossibilité d'injection SQL. Validation Zod sur tous les endpoints POST/PATCH.",
          reference: "OWASP A03",
          statut: "actif",
          code_ref: "Drizzle ORM",
        },
        {
          titre: "Journal d'audit des authentifications",
          description: "Table audit_logs : login, login_failed, logout, register, avec IP et user-agent. Rétention 12 mois (index dédié pour la purge).",
          reference: "Annexe Technique n°2 §4.14",
          statut: "actif",
          code_ref: "schema/auditLogs.ts",
        },
        {
          titre: "Fichier security.txt",
          description: "Disponible à /.well-known/security.txt — point de contact pour signalement de vulnérabilité.",
          reference: "CCSC Art. 11.3",
          statut: "actif",
        },
        {
          titre: "Sauvegardes chiffrées 3-2-1",
          description: "pg_dump quotidien + archive des uploads et de la configuration (nginx/systemd), chiffrés en GPG AES-256. Trois copies : VPS, arborescence locale /var/backups/heureka/ et mirror OVH Object Storage (Gravelines 🇫🇷). Rétention 7 quotidiennes / 4 hebdomadaires / 6 mensuelles, vérification automatique hebdomadaire par restauration test. Procédures opérationnelles documentées.",
          reference: "CCSC Art. 11.6",
          statut: "actif",
          code_ref: "infra/backup/ + docs/security/dossier-exploitation.md",
        },
      ],
    },
    {
      icone: "📋",
      titre: "Conformité documentaire RGPD",
      sous_titre: "Information, droits des personnes et registre",
      couleur: "#D97706",
      bg: "#FFFBEB",
      mesures: [
        {
          titre: "Information du pétitionnaire (art. 13)",
          description: "Bandeau d'information détaillé affiché au moment du dépôt : finalité, base légale, sous-traitant, données envoyées, droits, durée de conservation, absence de décision automatisée.",
          reference: "RGPD art. 13",
          statut: "actif",
          code_ref: "NouvelleDemandeWizard.tsx · step 7",
        },
        {
          titre: "DPA avec Mistral AI (sous-traitant LLM)",
          description: "Sous-traitant Mistral AI (SAS française, Paris) — DPA disponible sur la console Mistral. Hébergement et inférence en UE (France), aucun transfert hors UE → pas de SCC requises. Reste l'acte de signature avec la collectivité avant mise en production.",
          reference: "RGPD art. 28",
          statut: "doc",
          code_ref: "docs/security/dpa-mistral-checklist.md",
        },
        {
          titre: "Mentions légales & politique de confidentialité",
          description: "Pages publiques /mentions-legales et /politique-confidentialite : responsable de traitement (collectivité), sous-traitants détaillés (OVH SAS, Mistral AI, Resend) avec localisation des données, section dédiée à l'analyse IA (sous-traitant, données transmises, rétention 30j, décision humaine art. 22), droits des personnes avec pointeurs vers les actions de l'espace Profil. Inférence IA en France (Mistral AI Paris), hébergement applicatif en France (OVH). Liens visibles depuis les footers public et connecté.",
          reference: "RGPD art. 13-14",
          statut: "actif",
          code_ref: "MentionsLegales.tsx + PolitiqueConfidentialite.tsx",
        },
        {
          titre: "Registre des traitements (art. 30)",
          description: "4 fiches pré-remplies prêtes à recopier dans le registre de la collectivité (docs/security/registre-traitements.md) : instruction des autorisations, analyse IA, gestion des comptes, journaux de sécurité. Sections marquées [À COMPLÉTER] pour les éléments propres à chaque collectivité.",
          reference: "RGPD art. 30",
          statut: "actif",
          code_ref: "docs/security/registre-traitements.md",
        },
        {
          titre: "AIPD — Analyse d'Impact (art. 35)",
          description: "AIPD rédigée et structurée selon la méthodologie CNIL (docs/security/aipd.md) : description du traitement, nécessité et proportionnalité, évaluation des risques (confidentialité, intégrité, disponibilité, biais IA), plan d'action. Section avis DPD à compléter par la collectivité avant mise en production. Revue annuelle prévue.",
          reference: "RGPD art. 35",
          statut: "actif",
          code_ref: "docs/security/aipd.md",
        },
        {
          titre: "Droits des personnes — accès, portabilité, effacement",
          description: "Page « Profil » du citoyen exposant : export JSON complet (profil + dossiers + pièces + messages + consentement IA + journal des appels IA avec empreinte SHA-256 + journal d'audit), suppression de compte avec confirmation par mot de passe et effacement physique des fichiers sur disque (RGPD art. 17). Contact DPD affiché.",
          reference: "RGPD art. 15, 17, 20",
          statut: "actif",
          code_ref: "auth.ts · /me/export + DELETE /me, Profil.tsx",
        },
      ],
    },
    {
      icone: "🇪🇺",
      titre: "Hébergement & localisation",
      sous_titre: "Souveraineté et transferts internationaux",
      couleur: "#7C3AED",
      bg: "#F5F3FF",
      mesures: [
        {
          titre: "Hébergement applicatif en France (OVH)",
          description: "Plateforme déployée sur VPS OVH, datacenters français (Gravelines / Roubaix / Strasbourg). Sauvegardes stockées sur OVH Object Storage (Gravelines 🇫🇷). Conforme à l'exigence « serveurs en France ou UE » — aucun transfert hors UE.",
          reference: "Annexe Technique n°2 §4.12",
          statut: "actif",
        },
        {
          titre: "LLM Mistral La Plateforme — hébergement en France",
          description: "Tous les appels IA (analyse de pièces, extraction, verdicts de conformité, structuration PLU) passent par Mistral La Plateforme, entité française (Mistral AI SAS, Paris) hébergeant l'inférence en France. Aucun transfert hors UE, droit français applicable. Modèle vision Pixtral Large pour les pièces, format chat completions OpenAI-compatible.",
          reference: "RGPD art. 28 + souveraineté numérique",
          statut: "actif",
          code_ref: "aiUsage.ts · MISTRAL_API_BASE",
        },
        {
          titre: "Purge automatique des logs d'audit (12 mois)",
          description: "Cron quotidien à 02h00 : supprime les entrées audit_logs antérieures à 12 mois. Durée paramétrable via AUDIT_LOG_RETENTION_MONTHS.",
          reference: "CCSC §4.14 + RGPD art. 5.1.e",
          statut: "actif",
          code_ref: "jobs/scheduler.ts",
        },
        {
          titre: "Purge automatique des brouillons abandonnés (180 jours)",
          description: "Cron quotidien à 02h30 : supprime les dossiers en statut brouillon non touchés depuis 180 jours, ainsi que les fichiers physiques associés. Durée paramétrable via DRAFT_DOSSIER_RETENTION_DAYS.",
          reference: "RGPD art. 5.1.e (minimisation)",
          statut: "actif",
          code_ref: "jobs/scheduler.ts",
        },
      ],
    },
  ];

  const statusConf: Record<MesureStatut, { label: string; bg: string; color: string }> = {
    actif:    { label: "✓ Actif",         bg: "#DCFCE7", color: "#15803D" },
    doc:      { label: "📄 Documentaire", bg: "#FEF3C7", color: "#92400E" },
    a_faire:  { label: "⏳ À planifier",   bg: "#FEE2E2", color: "#B91C1C" },
  };

  const total = sections.reduce((acc, s) => acc + s.mesures.length, 0);
  const actifs = sections.reduce((acc, s) => acc + s.mesures.filter((m) => m.statut === "actif").length, 0);

  return (
    <PageShell>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: C.text }}>Conformité RGPD & sécurité</h1>
        <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>
          Mesures techniques et organisationnelles en place pour garantir la conformité du traitement des données personnelles, et en particulier de l'analyse IA des pièces déposées.
        </p>
      </div>

      {/* Bandeau synthèse */}
      <div style={{
        background: "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)",
        borderRadius: 14,
        padding: "20px 24px",
        marginBottom: 24,
        color: "white",
        display: "flex",
        alignItems: "center",
        gap: 20,
      }}>
        <div style={{ fontSize: 36 }}>🛡</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
            {actifs} mesures actives sur {total}
          </div>
          <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.5 }}>
            HEUREKIA met en œuvre une approche « privacy by design » : minimisation des données envoyées à l'IA, consentement explicite du citoyen, décision finale humaine systématique, traçabilité par empreinte SHA-256 et journal d'audit.
          </div>
        </div>
      </div>

      {/* Note pédagogique pour les agents et la DSI */}
      <div style={{
        background: "#F8FAFC",
        border: `1px dashed ${C.border}`,
        borderRadius: 12,
        padding: "16px 20px",
        marginBottom: 24,
        fontSize: 13,
        color: "#475569",
        lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 700, color: C.text, marginBottom: 6 }}>ℹ️ À destination de la DSI, du DPD et des agents</div>
        Cette page récapitule l'ensemble des mesures de conformité actuellement en place dans la plateforme. Elle est destinée à être communiquée à la DSI Tours Métropole, au Délégué à la Protection des Données et aux instructeurs sur demande. Pour le détail réglementaire complet, voir le document <code style={{ background: "#E2E8F0", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>docs/security/conformite-dsi.md</code> du dépôt.
      </div>

      {/* Sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {sections.map((section) => (
          <div
            key={section.titre}
            style={{
              background: C.white,
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              overflow: "hidden",
            }}
          >
            <div style={{
              background: section.bg,
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                flexShrink: 0,
              }}>{section.icone}</div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: section.couleur }}>{section.titre}</h3>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.textMuted }}>{section.sous_titre}</p>
              </div>
            </div>

            <div style={{ padding: "8px 0" }}>
              {section.mesures.map((m, idx) => {
                const st = statusConf[m.statut];
                return (
                  <div
                    key={m.titre}
                    style={{
                      padding: "14px 20px",
                      borderBottom: idx < section.mesures.length - 1 ? `1px solid ${C.bg}` : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                          {m.titre}
                        </div>
                        <div style={{ fontSize: 11.5, color: C.textMuted }}>
                          {m.reference}
                          {m.code_ref && <span style={{ color: "#94A3B8" }}> · <code style={{ background: C.bg, padding: "1px 5px", borderRadius: 3, fontSize: 11 }}>{m.code_ref}</code></span>}
                        </div>
                      </div>
                      <span style={{
                        padding: "3px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        background: st.bg,
                        color: st.color,
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                      }}>{st.label}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: "#475569", lineHeight: 1.55 }}>
                      {m.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: "14px 20px", background: C.bg, borderRadius: 10, fontSize: 12, color: C.textMuted, lineHeight: 1.6 }}>
        Légende — <strong style={{ color: "#15803D" }}>Actif</strong> : mesure implémentée dans le code et opérationnelle. <strong style={{ color: "#92400E" }}>Documentaire</strong> : mesure organisationnelle (contrat, document, procédure) à formaliser avant mise en production officielle. <strong style={{ color: "#B91C1C" }}>À planifier</strong> : chantier identifié, non encore engagé.
      </div>
    </PageShell>
  );
}

// ── Articles manquants ──────────────────────────────────────────────────────
// Liste les références d'articles que les utilisateurs ont cliquées mais que
// Légifrance n'a pas pu nous renvoyer (référence erronée, code non supporté,
// API en panne…). L'admin peut soit créer l'article via l'API Légifrance
// (re-tentative), soit ignorer la demande (faux positif).
function MissingArticlesPanel({ onCreated }: { onCreated?: (row: LegalMentionRow) => void }) {
  const [misses, setMisses] = useState<MissingArticleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.get<MissingArticleRow[]>("/admin/legal-mentions/missing");
      setMisses(rows);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (m: MissingArticleRow) => {
    setActingId(m.id);
    setError(null);
    try {
      const resp = await api.post<{ miss: MissingArticleRow; article: LegalMentionRow | null }>(
        `/admin/legal-mentions/missing/${m.id}/create`, {},
      );
      setMisses(prev => prev.filter(x => x.id !== m.id));
      if (resp.article && onCreated) onCreated(resp.article);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création échouée");
    } finally {
      setActingId(null);
    }
  };

  const handleDismiss = async (m: MissingArticleRow) => {
    setActingId(m.id);
    setError(null);
    try {
      await api.post(`/admin/legal-mentions/missing/${m.id}/dismiss`, {});
      setMisses(prev => prev.filter(x => x.id !== m.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action échouée");
    } finally {
      setActingId(null);
    }
  };

  // Tant qu'il n'y a aucune demande en attente, on garde la section discrète
  // (un simple badge "tout est OK"). Elle apparaît dès qu'une référence cassée
  // est cliquée par un utilisateur.
  if (loading) {
    return (
      <div style={{ background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Spinner size={16} /><span style={{ fontSize: 13, color: C.textMuted }}>Chargement des demandes…</span>
        </div>
      </div>
    );
  }

  const headerStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 16, marginBottom: misses.length === 0 ? 0 : 16 };
  const iconBg = misses.length === 0 ? "#ECFDF5" : "#FEF3C7";
  const iconColor = misses.length === 0 ? "#059669" : "#B45309";

  return (
    <div style={{ background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, padding: 24, marginBottom: 24 }}>
      <div style={headerStyle}>
        <div style={{ width: 48, height: 48, background: iconBg, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0, color: iconColor }}>
          {misses.length === 0 ? "✓" : "⚠"}
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: C.text }}>
            Articles manquants{misses.length > 0 ? ` (${misses.length})` : ""}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>
            {misses.length === 0
              ? "Aucune demande en attente. Les articles cliqués dans le site qui ne sont pas en base apparaîtront ici pour création via Légifrance."
              : "Références cliquées par les utilisateurs et introuvables côté Légifrance. Crée-les pour qu'elles ouvrent leur texte officiel, ou ignore-les si la référence est erronée."}
          </p>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, fontSize: 12, color: "#7F1D1D" }}>
          {error}
        </div>
      )}

      {misses.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {misses.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ padding: "2px 7px", background: "#1E293B", color: "white", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.3 }}>{m.code_key}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Art. {m.article_ref}</span>
                  {m.miss_count > 1 && (
                    <span style={{ padding: "1px 8px", background: "#FEF3C7", color: "#92400E", borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                      cliqué {m.miss_count}×
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
                  Dernière demande : {new Date(m.last_seen_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => void handleCreate(m)} disabled={actingId === m.id}
                  style={{ padding: "6px 12px", background: actingId === m.id ? "#C7D2FE" : "#4F46E5", color: "white", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: actingId === m.id ? "default" : "pointer" }}>
                  {actingId === m.id ? "Création…" : "Créer via Légifrance"}
                </button>
                <button onClick={() => void handleDismiss(m)} disabled={actingId === m.id}
                  style={{ padding: "6px 12px", background: "white", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: actingId === m.id ? "default" : "pointer" }}>
                  Ignorer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Configuration() {
  const [articles, setArticles] = useState<LegalMentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LegalMentionRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editHtml, setEditHtml] = useState("");
  const [editCourrierTypes, setEditCourrierTypes] = useState<string[]>([]);
  const [editDossierTypes, setEditDossierTypes] = useState<string[]>([]);
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [editContexte, setEditContexte] = useState("");
  const [saving, setSaving] = useState(false);
  const [addRef, setAddRef] = useState("");
  const [addCode, setAddCode] = useState<"CU" | "CCH" | "CE">("CU");
  const [addSearchQuery, setAddSearchQuery] = useState("");
  const [addSearchHits, setAddSearchHits] = useState<{ num: string; sectionPath: string }[]>([]);
  const [addSearchLoading, setAddSearchLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // ── Filtres ──
  const [filterCode, setFilterCode] = useState<"all" | "CU" | "CCH" | "CE">("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterText, setFilterText] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await api.get<LegalMentionRow[]>("/admin/legal-mentions");
      setArticles(rows);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredArticles = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return articles.filter(a => {
      const codeKey = CODE_KEY_BY_LEGITEXT[a.code];
      if (filterCode !== "all" && codeKey !== filterCode) return false;
      if (filterCategory !== "all" && !(a.categories ?? []).includes(filterCategory)) return false;
      if (q && !a.article_ref.toLowerCase().includes(q) && !(a.article_title ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [articles, filterCode, filterCategory, filterText]);

  // Groupage par catégorie (display-only). Un article apparaît dans chacune
  // de ses catégories ; les articles sans catégorie tombent dans "_uncategorized".
  const articlesByCategory = useMemo(() => {
    const groups = new Map<string, LegalMentionRow[]>();
    for (const a of filteredArticles) {
      const cats = a.categories?.length ? a.categories : ["_uncategorized"];
      for (const c of cats) {
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c)!.push(a);
      }
    }
    return groups;
  }, [filteredArticles]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of articles) {
      for (const c of a.categories ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return counts;
  }, [articles]);

  const openEdit = (a: LegalMentionRow) => {
    setEditing(a);
    setEditTitle(a.article_title ?? "");
    setEditHtml(a.article_html ?? "");
    setEditCourrierTypes(a.courrier_types ?? []);
    setEditDossierTypes(a.dossier_types ?? []);
    setEditCategories(a.categories ?? []);
    setEditContexte(a.contexte ?? "");
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await api.patch<LegalMentionRow>(`/admin/legal-mentions/${editing.id}`, { article_title: editTitle, article_html: editHtml, courrier_types: editCourrierTypes, dossier_types: editDossierTypes, categories: editCategories, contexte: editContexte });
      setArticles(prev => prev.map(a => a.id === updated.id ? updated : a));
      setEditing(null);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  // Rafraîchir le texte de l'article depuis Légifrance (via PISTE).
  const handleRefresh = async (a: LegalMentionRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRefreshingId(a.id);
    try {
      const updated = await api.post<LegalMentionRow>(`/admin/legal-mentions/${a.id}/refresh`, {});
      setArticles(prev => prev.map(x => x.id === updated.id ? updated : x));
      if (editing?.id === updated.id) {
        setEditHtml(updated.article_html ?? "");
        setEditTitle(updated.article_title ?? "");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      window.alert(`Rafraîchissement Légifrance échoué pour ${a.article_ref} :\n\n${msg}`);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleAdd = async () => {
    if (!addRef.trim()) return;
    setSaving(true);
    setAddError(null);
    try {
      const row = await api.post<LegalMentionRow>("/admin/legal-mentions", {
        article_ref: addRef,
        code: addCode,
        courrier_types: [],
        dossier_types: [],
        categories: [],
        contexte: null,
      });
      // Comme l'article peut être un upsert, on retire l'ancien d'abord si présent.
      setArticles(prev => [...prev.filter(a => a.id !== row.id), row].sort((a, b) => a.article_ref.localeCompare(b.article_ref)));
      setAddRef(""); setAddSearchQuery(""); setAddSearchHits([]); setShowAdd(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  };

  // Recherche debouncée dans la TOC du code sélectionné.
  useEffect(() => {
    if (!showAdd) return;
    const q = addSearchQuery.trim();
    if (q.length < 2) { setAddSearchHits([]); return; }
    setAddSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { hits } = await api.get<{ hits: { num: string; sectionPath: string }[] }>(
          `/admin/legal-mentions/toc-search?code=${addCode}&q=${encodeURIComponent(q)}&limit=15`,
        );
        setAddSearchHits(hits);
      } catch {
        setAddSearchHits([]);
      } finally {
        setAddSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [addSearchQuery, addCode, showAdd]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Supprimer cet article ?")) return;
    await api.delete(`/admin/legal-mentions/${id}`);
    setArticles(prev => prev.filter(a => a.id !== id));
  };

  const todoCards = [
    { icon: "⚙️", title: "Paramètres plateforme", desc: "Configurez les paramètres généraux de la plateforme HEUREKIA." },
    { icon: "📧", title: "Emails & notifications", desc: "Templates d'emails, règles de notification et intégrations SMTP." },
  ];

  return (
    <PageShell>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: C.text }}>Configuration</h1>
        <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>Paramètres avancés de la plateforme</p>
      </div>

      {/* ── Demandes d'articles manquants (issues des clics utilisateurs) ── */}
      <MissingArticlesPanel
        onCreated={(row) => setArticles(prev => [...prev.filter(a => a.id !== row.id), row].sort((a, b) => a.article_ref.localeCompare(b.article_ref)))}
      />

      {/* ── Articles juridiques (Code de l'urbanisme + CCH + CE) ── */}
      <div style={{ background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            <div style={{ width: 48, height: 48, background: "#EFF6FF", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>📜</div>
            <div>
              <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: C.text }}>Articles juridiques</h3>
              <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>
                {articles.length} articles en base · {filteredArticles.length} affichés. Texte officiel synchronisé depuis Légifrance.
              </p>
            </div>
          </div>
          <button onClick={() => setShowAdd(v => !v)}
            style={{ padding: "8px 16px", background: "#0F172A", color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            + Ajouter
          </button>
        </div>

        {/* Sommaire CU / CCH / CE — toujours visible pour rappeler à quoi correspondent les badges. */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18, padding: "10px 14px", background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }}>
          <span style={{ color: C.textMuted, fontWeight: 600 }}>Codes :</span>
          {[
            { k: "CU",  label: "Code de l'urbanisme",                       desc: "PC, DP, PA, certificat d'urbanisme, ABF, recours…" },
            { k: "CCH", label: "Code de la construction et de l'habitation", desc: "RE2020, accessibilité, sécurité incendie…" },
            { k: "CE",  label: "Code de l'environnement",                   desc: "PPRN, PPRI, étude d'impact, sites pollués…" },
          ].map(c => (
            <span key={c.k} title={c.desc} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ padding: "2px 7px", background: "#1E293B", color: "white", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.3 }}>{c.k}</span>
              <span style={{ color: C.text }}>{c.label}</span>
            </span>
          ))}
        </div>

        {/* ── Barre de filtres ── */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          <input
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="🔍 Rechercher (référence ou titre)…"
            style={{ flex: 1, minWidth: 220, padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13 }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            {(["all", "CU", "CCH", "CE"] as const).map(c => (
              <button key={c} onClick={() => setFilterCode(c)}
                style={{
                  padding: "6px 12px", borderRadius: 7, border: `1px solid ${filterCode === c ? "#0F172A" : C.border}`,
                  background: filterCode === c ? "#0F172A" : "white", color: filterCode === c ? "white" : C.text,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}>
                {c === "all" ? "Tous codes" : c}
              </button>
            ))}
          </div>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            style={{ padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "white", cursor: "pointer" }}>
            <option value="all">Toutes catégories ({articles.length})</option>
            {CATEGORIES.map(cat => (
              <option key={cat.id} value={cat.id}>
                {cat.label} ({categoryCounts.get(cat.id) ?? 0})
              </option>
            ))}
          </select>
        </div>

        {showAdd && (
          <div style={{ background: C.bg, borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Code</div>
                <select value={addCode} onChange={e => { setAddCode(e.target.value as "CU" | "CCH" | "CE"); setAddSearchHits([]); }}
                  style={{ padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "white", cursor: "pointer", width: 80 }}>
                  <option value="CU">CU</option>
                  <option value="CCH">CCH</option>
                  <option value="CE">CE</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 220, position: "relative" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Recherche (référence ou mot-clé)</div>
                <input
                  value={addSearchQuery}
                  onChange={e => { setAddSearchQuery(e.target.value); setAddRef(e.target.value.toUpperCase()); }}
                  placeholder="R431-2, DAACT, lotissement…"
                  style={{ width: "100%", padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, boxSizing: "border-box" }} />
                {addSearchHits.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, maxHeight: 280, overflowY: "auto", background: "white", border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.1)", zIndex: 10 }}>
                    {addSearchHits.map(h => (
                      <div key={h.num} onClick={() => { setAddRef(h.num); setAddSearchQuery(h.num); setAddSearchHits([]); }}
                        style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}
                        onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                        onMouseLeave={e => (e.currentTarget.style.background = "white")}>
                        <div style={{ fontWeight: 700, color: C.accent, marginBottom: 2 }}>Art. {h.num}</div>
                        <div style={{ color: C.textMuted, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.sectionPath || "—"}</div>
                      </div>
                    ))}
                  </div>
                )}
                {addSearchLoading && addSearchHits.length === 0 && (
                  <div style={{ marginTop: 4, fontSize: 11, color: C.textMuted }}>Recherche…</div>
                )}
              </div>
              <button onClick={handleAdd} disabled={saving || !addRef.trim()}
                style={{ padding: "8px 16px", background: addRef.trim() && !saving ? "#0F172A" : "#E2E8F0", color: addRef.trim() && !saving ? "white" : "#94a3b8", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: addRef.trim() && !saving ? "pointer" : "default" }}>
                {saving ? "Validation…" : "Créer"}
              </button>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: C.textMuted }}>
              💡 La référence est validée contre Légifrance à la création. Texte et titre seront récupérés automatiquement.
            </div>
            {addError && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, fontSize: 12, color: "#7F1D1D" }}>
                {addError}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 24 }}><Spinner size={20} /></div>
        ) : (
          // Groupage par catégorie (selon le filtre) — un même article peut
          // apparaître dans plusieurs sections s'il est multi-catégorisé.
          <div>
            {[...articlesByCategory.entries()]
              .sort(([a], [b]) => {
                if (a === "_uncategorized") return 1;
                if (b === "_uncategorized") return -1;
                const orderA = CATEGORIES.findIndex(c => c.id === a);
                const orderB = CATEGORIES.findIndex(c => c.id === b);
                return orderA - orderB;
              })
              .map(([catId, arts]) => {
                const catDef = CATEGORIES.find(c => c.id === catId);
                const label = catDef?.label ?? "Sans catégorie";
                return (
                  <div key={catId} style={{ marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>({arts.length})</div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                      {arts.map(a => {
                        const codeKey = CODE_KEY_BY_LEGITEXT[a.code] ?? "?";
                        return (
                          <div key={`${catId}-${a.id}`} onClick={() => openEdit(a)}
                            style={{ padding: "10px 14px", borderRadius: 9, border: `1px solid ${C.border}`, cursor: "pointer", background: C.bg, transition: "box-shadow 0.15s" }}
                            onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)")}
                            onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                <span style={{ padding: "2px 6px", background: "#1E293B", color: "white", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.3 }}>{codeKey}</span>
                                <span style={{ fontWeight: 700, fontSize: 13, color: C.accent, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Art. {a.article_ref}</span>
                              </div>
                              <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                                <div title={a.article_html ? "Texte renseigné" : "Texte vide"} style={{ width: 8, height: 8, borderRadius: "50%", background: a.article_html ? "#22C55E" : "#E2E8F0" }} />
                                <button onClick={e => handleRefresh(a, e)} disabled={refreshingId === a.id}
                                  title="Rafraîchir depuis Légifrance"
                                  style={{ background: "none", border: "none", cursor: refreshingId === a.id ? "wait" : "pointer", color: C.textMuted, fontSize: 14, padding: "0 4px" }}>
                                  {refreshingId === a.id ? "⏳" : "↻"}
                                </button>
                                <button onClick={e => { e.stopPropagation(); handleDelete(a.id); }}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
                              </div>
                            </div>
                            <div style={{ fontSize: 11, color: C.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {a.article_title ?? <em>Sans titre — {a.article_html ? `${a.article_html.length} car.` : "texte non récupéré"}</em>}
                            </div>
                            {a.categories?.length > 1 && (
                              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 5 }}>
                                {a.categories.filter(c => c !== catId).map(c => {
                                  const def = CATEGORIES.find(d => d.id === c);
                                  return def ? (
                                    <span key={c} style={{ padding: "1px 6px", background: "white", border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 9, color: C.textMuted }}>
                                      {def.label}
                                    </span>
                                  ) : null;
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            {articlesByCategory.size === 0 && (
              <div style={{ textAlign: "center", padding: 30, color: C.textMuted, fontSize: 13 }}>
                Aucun article ne correspond aux filtres.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Edit modal ── */}
      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setEditing(null)}>
          <div style={{ background: "white", borderRadius: 16, padding: 28, width: "min(640px, 95vw)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ padding: "3px 7px", background: "#1E293B", color: "white", borderRadius: 5, fontSize: 10, fontWeight: 700 }}>
                  {CODE_KEY_BY_LEGITEXT[editing.code] ?? "?"}
                </span>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Art. {editing.article_ref}</h3>
                <span style={{ fontSize: 12, color: C.textMuted }}>· {CODE_LABEL[CODE_KEY_BY_LEGITEXT[editing.code] ?? ""] ?? editing.code_name}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => handleRefresh(editing)} disabled={refreshingId === editing.id}
                  title="Rafraîchir le texte depuis Légifrance"
                  style={{ padding: "5px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, cursor: refreshingId === editing.id ? "wait" : "pointer" }}>
                  {refreshingId === editing.id ? "⏳ Sync…" : "↻ Légifrance"}
                </button>
                <button onClick={() => setEditing(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: C.textMuted }}>×</button>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>Titre</label>
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>
                Catégories <span style={{ fontWeight: 400 }}>(groupage dans l'admin + filtres)</span>
              </label>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {CATEGORIES.map(cat => {
                  const active = editCategories.includes(cat.id);
                  return (
                    <button key={cat.id} type="button"
                      onClick={() => setEditCategories(prev => active ? prev.filter(c => c !== cat.id) : [...prev, cat.id])}
                      title={cat.description}
                      style={{
                        padding: "5px 10px", borderRadius: 14,
                        border: `1px solid ${active ? "#0F172A" : C.border}`,
                        background: active ? "#0F172A" : "white",
                        color: active ? "white" : C.text,
                        fontSize: 11, fontWeight: 600, cursor: "pointer",
                      }}>
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>
                Texte HTML <span style={{ fontWeight: 400 }}>(rendu dans les courriers et le wizard citoyen)</span>
              </label>
              <textarea value={editHtml} onChange={e => setEditHtml(e.target.value)} rows={10}
                style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }}
                placeholder="<p>Texte de l'article...</p>" />
              <p style={{ margin: "6px 0 0", fontSize: 11, color: C.textMuted }}>
                Le HTML est rendu directement. Utilise &lt;p&gt;, &lt;strong&gt;, &lt;em&gt;, &lt;ul&gt;/&lt;li&gt;. « ↻ Légifrance » récupère le texte officiel actuel.
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>Contexte d'usage</label>
              <input value={editContexte} onChange={e => setEditContexte(e.target.value)}
                placeholder="Ex : Utilisé pour interrompre le délai d'instruction"
                style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>Types de courrier</label>
                {COURRIER_TYPE_OPTIONS.map(o => (
                  <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, cursor: "pointer", fontSize: 12 }}>
                    <input type="checkbox" checked={editCourrierTypes.includes(o.value)}
                      onChange={e => setEditCourrierTypes(prev => e.target.checked ? [...prev, o.value] : prev.filter(v => v !== o.value))} />
                    {o.label}
                  </label>
                ))}
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>Types de dossier</label>
                {DOSSIER_TYPE_OPTIONS.map(o => (
                  <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, cursor: "pointer", fontSize: 12 }}>
                    <input type="checkbox" checked={editDossierTypes.includes(o.value)}
                      onChange={e => setEditDossierTypes(prev => e.target.checked ? [...prev, o.value] : prev.filter(v => v !== o.value))} />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setEditing(null)}
                style={{ padding: "8px 20px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
                Annuler
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ padding: "8px 20px", background: saving ? "#E2E8F0" : "#0F172A", color: saving ? "#94a3b8" : "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer" }}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {todoCards.map((card) => (
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

// ─── Services Annexes ─────────────────────────────────────────────────────────
const SERVICE_TYPES: Record<string, { label: string; color: string; bg: string; desc: string }> = {
  ABF:                 { label: "ABF",                  color: "#7C3AED", bg: "#F5F3FF", desc: "Architectes des Bâtiments de France" },
  SDIS:                { label: "SDIS",                 color: "#DC2626", bg: "#FEF2F2", desc: "Service Départemental d'Incendie et de Secours" },
  DDT:                 { label: "DDT/DDTM",             color: "#0891B2", bg: "#ECFEFF", desc: "Direction Départementale des Territoires" },
  ARS:                 { label: "ARS",                  color: "#059669", bg: "#ECFDF5", desc: "Agence Régionale de Santé" },
  DREAL:               { label: "DREAL",                color: "#0EA5E9", bg: "#F0F9FF", desc: "Direction Régionale de l'Environnement" },
  ENEDIS:              { label: "ENEDIS",               color: "#3B82F6", bg: "#EFF6FF", desc: "Réseau de distribution électrique" },
  GRDF:                { label: "GRDF",                 color: "#D97706", bg: "#FFFBEB", desc: "Réseau de distribution gaz" },
  ONF:                 { label: "ONF",                  color: "#16A34A", bg: "#F0FDF4", desc: "Office National des Forêts" },
  CHAMBRE_AGRICULTURE: { label: "Chambre d'Agriculture",color: "#65A30D", bg: "#F7FEE7", desc: "Chambre d'Agriculture" },
  SNCF:                { label: "SNCF Réseau",          color: "#6366F1", bg: "#EEF2FF", desc: "Infrastructure ferroviaire" },
  AUTRE:               { label: "Autre",                color: "#6B7280", bg: "#F9FAFB", desc: "Service externe" },
};

interface ExternalService {
  id: string;
  name: string;
  type: string;
  email: string | null;
  telephone: string | null;
  description: string | null;
  user_count: number;
  commune_count: number;
  created_at: string;
}

interface ServiceUser {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  telephone: string | null;
  created_at: string;
}

const emptyServiceForm = () => ({ name: "", type: "ABF", email: "", telephone: "", description: "" });
const emptyUserForm = () => ({ email: "", prenom: "", nom: "", telephone: "" });

// ─── Coverage Selector ────────────────────────────────────────────────────────
function IndeterminateCheckbox({ checked, indeterminate, onChange, style }: {
  checked: boolean; indeterminate: boolean; onChange: () => void; style?: React.CSSProperties;
}) {
  const ref = (el: HTMLInputElement | null) => { if (el) el.indeterminate = indeterminate; };
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} style={{ width: 15, height: 15, cursor: "pointer", accentColor: C.accent, ...style }} />;
}

function CoverageSelector({ allCommunes, selectedIds, onChange }: {
  allCommunes: Commune[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Group communes by EPCI
  const grouped = allCommunes.reduce<Record<string, { epciName: string; communes: Commune[] }>>(
    (acc, c) => {
      const key = c.epci_id ?? "__none__";
      const label = c.epci_name ?? "Sans groupement";
      if (!acc[key]) acc[key] = { epciName: label, communes: [] };
      acc[key].communes.push(c);
      return acc;
    },
    {},
  );

  // Sort: EPCIs first (alphabetically), then "Sans groupement"
  const groups = Object.entries(grouped).sort(([ka, a], [kb, b]) => {
    if (ka === "__none__") return 1;
    if (kb === "__none__") return -1;
    return a.epciName.localeCompare(b.epciName);
  });

  const toggleCommune = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  };

  const toggleGroup = (key: string) => {
    const ids = (grouped[key]?.communes ?? []).map((c) => c.id);
    const allChecked = ids.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allChecked) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onChange(next);
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", maxHeight: 320, overflowY: "auto" }}>
      {groups.map(([key, { epciName, communes: grpCommunes }]) => {
        const checkedCount = grpCommunes.filter((c) => selectedIds.has(c.id)).length;
        const allChecked = checkedCount === grpCommunes.length;
        const someChecked = checkedCount > 0 && !allChecked;
        const isExpanded = expanded.has(key);

        return (
          <div key={key}>
            {/* Group header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
              background: C.bg, borderBottom: `1px solid ${C.border}`, userSelect: "none",
            }}>
              <IndeterminateCheckbox
                checked={allChecked}
                indeterminate={someChecked}
                onChange={() => toggleGroup(key)}
              />
              <button
                onClick={() => toggleExpand(key)}
                style={{ flex: 1, background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, textAlign: "left" }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{epciName}</span>
                <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 400 }}>
                  {checkedCount}/{grpCommunes.length}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: C.textMuted, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
              </button>
            </div>
            {/* Communes list (collapsible) */}
            {isExpanded && grpCommunes.map((c) => (
              <label
                key={c.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 14px 8px 38px",
                  borderBottom: `1px solid ${C.border}`, cursor: "pointer",
                  background: selectedIds.has(c.id) ? C.accentLight : C.white,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => toggleCommune(c.id)}
                  style={{ width: 14, height: 14, accentColor: C.accent, cursor: "pointer" }}
                />
                <span style={{ fontSize: 13, color: C.text }}>{c.name}</span>
                {c.zip_code && <span style={{ fontSize: 12, color: C.textMuted }}>{c.zip_code}</span>}
              </label>
            ))}
          </div>
        );
      })}
      {groups.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
          Aucune commune configurée
        </div>
      )}
    </div>
  );
}

function ServiceTypeBadge({ type }: { type: string }) {
  const color = SERVICE_TYPES[type]?.color ?? "#6B7280";
  const bg = SERVICE_TYPES[type]?.bg ?? "#F9FAFB";
  const label = SERVICE_TYPES[type]?.label ?? type;
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 20, background: bg, color, fontSize: 12, fontWeight: 700 }}>
      {label}
    </span>
  );
}

function ServicesAnnexes() {
  const [services, setServices] = useState<ExternalService[]>([]);
  const [allCommunes, setAllCommunes] = useState<Commune[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ExternalService | null>(null);
  const [serviceUsers, setServiceUsers] = useState<ServiceUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [form, setForm] = useState(emptyServiceForm());
  const [coverageIds, setCoverageIds] = useState<Set<string>>(new Set());
  const [userForm, setUserForm] = useState(emptyUserForm());
  const [saving, setSaving] = useState(false);
  const [confirmDeleteService, setConfirmDeleteService] = useState<string | null>(null);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => setToast({ message, type });

  const loadServices = useCallback(async () => {
    setLoading(true);
    try {
      const [svc, communes] = await Promise.all([
        api.get<ExternalService[]>("/admin/services"),
        api.get<Commune[]>("/admin/communes"),
      ]);
      setServices(svc);
      setAllCommunes(communes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadServices(); }, [loadServices]);

  const loadUsers = useCallback(async (serviceId: string) => {
    setUsersLoading(true);
    try {
      const data = await api.get<ServiceUser[]>(`/admin/services/${serviceId}/users`);
      setServiceUsers(data);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadCoverage = useCallback(async (serviceId: string) => {
    const ids = await api.get<string[]>(`/admin/services/${serviceId}/communes`);
    setCoverageIds(new Set(ids));
  }, []);

  const saveCoverage = async (serviceId: string) => {
    await api.put(`/admin/services/${serviceId}/communes`, { ids: [...coverageIds] });
  };

  const handleSelect = (s: ExternalService) => {
    setSelected(s);
    loadUsers(s.id);
  };

  const handleCreate = async () => {
    if (!form.name || !form.type) return showToast("Nom et type sont requis", "error");
    setSaving(true);
    try {
      const created = await api.post<ExternalService>("/admin/services", form);
      await saveCoverage(created.id);
      showToast("Service créé");
      setShowCreate(false);
      setForm(emptyServiceForm());
      setCoverageIds(new Set());
      loadServices();
    } catch {
      showToast("Erreur lors de la création", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const [updated] = await Promise.all([
        api.patch<ExternalService>(`/admin/services/${selected.id}`, form),
        saveCoverage(selected.id),
      ]);
      showToast("Service mis à jour");
      setShowEdit(false);
      setSelected({ ...updated, user_count: selected.user_count, commune_count: coverageIds.size });
      loadServices();
    } catch {
      showToast("Erreur lors de la mise à jour", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteService = async (id: string) => {
    try {
      await api.delete(`/admin/services/${id}`);
      showToast("Service supprimé");
      if (selected?.id === id) setSelected(null);
      loadServices();
    } catch {
      showToast("Erreur lors de la suppression", "error");
    } finally {
      setConfirmDeleteService(null);
    }
  };

  const handleAddUser = async () => {
    if (!selected) return;
    if (!userForm.email || !userForm.prenom || !userForm.nom) {
      return showToast("Prénom, nom et email sont obligatoires", "error");
    }
    setSaving(true);
    try {
      await api.post(`/admin/services/${selected.id}/users`, userForm);
      showToast("Compte créé — email d'activation envoyé");
      setShowAddUser(false);
      setUserForm(emptyUserForm());
      loadUsers(selected.id);
      loadServices();
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? "";
      showToast(msg.includes("409") ? "Cet email est déjà utilisé" : "Erreur lors de la création", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!selected) return;
    try {
      await api.delete(`/admin/services/${selected.id}/users/${userId}`);
      showToast("Utilisateur retiré");
      loadUsers(selected.id);
      loadServices();
    } catch {
      showToast("Erreur lors de la suppression", "error");
    } finally {
      setConfirmDeleteUser(null);
    }
  };

  const inp = (style?: React.CSSProperties): React.CSSProperties => ({
    padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8,
    fontSize: 14, color: C.text, background: C.white, outline: "none", width: "100%",
    boxSizing: "border-box", ...style,
  });

  return (
    <PageShell>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 800, color: C.text }}>Services annexes</h1>
        <p style={{ margin: 0, color: C.textMuted, fontSize: 15 }}>Gérez les accès des organismes consultatifs (ABF, SDIS, DDT…)</p>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmDeleteService && (
        <ConfirmDialog
          message="Supprimer ce service ? Les comptes utilisateurs associés seront également supprimés."
          onConfirm={() => handleDeleteService(confirmDeleteService)}
          onCancel={() => setConfirmDeleteService(null)}
        />
      )}
      {confirmDeleteUser && (
        <ConfirmDialog
          message="Retirer cet utilisateur ? Son compte sera définitivement supprimé."
          onConfirm={() => handleDeleteUser(confirmDeleteUser)}
          onCancel={() => setConfirmDeleteUser(null)}
        />
      )}

      {/* Create service modal */}
      {showCreate && (
        <Modal title="Nouveau service annexe" onClose={() => { setShowCreate(false); setForm(emptyServiceForm()); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Field label="Type de service *">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={inp()}>
                {Object.entries(SERVICE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label} — {v.desc}</option>
                ))}
              </select>
            </Field>
            <Field label="Nom *">
              <input style={inp()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`ex. ABF ${SERVICE_TYPES[form.type]?.label ?? ""} Indre-et-Loire`} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="contact@service.gouv.fr" />
            </Field>
            <Field label="Téléphone">
              <Input type="tel" value={form.telephone} onChange={(v) => setForm({ ...form, telephone: v })} />
            </Field>
            <Field label="Description">
              <textarea style={{ ...inp(), minHeight: 64, resize: "vertical" }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Notes internes, périmètre d'intervention…" />
            </Field>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                Communes couvertes
                <span style={{ marginLeft: 8, fontWeight: 400, textTransform: "none", letterSpacing: 0, color: C.textLight }}>
                  — {coverageIds.size} sélectionnée{coverageIds.size > 1 ? "s" : ""}
                </span>
              </label>
              <CoverageSelector allCommunes={allCommunes} selectedIds={coverageIds} onChange={setCoverageIds} />
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => { setShowCreate(false); setForm(emptyServiceForm()); setCoverageIds(new Set()); }} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.text, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>Annuler</button>
              <button onClick={handleCreate} disabled={saving} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: C.accent, color: "white", cursor: saving ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Création…" : "Créer le service"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit service modal */}
      {showEdit && selected && (
        <Modal title={`Modifier — ${selected.name}`} onClose={() => setShowEdit(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Field label="Type de service">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={inp()}>
                {Object.entries(SERVICE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label} — {v.desc}</option>
                ))}
              </select>
            </Field>
            <Field label="Nom *">
              <input style={inp()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            </Field>
            <Field label="Téléphone">
              <Input type="tel" value={form.telephone} onChange={(v) => setForm({ ...form, telephone: v })} />
            </Field>
            <Field label="Description">
              <textarea style={{ ...inp(), minHeight: 64, resize: "vertical" }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                Communes couvertes
                <span style={{ marginLeft: 8, fontWeight: 400, textTransform: "none", letterSpacing: 0, color: C.textLight }}>
                  — {coverageIds.size} sélectionnée{coverageIds.size > 1 ? "s" : ""}
                </span>
              </label>
              <CoverageSelector allCommunes={allCommunes} selectedIds={coverageIds} onChange={setCoverageIds} />
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setShowEdit(false)} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.text, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>Annuler</button>
              <button onClick={handleEdit} disabled={saving} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: C.accent, color: "white", cursor: saving ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add user modal */}
      {showAddUser && selected && (
        <Modal title={`Ajouter un utilisateur — ${selected.name}`} onClose={() => { setShowAddUser(false); setUserForm(emptyUserForm()); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Prénom *">
                <input style={inp()} value={userForm.prenom} onChange={(e) => setUserForm({ ...userForm, prenom: e.target.value })} />
              </Field>
              <Field label="Nom *">
                <input style={inp()} value={userForm.nom} onChange={(e) => setUserForm({ ...userForm, nom: e.target.value })} />
              </Field>
            </div>
            <Field label="Email *">
              <Input type="email" value={userForm.email} onChange={(v) => setUserForm({ ...userForm, email: v })} placeholder="prenom.nom@service.gouv.fr" />
            </Field>
            <Field label="Téléphone">
              <Input type="tel" value={userForm.telephone} onChange={(v) => setUserForm({ ...userForm, telephone: v })} />
            </Field>
            <div style={{ background: C.blueBg, borderRadius: 8, padding: "12px 14px", fontSize: 13, color: C.blue, lineHeight: 1.5 }}>
              <strong>Email d'activation automatique</strong><br />
              L'utilisateur recevra un email lui permettant de définir son propre mot de passe. Le lien est valable 24 heures.
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => { setShowAddUser(false); setUserForm(emptyUserForm()); }} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.text, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>Annuler</button>
              <button onClick={handleAddUser} disabled={saving} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: C.accent, color: "white", cursor: saving ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Création…" : "Créer l'accès"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: services list */}
        <div style={{ flex: selected ? "0 0 380px" : 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <span style={{ color: C.textMuted, fontSize: 14 }}>{services.length} service{services.length > 1 ? "s" : ""}</span>
            <button onClick={() => { setForm(emptyServiceForm()); setCoverageIds(new Set()); setShowCreate(true); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: C.accent, color: "white", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
              + Nouveau service
            </button>
          </div>

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner /></div>
          ) : services.length === 0 ? (
            <div style={{ background: C.white, borderRadius: 16, border: `1px solid ${C.border}`, padding: 60, textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔗</div>
              <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 16, color: C.text }}>Aucun service annexe</p>
              <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>Créez un premier service pour lui donner accès à la plateforme.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {services.map((s) => {
                const t = SERVICE_TYPES[s.type] ?? SERVICE_TYPES.AUTRE;
                const isActive = selected?.id === s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => handleSelect(s)}
                    style={{
                      background: C.white, borderRadius: 12, border: `2px solid ${isActive ? C.accent : C.border}`,
                      padding: "16px 20px", cursor: "pointer", transition: "border-color 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <ServiceTypeBadge type={s.type} />
                          <span style={{ fontWeight: 700, fontSize: 15, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                        </div>
                        {s.description && (
                          <p style={{ margin: "0 0 8px", fontSize: 13, color: C.textMuted, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.description}</p>
                        )}
                        <div style={{ display: "flex", gap: 16, fontSize: 12, color: C.textMuted }}>
                          {s.email && <span>✉ {s.email}</span>}
                          {s.telephone && <span>📞 {s.telephone}</span>}
                          <span style={{ color: s.commune_count > 0 ? C.accent : C.textLight, fontWeight: 600 }}>
                            🏛 {s.commune_count} commune{s.commune_count > 1 ? "s" : ""}
                          </span>
                          <span style={{ color: s.user_count > 0 ? C.green : C.textLight, fontWeight: 600 }}>
                            👤 {s.user_count} utilisateur{s.user_count > 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={async (e) => { e.stopPropagation(); setSelected(s); setForm({ name: s.name, type: s.type, email: s.email ?? "", telephone: s.telephone ?? "", description: s.description ?? "" }); await loadCoverage(s.id); setShowEdit(true); }}
                          style={{ padding: "6px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.text }}
                        >
                          Modifier
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteService(s.id); }}
                          style={{ padding: "6px 10px", background: C.redBg, border: "none", borderRadius: 8, cursor: "pointer", color: C.red, fontSize: 13, fontWeight: 700 }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: selected service users */}
        {selected && (
          <div style={{ flex: 1, background: C.white, borderRadius: 16, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <ServiceTypeBadge type={selected.type} />
                  <span style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{selected.name}</span>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMuted }}>{SERVICE_TYPES[selected.type]?.desc}</p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => { setShowAddUser(true); setUserForm(emptyUserForm()); }}
                  style={{ padding: "8px 16px", background: C.accent, color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}
                >
                  + Ajouter un accès
                </button>
                <button
                  onClick={() => setSelected(null)}
                  style={{ padding: "8px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", color: C.textMuted, fontSize: 16, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            </div>

            {usersLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>
            ) : serviceUsers.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>👤</div>
                <p style={{ margin: "0 0 4px", fontWeight: 700, color: C.text }}>Aucun utilisateur</p>
                <p style={{ margin: 0, fontSize: 14, color: C.textMuted }}>Ajoutez un accès pour permettre aux agents de ce service de se connecter.</p>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    {["Nom Prénom", "Email", "Téléphone", "Créé le", ""].map((h) => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {serviceUsers.map((u) => (
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
                      <td style={{ padding: "12px 16px", color: C.textMuted, fontSize: 13 }}>{u.telephone ?? "—"}</td>
                      <td style={{ padding: "12px 16px", color: C.textMuted, fontSize: 13 }}>{new Date(u.created_at).toLocaleDateString("fr-FR")}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <button
                          onClick={() => setConfirmDeleteUser(u.id)}
                          style={{ padding: "6px 12px", background: C.redBg, color: C.red, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                        >
                          Retirer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────
interface AuditEntry {
  id: string;
  email: string | null;
  role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  user_prenom: string | null;
  user_nom: string | null;
}

const ACTION_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  login:          { label: "Connexion",        color: "#16A34A", bg: "#DCFCE7" },
  login_failed:   { label: "Échec connexion",  color: "#DC2626", bg: "#FEE2E2" },
  logout:         { label: "Déconnexion",      color: "#6B7280", bg: "#F3F4F6" },
  register:       { label: "Inscription",      color: "#4F46E5", bg: "#EEF2FF" },
  data_export:    { label: "Export données",      color: "#0284C7", bg: "#E0F2FE" },
  account_deleted:{ label: "Compte supprimé",     color: "#B45309", bg: "#FEF3C7" },
  account_activated:{ label: "Compte activé",      color: "#16A34A", bg: "#DCFCE7" },
  password_change:{ label: "MdP modifié",          color: "#0284C7", bg: "#E0F2FE" },
  password_reset: { label: "MdP réinitialisé",     color: "#0284C7", bg: "#E0F2FE" },
  profile_update: { label: "Profil modifié",       color: "#6B7280", bg: "#F3F4F6" },
  admin_user_created:   { label: "Agent créé",        color: "#4F46E5", bg: "#EEF2FF" },
  admin_user_updated:   { label: "Agent modifié",     color: "#7C3AED", bg: "#F3E8FF" },
  admin_user_deleted:   { label: "Agent supprimé",    color: "#B45309", bg: "#FEF3C7" },
  admin_invitation_resent: { label: "Invitation renvoyée", color: "#0284C7", bg: "#E0F2FE" },
  admin_role_created:   { label: "Rôle créé",         color: "#4F46E5", bg: "#EEF2FF" },
  admin_role_updated:   { label: "Rôle modifié",      color: "#7C3AED", bg: "#F3E8FF" },
  admin_role_deleted:   { label: "Rôle supprimé",     color: "#B45309", bg: "#FEF3C7" },
  address_search: { label: "Recherche adresse",   color: "#0EA5E9", bg: "#E0F2FE" },
  mairie_request: { label: "Action mairie",       color: "#7C3AED", bg: "#F3E8FF" },
  citoyen_request:{ label: "Action citoyen",      color: "#0284C7", bg: "#E0F2FE" },
};

const ROLE_OPTIONS = [
  { value: "",          label: "Tous les rôles" },
  { value: "citoyen",   label: "Citoyens" },
  { value: "mairie",    label: "Mairie (mairie + instructeur)" },
  { value: "admin",     label: "Admin" },
  { value: "anonyme",   label: "Visiteur non connecté" },
];

// Map HTTP method → couleur pour la pastille methode dans la colonne "Détail".
const METHOD_COLORS: Record<string, string> = {
  GET: "#0284C7", POST: "#16A34A", PATCH: "#D97706", PUT: "#7C3AED", DELETE: "#DC2626",
};

const SINCE_OPTIONS = [
  { label: "7 derniers jours",  value: () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); } },
  { label: "30 derniers jours", value: () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString(); } },
  { label: "3 derniers mois",   value: () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString(); } },
  { label: "12 derniers mois",  value: () => { const d = new Date(); d.setMonth(d.getMonth() - 12); return d.toISOString(); } },
  { label: "Tout",              value: () => "" },
];

// Rend un détail synthétique par ligne d'audit : on privilégie l'info la plus
// parlante du contexte (adresse cherchée, route mairie + méthode, etc.).
function AuditDetail({ entry }: { entry: AuditEntry }) {
  const meta = entry.metadata ?? null;
  // Recherche d'adresse → la query/coords sont l'info clé.
  if (entry.action === "address_search") {
    const q = (meta?.["query"] as string | null) ?? null;
    const coords = meta?.["coords"] as { lat?: number; lng?: number } | null;
    const result = meta?.["result"] as { commune?: string | null; zone?: string | null; insee?: string | null } | null;
    return (
      <div style={{ fontSize: 13, color: C.text }}>
        <div style={{ fontWeight: 500 }}>{q ?? (coords ? `${coords.lat?.toFixed(5)}, ${coords.lng?.toFixed(5)}` : "—")}</div>
        {result && (result.commune || result.zone) && (
          <div style={{ fontSize: 12, color: C.textMuted }}>
            {result.commune ?? "?"}{result.insee ? ` (${result.insee})` : ""}{result.zone ? ` — zone ${result.zone}` : ""}
          </div>
        )}
      </div>
    );
  }
  // Mutation mairie / citoyen → route + méthode + cible.
  if (entry.action === "mairie_request" || entry.action === "citoyen_request") {
    const method = (meta?.["method"] as string | null) ?? "?";
    const route = (meta?.["route"] as string | null) ?? "?";
    const status = meta?.["status"] as number | null;
    return (
      <div style={{ fontSize: 13, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 4, background: (METHOD_COLORS[method] ?? "#6B7280") + "22", color: METHOD_COLORS[method] ?? "#6B7280", fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>
          {method}
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 12 }}>{route}</span>
        {status !== null && status !== undefined && (
          <span style={{ fontSize: 11, color: status >= 400 ? "#DC2626" : C.textMuted }}>→ {status}</span>
        )}
      </div>
    );
  }
  // Actions d'admin avec email (cible utilisateur).
  if (entry.target_type === "dossier" && entry.target_id) {
    return <div style={{ fontSize: 12, color: C.textMuted, fontFamily: "monospace" }}>dossier {entry.target_id.slice(0, 8)}…</div>;
  }
  return <div style={{ fontSize: 12, color: C.textMuted }}>—</div>;
}

function AuditLogs() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [sinceIdx, setSinceIdx] = useState(1); // default: 30 days
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async (p: number, action: string, role: string, idx: number) => {
    setLoading(true);
    try {
      const since = SINCE_OPTIONS[idx]!.value();
      const qs = new URLSearchParams({ page: String(p) });
      if (action) qs.set("action", action);
      if (role) qs.set("role", role);
      if (since) qs.set("since", since);
      const data = await api.get<{ rows: AuditEntry[]; total: number; page: number; limit: number }>(`/admin/audit-logs?${qs}`);
      setRows(data.rows);
      setTotal(data.total);
    } catch { setRows([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(page, actionFilter, roleFilter, sinceIdx); }, [page, actionFilter, roleFilter, sinceIdx]);

  const totalPages = Math.ceil(total / 50);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const truncateUA = (ua: string | null) => {
    if (!ua) return "—";
    // Extract browser name from user-agent
    const m = ua.match(/(Firefox|Chrome|Safari|Edge|OPR|Edg)[\/ ]([\d.]+)/);
    return m ? `${m[1] ?? ""} ${(m[2] ?? "").split(".")[0]}` : ua.slice(0, 30);
  };

  return (
    <PageShell>
      <div style={{ padding: 32 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: "0 0 4px" }}>Audit sécurité</h1>
          <p style={{ fontSize: 14, color: C.textMuted, margin: 0 }}>
            Journal des connexions, actions mairie et recherches d'adresses citoyens — conservé 12 mois (CCSC §4.14) — IP partiellement masquée (RGPD) — {total} entrées
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          <select
            value={roleFilter}
            onChange={e => { setRoleFilter(e.target.value); setPage(1); }}
            style={{ padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.text, background: "white", cursor: "pointer" }}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={actionFilter}
            onChange={e => { setActionFilter(e.target.value); setPage(1); }}
            style={{ padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.text, background: "white", cursor: "pointer" }}
          >
            <option value="">Toutes les actions</option>
            {Object.entries(ACTION_STYLES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            value={sinceIdx}
            onChange={e => { setSinceIdx(Number(e.target.value)); setPage(1); }}
            style={{ padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.text, background: "white", cursor: "pointer" }}
          >
            {SINCE_OPTIONS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
          </select>
        </div>

        {/* Table */}
        <div style={{ background: "white", borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Date", "Action", "Détail", "Utilisateur", "IP", "Navigateur", ""].map((h, i) => (
                  <th key={i} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: C.textMuted, fontSize: 13 }}>Chargement…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: C.textMuted, fontSize: 13 }}>Aucune entrée pour ces filtres</td></tr>
              ) : rows.map((r, i) => {
                const style = ACTION_STYLES[r.action] ?? { label: r.action, color: "#6B7280", bg: "#F3F4F6" };
                const expanded = expandedId === r.id;
                const hasDetails = r.metadata && Object.keys(r.metadata).length > 0;
                return (
                  <Fragment key={r.id}>
                    <tr style={{ borderBottom: !expanded && i < rows.length - 1 ? `1px solid ${C.border}` : "none", background: i % 2 === 0 ? "white" : "#FAFAFA" }}>
                      <td style={{ padding: "10px 16px", fontSize: 13, color: C.textMuted, whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
                      <td style={{ padding: "10px 16px" }}>
                        <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 20, background: style.bg, color: style.color, fontSize: 12, fontWeight: 700 }}>
                          {style.label}
                        </span>
                        {r.role && (
                          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, textTransform: "capitalize" }}>{r.role}</div>
                        )}
                      </td>
                      <td style={{ padding: "10px 16px", maxWidth: 380, overflow: "hidden" }}>
                        <AuditDetail entry={r} />
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: 13, color: C.text }}>
                        <div style={{ fontWeight: 500 }}>{r.user_prenom && r.user_nom ? `${r.user_prenom} ${r.user_nom}` : "—"}</div>
                        <div style={{ fontSize: 12, color: C.textMuted }}>{r.email ?? "—"}</div>
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: 13, color: C.textMuted, fontFamily: "monospace" }}>{r.ip ?? "—"}</td>
                      <td style={{ padding: "10px 16px", fontSize: 13, color: C.textMuted }}>{truncateUA(r.user_agent)}</td>
                      <td style={{ padding: "10px 16px", fontSize: 12 }}>
                        {hasDetails && (
                          <button
                            onClick={() => setExpandedId(expanded ? null : r.id)}
                            style={{ padding: "4px 8px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.textMuted, cursor: "pointer", fontSize: 11 }}
                          >
                            {expanded ? "Replier" : "JSON"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded && hasDetails && (
                      <tr style={{ borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : "none", background: "#FAFAFA" }}>
                        <td colSpan={7} style={{ padding: "12px 16px" }}>
                          <pre style={{ margin: 0, fontSize: 11, fontFamily: "monospace", color: C.text, background: "white", padding: 12, borderRadius: 6, border: `1px solid ${C.border}`, maxHeight: 320, overflow: "auto" }}>
                            {JSON.stringify(r.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 20 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ padding: "6px 16px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, cursor: page === 1 ? "default" : "pointer", color: page === 1 ? C.textMuted : C.text, background: "white" }}>
              ← Précédent
            </button>
            <span style={{ padding: "6px 16px", fontSize: 13, color: C.textMuted }}>Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ padding: "6px 16px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, cursor: page === totalPages ? "default" : "pointer", color: page === totalPages ? C.textMuted : C.text, background: "white" }}>
              Suivant →
            </button>
          </div>
        )}
      </div>
    </PageShell>
  );
}

// ─── Coûts IA ────────────────────────────────────────────────────────────────
interface AiCostSummary {
  period: string;
  totals: {
    events: number;
    cost_eur: number;
    input_tokens: number;
    output_tokens: number;
  };
  by_purpose: { purpose: string; events: number; cost_eur: number }[];
  by_model: { model: string; events: number; cost_eur: number }[];
}

interface AiCostByDossier {
  dossier_id: string;
  numero: string | null;
  type: string | null;
  commune: string | null;
  status: string | null;
  events: number;
  cost_eur: number;
  last_event_at: string;
}

interface AiCostByCommune {
  commune_id: string;
  commune_name: string | null;
  insee_code: string | null;
  events: number;
  cost_eur: number;
  last_event_at: string;
}

const PURPOSE_LABELS: Record<string, string> = {
  piece_analyze: "Analyse de pièce",
  piece_extract: "Extraction de pièce",
  rule_verdicts: "Verdicts règle PLU",
  procedure_explain: "Explication procédure",
  plu_zone_detect: "Détection zones PLU",
  plu_rule_extract: "Extraction règles PLU",
  plu_article_structure: "Structuration article PLU",
  plu_zone_structure: "Structuration zone PLU",
};

function fmtEur(v: number): string {
  if (v < 0.01) return `${(v * 100).toFixed(2)} c€`;
  return `${v.toFixed(v < 1 ? 3 : 2)} €`;
}

interface AiAlertConfig {
  slack_webhook_url: string | null;
  per_call_threshold_eur: number | null;
  daily_threshold_eur: number | null;
  daily_last_notified_at: string | null;
}

function AlertsCard() {
  const [cfg, setCfg] = useState<AiAlertConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // Champs édités localement (string pour gérer "" = désactivé).
  const [webhook, setWebhook] = useState("");
  const [perCall, setPerCall] = useState("");
  const [daily, setDaily] = useState("");

  useEffect(() => {
    api.get<AiAlertConfig>("/admin/ai-cost/alerts")
      .then((c) => {
        setCfg(c);
        setWebhook(c.slack_webhook_url ?? "");
        setPerCall(c.per_call_threshold_eur != null ? String(c.per_call_threshold_eur) : "");
        setDaily(c.daily_threshold_eur != null ? String(c.daily_threshold_eur) : "");
      })
      .catch(() => setToast({ kind: "err", msg: "Impossible de charger la config." }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      const parsed = await api.put<AiAlertConfig>("/admin/ai-cost/alerts", {
        slack_webhook_url: webhook.trim() || null,
        per_call_threshold_eur: perCall.trim() === "" ? null : Number(perCall),
        daily_threshold_eur: daily.trim() === "" ? null : Number(daily),
      });
      setCfg(parsed);
      setToast({ kind: "ok", msg: "Configuration enregistrée." });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await api.post("/admin/ai-cost/alerts/test");
      setToast({ kind: "ok", msg: "Message envoyé sur Slack." });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Alertes Slack</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Ping Slack dès qu'un seuil est franchi. Laisser vide pour désactiver un seuil.</div>
        </div>
        {cfg?.daily_last_notified_at && (
          <div style={{ fontSize: 11, color: C.textMuted }}>Dernier ping : {new Date(cfg.daily_last_notified_at).toLocaleString("fr-FR")}</div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: "center" }}><Spinner size={18} /></div>
      ) : (
        <div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>Webhook Slack</label>
            <input
              type="text"
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
              placeholder="https://hooks.slack.com/services/T0…/B0…/…"
              style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>Seuil par appel (€)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={perCall}
                onChange={(e) => setPerCall(e.target.value)}
                placeholder="ex: 0,20"
                style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Ping immédiat si UN seul appel dépasse ce montant.</div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>Seuil journalier cumulé (€)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
                placeholder="ex: 5"
                style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Un seul ping par jour quand le cumul dépasse ce seuil.</div>
            </div>
          </div>

          {toast && (
            <div style={{
              padding: "8px 12px", borderRadius: 8, fontSize: 13,
              background: toast.kind === "ok" ? C.greenBg : C.redBg,
              border: `1px solid ${toast.kind === "ok" ? C.green : C.red}`,
              color: toast.kind === "ok" ? C.green : C.red,
            }}>{toast.msg}</div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={test} disabled={testing || !webhook.trim() || webhook !== (cfg?.slack_webhook_url ?? "")}
              title={webhook !== (cfg?.slack_webhook_url ?? "") ? "Enregistre d'abord le webhook avant de tester." : "Envoie un message de test sur Slack."}
              style={{
                padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
                background: "white", color: C.text, fontSize: 13, fontWeight: 600,
                cursor: testing || !webhook.trim() || webhook !== (cfg?.slack_webhook_url ?? "") ? "default" : "pointer",
                opacity: testing || !webhook.trim() || webhook !== (cfg?.slack_webhook_url ?? "") ? 0.6 : 1,
              }}>
              {testing ? "Envoi…" : "Envoyer un test"}
            </button>
            <button onClick={save} disabled={saving}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: C.accent, color: "white", fontSize: 13, fontWeight: 600,
                cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1,
              }}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface AiPricingRow {
  model: string;
  kind: "chat" | "embedding";
  input_eur_per_m: number;
  output_eur_per_m: number;
  note: string | null;
  updated_at: string;
}

function PricingCard() {
  const [rows, setRows] = useState<AiPricingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // Brouillon par modèle pour permettre l'édition contrôlée des champs.
  const [drafts, setDrafts] = useState<Record<string, { input: string; output: string; note: string; kind: "chat" | "embedding" }>>({});

  const load = useCallback(() => {
    setLoading(true);
    api.get<AiPricingRow[]>("/admin/ai-cost/pricing")
      .then((data) => {
        setRows(data);
        const d: Record<string, { input: string; output: string; note: string; kind: "chat" | "embedding" }> = {};
        for (const r of data) {
          d[r.model] = {
            input: String(r.input_eur_per_m),
            output: String(r.output_eur_per_m),
            note: r.note ?? "",
            kind: r.kind,
          };
        }
        setDrafts(d);
      })
      .catch(() => setToast({ kind: "err", msg: "Impossible de charger la grille tarifaire." }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const save = async (model: string) => {
    const d = drafts[model];
    if (!d) return;
    setSaving(model);
    try {
      await api.put<AiPricingRow>(`/admin/ai-cost/pricing/${encodeURIComponent(model)}`, {
        kind: d.kind,
        input_eur_per_m: Number(d.input),
        output_eur_per_m: Number(d.output),
        note: d.note.trim() || null,
      });
      setToast({ kind: "ok", msg: `Tarif ${model} mis à jour.` });
      load();
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(null);
    }
  };

  const del = async (model: string) => {
    if (!confirm(`Retirer ${model} de la grille tarifaire ? (les anciens événements gardent leur coût)`)) return;
    setSaving(model);
    try {
      await api.delete(`/admin/ai-cost/pricing/${encodeURIComponent(model)}`);
      setToast({ kind: "ok", msg: `${model} retiré.` });
      load();
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(null);
    }
  };

  const addRow = async (form: { model: string; kind: "chat" | "embedding"; input: string; output: string; note: string }) => {
    if (!form.model.trim()) {
      setToast({ kind: "err", msg: "Identifiant Mistral requis (ex: pixtral-large-latest)." });
      return;
    }
    setSaving(form.model);
    try {
      await api.put<AiPricingRow>(`/admin/ai-cost/pricing/${encodeURIComponent(form.model.trim())}`, {
        kind: form.kind,
        input_eur_per_m: Number(form.input),
        output_eur_per_m: form.kind === "embedding" ? 0 : Number(form.output),
        note: form.note.trim() || null,
      });
      setAdding(false);
      setToast({ kind: "ok", msg: `Tarif ${form.model} ajouté.` });
      load();
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Tarifs Mistral (€ par million de tokens)</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            Sert au calcul d'estimation. La facture réelle reste celle de la console <a href="https://console.mistral.ai/" target="_blank" rel="noreferrer" style={{ color: C.accent }}>Mistral</a> — pensez à recopier la grille publiée sur <a href="https://mistral.ai/pricing/" target="_blank" rel="noreferrer" style={{ color: C.accent }}>mistral.ai/pricing</a>.
          </div>
        </div>
        <button onClick={() => setAdding((v) => !v)}
          style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "white", color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          {adding ? "Annuler" : "+ Ajouter un modèle"}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: "center" }}><Spinner size={18} /></div>
      ) : (
        <>
          {adding && <AddPricingRow onSubmit={addRow} saving={saving !== null} />}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Modèle</th>
                <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Type</th>
                <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Input €/M</th>
                <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Output €/M</th>
                <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Note</th>
                <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Mis à jour</th>
                <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}></th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => {
                const d = drafts[r.model] ?? { input: String(r.input_eur_per_m), output: String(r.output_eur_per_m), note: r.note ?? "", kind: r.kind };
                const dirty = d.input !== String(r.input_eur_per_m) || d.output !== String(r.output_eur_per_m) || (d.note ?? "") !== (r.note ?? "") || d.kind !== r.kind;
                return (
                  <tr key={r.model} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 20px", color: C.text, fontFamily: "monospace", fontSize: 12 }}>{r.model}</td>
                    <td style={{ padding: "10px 20px" }}>
                      <select value={d.kind} onChange={(e) => setDrafts((s) => ({ ...s, [r.model]: { ...d, kind: e.target.value as "chat" | "embedding" } }))}
                        style={{ padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }}>
                        <option value="chat">chat</option>
                        <option value="embedding">embedding</option>
                      </select>
                    </td>
                    <td style={{ padding: "10px 20px", textAlign: "right" }}>
                      <input type="number" step="0.001" min="0" value={d.input}
                        onChange={(e) => setDrafts((s) => ({ ...s, [r.model]: { ...d, input: e.target.value } }))}
                        style={{ width: 80, padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, textAlign: "right" }} />
                    </td>
                    <td style={{ padding: "10px 20px", textAlign: "right" }}>
                      <input type="number" step="0.001" min="0" value={d.output} disabled={d.kind === "embedding"}
                        onChange={(e) => setDrafts((s) => ({ ...s, [r.model]: { ...d, output: e.target.value } }))}
                        style={{ width: 80, padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, textAlign: "right", opacity: d.kind === "embedding" ? 0.4 : 1 }} />
                    </td>
                    <td style={{ padding: "10px 20px" }}>
                      <input type="text" value={d.note} placeholder="ex: tarif officiel 2026-06"
                        onChange={(e) => setDrafts((s) => ({ ...s, [r.model]: { ...d, note: e.target.value } }))}
                        style={{ width: "100%", padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: "10px 20px", color: C.textMuted, fontSize: 11, textAlign: "right" }}>{new Date(r.updated_at).toLocaleDateString("fr-FR")}</td>
                    <td style={{ padding: "10px 20px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => save(r.model)} disabled={!dirty || saving === r.model}
                        style={{ padding: "4px 10px", marginRight: 6, borderRadius: 6, border: "none", background: dirty ? C.accent : C.border, color: dirty ? "white" : C.textMuted, fontSize: 12, fontWeight: 600, cursor: dirty ? "pointer" : "default" }}>
                        {saving === r.model ? "…" : "OK"}
                      </button>
                      <button onClick={() => del(r.model)} disabled={saving === r.model}
                        title="Retirer de la grille"
                        style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: "white", color: C.red, fontSize: 12, cursor: "pointer" }}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {toast && (
            <div style={{
              margin: 12, padding: "8px 12px", borderRadius: 8, fontSize: 13,
              background: toast.kind === "ok" ? C.greenBg : C.redBg,
              border: `1px solid ${toast.kind === "ok" ? C.green : C.red}`,
              color: toast.kind === "ok" ? C.green : C.red,
            }}>{toast.msg}</div>
          )}
        </>
      )}
    </div>
  );
}

function AddPricingRow({ onSubmit, saving }: { onSubmit: (f: { model: string; kind: "chat" | "embedding"; input: string; output: string; note: string }) => void; saving: boolean }) {
  const [model, setModel] = useState("");
  const [kind, setKind] = useState<"chat" | "embedding">("chat");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [note, setNote] = useState("");
  return (
    <div style={{ padding: "12px 20px", background: C.accentLight, borderBottom: `1px solid ${C.border}`, display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 2fr auto", gap: 8, alignItems: "center" }}>
      <input type="text" placeholder="id Mistral (ex: mistral-large-3)" value={model} onChange={(e) => setModel(e.target.value)}
        style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: "monospace" }} />
      <select value={kind} onChange={(e) => setKind(e.target.value as "chat" | "embedding")}
        style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }}>
        <option value="chat">chat</option>
        <option value="embedding">embedding</option>
      </select>
      <input type="number" step="0.001" min="0" placeholder="input €/M" value={input} onChange={(e) => setInput(e.target.value)}
        style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, textAlign: "right" }} />
      <input type="number" step="0.001" min="0" placeholder="output €/M" value={output} onChange={(e) => setOutput(e.target.value)} disabled={kind === "embedding"}
        style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, textAlign: "right", opacity: kind === "embedding" ? 0.4 : 1 }} />
      <input type="text" placeholder="note (source, version)" value={note} onChange={(e) => setNote(e.target.value)}
        style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
      <button onClick={() => onSubmit({ model, kind, input, output, note })} disabled={saving}
        style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: C.accent, color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        Ajouter
      </button>
    </div>
  );
}

function CoutsIA() {
  const navigate = useNavigate();
  // Deux modes de filtre exclusifs : quick (boutons 7j/30j/Tout) ou custom
  // (deux dates from/to). Dès qu'une date est saisie, on passe en mode custom.
  const [period, setPeriod] = useState<"7d" | "30d" | "all">("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const useCustom = from !== "" || to !== "";
  const [summary, setSummary] = useState<AiCostSummary | null>(null);
  const [byDossier, setByDossier] = useState<AiCostByDossier[] | null>(null);
  const [byCommune, setByCommune] = useState<AiCostByCommune[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    const qs = useCustom
      ? `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      : `period=${period}`;
    Promise.all([
      api.get<AiCostSummary>(`/admin/ai-cost/summary?${qs}`),
      api.get<AiCostByDossier[]>(`/admin/ai-cost/by-dossier?${qs}&limit=50`),
      api.get<AiCostByCommune[]>(`/admin/ai-cost/by-commune?${qs}&limit=50`),
    ])
      .then(([s, d, c]) => { setSummary(s); setByDossier(d); setByCommune(c); setError(""); })
      .catch((e) => setError(`Impossible de charger les coûts IA — ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, [period, from, to, useCustom]);

  const setQuick = (p: "7d" | "30d" | "all") => { setFrom(""); setTo(""); setPeriod(p); };
  const clearCustom = () => { setFrom(""); setTo(""); };

  return (
    <PageShell>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: C.text }}>Coûts IA <span style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginLeft: 8 }}>· estimés</span></h1>
          <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>
            Estimation calculée à partir des tokens retournés par Mistral et de la grille tarifaire ci-dessous. La facture officielle reste celle de la <a href="https://console.mistral.ai/" target="_blank" rel="noreferrer" style={{ color: C.accent }}>console Mistral</a>.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(["7d", "30d", "all"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setQuick(p)}
              style={{
                padding: "8px 14px", borderRadius: 8,
                border: `1px solid ${!useCustom && period === p ? C.accent : C.border}`,
                background: !useCustom && period === p ? C.accent : "white",
                color: !useCustom && period === p ? "white" : C.text,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >{p === "7d" ? "7 jours" : p === "30d" ? "30 jours" : "Tout"}</button>
          ))}
          <div style={{ width: 1, height: 24, background: C.border, margin: "0 4px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", border: `1px solid ${useCustom ? C.accent : C.border}`, borderRadius: 8, background: "white" }}>
            <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 600 }}>📅</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              style={{ border: "none", outline: "none", fontSize: 13, fontFamily: "inherit", color: C.text, background: "transparent" }}
            />
            <span style={{ color: C.textMuted, fontSize: 12 }}>→</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              style={{ border: "none", outline: "none", fontSize: 13, fontFamily: "inherit", color: C.text, background: "transparent" }}
            />
            {useCustom && (
              <button
                onClick={clearCustom}
                title="Effacer la plage personnalisée"
                style={{ border: "none", background: "transparent", color: C.textMuted, fontSize: 14, cursor: "pointer", padding: "0 4px", marginLeft: 2 }}
              >×</button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}`, color: C.red, borderRadius: 10, padding: "12px 16px", marginBottom: 24, fontSize: 14 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner /></div>
      ) : summary && byDossier && byCommune && (
        <>
          {/* Alertes Slack */}
          <AlertsCard />

          {/* Tarifs Mistral éditables */}
          <PricingCard />

          {/* Totaux */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            <StatCard label="Coût total" value={fmtEur(summary.totals.cost_eur)} icon="💶" color={C.accent} bg={C.accentLight} />
            <StatCard label="Appels IA" value={summary.totals.events.toLocaleString("fr-FR")} icon="🤖" color={C.blue} bg={C.blueBg} />
            <StatCard label="Tokens entrée" value={summary.totals.input_tokens.toLocaleString("fr-FR")} icon="📥" color={C.purple} bg={C.purpleBg} />
            <StatCard label="Tokens sortie" value={summary.totals.output_tokens.toLocaleString("fr-FR")} icon="📤" color={C.green} bg={C.greenBg} />
          </div>

          {/* Répartition par usage */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 14, color: C.text }}>
                Par usage métier
              </div>
              {summary.by_purpose.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 13 }}>Aucun appel enregistré.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {[...summary.by_purpose].sort((a, b) => b.cost_eur - a.cost_eur).map((p) => (
                      <tr key={p.purpose} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: "10px 20px", color: C.text }}>{PURPOSE_LABELS[p.purpose] ?? p.purpose}</td>
                        <td style={{ padding: "10px 20px", color: C.textMuted, textAlign: "right" }}>{p.events.toLocaleString("fr-FR")} appels</td>
                        <td style={{ padding: "10px 20px", color: C.text, fontWeight: 600, textAlign: "right" }}>{fmtEur(p.cost_eur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 14, color: C.text }}>
                Par modèle
              </div>
              {summary.by_model.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 13 }}>Aucun appel enregistré.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {[...summary.by_model].sort((a, b) => b.cost_eur - a.cost_eur).map((m) => (
                      <tr key={m.model} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: "10px 20px", color: C.text, fontFamily: "monospace", fontSize: 12 }}>{m.model}</td>
                        <td style={{ padding: "10px 20px", color: C.textMuted, textAlign: "right" }}>{m.events.toLocaleString("fr-FR")}</td>
                        <td style={{ padding: "10px 20px", color: C.text, fontWeight: 600, textAlign: "right" }}>{fmtEur(m.cost_eur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Par commune */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 14, color: C.text, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Coûts par commune</span>
              <span style={{ color: C.textMuted, fontSize: 12, fontWeight: 400 }}>{byCommune.length} commune(s) imputée(s)</span>
            </div>
            {byCommune.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: C.textMuted }}>Aucun coût IA imputable à une commune sur cette période.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Commune</th>
                    <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>INSEE</th>
                    <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Appels</th>
                    <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Coût</th>
                    <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Dernier appel</th>
                  </tr>
                </thead>
                <tbody>
                  {byCommune.map((c) => (
                    <tr
                      key={c.commune_id}
                      style={{ borderTop: `1px solid ${C.border}`, cursor: "pointer" }}
                      onClick={() => navigate(`/admin/couts-ia/commune/${c.commune_id}`)}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.bg)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "10px 20px", color: C.text, fontWeight: 600 }}>{c.commune_name ?? <span style={{ color: C.textLight }}>commune supprimée</span>}</td>
                      <td style={{ padding: "10px 20px", color: C.textMuted, fontFamily: "monospace", fontSize: 12 }}>{c.insee_code ?? "—"}</td>
                      <td style={{ padding: "10px 20px", color: C.textMuted, textAlign: "right" }}>{c.events.toLocaleString("fr-FR")}</td>
                      <td style={{ padding: "10px 20px", color: C.text, fontWeight: 700, textAlign: "right" }}>{fmtEur(c.cost_eur)}</td>
                      <td style={{ padding: "10px 20px", color: C.textMuted, fontSize: 12 }}>{new Date(c.last_event_at).toLocaleString("fr-FR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Top dossiers */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 14, color: C.text, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Dossiers les plus coûteux</span>
              <span style={{ color: C.textMuted, fontSize: 12, fontWeight: 400 }}>{byDossier.length} dossier(s)</span>
            </div>
            {byDossier.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: C.textMuted }}>Aucun coût IA imputable à un dossier sur cette période.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>N° de dossier</th>
                    <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Type</th>
                    <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Commune</th>
                    <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Appels</th>
                    <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Coût</th>
                    <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Dernier appel</th>
                  </tr>
                </thead>
                <tbody>
                  {byDossier.map((d) => (
                    <tr
                      key={d.dossier_id}
                      style={{ borderTop: `1px solid ${C.border}`, cursor: "pointer" }}
                      onClick={() => navigate(`/admin/couts-ia/${d.dossier_id}`)}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.bg)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "10px 20px", color: C.text, fontWeight: 600 }}>{d.numero ?? <span style={{ color: C.textLight }}>supprimé</span>}</td>
                      <td style={{ padding: "10px 20px", color: C.textMuted }}>{d.type ?? "—"}</td>
                      <td style={{ padding: "10px 20px", color: C.textMuted }}>{d.commune ?? "—"}</td>
                      <td style={{ padding: "10px 20px", color: C.textMuted, textAlign: "right" }}>{d.events}</td>
                      <td style={{ padding: "10px 20px", color: C.text, fontWeight: 700, textAlign: "right" }}>{fmtEur(d.cost_eur)}</td>
                      <td style={{ padding: "10px 20px", color: C.textMuted, fontSize: 12 }}>{new Date(d.last_event_at).toLocaleString("fr-FR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}

interface AiCostDossierDetail {
  by_purpose: { purpose: string; model: string; events: number; cost_eur: number; input_tokens: number; output_tokens: number }[];
  events: Array<{
    id: string;
    purpose: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_eur: number;
    duration_ms: number | null;
    created_at: string;
  }>;
}

function CoutsIADossier() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AiCostDossierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    api.get<AiCostDossierDetail>(`/admin/ai-cost/dossier/${id}`)
      .then(setDetail)
      .catch(() => setError("Impossible de charger le détail."))
      .finally(() => setLoading(false));
  }, [id]);

  const total = detail?.by_purpose.reduce((s, p) => s + p.cost_eur, 0) ?? 0;

  return (
    <PageShell>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <button
        onClick={() => navigate("/admin/couts-ia")}
        style={{ background: "transparent", border: "none", color: C.accent, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 12 }}
      >← Retour</button>
      <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: C.text }}>
        Détail des coûts IA
      </h1>
      <p style={{ margin: "0 0 24px", color: C.textMuted, fontSize: 13, fontFamily: "monospace" }}>Dossier {id}</p>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}`, color: C.red, borderRadius: 10, padding: "12px 16px", marginBottom: 24, fontSize: 14 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner /></div>
      ) : detail && (
        <>
          <div style={{ background: C.accentLight, border: `1px solid ${C.accent}`, borderRadius: 12, padding: "16px 20px", marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>Coût IA total du dossier</div>
            <div style={{ color: C.accent, fontWeight: 800, fontSize: 24 }}>{fmtEur(total)}</div>
          </div>

          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 14, color: C.text }}>
              Répartition par usage
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Usage</th>
                  <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Modèle</th>
                  <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Appels</th>
                  <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>In</th>
                  <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Out</th>
                  <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Coût</th>
                </tr>
              </thead>
              <tbody>
                {[...detail.by_purpose].sort((a, b) => b.cost_eur - a.cost_eur).map((p, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 20px", color: C.text }}>{PURPOSE_LABELS[p.purpose] ?? p.purpose}</td>
                    <td style={{ padding: "10px 20px", color: C.textMuted, fontFamily: "monospace", fontSize: 12 }}>{p.model}</td>
                    <td style={{ padding: "10px 20px", color: C.textMuted, textAlign: "right" }}>{p.events}</td>
                    <td style={{ padding: "10px 20px", color: C.textMuted, textAlign: "right" }}>{p.input_tokens.toLocaleString("fr-FR")}</td>
                    <td style={{ padding: "10px 20px", color: C.textMuted, textAlign: "right" }}>{p.output_tokens.toLocaleString("fr-FR")}</td>
                    <td style={{ padding: "10px 20px", color: C.text, fontWeight: 700, textAlign: "right" }}>{fmtEur(p.cost_eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 14, color: C.text }}>
              Journal des appels ({detail.events.length})
            </div>
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, background: C.bg }}>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: C.textMuted }}>Date</th>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: C.textMuted }}>Usage</th>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: C.textMuted }}>Modèle</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", fontWeight: 600, color: C.textMuted }}>In</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", fontWeight: 600, color: C.textMuted }}>Out</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", fontWeight: 600, color: C.textMuted }}>Durée</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", fontWeight: 600, color: C.textMuted }}>Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.events.map((e) => (
                    <tr key={e.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 16px", color: C.textMuted }}>{new Date(e.created_at).toLocaleString("fr-FR")}</td>
                      <td style={{ padding: "8px 16px", color: C.text }}>{PURPOSE_LABELS[e.purpose] ?? e.purpose}</td>
                      <td style={{ padding: "8px 16px", color: C.textMuted, fontFamily: "monospace" }}>{e.model}</td>
                      <td style={{ padding: "8px 16px", color: C.textMuted, textAlign: "right" }}>{e.input_tokens.toLocaleString("fr-FR")}</td>
                      <td style={{ padding: "8px 16px", color: C.textMuted, textAlign: "right" }}>{e.output_tokens.toLocaleString("fr-FR")}</td>
                      <td style={{ padding: "8px 16px", color: C.textMuted, textAlign: "right" }}>{e.duration_ms ? `${(e.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                      <td style={{ padding: "8px 16px", color: C.text, fontWeight: 700, textAlign: "right" }}>{fmtEur(e.cost_eur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

interface AiCostCommuneDetail {
  commune: { id: string; name: string; insee_code: string } | null;
  by_purpose: { purpose: string; model: string; events: number; cost_eur: number; input_tokens: number; output_tokens: number }[];
  events: Array<{
    id: string;
    purpose: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_eur: number;
    duration_ms: number | null;
    created_at: string;
    dossier_id: string | null;
  }>;
}

function CoutsIACommune() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AiCostCommuneDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    api.get<AiCostCommuneDetail>(`/admin/ai-cost/commune/${id}`)
      .then(setDetail)
      .catch(() => setError("Impossible de charger le détail."))
      .finally(() => setLoading(false));
  }, [id]);

  const total = detail?.by_purpose.reduce((s, p) => s + p.cost_eur, 0) ?? 0;
  const commName = detail?.commune?.name ?? "Commune inconnue";

  return (
    <PageShell>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <button
        onClick={() => navigate("/admin/couts-ia")}
        style={{ background: "transparent", border: "none", color: C.accent, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 12 }}
      >← Retour</button>
      <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: C.text }}>
        Coûts IA — {commName}
      </h1>
      <p style={{ margin: "0 0 24px", color: C.textMuted, fontSize: 13 }}>INSEE {detail?.commune?.insee_code ?? "—"}</p>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}`, color: C.red, borderRadius: 10, padding: "12px 16px", marginBottom: 24, fontSize: 14 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner /></div>
      ) : detail && (
        <>
          <div style={{ background: C.accentLight, border: `1px solid ${C.accent}`, borderRadius: 12, padding: "16px 20px", marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>Coût IA total imputé à cette commune</div>
            <div style={{ color: C.accent, fontWeight: 800, fontSize: 24 }}>{fmtEur(total)}</div>
          </div>

          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 14, color: C.text }}>
              Répartition par usage
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Usage</th>
                  <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Modèle</th>
                  <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Appels</th>
                  <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>In</th>
                  <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Out</th>
                  <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>Coût</th>
                </tr>
              </thead>
              <tbody>
                {[...detail.by_purpose].sort((a, b) => b.cost_eur - a.cost_eur).map((p, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 20px", color: C.text }}>{PURPOSE_LABELS[p.purpose] ?? p.purpose}</td>
                    <td style={{ padding: "10px 20px", color: C.textMuted, fontFamily: "monospace", fontSize: 12 }}>{p.model}</td>
                    <td style={{ padding: "10px 20px", color: C.textMuted, textAlign: "right" }}>{p.events}</td>
                    <td style={{ padding: "10px 20px", color: C.textMuted, textAlign: "right" }}>{p.input_tokens.toLocaleString("fr-FR")}</td>
                    <td style={{ padding: "10px 20px", color: C.textMuted, textAlign: "right" }}>{p.output_tokens.toLocaleString("fr-FR")}</td>
                    <td style={{ padding: "10px 20px", color: C.text, fontWeight: 700, textAlign: "right" }}>{fmtEur(p.cost_eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 14, color: C.text }}>
              Journal des appels ({detail.events.length})
            </div>
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, background: C.bg }}>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: C.textMuted }}>Date</th>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: C.textMuted }}>Usage</th>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: C.textMuted }}>Modèle</th>
                    <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: C.textMuted }}>Dossier</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", fontWeight: 600, color: C.textMuted }}>In</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", fontWeight: 600, color: C.textMuted }}>Out</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", fontWeight: 600, color: C.textMuted }}>Durée</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", fontWeight: 600, color: C.textMuted }}>Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.events.map((e) => (
                    <tr key={e.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 16px", color: C.textMuted }}>{new Date(e.created_at).toLocaleString("fr-FR")}</td>
                      <td style={{ padding: "8px 16px", color: C.text }}>{PURPOSE_LABELS[e.purpose] ?? e.purpose}</td>
                      <td style={{ padding: "8px 16px", color: C.textMuted, fontFamily: "monospace" }}>{e.model}</td>
                      <td style={{ padding: "8px 16px", color: C.accent, fontSize: 11, fontFamily: "monospace" }}>
                        {e.dossier_id ? (
                          <span style={{ cursor: "pointer" }} onClick={(ev) => { ev.stopPropagation(); navigate(`/admin/couts-ia/${e.dossier_id}`); }}>
                            {e.dossier_id.slice(0, 8)}…
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ padding: "8px 16px", color: C.textMuted, textAlign: "right" }}>{e.input_tokens.toLocaleString("fr-FR")}</td>
                      <td style={{ padding: "8px 16px", color: C.textMuted, textAlign: "right" }}>{e.output_tokens.toLocaleString("fr-FR")}</td>
                      <td style={{ padding: "8px 16px", color: C.textMuted, textAlign: "right" }}>{e.duration_ms ? `${(e.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                      <td style={{ padding: "8px 16px", color: C.text, fontWeight: 700, textAlign: "right" }}>{fmtEur(e.cost_eur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
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
          <Route path="/roles" element={<Roles />} />
          <Route path="/services" element={<ServicesAnnexes />} />
          <Route path="/couts-ia" element={<CoutsIA />} />
          <Route path="/couts-ia/commune/:id" element={<CoutsIACommune />} />
          <Route path="/couts-ia/:id" element={<CoutsIADossier />} />
          <Route path="/audit" element={<AuditLogs />} />
          <Route path="/conformite" element={<Conformite />} />
          <Route path="/configuration" element={<Configuration />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </div>
  );
}
