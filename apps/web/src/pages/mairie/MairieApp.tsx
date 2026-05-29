import { useState, useRef, useEffect, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { MapLeaflet, type MapDossier, type BaseLayer } from "../../components/MapLeaflet";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { CourrierModal, TemplateManagerPanel, CommuneLetterheadPanel } from "./MairieCourrierScreen";

const COMMUNE_INSEE: Record<string, string> = {
  "Ballan-Miré": "37018",
  "Berthenay": "37024",
  "Tours": "37261",
  "Saint-Avertin": "37208",
  "Joué-lès-Tours": "37122",
  "La Riche": "37195",
};

const NAV_ITEMS = [
  { label: "Tableau de bord", icon: HomeIcon, path: "/mairie" },
  { label: "Dossiers", icon: FolderIcon, path: "/mairie/dossiers" },
  { label: "Calendrier", icon: CalendarIcon, path: "/mairie/calendrier" },
  { label: "Messagerie", icon: MessageIcon, path: "/mairie/messagerie" },
  { label: "Carte", icon: MapIcon, path: "/mairie/carte" },
  { label: "Statistiques", icon: ChartIcon, path: "/mairie/statistiques" },
  { label: "Signatures", icon: PenIcon, path: "/mairie/signatures" },
  { label: "Paramètres", icon: SettingsIcon, path: "/mairie/parametres" },
];

const LABEL_TO_PATH: Record<string, string> = Object.fromEntries(NAV_ITEMS.map(n => [n.label, n.path]));
LABEL_TO_PATH["Infos Perso"] = "/mairie/profil";

function HomeIcon({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function FolderIcon({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}
function CalendarIcon({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function MessageIcon({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}
function MapIcon({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}
function ChartIcon({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
function SettingsIcon({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14" />
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}
function RulesIcon({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
function BellIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}
function SearchIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function PlusIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function HelpIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function BuildingIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="1" /><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
    </svg>
  );
}
function ChevronDownIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function ArrowRightIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
function DotsIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
    </svg>
  );
}
function PenIcon({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
function SendIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
function SunIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function UserIcon({ size = 18, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function Sidebar({ active, setActive, commune, setCommune, messageBadge = 0, signaturesBadge = 0, isSignataire = false, communes = [] }: { active: string; setActive: (s: string) => void; commune: string; setCommune: (c: string) => void; messageBadge?: number; signaturesBadge?: number; isSignataire?: boolean; communes?: string[] }) {
  const [showDrop, setShowDrop] = useState(false);
  const [search, setSearch] = useState("");
  const { logout, user } = useAuth();
  const manyCommunes = communes.length > 5;
  const filtered = manyCommunes
    ? communes.filter(c => c.toLowerCase().includes(search.toLowerCase()))
    : communes;
  const visibleNavItems = NAV_ITEMS.filter(item => item.label !== "Signatures" || isSignataire);
  return (
    <aside style={{
      width: 200, minWidth: 200, background: "#0f1629",
      display: "flex", flexDirection: "column",
      height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, flexShrink: 0 }}>
            <svg viewBox="0 0 34 34" fill="none">
              <polygon points="17,2 31,9.5 31,24.5 17,32 3,24.5 3,9.5" fill="#4F46E5" opacity="0.15" stroke="#4F46E5" strokeWidth="1.5"/>
              <polygon points="17,7 27,12.5 27,23.5 17,29 7,23.5 7,12.5" fill="#4F46E5" opacity="0.3"/>
              <polygon points="17,11 23,14.5 23,21.5 17,25 11,21.5 11,14.5" fill="#4F46E5"/>
              <text x="17" y="21" textAnchor="middle" fontSize="9" fontWeight="800" fill="white" fontFamily="sans-serif">H</text>
            </svg>
          </div>
          <span style={{ color: "white", fontWeight: 800, fontSize: 15, letterSpacing: "0.04em" }}>HEUREKIA</span>
        </div>
        {/* Commune selector */}
        {communes.length > 0 && (
          <div style={{ position: "relative" }}>
            <div onClick={() => { setShowDrop(!showDrop); setSearch(""); }} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 10px", cursor: communes.length > 1 ? "pointer" : "default", display: "flex", alignItems: "center", gap: 8 }}>
              <BuildingIcon size={14} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1 }}>Commune</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{commune || "—"}</div>
              </div>
              {communes.length > 1 && <ChevronDownIcon size={12} />}
            </div>
            {showDrop && communes.length > 1 && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#1a2540", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 200, overflow: "hidden" }}>
                {manyCommunes && (
                  <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                    <input
                      autoFocus
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Rechercher…"
                      style={{ width: "100%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "5px 8px", color: "#e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box" as const }}
                    />
                  </div>
                )}
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {filtered.length === 0 && (
                    <div style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>Aucun résultat</div>
                  )}
                  {filtered.map(c => (
                    <button key={c} onClick={() => { setCommune(c); setShowDrop(false); setSearch(""); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left" as const, fontSize: 12, color: c === commune ? "#818cf8" : "#94a3b8", fontWeight: c === commune ? 600 : 400 }}>
                      <BuildingIcon size={12} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</span>
                      {c === commune && <span style={{ color: "#818cf8", flexShrink: 0 }}>✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <nav style={{ flex: 1, padding: "4px 10px", overflowY: "auto" }}>
        {visibleNavItems.map(({ label, icon: Icon }) => {
          const isActive = active === label;
          const badge = label === "Messagerie" ? messageBadge : label === "Signatures" ? signaturesBadge : 0;
          return (
            <button key={label} onClick={() => setActive(label)} style={{
              width: "100%", border: "none",
              background: isActive ? "#4F46E5" : "transparent",
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 8, marginBottom: 2,
              color: isActive ? "white" : "#94a3b8",
              fontSize: 13, fontWeight: isActive ? 600 : 400,
              cursor: "pointer", transition: "all 0.12s", textAlign: "left",
            }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              <Icon size={16} />
              <span style={{ flex: 1 }}>{label}</span>
              {badge > 0 && (
                <span style={{ background: isActive ? "rgba(255,255,255,0.25)" : "#4F46E5", color: "white", fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <div onClick={() => setActive("Infos Perso")} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, cursor: "pointer" }}>
          <div style={{ width: 34, height: 34, background: "linear-gradient(135deg, #4F46E5, #7C3AED)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "white", flexShrink: 0 }}>
            {user ? `${user.prenom[0] ?? ""}${user.nom[0] ?? ""}`.toUpperCase() : "?"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "white", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user ? `${user.prenom} ${user.nom[0]}.` : "—"}</div>
            <div style={{ color: "#64748b", fontSize: 11 }}>{user?.role === "instructeur" ? "Instructeur" : user?.role === "admin" ? "Admin" : "Mairie"}</div>
          </div>
        </div>
        <button
          onClick={logout}
          title="Déconnexion"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 4, borderRadius: 6, display: "flex", alignItems: "center", flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = "#EF4444")}
          onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </aside>
  );
}

type ApiNotif = { id: string; type: string; title: string; message: string; is_read: boolean; dossier_id: string | null; created_at: string };

function notifIcon(type: string) {
  if (type.includes("message")) return "💬";
  if (type.includes("delai") || type.includes("echeance") || type.includes("incomplet")) return "⏰";
  if (type.includes("decision") || type.includes("accepte") || type.includes("refuse")) return "✅";
  if (type.includes("dossier") || type.includes("nouveau")) return "📁";
  return "🔔";
}
function notifColor(type: string) {
  if (type.includes("delai") || type.includes("echeance") || type.includes("incomplet") || type.includes("refuse")) return "#EF4444";
  if (type.includes("message")) return "#3B82F6";
  return "#4F46E5";
}
function relTime(d: string) {
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60_000) return "À l'instant";
  if (ms < 3_600_000) return `Il y a ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `Il y a ${Math.floor(ms / 3_600_000)}h`;
  if (ms < 172_800_000) return "Hier";
  return `Il y a ${Math.floor(ms / 86_400_000)}j`;
}

function Topbar({ buttonLabel = "Nouveau dossier", onNewDossier, navigate, onDossierClick, commune = "", onViewAllNotifications }: { title?: string; buttonLabel?: string; onNewDossier?: () => void; navigate?: (s: string) => void; onDossierClick?: (d: DossierInfo) => void; commune?: string; onViewAllNotifications?: () => void }) {
  const routerNav = useNavigate();
  const [showNotifs, setShowNotifs] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [faqQuery, setFaqQuery] = useState("");
  const [faqAnswer, setFaqAnswer] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<ApiDossier[]>([]);
  const [apiNotifs, setApiNotifs] = useState<ApiNotif[]>([]);

  const loadNotifs = () => {
    api.get<ApiNotif[]>("/notifications").then(setApiNotifs).catch(() => {});
  };

  useEffect(() => { loadNotifs(); }, []);

  const unreadCount = apiNotifs.filter(n => !n.is_read).length;

  const markAllRead = async () => {
    await api.patch("/notifications/read-all").catch(() => {});
    setApiNotifs(ns => ns.map(n => ({ ...n, is_read: true })));
  };

  const handleNotifClick = async (n: ApiNotif) => {
    if (!n.is_read) {
      api.patch(`/notifications/${n.id}/read`).catch(() => {});
      setApiNotifs(ns => ns.map(x => x.id === n.id ? { ...x, is_read: true } : x));
    }
    setShowNotifs(false);
    if (n.dossier_id) routerNav(`/mairie/dossiers/${n.dossier_id}`);
  };

  useEffect(() => {
    if (searchQuery.length <= 1) { setSearchResults([]); return; }
    const timer = setTimeout(() => {
      const qs = commune ? `search=${encodeURIComponent(searchQuery)}&commune=${encodeURIComponent(commune)}` : `search=${encodeURIComponent(searchQuery)}`;
      api.get<ApiDossier[]>(`/mairie/dossiers?${qs}`)
        .then(data => setSearchResults(data.slice(0, 8)))
        .catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const closeAll = () => { setShowNotifs(false); setShowFAQ(false); };

  return (
    <div style={{ position: "sticky", top: 0, zIndex: 40 }}>
      <div style={{ height: 56, background: "white", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", padding: "0 24px", gap: 16 }}>
        {/* Search */}
        <div style={{ flex: 1, maxWidth: 440, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F1F5F9", borderRadius: 8, padding: "7px 12px", border: `1px solid ${searchFocused ? "#4F46E5" : "#E2E8F0"}` }}>
            <SearchIcon size={15} />
            <input
              style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, color: "#374151", flex: 1 }}
              placeholder="Rechercher un dossier, une adresse, un pétitionnaire..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            />
            {searchQuery && <button onClick={() => setSearchQuery("")} style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>}
          </div>
          {searchFocused && searchQuery.length > 1 && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "white", borderRadius: 10, border: "1px solid #E2E8F0", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 200, overflow: "hidden" }}>
              {searchResults.length > 0 ? searchResults.map(r => (
                <button key={r.id} onMouseDown={() => { onDossierClick?.({ id: r.id, numero: r.numero, type: r.type, petitionnaire: r.demandeur, adresse: r.adresse ?? "—", status: r.status, echeance: r.date_limite_instruction ? new Date(r.date_limite_instruction).toLocaleDateString("fr-FR") : "—", date_depot: r.date_depot ?? undefined }); setSearchQuery(""); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", minWidth: 110 }}>{r.numero}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{r.adresse ?? "—"} — {r.demandeur}</span>
                </button>
              )) : (
                <div style={{ padding: "12px 14px", fontSize: 13, color: "#94a3b8" }}>Aucun résultat pour « {searchQuery} »</div>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Bell */}
        <div style={{ position: "relative" }}>
          <button onClick={() => { setShowNotifs(!showNotifs); setShowFAQ(false); if (!showNotifs) loadNotifs(); }} style={{ border: "none", background: showNotifs ? "#F1F5F9" : "none", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", padding: 6, borderRadius: 6 }}>
            <BellIcon size={20} />
          </button>
          {unreadCount > 0 && (
            <span style={{ position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, background: "#EF4444", borderRadius: 8, fontSize: 9, fontWeight: 700, color: "white", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", pointerEvents: "none" }}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
          {showNotifs && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 340, background: "white", borderRadius: 12, border: "1px solid #E2E8F0", boxShadow: "0 8px 24px rgba(0,0,0,0.14)", zIndex: 200 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
                  Notifications {unreadCount > 0 && <span style={{ background: "#EF4444", color: "white", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "1px 6px", marginLeft: 4 }}>{unreadCount}</span>}
                </span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} style={{ border: "none", background: "none", fontSize: 11, color: "#4F46E5", cursor: "pointer", fontWeight: 500 }}>Tout marquer lu</button>
                )}
              </div>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {apiNotifs.length === 0 ? (
                  <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12, color: "#94a3b8" }}>Aucune notification</div>
                ) : apiNotifs.slice(0, 8).map(n => (
                  <div key={n.id} onClick={() => handleNotifClick(n)}
                    style={{ padding: "10px 16px", display: "flex", alignItems: "flex-start", gap: 10, borderBottom: "1px solid #F8FAFC", cursor: "pointer", background: n.is_read ? "white" : "#F8F7FF", transition: "background 0.15s" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: notifColor(n.type) + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{notifIcon(n.type)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#0F172A", fontWeight: n.is_read ? 400 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.message}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{relTime(n.created_at)}</div>
                    </div>
                    {!n.is_read && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4F46E5", flexShrink: 0, marginTop: 4 }} />}
                  </div>
                ))}
              </div>
              <div style={{ padding: "10px 16px", textAlign: "center", borderTop: "1px solid #F1F5F9" }}>
                <button onClick={() => { setShowNotifs(false); onViewAllNotifications?.(); }} style={{ border: "none", background: "none", fontSize: 12, color: "#4F46E5", cursor: "pointer", fontWeight: 500 }}>
                  Voir toutes les notifications →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* FAQ / Help */}
        <div style={{ position: "relative" }}>
          <button onClick={() => { setShowFAQ(!showFAQ); setShowNotifs(false); }} style={{ border: "none", background: showFAQ ? "#F1F5F9" : "none", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", padding: 6, borderRadius: 6 }}>
            <HelpIcon size={20} />
          </button>
          {showFAQ && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 340, background: "white", borderRadius: 12, border: "1px solid #E2E8F0", boxShadow: "0 8px 24px rgba(0,0,0,0.14)", zIndex: 200 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #F1F5F9" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Assistant FAQ ✨</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Posez une question sur la réglementation, les délais ou les procédures.</div>
              </div>
              <div style={{ padding: "12px 16px" }}>
                {faqAnswer && (
                  <div style={{ background: "#F0F4FF", borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontSize: 12, color: "#374151", borderLeft: "3px solid #4F46E5" }}>{faqAnswer}</div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={faqQuery}
                    onChange={e => setFaqQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && faqQuery.trim()) { setFaqAnswer("Recherche en cours sur « " + faqQuery + " »… Cette fonctionnalité sera connectée à la base réglementaire."); setFaqQuery(""); } }}
                    placeholder="Ex : délai permis de construire..."
                    style={{ flex: 1, padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, outline: "none", color: "#374151" }}
                    autoFocus
                  />
                  <button onClick={() => { if (faqQuery.trim()) { setFaqAnswer("Recherche en cours sur « " + faqQuery + " »… Cette fonctionnalité sera connectée à la base réglementaire."); setFaqQuery(""); } }} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "7px 13px", fontSize: 13, cursor: "pointer" }}>→</button>
                </div>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
                  {["Délai permis construire", "Consultation ABF", "Pièces CERFA"].map(s => (
                    <button key={s} onClick={() => setFaqQuery(s)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 12, padding: "3px 8px", fontSize: 11, color: "#4F46E5", cursor: "pointer" }}>{s}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* New dossier */}
        {onNewDossier && (
          <button onClick={onNewDossier} style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: "0 1px 3px rgba(79,70,229,0.3)" }}>
            <PlusIcon size={14} />{buttonLabel}
          </button>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  brouillon: "Brouillon",
  soumis: "Nouveau",
  pre_instruction: "Pré-instruction",
  incomplet: "Incomplet",
  en_instruction: "En instruction",
  decision_en_cours: "Décision en cours",
  accepte: "Accepté",
  refuse: "Refusé",
  accord_prescription: "Accord prescriptions",
};

const TYPE_LABEL: Record<string, string> = {
  permis_de_construire: "Permis de construire",
  declaration_prealable: "Déclaration préalable",
  permis_amenager: "Permis d'aménager",
  permis_demolir: "Permis de démolir",
  permis_lotir: "Permis de lotir",
  certificat_urbanisme: "Certificat d'urbanisme",
};

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}

type ApiDossier = {
  id: string; numero: string; type: string; status: string;
  adresse: string | null; commune: string | null; description: string | null;
  date_depot: string | null; date_limite_instruction: string | null;
  demandeur: string;
};

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const styles: Record<string, { bg: string; color: string; dot: string }> = {
    "En instruction": { bg: "#EFF6FF", color: "#1D4ED8", dot: "#3B82F6" },
    "Nouveau": { bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
    "Pré-instruction": { bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
    "Incomplet": { bg: "#FFF7ED", color: "#C2410C", dot: "#F97316" },
    "Décision en cours": { bg: "#FAF5FF", color: "#7E22CE", dot: "#9333EA" },
    "Accepté": { bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
    "Refusé": { bg: "#FEF2F2", color: "#B91C1C", dot: "#EF4444" },
    "Brouillon": { bg: "#F8FAFC", color: "#475569", dot: "#94A3B8" },
    "Accord prescriptions": { bg: "#EFF6FF", color: "#1D4ED8", dot: "#3B82F6" },
    "Actif": { bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
    "En attente": { bg: "#FFF7ED", color: "#C2410C", dot: "#F97316" },
    "Désactivé": { bg: "#FEF2F2", color: "#B91C1C", dot: "#EF4444" },
  };
  const s = styles[label] ?? { bg: "#F1F5F9", color: "#475569", dot: "#94A3B8" };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
      {label}
    </span>
  );
}

function stringToColor(s: string): string {
  const palette = ["#4F46E5","#22C55E","#F97316","#8B5CF6","#EC4899","#14B8A6","#EF4444","#3B82F6"];
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % palette.length;
  return palette[h] ?? "#4F46E5";
}
function nameInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}
function fmtConvTime(iso: string): string {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR");
}

function DashboardScreen({ navigate, navigateDossiers, commune, inseeCode, onDossierClick }: { navigate: (s: string) => void; navigateDossiers: (filter: string) => void; commune: string; inseeCode?: string; onDossierClick: (d: DossierInfo) => void }) {
  const { user } = useAuth();
  const [mapFilter, setMapFilter] = useState<string>("Tous");
  const [mapTypeFilter, setMapTypeFilter] = useState("Tous les types");
  const [mapDossiers, setMapDossiers] = useState<MapDossier[]>([]);
  const [statsByStatus, setStatsByStatus] = useState<Record<string, number>>({});
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    api.get<MapDossier[]>(`/mairie/map-dossiers?commune=${encodeURIComponent(commune)}`)
      .then(data => setMapDossiers(data))
      .catch(() => setMapDossiers([]));

    api.get<{ dossiers_par_statut: { status: string; count: number }[] }>(`/mairie/dashboard?commune=${encodeURIComponent(commune)}`)
      .then(data => {
        const map: Record<string, number> = {};
        data.dossiers_par_statut.forEach(r => { map[r.status] = Number(r.count); });
        setStatsByStatus(map);
      })
      .catch(() => {});

    api.get<{ count: number }>(`/mairie/conversations/unread-count?commune=${encodeURIComponent(commune)}`)
      .then(data => setUnreadMessages(Number(data.count)))
      .catch(() => {});
  }, [commune]);
  const [mapExpanded, setMapExpanded] = useState(false);

  const countByStatus = (s: string) => statsByStatus[s] ?? 0;
  const messagesEnAttente = unreadMessages;

  const cardDefs = [
    { label: "Nouveaux dossiers", desc: "Dossiers en attente d'ouverture d'instruction", count: countByStatus("soumis"), color: "#4F46E5", bg: "#EEF2FF", cta: "Voir les dossiers", ctaColor: "#4F46E5", ctaBg: "#EEF2FF", onClick: () => navigateDossiers("Nouveau"),
      icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><polyline points="9 11 12 14 15 11"/><line x1="12" y1="8" x2="12" y2="14"/></svg> },
    { label: "En instruction", desc: "Dossiers en cours d'instruction", count: countByStatus("en_instruction"), color: "#F97316", bg: "#FFF7ED", cta: "Voir les dossiers", ctaColor: "#F97316", ctaBg: "#FFF7ED", onClick: () => navigateDossiers("En instruction"),
      icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> },
    { label: "Messages sans réponse", desc: "Messages en attente de réponse", count: messagesEnAttente, color: "#4F46E5", bg: "#EEF2FF", cta: "Voir les messages", ctaColor: "#4F46E5", ctaBg: "#EEF2FF", onClick: () => navigate("Messagerie"),
      icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> },
    { label: "Incomplets", desc: "Dossiers en attente de pièces complémentaires", count: countByStatus("incomplet"), color: "#EF4444", bg: "#FEF2F2", cta: "Voir les dossiers", ctaColor: "#EF4444", ctaBg: "#FEF2F2", alert: true, onClick: () => navigateDossiers("Incomplet"),
      icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
  ];

  const filterColors: Record<string, string> = {
    "Nouveau": "#4F46E5", "En instruction": "#22C55E",
    "Décision en cours": "#8B5CF6", "Accepté": "#10B981", "Refusé": "#EF4444",
  };

  return (
    <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24, background: "#F8F9FC", minHeight: "100%" }}>
      {/* Greeting */}
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#0F172A", margin: "0 0 4px" }}>Bonjour {user?.prenom ?? ""},</h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>Voici l'essentiel de votre activité aujourd'hui.</p>
      </div>

      {/* KPI cards */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 14 }}>À traiter aujourd'hui</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
          {cardDefs.map((c) => (
            <div key={c.label} style={{ background: "white", borderRadius: 16, padding: "24px 20px 20px", border: "1px solid #E2E8F0", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", position: "relative", display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Count badge */}
              <div style={{ position: "absolute", top: 14, right: 14, width: 28, height: 28, borderRadius: "50%", background: c.color, color: "white", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{c.count}</div>
              {/* Icon circle */}
              <div style={{ width: 60, height: 60, borderRadius: "50%", background: c.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>{c.icon}</div>
              {/* Text */}
              <div>
                {c.alert && <span style={{ fontSize: 10, background: "#FEF2F2", color: "#B91C1C", borderRadius: 4, padding: "2px 7px", fontWeight: 700, letterSpacing: "0.03em", display: "inline-block", marginBottom: 5 }}>Délai dépassé</span>}
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 5, paddingRight: 24 }}>{c.label}</div>
                <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{c.desc}</div>
              </div>
              {/* CTA */}
              <button onClick={c.onClick} style={{ marginTop: "auto", width: "100%", padding: "9px 0", background: c.ctaBg, color: c.ctaColor, border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{c.cta}</button>
            </div>
          ))}
        </div>
      </div>

      {/* Map section */}
      <div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 3 }}>Carte des demandes</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Visualisez la localisation des demandes sur votre territoire.</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const }}>
            {["Tous", "Nouveau", "En instruction", "Décision en cours", "Accepté", "Refusé"].map(f => (
              <button key={f} onClick={() => setMapFilter(f)} style={{
                border: mapFilter === f ? "none" : "1px solid #E2E8F0",
                background: mapFilter === f ? (filterColors[f] ?? "#4F46E5") : "white",
                color: mapFilter === f ? "white" : "#374151",
                borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: mapFilter === f ? 600 : 400, cursor: "pointer",
              }}>{f}</button>
            ))}
            <select value={mapTypeFilter} onChange={e => setMapTypeFilter(e.target.value)} style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: "#374151", background: "white", cursor: "pointer", outline: "none" }}>
              <option>Tous les types</option>
              <option>Permis de construire</option>
              <option>Déclaration préalable</option>
              <option>Permis d'aménager</option>
              <option>Certificat d'urbanisme</option>
              <option>Permis de démolir</option>
            </select>
            <button onClick={() => setMapExpanded(!mapExpanded)} title={mapExpanded ? "Réduire" : "Agrandir"} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center" }}>
              {mapExpanded
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>}
            </button>
          </div>
        </div>

        <div style={{ height: mapExpanded ? 520 : 300, borderRadius: 16, border: "1px solid #E2E8F0", overflow: "hidden", transition: "height 0.25s ease" }}>
          <MapLeaflet
            dossiers={mapDossiers}
            height={mapExpanded ? 520 : 300}
            filterStatus={mapFilter}
            filterType={mapTypeFilter}
            commune={commune}
            inseeCode={inseeCode}
            onMarkerClick={(d) => onDossierClick({ id: d.id, numero: d.numero, type: d.type, petitionnaire: "—", adresse: d.adresse, status: d.status, echeance: "—" })}
          />
        </div>
      </div>

      {/* AI assistant banner */}
      <div style={{ background: "#1e1b4b", borderRadius: 16, padding: "28px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", overflow: "hidden", position: "relative" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 20 }}>✨</span>
            <span style={{ color: "#a5b4fc", fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Assistant IA</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "white", marginBottom: 8, lineHeight: 1.3 }}>Besoin d'aide ou d'informations ?</div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20, lineHeight: 1.6, maxWidth: 440 }}>Posez votre question à l'assistant IA, il vous répond instantanément sur les dossiers, délais ou réglementation.</div>
          <button onClick={() => alert("Assistant IA — bientôt disponible")} style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 16px rgba(79,70,229,0.4)" }}>
            Discuter avec l'assistant IA 💬
          </button>
        </div>
        <div style={{ flexShrink: 0, marginLeft: 32 }}>
          <svg width="120" height="100" viewBox="0 0 120 100" fill="none">
            <rect x="20" y="44" width="28" height="52" rx="2" fill="#312e81" opacity="0.8"/>
            <rect x="52" y="24" width="38" height="72" rx="2" fill="#3730a3" opacity="0.9"/>
            <rect x="95" y="54" width="18" height="42" rx="2" fill="#312e81" opacity="0.7"/>
            <rect x="26" y="54" width="8" height="8" rx="1" fill="#818cf8" opacity="0.7"/>
            <rect x="37" y="54" width="8" height="8" rx="1" fill="#818cf8" opacity="0.7"/>
            <rect x="26" y="66" width="8" height="8" rx="1" fill="#818cf8" opacity="0.45"/>
            <rect x="37" y="66" width="8" height="8" rx="1" fill="#818cf8" opacity="0.45"/>
            <rect x="59" y="34" width="9" height="9" rx="1" fill="#818cf8" opacity="0.7"/>
            <rect x="72" y="34" width="9" height="9" rx="1" fill="#818cf8" opacity="0.7"/>
            <rect x="59" y="47" width="9" height="9" rx="1" fill="#818cf8" opacity="0.7"/>
            <rect x="72" y="47" width="9" height="9" rx="1" fill="#818cf8" opacity="0.7"/>
            <rect x="59" y="60" width="9" height="9" rx="1" fill="#818cf8" opacity="0.45"/>
            <rect x="72" y="60" width="9" height="9" rx="1" fill="#818cf8" opacity="0.45"/>
            <rect x="62" y="78" width="16" height="18" rx="1" fill="#4338ca"/>
            <path d="M8 96 L112 96" stroke="#4338ca" strokeWidth="2" opacity="0.5"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

function DossiersScreen({ commune, onDossierClick }: { commune: string; onDossierClick: (d: DossierInfo) => void }) {
  const tabs = ["Tous", "Nouveau", "En instruction", "Pré-instruction", "Incomplet", "Décision en cours", "Accepté", "Refusé"];
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("filter") ?? "Tous");

  useEffect(() => {
    setActiveTab(searchParams.get("filter") ?? "Tous");
  }, [searchParams]);

  const [searchQ, setSearchQ] = useState("");
  const [apiDossiers, setApiDossiers] = useState<ApiDossier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showColPicker, setShowColPicker] = useState(false);

  type ColKey = "petitionnaire" | "adresse" | "type" | "statut" | "date_depot" | "echeance";
  const ALL_COLS: { key: ColKey; label: string }[] = [
    { key: "petitionnaire", label: "Pétitionnaire" },
    { key: "adresse", label: "Adresse" },
    { key: "type", label: "Type de dossier" },
    { key: "statut", label: "Statut" },
    { key: "date_depot", label: "Date de dépôt" },
    { key: "echeance", label: "Date d'échéance" },
  ];

  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    try {
      const saved = localStorage.getItem("dossiers_cols");
      if (saved) return new Set(JSON.parse(saved) as ColKey[]);
    } catch {}
    return new Set<ColKey>(["petitionnaire", "adresse", "type", "statut", "date_depot", "echeance"]);
  });

  const toggleCol = (key: ColKey) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem("dossiers_cols", JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Re-fetch when commune changes; compute deadlines on first load
  useEffect(() => {
    setLoading(true);
    const communeQ = `commune=${encodeURIComponent(commune)}`;
    fetch("/api/mairie/admin/compute-deadlines", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } })
      .catch(() => {})
      .finally(() => {
        api.get<ApiDossier[]>(`/mairie/dossiers?${communeQ}`)
          .then(d => setApiDossiers(d))
          .catch(() => {})
          .finally(() => setLoading(false));
      });
  }, [commune]);

  const allRows = apiDossiers.map(d => ({
    id: d.id,
    numero: d.numero,
    pet: d.demandeur,
    addr: d.adresse ?? "—",
    type: TYPE_LABEL[d.type] ?? d.type,
    statusLabel: STATUS_LABEL[d.status] ?? d.status,
    statusRaw: d.status,
    ech: fmtDate(d.date_limite_instruction),
    dateDepot: fmtDate(d.date_depot),
  }));

  const tabCounts: Record<string, number> = Object.fromEntries(
    tabs.map(t => [t, t === "Tous" ? allRows.length : allRows.filter(r => r.statusLabel === t).length])
  );
  const rows = allRows.filter(r => {
    const matchTab = activeTab === "Tous" || r.statusLabel === activeTab;
    const matchQ = !searchQ || r.numero.toLowerCase().includes(searchQ.toLowerCase()) || r.pet.toLowerCase().includes(searchQ.toLowerCase()) || r.addr.toLowerCase().includes(searchQ.toLowerCase());
    return matchTab && matchQ;
  });

  const colSpan = 2 + visibleCols.size; // N° + visible cols + Actions

  const thStyle: React.CSSProperties = { padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Dossiers — {commune}</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Retrouvez et suivez l'avancement de tous les dossiers.</p>
      </div>

      {/* Status tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E2E8F0", marginBottom: 16, overflowX: "auto" }}>
        {tabs.map(t => {
          const active = t === activeTab;
          return (
            <button key={t} onClick={() => { setActiveTab(t); setSearchParams(t !== "Tous" ? { filter: t } : {}, { replace: true }); }} style={{ border: "none", background: "none", padding: "8px 14px", fontSize: 13, fontWeight: active ? 600 : 400, color: active ? "#4F46E5" : "#64748b", borderBottom: active ? "2px solid #4F46E5" : "2px solid transparent", marginBottom: -2, cursor: "pointer", whiteSpace: "nowrap" }}>
              {t} <span style={{ fontSize: 11, color: active ? "#4F46E5" : "#94a3b8" }}>{tabCounts[t] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Rechercher un dossier, une adresse, un pétitionnaire..." style={{ width: "100%", padding: "7px 12px 7px 32px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", color: "#374151" }} />
        </div>
        {["Tous les types", "Tous les secteurs"].map(p => (
          <select key={p} style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", background: "white", cursor: "pointer" }}>
            <option>{p}</option>
          </select>
        ))}
        {/* Export CSV */}
        <button
          onClick={() => {
            const url = `/api/mairie/dossiers/export?commune=${encodeURIComponent(commune)}`;
            const a = document.createElement("a");
            a.href = url;
            a.click();
          }}
          style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "7px 12px", fontSize: 13, color: "#374151", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
          title="Exporter les dossiers en CSV"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Exporter CSV
        </button>

        {/* Column picker */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowColPicker(v => !v)}
            style={{ border: "1px solid #E2E8F0", background: showColPicker ? "#F1F5F9" : "white", borderRadius: 8, padding: "7px 12px", fontSize: 13, color: "#374151", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
            </svg>
            Colonnes
          </button>
          {showColPicker && (
            <>
              <div onClick={() => setShowColPicker(false)} style={{ position: "fixed", inset: 0, zIndex: 98 }} />
              <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "white", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px", zIndex: 99, minWidth: 210, boxShadow: "0 8px 24px rgba(0,0,0,0.10)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Colonnes visibles</div>
                {ALL_COLS.map(col => (
                  <label key={col.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: "pointer", fontSize: 13, color: "#374151" }}>
                    <input
                      type="checkbox"
                      checked={visibleCols.has(col.key)}
                      onChange={() => toggleCol(col.key)}
                      style={{ accentColor: "#4F46E5", width: 14, height: 14, cursor: "pointer" }}
                    />
                    {col.label}
                  </label>
                ))}
                <div style={{ borderTop: "1px solid #F1F5F9", marginTop: 8, paddingTop: 8 }}>
                  <button
                    onClick={() => {
                      const all = new Set<ColKey>(ALL_COLS.map(c => c.key));
                      setVisibleCols(all);
                      try { localStorage.setItem("dossiers_cols", JSON.stringify([...all])); } catch {}
                    }}
                    style={{ fontSize: 12, color: "#4F46E5", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Tout afficher
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC" }}>
              <th style={thStyle}>N° Dossier</th>
              {visibleCols.has("petitionnaire") && <th style={thStyle}>Pétitionnaire</th>}
              {visibleCols.has("adresse") && <th style={thStyle}>Adresse</th>}
              {visibleCols.has("type") && <th style={thStyle}>Type de dossier</th>}
              {visibleCols.has("statut") && <th style={thStyle}>Statut</th>}
              {visibleCols.has("date_depot") && <th style={thStyle}>Date de dépôt</th>}
              {visibleCols.has("echeance") && <th style={thStyle}>Date d'échéance</th>}
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colSpan} style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Chargement…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={colSpan} style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Aucun dossier trouvé</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #F1F5F9", cursor: "pointer" }}
                onClick={() => onDossierClick({ id: r.id, numero: r.numero, type: r.type, petitionnaire: r.pet, adresse: r.addr, status: r.statusRaw, echeance: r.ech, date_depot: r.dateDepot })}
                onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                onMouseLeave={e => (e.currentTarget.style.background = "white")}>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "#4F46E5" }}>{r.numero}</td>
                {visibleCols.has("petitionnaire") && <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.pet}</td>}
                {visibleCols.has("adresse") && <td style={{ padding: "12px 16px", fontSize: 13, color: "#64748b", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.addr}</td>}
                {visibleCols.has("type") && <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.type}</td>}
                {visibleCols.has("statut") && <td style={{ padding: "12px 16px" }}><StatusBadge status={r.statusRaw} /></td>}
                {visibleCols.has("date_depot") && <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.dateDepot || <span style={{ color: "#CBD5E1" }}>—</span>}</td>}
                {visibleCols.has("echeance") && (
                  <td style={{ padding: "12px 16px", fontSize: 13 }}>
                    {r.ech
                      ? (() => {
                          const isOverdue = r.ech !== "—" && new Date(apiDossiers.find(d => d.id === r.id)?.date_limite_instruction ?? "") < new Date();
                          return <span style={{ color: isOverdue ? "#EF4444" : "#374151", fontWeight: isOverdue ? 600 : 400 }}>{r.ech}{isOverdue ? " ⚠" : ""}</span>;
                        })()
                      : <span style={{ color: "#CBD5E1" }}>—</span>
                    }
                  </td>
                )}
                <td style={{ padding: "12px 16px" }}>
                  <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", padding: 4 }} onClick={e => e.stopPropagation()}><DotsIcon /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #F1F5F9" }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>{rows.length} dossier{rows.length !== 1 ? "s" : ""} affiché{rows.length !== 1 ? "s" : ""}</span>
          <div style={{ flex: 1 }} />
          <select style={{ border: "1px solid #E2E8F0", borderRadius: 6, padding: "4px 8px", fontSize: 12 }}>
            <option>Tous les dossiers par page</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function communeCode(c: string): string {
  const l = c.toLowerCase();
  if (l.includes("ballan")) return "BM";
  if (l.includes("joué") || l.includes("joue")) return "JT";
  if (l.includes("tours")) return "TR";
  if (l.includes("avertin")) return "SA";
  if (l.includes("riche")) return "LR";
  return c.replace(/\s+/g, "").slice(0, 3).toUpperCase();
}

// Numéros de dossiers existants dans la DB par commune, à utiliser dans les consultations services
const COMMUNE_DOSSIERS: Record<string, { d1: string; d2: string; d3: string; d4: string; d5: string }> = {
  "Ballan-Miré":    { d1: "PC-BM-2024-001", d2: "PC-BM-2024-022", d3: "PC-BM-2024-001", d4: "DP-BM-2024-015", d5: "DP-BM-2024-008" },
  "Tours":          { d1: "PC-2024-001",     d2: "PC-TR-2024-004", d3: "PC-TR-2024-011", d4: "DP-2024-042",     d5: "DP-TR-2024-007" },
  "Saint-Avertin":  { d1: "PC-SA-2024-001",  d2: "PC-SA-2024-009", d3: "PC-SA-2024-001", d4: "PC-SA-2024-009",  d5: "DP-SA-2024-005" },
  "Joué-lès-Tours": { d1: "PC-JT-2024-003",  d2: "PC-JT-2024-018", d3: "PC-JT-2024-031", d4: "PC-JT-2024-018",  d5: "DP-JT-2024-011" },
  "La Riche":       { d1: "PC-LR-2024-002",  d2: "PC-LR-2024-027", d3: "PC-LR-2024-002", d4: "PC-LR-2024-027",  d5: "PC-LR-2024-014" },
};

function MessageScreen({ commune, onDossierClick, onUnreadChange }: { commune: string; onDossierClick: (d: DossierInfo) => void; onUnreadChange?: (n: number) => void }) {
  type Conv = { dossier_id: string; numero: string; type: string; status: string; petitionnaire: string; last_content: string; last_from_role: string; last_at: string; unread_count: number };
  type Msg = { id: string; content: string; from_role: string; created_at: string; prenom: string | null; nom: string | null };
  type ServiceConv = { name: string; dossier: string; preview: string; time: string; badge?: number; initials: string; color: string; thread: { role: string; text: string; time: string }[] };

  const [tab, setTab] = useState("Citoyens");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceConv | null>(null);
  const svcUnreadKey = `heureka_svcUnread_${commune}`;
  const loadSvcUnread = (key: string) => {
    try { const s = localStorage.getItem(key); if (s !== null) return new Set<string>(JSON.parse(s)); } catch {}
    return new Set<string>(["ABF – Architecte des Bâtiments de France"]);
  };
  const saveSvcUnread = (key: string, names: Set<string>) => {
    try { localStorage.setItem(key, JSON.stringify([...names])); } catch {}
  };
  const [serviceUnreadNames, setServiceUnreadNames] = useState<Set<string>>(() => loadSvcUnread(svcUnreadKey));
  const [thread, setThread] = useState<Msg[]>([]);

  const refreshConvs = () =>
    api.get<Conv[]>(`/mairie/conversations?commune=${encodeURIComponent(commune)}`).then(data => setConvs(data)).catch(() => {});

  // Badge sidebar = citoyens non lus + services non lus (réactif)
  useEffect(() => {
    const citizenCount = convs.reduce((s, c) => s + c.unread_count, 0);
    onUnreadChange?.(citizenCount + serviceUnreadNames.size);
  }, [convs, serviceUnreadNames]);

  useEffect(() => {
    setSelected(null);
    setSelectedService(null);
    setServiceUnreadNames(loadSvcUnread(`heureka_svcUnread_${commune}`));
    api.get<Conv[]>(`/mairie/conversations?commune=${encodeURIComponent(commune)}`).then(data => {
      setConvs(data);
    }).catch(() => {});
  }, [commune]);

  // Quand on sélectionne une conversation, charger le thread et marquer comme lu
  useEffect(() => {
    if (!selected) return;
    api.get<Msg[]>(`/mairie/conversations/${selected.dossier_id}`).then(setThread).catch(() => {});
    api.post(`/mairie/conversations/${selected.dossier_id}/read`)
      .then(() => {
        setConvs(prev => prev.map(c =>
          c.dossier_id === selected.dossier_id ? { ...c, unread_count: 0 } : c
        ));
        setSelected(prev => prev ? { ...prev, unread_count: 0 } : prev);
      })
      .catch(() => {});
  }, [selected?.dossier_id]);

  const markUnread = () => {
    if (!selected) return;
    api.post(`/mairie/conversations/${selected.dossier_id}/unread`)
      .then(() => {
        setConvs(prev => prev.map(c =>
          c.dossier_id === selected.dossier_id ? { ...c, unread_count: 1 } : c
        ));
        setSelected(prev => prev ? { ...prev, unread_count: 1 } : prev);
      })
      .catch(() => {});
  };

  const dos = COMMUNE_DOSSIERS[commune] ?? { d1: `PC-${communeCode(commune)}-2024-001`, d2: `PC-${communeCode(commune)}-2024-022`, d3: `PC-${communeCode(commune)}-2024-001`, d4: `DP-${communeCode(commune)}-2024-015`, d5: `DP-${communeCode(commune)}-2024-008` };
  const serviceConvs: ServiceConv[] = [
    { name: "ABF – Architecte des Bâtiments de France", dossier: dos.d1, preview: "Avis favorable avec réserves transmis.", time: "20/05", initials: "AB", color: "#8B5CF6",
      thread: [
        { role: "service", text: `Bonjour, nous avons bien reçu la demande de consultation pour le dossier ${dos.d1}. Nous procédons à son examen.`, time: "09:00" },
        { role: "mairie", text: "Merci. Pouvez-vous nous indiquer un délai de réponse approximatif ?", time: "10:15" },
        { role: "service", text: "Avis favorable avec réserves transmis. Le pétitionnaire devra respecter les prescriptions architecturales jointes.", time: "10:30" },
      ]},
    { name: "SDIS – Service Incendie", dossier: dos.d2, preview: "Consultation en cours d'examen.", time: "19/05", initials: "SD", color: "#EF4444",
      thread: [
        { role: "mairie", text: `Bonjour, nous vous adressons la consultation pour le dossier ${dos.d2}. Merci de nous faire parvenir votre avis de sécurité incendie.`, time: "08:30" },
        { role: "service", text: "Consultation bien reçue. L'examen est en cours. Délai de réponse : 15 jours ouvrés.", time: "14:00" },
      ]},
    { name: "Métropole Tours Val de Loire", dossier: dos.d3, preview: "Retour attendu avant le 25/05.", time: "18/05", initials: "MT", color: "#F97316",
      thread: [
        { role: "mairie", text: `Consultation PLUi — dossier ${dos.d3}. Merci de vérifier la conformité avec le règlement de zone UA.`, time: "09:00" },
        { role: "service", text: "Pris en compte. Retour attendu avant le 25/05.", time: "11:30" },
      ]},
    { name: "DREAL Centre-Val de Loire", dossier: dos.d4, preview: "Documents bien reçus, analyse en cours.", time: "16/05", initials: "DR", color: "#22C55E",
      thread: [
        { role: "mairie", text: `Transmission des pièces pour ${dos.d4}. Merci d'évaluer l'impact sur l'environnement et les zones sensibles.`, time: "10:00" },
        { role: "service", text: "Documents bien reçus, analyse en cours. Nous reviendrons vers vous sous 10 jours.", time: "15:45" },
      ]},
    { name: "Service des Eaux – Grand Cycle", dossier: dos.d5, preview: "Avis favorable émis.", time: "13/05", initials: "SE", color: "#3B82F6",
      thread: [
        { role: "mairie", text: `Consultation pour ${dos.d5} — projet avec création ou modification d'imperméabilisation. Merci de valider la gestion des eaux pluviales.`, time: "09:00" },
        { role: "service", text: "Avis favorable émis sous réserve de la mise en place d'un dispositif de rétention conforme à la notice jointe.", time: "16:00" },
      ]},
  ];

  const totalCitizenUnread = convs.reduce((s, c) => s + c.unread_count, 0);
  const totalServiceUnread = serviceUnreadNames.size;

  return (
    <div style={{ padding: 0, display: "flex", height: "calc(100vh - 56px)" }}>
      {/* ── Liste conversations ── */}
      <div style={{ width: 320, borderRight: "1px solid #E2E8F0", display: "flex", flexDirection: "column", background: "white" }}>
        <div style={{ padding: "20px 16px 0" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Messagerie</h1>
          <p style={{ color: "#94A3B8", fontSize: 12, marginBottom: 12 }}>Échangez avec les pétitionnaires et les services consultés.</p>
          <div style={{ display: "flex", gap: 0, marginBottom: 12 }}>
            {([
              { key: "Citoyens", label: "Citoyens", count: totalCitizenUnread },
              { key: "Services", label: "Services / Consultations", count: totalServiceUnread },
            ] as { key: string; label: string; count: number }[]).map(({ key, label, count }) => (
              <button key={key} onClick={() => setTab(key)} style={{ flex: 1, border: "none", background: "none", padding: "7px 6px", fontSize: 12, fontWeight: tab === key ? 600 : 400, color: tab === key ? "#4F46E5" : "#64748b", borderBottom: tab === key ? "2px solid #4F46E5" : "2px solid #E2E8F0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, whiteSpace: "nowrap" }}>
                {label}
                {count > 0 && (
                  <span style={{ background: tab === key ? "#4F46E5" : "#E2E8F0", color: tab === key ? "white" : "#64748b", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700, minWidth: 16, textAlign: "center" }}>{count}</span>
                )}
              </button>
            ))}
          </div>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input placeholder="Rechercher une conversation" style={{ width: "100%", padding: "7px 12px 7px 28px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, outline: "none" }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {tab === "Citoyens" ? convs.map((c) => {
            const isActive = selected?.dossier_id === c.dossier_id && !selectedService;
            const color = stringToColor(c.petitionnaire);
            return (
              <div key={c.dossier_id} onClick={() => { setSelected(c); setSelectedService(null); }} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #F8FAFC", background: isActive ? "#F0F4FF" : "white" }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#F8FAFC"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "white"; }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: color, color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials(c.petitionnaire)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{c.petitionnaire}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{fmtConvTime(c.last_at)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{c.numero}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.last_content}</div>
                  </div>
                  {c.unread_count > 0 && <span style={{ background: "#4F46E5", color: "white", borderRadius: "50%", width: 18, height: 18, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{c.unread_count}</span>}
                </div>
              </div>
            );
          }) : serviceConvs.map((c, i) => {
            const isActive = selectedService?.name === c.name;
            const isUnread = serviceUnreadNames.has(c.name);
            return (
            <div key={i} onClick={() => {
              setSelectedService(c);
              setSelected(null);
              setServiceUnreadNames(prev => { const next = new Set(prev); next.delete(c.name); saveSvcUnread(svcUnreadKey, next); return next; });
            }} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #F8FAFC", background: isActive ? "#F0F4FF" : "white" }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#F8FAFC"; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "white"; }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: c.color, color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{c.initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{c.name}</span>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>{c.time}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{c.dossier}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.preview}</div>
                </div>
                {isUnread && <span style={{ background: "#4F46E5", color: "white", borderRadius: "50%", width: 18, height: 18, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</span>}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* ── Thread ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#FAFBFD" }}>
        {selectedService ? (<>
          {/* Service thread */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: selectedService.color, color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{selectedService.initials}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{selectedService.name}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>Consultation — {selectedService.dossier}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => setServiceUnreadNames(prev => { const next = new Set(prev).add(selectedService.name); saveSvcUnread(svcUnreadKey, next); return next; })}
                title="Marquer comme non lu"
                style={{ padding: "6px 12px", background: "white", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                Non lu
              </button>
              <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}><DotsIcon /></button>
            </div>
          </div>
          <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
            {selectedService.thread.map((msg, i) => {
              const isMairie = msg.role === "mairie";
              return (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 16, justifyContent: isMairie ? "flex-end" : "flex-start" }}>
                  {!isMairie && <div style={{ width: 32, height: 32, borderRadius: "50%", background: selectedService.color, color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{selectedService.initials}</div>}
                  <div style={{ maxWidth: "60%" }}>
                    {isMairie ? (
                      <div style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", borderRadius: "12px 4px 12px 12px", padding: "12px 14px" }}>
                        <p style={{ margin: 0, fontSize: 13, color: "white", lineHeight: 1.5 }}>{msg.text}</p>
                      </div>
                    ) : (
                      <div style={{ background: "white", borderRadius: "4px 12px 12px 12px", padding: "12px 14px", border: "1px solid #E2E8F0", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                        <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{msg.text}</p>
                      </div>
                    )}
                    <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, display: "block", textAlign: isMairie ? "right" : "left" }}>{msg.time}</span>
                  </div>
                  {isMairie && <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>ML</div>}
                </div>
              );
            })}
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", gap: 10 }}>
            <input placeholder="Écrire un message..." style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 8, padding: "9px 14px", fontSize: 13, outline: "none" }} />
            <button style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #4F46E5, #6366F1)", border: "none", cursor: "pointer", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}><SendIcon size={14} /></button>
          </div>
        </>) : selected ? (<>
          {/* Citizen thread */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{selected.petitionnaire}</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>{selected.numero} – {TYPE_LABEL[selected.type] ?? selected.type}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => onDossierClick({ id: selected.dossier_id, numero: selected.numero, type: selected.type, petitionnaire: selected.petitionnaire, adresse: "—", status: selected.status, echeance: "—" })} style={{ padding: "6px 12px", background: "white", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, color: "#374151", cursor: "pointer" }}>Voir le dossier ↗</button>
              <button
                onClick={markUnread}
                title="Marquer comme non lu"
                style={{ padding: "6px 12px", background: "white", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                Non lu
              </button>
              <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}><DotsIcon /></button>
            </div>
          </div>
          <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
            {thread.map((msg) => {
              const isInstructeur = msg.from_role !== "citoyen";
              const senderName = [msg.prenom, msg.nom].filter(Boolean).join(" ") || (isInstructeur ? "Instructeur" : selected.petitionnaire);
              const time = new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
              return (
                <div key={msg.id} style={{ display: "flex", gap: 10, marginBottom: 16, justifyContent: isInstructeur ? "flex-end" : "flex-start" }}>
                  {!isInstructeur && <div style={{ width: 32, height: 32, borderRadius: "50%", background: stringToColor(selected.petitionnaire), color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials(selected.petitionnaire)}</div>}
                  <div style={{ maxWidth: "60%" }}>
                    {isInstructeur ? (
                      <div style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", borderRadius: "12px 4px 12px 12px", padding: "12px 14px" }}>
                        <p style={{ margin: 0, fontSize: 13, color: "white", lineHeight: 1.5 }}>{msg.content}</p>
                      </div>
                    ) : (
                      <div style={{ background: "white", borderRadius: "4px 12px 12px 12px", padding: "12px 14px", border: "1px solid #E2E8F0", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                        <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{msg.content}</p>
                      </div>
                    )}
                    <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, display: "block", textAlign: isInstructeur ? "right" : "left" }}>{time}</span>
                  </div>
                  {isInstructeur && <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials(senderName)}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", gap: 10 }}>
            <input placeholder="Écrire un message..." style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 8, padding: "9px 14px", fontSize: 13, outline: "none" }} />
            <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18 }}>📎</button>
            <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18 }}>😊</button>
            <button style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #4F46E5, #6366F1)", border: "none", cursor: "pointer", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}><SendIcon size={14} /></button>
          </div>
        </>) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>Sélectionnez une conversation</div>
        )}
      </div>

      {/* ── Panneau info ── */}
      <div style={{ width: 260, borderLeft: "1px solid #E2E8F0", background: "white", padding: 16, overflowY: "auto" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Informations</div>
        {selectedService ? (<>
          <div style={{ marginBottom: 4, fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Service consulté</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: selectedService.color, color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{selectedService.initials}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", lineHeight: 1.3 }}>{selectedService.name}</div>
          </div>
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Dossier lié</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4 }}>{selectedService.dossier}</div>
          </div>
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Dernier message</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{selectedService.preview}</div>
          </div>
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Statut consultation</div>
            <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 12, background: "#EEF2FF", color: "#4F46E5", fontSize: 11, fontWeight: 600 }}>En cours</span>
          </div>
        </>) : selected ? (<>
          <div style={{ marginBottom: 4, fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pétitionnaire</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 12 }}>{selected.petitionnaire}</div>
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Dossier</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4 }}>{selected.numero}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{TYPE_LABEL[selected.type] ?? selected.type}</div>
            <StatusBadge status={STATUS_LABEL[selected.status] ?? selected.status} />
          </div>
        </>) : <div style={{ fontSize: 12, color: "#94a3b8" }}>Aucune conversation sélectionnée</div>}
      </div>
    </div>
  );
}

function IngestPluSection() {
  const [communeName, setCommuneName] = useState("");
  const [inseeCode, setInseeCode] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; commune: string; zones: number; rules: number; needs_review: number; detail: Array<{ zone: string; rules: number; vision: number }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!communeName.trim() || !inseeCode.trim() || !pdfFile) {
      setError("Tous les champs sont requis.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setStep("Lecture du PDF…");
    try {
      const buf = await pdfFile.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const pdf_base64 = btoa(binary);

      setStep("Analyse des zones par IA (peut prendre 30-60s)…");
      const r = await api.post<{ ok: boolean; commune: string; zones: number; rules: number; needs_review: number; detail: Array<{ zone: string; rules: number; vision: number }> }>(
        "/mairie/admin/ingest-plu-pdf",
        { commune_name: communeName.trim(), insee_code: inseeCode.trim(), zip_code: zipCode.trim() || undefined, pdf_base64 },
      );
      setResult(r);
      setStep(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur serveur");
      setStep(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Ajouter une nouvelle commune</div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
        Importez le règlement PLU (PDF) d'une commune. L'IA extrait les zones et règles automatiquement.
        Les règles sont stockées en statut <strong>brouillon</strong> — elles nécessitent une validation humaine avant d'être utilisées.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 2 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Nom de la commune *</div>
            <input
              value={communeName}
              onChange={e => setCommuneName(e.target.value)}
              placeholder="ex : Rochecorbon"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Code INSEE *</div>
            <input
              value={inseeCode}
              onChange={e => setInseeCode(e.target.value)}
              placeholder="ex : 37194"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Code postal</div>
            <input
              value={zipCode}
              onChange={e => setZipCode(e.target.value)}
              placeholder="ex : 37210"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Règlement PLU (PDF) *</div>
          <div
            onClick={() => fileRef.current?.click()}
            style={{ border: "2px dashed #CBD5E1", borderRadius: 10, padding: "20px 16px", textAlign: "center", cursor: "pointer", background: pdfFile ? "#F0FDF4" : "#F8FAFC", transition: "background 0.15s" }}
          >
            {pdfFile ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>{pdfFile.name}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{(pdfFile.size / 1024 / 1024).toFixed(1)} Mo — cliquez pour changer</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: "#64748b" }}>Cliquez pour sélectionner un PDF</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Règlement PLU uniquement (pas le RI) — max ~35 Mo</div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => { setPdfFile(e.target.files?.[0] ?? null); setResult(null); setError(null); }} />
          </div>
        </div>
        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#DC2626" }}>{error}</div>
        )}
        {step && (
          <div style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#4F46E5", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 14, height: 14, border: "2px solid #4F46E5", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
            {step}
          </div>
        )}
        {result && (
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginBottom: 8 }}>
              Ingestion terminée — {result.commune}
            </div>
            <div style={{ fontSize: 13, color: "#15803d", marginBottom: 10 }}>
              {result.zones} zone{result.zones > 1 ? "s" : ""} · {result.rules} règle{result.rules > 1 ? "s" : ""} extraites
              {result.needs_review > 0 && ` · ${result.needs_review} à vérifier (schéma)`}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {result.detail.map(d => (
                <span key={d.zone} style={{ background: "#DCFCE7", color: "#166534", borderRadius: 6, padding: "3px 8px", fontSize: 12, fontWeight: 600 }}>
                  {d.zone} ({d.rules}){d.vision > 0 ? " ⚠" : ""}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 10 }}>
              Statut : brouillon — rendez-vous dans l'onglet Réglementation pour valider les règles.
            </div>
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading || !communeName || !inseeCode || !pdfFile}
          style={{ alignSelf: "flex-start", background: loading ? "#A5B4FC" : "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}
        >
          {loading ? "Traitement en cours…" : "Lancer l'ingestion"}
        </button>
      </div>
    </div>
  );
}

type CommuneData = {
  id: string; name: string; insee_code: string; zip_code: string | null;
  email: string | null; telephone: string | null; logo_url: string | null;
  population: string | null; surface: string | null;
  departement: string | null; region: string | null; description: string | null;
};

type StaffUser = {
  id: string; email: string; prenom: string; nom: string;
  role: string; commune: string | null; telephone: string | null; created_at: string;
  role_config_id: string | null;
};

type RoleConfig = {
  id: string; label: string; base_role: string; color: string; permissions: string[];
};

type InseeCandidate = { nom: string; insee: string; zip: string | null; departement: string | null; region: string | null };

function CommuneGeneralTab({ commune, isAdmin, onInseeUpdated }: { commune: string; isAdmin: boolean; onInseeUpdated?: () => void }) {
  const [data, setData] = useState<CommuneData | null>(null);
  const [form, setForm] = useState<Partial<CommuneData>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [inseeSearch, setInseeSearch] = useState("");
  const [inseeCandidates, setInseeCandidates] = useState<InseeCandidate[]>([]);
  const [inseeSearching, setInseeSearching] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get<CommuneData>(`/mairie/admin/commune-details?commune=${encodeURIComponent(commune)}`)
      .then(d => { setData(d); setForm(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [commune]);

  const searchInsee = async () => {
    if (inseeSearch.length < 2) return;
    setInseeSearching(true);
    try {
      const results = await api.get<InseeCandidate[]>(`/mairie/admin/insee-lookup?nom=${encodeURIComponent(inseeSearch)}`);
      setInseeCandidates(results);
    } catch { /* ignore */ }
    finally { setInseeSearching(false); }
  };

  const applyCandidate = (c: InseeCandidate) => {
    setForm(f => ({ ...f, insee_code: c.insee, zip_code: c.zip ?? f.zip_code, departement: c.departement ?? f.departement, region: c.region ?? f.region }));
    setInseeCandidates([]);
    setInseeSearch("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.patch<CommuneData>(`/mairie/admin/commune-details?commune=${encodeURIComponent(commune)}`, form);
      setData(updated); setForm(updated); setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onInseeUpdated?.();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>;

  const validateInp = (type: string, val: string): "valid" | "invalid" | null => {
    if (!val) return null;
    if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val) ? "valid" : "invalid";
    if (type === "tel") return /^(0[1-9]\d{8}|(\+33|0033)[1-9]\d{8})$/.test(val.replace(/[\s.()-]/g, "")) ? "valid" : "invalid";
    return null;
  };
  const formatTelInp = (raw: string) => {
    const d = raw.replace(/[^\d+]/g, "");
    if (d.startsWith("0") && d.length <= 10) return d.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
    return raw;
  };

  const inp = (label: string, field: keyof CommuneData, readOnly = false, type = "text") => {
    const raw = (form[field] as string) ?? "";
    const val = type === "tel" ? formatTelInp(raw) : raw;
    const editable = isAdmin && !readOnly;
    const status = editable ? validateInp(type, val) : null;
    const borderColor = status === "valid" ? "#10B981" : status === "invalid" ? "#EF4444" : "#E2E8F0";
    return (
      <div key={field}>
        <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
        <div style={{ position: "relative" as const }}>
          <input
            type={type === "tel" ? "tel" : type}
            value={val}
            onChange={e => editable && setForm(f => ({ ...f, [field]: type === "tel" ? formatTelInp(e.target.value) : e.target.value }))}
            readOnly={!editable}
            placeholder={type === "email" ? "mairie@commune.fr" : type === "tel" ? "06 12 34 56 78" : undefined}
            style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 12px", paddingRight: status ? 28 : 12, border: `1px solid ${borderColor}`, borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", background: !editable ? "#F8FAFC" : "white", cursor: !editable ? "default" : "text", transition: "border-color 0.15s" }}
            onFocus={e => { if (editable) e.target.style.borderColor = status === "invalid" ? "#EF4444" : "#4F46E5"; }}
            onBlur={e => { e.target.style.borderColor = borderColor; }}
          />
          {status && (
            <span style={{ position: "absolute" as const, right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: status === "valid" ? "#10B981" : "#EF4444", pointerEvents: "none" as const }}>
              {status === "valid" ? "✓" : "✕"}
            </span>
          )}
        </div>
        {status === "invalid" && (
          <div style={{ fontSize: 11, color: "#EF4444", marginTop: 3 }}>
            {type === "email" ? "Format invalide — ex : mairie@commune.fr" : "Format invalide — ex : 06 12 34 56 78"}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20, display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ width: 80, height: 80, borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden", flexShrink: 0, background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {form.logo_url
            ? <img src={form.logo_url} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            : <span style={{ fontSize: 28, color: "#CBD5E1" }}>🏛</span>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Logo de la commune</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>URL d'un fichier PNG ou SVG (logo officiel de la commune).</div>
          {isAdmin && (
            <input
              value={form.logo_url ?? ""}
              onChange={e => setForm(f => ({ ...f, logo_url: e.target.value }))}
              placeholder="https://..."
              style={{ width: "100%", boxSizing: "border-box" as const, padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, color: "#374151", outline: "none" }}
            />
          )}
        </div>
      </div>
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Informations générales</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {inp("Nom de la commune", "name", true)}
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Code INSEE</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={(form.insee_code as string) ?? ""}
                readOnly
                style={{ flex: 1, padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", background: "#F8FAFC" }}
              />
              {isAdmin && (
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input
                      value={inseeSearch}
                      onChange={e => setInseeSearch(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && searchInsee()}
                      placeholder="Chercher…"
                      style={{ width: 120, padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, outline: "none" }}
                    />
                    <button onClick={searchInsee} disabled={inseeSearching} style={{ padding: "8px 12px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {inseeSearching ? "…" : "Trouver"}
                    </button>
                  </div>
                  {inseeCandidates.length > 0 && (
                    <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 50, background: "white", border: "1px solid #E2E8F0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 280, marginTop: 4 }}>
                      {inseeCandidates.map(c => (
                        <div key={c.insee} onClick={() => applyCandidate(c)}
                          style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #F8FAFC" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                          onMouseLeave={e => (e.currentTarget.style.background = "white")}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{c.nom}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>INSEE {c.insee} · {c.zip ?? "—"} · {c.departement ?? "—"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {inp("Département", "departement")}
          {inp("Région", "region")}
          {inp("Code postal", "zip_code")}
          {inp("Population", "population")}
          {inp("Surface", "surface")}
          {inp("Email contact urbanisme", "email", false, "email")}
          {inp("Téléphone", "telephone", false, "tel")}
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Description / Contexte</div>
          <textarea
            value={(form.description as string) ?? ""}
            onChange={e => isAdmin && setForm(f => ({ ...f, description: e.target.value }))}
            readOnly={!isAdmin}
            rows={3}
            style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", resize: "vertical", background: !isAdmin ? "#F8FAFC" : "white" }}
          />
        </div>
        {!isAdmin && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 8, fontSize: 12, color: "#92400E" }}>
            Seuls les administrateurs peuvent modifier les informations de la commune.
          </div>
        )}
        {isAdmin && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20, gap: 8, alignItems: "center" }}>
            {saved && <span style={{ fontSize: 12, color: "#22C55E", fontWeight: 600 }}>Enregistré ✓</span>}
            <button onClick={() => setForm(data ?? {})} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
            <button onClick={save} disabled={saving} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CommuneUsersTab({ commune, isAdmin, currentUserId }: { commune: string; isAdmin: boolean; currentUserId?: string }) {
  const [userList, setUserList] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ prenom: "", nom: "", email: "", role: "instructeur", telephone: "", role_config_id: "" });
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addedPw, setAddedPw] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRoleConfigId, setEditRoleConfigId] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [roleConfigs, setRoleConfigs] = useState<RoleConfig[]>([]);
  const [communeSigs, setCommuneSigs] = useState<{ id: string; user_id: string; role: string; delegation_arrete: string | null }[]>([]);
  const [sigModal, setSigModal] = useState<{ userId: string; name: string } | null>(null);
  const [sigRole, setSigRole] = useState("maire");
  const [sigDelegation, setSigDelegation] = useState("");
  const [sigSaving, setSigSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get<StaffUser[]>(`/mairie/admin/users?commune=${encodeURIComponent(commune)}`)
      .then(setUserList)
      .catch(() => setUserList([]))
      .finally(() => setLoading(false));
  };
  const loadSigs = () => {
    api.get<{ id: string; user_id: string; role: string; delegation_arrete: string | null }[]>(
      `/decisions/communes/${encodeURIComponent(commune)}/signataires`
    ).then(setCommuneSigs).catch(() => {});
  };
  useEffect(() => { load(); loadSigs(); }, [commune]);

  useEffect(() => {
    api.get<RoleConfig[]>("/admin/roles").then(setRoleConfigs).catch(() => {});
  }, []);

  const filtered = userList.filter(u => `${u.prenom} ${u.nom} ${u.email}`.toLowerCase().includes(search.toLowerCase()));

  const addUser = async () => {
    setAddError("");
    if (!addForm.prenom || !addForm.nom || !addForm.email) { setAddError("Prénom, nom et email sont requis."); return; }
    if (!addForm.role_config_id && !addForm.role) { setAddError("Sélectionnez un rôle."); return; }
    setAddLoading(true);
    try {
      const selectedConfig = roleConfigs.find(rc => rc.id === addForm.role_config_id);
      const role = selectedConfig ? selectedConfig.base_role : addForm.role;
      await api.post(`/mairie/admin/users?commune=${encodeURIComponent(commune)}`, {
        prenom: addForm.prenom,
        nom: addForm.nom,
        email: addForm.email,
        telephone: addForm.telephone,
        role,
        role_config_id: addForm.role_config_id || null,
      });
      setAddedPw("invitation_sent");
      load();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Erreur lors de la création.");
    } finally { setAddLoading(false); }
  };

  const saveRole = async (id: string) => {
    const selectedConfig = roleConfigs.find(rc => rc.id === editRoleConfigId);
    const role = selectedConfig ? selectedConfig.base_role : "instructeur";
    await api.patch(`/mairie/admin/users/${id}`, { role, role_config_id: editRoleConfigId || null });
    setEditingId(null);
    load();
  };

  const deleteUser = async (id: string) => {
    await api.delete(`/mairie/admin/users/${id}`);
    setDeleteId(null);
    load();
  };

  const ROLE_LABELS: Record<string, string> = { admin: "Admin", mairie: "Mairie", instructeur: "Instructeur" };
  const ROLE_COLORS: Record<string, string> = { admin: "#DC2626", mairie: "#4F46E5", instructeur: "#0891B2" };

  const getUserRoleLabel = (u: StaffUser) => {
    if (u.role_config_id) {
      const config = roleConfigs.find(rc => rc.id === u.role_config_id);
      if (config) return config.label;
    }
    return ROLE_LABELS[u.role] ?? u.role;
  };

  const getUserRoleColor = (u: StaffUser) => {
    if (u.role_config_id) {
      const config = roleConfigs.find(rc => rc.id === u.role_config_id);
      if (config) return config.color;
    }
    return ROLE_COLORS[u.role] ?? "#94a3b8";
  };

  const initials = (u: StaffUser) => `${u.prenom[0] ?? ""}${u.nom[0] ?? ""}`.toUpperCase();
  const getSig = (userId: string) => communeSigs.find(s => s.user_id === userId);
  const SIG_ROLES = [
    { key: "maire", label: "Maire" },
    { key: "adjoint", label: "Adjoint au Maire" },
    { key: "dgs", label: "Dir. Général des Services" },
    { key: "responsable_ads", label: "Responsable ADS" },
    { key: "directeur", label: "Directeur de service" },
  ];
  const SIG_LABELS: Record<string, string> = Object.fromEntries(SIG_ROLES.map(r => [r.key, r.label]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {[
          ["Agents", String(userList.length), "#4F46E5"],
          ["Instructeurs", String(userList.filter(u => u.role === "instructeur").length), "#0891B2"],
          ["Admins", String(userList.filter(u => u.role === "admin").length), "#DC2626"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</span>
            <span style={{ fontSize: 12, color: "#64748b" }}>{l}</span>
          </div>
        ))}
      </div>
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un utilisateur…"
          style={{ flex: 1, padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
        {isAdmin && (
          <button onClick={() => { setShowAddModal(true); setAddedPw(""); setAddError(""); setAddForm({ prenom: "", nom: "", email: "", role: "instructeur", telephone: "", role_config_id: "" }); }}
            style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            + Ajouter un agent
          </button>
        )}
      </div>
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC" }}>
              {["Agent", "Email", "Rôle", "Téléphone", ...(isAdmin ? ["Actions"] : [])].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isAdmin ? 5 : 4} style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Chargement…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={isAdmin ? 5 : 4} style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Aucun utilisateur trouvé.</td></tr>
            ) : filtered.map(u => (
              <tr key={u.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials(u)}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{u.prenom} {u.nom}</div>
                      {u.id === currentUserId && <span style={{ fontSize: 10, background: "#EEF2FF", color: "#4F46E5", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>Vous</span>}
                    </div>
                  </div>
                </td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: "#64748b" }}>{u.email}</td>
                <td style={{ padding: "12px 16px" }}>
                  {isAdmin && editingId === u.id ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <select value={editRoleConfigId} onChange={e => setEditRoleConfigId(e.target.value)}
                        style={{ padding: "4px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12, maxWidth: 160 }}>
                        <option value="">— Sélectionner —</option>
                        {roleConfigs.map(rc => <option key={rc.id} value={rc.id}>{rc.label}</option>)}
                      </select>
                      <button onClick={() => saveRole(u.id)} style={{ padding: "4px 8px", background: "#4F46E5", color: "white", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✓</button>
                      <button onClick={() => setEditingId(null)} style={{ padding: "4px 8px", background: "#F1F5F9", color: "#64748b", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4, alignItems: "center" }}>
                      <span style={{ background: `${getUserRoleColor(u)}18`, color: getUserRoleColor(u), fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 8px", border: `1px solid ${getUserRoleColor(u)}33` }}>{getUserRoleLabel(u)}</span>
                      {getSig(u.id) && (
                        <span style={{ background: "#FEF9C3", color: "#92400E", fontSize: 10, fontWeight: 600, borderRadius: 5, padding: "2px 6px", border: "1px solid #FDE68A" }}>
                          ✍️ {SIG_LABELS[getSig(u.id)!.role] ?? getSig(u.id)!.role}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: "#64748b" }}>{u.telephone ?? "—"}</td>
                {isAdmin && (
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => { setEditingId(u.id); setEditRoleConfigId(u.role_config_id ?? ""); }}
                        style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#4F46E5", cursor: "pointer" }}>Rôle</button>
                      <button onClick={() => { const s = getSig(u.id); setSigModal({ userId: u.id, name: `${u.prenom} ${u.nom}` }); setSigRole(s?.role ?? "maire"); setSigDelegation(s?.delegation_arrete ?? ""); }}
                        title="Habilitation signature ADS"
                        style={{ border: `1px solid ${getSig(u.id) ? "#FDE68A" : "#E2E8F0"}`, background: getSig(u.id) ? "#FEF9C3" : "white", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: getSig(u.id) ? "#92400E" : "#64748b", cursor: "pointer" }}>✍️</button>
                      {u.id !== currentUserId && (
                        <button onClick={() => setDeleteId(u.id)}
                          style={{ border: "1px solid #FEE2E2", background: "#FFF5F5", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#EF4444", cursor: "pointer" }}>Retirer</button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "white", borderRadius: 16, padding: 28, width: 480, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
            {addedPw ? (
              <>
                <div style={{ fontSize: 36, textAlign: "center", marginBottom: 12 }}>✉️</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 8, textAlign: "center" }}>Invitation envoyée !</div>
                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: 16, marginBottom: 20, fontSize: 13, color: "#166534", lineHeight: 1.6 }}>
                  Un email d'invitation a été envoyé à <strong>{addForm.email}</strong>.<br />
                  L'agent recevra un lien pour définir son mot de passe, valable <strong>7 jours</strong>.
                </div>
                <button onClick={() => setShowAddModal(false)} style={{ width: "100%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Fermer</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Ajouter un agent</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Un email d'invitation sera envoyé à l'agent pour qu'il définisse son propre mot de passe.</div>
                {addError && <div style={{ background: "#FFF5F5", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#DC2626", marginBottom: 14 }}>{addError}</div>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  {[["Prénom", "prenom"], ["Nom", "nom"]].map(([l, k]) => (
                    <div key={k ?? ""}>
                      <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>{l}</div>
                      <input value={(addForm as Record<string, string>)[k ?? ""] ?? ""} onChange={e => setAddForm(f => ({ ...f, [k ?? ""]: e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Email</div>
                  <div style={{ position: "relative" as const }}>
                    <input type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="agent@commune.fr"
                      style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 12px", paddingRight: addForm.email ? 28 : 12, border: `1px solid ${addForm.email ? (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addForm.email) ? "#10B981" : "#EF4444") : "#E2E8F0"}`, borderRadius: 8, fontSize: 13, outline: "none" }}
                      onFocus={e => { e.target.style.borderColor = addForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addForm.email) ? "#EF4444" : "#4F46E5"; }}
                      onBlur={e => { e.target.style.borderColor = addForm.email ? (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addForm.email) ? "#10B981" : "#EF4444") : "#E2E8F0"; }} />
                    {addForm.email && <span style={{ position: "absolute" as const, right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addForm.email) ? "#10B981" : "#EF4444" }}>{/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addForm.email) ? "✓" : "✕"}</span>}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Rôle</div>
                    <select value={addForm.role_config_id} onChange={e => {
                      const rc = roleConfigs.find(r => r.id === e.target.value);
                      setAddForm(f => ({ ...f, role_config_id: e.target.value, role: rc ? rc.base_role : "instructeur" }));
                    }}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", background: "white" }}>
                      <option value="">— Sélectionner —</option>
                      {roleConfigs.map(rc => <option key={rc.id} value={rc.id}>{rc.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Téléphone</div>
                    <input type="tel" value={addForm.telephone}
                      placeholder="06 12 34 56 78"
                      onChange={e => { const d = e.target.value.replace(/[^\d+]/g, ""); const fmt = d.startsWith("0") && d.length <= 10 ? d.replace(/(\d{2})(?=\d)/g, "$1 ").trim() : e.target.value; setAddForm(f => ({ ...f, telephone: fmt })); }}
                      style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setShowAddModal(false)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                  <button onClick={addUser} disabled={addLoading} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: addLoading ? "not-allowed" : "pointer" }}>
                    {addLoading ? "Création…" : "Créer le compte"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {deleteId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "white", borderRadius: 16, padding: 28, width: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Retirer cet utilisateur ?</div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>Cette action est irréversible. L'utilisateur perdra immédiatement l'accès à la plateforme.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteId(null)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
              <button onClick={() => deleteUser(deleteId)} style={{ background: "#EF4444", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Confirmer la suppression</button>
            </div>
          </div>
        </div>
      )}
      {/* ── Modal habilitation signature ADS ── */}
      {sigModal && (() => {
        const currentSig = getSig(sigModal.userId);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setSigModal(null)}>
            <div style={{ background: "white", borderRadius: 14, padding: 24, width: 460, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 3 }}>Signature ADS — {sigModal.name}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 18 }}>Habilitation à signer les arrêtés pour <strong>{commune}</strong>.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 5 }}>Titre / Fonction</label>
                  <select value={sigRole} onChange={e => setSigRole(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12.5, outline: "none", background: "white" }}>
                    {SIG_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 5 }}>N° arrêté de délégation</label>
                  <input value={sigDelegation} onChange={e => setSigDelegation(e.target.value)} placeholder="2024-DEL-001 (facultatif)" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12.5, outline: "none", boxSizing: "border-box" as const }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: currentSig ? "space-between" : "flex-end" }}>
                {currentSig && (
                  <button onClick={() => {
                    setSigSaving(true);
                    api.delete(`/decisions/communes/${encodeURIComponent(commune)}/signataires/${currentSig.id}`)
                      .then(() => { loadSigs(); setSigModal(null); })
                      .catch(() => {})
                      .finally(() => setSigSaving(false));
                  }} disabled={sigSaving} style={{ border: "1px solid #FECACA", background: "#FFF5F5", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#EF4444", cursor: "pointer" }}>
                    Retirer l'habilitation
                  </button>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setSigModal(null)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                  <button onClick={() => {
                    setSigSaving(true);
                    const p = currentSig
                      ? api.put(`/decisions/communes/${encodeURIComponent(commune)}/signataires/${currentSig.id}`, { role: sigRole, delegation_arrete: sigDelegation || null })
                      : api.post(`/decisions/communes/${encodeURIComponent(commune)}/signataires`, { user_id: sigModal.userId, role: sigRole, delegation_arrete: sigDelegation || null });
                    p.then(() => { loadSigs(); setSigModal(null); })
                      .catch(() => {})
                      .finally(() => setSigSaving(false));
                  }} disabled={sigSaving} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {sigSaving ? "…" : currentSig ? "Mettre à jour" : "Accorder l'habilitation"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SignatairesPanel({ commune }: { commune: string }) {
  type SignRow = { id: string; user_id: string; commune: string; role: string; delegation_arrete: string | null; active: boolean; user: { id: string; prenom: string; nom: string; email: string } | null };
  const [rows, setRows] = useState<SignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [communeUsers, setCommuneUsers] = useState<{ id: string; prenom: string; nom: string; email: string }[]>([]);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState("maire");
  const [newDelegation, setNewDelegation] = useState("");
  const [saving, setSaving] = useState(false);

  const ROLES = [
    { key: "maire", label: "Maire" },
    { key: "adjoint", label: "Adjoint au Maire" },
    { key: "dgs", label: "Directeur Général des Services" },
    { key: "responsable_ads", label: "Responsable ADS" },
    { key: "directeur", label: "Directeur de service" },
  ];

  const load = () => {
    api.get<SignRow[]>(`/decisions/communes/${encodeURIComponent(commune)}/signataires`)
      .then(data => setRows(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [commune]);

  useEffect(() => {
    if (!showAdd) return;
    api.get<{ id: string; prenom: string; nom: string; email: string }[]>(`/mairie/commune-users?commune=${encodeURIComponent(commune)}`)
      .then(data => setCommuneUsers(data))
      .catch(() => {});
  }, [showAdd, commune]);

  const handleAdd = async () => {
    if (!newUserId || !newRole) return;
    setSaving(true);
    try {
      await api.post(`/decisions/communes/${encodeURIComponent(commune)}/signataires`, {
        user_id: newUserId,
        role: newRole,
        delegation_arrete: newDelegation || null,
      });
      setShowAdd(false);
      setNewUserId(""); setNewRole("maire"); setNewDelegation("");
      load();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleRemove = async (id: string) => {
    await api.delete(`/decisions/communes/${encodeURIComponent(commune)}/signataires/${id}`);
    load();
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Signataires autorisés</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Personnes habilitées à signer les arrêtés ADS pour {commune}.</div>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          + Ajouter un signataire
        </button>
      </div>

      {showAdd && (
        <div style={{ background: "#F8FAFC", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Nouveau signataire</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 5 }}>Utilisateur</label>
              <select value={newUserId} onChange={e => setNewUserId(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none" }}>
                <option value="">Sélectionner…</option>
                {communeUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.prenom} {u.nom} ({u.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 5 }}>Rôle / Titre</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none" }}>
                {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 5 }}>N° arrêté de délégation (facultatif)</label>
            <input value={newDelegation} onChange={e => setNewDelegation(e.target.value)} placeholder="Ex : 2024-DEL-001" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none", boxSizing: "border-box" as const }} />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setShowAdd(false)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Annuler</button>
            <button onClick={handleAdd} disabled={!newUserId || saving} style={{ background: "#4F46E5", color: "white", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              {saving ? "Enregistrement…" : "Ajouter"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "32px 24px", textAlign: "center" as const }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✍️</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Aucun signataire configuré</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Ajoutez les personnes habilitées à signer les arrêtés ADS.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
          {rows.map(row => (
            <div key={row.id} style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                {row.user ? `${row.user.prenom[0] ?? ""}${row.user.nom[0] ?? ""}`.toUpperCase() : "?"}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>{row.user ? `${row.user.prenom} ${row.user.nom}` : "—"}</div>
                <div style={{ fontSize: 11.5, color: "#64748b" }}>{ROLE_LABELS[row.role] ?? row.role}{row.delegation_arrete ? ` · Délég. ${row.delegation_arrete}` : ""}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#15803D", background: "#DCFCE7", borderRadius: 6, padding: "2px 8px", border: "1px solid #BBF7D0" }}>Actif</span>
              <button onClick={() => handleRemove(row.id)} style={{ border: "1px solid #FECACA", background: "white", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, color: "#EF4444", cursor: "pointer" }}>Retirer</button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

function ParametresScreen({ commune = "Ballan-Miré", isAdmin = false, canManageUsers = false, communeInseeMap = COMMUNE_INSEE, onInseeUpdated }: { commune?: string; isAdmin?: boolean; canManageUsers?: boolean; communeInseeMap?: Record<string, string>; onInseeUpdated?: () => void }) {
  const { user } = useAuth();
  const settingsTabs = ["Général", "Utilisateurs", "Réglementation", "Documents", "Workflow & Délais", "Notifications", "Courriers", "Intégrations"];
  const [searchParams] = useSearchParams();
  const [stab, setStab] = useState(() => searchParams.get("tab") === "notifications" ? "Notifications" : "Réglementation");
  const [events, setEvents] = useState([
    { label: "Nouveau dossier déposé", sub: "Lorsqu'un nouveau dossier est déposé par un pétitionnaire.", icon: "📋", active: true },
    { label: "Dossier assigné", sub: "Lorsqu'un dossier vous est assigné.", icon: "👤", active: true },
    { label: "Demande de pièces", sub: "Lorsqu'une demande de pièces complémentaires est envoyée.", icon: "📎", active: true },
    { label: "Pièce complémentaire reçue", sub: "Lorsqu'une pièce complémentaire est déposée.", icon: "⬇️", active: true },
    { label: "Avis émis", sub: "Lorsqu'un avis est émis sur un dossier.", icon: "💬", active: true },
    { label: "Décision prise", sub: "Lorsqu'une décision est prise sur un dossier.", icon: "✅", active: true },
    { label: "Délai dépassé", sub: "Lorsqu'un délai de traitement est dépassé.", icon: "⚠️", active: true },
    { label: "Commentaire sur un dossier", sub: "Lorsqu'un commentaire est ajouté sur un dossier.", icon: "💭", active: true },
  ]);
  const toggleEvent = (label: string) => setEvents(es => es.map(e => e.label === label ? { ...e, active: !e.active } : e));
  const [channels, setChannels] = useState([
    { icon: "✉️", label: "Email", sub: "Recevoir les notifications par email.", active: true },
    { icon: "🔔", label: "Plateforme", sub: "Notifications dans la plateforme.", active: true },
    { icon: "💬", label: "SMS", sub: "Recevoir les notifications par SMS.", active: false },
  ]);
  const toggleChannel = (label: string) => setChannels(cs => cs.map(c => c.label === label ? { ...c, active: !c.active } : c));
  const [recipientMode, setRecipientMode] = useState(0);
  const [notifSubTab, setNotifSubTab] = useState<"historique" | "evenements" | "canaux">("historique");
  const [histNotifs, setHistNotifs] = useState<ApiNotif[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const loadHistNotifs = () => {
    setHistLoading(true);
    api.get<ApiNotif[]>("/notifications").then(setHistNotifs).catch(() => {}).finally(() => setHistLoading(false));
  };
  useEffect(() => { if (stab === "Notifications") loadHistNotifs(); }, [stab]);
  const markAllHistRead = async () => {
    await api.patch("/notifications/read-all").catch(() => {});
    setHistNotifs(ns => ns.map(n => ({ ...n, is_read: true })));
  };
  const markOneRead = (n: ApiNotif) => {
    if (!n.is_read) {
      api.patch(`/notifications/${n.id}/read`).catch(() => {});
      setHistNotifs(ns => ns.map(x => x.id === n.id ? { ...x, is_read: true } : x));
    }
  };
  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Paramètres</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Gérez les paramètres de votre commune, les utilisateurs, les documents et les préférences.</p>
      </div>
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E2E8F0", marginBottom: 24 }}>
        {settingsTabs.map(t => (
          <button key={t} onClick={() => setStab(t)} style={{ border: "none", background: "none", padding: "8px 16px", fontSize: 13, fontWeight: stab === t ? 600 : 400, color: stab === t ? "#4F46E5" : "#64748b", borderBottom: stab === t ? "2px solid #4F46E5" : "2px solid transparent", marginBottom: -2, cursor: "pointer" }}>{t}</button>
        ))}
      </div>
      {stab === "Général" && <CommuneGeneralTab commune={commune} isAdmin={isAdmin} onInseeUpdated={onInseeUpdated} />}
      {stab === "Utilisateurs" && <CommuneUsersTab commune={commune} isAdmin={canManageUsers} currentUserId={user?.id} />}

      {stab === "Réglementation" && (
        <div style={{ minHeight: 400, margin: "0 -24px" }}>
          <ReglementationScreen commune={commune} inseeCode={communeInseeMap[commune]} />
        </div>
      )}
      {stab === "Documents" && (
        <div style={{ minHeight: 400, margin: "0 -24px" }}>
          <DocumentsPanel commune={commune} />
        </div>
      )}
      {stab === "Notifications" && (
        <div>
          {/* Sub-tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #E2E8F0", marginBottom: 20 }}>
            {([["historique", "Historique"], ["evenements", "Par événement"], ["canaux", "Canaux & Préférences"]] as const).map(([val, label]) => (
              <button key={val} onClick={() => setNotifSubTab(val)}
                style={{ border: "none", background: "none", padding: "8px 16px", fontSize: 13, cursor: "pointer",
                  fontWeight: notifSubTab === val ? 600 : 400, color: notifSubTab === val ? "#4F46E5" : "#64748b",
                  borderBottom: notifSubTab === val ? "2px solid #4F46E5" : "2px solid transparent", marginBottom: -1 }}>
                {label}
                {val === "historique" && histNotifs.filter(n => !n.is_read).length > 0 && (
                  <span style={{ background: "#EF4444", color: "white", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "1px 5px", marginLeft: 6 }}>
                    {histNotifs.filter(n => !n.is_read).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Historique */}
          {notifSubTab === "historique" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                  Toutes les notifications
                  {histNotifs.filter(n => !n.is_read).length > 0 && (
                    <span style={{ background: "#EF4444", color: "white", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "1px 6px", marginLeft: 8 }}>
                      {histNotifs.filter(n => !n.is_read).length} non lues
                    </span>
                  )}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={loadHistNotifs} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 7, padding: "5px 12px", fontSize: 12, color: "#64748b", cursor: "pointer" }}>↻ Actualiser</button>
                  {histNotifs.some(n => !n.is_read) && (
                    <button onClick={markAllHistRead} style={{ border: "1px solid #4F46E5", background: "white", borderRadius: 7, padding: "5px 12px", fontSize: 12, color: "#4F46E5", fontWeight: 600, cursor: "pointer" }}>Tout marquer lu</button>
                  )}
                </div>
              </div>
              {histLoading ? (
                <div style={{ padding: 40, textAlign: "center", fontSize: 13, color: "#94a3b8" }}>Chargement…</div>
              ) : histNotifs.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔔</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Aucune notification</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>Vous êtes à jour !</div>
                </div>
              ) : histNotifs.map(n => (
                <div key={n.id} onClick={() => markOneRead(n)}
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 20px", borderBottom: "1px solid #F8FAFC", background: n.is_read ? "white" : "#F8F7FF", cursor: "pointer", transition: "background 0.15s" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: notifColor(n.type) + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{notifIcon(n.type)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: n.is_read ? 500 : 700, color: "#0F172A" }}>{n.title}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{relTime(n.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{n.message}</div>
                  </div>
                  {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4F46E5", flexShrink: 0, marginTop: 6 }} />}
                </div>
              ))}
            </div>
          )}

          {/* Par événement */}
          {notifSubTab === "evenements" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Événements déclencheurs</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>Activez les événements pour lesquels vous souhaitez recevoir une notification.</div>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                <span>ÉVÉNEMENT</span><span>ACTIVÉ</span>
              </div>
              {events.map(ev => (
                <div key={ev.label} onClick={() => toggleEvent(ev.label)}
                  style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F8FAFC", cursor: "pointer" }}>
                  <span style={{ fontSize: 18, marginRight: 10 }}>{ev.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{ev.label}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{ev.sub}</div>
                  </div>
                  <div onClick={e => { e.stopPropagation(); toggleEvent(ev.label); }}
                    style={{ width: 36, height: 20, borderRadius: 10, background: ev.active ? "#4F46E5" : "#E2E8F0", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.2s" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: ev.active ? 18 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>{events.filter(e => e.active).length}/{events.length} événements activés</div>
            </div>
          )}

          {/* Canaux & Préférences */}
          {notifSubTab === "canaux" && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" as const }}>
              <div style={{ flex: 1, minWidth: 260, background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Canaux de notification</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>Sélectionnez les canaux actifs.</div>
                {channels.map(c => (
                  <div key={c.label} onClick={() => toggleChannel(c.label)}
                    style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: 10, background: "#F8FAFC", borderRadius: 8, cursor: "pointer" }}>
                    <span style={{ fontSize: 16 }}>{c.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{c.label}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{c.sub}</div>
                    </div>
                    <div style={{ width: 32, height: 18, borderRadius: 9, background: c.active ? "#4F46E5" : "#E2E8F0", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                      <div style={{ width: 14, height: 14, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: c.active ? 16 : 2, transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Destinataires</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>Choisissez qui reçoit les notifications.</div>
                  {[
                    { label: "Utilisateurs concernés uniquement", sub: "Seuls les utilisateurs liés au dossier." },
                    { label: "Tous les instructeurs", sub: "Tous les instructeurs de la commune." },
                    { label: "Personnaliser", sub: "Choisir manuellement les destinataires." },
                  ].map((d, i) => (
                    <div key={d.label} onClick={() => setRecipientMode(i)}
                      style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10, cursor: "pointer" }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 1, border: recipientMode === i ? "5px solid #4F46E5" : "2px solid #CBD5E1", background: "white", transition: "border 0.15s" }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "#0F172A" }}>{d.label}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>{d.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Plages horaires</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>Horaires d'envoi des notifications.</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>De</span>
                    <select style={{ padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12 }}><option>08:00</option><option>09:00</option></select>
                    <span style={{ fontSize: 12, color: "#64748b" }}>à</span>
                    <select style={{ padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12 }}><option>18:00</option><option>19:00</option></select>
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Les notifications hors plage seront envoyées le jour ouvré suivant.</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {stab === "Workflow & Délais" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Délais légaux par type de dossier</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Configurez les délais d'instruction pour chaque type de dossier.</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  {["Type de dossier","Délai légal","Délai alerte","Délai maxi","Actions"].map(h => (
                    <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { type: "Permis de construire (PC)", legal: "90j", alert: "75j", max: "120j" },
                  { type: "Déclaration préalable (DP)", legal: "30j", alert: "25j", max: "60j" },
                  { type: "Permis d'aménager (PA)", legal: "90j", alert: "75j", max: "120j" },
                  { type: "Certificat d'urbanisme (CU)", legal: "30j", alert: "25j", max: "45j" },
                  { type: "Permis de démolir (PD)", legal: "60j", alert: "50j", max: "90j" },
                ].map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F8FAFC" }}>
                    <td style={{ padding: "10px 12px", fontSize: 13, color: "#374151", fontWeight: 500 }}>{r.type}</td>
                    {[r.legal, r.alert, r.max].map((v, j) => (
                      <td key={j} style={{ padding: "10px 12px" }}>
                        <input defaultValue={v} style={{ width: 70, padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12, color: "#374151", textAlign: "center" }} />
                      </td>
                    ))}
                    <td style={{ padding: "10px 12px" }}>
                      <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", padding: 4 }}><DotsIcon /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
              <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Réinitialiser</button>
              <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
            </div>
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Étapes du workflow</div>
            {[
              { step: "1", label: "Réception & Enregistrement", desc: "Accusé de réception automatique + création du dossier", auto: true },
              { step: "2", label: "Vérification de complétude", desc: "Vérification des pièces dans les 15 premiers jours", auto: false },
              { step: "3", label: "Consultation des services", desc: "Envoi aux organismes consultés selon le type", auto: false },
              { step: "4", label: "Instruction", desc: "Analyse et rédaction de la décision", auto: false },
              { step: "5", label: "Décision & Notification", desc: "Signature et envoi de la décision au pétitionnaire", auto: false },
            ].map((w) => (
              <div key={w.step} style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12, padding: "10px 12px", background: "#F8FAFC", borderRadius: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#4F46E5", color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{w.step}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{w.label}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{w.desc}</div>
                </div>
                {w.auto && <span style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>AUTO</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {stab === "Courriers" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <CommuneLetterheadPanel />
          <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: 28 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Modèles de courrier</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Créez et gérez vos modèles de courrier avec variables dynamiques.</div>
            <TemplateManagerPanel />
          </div>
        </div>
      )}
      {stab === "Intégrations" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Intégrations et services connectés</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Gérez les connexions avec les services tiers.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { name: "Portail ADS / PLAT'AU", desc: "Plateforme nationale de dépôt des autorisations d'urbanisme", status: "Actif", icon: "🏛" },
              { name: "DGFIP – Données foncières", desc: "Accès aux données cadastrales et fiscales", status: "Actif", icon: "🗺" },
              { name: "Géoportail de l'Urbanisme", desc: "Consultation des documents d'urbanisme (PLU, POS...)", status: "Actif", icon: "📍" },
              { name: "Chorus Pro", desc: "Facturation et paiement des actes d'urbanisme", status: "En attente", icon: "💳" },
              { name: "DocuSign", desc: "Signature électronique des arrêtés et courriers", status: "Désactivé", icon: "✍️" },
              { name: "Mailjet / SendGrid", desc: "Envoi des notifications par e-mail", status: "Actif", icon: "✉️" },
            ].map((int) => (
              <div key={int.name} style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 24, flexShrink: 0 }}>{int.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 2 }}>{int.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>{int.desc}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <StatusBadge status={int.status} />
                    <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#4F46E5", cursor: "pointer" }}>{int.status === "Désactivé" ? "Activer" : "Configurer"}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type CarteRegRule = { id: string; article_number: number | null; article_title: string | null; topic: string; rule_text: string; summary: string | null; validation_status: string };
type CarteRegZone = { id: string; zone_code: string; zone_label: string | null; rules: CarteRegRule[]; stats: { total: number } };

function CarteScreen({ commune, setCommune, communeInseeMap = COMMUNE_INSEE }: { commune: string; setCommune: (c: string) => void; communeInseeMap?: Record<string, string> }) {
  const inseeCode = communeInseeMap[commune] ?? "";
  const [communes, setCommunes] = useState<string[]>([commune]);
  const [pluZones, setPluZones] = useState(true);
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("ign-ortho");
  const [regZones, setRegZones] = useState<CarteRegZone[]>([]);
  const [openZoneId, setOpenZoneId] = useState<string | null>(null);
  const [zoneSearch, setZoneSearch] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  useEffect(() => {
    api.get<string[]>("/mairie/communes")
      .then(data => { if (data.length > 0) setCommunes(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!inseeCode) return;
    setRegLoading(true);
    setRegZones([]);
    setOpenZoneId(null);
    api.get<{ zones: CarteRegZone[] }>(`/mairie/reglementation?insee_code=${encodeURIComponent(inseeCode)}`)
      .then(data => setRegZones(data.zones ?? []))
      .catch(() => setRegZones([]))
      .finally(() => setRegLoading(false));
  }, [inseeCode]);

  const TOPIC_LABELS: Record<string, string> = {
    destinations: "Destinations", terrain_min: "Terrain min.",
    recul_voie: "Recul voie", recul_limite: "Recul limite",
    emprise_sol: "Emprise sol", hauteur: "Hauteur",
    aspect: "Aspect extérieur", stationnement: "Stationnement",
    espaces_verts: "Espaces verts", general: "Général",
  };

  const filteredZones = zoneSearch.trim()
    ? regZones.filter(z =>
        z.zone_code.toLowerCase().includes(zoneSearch.toLowerCase()) ||
        (z.zone_label ?? "").toLowerCase().includes(zoneSearch.toLowerCase()))
    : regZones;

  const zoneColor = (code: string) =>
    code.startsWith("N") ? "#27AE60" : code.startsWith("A") && !code.startsWith("AU") ? "#D4AC0D" : code.startsWith("U") ? "#C0392B" : "#E67E22";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "10px 20px", borderBottom: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: "#0F172A", margin: 0 }}>Carte du territoire</h1>
          <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>{commune} — zones PLU · règlement d'urbanisme</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Commune selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#F8F9FC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "5px 10px" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <select
              value={commune}
              onChange={e => setCommune(e.target.value)}
              style={{ border: "none", background: "transparent", fontSize: 12, fontWeight: 600, color: "#374151", outline: "none", cursor: "pointer" }}
            >
              {communes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* Base map selector */}
          <div style={{ display: "flex", border: "1px solid #E2E8F0", borderRadius: 8, overflow: "hidden", background: "white" }}>
            {([
              { key: "ign-ortho", label: "Photo" },
              { key: "carto-light", label: "Neutre" },
              { key: "ign-plan", label: "Plan IGN" },
            ] as { key: BaseLayer; label: string }[]).map(({ key, label }) => (
              <button key={key} onClick={() => setBaseLayer(key)} style={{
                padding: "5px 11px", border: "none", borderRight: "1px solid #E2E8F0", cursor: "pointer",
                fontSize: 11.5, fontWeight: baseLayer === key ? 700 : 400,
                background: baseLayer === key ? "#4F46E5" : "white",
                color: baseLayer === key ? "white" : "#64748b",
                transition: "all 0.12s",
              }}>{label}</button>
            ))}
          </div>
          <button
            onClick={() => setPluZones(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 13px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: "1.5px solid", cursor: "pointer", transition: "all 0.15s",
              borderColor: pluZones ? "#4F46E5" : "#E2E8F0",
              background: pluZones ? "#EEF2FF" : "white",
              color: pluZones ? "#4F46E5" : "#94a3b8",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
            </svg>
            {pluZones ? "Zones PLU activées" : "Zones PLU désactivées"}
          </button>
        </div>
      </div>

      {/* Map + sidebar */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Map */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <MapLeaflet
            dossiers={[]}
            height="100%"
            commune={commune}
            inseeCode={inseeCode || undefined}
            baseLayer={baseLayer}
            pluZoneLayer={pluZones}
            parcelLayer={true}
          />
        </div>

        {/* Sidebar — règlement PLU */}
        <div style={{ width: 260, borderLeft: "1px solid #E2E8F0", background: "white", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" }}>
          {/* Search header */}
          <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid #F1F5F9", flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Règlement PLU</div>
            <div style={{ position: "relative" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                value={zoneSearch}
                onChange={e => setZoneSearch(e.target.value)}
                placeholder="Rechercher une zone…"
                style={{ width: "100%", boxSizing: "border-box", padding: "5px 8px 5px 26px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 11, color: "#374151", outline: "none", background: "#F8F9FC" }}
              />
            </div>
          </div>

          {/* Zone list — scrollable */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {regLoading && (
              <div style={{ padding: "24px 14px", textAlign: "center", color: "#94a3b8", fontSize: 12 }}>Chargement…</div>
            )}
            {!regLoading && regZones.length === 0 && (
              <div style={{ padding: "24px 14px", textAlign: "center" }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                </svg>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>Aucun règlement ingéré pour cette commune.</div>
                <div style={{ fontSize: 11, color: "#CBD5E1", marginTop: 4 }}>Importez un PDF PLU depuis les paramètres.</div>
              </div>
            )}
            {!regLoading && filteredZones.map(zone => (
              <div key={zone.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                <button
                  onClick={() => setOpenZoneId(openZoneId === zone.id ? null : zone.id)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "9px 14px", border: "none",
                    background: openZoneId === zone.id ? "#F8F9FF" : "transparent",
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: zoneColor(zone.zone_code) }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0F172A" }}>{zone.zone_code}</div>
                    {zone.zone_label && (
                      <div style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{zone.zone_label}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{zone.stats.total}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: openZoneId === zone.id ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {openZoneId === zone.id && (
                  <div style={{ background: "#F8F9FC" }}>
                    {zone.rules.length === 0 ? (
                      <div style={{ padding: "8px 14px 10px", fontSize: 11, color: "#94a3b8" }}>Aucune règle.</div>
                    ) : zone.rules.map(rule => (
                      <div key={rule.id} style={{ padding: "7px 14px 8px", borderTop: "1px solid #EEF2FF" }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#4F46E5", marginBottom: 2 }}>
                          {rule.article_number != null ? `Art. ${rule.article_number}` : ""}
                          {rule.article_number != null && rule.topic ? " · " : ""}
                          {TOPIC_LABELS[rule.topic] ?? rule.topic}
                        </div>
                        <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.45 }}>
                          {rule.summary
                            ? rule.summary
                            : rule.rule_text.length > 130 ? rule.rule_text.slice(0, 130) + "…" : rule.rule_text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* PLU zones legend — bottom */}
          <div style={{ padding: "12px 14px", borderTop: "1px solid #F1F5F9", flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
              Légende zones PLU
              {!pluZones && <span style={{ fontSize: 10, fontWeight: 400, color: "#94a3b8", marginLeft: 6 }}>(désactivées)</span>}
            </div>
            {[
              { color: "#C0392B", label: "Zones U — Urbanisées" },
              { color: "#E67E22", label: "Zones AU — À urbaniser" },
              { color: "#D4AC0D", label: "Zones A — Agricoles" },
              { color: "#27AE60", label: "Zones N — Naturelles" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, opacity: pluZones ? 1 : 0.4 }}>
                <span style={{ width: 14, height: 10, borderRadius: 2, background: color + "88", border: `1.5px solid ${color}`, display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "#374151" }}>{label}</span>
              </div>
            ))}
            <div style={{ marginTop: 6, fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
              Source : Géoportail de l'Urbanisme<br />
              Couche URBANISME.ZONE_URBA
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendrierScreen({ commune }: { commune: string }) {
  const navigate = useNavigate();

  const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const DAYS = ["Lun.","Mar.","Mer.","Jeu.","Ven.","Sam.","Dim."];

  const STATUS_COLOR: Record<string, string> = {
    soumis: "#4F46E5", pre_instruction: "#F97316", incomplet: "#EF4444",
    en_instruction: "#22C55E", decision_en_cours: "#8B5CF6",
    accepte: "#10B981", refuse: "#EF4444", accord_prescription: "#10B981", brouillon: "#94A3B8",
  };
  const STATUS_LABEL: Record<string, string> = {
    soumis: "Nouveau", pre_instruction: "Pré-instruction", incomplet: "Incomplet",
    en_instruction: "En instruction", decision_en_cours: "Décision",
    accepte: "Accepté", refuse: "Refusé", accord_prescription: "Accord", brouillon: "Brouillon",
  };
  const TYPE_SHORT: Record<string, string> = {
    permis_de_construire: "PC", declaration_prealable: "DP", permis_amenager: "PA",
    permis_demolir: "PD", permis_lotir: "PL", certificat_urbanisme: "CU",
  };

  type DossierRow = {
    id: string; numero: string; type: string; status: string; adresse?: string | null;
    commune?: string | null; date_depot: string | null; date_limite_instruction: string | null;
  };

  const [view, setView] = useState<"mois" | "semaine">("mois");
  const [filterType, setFilterType] = useState("Tous");
  const [filterStatus, setFilterStatus] = useState("Tous");
  const [dossiers, setDossiers] = useState<DossierRow[]>([]);
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  useEffect(() => {
    fetch(`/api/mairie/dossiers?commune=${encodeURIComponent(commune)}`, { credentials: "include" })
      .then(r => r.json())
      .then((data: unknown) => setDossiers(Array.isArray(data) ? data as DossierRow[] : []))
      .catch(() => {});
  }, [commune]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toDateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayKey = toDateKey(today);

  // Apply filters
  const filtered = dossiers.filter(d => {
    if (filterType !== "Tous" && TYPE_SHORT[d.type] !== filterType) return false;
    if (filterStatus !== "Tous" && STATUS_LABEL[d.status] !== filterStatus) return false;
    return true;
  });

  // Map: "YYYY-MM-DD" → dossiers (keyed on deadline, fallback deposit date)
  const dateMap: Record<string, DossierRow[]> = {};
  for (const d of filtered) {
    const raw = d.date_limite_instruction ?? d.date_depot;
    if (!raw) continue;
    const key = raw.substring(0, 10);
    (dateMap[key] ??= []).push(d);
  }

  // ── Month view helpers ──
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

  // ── Week view helpers ──
  const weekStart = new Date(currentDate);
  if (view === "semaine") {
    const dow = (currentDate.getDay() + 6) % 7;
    weekStart.setDate(currentDate.getDate() - dow);
  }
  const weekDays = view === "semaine"
    ? Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; })
    : [];

  // ── Navigation ──
  const prevPeriod = () => {
    if (view === "mois") setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    else setCurrentDate(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
  };
  const nextPeriod = () => {
    if (view === "mois") setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    else setCurrentDate(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
  };
  const goToday = () => setCurrentDate(new Date(today.getFullYear(), today.getMonth(), view === "semaine" ? today.getDate() : 1));

  // ── Sidebar: upcoming deadlines (next 30 days + overdue up to 14 days ago) ──
  const upcoming = filtered
    .filter(d => d.date_limite_instruction)
    .map(d => ({ ...d, dl: new Date(d.date_limite_instruction!) }))
    .filter(d => {
      const diff = Math.ceil((d.dl.getTime() - today.getTime()) / 86400000);
      return diff >= -14 && diff <= 30;
    })
    .sort((a, b) => a.dl.getTime() - b.dl.getTime())
    .slice(0, 9);

  const diffLabel = (dl: Date) => {
    const diff = Math.ceil((dl.getTime() - today.getTime()) / 86400000);
    if (diff < 0) return { text: `En retard (${-diff}j)`, color: "#EF4444" };
    if (diff === 0) return { text: "Aujourd'hui", color: "#EF4444" };
    if (diff <= 3) return { text: `Dans ${diff} jour${diff > 1 ? "s" : ""}`, color: "#F97316" };
    if (diff <= 7) return { text: `Dans ${diff} jours`, color: "#EAB308" };
    return { text: `Dans ${diff} jours`, color: "#22C55E" };
  };

  // ── Period label ──
  const periodLabel = view === "mois"
    ? `${MONTHS[month]} ${year}`
    : (() => {
        const end = new Date(weekStart); end.setDate(end.getDate() + 6);
        return `${weekStart.getDate()} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
      })();

  const EventChip = ({ d, onClick }: { d: DossierRow; onClick: () => void }) => {
    const c = STATUS_COLOR[d.status] ?? "#888";
    return (
      <div
        onClick={onClick}
        title={`${d.numero}${d.adresse ? " — " + d.adresse : ""}\n${STATUS_LABEL[d.status] ?? d.status}`}
        style={{
          background: `${c}18`, borderLeft: `3px solid ${c}`, borderRadius: "0 4px 4px 0",
          padding: "2px 5px", fontSize: 10, color: "#374151", lineHeight: 1.4,
          marginBottom: 2, cursor: "pointer", overflow: "hidden", whiteSpace: "nowrap",
          textOverflow: "ellipsis", maxWidth: "100%",
        }}
      >
        <span style={{ fontWeight: 700, color: c }}>{TYPE_SHORT[d.type] ?? d.type}</span>{" "}
        <span>{d.numero}</span>
      </div>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Calendrier — {commune}</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Échéances et dépôts — cliquez sur un dossier pour l'ouvrir.</p>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        {/* ── Main grid ── */}
        <div style={{ flex: 1 }}>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <button onClick={prevPeriod} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "5px 10px", cursor: "pointer", color: "#64748b", fontSize: 14 }}>‹</button>
            <button onClick={nextPeriod} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "5px 10px", cursor: "pointer", color: "#64748b", fontSize: 14 }}>›</button>
            <button onClick={goToday} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>Aujourd'hui</button>
            <span style={{ marginLeft: 4, fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{periodLabel}</span>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 4 }}>
              {(["mois", "semaine"] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{ border: "1px solid #E2E8F0", background: view === v ? "#4F46E5" : "white", color: view === v ? "white" : "#64748b", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}>
                  {v === "mois" ? "Mois" : "Semaine"}
                </button>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            {Object.entries(STATUS_LABEL).filter(([k]) => !["accord_prescription"].includes(k)).map(([status, label]) => (
              <div key={status} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR[status], display: "inline-block" }} />
                {label}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
            {/* Header row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: "1px solid #E2E8F0" }}>
              {(view === "semaine" ? weekDays.map(d => `${DAYS[(d.getDay() + 6) % 7]} ${d.getDate()}`) : DAYS).map(label => (
                <div key={label} style={{ padding: "8px 10px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#64748b", borderRight: "1px solid #F1F5F9" }}>{label}</div>
              ))}
            </div>

            {view === "mois" ? (
              Array.from({ length: totalCells / 7 }, (_, wi) => (
                <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: wi < totalCells / 7 - 1 ? "1px solid #F1F5F9" : "none" }}>
                  {Array.from({ length: 7 }, (_, di) => {
                    const dayNum = wi * 7 + di - firstDow + 1;
                    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
                    const cellDate = inMonth ? new Date(year, month, dayNum) : null;
                    const cellKey = cellDate ? toDateKey(cellDate) : null;
                    const isToday = cellKey === todayKey;
                    const events: DossierRow[] = cellKey ? (dateMap[cellKey] ?? []) : [];
                    const shown = events.slice(0, 3);
                    const extra = events.length - shown.length;
                    return (
                      <div key={di} style={{ minHeight: 90, padding: "6px 6px", borderRight: di < 6 ? "1px solid #F1F5F9" : "none", background: inMonth ? "white" : "#F8FAFC" }}>
                        <div style={{ width: 24, height: 24, borderRadius: "50%", background: isToday ? "#4F46E5" : "transparent", color: isToday ? "white" : (inMonth ? "#374151" : "#CBD5E1"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: isToday ? 700 : 400, marginBottom: 3 }}>
                          {inMonth ? dayNum : ""}
                        </div>
                        {shown.map(ev => (
                          <EventChip key={ev.id} d={ev} onClick={() => navigate(`/mairie/dossiers/${ev.id}`)} />
                        ))}
                        {extra > 0 && (
                          <div style={{ fontSize: 10, color: "#94a3b8", paddingLeft: 4 }}>+{extra} autre{extra > 1 ? "s" : ""}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              /* Week view — single row with events stacked */
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
                {weekDays.map((wd, di) => {
                  const cellKey = toDateKey(wd);
                  const isToday = cellKey === todayKey;
                  const events = dateMap[cellKey] ?? [];
                  return (
                    <div key={di} style={{ minHeight: 240, padding: "6px 6px", borderRight: di < 6 ? "1px solid #F1F5F9" : "none", background: isToday ? "#EEF2FF" : "white" }}>
                      {events.length === 0 && <div style={{ fontSize: 10, color: "#CBD5E1", marginTop: 8, textAlign: "center" }}>—</div>}
                      {events.map(ev => (
                        <EventChip key={ev.id} d={ev} onClick={() => navigate(`/mairie/dossiers/${ev.id}`)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div style={{ width: 240 }}>
          {/* Upcoming deadlines */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Échéances à venir</span>
              <button onClick={() => navigate("/mairie/dossiers")} style={{ fontSize: 12, color: "#4F46E5", background: "none", border: "none", cursor: "pointer" }}>Voir tout</button>
            </div>
            {upcoming.length === 0 && (
              <div style={{ fontSize: 12, color: "#94a3b8" }}>Aucune échéance prochaine.</div>
            )}
            {upcoming.map(e => {
              const { text, color } = diffLabel(e.dl);
              return (
                <div
                  key={e.id}
                  onClick={() => navigate(`/mairie/dossiers/${e.id}`)}
                  style={{ padding: "8px 0", borderBottom: "1px solid #F8FAFC", cursor: "pointer" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color }}>{text}</span>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>{e.dl.toLocaleDateString("fr-FR")}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{STATUS_LABEL[e.status] ?? e.status}</div>
                  <div style={{ fontSize: 11, color: "#4F46E5", fontWeight: 600 }}>{e.numero}</div>
                </div>
              );
            })}
          </div>

          {/* Filters */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 10 }}>Filtres</div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>Type de dossier</div>
              <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ width: "100%", padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12 }}>
                <option>Tous</option>
                {Object.values(TYPE_SHORT).map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>Statut</div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: "100%", padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12 }}>
                <option>Tous</option>
                {Object.values(STATUS_LABEL).map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
            <button onClick={() => { setFilterType("Tous"); setFilterStatus("Tous"); }} style={{ width: "100%", border: "none", background: "#F1F5F9", color: "#64748b", borderRadius: 8, padding: "7px", fontSize: 12, cursor: "pointer", marginTop: 4 }}>↺ Effacer les filtres</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatistiquesScreen({ commune }: { commune: string }) {
  const [stab, setStab] = useState("Vue générale");
  const tabs = ["Vue générale", "Délais", "Types de dossiers", "Services"];

  // Simple SVG bar chart
  const BarChart = ({ data }: { data: { label: string; value: number; color: string }[] }) => {
    const max = Math.max(...data.map(d => d.value), 1);
    return (
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 160 }}>
        {data.map((d) => (
          <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{d.value}</span>
            <div style={{ width: "100%", borderRadius: "4px 4px 0 0", background: d.color, height: `${(d.value / max) * 120}px`, minHeight: d.value > 0 ? 8 : 0, transition: "height 0.3s" }} />
            <span style={{ fontSize: 10, color: "#94a3b8", textAlign: "center" }}>{d.label}</span>
          </div>
        ))}
      </div>
    );
  };

  const monthlyData = [
    { label: "Jan", value: 18, color: "#4F46E5" }, { label: "Fév", value: 22, color: "#4F46E5" },
    { label: "Mar", value: 31, color: "#4F46E5" }, { label: "Avr", value: 27, color: "#4F46E5" },
    { label: "Mai", value: 35, color: "#4F46E5" }, { label: "Jun", value: 29, color: "#4F46E5" },
    { label: "Jul", value: 24, color: "#4F46E5" }, { label: "Aoû", value: 19, color: "#4F46E5" },
    { label: "Sep", value: 38, color: "#4F46E5" }, { label: "Oct", value: 42, color: "#4F46E5" },
    { label: "Nov", value: 33, color: "#4F46E5" }, { label: "Déc", value: 28, color: "#4F46E5" },
  ];

  const typeData = [
    { label: "PC", value: 48, color: "#4F46E5" },
    { label: "DP", value: 67, color: "#6366F1" },
    { label: "PA", value: 12, color: "#818CF8" },
    { label: "CU", value: 23, color: "#A5B4FC" },
    { label: "Autre", value: 9, color: "#C7D2FE" },
  ];

  const kpis = [
    { label: "Dossiers traités", value: "159", sub: "+12% vs mois dernier", color: "#4F46E5", bg: "#EEF2FF", icon: "📁" },
    { label: "Délai moyen", value: "38j", sub: "Objectif : 45j", color: "#22C55E", bg: "#F0FDF4", icon: "⏱" },
    { label: "Taux d'acceptation", value: "74%", sub: "118 acceptés / 159", color: "#F97316", bg: "#FFF7ED", icon: "✅" },
    { label: "Dossiers en retard", value: "8", sub: "5% du total", color: "#EF4444", bg: "#FEF2F2", icon: "⚠️" },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Statistiques — {commune}</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Analysez l'activité et les performances de traitement des dossiers.</p>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {kpis.map(k => (
          <div key={k.label} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: k.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{k.icon}</div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>{k.value}</div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 11, color: k.color, fontWeight: 600 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E2E8F0", marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setStab(t)} style={{ border: "none", background: "none", padding: "8px 16px", fontSize: 13, fontWeight: stab === t ? 600 : 400, color: stab === t ? "#4F46E5" : "#64748b", borderBottom: stab === t ? "2px solid #4F46E5" : "2px solid transparent", marginBottom: -2, cursor: "pointer" }}>{t}</button>
        ))}
      </div>

      {stab === "Vue générale" && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Dossiers déposés par mois — 2024</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>346 dossiers au total cette année</div>
            <BarChart data={monthlyData} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Répartition par type</div>
              {typeData.map(t => (
                <div key={t.label} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "#374151" }}>{t.label === "PC" ? "Permis de construire" : t.label === "DP" ? "Déclaration préalable" : t.label === "PA" ? "Permis d'aménager" : t.label === "CU" ? "Certificat d'urbanisme" : "Autre"}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{t.value}</span>
                  </div>
                  <div style={{ height: 6, background: "#F1F5F9", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(t.value / 159) * 100}%`, background: t.color, borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Résultats des décisions</div>
              {[{ label: "Accordé", n: 118, color: "#22C55E", pct: 74 }, { label: "Refusé", n: 28, color: "#EF4444", pct: 18 }, { label: "Sursis à statuer", n: 13, color: "#F97316", pct: 8 }].map(r => (
                <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.color, flexShrink: 0, display: "inline-block" }} />
                  <span style={{ fontSize: 12, color: "#374151", flex: 1 }}>{r.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{r.n}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8", width: 32, textAlign: "right" }}>{r.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {stab === "Délais" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Délais moyens par type</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Comparaison avec les délais légaux</div>
            {[
              { type: "Permis de construire", current: 52, legal: 90, color: "#22C55E" },
              { type: "Déclaration préalable", current: 24, legal: 30, color: "#F97316" },
              { type: "Permis d'aménager", current: 68, legal: 90, color: "#22C55E" },
              { type: "Certificat d'urbanisme", current: 18, legal: 30, color: "#22C55E" },
              { type: "Permis de démolir", current: 28, legal: 60, color: "#22C55E" },
            ].map(d => (
              <div key={d.type} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "#374151" }}>{d.type}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: d.color }}>{d.current}j <span style={{ color: "#94a3b8", fontWeight: 400 }}>/ {d.legal}j légal</span></span>
                </div>
                <div style={{ height: 8, background: "#F1F5F9", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(d.current / d.legal) * 100}%`, background: d.color, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Évolution du délai moyen</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>6 derniers mois (jours)</div>
            <BarChart data={[
              { label: "Déc", value: 44, color: "#C7D2FE" }, { label: "Jan", value: 41, color: "#A5B4FC" },
              { label: "Fév", value: 43, color: "#818CF8" }, { label: "Mar", value: 39, color: "#6366F1" },
              { label: "Avr", value: 36, color: "#4F46E5" }, { label: "Mai", value: 38, color: "#4338CA" },
            ]} />
            <div style={{ marginTop: 16, padding: 12, background: "#F0FDF4", borderRadius: 8, fontSize: 12, color: "#15803D", fontWeight: 500 }}>
              ↓ Amélioration de 14% en 6 mois — objectif 45j maintenu
            </div>
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20, gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Dossiers dépassant les délais légaux</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  {["N° Dossier","Type","Pétitionnaire","Délai légal","Délai écoulé","Dépassement","Statut"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { id: "PC-2023-0567", type: "PC", pet: "Marie Bernard", legal: "90j", elapsed: "98j", over: "+8j" },
                  { id: "DP-2024-0111", type: "DP", pet: "Lucas Morel", legal: "30j", elapsed: "38j", over: "+8j" },
                  { id: "PC-2023-0412", type: "PC", pet: "SCI Horizon", legal: "90j", elapsed: "94j", over: "+4j" },
                ].map(r => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#4F46E5" }}>{r.id}</td>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "#374151" }}>{r.type}</td>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "#374151" }}>{r.pet}</td>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>{r.legal}</td>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "#374151" }}>{r.elapsed}</td>
                    <td style={{ padding: "10px 12px" }}><span style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 8px" }}>{r.over}</span></td>
                    <td style={{ padding: "10px 12px" }}><StatusBadge status="En retard" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stab === "Types de dossiers" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 16 }}>Volume par type de dossier</div>
            <BarChart data={typeData} />
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 16 }}>Détail par type</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Type","Déposés","Accordés","Refusés","Délai moy."].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { type: "Permis de construire", n: 48, acc: 36, ref: 9, delay: "52j" },
                  { type: "Déclaration préalable", n: 67, acc: 54, ref: 11, delay: "24j" },
                  { type: "Permis d'aménager", n: 12, acc: 10, ref: 2, delay: "68j" },
                  { type: "Certificat d'urbanisme", n: 23, acc: 16, ref: 4, delay: "18j" },
                  { type: "Autre", n: 9, acc: 2, ref: 2, delay: "–" },
                ].map(r => (
                  <tr key={r.type} style={{ borderBottom: "1px solid #F8FAFC" }}>
                    <td style={{ padding: "8px", fontSize: 12, color: "#374151" }}>{r.type}</td>
                    <td style={{ padding: "8px", fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{r.n}</td>
                    <td style={{ padding: "8px", fontSize: 12, color: "#22C55E", fontWeight: 600 }}>{r.acc}</td>
                    <td style={{ padding: "8px", fontSize: 12, color: "#EF4444", fontWeight: 600 }}>{r.ref}</td>
                    <td style={{ padding: "8px", fontSize: 12, color: "#64748b" }}>{r.delay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20, gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 16 }}>Tendance mensuelle par type (2024)</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[["Permis de construire","#4F46E5"],["Déclaration préalable","#22C55E"],["Permis d'aménager","#F97316"],["Certificat d'urbanisme","#8B5CF6"]].map(([l,c]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />{l}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, height: 8, background: "linear-gradient(90deg, #EEF2FF 0%, #4F46E5 100%)", borderRadius: 4, opacity: 0.3 }} />
            <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Graphique linéaire — à connecter aux données réelles</div>
          </div>
        </div>
      )}

      {stab === "Services" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Consultations par service</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Nombre de consultations envoyées et délais de retour moyens</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["Service","Consultations","Retours reçus","En attente","Délai retour moy.","Taux de réponse"].map(h => (
                  <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { service: "ABF – Architecte des Bâtiments de France", n: 42, ret: 38, att: 4, delay: "18j", taux: "90%" },
                { service: "SDIS – Service Incendie", n: 67, ret: 65, att: 2, delay: "12j", taux: "97%" },
                { service: "Métropole / Agglo", n: 28, ret: 22, att: 6, delay: "24j", taux: "79%" },
                { service: "DREAL – Environnement", n: 19, ret: 16, att: 3, delay: "31j", taux: "84%" },
                { service: "Service des Eaux", n: 33, ret: 33, att: 0, delay: "8j", taux: "100%" },
                { service: "Direction Voirie", n: 15, ret: 12, att: 3, delay: "21j", taux: "80%" },
              ].map(r => (
                <tr key={r.service} style={{ borderBottom: "1px solid #F1F5F9" }}>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 500, color: "#374151" }}>{r.service}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{r.n}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#22C55E", fontWeight: 600 }}>{r.ret}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: r.att > 0 ? "#F97316" : "#22C55E", fontWeight: 600 }}>{r.att}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>{r.delay}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: "#F1F5F9", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: r.taux, background: parseInt(r.taux) >= 90 ? "#22C55E" : parseInt(r.taux) >= 80 ? "#F97316" : "#EF4444", borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", width: 32 }}>{r.taux}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Référentiel documentaire ───────────────────────────────────────────────────

const DOC_TYPES: { value: string; label: string; color: string }[] = [
  { value: "ppri",  label: "PPRI",  color: "#EF4444" },
  { value: "oap",   label: "OAP",   color: "#8B5CF6" },
  { value: "peb",   label: "PEB",   color: "#F59E0B" },
  { value: "pprt",  label: "PPRT",  color: "#EC4899" },
  { value: "plh",   label: "PLH",   color: "#10B981" },
  { value: "zac",   label: "ZAC",   color: "#3B82F6" },
  { value: "autre", label: "Autre", color: "#64748B" },
];

type CommuneDoc = {
  id: string; type: string; name: string; original_filename: string;
  file_size: number | null; status: string; created_at: string;
};

function DocumentsPanel({ commune }: { commune: string }) {
  const [docs, setDocs] = useState<CommuneDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ type: "ppri", name: "", file: null as File | null });
  const [dragOver, setDragOver] = useState(false);

  const load = () => {
    setLoading(true);
    api.get<CommuneDoc[]>(`/mairie/documents?commune=${encodeURIComponent(commune)}`)
      .then(setDocs)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [commune]);

  const handleFile = (file: File) => {
    if (file.type !== "application/pdf") return;
    setForm(f => ({ ...f, file, name: f.name || file.name.replace(/\.pdf$/i, "") }));
  };

  const upload = async () => {
    if (!form.file || !form.name.trim()) return;
    setUploading(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1] ?? "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(form.file!);
      });
      await api.post("/mairie/documents", {
        commune_name: commune,
        type: form.type,
        name: form.name.trim(),
        original_filename: form.file.name,
        file_size: form.file.size,
        pdf_base64: b64,
      });
      setShowForm(false);
      setForm({ type: "ppri", name: "", file: null });
      load();
    } catch {
    } finally {
      setUploading(false);
    }
  };

  const deleteDoc = async (id: string) => {
    await api.delete(`/mairie/documents/${id}`).catch(() => {});
    setDocs(d => d.filter(x => x.id !== id));
  };

  const grouped = DOC_TYPES.map(t => ({
    ...t,
    items: docs.filter(d => d.type === t.value),
  })).filter(g => g.items.length > 0);

  const fmt = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>Documents réglementaires</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            PPRI, OAP, PEB, PLH, ZAC et autres plans réglementaires de {commune}
          </div>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} style={{
            display: "flex", alignItems: "center", gap: 6, background: "#4F46E5", color: "white",
            border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
            cursor: "pointer",
          }}>
            + Ajouter un document
          </button>
        )}
      </div>

      {/* Upload form */}
      {showForm && (
        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 16 }}>Nouveau document</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "white" }}>
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Nom</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex. PPRI Vallée de l'Indre 2023"
                style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/pdf"; inp.onchange = () => { if (inp.files?.[0]) handleFile(inp.files[0]); }; inp.click(); }}
            style={{
              border: `2px dashed ${dragOver ? "#4F46E5" : "#CBD5E1"}`,
              borderRadius: 10, padding: "20px 16px", textAlign: "center", cursor: "pointer",
              background: dragOver ? "#EEF2FF" : "white", marginBottom: 16, transition: "all 0.15s",
            }}
          >
            {form.file ? (
              <div style={{ fontSize: 13, color: "#374151" }}>
                <span style={{ fontWeight: 600 }}>📄 {form.file.name}</span>
                <span style={{ color: "#64748b", marginLeft: 8 }}>({fmt(form.file.size)})</span>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#64748b" }}>
                Glissez un PDF ici ou <span style={{ color: "#4F46E5", fontWeight: 600 }}>cliquez pour parcourir</span>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { setShowForm(false); setForm({ type: "ppri", name: "", file: null }); }}
              style={{ border: "1px solid #E2E8F0", borderRadius: 8, background: "white", padding: "8px 16px", fontSize: 13, cursor: "pointer", color: "#374151" }}>
              Annuler
            </button>
            <button onClick={upload} disabled={uploading || !form.file || !form.name.trim()}
              style={{ border: "none", borderRadius: 8, background: uploading || !form.file || !form.name.trim() ? "#A5B4FC" : "#4F46E5", color: "white", padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {uploading ? "Envoi en cours…" : "Enregistrer"}
            </button>
          </div>
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#94a3b8", padding: 40, fontSize: 13 }}>Chargement…</div>
      ) : docs.length === 0 && !showForm ? (
        <div style={{ textAlign: "center", padding: 48, color: "#94a3b8" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Aucun document pour le moment</div>
          <div style={{ fontSize: 12 }}>Ajoutez les plans réglementaires de votre commune (PPRI, OAP…)</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {grouped.map(group => (
            <div key={group.value}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ background: group.color, color: "white", borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{group.label}</span>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{group.items.length} document{group.items.length > 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {group.items.map(doc => (
                  <div key={doc.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    background: "white", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px",
                  }}>
                    <span style={{ fontSize: 20 }}>📄</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                        {doc.original_filename}
                        {doc.file_size && <span style={{ marginLeft: 8 }}>{fmt(doc.file_size)}</span>}
                        <span style={{ marginLeft: 8 }}>· {new Date(doc.created_at).toLocaleDateString("fr-FR")}</span>
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: doc.status === "ingested" ? "#10B981" : "#94a3b8",
                      background: doc.status === "ingested" ? "#D1FAE5" : "#F1F5F9",
                      borderRadius: 6, padding: "2px 8px",
                    }}>
                      {doc.status === "ingested" ? "Ingéré" : "Importé"}
                    </span>
                    <button onClick={() => deleteDoc(doc.id)}
                      style={{ border: "none", background: "none", color: "#94a3b8", cursor: "pointer", padding: 4, fontSize: 16, lineHeight: 1 }}
                      title="Supprimer">✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PLU upload panel (état vide Réglementation) ────────────────────────────────

type ZoneDef = { code: string; label: string; type: string };
type ZoneProgress = { code: string; label: string; type: string; status: "pending" | "done"; rules?: number; vision?: number };

function PluUploadPanel({ commune, inseeCode, onSuccess, loadError, onCancel, onManual }: { commune: string; inseeCode?: string; onSuccess: () => void; loadError: string | null; onCancel?: () => void; onManual?: () => void }) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [communeInput, setCommuneInput] = useState(commune);
  const [inseeInput, setInseeInput] = useState(inseeCode ?? "");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [zoneProgress, setZoneProgress] = useState<ZoneProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ zones: number; rules: number; needs_review: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setCommuneInput(commune); setInseeInput(inseeCode ?? ""); }, [commune, inseeCode]);

  const handleFile = (f: File | null) => { setPdfFile(f); setError(null); setDone(null); setZoneProgress([]); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") handleFile(f);
    else setError("Seuls les fichiers PDF sont acceptés.");
  };

  const handleSubmit = async () => {
    if (!communeInput.trim() || !inseeInput.trim() || !pdfFile) { setError("Commune, code INSEE et PDF sont requis."); return; }
    setLoading(true); setError(null); setDone(null); setZoneProgress([]); setPhase("Lecture du PDF…");

    const pdf_base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]!);
      reader.onerror = reject;
      reader.readAsDataURL(pdfFile);
    });

    try {
      const resp = await fetch("/api/mairie/admin/ingest-plu-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ commune_name: communeInput.trim(), insee_code: inseeInput.trim(), pdf_base64 }),
      });

      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => "Erreur serveur");
        throw new Error(txt);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf2 = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf2 += decoder.decode(value, { stream: true });
        const lines = buf2.split("\n");
        buf2 = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (ev.type === "phase") setPhase(ev.message as string);
            else if (ev.type === "zones_found") {
              const zones = ev.zones as ZoneDef[];
              setPhase("Extraction des règles en parallèle…");
              setZoneProgress(zones.map(z => ({ ...z, status: "pending" })));
            } else if (ev.type === "zone_done") {
              setZoneProgress(prev => prev.map(z => z.code === ev.zone ? { ...z, status: "done", rules: ev.rules as number, vision: ev.vision as number } : z));
            } else if (ev.type === "done") {
              setDone({ zones: ev.zones as number, rules: ev.rules as number, needs_review: ev.needs_review as number });
              setPhase(null);
              setTimeout(onSuccess, 1500);
            } else if (ev.type === "error") {
              setError(ev.message as string);
              setPhase(null);
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur serveur");
      setPhase(null);
    } finally {
      setLoading(false);
    }
  };

  const ZONE_COLORS: Record<string, string> = { U: "#4338CA", AU: "#C2410C", A: "#A16207", N: "#15803D" };
  const doneCount = zoneProgress.filter(z => z.status === "done").length;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 24px", minHeight: 400 }}>
      <div style={{ width: "100%", maxWidth: 540, background: "white", borderRadius: 16, border: "1px solid #E2E8F0", padding: 32, boxShadow: "0 2px 16px rgba(0,0,0,0.06)" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, marginBottom: 10 }}>📄</div>
          <div style={{ fontWeight: 700, color: "#0F172A", fontSize: 16, marginBottom: 6 }}>Charger le PLU de {commune || "la commune"}</div>
          <div style={{ fontSize: 13, color: "#64748b" }}>
            Importez le règlement PLU en PDF. L'IA extrait les zones et règles automatiquement — les règles sont créées en brouillon pour validation.
          </div>
          {loadError && <div style={{ marginTop: 10, fontSize: 12, color: "#DC2626" }}>Erreur de chargement : {loadError}</div>}
        </div>

        {!loading && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 2 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>COMMUNE</div>
                <input value={communeInput} onChange={e => setCommuneInput(e.target.value)} placeholder="ex : Tours" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>CODE INSEE</div>
                <input value={inseeInput} onChange={e => setInseeInput(e.target.value)} placeholder="ex : 37261" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
              </div>
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{ border: `2px dashed ${dragging ? "#4F46E5" : pdfFile ? "#22c55e" : "#CBD5E1"}`, borderRadius: 12, padding: "28px 16px", textAlign: "center", cursor: "pointer", background: dragging ? "#EEF2FF" : pdfFile ? "#F0FDF4" : "#F8FAFC", transition: "all 0.15s", marginBottom: 16 }}
            >
              {pdfFile ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>✓ {pdfFile.name}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{(pdfFile.size / 1024 / 1024).toFixed(1)} Mo — cliquez pour changer</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}>Glissez le PDF ici ou cliquez pour parcourir</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Règlement PLU uniquement (pas le RI) · max ~35 Mo</div>
                </>
              )}
              <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => handleFile(e.target.files?.[0] ?? null)} />
            </div>
          </>
        )}

        {/* ── Progression en cours ── */}
        {loading && (
          <div style={{ marginBottom: 16 }}>
            {phase && (
              <div style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#4F46E5", display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 14, height: 14, border: "2px solid #4F46E5", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                {phase}
              </div>
            )}
            {zoneProgress.length > 0 && (
              <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "8px 14px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", fontSize: 11, fontWeight: 600, color: "#64748b", display: "flex", justifyContent: "space-between" }}>
                  <span>Zones détectées</span>
                  <span style={{ color: "#4F46E5" }}>{doneCount} / {zoneProgress.length}</span>
                </div>
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {zoneProgress.map(z => (
                    <div key={z.code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: ZONE_COLORS[z.type] ?? "#4F46E5", background: `${ZONE_COLORS[z.type] ?? "#4F46E5"}18`, border: `1px solid ${ZONE_COLORS[z.type] ?? "#4F46E5"}33`, borderRadius: 5, padding: "1px 6px", minWidth: 28, textAlign: "center" }}>{z.code}</span>
                      <span style={{ flex: 1, fontSize: 12, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{z.label}</span>
                      {z.status === "done" ? (
                        <span style={{ fontSize: 11, color: "#15803D", fontWeight: 600 }}>✓ {z.rules} règle{(z.rules ?? 0) > 1 ? "s" : ""}</span>
                      ) : (
                        <div style={{ width: 12, height: 12, border: "2px solid #C7D2FE", borderTopColor: "#4F46E5", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ height: 4, background: "#E2E8F0" }}>
                  <div style={{ height: "100%", background: "#4F46E5", width: `${zoneProgress.length ? (doneCount / zoneProgress.length) * 100 : 0}%`, transition: "width 0.4s" }} />
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#DC2626", marginBottom: 14 }}>⚠ {error}</div>
        )}
        {done && (
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 8, padding: "12px 14px", fontSize: 13, color: "#15803d", marginBottom: 14 }}>
            ✓ {done.zones} zone{done.zones > 1 ? "s" : ""} · {done.rules} règle{done.rules > 1 ? "s" : ""} extraites
            {done.needs_review > 0 && ` · ${done.needs_review} à vérifier`} — chargement…
          </div>
        )}

        {!loading && (
          <>
            <button
              onClick={handleSubmit}
              disabled={!pdfFile || !communeInput || !inseeInput}
              style={{ width: "100%", background: !pdfFile || !communeInput || !inseeInput ? "#A5B4FC" : "#4F46E5", color: "white", border: "none", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 700, cursor: !pdfFile ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
            >
              Analyser le PLU
            </button>
            {onManual && (
              <>
                <div style={{ textAlign: "center", margin: "14px 0 10px", fontSize: 12, color: "#94a3b8" }}>— ou —</div>
                <button onClick={onManual} style={{ width: "100%", background: "white", border: "1px solid #C7D2FE", borderRadius: 10, padding: "11px 20px", fontSize: 13, fontWeight: 600, color: "#4F46E5", cursor: "pointer" }}>
                  ✏️ Créer / saisir les zones manuellement
                </button>
                <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.5 }}>
                  Créez vos zones, puis collez le texte de chaque article : l'IA le structure et vous validez.
                </div>
              </>
            )}
            {onCancel && (
              <button onClick={onCancel} style={{ width: "100%", marginTop: 10, background: "none", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 20px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>
                ← Retour à la réglementation
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Réglementation screen ──────────────────────────────────────────────────────

type RuleRow = {
  id: string; zone_id: string; article_number: number | null; article_title: string | null;
  topic: string; rule_text: string; value_min: number | null; value_max: number | null;
  value_exact: number | null; unit: string | null; conditions: string | null; summary: string | null;
  instructor_note: string | null; validation_status: string;
};
type ZoneRow = {
  id: string; zone_code: string; zone_label: string; zone_type: string; summary: string | null;
  rules: RuleRow[];
  stats: { total: number; valide: number; brouillon: number; rejete: number };
};
type ReglData = { commune: { id: string; name: string; insee_code: string }; zones: ZoneRow[] };

const TOPIC_META: Record<string, { label: string; icon: string }> = {
  interdictions:    { label: "Occupations interdites",     icon: "🚫" },
  conditions:       { label: "Occupations sous conditions", icon: "⚠️" },
  desserte_voies:   { label: "Voies et accès",             icon: "🚗" },
  desserte_reseaux: { label: "Réseaux",                    icon: "🔌" },
  terrain_min:      { label: "Caractéristiques terrains",  icon: "📏" },
  recul_voie:       { label: "Implantation / voies",       icon: "🛣️" },
  recul_limite:     { label: "Implantation / limites",     icon: "📐" },
  recul_batiments:  { label: "Implantation entre bâtiments", icon: "🏢" },
  emprise_sol:      { label: "Emprise au sol",             icon: "🏠" },
  hauteur:          { label: "Hauteur max.",               icon: "📐" },
  aspect:           { label: "Aspect extérieur",           icon: "🎨" },
  stationnement:    { label: "Stationnement",              icon: "🅿️" },
  espaces_verts:    { label: "Espaces libres / plantations", icon: "🌳" },
  cos:              { label: "COS",                        icon: "📊" },
  destinations:     { label: "Destinations",               icon: "🏗️" },
  general:          { label: "Général",                    icon: "📋" },
};

// Structure nationale du règlement PLU (art. R.123-9) : 14 articles par zone.
// Articles 5 et 14 abrogés par la loi ALUR (24 mars 2014) → "sans objet".
const PLU_ARTICLES: Record<number, { title: string; topic: string; abroge?: boolean }> = {
  1:  { title: "Occupations et utilisations du sol interdites", topic: "interdictions" },
  2:  { title: "Occupations soumises à des conditions particulières", topic: "conditions" },
  3:  { title: "Desserte par les voies — accès aux voies ouvertes au public", topic: "desserte_voies" },
  4:  { title: "Desserte par les réseaux", topic: "desserte_reseaux" },
  5:  { title: "Caractéristiques des terrains (sans objet — loi ALUR)", topic: "terrain_min", abroge: true },
  6:  { title: "Implantation par rapport aux voies et emprises publiques", topic: "recul_voie" },
  7:  { title: "Implantation par rapport aux limites séparatives", topic: "recul_limite" },
  8:  { title: "Implantation des constructions les unes par rapport aux autres", topic: "recul_batiments" },
  9:  { title: "Emprise au sol des constructions", topic: "emprise_sol" },
  10: { title: "Hauteur maximale des constructions", topic: "hauteur" },
  11: { title: "Aspect extérieur et aménagement des abords", topic: "aspect" },
  12: { title: "Aires de stationnement", topic: "stationnement" },
  13: { title: "Espaces libres et plantations", topic: "espaces_verts" },
  14: { title: "Coefficient d'occupation des sols — COS (sans objet — loi ALUR)", topic: "cos", abroge: true },
};

const ZONE_TYPE_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  U:  { bg: "#EEF2FF", color: "#4338CA", border: "#C7D2FE", label: "Urbaine" },
  AU: { bg: "#FFF7ED", color: "#C2410C", border: "#FED7AA", label: "À urbaniser" },
  A:  { bg: "#FEFCE8", color: "#A16207", border: "#FDE68A", label: "Agricole" },
  N:  { bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0", label: "Naturelle" },
};

function ReglementationScreen({ commune, inseeCode }: { commune: string; inseeCode?: string }) {
  const [data, setData] = useState<ReglData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<RuleRow>>({});
  const [saving, setSaving] = useState(false);
  const [addingZoneId, setAddingZoneId] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<Partial<RuleRow>>({ topic: "recul_voie", article_number: null, rule_text: "", summary: "" });
  const [showUpload, setShowUpload] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [addingZone, setAddingZone] = useState(false);
  const [newZone, setNewZone] = useState({ code: "", label: "", type: "U" });
  const [savingZone, setSavingZone] = useState(false);
  const [purging, setPurging] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const analyzeArticle = async (zoneCode: string) => {
    if (pasteText.trim().length < 5) return;
    setAnalyzing(true);
    try {
      const r = await api.post<Partial<RuleRow>>("/mairie/reglementation/structure-article", {
        text: pasteText, zone_code: zoneCode, article_number: newRule.article_number ?? undefined,
      });
      setNewRule(f => ({ ...f, ...r }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l'analyse");
    } finally {
      setAnalyzing(false);
    }
  };

  const purgeAll = async () => {
    if (!inseeCode) { alert("Code INSEE de la commune introuvable."); return; }
    if (!confirm(`Vider toute la réglementation de ${commune} ? Cette action supprime toutes les zones et règles de cette commune.`)) return;
    setPurging(true);
    try {
      await api.delete(`/mairie/reglementation?insee_code=${encodeURIComponent(inseeCode)}`);
      setSelectedZoneId(null);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la suppression");
    } finally {
      setPurging(false);
    }
  };

  const load = () => {
    setLoading(true);
    setLoadError(null);
    const param = inseeCode
      ? `insee_code=${encodeURIComponent(inseeCode)}`
      : `commune_name=${encodeURIComponent(commune)}`;
    api.get<ReglData>(`/mairie/reglementation?${param}`)
      .then(d => {
        setData(d);
        if (d.zones[0] && !selectedZoneId) setSelectedZoneId(d.zones[0].id);
      })
      .catch(e => { setData(null); setLoadError(e.message ?? "Erreur de chargement"); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [commune, inseeCode]);

  const patchRule = async (id: string, patch: Partial<RuleRow>) => {
    setSaving(true);
    try {
      await api.patch(`/mairie/reglementation/rules/${id}`, patch);
      setData(prev => prev ? {
        ...prev,
        zones: prev.zones.map(z => ({
          ...z,
          rules: z.rules.map(r => r.id === id ? { ...r, ...patch } : r),
          stats: computeStats(z.rules.map(r => r.id === id ? { ...r, ...patch } : r)),
        })),
      } : null);
    } finally { setSaving(false); }
  };

  const deleteRule = async (id: string) => {
    if (!confirm("Supprimer cette règle ?")) return;
    await api.delete(`/mairie/reglementation/rules/${id}`);
    setData(prev => prev ? {
      ...prev,
      zones: prev.zones.map(z => ({
        ...z,
        rules: z.rules.filter(r => r.id !== id),
        stats: computeStats(z.rules.filter(r => r.id !== id)),
      })),
    } : null);
  };

  const addRule = async (zoneId: string) => {
    if (!newRule.rule_text || !newRule.topic) return;
    const created = await api.post<RuleRow>(`/mairie/reglementation/zones/${zoneId}/rules`, newRule);
    setData(prev => prev ? {
      ...prev,
      zones: prev.zones.map(z => z.id === zoneId
        ? { ...z, rules: [...z.rules, created], stats: computeStats([...z.rules, created]) }
        : z),
    } : null);
    setAddingZoneId(null);
    setNewRule({ topic: "recul_voie", article_number: null, rule_text: "", summary: "" });
    setPasteText("");
  };

  const addZone = async () => {
    if (!newZone.code.trim() || !newZone.label.trim()) return;
    setSavingZone(true);
    try {
      const created = await api.post<ZoneRow>("/mairie/reglementation/zones", {
        ...(inseeCode ? { insee_code: inseeCode } : { commune_name: commune }),
        zone_code: newZone.code.trim().toUpperCase(),
        zone_label: newZone.label.trim(),
        zone_type: newZone.type,
      });
      setData(prev => prev ? { ...prev, zones: [...prev.zones, { ...created, rules: [], stats: { total: 0, valide: 0, brouillon: 0, rejete: 0 } }] } : null);
      setSelectedZoneId(created.id);
      setAddingZone(false);
      setNewZone({ code: "", label: "", type: "U" });
    } finally { setSavingZone(false); }
  };

  const deleteZone = async (zoneId: string) => {
    if (!confirm("Supprimer cette zone et toutes ses règles ?")) return;
    await api.delete(`/mairie/reglementation/zones/${zoneId}`);
    setData(prev => prev ? { ...prev, zones: prev.zones.filter(z => z.id !== zoneId) } : null);
    if (selectedZoneId === zoneId) setSelectedZoneId(null);
  };

  const computeStats = (rules: RuleRow[]) => ({
    total: rules.length,
    valide: rules.filter(r => r.validation_status === "valide").length,
    brouillon: rules.filter(r => r.validation_status === "brouillon" || r.validation_status === "draft").length,
    rejete: rules.filter(r => r.validation_status === "rejete").length,
  });

  const selectedZone = data?.zones.find(z => z.id === selectedZoneId);
  const totalStats = data ? data.zones.reduce((acc, z) => ({
    total: acc.total + z.stats.total,
    valide: acc.valide + z.stats.valide,
  }), { total: 0, valide: 0 }) : null;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #E2E8F0", borderTopColor: "#4F46E5", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  if (!data || ((data.zones.length === 0 || showUpload) && !manualMode)) return (
    <PluUploadPanel
      commune={commune}
      inseeCode={inseeCode}
      onSuccess={() => { setShowUpload(false); load(); }}
      loadError={loadError}
      onCancel={data && data.zones.length > 0 ? () => setShowUpload(false) : undefined}
      onManual={() => { setManualMode(true); setShowUpload(false); }}
    />
  );

  const statusDot = (status: string) => {
    const s = status === "valide" ? { bg: "#DCFCE7", color: "#15803D", label: "Validée" }
      : status === "rejete" ? { bg: "#FEE2E2", color: "#DC2626", label: "Rejetée" }
      : { bg: "#FEF9C3", color: "#A16207", label: "À valider" };
    return (
      <span style={{ background: s.bg, color: s.color, borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>{s.label}</span>
    );
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 56px)", background: "#F8FAFC" }}>

      {/* ── Left: zone list ── */}
      <div style={{ width: 288, flexShrink: 0, borderRight: "1px solid #E2E8F0", background: "white", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #F1F5F9" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#000020" }}>Réglementation PLU</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(data?.zones.length ?? 0) > 0 && (
                <button onClick={purgeAll} disabled={purging} title="Vider la réglementation de cette commune" style={{ border: "1px solid #FECACA", background: "white", borderRadius: 7, padding: "4px 9px", fontSize: 11, color: "#DC2626", cursor: purging ? "wait" : "pointer", fontWeight: 600 }}>{purging ? "Suppression…" : "🗑 Vider"}</button>
              )}
              <button onClick={() => { setManualMode(false); setShowUpload(true); }} title="Importer un PLU (PDF)" style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 7, padding: "4px 9px", fontSize: 11, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}>↑ Importer PDF</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>{commune}</div>
          {totalStats && (
            <div style={{ marginTop: 12, background: "#F8FAFC", borderRadius: 10, padding: "10px 14px", border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "#6B7280" }}>Progression globale</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5" }}>
                  {totalStats.valide} / {totalStats.total}
                </span>
              </div>
              <div style={{ height: 6, background: "#E2E8F0", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${totalStats.total ? (totalStats.valide / totalStats.total) * 100 : 0}%`, background: "#4F46E5", borderRadius: 99, transition: "width 0.3s" }} />
              </div>
            </div>
          )}
        </div>

        {/* Zone cards */}
        <div style={{ flex: 1, padding: "12px 12px" }}>
          {data.zones.map(zone => {
            const ts = ZONE_TYPE_STYLE[zone.zone_type] ?? ZONE_TYPE_STYLE["U"]!;
            const pct = zone.stats.total ? Math.round((zone.stats.valide / zone.stats.total) * 100) : 0;
            const isSelected = zone.id === selectedZoneId;
            return (
              <button key={zone.id} onClick={() => setSelectedZoneId(zone.id)} style={{
                width: "100%", border: `1px solid ${isSelected ? "#4F46E5" : "#E2E8F0"}`, borderRadius: 10, padding: "12px 14px",
                background: isSelected ? "#EEF2FF" : "white", marginBottom: 6, cursor: "pointer", textAlign: "left",
                transition: "all 0.12s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ background: ts.bg, color: ts.color, border: `1px solid ${ts.border}`, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                    {zone.zone_code}
                  </span>
                  <span style={{ fontSize: 12, color: "#374151", fontWeight: isSelected ? 600 : 400, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {zone.zone_label.replace(/^Zone [A-Z0-9]+ [-–] /, "")}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: "#F1F5F9", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#22C55E" : "#4F46E5", borderRadius: 99, transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: 11, color: pct === 100 ? "#16A34A" : "#6B7280", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {pct === 100 ? "✓ Tout validé" : `${zone.stats.valide}/${zone.stats.total}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Nouvelle zone ── */}
        <div style={{ padding: "12px 12px 16px", borderTop: "1px solid #F1F5F9" }}>
          {addingZone ? (
            <div style={{ background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0", padding: 12 }}>
              <input
                value={newZone.code}
                onChange={e => {
                  const code = e.target.value.toUpperCase();
                  // Type déduit automatiquement du code (surchargeable via le menu).
                  const type = /^[0-9]*AU/.test(code) ? "AU"
                    : code.startsWith("U") ? "U"
                    : code.startsWith("A") ? "A"
                    : code.startsWith("N") ? "N"
                    : newZone.type;
                  setNewZone(z => ({ ...z, code, type }));
                }}
                placeholder="Code (ex : Ni)"
                style={{ width: "100%", padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none", marginBottom: 8, boxSizing: "border-box" as const }}
              />
              <input
                value={newZone.label} onChange={e => setNewZone(z => ({ ...z, label: e.target.value }))}
                placeholder="Libellé (ex : Zone Ni – Naturelle inondable)"
                style={{ width: "100%", padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none", marginBottom: 8, boxSizing: "border-box" as const }}
              />
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Type (déduit du code — modifiable)</div>
              <select value={newZone.type} onChange={e => setNewZone(z => ({ ...z, type: e.target.value }))}
                style={{ width: "100%", padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none", marginBottom: 10, background: "white", boxSizing: "border-box" as const }}>
                <option value="U">U — Urbaine</option>
                <option value="AU">AU — À urbaniser</option>
                <option value="A">A — Agricole</option>
                <option value="N">N — Naturelle</option>
              </select>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setAddingZone(false); setNewZone({ code: "", label: "", type: "U" }); }} style={{ flex: 1, padding: "7px 0", border: "1px solid #E2E8F0", background: "white", borderRadius: 7, fontSize: 12, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                <button onClick={addZone} disabled={savingZone || !newZone.code || !newZone.label} style={{ flex: 1, padding: "7px 0", border: "none", background: "#4F46E5", color: "white", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {savingZone ? "…" : "Créer"}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingZone(true)} style={{ width: "100%", padding: "8px 0", border: "1px dashed #C7D2FE", background: "#F5F3FF", borderRadius: 8, fontSize: 12, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}>
              + Nouvelle zone
            </button>
          )}
        </div>
      </div>

      {/* ── Right: rules ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        {!selectedZone ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#9CA3AF", fontSize: 14 }}>
            ← Sélectionnez une zone
          </div>
        ) : (
          <>
            {/* Zone header */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                {(() => { const ts = ZONE_TYPE_STYLE[selectedZone.zone_type] ?? ZONE_TYPE_STYLE["U"]!; return (
                  <span style={{ background: ts.bg, color: ts.color, border: `1px solid ${ts.border}`, borderRadius: 8, padding: "4px 12px", fontSize: 13, fontWeight: 700 }}>
                    {selectedZone.zone_code} — {ts.label}
                  </span>
                ); })()}
                <span style={{ fontSize: 16, fontWeight: 700, color: "#000020", flex: 1 }}>{selectedZone.zone_label}</span>
                <button onClick={() => deleteZone(selectedZone.id)} title="Supprimer la zone" style={{ border: "1px solid #FECACA", background: "#FFF5F5", borderRadius: 7, padding: "4px 10px", fontSize: 11, color: "#EF4444", cursor: "pointer" }}>✕ Zone</button>
              </div>
              {selectedZone.summary && (
                <p style={{ fontSize: 13, color: "#6B7280", margin: 0 }}>{selectedZone.summary}</p>
              )}
            </div>

            {/* Rules list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selectedZone.rules.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#9CA3AF", background: "white", borderRadius: 12, border: "1px dashed #E2E8F0" }}>
                  Aucune règle pour cette zone.
                </div>
              )}

              {selectedZone.rules.map(rule => {
                const meta = TOPIC_META[rule.topic] ?? { label: rule.topic, icon: "📋" };
                const isEditing = editingId === rule.id;
                const statusColor = rule.validation_status === "valide" ? "#22C55E"
                  : rule.validation_status === "rejete" ? "#EF4444" : "#F59E0B";

                return (
                  <div key={rule.id} style={{
                    background: "white", borderRadius: 12, border: "1px solid #E2E8F0",
                    borderLeft: `4px solid ${statusColor}`, overflow: "hidden",
                  }}>
                    {/* Rule header */}
                    <div style={{ padding: "14px 18px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            {rule.article_number ? `Art. ${rule.article_number} • ` : ""}{meta.label}
                          </span>
                          {statusDot(rule.validation_status)}
                        </div>
                        {!isEditing && (
                          <>
                            <p style={{ margin: "0 0 4px", fontSize: 13, color: "#111827", lineHeight: 1.5 }}>{rule.rule_text}</p>
                            {(rule.value_min != null || rule.value_max != null || rule.value_exact != null) && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                {rule.value_min != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#374151" }}>min {rule.value_min} {rule.unit}</span>}
                                {rule.value_max != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#374151" }}>max {rule.value_max} {rule.unit}</span>}
                                {rule.value_exact != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#374151" }}>{rule.value_exact} {rule.unit}</span>}
                                {rule.conditions && <span style={{ background: "#FFF7ED", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#C2410C" }}>⚠ {rule.conditions}</span>}
                              </div>
                            )}
                          </>
                        )}

                        {/* Inline edit form */}
                        {isEditing && (
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                            <textarea
                              style={{ width: "100%", minHeight: 72, borderRadius: 8, border: "1px solid #C7D2FE", padding: "8px 10px", fontSize: 13, resize: "vertical", outline: "none", fontFamily: "inherit" }}
                              value={editForm.rule_text ?? rule.rule_text}
                              onChange={e => setEditForm(f => ({ ...f, rule_text: e.target.value }))}
                            />
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {[["value_min", "Min"], ["value_max", "Max"], ["value_exact", "Exact"]].map(([field, label]) => (
                                <label key={field} style={{ fontSize: 11, color: "#6B7280", display: "flex", alignItems: "center", gap: 4 }}>
                                  {label}
                                  <input type="number" style={{ width: 70, borderRadius: 6, border: "1px solid #E2E8F0", padding: "4px 6px", fontSize: 12, outline: "none" }}
                                    value={(editForm[field as keyof RuleRow] ?? rule[field as keyof RuleRow]) as number ?? ""}
                                    onChange={e => setEditForm(f => ({ ...f, [field as string]: e.target.value === "" ? null : Number(e.target.value) }))}
                                  />
                                </label>
                              ))}
                              <label style={{ fontSize: 11, color: "#6B7280", display: "flex", alignItems: "center", gap: 4 }}>
                                Unité
                                <select style={{ borderRadius: 6, border: "1px solid #E2E8F0", padding: "4px 6px", fontSize: 12, outline: "none" }}
                                  value={(editForm.unit ?? rule.unit) ?? ""}
                                  onChange={e => setEditForm(f => ({ ...f, unit: e.target.value || null }))}>
                                  <option value="">—</option>
                                  <option value="m">m</option>
                                  <option value="%">%</option>
                                  <option value="m²">m²</option>
                                  <option value="places">places</option>
                                </select>
                              </label>
                            </div>
                            <input style={{ borderRadius: 8, border: "1px solid #E2E8F0", padding: "6px 10px", fontSize: 12, outline: "none" }}
                              placeholder="Conditions particulières…"
                              value={(editForm.conditions ?? rule.conditions) ?? ""}
                              onChange={e => setEditForm(f => ({ ...f, conditions: e.target.value || null }))}
                            />
                            <input style={{ borderRadius: 8, border: "1px solid #E2E8F0", padding: "6px 10px", fontSize: 12, outline: "none" }}
                              placeholder="Résumé (10 mots max)…"
                              value={(editForm.summary ?? rule.summary) ?? ""}
                              onChange={e => setEditForm(f => ({ ...f, summary: e.target.value || null }))}
                            />
                            <div style={{ display: "flex", gap: 8 }}>
                              <button onClick={async () => { await patchRule(rule.id, { ...editForm, validation_status: "valide" }); setEditingId(null); setEditForm({}); }} disabled={saving}
                                style={{ background: "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                {saving ? "…" : "Sauvegarder & Valider"}
                              </button>
                              <button onClick={() => { setEditingId(null); setEditForm({}); }}
                                style={{ background: "#F1F5F9", color: "#374151", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
                                Annuler
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      {!isEditing && (
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          {rule.validation_status !== "valide" && (
                            <button title="Valider" onClick={() => patchRule(rule.id, { validation_status: "valide" })}
                              style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #BBF7D0", background: "#F0FDF4", color: "#16A34A", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</button>
                          )}
                          {rule.validation_status !== "rejete" && (
                            <button title="Rejeter" onClick={() => patchRule(rule.id, { validation_status: "rejete" })}
                              style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✗</button>
                          )}
                          <button title="Modifier" onClick={() => { setEditingId(rule.id); setEditForm({}); }}
                            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#6B7280", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✏</button>
                          <button title="Supprimer" onClick={() => deleteRule(rule.id)}
                            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#9CA3AF", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>🗑</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add rule button */}
              {addingZoneId !== selectedZone.id ? (
                <button onClick={() => setAddingZoneId(selectedZone.id)}
                  style={{ width: "100%", padding: "12px", border: "2px dashed #C7D2FE", borderRadius: 12, background: "transparent", color: "#4F46E5", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
                  + Ajouter une règle
                </button>
              ) : (
                <div style={{ background: "white", borderRadius: 12, border: "1px solid #C7D2FE", padding: "16px 18px" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 12 }}>Nouvelle règle</div>

                  {/* Coller le texte de l'article → structuration IA (texte court, pas le PDF) */}
                  <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#6D28D9", marginBottom: 6 }}>✨ Coller le texte de l'article — l'IA remplit les champs</div>
                    <textarea placeholder="Collez ici le texte de l'article du PLU…" style={{ width: "100%", minHeight: 60, borderRadius: 8, border: "1px solid #DDD6FE", padding: "8px 10px", fontSize: 12, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                      value={pasteText}
                      onChange={e => setPasteText(e.target.value)}
                    />
                    <button onClick={() => analyzeArticle(selectedZone.zone_code)} disabled={analyzing || pasteText.trim().length < 5}
                      style={{ marginTop: 6, background: analyzing ? "#A78BFA" : "#7C3AED", color: "white", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: analyzing ? "wait" : "pointer" }}>
                      {analyzing ? "Analyse…" : "Analyser et pré-remplir"}
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <select style={{ borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none", flex: 1 }}
                      value={newRule.topic ?? "recul_voie"}
                      onChange={e => setNewRule(f => ({ ...f, topic: e.target.value }))}>
                      {Object.entries(TOPIC_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                    </select>
                    <input type="number" placeholder="Art. n°" style={{ width: 80, borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      value={newRule.article_number ?? ""}
                      onChange={e => {
                        const n = e.target.value === "" ? null : Number(e.target.value);
                        const def = n != null ? PLU_ARTICLES[n] : undefined;
                        // Auto-remplit titre + thème depuis la grille R.123-9 (modifiable ensuite).
                        setNewRule(f => ({ ...f, article_number: n, ...(def ? { topic: def.topic, article_title: def.title } : {}) }));
                      }}
                    />
                  </div>
                  <textarea placeholder="Texte de la règle…" style={{ width: "100%", minHeight: 72, borderRadius: 8, border: "1px solid #E2E8F0", padding: "8px 10px", fontSize: 13, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                    value={newRule.rule_text ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, rule_text: e.target.value }))}
                  />
                  {/* Valeurs structurées */}
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <input type="number" placeholder="Min" style={{ width: 70, borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      value={newRule.value_min ?? ""}
                      onChange={e => setNewRule(f => ({ ...f, value_min: e.target.value === "" ? null : Number(e.target.value) }))}
                    />
                    <input type="number" placeholder="Max" style={{ width: 70, borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      value={newRule.value_max ?? ""}
                      onChange={e => setNewRule(f => ({ ...f, value_max: e.target.value === "" ? null : Number(e.target.value) }))}
                    />
                    <input type="number" placeholder="Exact" style={{ width: 70, borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      value={newRule.value_exact ?? ""}
                      onChange={e => setNewRule(f => ({ ...f, value_exact: e.target.value === "" ? null : Number(e.target.value) }))}
                    />
                    <select style={{ width: 90, borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      value={newRule.unit ?? ""}
                      onChange={e => setNewRule(f => ({ ...f, unit: e.target.value || null }))}>
                      <option value="">unité</option>
                      <option value="m">m</option>
                      <option value="%">%</option>
                      <option value="m²">m²</option>
                      <option value="places">places</option>
                    </select>
                  </div>
                  <input placeholder="Conditions / sous-secteurs (ex: UBai: 10%)" style={{ marginTop: 6, width: "100%", borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                    value={newRule.conditions ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, conditions: e.target.value || null }))}
                  />
                  <input placeholder="Résumé (10 mots max)" style={{ marginTop: 6, width: "100%", borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                    value={newRule.summary ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, summary: e.target.value }))}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => addRule(selectedZone.id)}
                      style={{ background: "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      Ajouter
                    </button>
                    <button onClick={() => setAddingZoneId(null)}
                      style={{ background: "#F1F5F9", color: "#374151", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const TIME_SLOTS = Array.from({ length: 32 }, (_, i) => {
  const h = Math.floor(i / 2) + 6;
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

const REASON_LABELS: Record<string, string> = {
  conges: "Congés", maladie: "Maladie", formation: "Formation", autre: "Autre",
};

type Absence = { id: string; start_date: string; end_date: string; reason: string; note: string | null; delegate_user_id: string | null; delegate_prenom: string | null; delegate_nom: string | null };

function DisponibilitesPanel() {
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("08:30");
  const [endTime, setEndTime] = useState("17:30");
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loadingAvail, setLoadingAvail] = useState(true);
  const [savingAvail, setSavingAvail] = useState(false);
  const [availMsg, setAvailMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [showNewAbsence, setShowNewAbsence] = useState(false);
  const [absStart, setAbsStart] = useState("");
  const [absEnd, setAbsEnd] = useState("");
  const [absReason, setAbsReason] = useState("conges");
  const [absNote, setAbsNote] = useState("");
  const [savingAbs, setSavingAbs] = useState(false);
  const [absMsg, setAbsMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<{ working_days: number[]; start_time: string; end_time: string; absences: Absence[] }>("/mairie/my-availability")
      .then(d => { setWorkingDays(d.working_days); setStartTime(d.start_time); setEndTime(d.end_time); setAbsences(d.absences); })
      .catch(() => {})
      .finally(() => setLoadingAvail(false));
  }, []);

  const toggleDay = (day: number) => setWorkingDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort());

  const saveAvail = async () => {
    setSavingAvail(true); setAvailMsg(null);
    try {
      await api.put("/mairie/my-availability", { working_days: workingDays, start_time: startTime, end_time: endTime });
      setAvailMsg({ ok: true, text: "Disponibilités enregistrées." });
    } catch (e) { setAvailMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" }); }
    finally { setSavingAvail(false); }
  };

  const addAbsence = async () => {
    if (!absStart || !absEnd) { setAbsMsg({ ok: false, text: "Dates requises." }); return; }
    if (absStart > absEnd) { setAbsMsg({ ok: false, text: "La date de début doit être avant la date de fin." }); return; }
    setSavingAbs(true); setAbsMsg(null);
    try {
      const row = await api.post<Absence>("/mairie/my-absences", { start_date: absStart, end_date: absEnd, reason: absReason, note: absNote || undefined });
      setAbsences(prev => [...prev, row]);
      setShowNewAbsence(false); setAbsStart(""); setAbsEnd(""); setAbsReason("conges"); setAbsNote("");
    } catch (e) { setAbsMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" }); }
    finally { setSavingAbs(false); }
  };

  const deleteAbsence = async (id: string) => {
    try {
      await api.delete(`/mairie/my-absences/${id}`);
      setAbsences(prev => prev.filter(a => a.id !== id));
    } catch { /* ignore */ }
  };

  if (loadingAvail) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = absences.filter(a => a.end_date >= today);
  const past = absences.filter(a => a.end_date < today);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Horaires */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Disponibilités</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Définissez vos plages de disponibilité pour le traitement des dossiers.</div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 10 }}>Jours travaillés</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["Lun",1],["Mar",2],["Mer",3],["Jeu",4],["Ven",5],["Sam",6],["Dim",0]].map(([label, day]) => {
              const active = workingDays.includes(day as number);
              return (
                <button key={String(day)} onClick={() => toggleDay(day as number)} style={{ width: 40, height: 40, borderRadius: 8, border: active ? "2px solid #4F46E5" : "1px solid #E2E8F0", background: active ? "#EEF2FF" : "white", color: active ? "#4F46E5" : "#94a3b8", fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer" }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 10 }}>Horaires</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Début</div>
              <select value={startTime} onChange={e => setStartTime(e.target.value)} style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <span style={{ color: "#94a3b8", marginTop: 16 }}>—</span>
            <div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Fin</div>
              <select value={endTime} onChange={e => setEndTime(e.target.value)} style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>

        {availMsg && <div style={{ background: availMsg.ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${availMsg.ok ? "#86EFAC" : "#FECACA"}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: availMsg.ok ? "#15803d" : "#DC2626", marginBottom: 14 }}>{availMsg.text}</div>}
        <button onClick={saveAvail} disabled={savingAvail} style={{ background: savingAvail ? "#A5B4FC" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: savingAvail ? "not-allowed" : "pointer" }}>
          {savingAvail ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {/* Absences */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Absences et congés</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Planifiez vos absences pour informer l'équipe.</div>
          </div>
          <button onClick={() => { setShowNewAbsence(true); setAbsMsg(null); }} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Nouvelle absence</button>
        </div>

        {showNewAbsence && (
          <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" as const }}>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Du</div>
                <input type="date" value={absStart} onChange={e => setAbsStart(e.target.value)} style={{ padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Au</div>
                <input type="date" value={absEnd} onChange={e => setAbsEnd(e.target.value)} style={{ padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Motif</div>
                <select value={absReason} onChange={e => setAbsReason(e.target.value)} style={{ padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }}>
                  {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Note (optionnel)</div>
                <input value={absNote} onChange={e => setAbsNote(e.target.value)} placeholder="ex : dossiers redirigés vers…" style={{ width: "100%", padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
              </div>
            </div>
            {absMsg && <div style={{ background: absMsg.ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${absMsg.ok ? "#86EFAC" : "#FECACA"}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: absMsg.ok ? "#15803d" : "#DC2626", marginBottom: 10 }}>{absMsg.text}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addAbsence} disabled={savingAbs} style={{ background: savingAbs ? "#A5B4FC" : "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: savingAbs ? "not-allowed" : "pointer" }}>{savingAbs ? "Ajout…" : "Ajouter"}</button>
              <button onClick={() => setShowNewAbsence(false)} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 8, padding: "7px 14px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}

        {upcoming.length === 0 && past.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0" }}>Aucune absence enregistrée.</div>}

        {upcoming.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>À venir / En cours</div>
            {upcoming.map(a => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#C2410C" }}>
                    {REASON_LABELS[a.reason] ?? a.reason} — {new Date(a.start_date).toLocaleDateString("fr-FR")} au {new Date(a.end_date).toLocaleDateString("fr-FR")}
                  </div>
                  {a.note && <div style={{ fontSize: 11, color: "#92400E", marginTop: 2 }}>{a.note}</div>}
                </div>
                <button onClick={() => deleteAbsence(a.id)} title="Supprimer" style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 16, padding: 4, lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 12, color: "#94a3b8", cursor: "pointer", userSelect: "none" as const }}>Absences passées ({past.length})</summary>
            <div style={{ marginTop: 8 }}>
              {past.map(a => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ flex: 1, fontSize: 12, color: "#64748b" }}>
                    {REASON_LABELS[a.reason] ?? a.reason} — {new Date(a.start_date).toLocaleDateString("fr-FR")} au {new Date(a.end_date).toLocaleDateString("fr-FR")}
                    {a.note && <span style={{ marginLeft: 8, fontStyle: "italic" }}>{a.note}</span>}
                  </div>
                  <button onClick={() => deleteAbsence(a.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#CBD5E1", fontSize: 14, padding: 4 }}>✕</button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function InfosPersoScreen() {
  const { user, refreshUser } = useAuth();
  const [stab, setStab] = useState("À propos");

  // ── À propos state ──
  const [prenom, setPrenom] = useState(user?.prenom ?? "");
  const [nom, setNom] = useState(user?.nom ?? "");
  const [telephone, setTelephone] = useState(user?.telephone ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (user) { setPrenom(user.prenom); setNom(user.nom); setTelephone(user.telephone ?? ""); }
  }, [user?.id]);

  const saveProfile = async () => {
    setSavingProfile(true); setProfileMsg(null);
    try {
      await api.patch("/auth/me", { prenom, nom, telephone });
      await refreshUser();
      setProfileMsg({ ok: true, text: "Profil mis à jour." });
    } catch (e) {
      setProfileMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur serveur" });
    } finally { setSavingProfile(false); }
  };

  // ── Communes state ──
  const [myCommunes, setMyCommunes] = useState<{ name: string; insee_code: string | null }[]>([]);
  useEffect(() => {
    api.get<{ name: string; insee_code: string | null }[]>("/mairie/my-communes")
      .then(setMyCommunes).catch(() => {});
  }, []);

  // ── Password state ──
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async () => {
    if (pwNew !== pwConfirm) { setPwMsg({ ok: false, text: "Les mots de passe ne correspondent pas." }); return; }
    if (pwNew.length < 8) { setPwMsg({ ok: false, text: "Le mot de passe doit faire au moins 8 caractères." }); return; }
    setSavingPw(true); setPwMsg(null);
    try {
      await api.patch("/auth/me/password", { current_password: pwCurrent, new_password: pwNew });
      setPwMsg({ ok: true, text: "Mot de passe modifié." });
      setPwCurrent(""); setPwNew(""); setPwConfirm("");
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur serveur" });
    } finally { setSavingPw(false); }
  };

  const navItems = [
    { label: "À propos", icon: "👤" },
    { label: "Communes & Rôles", icon: "🏛" },
    { label: "Disponibilités", icon: "📅" },
    { label: "Délégations", icon: "🤝" },
    { label: "Mes Signatures", icon: "✍️" },
    { label: "Notifications", icon: "🔔" },
    { label: "Préférences", icon: "⚙️" },
    { label: "Sécurité / Connexion", icon: "🔒" },
    { label: "Centre d'aide", icon: "❓" },
  ];

  const initials = user ? `${user.prenom[0] ?? ""}${user.nom[0] ?? ""}`.toUpperCase() : "?";
  const fullName = user ? `${user.prenom} ${user.nom}` : "—";
  const roleLabel = user?.role === "instructeur" ? "Instructeur" : user?.role === "admin" ? "Administrateur" : "Mairie";

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Informations personnelles</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Gérez votre profil, vos préférences et vos paramètres de sécurité.</p>
      </div>

      {/* Profile header */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24, marginBottom: 20, display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg, #4F46E5, #7C3AED)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: "white", flexShrink: 0 }}>{initials}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>{fullName}</div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>{user?.email}{user?.commune ? ` — Commune de ${user.commune}` : ""}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 10px" }}>{roleLabel}</span>
            <span style={{ background: "#F0FDF4", color: "#15803D", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 10px" }}>Actif</span>
          </div>
        </div>
        <button onClick={() => setStab("À propos")} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#374151", cursor: "pointer" }}>Modifier le profil</button>
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        {/* Left nav */}
        <div style={{ width: 220, flexShrink: 0 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
            {navItems.map((item) => (
              <button key={item.label} onClick={() => setStab(item.label)} style={{
                width: "100%", border: "none", background: stab === item.label ? "#EEF2FF" : "transparent",
                display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
                fontSize: 13, fontWeight: stab === item.label ? 600 : 400,
                color: stab === item.label ? "#4F46E5" : "#374151",
                cursor: "pointer", textAlign: "left",
                borderLeft: stab === item.label ? "3px solid #4F46E5" : "3px solid transparent",
                borderBottom: "1px solid #F1F5F9",
              }}>
                <span style={{ fontSize: 14 }}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1 }}>
          {stab === "À propos" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>À propos</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                {([["Prénom", prenom, setPrenom], ["Nom", nom, setNom]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
                    <input value={val} onChange={e => setter(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>E-mail</div>
                  <div style={{ padding: "8px 10px", border: "1px solid #F1F5F9", borderRadius: 8, fontSize: 13, color: "#94a3b8", background: "#F8FAFC" }}>{user?.email}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Téléphone</div>
                  <input value={telephone} onChange={e => setTelephone(e.target.value)} placeholder="ex : 02 47 00 00 00" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
                </div>
              </div>
              {profileMsg && (
                <div style={{ background: profileMsg.ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${profileMsg.ok ? "#86EFAC" : "#FECACA"}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: profileMsg.ok ? "#15803d" : "#DC2626", marginBottom: 12 }}>
                  {profileMsg.text}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={() => { setPrenom(user?.prenom ?? ""); setNom(user?.nom ?? ""); setTelephone(user?.telephone ?? ""); setProfileMsg(null); }} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                <button onClick={saveProfile} disabled={savingProfile} style={{ background: savingProfile ? "#A5B4FC" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: savingProfile ? "not-allowed" : "pointer" }}>
                  {savingProfile ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          )}

          {stab === "Communes & Rôles" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Communes & Rôles</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Communes auxquelles vous avez accès et rôles associés.</div>
              {myCommunes.length === 0 ? (
                <div style={{ color: "#94a3b8", fontSize: 13, padding: "12px 0" }}>Aucune commune assignée. Contactez un administrateur.</div>
              ) : myCommunes.map((c, i) => (
                <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #F1F5F9" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: i === 0 ? "#EEF2FF" : "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🏛</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{c.name}</div>
                    {c.insee_code && <div style={{ fontSize: 11, color: "#64748b" }}>INSEE : {c.insee_code}</div>}
                  </div>
                  <span style={{ background: i === 0 ? "#EEF2FF" : "#F8FAFC", color: i === 0 ? "#4F46E5" : "#64748b", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 10px" }}>{roleLabel}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{i === 0 ? "Principal" : "Secondaire"}</span>
                </div>
              ))}
            </div>
          )}

          {stab === "Disponibilités" && <DisponibilitesPanel />}

          {stab === "Délégations" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Délégations</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>Gérez les délégations de traitement de dossiers.</div>
                </div>
                <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Nouvelle délégation</button>
              </div>
              {[
                { to: "Julien D.", type: "Permis de construire", period: "27 mai – 3 juin 2024", status: "À venir" },
                { to: "Claire P.", type: "Tous les dossiers", period: "15 – 22 avr. 2024", status: "Terminé" },
              ].map((d, i) => (
                <div key={i} style={{ padding: "14px 0", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{d.to.split(" ").map(w => w[0]).join("")}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{d.to}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{d.type} · {d.period}</div>
                  </div>
                  <StatusBadge status={d.status === "À venir" ? "En attente" : "Terminé"} />
                </div>
              ))}
            </div>
          )}

          {stab === "Mes Signatures" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Mes Signatures</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Signatures électroniques utilisées dans vos courriers et arrêtés.</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                <div style={{ flex: 1, border: "2px solid #4F46E5", borderRadius: 12, padding: 20, position: "relative" }}>
                  <span style={{ position: "absolute", top: 10, right: 10, background: "#EEF2FF", color: "#4F46E5", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px" }}>Par défaut</span>
                  <div style={{ height: 60, background: "#F8FAFC", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: "cursive", fontSize: 22, color: "#0F172A" }}>Marie Lecomte</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Signature principale — utilisée par défaut</div>
                </div>
                <div style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 12, padding: 20, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#94a3b8" }}>
                  <span style={{ fontSize: 28 }}>+</span>
                  <span style={{ fontSize: 12 }}>Ajouter une signature</span>
                </div>
              </div>
            </div>
          )}

          {stab === "Notifications" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Notifications personnelles</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Préférences de notification pour votre compte uniquement.</div>
              {[
                { label: "Dossier assigné", sub: "Quand un dossier m'est assigné", active: true },
                { label: "Message reçu", sub: "Quand je reçois un nouveau message", active: true },
                { label: "Délai proche", sub: "48h avant une échéance", active: true },
                { label: "Délai dépassé", sub: "Quand un délai est dépassé sur mes dossiers", active: true },
                { label: "Avis reçu", sub: "Quand un service rend son avis", active: false },
                { label: "Mises à jour plateforme", sub: "Nouvelles fonctionnalités et correctifs", active: false },
              ].map(n => (
                <div key={n.label} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F8FAFC" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{n.label}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{n.sub}</div>
                  </div>
                  <div style={{ width: 36, height: 20, borderRadius: 10, background: n.active ? "#4F46E5" : "#E2E8F0", position: "relative", cursor: "pointer" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: n.active ? 18 : 2, boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {stab === "Préférences" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>Préférences d'affichage</div>
              {[
                { label: "Langue", value: "Français" },
                { label: "Fuseau horaire", value: "Europe/Paris (UTC+2)" },
                { label: "Format de date", value: "DD/MM/YYYY" },
                { label: "Dossiers par page", value: "20" },
              ].map(p => (
                <div key={p.label} style={{ display: "flex", alignItems: "center", marginBottom: 14, gap: 16 }}>
                  <div style={{ width: 180, fontSize: 13, color: "#374151", fontWeight: 500 }}>{p.label}</div>
                  <select style={{ flex: 1, padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151" }}><option>{p.value}</option></select>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 16, marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Thème</div>
                <div style={{ display: "flex", gap: 10 }}>
                  {[["Clair","☀️",true],["Sombre","🌙",false],["Système","💻",false]].map(([l,ic,active]) => (
                    <button key={String(l)} style={{ flex: 1, border: active ? "2px solid #4F46E5" : "1px solid #E2E8F0", background: active ? "#EEF2FF" : "white", borderRadius: 10, padding: "12px 8px", cursor: "pointer", textAlign: "center" }}>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{ic as string}</div>
                      <div style={{ fontSize: 12, color: active ? "#4F46E5" : "#374151", fontWeight: active ? 600 : 400 }}>{l as string}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
                <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
              </div>
            </div>
          )}

          {stab === "Sécurité / Connexion" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Mot de passe</div>
                {([["Mot de passe actuel", pwCurrent, setPwCurrent], ["Nouveau mot de passe", pwNew, setPwNew], ["Confirmer le nouveau mot de passe", pwConfirm, setPwConfirm]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
                  <div key={label} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{label}</div>
                    <input type="password" value={val} onChange={e => setter(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} placeholder="••••••••" />
                  </div>
                ))}
                {pwMsg && (
                  <div style={{ background: pwMsg.ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${pwMsg.ok ? "#86EFAC" : "#FECACA"}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: pwMsg.ok ? "#15803d" : "#DC2626", marginBottom: 12 }}>
                    {pwMsg.text}
                  </div>
                )}
                <button onClick={changePassword} disabled={savingPw || !pwCurrent || !pwNew || !pwConfirm} style={{ background: savingPw || !pwCurrent || !pwNew || !pwConfirm ? "#A5B4FC" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: savingPw ? "not-allowed" : "pointer", marginTop: 4 }}>
                  {savingPw ? "Modification…" : "Modifier le mot de passe"}
                </button>
              </div>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Double authentification (2FA)</div>
                  <div style={{ width: 36, height: 20, borderRadius: 10, background: "#E2E8F0", position: "relative", cursor: "not-allowed" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: 2, boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>Fonctionnalité à venir — authentification double facteur par application TOTP.</div>
              </div>
            </div>
          )}

          {stab === "Centre d'aide" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Centre d'aide</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Documentation, tutoriels et support.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                {[{ icon: "📖", title: "Documentation", sub: "Guides complets sur toutes les fonctionnalités" }, { icon: "🎥", title: "Tutoriels vidéo", sub: "Apprenez avec nos tutoriels pas à pas" }, { icon: "💬", title: "Chat support", sub: "Discutez avec notre équipe de support" }, { icon: "📧", title: "Contacter le support", sub: "Envoyez-nous un message" }].map(c => (
                  <button key={c.title} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 12, padding: 16, cursor: "pointer", textAlign: "left" }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{c.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>{c.title}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{c.sub}</div>
                  </button>
                ))}
              </div>
              <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 10 }}>Questions fréquentes</div>
                {["Comment créer un nouveau dossier ?","Comment assigner un dossier à un instructeur ?","Comment envoyer une demande de pièce complémentaire ?","Comment consulter les statistiques de ma commune ?"].map(q => (
                  <div key={q} style={{ padding: "8px 0", borderBottom: "1px solid #E2E8F0", fontSize: 13, color: "#4F46E5", cursor: "pointer" }}>→ {q}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type DossierInfo = {
  id: string; numero: string; type: string; petitionnaire: string; adresse: string;
  status: string; echeance: string; date_depot?: string;
  description?: string; parcelle?: string; surface_plancher?: string;
  commune?: string; code_postal?: string; instructeur?: string;
  lat?: number; lng?: number;
};

type DecisionStatus = "brouillon" | "soumis_signature" | "revision_necessaire" | "signe" | "notifie" | "archive";

type DecisionData = {
  id: string;
  dossier_id: string;
  commune: string;
  type: string;
  motif: string | null;
  prescriptions: string[];
  conditions: string | null;
  status: DecisionStatus;
  instructeur_id: string;
  signataire_id: string | null;
  arrete_numero: string | null;
  date_decision: string | null;
  date_notification: string | null;
  date_limite_recours: string | null;
  motif_refus_signature: string | null;
  created_at: string;
  updated_at: string;
  signataire?: { id: string; prenom: string; nom: string; email: string } | null;
};

type SignataireRow = {
  id: string;
  user_id: string;
  commune: string;
  role: string;
  delegation_arrete: string | null;
  active: boolean;
  user: { id: string; prenom: string; nom: string; email: string } | null;
};

const DECISION_OPTIONS: Record<string, Array<{ key: string; label: string; sub: string }>> = {
  permis_de_construire: [
    { key: "accord", label: "Accord", sub: "Autorisation accordée" },
    { key: "accord_prescription", label: "Accord avec prescriptions", sub: "Sous conditions" },
    { key: "refus", label: "Refus", sub: "Opposition au projet" },
    { key: "sursis_a_statuer", label: "Sursis à statuer", sub: "Décision différée" },
  ],
  declaration_prealable: [
    { key: "non_opposition", label: "Non-opposition", sub: "Travaux autorisés" },
    { key: "non_opposition_prescription", label: "Non-opposition avec prescriptions", sub: "Sous réserves" },
    { key: "opposition", label: "Opposition", sub: "Travaux refusés" },
    { key: "pieces_complementaires", label: "Demande de pièces", sub: "Pièces manquantes" },
  ],
  certificat_urbanisme: [
    { key: "cu_positif", label: "CU positif", sub: "Faisabilité confirmée" },
    { key: "cu_negatif", label: "CU négatif", sub: "Faisabilité impossible" },
  ],
  permis_amenager: [
    { key: "accord", label: "Accord", sub: "Autorisation accordée" },
    { key: "accord_prescription", label: "Accord avec prescriptions", sub: "Sous conditions" },
    { key: "refus", label: "Refus", sub: "Opposition au projet" },
    { key: "sursis_a_statuer", label: "Sursis à statuer", sub: "Décision différée" },
  ],
  permis_demolir: [
    { key: "accord", label: "Accord", sub: "Non-opposition à la démolition" },
    { key: "refus", label: "Refus", sub: "Opposition à la démolition" },
    { key: "sursis_a_statuer", label: "Sursis à statuer", sub: "Décision différée" },
  ],
  permis_lotir: [
    { key: "accord", label: "Accord", sub: "Autorisation accordée" },
    { key: "accord_prescription", label: "Accord avec prescriptions", sub: "Sous conditions" },
    { key: "refus", label: "Refus", sub: "Opposition au projet" },
    { key: "sursis_a_statuer", label: "Sursis à statuer", sub: "Décision différée" },
  ],
};

const ROLE_LABELS: Record<string, string> = {
  maire: "Maire",
  adjoint: "Adjoint au Maire",
  dgs: "Directeur Général des Services",
  responsable_ads: "Responsable ADS",
  directeur: "Directeur de service",
};

const STATUS_STEPS = [
  { key: "brouillon", label: "Préparation" },
  { key: "soumis_signature", label: "Soumis" },
  { key: "signe", label: "Signé" },
  { key: "notifie", label: "Notifié" },
] as const;

function decisionStepIndex(status: DecisionStatus): number {
  if (status === "brouillon" || status === "revision_necessaire") return 0;
  if (status === "soumis_signature") return 1;
  if (status === "signe") return 2;
  if (status === "notifie") return 3;
  return 0;
}

const DETAIL_TABS = ["Résumé", "Parcelle", "Conformité IA", "Documents", "Consultations", "Chronologie", "Décision"] as const;
type DetailTab = typeof DETAIL_TABS[number];

const TAB_ICONS: Record<string, React.ReactNode> = {
  "Résumé": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  "Parcelle": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>,
  "Conformité IA": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
  "Documents": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
  "Consultations": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>,
  "Chronologie": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  "Décision": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><polyline points="9 15 11 17 15 13" /></svg>,
};

function DecisionPanel({ dossier, liveCommune, currentUserId }: {
  dossier: DossierInfo;
  liveCommune: string | null;
  currentUserId?: string;
}) {
  const [decision, setDecision] = useState<DecisionData | null>(null);
  const [loadingDecision, setLoadingDecision] = useState(true);
  const [saving, setSaving] = useState(false);
  const [communeSignataires, setCommuneSignataires] = useState<SignataireRow[]>([]);
  const [showRefuseModal, setShowRefuseModal] = useState(false);
  const [refuseMotif, setRefuseMotif] = useState("");
  const [editingPrescriptions, setEditingPrescriptions] = useState(false);

  // Editable form state
  const [localType, setLocalType] = useState("");
  const [localMotif, setLocalMotif] = useState("");
  const [localPrescriptions, setLocalPrescriptions] = useState<string[]>([]);
  const [localConditions, setLocalConditions] = useState("");
  const [localSignataireId, setLocalSignataireId] = useState<string | null>(null);

  const communeName = liveCommune ?? dossier.commune ?? "";
  const decisionOptions = (DECISION_OPTIONS[dossier.type] ?? DECISION_OPTIONS["permis_de_construire"]) as Array<{ key: string; label: string; sub: string }>;
  const isEditable = !decision || decision.status === "brouillon" || decision.status === "revision_necessaire";
  const isSignataire = communeSignataires.some(s => s.user_id === currentUserId);

  useEffect(() => {
    api.get<DecisionData | null>(`/decisions/dossier/${dossier.id}`)
      .then(d => {
        setDecision(d);
        if (d) {
          setLocalType(d.type);
          setLocalMotif(d.motif ?? "");
          setLocalPrescriptions(d.prescriptions ?? []);
          setLocalConditions(d.conditions ?? "");
          setLocalSignataireId(d.signataire_id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDecision(false));
  }, [dossier.id]);

  useEffect(() => {
    if (!communeName) return;
    api.get<SignataireRow[]>(`/decisions/communes/${encodeURIComponent(communeName)}/signataires`)
      .then(data => setCommuneSignataires(data))
      .catch(() => {});
  }, [communeName]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await api.post<DecisionData>(`/decisions/dossier/${dossier.id}`, {
        type: localType || decisionOptions[0]?.key,
        motif: localMotif || null,
        prescriptions: localPrescriptions,
        conditions: localConditions || null,
        signataire_id: localSignataireId,
        commune: communeName,
      });
      setDecision(saved);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!decision) return;
    setSaving(true);
    try {
      const updated = await api.post<DecisionData>(`/decisions/${decision.id}/submit`, {});
      setDecision(updated);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const handleSign = async () => {
    if (!decision) return;
    setSaving(true);
    try {
      const updated = await api.post<DecisionData>(`/decisions/${decision.id}/sign`, {});
      setDecision(updated);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const handleRefuse = async () => {
    if (!decision || !refuseMotif.trim()) return;
    setSaving(true);
    try {
      const updated = await api.post<DecisionData>(`/decisions/${decision.id}/refuse-signature`, { motif: refuseMotif });
      setDecision(updated);
      setShowRefuseModal(false);
      setRefuseMotif("");
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const handleNotify = async () => {
    if (!decision) return;
    setSaving(true);
    try {
      const updated = await api.post<DecisionData>(`/decisions/${decision.id}/notify`, {});
      setDecision(updated);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const stepIdx = decision ? decisionStepIndex(decision.status) : 0;
  const typeLabel = decisionOptions.find(o => o.key === (decision?.type ?? localType))?.label ?? "—";
  const signataireLabel = (() => {
    if (decision?.signataire) return `${decision.signataire.prenom} ${decision.signataire.nom}`;
    const row = communeSignataires.find(s => s.user_id === (localSignataireId ?? decision?.signataire_id));
    if (row?.user) return `${row.user.prenom} ${row.user.nom}`;
    return "Non désigné";
  })();

  if (loadingDecision) return <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "flex-start" }}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
        {/* Workflow status bar */}
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {STATUS_STEPS.map((step, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              const isRevision = decision?.status === "revision_necessaire" && i === 0;
              return (
                <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < STATUS_STEPS.length - 1 ? 1 : "none" }}>
                  <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: isRevision ? "#FEF2F2" : done ? "#4F46E5" : active ? "#EEF2FF" : "#F1F5F9",
                      border: `2px solid ${isRevision ? "#EF4444" : done ? "#4F46E5" : active ? "#4F46E5" : "#E2E8F0"}`,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      {isRevision ? (
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      ) : done ? (
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : (
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: active ? "#4F46E5" : "#CBD5E1" }} />
                      )}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: active || done ? 700 : 400, color: isRevision ? "#EF4444" : active || done ? "#4F46E5" : "#94a3b8", whiteSpace: "nowrap" as const }}>
                      {isRevision ? "Révision" : step.label}
                    </span>
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: done ? "#4F46E5" : "#E2E8F0", margin: "0 6px", marginBottom: 16 }} />
                  )}
                </div>
              );
            })}
          </div>
          {decision?.status === "revision_necessaire" && decision.motif_refus_signature && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "#FEF2F2", borderRadius: 8, border: "1px solid #FECACA" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#B91C1C", marginBottom: 3 }}>Motif du refus de signature</div>
              <div style={{ fontSize: 12, color: "#7F1D1D" }}>{decision.motif_refus_signature}</div>
            </div>
          )}
          {decision?.status === "signe" && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "#F0FDF4", borderRadius: 8, border: "1px solid #BBF7D0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#15803D", marginBottom: 2 }}>Arrêté signé — {decision.arrete_numero}</div>
              <div style={{ fontSize: 11, color: "#166534" }}>Date : {decision.date_decision} · Recours jusqu'au : {decision.date_limite_recours ?? "—"}</div>
            </div>
          )}
          {decision?.status === "notifie" && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "#F0FDF4", borderRadius: 8, border: "1px solid #BBF7D0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#15803D" }}>Pétitionnaire notifié le {decision.date_notification}</div>
            </div>
          )}
        </div>

        {/* Decision form / read-only view */}
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", marginBottom: 18 }}>
            {isEditable ? "Projet de décision" : "Décision"}
            {decision && !isEditable && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: "#4F46E5", background: "#EEF2FF", borderRadius: 6, padding: "2px 8px" }}>{typeLabel}</span>}
          </div>

          {/* Decision type selector */}
          {isEditable && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 10 }}>Type de décision</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 20 }}>
                {decisionOptions.map(d => (
                  <button key={d.key} onClick={() => setLocalType(d.key)} style={{
                    border: `1.5px solid ${localType === d.key ? "#4F46E5" : "#E2E8F0"}`,
                    background: localType === d.key ? "#EEF2FF" : "white",
                    borderRadius: 10, padding: "11px 12px", cursor: "pointer", textAlign: "left" as const,
                    boxShadow: localType === d.key ? "0 2px 8px rgba(79,70,229,0.12)" : "none",
                    transition: "all 0.12s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", background: localType === d.key ? "#4F46E5" : "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke={localType === d.key ? "white" : "#CBD5E1"} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: localType === d.key ? "#4F46E5" : "#374151" }}>{d.label}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: "#94a3b8", paddingLeft: 23 }}>{d.sub}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Prescriptions */}
          {(isEditable || (decision && decision.prescriptions?.length > 0)) && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.07em" }}>Prescriptions</span>
                  <span style={{ background: "#4F46E5", color: "white", borderRadius: "50%", width: 18, height: 18, fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    {localPrescriptions.length}
                  </span>
                </div>
                {isEditable && (
                  <button onClick={() => setEditingPrescriptions(!editingPrescriptions)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 10px", fontSize: 11.5, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}>
                    {editingPrescriptions ? "Fermer" : "Modifier"}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                {localPrescriptions.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "9px 12px", background: "#F8FAFC", borderRadius: 9, border: "1px solid #EAECF0" }}>
                    <span style={{ width: 19, height: 19, borderRadius: "50%", background: "#EEF2FF", color: "#4F46E5", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, border: "1px solid #C7D2FE" }}>{i + 1}</span>
                    {editingPrescriptions && isEditable ? (
                      <div style={{ flex: 1, display: "flex", gap: 6 }}>
                        <input value={p} onChange={e => { const next = [...localPrescriptions]; next[i] = e.target.value; setLocalPrescriptions(next); }} style={{ flex: 1, border: "1.5px solid #C7D2FE", borderRadius: 7, padding: "4px 8px", fontSize: 12, outline: "none" }} />
                        <button onClick={() => setLocalPrescriptions(localPrescriptions.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", color: "#EF4444", fontSize: 14, padding: "0 4px" }}>×</button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.5 }}>{p}</span>
                    )}
                  </div>
                ))}
                {editingPrescriptions && isEditable && (
                  <button onClick={() => setLocalPrescriptions([...localPrescriptions, ""])} style={{ border: "2px dashed #C7D2FE", background: "transparent", borderRadius: 9, padding: "8px 0", fontSize: 12, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}>+ Ajouter une prescription</button>
                )}
              </div>
            </div>
          )}

          {/* Motif */}
          {isEditable && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 8 }}>Motif / observations</div>
              <textarea value={localMotif} onChange={e => setLocalMotif(e.target.value)} rows={3} placeholder="Observations, éléments de droit, références réglementaires…" style={{ width: "100%", border: "1.5px solid #E2E8F0", borderRadius: 9, padding: "10px 12px", fontSize: 12.5, outline: "none", resize: "vertical" as const, fontFamily: "inherit", boxSizing: "border-box" as const, color: "#374151" }} />
            </div>
          )}

          {/* Save button for editable state */}
          {isEditable && (
            <button onClick={handleSave} disabled={saving || !localType} style={{ background: saving ? "#94a3b8" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 9, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: saving || !localType ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 7 }}>
              {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
            </button>
          )}
        </div>

        {/* Arrêté preview */}
        {(isEditable || decision) && (
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>Aperçu du projet d'arrêté</span>
              {decision?.status === "signe" && decision.arrete_numero && (
                <span style={{ marginLeft: "auto", fontSize: 11, background: "#DCFCE7", color: "#15803D", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>N° {decision.arrete_numero}</span>
              )}
            </div>
            <div style={{ padding: "24px 30px", fontFamily: "'Georgia', serif", fontSize: 12.5, lineHeight: 1.9, color: "#1a1a1a", background: "white", minHeight: 200 }}>
              <div style={{ textAlign: "center" as const, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.12em", textTransform: "uppercase" as const }}>Arrêté</div>
                <div style={{ fontSize: 12.5, fontStyle: "italic" as const }}>
                  {decisionOptions.find(o => o.key === (decision?.type ?? localType))?.label?.toLowerCase() ?? "—"}
                </div>
              </div>
              <p style={{ margin: "0 0 8px" }}>Le Maire de {communeName || "la commune"},</p>
              <p style={{ margin: "0 0 4px" }}>Vu la demande présentée le {dossier.date_depot ? new Date(dossier.date_depot).toLocaleDateString("fr-FR") : "—"} par {dossier.petitionnaire}&nbsp;;</p>
              <p style={{ margin: "0 0 12px" }}>Vu le Code de l'urbanisme&nbsp;;</p>
              <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Arrête</p>
              <p style={{ margin: "0 0 8px" }}><strong>Article 1er</strong> – {decisionOptions.find(o => o.key === (decision?.type ?? localType))?.label ?? "La décision"} est prononcée pour {dossier.petitionnaire}.</p>
              {localPrescriptions.length > 0 && (
                <p style={{ margin: "0 0 4px" }}><strong>Article 2</strong> – Prescriptions :<br />{localPrescriptions.map((p, i) => <span key={i}>{i + 1}. {p}<br /></span>)}</p>
              )}
              <p style={{ margin: "16px 0 0", fontStyle: "italic" as const, color: "#64748b", fontSize: 11 }}>
                {decision?.arrete_numero ? `N° ${decision.arrete_numero}` : "[Numéro d'arrêté]"} · {decision?.date_decision ?? "[Date de signature]"} · {signataireLabel}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Right column */}
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
        {/* Signataire selector */}
        {isEditable && (
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Signataire désigné</div>
            {communeSignataires.length === 0 ? (
              <div style={{ fontSize: 12, color: "#94a3b8", padding: "12px 0" }}>Aucun signataire configuré pour cette commune. Ajoutez-en un dans Paramètres → Signataires.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                {communeSignataires.map(s => (
                  <button key={s.id} onClick={() => setLocalSignataireId(s.user_id)} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    border: `1.5px solid ${localSignataireId === s.user_id ? "#4F46E5" : "#E2E8F0"}`,
                    borderRadius: 9, background: localSignataireId === s.user_id ? "#EEF2FF" : "white", cursor: "pointer", textAlign: "left" as const,
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                      {s.user ? `${s.user.prenom[0] ?? ""}${s.user.nom[0] ?? ""}`.toUpperCase() : "?"}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A" }}>{s.user ? `${s.user.prenom} ${s.user.nom}` : "—"}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{ROLE_LABELS[s.role] ?? s.role}</div>
                    </div>
                    {localSignataireId === s.user_id && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Signatures status */}
        {decision && !isEditable && (
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Signatures</div>
            {[
              { label: "Instructeur·trice", name: dossier.instructeur ?? "—", signed: true, date: decision.created_at?.split("T")[0] },
              { label: ROLE_LABELS[communeSignataires.find(s => s.user_id === decision.signataire_id)?.role ?? ""] ?? "Signataire", name: signataireLabel, signed: decision.status === "signe" || decision.status === "notifie", date: decision.date_decision },
            ].map((sig, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i === 0 ? "1px solid #F1F5F9" : "none" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                  {sig.name.split(" ").map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A" }}>{sig.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{sig.label}</div>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: sig.signed ? "#15803D" : "#C2410C", background: sig.signed ? "#F0FDF4" : "#FFF7ED", borderRadius: 6, padding: "3px 8px", border: `1px solid ${sig.signed ? "#BBF7D0" : "#FED7AA"}`, whiteSpace: "nowrap" as const }}>
                  {sig.signed ? (sig.date ?? "Signé") : "En attente"}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 9 }}>
          {/* Submit for signature */}
          {isEditable && decision && (
            <button onClick={handleSubmit} disabled={saving || !localSignataireId} style={{ background: !localSignataireId ? "#E2E8F0" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: !localSignataireId ? "#94a3b8" : "white", border: "none", borderRadius: 11, padding: "13px 0", fontSize: 13.5, fontWeight: 700, cursor: !localSignataireId ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: !localSignataireId ? "none" : "0 4px 12px rgba(79,70,229,0.35)" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              {saving ? "Envoi…" : "Soumettre pour signature"}
            </button>
          )}

          {/* Sign / Refuse (for signataire) */}
          {decision?.status === "soumis_signature" && isSignataire && (
            <>
              <button onClick={handleSign} disabled={saving} style={{ background: "linear-gradient(135deg,#059669,#10B981)", color: "white", border: "none", borderRadius: 11, padding: "13px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 12px rgba(5,150,105,0.3)" }}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                {saving ? "Signature…" : "Signer l'arrêté"}
              </button>
              <button onClick={() => setShowRefuseModal(true)} style={{ background: "white", color: "#EF4444", border: "1.5px solid #FECACA", borderRadius: 11, padding: "12px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                Refuser — demander révision
              </button>
            </>
          )}

          {/* Pending info for instructeur */}
          {decision?.status === "soumis_signature" && !isSignataire && (
            <div style={{ padding: "14px 16px", background: "#FFF7ED", borderRadius: 11, border: "1px solid #FED7AA", fontSize: 12.5, color: "#92400E", textAlign: "center" as const, fontWeight: 500 }}>
              En attente de signature par {signataireLabel}
            </div>
          )}

          {/* Notify */}
          {decision?.status === "signe" && (
            <button onClick={handleNotify} disabled={saving} style={{ background: "linear-gradient(135deg,#0EA5E9,#38BDF8)", color: "white", border: "none", borderRadius: 11, padding: "13px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 12px rgba(14,165,233,0.3)" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
              {saving ? "Envoi…" : "Marquer comme notifié"}
            </button>
          )}
        </div>
      </div>

      {/* Refuse modal */}
      {showRefuseModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowRefuseModal(false)}>
          <div style={{ background: "white", borderRadius: 14, width: 460, padding: 24, boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Refuser la signature</div>
            <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 16 }}>Précisez le motif du refus. L'instructeur sera notifié et devra réviser le projet d'arrêté.</div>
            <textarea value={refuseMotif} onChange={e => setRefuseMotif(e.target.value)} rows={4} placeholder="Ex : Le type de décision ne correspond pas à l'avis de la DDT. Article L.424-1 non respecté…" style={{ width: "100%", border: "1.5px solid #E2E8F0", borderRadius: 9, padding: "10px 12px", fontSize: 12.5, outline: "none", resize: "vertical" as const, fontFamily: "inherit", boxSizing: "border-box" as const, marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
              <button onClick={() => setShowRefuseModal(false)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer", color: "#374151" }}>Annuler</button>
              <button onClick={handleRefuse} disabled={!refuseMotif.trim() || saving} style={{ background: "#EF4444", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: !refuseMotif.trim() ? "not-allowed" : "pointer" }}>Confirmer le refus</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DossierDetailScreen({ dossier, onBack, navigate }: {
  dossier: DossierInfo;
  onBack: () => void;
  navigate: (s: string) => void;
}) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<DetailTab>("Résumé");
  const [showCourrierModal, setShowCourrierModal] = useState(false);
  const [showMapFull, setShowMapFull] = useState(false);

  // ── Analyse parcellaire réelle ──
  type ParcelAnalysis = {
    query: string;
    address?: { label: string; lat: number; lng: number; city: string; postcode: string };
    parcel?: { parcelle_id: string; section: string; numero: string; surface_m2: number; commune: string; code_insee: string };
    plu_zone?: { zone_code: string; zone_label: string; zone_type: string; plu_nom?: string };
    risks?: { flood_risk: string; seismic_zone: string; clay_risk: string };
    db_zone?: { id: string; code: string; label: string | null; type: string | null } | null;
    rules: Array<{ id: string; topic: string; rule_text: string; value_min: number | null; value_max: number | null; unit: string | null; summary: string | null; article_number: number | null }>;
    buildability: { maxFootprintM2: number; remainingFootprintM2: number; maxHeightM: number | null; minSetbackFromRoadM: number | null; minSetbackFromBoundariesM: number | null; estimatedFloors: number | null; greenSpaceRatio: number | null; greenSpaceRequiredM2: number | null; confidence: number; resultSummary: string } | null;
    data_sources: string[];
    warnings: string[];
    available_zones?: Array<{ zone_code: string; zone_label: string; zone_type: string }>;
    municipality?: { is_rnu: boolean; libelle?: string } | null;
    prescriptions?: Array<{ libelle: string; typepsc: string; txtpsc?: string }>;
    servitudes?: Array<{ categorie: string; libelle?: string }>;
  };
  const [parcelAnalysis, setParcelAnalysis] = useState<ParcelAnalysis | null>(null);
  const [parcelLoading, setParcelLoading] = useState(false);
  const [parcelError, setParcelError] = useState<string | null>(null);
  const [showAddressEditor, setShowAddressEditor] = useState(false);
  const [addressOverride, setAddressOverride] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [addrQuery, setAddrQuery] = useState("");
  const [addrSuggestions, setAddrSuggestions] = useState<Array<{ label: string; city: string; postcode: string }>>([]);
  const [addrSugLoading, setAddrSugLoading] = useState(false);
  const [addrSaving, setAddrSaving] = useState(false);
  const [liveAdresse, setLiveAdresse] = useState(dossier.adresse);
  const [liveCommune, setLiveCommune] = useState(dossier.commune ?? null);
  const [clickingParcel, setClickingParcel] = useState(false);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (activeTab !== "Parcelle" || parcelAnalysis || parcelLoading) return;
    setParcelLoading(true);
    setParcelError(null);
    const params = new URLSearchParams();
    if (addressOverride) params.set("q", addressOverride);
    if (selectedZone) params.set("zone", selectedZone);
    if (clickedCoords) {
      params.set("lat", String(clickedCoords.lat));
      params.set("lng", String(clickedCoords.lng));
    }
    const url = `/mairie/dossiers/${dossier.id}/analyse-parcelle${params.toString() ? "?" + params.toString() : ""}`;
    api.get<ParcelAnalysis>(url)
      .then(data => { setParcelAnalysis(data); setClickingParcel(false); })
      .catch(e => setParcelError(e instanceof Error ? e.message : "Erreur analyse parcellaire"))
      .finally(() => setParcelLoading(false));
  }, [activeTab, dossier.id, parcelAnalysis, parcelLoading, addressOverride, selectedZone, clickedCoords]);

  // BAN autocomplete
  useEffect(() => {
    if (addrQuery.length < 3) { setAddrSuggestions([]); return; }
    const timer = setTimeout(() => {
      setAddrSugLoading(true);
      fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(addrQuery)}&limit=5`)
        .then(r => r.json())
        .then((d: { features: Array<{ properties: { label: string; city: string; postcode: string } }> }) =>
          setAddrSuggestions(d.features.map(f => ({ label: f.properties.label, city: f.properties.city, postcode: f.properties.postcode }))))
        .catch(() => setAddrSuggestions([]))
        .finally(() => setAddrSugLoading(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [addrQuery]);

  const handleAddressSelect = (suggestion: { label: string; city: string; postcode: string }) => {
    const newAddr = suggestion.label;
    const newCommune = suggestion.city;
    setAddressOverride(newAddr);
    setSelectedZone(null);
    setLiveAdresse(newAddr);
    setLiveCommune(newCommune);
    setAddrQuery("");
    setAddrSuggestions([]);
    setShowAddressEditor(false);
    setParcelAnalysis(null);
    setParcelError(null);
    setAddrSaving(true);
    api.patch(`/mairie/dossiers/${dossier.id}/adresse`, { adresse: newAddr, commune: newCommune })
      .catch(() => {})
      .finally(() => setAddrSaving(false));
  };

  const [decisionType, setDecisionType] = useState<string>("accord_prescription");
  const [prescriptions, setPrescriptions] = useState([
    "Respecter la hauteur maximale de 3,5 m pour l'annexe.",
    "Conserver 30 % d'espaces perméables sur l'unité foncière.",
    "Respecter les prescriptions de l'avis ABF joint au dossier.",
  ]);
  const [editingPrescriptions, setEditingPrescriptions] = useState(false);

  // ── Consultations réelles ──
  type Consultation = {
    id: string;
    dossier_id: string;
    service_name: string;
    service_type: string;
    status: string;
    favorable: boolean | null;
    avis: string | null;
    date_envoi: string | null;
    date_reponse: string | null;
    created_at: string;
  };
  const [consultations, setConsultations] = useState<Consultation[] | null>(null);
  const [consultationsLoading, setConsultationsLoading] = useState(false);
  const [consultationsMissioning, setConsultationsMissioning] = useState(false);
  const [selectedConsultation, setSelectedConsultation] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<number>(0);

  const fetchConsultations = useCallback(() => {
    setConsultationsLoading(true);
    api.get<Consultation[]>(`/mairie/dossiers/${dossier.id}/consultations`)
      .then(data => {
        setConsultations(data);
        if (data.length > 0 && !selectedConsultation) setSelectedConsultation(data[0]?.id ?? null);
      })
      .catch(() => setConsultations([]))
      .finally(() => setConsultationsLoading(false));
  }, [dossier.id, selectedConsultation]);

  useEffect(() => {
    if (activeTab !== "Consultations" || consultations !== null) return;
    fetchConsultations();
  }, [activeTab, consultations, fetchConsultations]);

  const hasABFServitude = parcelAnalysis?.servitudes?.some(s => s.categorie?.startsWith("AC")) ?? false;

  const missionnerABF = async () => {
    setConsultationsMissioning(true);
    try {
      await api.post(`/mairie/dossiers/${dossier.id}/consultations`, {
        service_name: "ABF – Architecte des Bâtiments de France",
        service_type: "ABF",
      });
      // Refresh and switch to consultations tab
      setConsultations(null);
      setActiveTab("Consultations");
    } catch {
      // silently ignore
    } finally {
      setConsultationsMissioning(false);
    }
  };

  const daysLeft = dossier.echeance && dossier.echeance !== "—"
    ? Math.ceil((new Date(dossier.echeance.split("/").reverse().join("-")).getTime() - Date.now()) / 86400000)
    : null;

  const typeLabel = TYPE_LABEL[dossier.type] ?? dossier.type;
  const instructeurName = dossier.instructeur ?? "Non assigné";

  const DOCUMENTS_DATA = [
    { name: "Formulaire CERFA 13406*08", ext: "PDF", size: "1.2 Mo", date: "12/05/2024", status: "Validé", ia: "Formulaire complet. Toutes les rubriques obligatoires sont renseignées." },
    { name: "Plan de situation", ext: "PDF", size: "3.4 Mo", date: "12/05/2024", status: "Validé", ia: "Plan conforme. Echelle 1/25000 visible. Localisation précise du terrain identifiée." },
    { name: "Plan de masse", ext: "PDF", size: "2.1 Mo", date: "12/05/2024", status: "Validé", ia: "Cote NGF présente. Emprise au sol calculable. Distances aux limites séparatives indiquées." },
    { name: "Notice descriptive", ext: "PDF", size: "0.8 Mo", date: "12/05/2024", status: "Validé", ia: "Description des matériaux conforme aux prescriptions ABF. Surface plancher cohérente avec le CERFA." },
    { name: "Photos du terrain", ext: "ZIP", size: "12.3 Mo", date: "12/05/2024", status: "Validé", ia: "8 photos identifiées. Vues panoramiques et détails du terrain présents." },
    { name: "Pièce complémentaire 1", ext: "PDF", size: "0.5 Mo", date: "18/05/2024", status: "En attente", ia: "Analyse en attente de validation." },
  ];

  const TIMELINE_DATA = [
    { date: "12/05/2024", event: "Dépôt du dossier", actor: dossier.petitionnaire + " (pétitionnaire)", icon: "📥", color: "#4F46E5" },
    { date: "13/05/2024", event: "Accusé de réception envoyé", actor: "Système automatique", icon: "✉️", color: "#22C55E" },
    { date: "15/05/2024", event: "Vérification de complétude", actor: instructeurName + " (instructeur)", icon: "🔍", color: "#22C55E" },
    { date: "18/05/2024", event: "Demande de pièce complémentaire", actor: instructeurName + " (instructeur)", icon: "📎", color: "#F97316" },
    { date: "20/05/2024", event: "Réception pièce complémentaire", actor: dossier.petitionnaire + " (pétitionnaire)", icon: "📄", color: "#22C55E" },
    { date: "22/05/2024", event: "Dossier déclaré complet", actor: instructeurName + " (instructeur)", icon: "✅", color: "#22C55E" },
    { date: "22/05/2024", event: "Envoi en consultation ABF", actor: instructeurName + " (instructeur)", icon: "👥", color: "#8B5CF6" },
    { date: "30/05/2024", event: "Réception avis ABF – Favorable avec réserves", actor: "ABF – Direction Régionale", icon: "📋", color: "#F97316" },
    { date: "02/06/2024", event: "Mise en instruction", actor: instructeurName + " (instructeur)", icon: "⚙️", color: "#3B82F6" },
  ];

  const IA_RULES = [
    { rule: "Emprise au sol ≤ 40%", result: "Conforme", value: "32%", ok: true },
    { rule: "Hauteur maximale ≤ 9m", result: "Conforme", value: "7,2m", ok: true },
    { rule: "Recul par rapport à la voirie", result: "Point de vigilance", value: "3m (min. 4m requis)", ok: false },
    { rule: "Espaces verts ≥ 30%", result: "Non vérifiable", value: "Données insuffisantes", ok: null },
    { rule: "Stationnement (2 places min.)", result: "Conforme", value: "2 places indiquées", ok: true },
    { rule: "Matériaux conformes PLU", result: "Conforme (ABF)", value: "Avis ABF favorable", ok: true },
    { rule: "Zone constructible (UC)", result: "Conforme", value: "Zone UC confirmée", ok: true },
    { rule: "Périmètre ABF (500m)", result: "Applicable", value: "Dans le périmètre", ok: null },
  ];

  const CARD: React.CSSProperties = { background: "white", borderRadius: 14, border: "1px solid #E8EEF4", padding: 22, boxShadow: "0 1px 4px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)" };
  const SH: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 18 };
  const LABEL_ST: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 };
  const VALUE_ST: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: "#1E293B" };

  const Divider = () => <div style={{ height: 1, background: "#F1F5F9", margin: "4px 0" }} />;

  const SecTitle = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 3, height: 14, background: "#4F46E5", borderRadius: 2, display: "inline-block", flexShrink: 0 }} />
        {children}
      </div>
      {action}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, height: "100%", background: "#F3F4F8" }}>
      {/* ── Sticky header ── */}
      <div style={{ background: "white", borderBottom: "1px solid #E8EEF4", padding: "14px 28px 0", position: "sticky", top: 0, zIndex: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        {/* top bar: back + actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: "none", color: "#64748b", fontSize: 13, cursor: "pointer", padding: 0, fontWeight: 500, letterSpacing: "-0.1px" }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            Retour aux dossiers
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => navigate("Messagerie")} style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "7px 15px", fontSize: 12.5, color: "#374151", cursor: "pointer", fontWeight: 500, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
              Contacter le pétitionnaire
            </button>
            <button onClick={() => setShowCourrierModal(true)} style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "7px 15px", fontSize: 12.5, color: "#374151", cursor: "pointer", fontWeight: 500, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              Générer un courrier
            </button>
            <button style={{ display: "flex", alignItems: "center", gap: 7, background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 9, padding: "7px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(79,70,229,0.35)" }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Exporter le dossier
            </button>
          </div>
        </div>

        {/* identity row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          {/* left: numero + description + meta */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0F172A", margin: 0, letterSpacing: "-0.8px", lineHeight: 1 }}>{dossier.numero}</h1>
              <StatusBadge status={dossier.status} />
            </div>
            <div style={{ fontSize: 13, color: "#475569", fontWeight: 500, marginBottom: 8 }}>{typeLabel}{dossier.description ? ` – ${dossier.description}` : ""}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" as const }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#334155" }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                <span style={{ fontWeight: 500 }}>{dossier.petitionnaire}</span>
              </span>
              <span style={{ color: "#CBD5E1", fontSize: 12 }}>·</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#334155" }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                {liveAdresse ?? "—"}{liveCommune ? `, ${liveCommune}` : ""}
                <button
                  title="Modifier l'adresse"
                  onClick={() => { setShowAddressEditor(v => !v); setAddrQuery(""); setAddrSuggestions([]); }}
                  style={{ padding: "1px 6px", fontSize: 10, color: showAddressEditor ? "#4F46E5" : "#94a3b8", background: showAddressEditor ? "#EEF2FF" : "none", border: "1px solid " + (showAddressEditor ? "#4F46E5" : "#E2E8F0"), borderRadius: 4, cursor: "pointer", marginLeft: 2, fontWeight: 500 }}
                >✏️</button>
              </span>
              {dossier.parcelle && <>
                <span style={{ color: "#CBD5E1", fontSize: 12 }}>·</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#334155" }}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                  {dossier.parcelle}
                </span>
              </>}
            </div>
          </div>
          {/* right: date chips */}
          <div style={{ display: "flex", gap: 6, flexShrink: 0, marginTop: 2 }}>
            <div style={{ background: "#F8FAFC", border: "1px solid #E8EEF4", borderRadius: 10, padding: "8px 14px", textAlign: "center" as const, minWidth: 110 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 3 }}>Déposé le</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{dossier.date_depot ? fmtDate(dossier.date_depot) : "—"}</div>
            </div>
            <div style={{ background: "#F8FAFC", border: "1px solid #E8EEF4", borderRadius: 10, padding: "8px 14px", textAlign: "center" as const, minWidth: 110 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 3 }}>Échéance</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{dossier.echeance}</span>
                {daysLeft !== null && (
                  <span style={{ background: daysLeft < 14 ? "#FEF2F2" : "#EFF6FF", color: daysLeft < 14 ? "#DC2626" : "#2563EB", borderRadius: 5, padding: "1px 6px", fontSize: 11, fontWeight: 800, letterSpacing: "-0.2px" }}>
                    J{daysLeft >= 0 ? `-${daysLeft}` : `+${Math.abs(daysLeft)}`}
                  </span>
                )}
              </div>
            </div>
            <div style={{ background: "#F8FAFC", border: "1px solid #E8EEF4", borderRadius: 10, padding: "8px 14px", textAlign: "center" as const, minWidth: 120 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 3 }}>Instructeur</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{instructeurName}</div>
            </div>
          </div>
        </div>

        {/* Éditeur d'adresse (dans l'en-tête sticky) */}
        {showAddressEditor && (
          <div style={{ padding: "0 0 12px", display: "flex", flexDirection: "column" as const, gap: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ position: "relative" as const, flex: 1 }}>
                <input
                  autoFocus
                  value={addrQuery}
                  onChange={e => setAddrQuery(e.target.value)}
                  placeholder="Ex : 12 rue du Commerce, Ballan-Miré"
                  style={{ width: "100%", padding: "7px 11px", border: "1.5px solid #4F46E5", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const, color: "#0F172A" }}
                />
                {addrSugLoading && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#94a3b8" }}>…</span>}
                {addrSuggestions.length > 0 && (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "white", border: "1px solid #E2E8F0", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 100, overflow: "hidden" }}>
                    {addrSuggestions.map((s, i) => (
                      <button
                        key={i}
                        onMouseDown={() => handleAddressSelect(s)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#374151", borderBottom: i < addrSuggestions.length - 1 ? "1px solid #F1F5F9" : "none" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                        onMouseLeave={e => (e.currentTarget.style.background = "none")}
                      >
                        <span style={{ fontWeight: 500 }}>{s.label}</span>
                        <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 6 }}>{s.postcode}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => { setShowAddressEditor(false); setAddrQuery(""); setAddrSuggestions([]); }} style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, color: "#64748b", background: "white", cursor: "pointer", whiteSpace: "nowrap" as const }}>Annuler</button>
            </div>
            {addrSaving && <span style={{ fontSize: 11, color: "#64748b" }}>Sauvegarde…</span>}
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0 }}>
          {DETAIL_TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              display: "flex", alignItems: "center", gap: 6,
              border: "none", background: "none", padding: "10px 18px", fontSize: 12.5, cursor: "pointer",
              fontWeight: activeTab === tab ? 700 : 500,
              color: activeTab === tab ? "#4F46E5" : "#64748b",
              borderBottom: activeTab === tab ? "2.5px solid #4F46E5" : "2.5px solid transparent",
              transition: "color 0.12s",
              marginBottom: -1,
            }}>
              <span style={{ opacity: activeTab === tab ? 1 : 0.6 }}>{TAB_ICONS[tab]}</span>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflowY: "auto" as const, padding: "20px 24px" }}>

        {/* ── RÉSUMÉ ── */}
        {activeTab === "Résumé" && (
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {/* Infos principales */}
              <div style={CARD}>
                <SecTitle>Informations principales</SecTitle>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
                  {[
                    ["Pétitionnaire", dossier.petitionnaire],
                    ["Type de dossier", typeLabel],
                    ["Adresse", liveAdresse ?? "—"],
                    ["Commune", `${liveCommune ?? "—"}${dossier.code_postal ? ` (${dossier.code_postal})` : ""}`],
                    ["Parcelle", dossier.parcelle ?? "—"],
                    ["Surface de plancher", dossier.surface_plancher ? `${dossier.surface_plancher} m²` : "—"],
                    ["Date de dépôt", dossier.date_depot ? fmtDate(dossier.date_depot) : "—"],
                    ["Échéance", dossier.echeance],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <div style={LABEL_ST}>{l}</div>
                      <div style={VALUE_ST}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Avancement */}
              <div style={CARD}>
                <SecTitle>Avancement du dossier</SecTitle>
                {[
                  { label: "Dépôt", done: true },
                  { label: "Complétude", done: true },
                  { label: "Instruction", done: ["en_instruction","decision_en_cours","accepte","refuse","accord_prescription"].includes(dossier.status) },
                  { label: "Consultations", done: false },
                  { label: "Décision", done: ["accepte","refuse","accord_prescription"].includes(dossier.status) },
                ].map((step, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: i < 4 ? 14 : 0 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: step.done ? "linear-gradient(135deg,#4F46E5,#6366F1)" : "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: step.done ? "0 2px 6px rgba(79,70,229,0.3)" : "none" }}>
                      {step.done ? <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : <span style={{ fontSize: 11, color: "#CBD5E1", fontWeight: 700 }}>{i + 1}</span>}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: step.done ? 600 : 400, color: step.done ? "#0F172A" : "#94a3b8" }}>{step.label}</span>
                  </div>
                ))}
                <div style={{ marginTop: 20, padding: "14px 16px", background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)", borderRadius: 12, border: "1px solid #C7D2FE" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#4F46E5", marginBottom: 6, letterSpacing: "0.04em" }}>SCORE DE CONFORMITÉ IA</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, height: 7, background: "#C7D2FE", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: "78%", height: "100%", background: "linear-gradient(90deg,#4F46E5,#818CF8)", borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "#4F46E5" }}>78%</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#6366F1", marginTop: 5 }}>6 règles conformes · 1 vigilance · 1 non vérifiable</div>
                </div>
              </div>
              {/* Mini map */}
              <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 8px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Localisation</div>
                  {(() => { const rLat = parcelAnalysis?.address?.lat ?? dossier.lat; const rLng = parcelAnalysis?.address?.lng ?? dossier.lng; return (rLat && rLng) ? (
                    <button onClick={() => setShowMapFull(true)} title="Agrandir la carte"
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", border: "1px solid #E2E8F0", borderRadius: 6, background: "white", color: "#64748b", fontSize: 11, cursor: "pointer", fontWeight: 500 }}>
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                      Agrandir
                    </button>
                  ) : null; })()}
                </div>
                {(() => { const rLat = parcelAnalysis?.address?.lat ?? dossier.lat; const rLng = parcelAnalysis?.address?.lng ?? dossier.lng; return rLat && rLng ? (
                  <MapLeaflet dossiers={[{ id: dossier.id, numero: dossier.numero, type: dossier.type, status: dossier.status, adresse: liveAdresse ?? dossier.adresse, lat: rLat, lng: rLng }]} height={140} commune={liveCommune ?? dossier.commune} />
                ) : (
                  <div style={{ height: 140, background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 8 }}>
                    <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>Géolocalisation indisponible</span>
                  </div>
                ); })()}
              </div>
            </div>

            {/* ── Description du projet ── */}
            <div style={{ ...CARD, display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div style={{ width: 36, height: 36, background: "#EEF2FF", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Description du projet</div>
                {dossier.description ? (
                  <p style={{ margin: 0, fontSize: 14, color: "#1E293B", lineHeight: 1.65 }}>{dossier.description}</p>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>Aucune description renseignée.</p>
                )}
              </div>
            </div>

            {/* Map fullscreen modal */}
            {showMapFull && (() => { const rLat = parcelAnalysis?.address?.lat ?? dossier.lat; const rLng = parcelAnalysis?.address?.lng ?? dossier.lng; return rLat && rLng ? (
              <div style={{ position: "fixed", inset: 0, zIndex: 1001, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowMapFull(false)}>
                <div style={{ width: "85vw", maxWidth: 1000, background: "white", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #E2E8F0" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#0F172A" }}>Localisation — {dossier.numero}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{liveAdresse ?? dossier.adresse}</div>
                    </div>
                    <button onClick={() => setShowMapFull(false)} style={{ padding: 6, border: "1px solid #E2E8F0", borderRadius: 8, background: "white", cursor: "pointer", display: "flex" }}>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                  <MapLeaflet dossiers={[{ id: dossier.id, numero: dossier.numero, type: dossier.type, status: dossier.status, adresse: liveAdresse ?? dossier.adresse, lat: rLat, lng: rLng }]} height={520} commune={liveCommune ?? dossier.commune} />
                </div>
              </div>
            ) : null; })()}
            {/* Alert banners */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#FFF8F0", border: "1px solid #FDDCB5", borderRadius: 12, padding: "14px 18px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#FEF3C7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#B45309", marginBottom: 3 }}>Recul voirie insuffisant</div>
                  <div style={{ fontSize: 12, color: "#92400E", lineHeight: 1.55 }}>Le projet présente un recul de 3m par rapport à la voirie (minimum requis : 4m selon art. UC 6 du PLU).</div>
                </div>
              </div>
              <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: "14px 18px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#DBEAFE", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1D4ED8", marginBottom: 3 }}>Périmètre ABF</div>
                  <div style={{ fontSize: 12, color: "#1E40AF", lineHeight: 1.55 }}>Le terrain est situé dans le périmètre de protection des Monuments Historiques (500m). L'avis ABF est obligatoire.</div>
                </div>
              </div>
            </div>
            {/* IA banner */}
            <div style={{ background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)", border: "1px solid #C7D2FE", borderRadius: 14, padding: "16px 22px", display: "flex", alignItems: "center", gap: 18, boxShadow: "0 1px 4px rgba(79,70,229,0.08)" }}>
              <div style={{ width: 44, height: 44, background: "linear-gradient(135deg,#4F46E5,#7C3AED)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 4px 10px rgba(79,70,229,0.3)" }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#3730A3" }}>Analyse IA disponible</div>
                <div style={{ fontSize: 12, color: "#4338CA", marginTop: 3, lineHeight: 1.55 }}>L'IA a analysé 8 règles du PLU applicables à ce dossier. 1 point de vigilance identifié sur le recul voirie.</div>
              </div>
              <button onClick={() => setActiveTab("Conformité IA")} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const, boxShadow: "0 2px 6px rgba(79,70,229,0.35)" }}>Voir l'analyse complète</button>
            </div>
          </div>
        )}

        {/* ── PARCELLE ── */}
        {activeTab === "Parcelle" && (() => {
          const TOPIC_LABEL: Record<string, string> = {
            recul_voie: "Recul voirie", recul_limite: "Recul limites", emprise_sol: "Emprise au sol",
            hauteur: "Hauteur max.", stationnement: "Stationnement", espaces_verts: "Espaces verts",
            terrain_min: "Terrain min.",
          };
          const floodColor = (v: string) => v === "fort" ? { c: "#C2410C", bg: "#FFF7ED" } : v === "moyen" ? { c: "#C2410C", bg: "#FFF7ED" } : v === "faible" ? { c: "#B45309", bg: "#FFFBEB" } : { c: "#15803D", bg: "#F0FDF4" };
          const zoneColor = (t?: string) => t === "N" || t === "A" ? { c: "#15803D", bg: "#F0FDF4" } : { c: "#4F46E5", bg: "#EEF2FF" };
          const pa = parcelAnalysis;

          if (parcelLoading) return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 12, color: "#64748b", fontSize: 14 }}>
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              Analyse en cours…
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          );

          return (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
              {/* Warnings */}
              {pa?.warnings && pa.warnings.length > 0 && (
                <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 10, padding: "10px 14px", display: "flex", flexDirection: "column" as const, gap: 4 }}>
                  {pa.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: "#92400E", display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <span style={{ flexShrink: 0 }}>⚠️</span>{w}
                    </div>
                  ))}
                </div>
              )}
              {parcelError && (
                <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 12.5, color: "#991B1B" }}>{parcelError}</span>
                  <button
                    onClick={() => { setShowAddressEditor(true); setAddrQuery(""); setAddrSuggestions([]); }}
                    style={{ flexShrink: 0, padding: "5px 11px", background: "white", border: "1px solid #FECACA", borderRadius: 7, fontSize: 12, color: "#991B1B", cursor: "pointer", fontWeight: 600 }}
                  >Corriger l'adresse ✏️</button>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
                {/* ── Colonne gauche ── */}
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
                  {/* Carte */}
                  <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
                    <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={SH as React.CSSProperties & { display: string; alignItems: string; gap: number; marginBottom: number }}>
                        <span style={{ width: 3, height: 14, background: "#4F46E5", borderRadius: 2, display: "inline-block" }} />
                        Vue parcellaire
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const }}>
                        {pa && pa.data_sources.map(s => (
                          <span key={s} style={{ fontSize: 10, fontWeight: 600, color: "#4F46E5", background: "#EEF2FF", borderRadius: 5, padding: "2px 7px" }}>{s}</span>
                        ))}
                        {/* Click-to-identify parcel button */}
                        <button
                          onClick={() => {
                            setClickingParcel(v => !v);
                          }}
                          style={{
                            padding: "4px 10px", borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                            border: clickingParcel ? "1.5px solid #4F46E5" : "1.5px solid #C7D2FE",
                            background: clickingParcel ? "#EEF2FF" : "white",
                            color: clickingParcel ? "#4F46E5" : "#64748b",
                          }}
                          title="Cliquez sur la carte pour identifier la parcelle"
                        >
                          {clickingParcel ? "✕ Annuler" : "📍 Localiser sur la carte"}
                        </button>
                      </div>
                    </div>
                    {clickingParcel && (
                      <div style={{ margin: "0 14px 10px", padding: "8px 12px", background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 8, fontSize: 12, color: "#4338CA", fontWeight: 600 }}>
                        Cliquez au centre de la parcelle concernée — les limites cadastrales sont visibles sur le fond de carte.
                      </div>
                    )}
                    {(() => {
                      const pLat = pa?.address?.lat ?? (clickedCoords?.lat) ?? dossier.lat;
                      const pLng = pa?.address?.lng ?? (clickedCoords?.lng) ?? dossier.lng;
                      const hasCoords = pLat && pLng;
                      return hasCoords ? (
                        <MapLeaflet
                          dossiers={[{ id: dossier.id, numero: dossier.numero, type: dossier.type, status: dossier.status, adresse: liveAdresse ?? dossier.adresse, lat: pLat, lng: pLng }]}
                          height={clickingParcel ? 380 : 300}
                          commune={liveCommune ?? dossier.commune}
                          clickMode={clickingParcel}
                          parcelLayer={clickingParcel}
                          onMapClick={(lat, lng) => {
                            setClickedCoords({ lat, lng });
                            setParcelAnalysis(null);
                            setParcelError(null);
                            setSelectedZone(null);
                          }}
                        />
                      ) : (
                        <div style={{ height: 300, background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 10 }}>
                          <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                          <span style={{ fontSize: 13, color: "#94a3b8" }}>Coordonnées non disponibles</span>
                          <button onClick={() => setClickingParcel(true)} style={{ padding: "6px 14px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                            📍 Localiser sur la carte
                          </button>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Contraintes */}
                  <div style={CARD}>
                    <SecTitle>Contraintes réglementaires</SecTitle>
                    {/* Zone picker when GPU fails */}
                    {!pa?.plu_zone && pa?.available_zones && pa.available_zones.length > 0 && (
                      <div style={{ marginBottom: 12, padding: "10px 14px", background: "#FFF7ED", border: "1px solid #FCD34D", borderRadius: 8 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#92400E", margin: "0 0 8px" }}>
                          Zone PLU non déterminée automatiquement — sélectionnez la zone applicable :
                        </p>
                        <select
                          value={selectedZone ?? ""}
                          onChange={e => { const v = e.target.value; setSelectedZone(v || null); setParcelAnalysis(null); setParcelError(null); }}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #D97706", borderRadius: 6, fontSize: 13, color: "#374151", background: "white", cursor: "pointer" }}
                        >
                          <option value="">— Choisir la zone —</option>
                          {pa.available_zones.map(z => (
                            <option key={z.zone_code} value={z.zone_code}>
                              {z.zone_code} – {z.zone_label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                      {/* Zone PLU */}
                      {(() => {
                        const zc = pa?.plu_zone ?? (pa?.db_zone ? { zone_code: pa.db_zone.code, zone_label: pa.db_zone.label ?? pa.db_zone.code, zone_type: pa.db_zone.type ?? "U" } : null);
                        const col = zoneColor(zc?.zone_type);
                        return (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: col.bg, borderRadius: 9, border: `1px solid ${col.c}22` }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#374151" }}>Zone PLU</span>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: col.c }}>
                              {zc ? `${zc.zone_code} – ${zc.zone_label}` : "Non identifiée"}
                            </span>
                          </div>
                        );
                      })()}
                      {/* Risque inondation */}
                      {(() => {
                        const flood = pa?.risks?.flood_risk ?? "inconnu";
                        const col = floodColor(flood);
                        const labels: Record<string, string> = { fort: "Aléa fort – PPRI", moyen: "Aléa moyen", faible: "Aléa faible", nul: "Hors zone inondable", inconnu: "Non déterminé" };
                        return (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: col.bg, borderRadius: 9, border: `1px solid ${col.c}22` }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#374151" }}>Zone inondable</span>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: col.c }}>{labels[flood] ?? flood}</span>
                          </div>
                        );
                      })()}
                      {/* Zone sismique */}
                      {pa?.risks?.seismic_zone && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: "#F8FAFC", borderRadius: 9, border: "1px solid #E2E8F022" }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#374151" }}>Zone sismique</span>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#374151" }}>Zone {pa.risks.seismic_zone}</span>
                        </div>
                      )}
                      {/* Servitudes d'utilité publique */}
                      {pa?.servitudes && pa.servitudes.length > 0 && pa.servitudes.map((s, i) => {
                        const supLabels: Record<string, string> = {
                          AC1: "MH – Périmètre ABF", AC2: "Sites classés/inscrits",
                          EL: "Ligne HT", EL7: "Ligne HT 63-225kV", EL11: "Ligne HT >225kV",
                          PM1: "PPRI – Zone submersible", PM2: "Voies ferrées/inondation",
                          T1: "Voie ferrée", T7: "Route nationale",
                          I4: "Réseau hertzien", PT: "Télécommunications",
                        };
                        const label = supLabels[s.categorie] ?? s.categorie;
                        const isABF = s.categorie?.startsWith("AC");
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: isABF ? "#FEF3C7" : "#F0F9FF", borderRadius: 9, border: `1px solid ${isABF ? "#FCD34D" : "#BAE6FD"}22` }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#374151" }}>SUP {s.categorie}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: isABF ? "#92400E" : "#075985" }}>{s.libelle ?? label}</span>
                          </div>
                        );
                      })}
                      {/* Prescriptions surfaciques PLU */}
                      {pa?.prescriptions && pa.prescriptions.length > 0 && pa.prescriptions.map((p, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: "#F0FDF4", borderRadius: 9, border: "1px solid #BBF7D022" }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#374151" }}>{p.typepsc || "Prescription"}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#14532D", maxWidth: "55%", textAlign: "right" as const }}>{p.libelle}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Alerte ABF — missionnement direct */}
                  {hasABFServitude && (
                    <div style={{ background: "#FFFBEB", borderRadius: 12, padding: "16px 18px", border: "1.5px solid #FCD34D", boxShadow: "0 1px 4px rgba(245,158,11,0.12)" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", background: "#FEF3C7", border: "2px solid #FCD34D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>⚜</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>Périmètre ABF — consultation obligatoire</div>
                          <div style={{ fontSize: 12, color: "#B45309", lineHeight: 1.6, marginBottom: 12 }}>Cette parcelle est en périmètre de protection des Monuments Historiques. L'avis de l'Architecte des Bâtiments de France est requis avant toute décision.</div>
                          <button
                            onClick={missionnerABF}
                            disabled={consultationsMissioning}
                            style={{ background: consultationsMissioning ? "#F5F3FF" : "linear-gradient(135deg,#8B5CF6,#7C3AED)", color: consultationsMissioning ? "#8B5CF6" : "white", border: consultationsMissioning ? "1px solid #C4B5FD" : "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: consultationsMissioning ? "default" : "pointer", boxShadow: consultationsMissioning ? "none" : "0 2px 5px rgba(124,58,237,0.3)" }}
                          >
                            {consultationsMissioning ? "Envoi en cours…" : "Missionner l'ABF"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Constructibilité */}
                  {pa?.buildability && (
                    <div style={CARD}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <SecTitle>Constructibilité estimée</SecTitle>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 46, height: 46, borderRadius: "50%", border: "3.5px solid #4F46E5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#4F46E5" }}>{Math.round(pa.buildability.confidence * 100)}%</span>
                          </div>
                          <span style={{ fontSize: 11, color: "#64748b" }}>confiance</span>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {[
                          ["Emprise restante", pa.buildability.remainingFootprintM2 > 0 ? `${Math.round(pa.buildability.remainingFootprintM2)} m²` : "0 m²"],
                          ["Hauteur max.", pa.buildability.maxHeightM ? `${pa.buildability.maxHeightM} m` : "—"],
                          ["Étages estimés", pa.buildability.estimatedFloors ? `${pa.buildability.estimatedFloors} niveaux` : "—"],
                          ["Espaces verts requis", pa.buildability.greenSpaceRequiredM2 ? `${Math.round(pa.buildability.greenSpaceRequiredM2)} m²` : "—"],
                          ["Recul voirie min.", pa.buildability.minSetbackFromRoadM ? `${pa.buildability.minSetbackFromRoadM} m` : "—"],
                          ["Recul limites min.", pa.buildability.minSetbackFromBoundariesM ? `${pa.buildability.minSetbackFromBoundariesM} m` : "—"],
                        ].map(([l, v]) => (
                          <div key={l} style={{ background: "#F8FAFC", borderRadius: 8, padding: "9px 12px" }}>
                            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>{l}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Colonne droite ── */}
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
                  {/* Infos cadastrales */}
                  <div style={CARD}>
                    <SecTitle>Informations cadastrales</SecTitle>
                    {[
                      ["Référence", pa?.parcel?.parcelle_id ?? dossier.parcelle ?? "—"],
                      ["Section / N°", pa?.parcel ? `${pa.parcel.section} / ${pa.parcel.numero}` : "—"],
                      ["Surface parcelle", pa?.parcel?.surface_m2 ? `${pa.parcel.surface_m2} m²` : "—"],
                      ["Commune", pa?.parcel?.commune ?? liveCommune ?? "—"],
                      ["Code INSEE", pa?.parcel?.code_insee ?? "—"],
                      ["Adresse", pa?.address?.label ?? liveAdresse ?? "—"],
                    ].map(([l, v]) => (
                      <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid #F1F5F9" }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>{l}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A", textAlign: "right" as const, maxWidth: "60%" }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* Synthèse PLU */}
                  <div style={CARD}>
                    <SecTitle>Synthèse PLU applicable</SecTitle>
                    {pa?.rules && pa.rules.length > 0 ? (
                      pa.rules.map(rule => (
                        <div key={rule.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12.5, paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid #F8FAFC" }}>
                          <span style={{ color: "#64748b" }}>{TOPIC_LABEL[rule.topic] ?? rule.topic}</span>
                          <span style={{ color: "#0F172A", fontWeight: 600, textAlign: "right" as const, maxWidth: "55%" }}>
                            {rule.summary ?? (rule.value_max != null ? `${rule.value_max}${rule.unit ?? ""}` : rule.rule_text.slice(0, 40))}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: 12.5, color: "#94a3b8", padding: "8px 0" }}>
                        {pa ? "Aucune règle enregistrée pour cette zone." : "En attente de l'analyse…"}
                      </div>
                    )}
                    {pa?.plu_zone?.plu_nom && (
                      <div style={{ marginTop: 8, fontSize: 11, color: "#64748b", fontStyle: "italic" }}>
                        Source GPU : {pa.plu_zone.plu_nom}
                      </div>
                    )}
                  </div>

                  {/* Résumé constructibilité */}
                  {pa?.buildability?.resultSummary && (
                    <div style={{ ...CARD, background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                        <p style={{ fontSize: 12.5, color: "#14532D", margin: 0, lineHeight: 1.6 }}>{pa.buildability.resultSummary}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── CONFORMITÉ IA ── */}
        {activeTab === "Conformité IA" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
              <div style={CARD}>
                <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
                  <div style={{ position: "relative" as const, width: 110, height: 110, flexShrink: 0 }}>
                    <svg width={110} height={110} viewBox="0 0 110 110">
                      <circle cx="55" cy="55" r="44" fill="none" stroke="#EEF2FF" strokeWidth="13" />
                      <circle cx="55" cy="55" r="44" fill="none" stroke="url(#iagrad)" strokeWidth="13" strokeDasharray="276.5" strokeDashoffset={276.5 * (1 - 0.78)} strokeLinecap="round" style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }} />
                      <defs><linearGradient id="iagrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#4F46E5" /><stop offset="100%" stopColor="#818CF8" /></linearGradient></defs>
                    </svg>
                    <div style={{ position: "absolute" as const, inset: 0, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 22, fontWeight: 900, color: "#4F46E5", letterSpacing: "-1px" }}>78%</span>
                      <span style={{ fontSize: 9, color: "#64748b", fontWeight: 700, letterSpacing: "0.06em" }}>CONFORME</span>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 10 }}>Score de conformité PLU</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, marginBottom: 10 }}>
                      <span style={{ background: "#F0FDF4", color: "#15803D", borderRadius: 8, padding: "4px 11px", fontSize: 12, fontWeight: 600, border: "1px solid #BBF7D0" }}>6 conformes</span>
                      <span style={{ background: "#FFF7ED", color: "#C2410C", borderRadius: 8, padding: "4px 11px", fontSize: 12, fontWeight: 600, border: "1px solid #FED7AA" }}>1 vigilance</span>
                      <span style={{ background: "#F8FAFC", color: "#475569", borderRadius: 8, padding: "4px 11px", fontSize: 12, fontWeight: 600, border: "1px solid #E2E8F0" }}>1 non vérifiable</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>Analyse basée sur le PLU de {liveCommune ?? "la commune"} (version 2023) et les documents déposés.</div>
                  </div>
                </div>
              </div>
              <div style={CARD}>
                <SecTitle>Règles vérifiées</SecTitle>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
                  {IA_RULES.map((r, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", padding: "9px 12px", background: i % 2 === 0 ? "#F8FAFC" : "white", borderRadius: 8 }}>
                      <span style={{ fontSize: 13, color: "#374151" }}>{r.rule}</span>
                      <span style={{ fontSize: 11, color: r.ok === true ? "#15803D" : r.ok === false ? "#C2410C" : "#475569", background: r.ok === true ? "#F0FDF4" : r.ok === false ? "#FFF7ED" : "#F8FAFC", borderRadius: 20, padding: "3px 9px", fontWeight: 700, whiteSpace: "nowrap" as const, border: `1px solid ${r.ok === true ? "#BBF7D0" : r.ok === false ? "#FED7AA" : "#E2E8F0"}` }}>{r.result}</span>
                      <span style={{ fontSize: 12, color: "#64748b", textAlign: "right" as const, whiteSpace: "nowrap" as const }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
              <div style={{ ...CARD, background: "linear-gradient(135deg,#FFFBEB,#FFF7ED)", border: "1px solid #FDE68A" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#B45309", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: "#FEF3C7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  </div>
                  Points de vigilance
                </div>
                <div style={{ padding: "14px", background: "white", borderRadius: 10, border: "1px solid #FDE68A", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 6 }}>Recul voirie insuffisant</div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>Le projet présente un recul de 3m alors que l'article UC 6 du PLU impose un minimum de 4m. Une modification du projet ou une dérogation motivée est nécessaire.</div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <button style={{ border: "1px solid #FED7AA", background: "#FFF7ED", borderRadius: 7, padding: "5px 11px", fontSize: 11.5, color: "#C2410C", cursor: "pointer", fontWeight: 600 }}>Demander modification</button>
                    <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 7, padding: "5px 11px", fontSize: 11.5, color: "#374151", cursor: "pointer" }}>Voir article PLU</button>
                  </div>
                </div>
              </div>
              <div style={{ ...CARD, background: "#F8FAFC" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                  </div>
                  Non vérifiables
                </div>
                <div style={{ padding: "14px", background: "white", borderRadius: 10, border: "1px solid #E2E8F0" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 6 }}>Espaces verts ≥ 30%</div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>Les données disponibles ne permettent pas de calculer le ratio d'espaces verts. Une pièce complémentaire peut être demandée.</div>
                </div>
              </div>
              <div style={CARD}>
                <SecTitle>Recommandations IA</SecTitle>
                {[
                  "Demander la modification du plan de masse pour corriger le recul voirie avant instruction définitive.",
                  "Vérifier l'avis ABF reçu : les prescriptions sur les matériaux doivent être intégrées dans l'arrêté.",
                  "Confirmer le ratio d'espaces verts sur le plan de masse révisé.",
                ].map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "10px 12px", background: "#EEF2FF", borderRadius: 9, border: "1px solid #C7D2FE", marginBottom: i < 2 ? 8 : 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#4F46E5", flexShrink: 0, marginTop: 1, width: 16, textAlign: "center" as const }}>{i + 1}</span>
                    <span style={{ fontSize: 12, color: "#3730A3", lineHeight: 1.55 }}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        {activeTab === "Documents" && (
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr 260px", gap: 16 }}>
            <div style={CARD}>
              <SecTitle>Pièces du dossier</SecTitle>
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
                {DOCUMENTS_DATA.map((doc, i) => (
                  <button key={i} onClick={() => setSelectedDoc(i)} style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 11px", borderRadius: 9, border: selectedDoc === i ? "1.5px solid #C7D2FE" : "1.5px solid transparent", cursor: "pointer", textAlign: "left" as const,
                    background: selectedDoc === i ? "#EEF2FF" : "transparent",
                    transition: "background 0.1s",
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: 7, background: doc.ext === "ZIP" ? "#FFF7ED" : "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={doc.ext === "ZIP" ? "#F97316" : "#4F46E5"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1E293B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{doc.name}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{doc.ext} · {doc.size} · {doc.date}</div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: doc.status === "Validé" ? "#15803D" : "#C2410C", background: doc.status === "Validé" ? "#F0FDF4" : "#FFF7ED", borderRadius: 5, padding: "1px 6px", display: "inline-block", marginTop: 4, border: `1px solid ${doc.status === "Validé" ? "#BBF7D0" : "#FED7AA"}` }}>{doc.status}</span>
                    </div>
                  </button>
                ))}
              </div>
              <button style={{ marginTop: 12, width: "100%", border: "2px dashed #E2E8F0", background: "transparent", borderRadius: 9, padding: "10px 0", fontSize: 12, color: "#64748b", cursor: "pointer", fontWeight: 500 }}>+ Ajouter une pièce</button>
            </div>
            <div style={{ ...CARD, display: "flex", flexDirection: "column" as const }}>
              <SecTitle>{`Aperçu : ${DOCUMENTS_DATA[selectedDoc]?.name ?? ""}`}</SecTitle>
              <div style={{ flex: 1, background: "#F8FAFC", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 14, minHeight: 340, border: "1px solid #EAECF0" }}>
                <div style={{ width: 64, height: 80, background: "white", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", border: "1px solid #E2E8F0" }}>
                  <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                </div>
                <div style={{ textAlign: "center" as const }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>{DOCUMENTS_DATA[selectedDoc]?.name}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{DOCUMENTS_DATA[selectedDoc]?.ext} · {DOCUMENTS_DATA[selectedDoc]?.size}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(79,70,229,0.3)" }}>Ouvrir</button>
                  <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "9px 18px", fontSize: 13, cursor: "pointer", color: "#374151", fontWeight: 500 }}>Télécharger</button>
                </div>
              </div>
            </div>
            <div style={CARD}>
              <SecTitle>Analyse IA</SecTitle>
              <div style={{ padding: "14px", background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)", borderRadius: 11, border: "1px solid #C7D2FE", marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#4F46E5", marginBottom: 7, letterSpacing: "0.07em" }}>RÉSULTAT</div>
                <div style={{ fontSize: 12, color: "#3730A3", lineHeight: 1.6 }}>{DOCUMENTS_DATA[selectedDoc]?.ia}</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Cohérence avec le dossier</div>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>Les informations de cette pièce sont cohérentes avec les autres documents déposés.</div>
            </div>
          </div>
        )}

        {/* ── CONSULTATIONS ── */}
        {activeTab === "Consultations" && (() => {
          const cList = consultations ?? [];
          const countTotal = cList.length;
          const countAvis = cList.filter(c => c.status === "avis_recu").length;
          const countAttente = cList.filter(c => c.status === "en_attente").length;
          const countNonRequis = cList.filter(c => c.status === "non_requis").length;

          const statusMeta = (status: string, favorable: boolean | null) => {
            if (status === "avis_recu") return { label: favorable === false ? "Avis défavorable" : favorable === true ? "Avis favorable" : "Avis reçu", color: favorable === false ? "#DC2626" : "#15803D", bg: favorable === false ? "#FEF2F2" : "#F0FDF4" };
            if (status === "non_requis") return { label: "Non requis", color: "#475569", bg: "#F8FAFC" };
            if (status === "refuse") return { label: "Refusé", color: "#DC2626", bg: "#FEF2F2" };
            return { label: "En attente", color: "#C2410C", bg: "#FFF7ED" };
          };

          const fmtDateConsult = (d: string | null) => {
            if (!d) return "—";
            const dt = new Date(d);
            return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("fr-FR");
          };

          const selectedC = selectedConsultation ? cList.find(c => c.id === selectedConsultation) ?? null : null;

          return (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
              {/* Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                {[
                  { label: "Total", value: String(countTotal), color: "#4F46E5", bg: "#EEF2FF", border: "#C7D2FE" },
                  { label: "Avis reçus", value: String(countAvis), color: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" },
                  { label: "En attente", value: String(countAttente), color: "#C2410C", bg: "#FFF7ED", border: "#FED7AA" },
                  { label: "Non requis", value: String(countNonRequis), color: "#475569", bg: "#F8FAFC", border: "#E2E8F0" },
                ].map(s => (
                  <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: "16px 20px", border: `1px solid ${s.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color: s.color, letterSpacing: "-1px", lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginTop: 5 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "flex-start" }}>
                <div style={CARD}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 3, height: 14, background: "#4F46E5", borderRadius: 2, display: "inline-block" }} />
                      Organismes consultés
                    </div>
                    <button
                      onClick={missionnerABF}
                      disabled={consultationsMissioning}
                      style={{ background: consultationsMissioning ? "#EEF2FF" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: consultationsMissioning ? "#4F46E5" : "white", border: consultationsMissioning ? "1px solid #C7D2FE" : "none", borderRadius: 9, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: consultationsMissioning ? "default" : "pointer", boxShadow: consultationsMissioning ? "none" : "0 2px 5px rgba(79,70,229,0.3)" }}
                    >
                      {consultationsMissioning ? "En cours…" : "+ Missionner l'ABF"}
                    </button>
                  </div>
                  {consultationsLoading ? (
                    <div style={{ textAlign: "center" as const, padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>Chargement…</div>
                  ) : cList.length === 0 ? (
                    <div style={{ textAlign: "center" as const, padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>Aucune consultation lancée pour ce dossier.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column" as const, gap: 3 }}>
                      {cList.map((c, i) => {
                        const m = statusMeta(c.status, c.favorable);
                        return (
                          <button key={c.id} onClick={() => setSelectedConsultation(c.id)} style={{
                            display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, alignItems: "center", padding: "12px 14px", border: selectedConsultation === c.id ? "1.5px solid #C7D2FE" : "1.5px solid transparent", cursor: "pointer", borderRadius: 10, textAlign: "left" as const,
                            background: selectedConsultation === c.id ? "#EEF2FF" : i % 2 === 0 ? "#F8FAFC" : "white",
                          }}>
                            <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>{c.service_name}</span>
                            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{fmtDateConsult(c.date_envoi)}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" as const, border: `1px solid ${m.color}33` }}>{m.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {selectedC && (() => {
                  const m = statusMeta(selectedC.status, selectedC.favorable);
                  return (
                    <div style={CARD}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 10 }}>{selectedC.service_name}</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 20, padding: "3px 10px", border: `1px solid ${m.color}33` }}>{m.label}</span>
                        <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Envoyée le {fmtDateConsult(selectedC.date_envoi)}</span>
                      </div>
                      {selectedC.avis ? (
                        <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.7, padding: "13px 14px", background: "#F8FAFC", borderRadius: 10, border: "1px solid #EAECF0" }}>{selectedC.avis}</div>
                      ) : (
                        <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.7, padding: "13px 14px", background: "#F8FAFC", borderRadius: 10, border: "1px solid #EAECF0", fontStyle: "italic" }}>Aucun avis reçu pour l'instant.</div>
                      )}
                      {selectedC.status === "en_attente" && (
                        <button
                          onClick={() => {
                            api.patch(`/mairie/dossiers/${dossier.id}/consultations/${selectedC.id}`, { status: "avis_recu", favorable: true })
                              .then(() => { setConsultations(null); })
                              .catch(() => {});
                          }}
                          style={{ marginTop: 12, width: "100%", border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "9px 0", fontSize: 12.5, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}
                        >
                          Marquer avis reçu
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })()}

        {/* ── CHRONOLOGIE ── */}
        {activeTab === "Chronologie" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "flex-start" }}>
            <div style={CARD}>
              <SecTitle>Historique complet</SecTitle>
              {TIMELINE_DATA.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 16, paddingBottom: i < TIMELINE_DATA.length - 1 ? 22 : 0 }}>
                  <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", width: 36 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: t.color + "18", border: `2px solid ${t.color}55`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 15 }}>{t.icon}</div>
                    {i < TIMELINE_DATA.length - 1 && <div style={{ width: 2, flex: 1, background: "linear-gradient(to bottom,#E2E8F0,#F8FAFC)", marginTop: 8 }} />}
                  </div>
                  <div style={{ paddingBottom: 4, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{t.event}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{t.actor}</div>
                    <div style={{ fontSize: 11, color: "#CBD5E1", marginTop: 3, fontWeight: 500 }}>{t.date}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
              <div style={CARD}>
                <SecTitle>Étapes clés</SecTitle>
                {[
                  { label: "Dépôt", date: dossier.date_depot ? fmtDate(dossier.date_depot) : "—", done: true },
                  { label: "Complétude", date: "22/05/2024", done: true },
                  { label: "Fin d'instruction", date: dossier.echeance, done: false },
                ].map((e, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: i < 2 ? "1px solid #F1F5F9" : "none" }}>
                    <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{e.label}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>{e.date}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, background: e.done ? "#F0FDF4" : "#EFF6FF", color: e.done ? "#15803D" : "#2563EB", borderRadius: 5, padding: "2px 7px", border: `1px solid ${e.done ? "#BBF7D0" : "#BFDBFE"}` }}>{e.done ? "Fait" : "Prévu"}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={CARD}>
                <SecTitle>Temps forts</SecTitle>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
                  <div style={{ background: "#FFF8F0", borderRadius: 10, padding: "12px 14px", border: "1px solid #FDDCB5" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#B45309" }}>Avis ABF avec réserves</div>
                    <div style={{ fontSize: 11.5, color: "#92400E", marginTop: 4, lineHeight: 1.5 }}>30/05/2024 – Prescriptions émises concernant les matériaux.</div>
                  </div>
                  <div style={{ background: "#EFF6FF", borderRadius: 10, padding: "12px 14px", border: "1px solid #BFDBFE" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1D4ED8" }}>Dossier mis en instruction</div>
                    <div style={{ fontSize: 11.5, color: "#1E40AF", marginTop: 4, lineHeight: 1.5 }}>02/06/2024 – Assigné à {instructeurName}.</div>
                  </div>
                </div>
              </div>
              <div style={CARD}>
                <SecTitle>Délais réglementaires</SecTitle>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                  {[["Délai légal", "2 mois (PC maison individuelle)"], ["Date limite", dossier.echeance], daysLeft !== null ? ["Temps restant", `J-${Math.max(0, daysLeft)}`] : null].filter(Boolean).map((row, i) => row && (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "6px 0", borderBottom: i < 1 ? "1px solid #F1F5F9" : "none" }}>
                      <span style={{ color: "#64748b" }}>{row[0]}</span>
                      <span style={{ fontWeight: 700, color: i === 2 ? (daysLeft !== null && daysLeft < 14 ? "#DC2626" : "#15803D") : "#0F172A" }}>{row[1]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── DÉCISION ── */}
        {activeTab === "Décision" && (
          <DecisionPanel dossier={dossier} liveCommune={liveCommune} currentUserId={user?.id} />
        )}

      </div>
      {showCourrierModal && (
        <CourrierModal
          dossier={{
            id: dossier.id,
            numero: dossier.numero,
            type: dossier.type,
            petitionnaire: dossier.petitionnaire,
            adresse: dossier.adresse,
            commune: dossier.commune,
            code_postal: dossier.code_postal,
            parcelle: dossier.parcelle,
            surface_plancher: dossier.surface_plancher,
            date_depot: dossier.date_depot,
            echeance: dossier.echeance,
          }}
          onClose={() => setShowCourrierModal(false)}
        />
      )}
    </div>
  );
}


function NouveauDossierModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"choose" | "manual" | "ocr">("choose");
  const [ocrFile, setOcrFile] = useState<string | null>(null);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrDone, setOcrDone] = useState(false);

  const handleOcrFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setOcrFile(e.target.files[0].name);
      setOcrScanning(true);
      setTimeout(() => { setOcrScanning(false); setOcrDone(true); }, 2000);
    }
  };

  const Overlay = ({ children }: { children: React.ReactNode }) => (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 16, width: 580, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.22)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );

  const ModalHeader = ({ title, back }: { title: string; back?: () => void }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 24px", borderBottom: "1px solid #E2E8F0" }}>
      {back && <button onClick={back} style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18, lineHeight: 1, padding: 0 }}>←</button>}
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", flex: 1 }}>{title}</div>
      <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8", lineHeight: 1 }}>×</button>
    </div>
  );

  if (mode === "choose") return (
    <Overlay>
      <ModalHeader title="Nouveau dossier" />
      <div style={{ padding: "24px", display: "flex", flexDirection: "column" as const, gap: 12 }}>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>Choisissez le mode de saisie du dossier.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 4 }}>
          <button onClick={() => setMode("manual")} style={{ border: "2px solid #E2E8F0", borderRadius: 14, padding: "24px 20px", cursor: "pointer", background: "white", textAlign: "left", transition: "border-color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "#4F46E5")} onMouseLeave={e => (e.currentTarget.style.borderColor = "#E2E8F0")}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📝</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Saisie manuelle</div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>Remplissez le formulaire CERFA et les pièces complémentaires manuellement.</div>
          </button>
          <button onClick={() => setMode("ocr")} style={{ border: "2px solid #E2E8F0", borderRadius: 14, padding: "24px 20px", cursor: "pointer", background: "white", textAlign: "left", transition: "border-color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "#4F46E5")} onMouseLeave={e => (e.currentTarget.style.borderColor = "#E2E8F0")}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📷</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Reconnaissance OCR</div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>Importez un CERFA scanné ou des pièces complémentaires — les données seront extraites automatiquement.</div>
          </button>
        </div>
      </div>
    </Overlay>
  );

  if (mode === "ocr") return (
    <Overlay>
      <ModalHeader title="Reconnaissance OCR" back={() => setMode("choose")} />
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column" as const, gap: 16 }}>
        {!ocrFile ? (
          <label style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", border: "2px dashed #CBD5E1", borderRadius: 12, padding: "40px 24px", cursor: "pointer", gap: 10, background: "#F8FAFC" }}>
            <span style={{ fontSize: 36 }}>📂</span>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>Déposez votre fichier ici</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>PDF, JPG ou PNG — CERFA, plan de situation, pièces complémentaires</div>
            <div style={{ background: "#4F46E5", color: "white", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600 }}>Choisir un fichier</div>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleOcrFile} style={{ display: "none" }} />
          </label>
        ) : ocrScanning ? (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 6 }}>Analyse en cours…</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Extraction des données de {ocrFile}</div>
            <div style={{ marginTop: 16, height: 4, background: "#E2E8F0", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "linear-gradient(90deg,#4F46E5,#6366F1)", borderRadius: 2, animation: "none", width: "60%" }} />
            </div>
          </div>
        ) : ocrDone ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, background: "#F0FDF4", borderRadius: 8, padding: "10px 14px", border: "1px solid #BBF7D0" }}>
              <span style={{ fontSize: 18 }}>✅</span>
              <div style={{ fontSize: 13, color: "#15803D", fontWeight: 500 }}>Données extraites de {ocrFile}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
              {[["Type de dossier", "Permis de construire"], ["Pétitionnaire", "Jean Dupont"], ["Adresse", "12 rue des Lilas, Ballan-Miré"], ["CERFA n°", "13406*08"], ["SIRET", "—"]].map(([label, value]) => (
                <div key={label} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 160, fontSize: 12, fontWeight: 600, color: "#374151", flexShrink: 0 }}>{label}</div>
                  <input defaultValue={value} style={{ flex: 1, padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none" }} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {ocrDone && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 24px", borderTop: "1px solid #E2E8F0" }}>
          <button onClick={onClose} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, color: "#374151", cursor: "pointer" }}>Annuler</button>
          <button onClick={onClose} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Créer le dossier</button>
        </div>
      )}
    </Overlay>
  );

  return (
    <Overlay>
      <ModalHeader title="Nouveau dossier — Saisie manuelle" back={() => setMode("choose")} />
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column" as const, gap: 14 }}>
        {[
          { label: "Type de dossier", el: <select style={{ width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", background: "white", outline: "none" }}><option>Permis de construire</option><option>Déclaration préalable</option><option>Permis d'aménager</option><option>Certificat d'urbanisme</option></select> },
          { label: "Pétitionnaire", el: <input placeholder="Nom du pétitionnaire" style={{ width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", boxSizing: "border-box" as const }} /> },
          { label: "Adresse du projet", el: <input placeholder="Adresse" style={{ width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", boxSizing: "border-box" as const }} /> },
          { label: "Date de dépôt", el: <input type="date" style={{ width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", boxSizing: "border-box" as const }} /> },
          { label: "Instructeur assigné", el: <select style={{ width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", background: "white", outline: "none" }}><option>Marie Lambert</option><option>Pierre Martin</option><option>Sophie Dubois</option></select> },
        ].map(({ label, el }) => (
          <div key={label}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>{label}</label>
            {el}
          </div>
        ))}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Pièces jointes</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, border: "1px dashed #CBD5E1", borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontSize: 12, color: "#64748b" }}>
            <span style={{ fontSize: 18 }}>📎</span> Ajouter des pièces (PDF, JPG, PNG)
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style={{ display: "none" }} />
          </label>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 24px", borderTop: "1px solid #E2E8F0" }}>
        <button onClick={onClose} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, color: "#374151", cursor: "pointer", fontWeight: 500 }}>Annuler</button>
        <button onClick={onClose} style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Créer le dossier</button>
      </div>
    </Overlay>
  );
}

function SignaturesPendantesScreen() {
  type PendingRow = {
    id: string;
    status: string;
    type: string;
    commune: string;
    created_at: string;
    dossier: { id: string; numero: string; type: string; commune: string | null; adresse: string | null } | null;
    instructeur: { prenom: string | null; nom: string | null } | null;
  };
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [refuseMotif, setRefuseMotif] = useState("");
  const routerNavigate = useNavigate();

  const load = () => {
    api.get<PendingRow[]>("/decisions/pending")
      .then(data => setRows(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const DECISION_LABEL: Record<string, string> = {
    accord: "Accord", accord_prescription: "Accord avec prescriptions", refus: "Refus",
    sursis_a_statuer: "Sursis à statuer", non_opposition: "Non-opposition",
    non_opposition_prescription: "Non-opposition avec prescriptions", opposition: "Opposition",
    pieces_complementaires: "Demande de pièces", cu_positif: "CU positif", cu_negatif: "CU négatif",
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Signatures en attente</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Projets d'arrêtés soumis pour votre signature.</p>
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "48px 24px", textAlign: "center" as const }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", marginBottom: 6 }}>Aucune signature en attente</div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Tous les projets d'arrêtés ont été traités.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
          {rows.map(row => (
            <div key={row.id} style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 18, display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#4F46E5" }}>{row.dossier?.numero ?? "—"}</span>
                  <span style={{ fontSize: 11, background: "#EEF2FF", color: "#4F46E5", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>{DECISION_LABEL[row.type] ?? row.type}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 2 }}>
                  {row.dossier?.adresse ?? "—"} — {row.dossier?.commune ?? row.commune}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  Préparé par {row.instructeur?.prenom} {row.instructeur?.nom} · {new Date(row.created_at).toLocaleDateString("fr-FR")}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button onClick={() => row.dossier?.id && routerNavigate(`/mairie/dossiers/${row.dossier.id}`)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "#374151" }}>
                  Voir le dossier
                </button>
                <button onClick={async () => {
                  setSigning(row.id);
                  try {
                    await api.post(`/decisions/${row.id}/sign`, {});
                    load();
                  } catch { /* ignore */ } finally { setSigning(null); }
                }} disabled={signing === row.id} style={{ background: "linear-gradient(135deg,#059669,#10B981)", color: "white", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {signing === row.id ? "…" : "Signer"}
                </button>
                <button onClick={() => setRefusing(row.id)} style={{ background: "white", color: "#EF4444", border: "1px solid #FECACA", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
                  Refuser
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Refuse modal */}
      {refusing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => { setRefusing(null); setRefuseMotif(""); }}>
          <div style={{ background: "white", borderRadius: 14, width: 460, padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Motif du refus</div>
            <textarea value={refuseMotif} onChange={e => setRefuseMotif(e.target.value)} rows={4} placeholder="Précisez la raison du refus…" style={{ width: "100%", border: "1.5px solid #E2E8F0", borderRadius: 9, padding: "10px 12px", fontSize: 12.5, outline: "none", resize: "vertical" as const, fontFamily: "inherit", boxSizing: "border-box" as const, marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
              <button onClick={() => { setRefusing(null); setRefuseMotif(""); }} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Annuler</button>
              <button onClick={async () => {
                if (!refuseMotif.trim()) return;
                try { await api.post(`/decisions/${refusing}/refuse-signature`, { motif: refuseMotif }); load(); }
                catch { /* ignore */ }
                setRefusing(null); setRefuseMotif("");
              }} disabled={!refuseMotif.trim()} style={{ background: "#EF4444", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DossierDetailRoute({ navigate }: { navigate: (s: string) => void }) {
  const { id } = useParams<{ id: string }>();
  const routerNavigate = useNavigate();
  const [dossier, setDossier] = useState<DossierInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    type ApiDetail = {
      id: string; numero: string; type: string; status: string;
      adresse: string | null; commune: string | null; code_postal: string | null;
      description: string | null; parcelle: string | null; surface_plancher: string | null;
      date_limite_instruction: string | null; date_depot: string | null;
      metadata: Record<string, unknown> | null;
      demandeur: { prenom?: string; nom?: string } | null;
      instructeur: { prenom?: string; nom?: string } | null;
    };
    api.get<ApiDetail>(`/mairie/dossiers/${id}`)
      .then(data => {
        const meta = (data.metadata ?? {}) as Record<string, unknown>;
        const lat = parseFloat(String(meta["lat"] ?? ""));
        const lng = parseFloat(String(meta["lng"] ?? ""));
        setDossier({
          id: data.id,
          numero: data.numero,
          type: data.type,
          petitionnaire: data.demandeur ? ([data.demandeur.prenom, data.demandeur.nom].filter(Boolean).join(" ") || "—") : "—",
          adresse: data.adresse ?? "—",
          status: data.status,
          echeance: fmtDate(data.date_limite_instruction),
          date_depot: data.date_depot ?? undefined,
          description: data.description ?? undefined,
          parcelle: data.parcelle ?? undefined,
          surface_plancher: data.surface_plancher ?? undefined,
          commune: data.commune ?? undefined,
          code_postal: data.code_postal ?? undefined,
          instructeur: data.instructeur ? ([data.instructeur.prenom, data.instructeur.nom].filter(Boolean).join(" ") || undefined) : undefined,
          lat: isNaN(lat) ? undefined : lat,
          lng: isNaN(lng) ? undefined : lng,
        });
      })
      .catch(() => routerNavigate("/mairie/dossiers", { replace: true }))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>Chargement…</div>;
  if (!dossier) return null;
  return <DossierDetailScreen dossier={dossier} onBack={() => routerNavigate(-1 as never)} navigate={navigate} />;
}

const COMMUNE_STORAGE_KEY = (userId?: string) => `heureka_commune_${userId ?? "anon"}`;

export function MairieApp() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canManageUsers = user?.role === "admin" || user?.role === "mairie";
  const [commune, setCommuteRaw] = useState(user?.commune ?? "");
  const [userCommunes, setUserCommunes] = useState<string[]>([]);
  const [showNouveauDossier, setShowNouveauDossier] = useState(false);
  const [messageBadge, setMessageBadge] = useState(0);
  const [signaturesBadge, setSignaturesBadge] = useState(0);
  const [isSignataire, setIsSignataire] = useState(false);
  const [communeInseeMap, setCommuneInseeMap] = useState<Record<string, string>>(COMMUNE_INSEE);
  const routerNavigate = useNavigate();
  const location = useLocation();

  const setCommune = (c: string) => {
    setCommuteRaw(c);
    try { localStorage.setItem(COMMUNE_STORAGE_KEY(user?.id), c); } catch { /* ignore */ }
  };

  // Load communes accessible to this user
  useEffect(() => {
    api.get<{ name: string; insee_code: string | null }[]>("/mairie/my-communes")
      .then(data => {
        const names = data.map(c => c.name).filter(Boolean);
        setUserCommunes(names);
        // Mettre à jour l'INSEE map
        const map: Record<string, string> = { ...COMMUNE_INSEE };
        for (const c of data) { if (c.name && c.insee_code) map[c.name] = c.insee_code; }
        setCommuneInseeMap(map);
        // Restaurer depuis localStorage, sinon première commune de la liste
        setCommuteRaw(prev => {
          try {
            const stored = localStorage.getItem(COMMUNE_STORAGE_KEY(user?.id));
            if (stored && names.includes(stored)) return stored;
          } catch { /* ignore */ }
          if (prev && names.includes(prev)) return prev;
          return names[0] ?? prev;
        });
      })
      .catch(() => {});
  }, [user?.id]);

  // Load commune list from DB to get correct INSEE codes
  const refreshCommuneInseeMap = useCallback(() => {
    api.get<{ name: string; insee_code: string }[]>("/mairie/commune-list")
      .then(data => {
        if (!data.length) return;
        const map: Record<string, string> = { ...COMMUNE_INSEE };
        for (const c of data) { if (c.name && c.insee_code) map[c.name] = c.insee_code; }
        setCommuneInseeMap(map);
      })
      .catch(() => {});
  }, []);
  useEffect(() => { refreshCommuneInseeMap(); }, [refreshCommuneInseeMap]);

  // Charge le badge initial quand la commune change ; MessageScreen maintient ensuite le total en temps réel
  useEffect(() => {
    api.get<{ count: number }>(`/mairie/conversations/unread-count?commune=${encodeURIComponent(commune)}`)
      .then(d => setMessageBadge(Number(d.count)))
      .catch(() => {});
  }, [commune]);

  const checkSignataireStatus = useCallback(() => {
    api.get<{ isSignataire: boolean }>("/decisions/is-signataire")
      .then(d => {
        setIsSignataire(d.isSignataire);
        if (d.isSignataire) {
          api.get<{ count: number }>("/decisions/pending-count")
            .then(d2 => setSignaturesBadge(d2.count))
            .catch(() => {});
        } else {
          setSignaturesBadge(0);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    checkSignataireStatus();
    const onFocus = () => checkSignataireStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkSignataireStatus]);

  const pathname = location.pathname;
  const active = pathname.startsWith("/mairie/dossiers") ? "Dossiers"
    : pathname.startsWith("/mairie/messagerie") ? "Messagerie"
    : pathname.startsWith("/mairie/calendrier") ? "Calendrier"
    : pathname.startsWith("/mairie/carte") ? "Carte"
    : pathname.startsWith("/mairie/statistiques") ? "Statistiques"
    : pathname.startsWith("/mairie/signatures") ? "Signatures"
    : pathname.startsWith("/mairie/parametres") ? "Paramètres"
    : pathname.startsWith("/mairie/profil") ? "Infos Perso"
    : "Tableau de bord";

  const setActive = (s: string) => routerNavigate(LABEL_TO_PATH[s] ?? "/mairie");

  const handleDossierClick = (dossier: DossierInfo) => {
    routerNavigate(`/mairie/dossiers/${dossier.id}`, { state: { dossier } });
  };

  const navigateDossiers = (filter: string) => {
    routerNavigate(`/mairie/dossiers?filter=${encodeURIComponent(filter)}`);
  };

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#F8F9FC", minHeight: "100vh", display: "flex" }}>
      <Sidebar active={active} setActive={setActive} commune={commune} setCommune={setCommune} messageBadge={messageBadge} signaturesBadge={signaturesBadge} isSignataire={isSignataire} communes={userCommunes} />
      <div style={{ marginLeft: 200, flex: 1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {active !== "Messagerie" && (
          <Topbar onNewDossier={active === "Dossiers" ? () => setShowNouveauDossier(true) : undefined} navigate={setActive} onDossierClick={handleDossierClick} commune={commune} onViewAllNotifications={() => routerNavigate("/mairie/parametres?tab=notifications")} />
        )}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <Routes>
            <Route index element={<DashboardScreen navigate={setActive} navigateDossiers={navigateDossiers} commune={commune} inseeCode={communeInseeMap[commune]} onDossierClick={handleDossierClick} />} />
            <Route path="dossiers" element={<DossiersScreen commune={commune} onDossierClick={handleDossierClick} />} />
            <Route path="dossiers/:id" element={<DossierDetailRoute navigate={setActive} />} />
            <Route path="messagerie" element={<MessageScreen commune={commune} onDossierClick={handleDossierClick} onUnreadChange={setMessageBadge} />} />
            <Route path="calendrier" element={<CalendrierScreen commune={commune} />} />
            <Route path="carte" element={<CarteScreen commune={commune} setCommune={setCommune} communeInseeMap={communeInseeMap} />} />
            <Route path="statistiques" element={<StatistiquesScreen commune={commune} />} />
            <Route path="parametres" element={<ParametresScreen commune={commune} isAdmin={isAdmin} canManageUsers={canManageUsers} communeInseeMap={communeInseeMap} onInseeUpdated={refreshCommuneInseeMap} />} />
            <Route path="signatures" element={<SignaturesPendantesScreen />} />
            <Route path="profil" element={<InfosPersoScreen />} />
            <Route path="*" element={<Navigate to="/mairie" replace />} />
          </Routes>
        </div>
      </div>
      {showNouveauDossier && <NouveauDossierModal onClose={() => setShowNouveauDossier(false)} />}
    </div>
  );
}
