import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { MapLeaflet, type MapDossier, type BaseLayer } from "../../components/MapLeaflet";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { CourrierModal, TemplateManagerPanel, CommuneLetterheadPanel } from "./MairieCourrierScreen";
import { RegulatoryChecklist } from "../../components/RegulatoryChecklist";
import { PieceRegulatoryLinks } from "../../components/PieceRegulatoryLinks";
import { RegulatoryDocViewer } from "../../components/RegulatoryDocViewer";
import { ResizableSplit } from "../../components/ResizableSplit";
import { PdfAnnotator } from "../../components/PdfAnnotator";
import { useInstructionViewMode } from "../../hooks/useInstructionViewMode";
import { useLocalStorageBool } from "../../hooks/useLocalStorageBool";
import { linkifyArticles } from "../../utils/linkifyArticles";
import {
  STATUS_LABELS as DOSSIER_STATUS_LABELS,
  primaryNextAction as primaryNextActionFor,
  type DossierStatus,
  type NextAction,
} from "@heureka-v1/shared";

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
                    <button key={c} onClick={() => { const changed = c !== commune; setCommune(c); setShowDrop(false); setSearch(""); if (changed) setActive("Tableau de bord"); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left" as const, fontSize: 12, color: c === commune ? "#818cf8" : "#94a3b8", fontWeight: c === commune ? 600 : 400 }}>
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
      const qs = commune ? `search=${encodeURIComponent(searchQuery)}&commune=${encodeURIComponent(commune)}&limit=8` : `search=${encodeURIComponent(searchQuery)}&limit=8`;
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
  permis_de_construire: "Permis de construire (PC)",
  permis_de_construire_mi: "Permis de construire — Maison individuelle (PCMI)",
  declaration_prealable: "Déclaration préalable",
  permis_amenager: "Permis d'aménager",
  permis_demolir: "Permis de démolir",
  permis_lotir: "Permis de lotir",
  certificat_urbanisme: "Certificat d'urbanisme",
  certificat_urbanisme_a: "Certificat d'urbanisme informatif (CUa)",
  certificat_urbanisme_b: "Certificat d'urbanisme opérationnel (CUb)",
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
  instructeur_id?: string | null;
  instructeur?: string | null;
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
  const { user } = useAuth();
  // Les rôles de supervision (mairie, admin) voient la colonne « Instructeur »
  // pour identifier rapidement l'agent en charge ; les instructeurs eux-mêmes
  // ne la voient pas (ils n'instruisent que leurs propres dossiers).
  const isSupervisor = user?.role === "mairie" || user?.role === "admin";
  const tabs = ["Tous", "Nouveau", "En instruction", "Pré-instruction", "Incomplet", "Décision en cours", "Accepté", "Refusé"];
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("filter") ?? "Tous");
  // Portée de la liste : tous les dossiers de la commune, uniquement ceux
  // pris en charge par l'utilisateur connecté, ou la "boîte à trier" des
  // dossiers sans instructeur.
  type Scope = "all" | "mine" | "unassigned";
  const [scope, setScope] = useState<Scope>((searchParams.get("scope") as Scope) || "all");

  useEffect(() => {
    setActiveTab(searchParams.get("filter") ?? "Tous");
    setScope((searchParams.get("scope") as Scope) || "all");
  }, [searchParams]);

  const [searchQ, setSearchQ] = useState("");
  const [apiDossiers, setApiDossiers] = useState<ApiDossier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showColPicker, setShowColPicker] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [rowActionBusy, setRowActionBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  type ColKey = "petitionnaire" | "adresse" | "type" | "statut" | "date_depot" | "echeance" | "instructeur";
  const ALL_COLS: { key: ColKey; label: string }[] = [
    { key: "petitionnaire", label: "Pétitionnaire" },
    { key: "adresse", label: "Adresse" },
    { key: "type", label: "Type de dossier" },
    { key: "statut", label: "Statut" },
    { key: "date_depot", label: "Date de dépôt" },
    { key: "echeance", label: "Date d'échéance" },
    ...(isSupervisor ? [{ key: "instructeur" as ColKey, label: "Instructeur" }] : []),
  ];

  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    try {
      const saved = localStorage.getItem("dossiers_cols");
      if (saved) {
        const cols = new Set(JSON.parse(saved) as ColKey[]);
        if (isSupervisor && !cols.has("instructeur")) cols.add("instructeur");
        return cols;
      }
    } catch {}
    const defaults: ColKey[] = ["petitionnaire", "adresse", "type", "statut", "date_depot", "echeance"];
    if (isSupervisor) defaults.push("instructeur");
    return new Set<ColKey>(defaults);
  });

  const toggleCol = (key: ColKey) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem("dossiers_cols", JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Re-fetch when commune or scope changes; compute deadlines on first load
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ commune, limit: "500" });
    if (scope === "mine") params.set("mine", "true");
    else if (scope === "unassigned") params.set("unassigned", "true");
    fetch("/api/mairie/admin/compute-deadlines", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } })
      .catch(() => {})
      .finally(() => {
        api.get<ApiDossier[]>(`/mairie/dossiers?${params.toString()}`)
          .then(d => setApiDossiers(d))
          .catch(() => {})
          .finally(() => setLoading(false));
      });
  }, [commune, scope, refreshKey]);

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
    instructeur: d.instructeur ?? null,
  }));

  const tabCounts: Record<string, number> = Object.fromEntries(
    tabs.map(t => [t, t === "Tous" ? allRows.length : allRows.filter(r => r.statusLabel === t).length])
  );
  const rows = allRows.filter(r => {
    const matchTab = activeTab === "Tous" || r.statusLabel === activeTab;
    const matchQ = !searchQ || r.numero.toLowerCase().includes(searchQ.toLowerCase()) || r.pet.toLowerCase().includes(searchQ.toLowerCase()) || r.addr.toLowerCase().includes(searchQ.toLowerCase());
    return matchTab && matchQ;
  });

  // N° Dossier + colonnes visibles (en excluant « instructeur » pour les
  // non-superviseurs, qui ne voient pas la colonne) + Actions.
  const colSpan = 2 + [...visibleCols].filter(c => c !== "instructeur" || isSupervisor).length;

  const thStyle: React.CSSProperties = { padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Dossiers — {commune}</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Retrouvez et suivez l'avancement de tous les dossiers.</p>
      </div>

      {/* Portée : tous / mes dossiers / boîte à trier */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {([
          { key: "all", label: "Tous les dossiers" },
          { key: "mine", label: "Mes dossiers" },
          { key: "unassigned", label: "Non assignés" },
        ] as { key: Scope; label: string }[]).map(opt => {
          const active = scope === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => {
                setScope(opt.key);
                const sp = new URLSearchParams(searchParams);
                if (opt.key === "all") sp.delete("scope"); else sp.set("scope", opt.key);
                setSearchParams(sp, { replace: true });
              }}
              style={{
                border: active ? "1px solid #4F46E5" : "1px solid #E2E8F0",
                background: active ? "#EEF2FF" : "white",
                color: active ? "#4F46E5" : "#475569",
                borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 600,
                cursor: "pointer", whiteSpace: "nowrap" as const,
              }}>
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Status tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E2E8F0", marginBottom: 16, overflowX: "auto" }}>
        {tabs.map(t => {
          const active = t === activeTab;
          return (
            <button key={t} onClick={() => {
              setActiveTab(t);
              const sp = new URLSearchParams(searchParams);
              if (t === "Tous") sp.delete("filter"); else sp.set("filter", t);
              setSearchParams(sp, { replace: true });
            }} style={{ border: "none", background: "none", padding: "8px 14px", fontSize: 13, fontWeight: active ? 600 : 400, color: active ? "#4F46E5" : "#64748b", borderBottom: active ? "2px solid #4F46E5" : "2px solid transparent", marginBottom: -2, cursor: "pointer", whiteSpace: "nowrap" }}>
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
              {isSupervisor && visibleCols.has("instructeur") && <th style={thStyle}>Instructeur</th>}
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
                {isSupervisor && visibleCols.has("instructeur") && (
                  <td style={{ padding: "12px 16px", fontSize: 13, color: r.instructeur ? "#374151" : "#94A3B8" }}>
                    {r.instructeur ?? "Non assigné"}
                  </td>
                )}
                <td style={{ padding: "12px 16px", position: "relative" }}>
                  <button
                    style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", padding: 4, borderRadius: 4 }}
                    onClick={e => { e.stopPropagation(); setMenuOpenId(prev => prev === r.id ? null : r.id); }}
                    aria-label="Actions du dossier"
                  >
                    <DotsIcon />
                  </button>
                  {menuOpenId === r.id && (
                    <>
                      <div
                        onClick={e => { e.stopPropagation(); setMenuOpenId(null); }}
                        style={{ position: "fixed", inset: 0, zIndex: 98 }}
                      />
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{ position: "absolute", right: 12, top: 38, background: "white", border: "1px solid #E2E8F0", borderRadius: 8, padding: 4, zIndex: 99, minWidth: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.10)" }}
                      >
                        <button
                          onClick={async () => {
                            try { await navigator.clipboard.writeText(r.numero); } catch {}
                            setMenuOpenId(null);
                          }}
                          style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: "8px 10px", fontSize: 13, color: "#374151", cursor: "pointer", borderRadius: 6 }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#F1F5F9")}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >
                          Copier le N° de dossier
                        </button>
                        {isSupervisor && r.instructeur && (
                          <button
                            disabled={rowActionBusy}
                            onClick={async () => {
                              setRowActionBusy(true);
                              try {
                                await api.delete(`/mairie/dossiers/${r.id}/assign`);
                                setRefreshKey(k => k + 1);
                              } catch (err) {
                                alert(err instanceof Error ? err.message : "Désassignation impossible");
                              } finally {
                                setRowActionBusy(false);
                                setMenuOpenId(null);
                              }
                            }}
                            style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: "8px 10px", fontSize: 13, color: "#B91C1C", cursor: rowActionBusy ? "wait" : "pointer", borderRadius: 6, opacity: rowActionBusy ? 0.6 : 1 }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#FEF2F2")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                          >
                            Désassigner l'instructeur
                          </button>
                        )}
                      </div>
                    </>
                  )}
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
  type ServiceConv = {
    consultation_id: string;
    dossier_id: string;
    numero: string;
    type: string;
    status: string;
    service_name: string;
    service_type: string;
    service_full_name: string | null;
    service_email: string | null;
    consultation_status: string;
    favorable: boolean | null;
    last_content: string | null;
    last_from_role: string | null;
    last_at: string | null;
    unread_count: number;
  };

  const [tab, setTab] = useState("Citoyens");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [serviceConvs, setServiceConvs] = useState<ServiceConv[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceConv | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [serviceThread, setServiceThread] = useState<Msg[]>([]);
  const [citizenDraft, setCitizenDraft] = useState("");
  const [serviceDraft, setServiceDraft] = useState("");
  const [sending, setSending] = useState(false);

  const refreshConvs = () =>
    api.get<Conv[]>(`/mairie/conversations?commune=${encodeURIComponent(commune)}`).then(data => setConvs(data)).catch(() => {});
  const refreshServiceConvs = () =>
    api.get<ServiceConv[]>(`/mairie/service-conversations?commune=${encodeURIComponent(commune)}`).then(setServiceConvs).catch(() => {});

  // Badge sidebar = citoyens non lus + services non lus (réactif)
  useEffect(() => {
    const citizenCount = convs.reduce((s, c) => s + c.unread_count, 0);
    const svcCount = serviceConvs.reduce((s, c) => s + c.unread_count, 0);
    onUnreadChange?.(citizenCount + svcCount);
  }, [convs, serviceConvs]);

  useEffect(() => {
    setSelected(null);
    setSelectedService(null);
    setThread([]);
    setServiceThread([]);
    refreshConvs();
    refreshServiceConvs();
  }, [commune]);

  // Quand on sélectionne une conversation citoyen, charger le thread et marquer comme lu
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

  // Quand on sélectionne une consultation service, charger le thread + mark read
  useEffect(() => {
    if (!selectedService) return;
    const cid = selectedService.consultation_id;
    api.get<Msg[]>(`/mairie/service-conversations/${cid}`).then(setServiceThread).catch(() => setServiceThread([]));
    api.post(`/mairie/service-conversations/${cid}/read`)
      .then(() => {
        setServiceConvs(prev => prev.map(c =>
          c.consultation_id === cid ? { ...c, unread_count: 0 } : c
        ));
        setSelectedService(prev => prev && prev.consultation_id === cid ? { ...prev, unread_count: 0 } : prev);
      })
      .catch(() => {});
  }, [selectedService?.consultation_id]);

  const sendCitizenMessage = async () => {
    if (!selected || !citizenDraft.trim() || sending) return;
    const draft = citizenDraft.trim();
    setSending(true);
    try {
      const msg = await api.post<Msg>(`/mairie/conversations/${selected.dossier_id}`, { content: draft });
      setThread(prev => [...prev, msg]);
      setCitizenDraft("");
      setConvs(prev => prev.map(c => c.dossier_id === selected.dossier_id
        ? { ...c, last_content: msg.content, last_from_role: msg.from_role, last_at: msg.created_at }
        : c));
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const sendServiceMessage = async () => {
    if (!selectedService || !serviceDraft.trim() || sending) return;
    const draft = serviceDraft.trim();
    const cid = selectedService.consultation_id;
    setSending(true);
    try {
      const msg = await api.post<Msg>(`/mairie/service-conversations/${cid}`, { content: draft });
      setServiceThread(prev => [...prev, msg]);
      setServiceDraft("");
      setServiceConvs(prev => prev.map(c => c.consultation_id === cid
        ? { ...c, last_content: msg.content, last_from_role: msg.from_role, last_at: msg.created_at }
        : c));
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

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

  const totalCitizenUnread = convs.reduce((s, c) => s + c.unread_count, 0);
  const totalServiceUnread = serviceConvs.reduce((s, c) => s + c.unread_count, 0);

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
          }) : serviceConvs.length === 0 ? (
            <div style={{ padding: "20px 16px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
              Aucune consultation de service pour cette commune.
            </div>
          ) : serviceConvs.map((c) => {
            const isActive = selectedService?.consultation_id === c.consultation_id;
            const displayName = c.service_full_name ?? c.service_name;
            const color = stringToColor(displayName);
            return (
            <div key={c.consultation_id} onClick={() => {
              setSelectedService(c);
              setSelected(null);
            }} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #F8FAFC", background: isActive ? "#F0F4FF" : "white" }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#F8FAFC"; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "white"; }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: color, color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials(displayName)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{displayName}</span>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>{c.last_at ? fmtConvTime(c.last_at) : ""}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{c.numero}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.last_content ?? "Aucun message envoyé"}
                  </div>
                </div>
                {c.unread_count > 0 && <span style={{ background: "#4F46E5", color: "white", borderRadius: "50%", width: 18, height: 18, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{c.unread_count}</span>}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* ── Thread ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#FAFBFD" }}>
        {selectedService ? (() => {
          const svcName = selectedService.service_full_name ?? selectedService.service_name;
          const svcColor = stringToColor(svcName);
          const svcInitials = nameInitials(svcName);
          return (<>
          {/* Service thread */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: svcColor, color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{svcInitials}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{svcName}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  Consultation —{" "}
                  <button
                    onClick={() => onDossierClick({ id: selectedService.dossier_id, numero: selectedService.numero, type: selectedService.type, petitionnaire: "—", adresse: "—", status: selectedService.status, echeance: "—" })}
                    style={{ background: "none", border: "none", padding: 0, color: "#4F46E5", fontWeight: 600, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                  >
                    {selectedService.numero}
                  </button>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}><DotsIcon /></button>
            </div>
          </div>
          <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
            {serviceThread.length === 0 ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>
                Aucun message — envoyez le premier message au service consulté.
              </div>
            ) : serviceThread.map((msg) => {
              const isMairie = !msg.from_role.startsWith("service_externe");
              const time = new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
              return (
                <div key={msg.id} style={{ display: "flex", gap: 10, marginBottom: 16, justifyContent: isMairie ? "flex-end" : "flex-start" }}>
                  {!isMairie && <div style={{ width: 32, height: 32, borderRadius: "50%", background: svcColor, color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{svcInitials}</div>}
                  <div style={{ maxWidth: "60%" }}>
                    {isMairie ? (
                      <div style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", borderRadius: "12px 4px 12px 12px", padding: "12px 14px" }}>
                        <p style={{ margin: 0, fontSize: 13, color: "white", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{msg.content}</p>
                      </div>
                    ) : (
                      <div style={{ background: "white", borderRadius: "4px 12px 12px 12px", padding: "12px 14px", border: "1px solid #E2E8F0", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                        <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{msg.content}</p>
                      </div>
                    )}
                    <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, display: "block", textAlign: isMairie ? "right" : "left" }}>{time}</span>
                  </div>
                  {isMairie && <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials([msg.prenom, msg.nom].filter(Boolean).join(" ") || "Mairie")}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", gap: 10 }}>
            <input
              placeholder="Écrire un message..."
              value={serviceDraft}
              onChange={e => setServiceDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendServiceMessage(); } }}
              disabled={sending}
              style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 8, padding: "9px 14px", fontSize: 13, outline: "none" }}
            />
            <button
              onClick={() => void sendServiceMessage()}
              disabled={!serviceDraft.trim() || sending}
              style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #4F46E5, #6366F1)", border: "none", cursor: serviceDraft.trim() && !sending ? "pointer" : "not-allowed", opacity: serviceDraft.trim() && !sending ? 1 : 0.5, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <SendIcon size={14} />
            </button>
          </div>
          </>);
        })() : selected ? (<>
          {/* Citizen thread */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{selected.petitionnaire}</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                <button
                  onClick={() => onDossierClick({ id: selected.dossier_id, numero: selected.numero, type: selected.type, petitionnaire: selected.petitionnaire, adresse: "—", status: selected.status, echeance: "—" })}
                  style={{ background: "none", border: "none", padding: 0, color: "#4F46E5", fontWeight: 600, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                >
                  {selected.numero}
                </button>
                {" "}– {TYPE_LABEL[selected.type] ?? selected.type}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
            <input
              placeholder="Écrire un message..."
              value={citizenDraft}
              onChange={e => setCitizenDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendCitizenMessage(); } }}
              disabled={sending}
              style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 8, padding: "9px 14px", fontSize: 13, outline: "none" }}
            />
            <button
              onClick={() => void sendCitizenMessage()}
              disabled={!citizenDraft.trim() || sending}
              style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #4F46E5, #6366F1)", border: "none", cursor: citizenDraft.trim() && !sending ? "pointer" : "not-allowed", opacity: citizenDraft.trim() && !sending ? 1 : 0.5, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <SendIcon size={14} />
            </button>
          </div>
        </>) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>Sélectionnez une conversation</div>
        )}
      </div>

      {/* ── Panneau info ── */}
      <div style={{ width: 260, borderLeft: "1px solid #E2E8F0", background: "white", padding: 16, overflowY: "auto" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Informations</div>
        {selectedService ? (() => {
          const svcName = selectedService.service_full_name ?? selectedService.service_name;
          const svcColor = stringToColor(svcName);
          const statusLabel: Record<string, { label: string; bg: string; color: string }> = {
            en_attente: { label: "En attente", bg: "#FEF3C7", color: "#92400E" },
            avis_recu: { label: "Avis reçu", bg: "#DCFCE7", color: "#15803D" },
            non_requis: { label: "Non requis", bg: "#F1F5F9", color: "#64748b" },
            refuse: { label: "Refusé", bg: "#FEE2E2", color: "#B91C1C" },
          };
          const st = statusLabel[selectedService.consultation_status] ?? { label: selectedService.consultation_status, bg: "#EEF2FF", color: "#4F46E5" };
          return (<>
          <div style={{ marginBottom: 4, fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Service consulté</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: svcColor, color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials(svcName)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", lineHeight: 1.3 }}>{svcName}</div>
          </div>
          {selectedService.service_email && (
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{selectedService.service_email}</div>
          )}
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Dossier lié</div>
            <button
              onClick={() => onDossierClick({ id: selectedService.dossier_id, numero: selectedService.numero, type: selectedService.type, petitionnaire: "—", adresse: "—", status: selectedService.status, echeance: "—" })}
              style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4, cursor: "pointer", textDecoration: "underline", display: "block" }}
            >
              {selectedService.numero}
            </button>
            <div style={{ fontSize: 12, color: "#64748b" }}>{TYPE_LABEL[selectedService.type] ?? selectedService.type}</div>
          </div>
          {selectedService.last_content && (
            <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Dernier message</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{selectedService.last_content}</div>
            </div>
          )}
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Statut consultation</div>
            <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 12, background: st.bg, color: st.color, fontSize: 11, fontWeight: 600 }}>{st.label}</span>
          </div>
          </>);
        })() : selected ? (<>
          <div style={{ marginBottom: 4, fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pétitionnaire</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 12 }}>{selected.petitionnaire}</div>
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Dossier</div>
            <button
              onClick={() => onDossierClick({ id: selected.dossier_id, numero: selected.numero, type: selected.type, petitionnaire: selected.petitionnaire, adresse: "—", status: selected.status, echeance: "—" })}
              style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4, cursor: "pointer", textDecoration: "underline", display: "block" }}
            >
              {selected.numero}
            </button>
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

function ParametresScreen({ commune = "", isAdmin = false, canManageUsers = false, communeInseeMap = COMMUNE_INSEE, onInseeUpdated }: { commune?: string; isAdmin?: boolean; canManageUsers?: boolean; communeInseeMap?: Record<string, string>; onInseeUpdated?: () => void }) {
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
    permis_de_construire: "PC", permis_de_construire_mi: "PCMI",
    declaration_prealable: "DP", permis_amenager: "PA",
    permis_demolir: "PD", permis_lotir: "PL",
    certificat_urbanisme: "CU", certificat_urbanisme_a: "CUa", certificat_urbanisme_b: "CUb",
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
    fetch(`/api/mairie/dossiers?commune=${encodeURIComponent(commune)}&limit=500`, { credentials: "include" })
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

// ── Statistiques ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, { full: string; short: string }> = {
  permis_de_construire:    { full: "Permis de construire",      short: "PC" },
  permis_de_construire_mi: { full: "Permis de construire (MI)", short: "PCMI" },
  declaration_prealable:   { full: "Déclaration préalable",     short: "DP" },
  permis_amenager:         { full: "Permis d'aménager",         short: "PA" },
  permis_demolir:          { full: "Permis de démolir",         short: "PD" },
  permis_lotir:            { full: "Permis de lotir",           short: "PL" },
  certificat_urbanisme:    { full: "Certificat d'urbanisme",    short: "CU" },
  certificat_urbanisme_a:  { full: "Certificat d'urbanisme (a)", short: "CUa" },
  certificat_urbanisme_b:  { full: "Certificat d'urbanisme (b)", short: "CUb" },
};
const TYPE_COLORS = ["#4F46E5", "#6366F1", "#818CF8", "#A5B4FC", "#C7D2FE", "#8B5CF6", "#22C55E", "#F97316", "#EC4899"];

const DECISION_META: Record<string, { label: string; color: string }> = {
  accepte:              { label: "Accordé",          color: "#22C55E" },
  refuse:               { label: "Refusé",           color: "#EF4444" },
  accord_prescription:  { label: "Accord avec prescriptions", color: "#F97316" },
};

const MOIS_COURTS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
const formatMoisCourt = (yyyymm: string) => {
  const m = parseInt(yyyymm.slice(5, 7), 10);
  return MOIS_COURTS[m - 1] ?? yyyymm;
};

type StatsKpis = {
  traites: number; acceptes: number; delai_moyen: number | null;
  taux_acceptation: number | null; en_retard: number; en_retard_pct: number | null; total: number;
};
type StatsResponse = {
  kpis: StatsKpis;
  par_mois: { mois: string; count: number }[];
  par_type: { type: string; count: number; acceptes: number; refuses: number; delai_moyen: number | null }[];
  resultats_decisions: { status: string; count: number; pct: number }[];
};
type DelaisResponse = {
  delai_par_type: { type: string; delai_moyen: number | null; delai_legal: number | null }[];
  evolution: { mois: string; delai_moyen: number }[];
  en_retard: {
    id: string; numero: string; type: string; petitionnaire: string | null;
    delai_legal: number | null; delai_ecoule: number | null; depassement: number | null; status: string;
  }[];
};
type ServicesResponse = {
  name: string; consultations: number; retours: number; en_attente: number;
  delai_retour_moy: number | null; taux_reponse: number;
}[];

function StatistiquesScreen({ commune }: { commune: string }) {
  const [stab, setStab] = useState("Vue générale");
  const tabs = ["Vue générale", "Délais", "Types de dossiers", "Services"];

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [delais, setDelais] = useState<DelaisResponse | null>(null);
  const [services, setServices] = useState<ServicesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = commune ? `?commune=${encodeURIComponent(commune)}` : "";
    Promise.all([
      api.get<StatsResponse>(`/mairie/stats${q}`).then(setStats).catch(() => setStats(null)),
      api.get<DelaisResponse>(`/mairie/stats/delais${q}`).then(setDelais).catch(() => setDelais(null)),
      api.get<ServicesResponse>(`/mairie/stats/services${q}`).then(setServices).catch(() => setServices(null)),
    ]).finally(() => setLoading(false));
  }, [commune]);

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

  const k = stats?.kpis;
  const kpis = [
    { label: "Dossiers traités", value: k ? String(k.traites) : "–", sub: k ? `${k.total} dossiers au total` : "", color: "#4F46E5", bg: "#EEF2FF", icon: "📁" },
    { label: "Délai moyen", value: k?.delai_moyen != null ? `${k.delai_moyen}j` : "–", sub: "Sur les dossiers délivrés", color: "#22C55E", bg: "#F0FDF4", icon: "⏱" },
    { label: "Taux d'acceptation", value: k?.taux_acceptation != null ? `${k.taux_acceptation}%` : "–", sub: k && k.traites > 0 ? `${k.acceptes} acceptés / ${k.traites}` : "", color: "#F97316", bg: "#FFF7ED", icon: "✅" },
    { label: "Dossiers en retard", value: k ? String(k.en_retard) : "–", sub: k?.en_retard_pct != null ? `${k.en_retard_pct}% du total` : "", color: "#EF4444", bg: "#FEF2F2", icon: "⚠️" },
  ];

  const monthlyData = (stats?.par_mois ?? []).map((m) => ({ label: formatMoisCourt(m.mois), value: m.count, color: "#4F46E5" }));
  const annee = stats?.par_mois?.[stats.par_mois.length - 1]?.mois?.slice(0, 4) ?? "";
  const totalAnnee = monthlyData.reduce((s, m) => s + m.value, 0);

  const typeData = (stats?.par_type ?? []).map((t, i) => ({
    label: TYPE_LABELS[t.type]?.short ?? t.type,
    value: t.count,
    color: TYPE_COLORS[i % TYPE_COLORS.length] ?? "#4F46E5",
  }));
  const totalTypes = typeData.reduce((s, t) => s + t.value, 0) || 1;

  const EVO_PALETTE = ["#C7D2FE", "#A5B4FC", "#818CF8", "#6366F1", "#4F46E5", "#4338CA"];
  const evolutionData = (delais?.evolution ?? []).slice(-6).map((e, i) => ({
    label: formatMoisCourt(e.mois),
    value: e.delai_moyen,
    color: EVO_PALETTE[i] ?? "#4F46E5",
  }));
  const evoFirst = evolutionData[0]?.value ?? 0;
  const evoLast = evolutionData[evolutionData.length - 1]?.value ?? 0;
  const evoDeltaPct = evoFirst > 0 ? Math.round(((evoLast - evoFirst) / evoFirst) * 100) : 0;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Statistiques — {commune}</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Analysez l'activité et les performances de traitement des dossiers.</p>
      </div>

      {loading && !stats ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontSize: 13 }}>Chargement…</div>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
            {kpis.map(kp => (
              <div key={kp.label} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: kp.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{kp.icon}</div>
                </div>
                <div style={{ fontSize: 26, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>{kp.value}</div>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>{kp.label}</div>
                <div style={{ fontSize: 11, color: kp.color, fontWeight: 600 }}>{kp.sub}</div>
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
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Dossiers déposés par mois{annee ? ` — ${annee}` : ""}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>{totalAnnee} dossier{totalAnnee > 1 ? "s" : ""} sur les 12 derniers mois</div>
                {monthlyData.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 12 }}>Aucun dossier déposé sur la période</div>
                ) : (
                  <BarChart data={monthlyData} />
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Répartition par type</div>
                  {(stats?.par_type ?? []).length === 0 ? (
                    <div style={{ textAlign: "center", padding: 20, color: "#94a3b8", fontSize: 12 }}>Aucun dossier</div>
                  ) : (
                    (stats?.par_type ?? []).map((t, i) => (
                      <div key={t.type} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: "#374151" }}>{TYPE_LABELS[t.type]?.full ?? t.type}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{t.count}</span>
                        </div>
                        <div style={{ height: 6, background: "#F1F5F9", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(t.count / totalTypes) * 100}%`, background: TYPE_COLORS[i % TYPE_COLORS.length], borderRadius: 3 }} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Résultats des décisions</div>
                  {(stats?.resultats_decisions ?? []).length === 0 ? (
                    <div style={{ textAlign: "center", padding: 20, color: "#94a3b8", fontSize: 12 }}>Aucune décision</div>
                  ) : (
                    (stats?.resultats_decisions ?? []).map((r) => {
                      const meta = DECISION_META[r.status] ?? { label: r.status, color: "#94a3b8" };
                      return (
                        <div key={r.status} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0, display: "inline-block" }} />
                          <span style={{ fontSize: 12, color: "#374151", flex: 1 }}>{meta.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{r.count}</span>
                          <span style={{ fontSize: 11, color: "#94a3b8", width: 32, textAlign: "right" }}>{r.pct}%</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {stab === "Délais" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Délais moyens par type</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Comparaison avec les délais légaux</div>
                {(delais?.delai_par_type ?? []).filter((d) => d.delai_moyen != null && d.delai_legal != null).length === 0 ? (
                  <div style={{ textAlign: "center", padding: 20, color: "#94a3b8", fontSize: 12 }}>Aucun dossier délivré sur la période</div>
                ) : (
                  (delais?.delai_par_type ?? []).map((d) => {
                    if (d.delai_moyen == null || d.delai_legal == null) return null;
                    const ratio = d.delai_moyen / d.delai_legal;
                    const color = ratio > 1 ? "#EF4444" : ratio > 0.8 ? "#F97316" : "#22C55E";
                    return (
                      <div key={d.type} style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: "#374151" }}>{TYPE_LABELS[d.type]?.full ?? d.type}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color }}>{d.delai_moyen}j <span style={{ color: "#94a3b8", fontWeight: 400 }}>/ {d.delai_legal}j légal</span></span>
                        </div>
                        <div style={{ height: 8, background: "#F1F5F9", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.min(100, ratio * 100)}%`, background: color, borderRadius: 4 }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Évolution du délai moyen</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>6 derniers mois (jours)</div>
                {evolutionData.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 12 }}>Pas assez de données</div>
                ) : (
                  <>
                    <BarChart data={evolutionData} />
                    {evoFirst > 0 && (
                      <div style={{ marginTop: 16, padding: 12, background: evoDeltaPct <= 0 ? "#F0FDF4" : "#FEF2F2", borderRadius: 8, fontSize: 12, color: evoDeltaPct <= 0 ? "#15803D" : "#B91C1C", fontWeight: 500 }}>
                        {evoDeltaPct <= 0 ? "↓ Amélioration" : "↑ Dégradation"} de {Math.abs(evoDeltaPct)}% sur 6 mois
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20, gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Dossiers dépassant les délais légaux</div>
                {(delais?.en_retard ?? []).length === 0 ? (
                  <div style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 13 }}>Aucun dossier en retard</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#F8FAFC" }}>
                        {["N° Dossier","Type","Pétitionnaire","Délai légal","Délai écoulé","Dépassement","Statut"].map(h => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(delais?.en_retard ?? []).map((r) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                          <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#4F46E5" }}>{r.numero}</td>
                          <td style={{ padding: "10px 12px", fontSize: 12, color: "#374151" }}>{TYPE_LABELS[r.type]?.short ?? r.type}</td>
                          <td style={{ padding: "10px 12px", fontSize: 12, color: "#374151" }}>{r.petitionnaire ?? "—"}</td>
                          <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>{r.delai_legal != null ? `${r.delai_legal}j` : "—"}</td>
                          <td style={{ padding: "10px 12px", fontSize: 12, color: "#374151" }}>{r.delai_ecoule != null ? `${r.delai_ecoule}j` : "—"}</td>
                          <td style={{ padding: "10px 12px" }}>
                            {r.depassement != null && r.depassement > 0
                              ? <span style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 8px" }}>+{r.depassement}j</span>
                              : <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}
                          </td>
                          <td style={{ padding: "10px 12px" }}><StatusBadge status="En retard" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {stab === "Types de dossiers" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 16 }}>Volume par type de dossier</div>
                {typeData.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 12 }}>Aucun dossier</div>
                ) : (
                  <BarChart data={typeData} />
                )}
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
                    {(stats?.par_type ?? []).map((r) => (
                      <tr key={r.type} style={{ borderBottom: "1px solid #F8FAFC" }}>
                        <td style={{ padding: "8px", fontSize: 12, color: "#374151" }}>{TYPE_LABELS[r.type]?.full ?? r.type}</td>
                        <td style={{ padding: "8px", fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{r.count}</td>
                        <td style={{ padding: "8px", fontSize: 12, color: "#22C55E", fontWeight: 600 }}>{r.acceptes}</td>
                        <td style={{ padding: "8px", fontSize: 12, color: "#EF4444", fontWeight: 600 }}>{r.refuses}</td>
                        <td style={{ padding: "8px", fontSize: 12, color: "#64748b" }}>{r.delai_moyen != null ? `${r.delai_moyen}j` : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {stab === "Services" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Consultations par service</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Nombre de consultations envoyées et délais de retour moyens</div>
              {(services ?? []).length === 0 ? (
                <div style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 13 }}>Aucune consultation</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC" }}>
                      {["Service","Consultations","Retours reçus","En attente","Délai retour moy.","Taux de réponse"].map(h => (
                        <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(services ?? []).map((r) => (
                      <tr key={r.name} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 500, color: "#374151" }}>{r.name}</td>
                        <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{r.consultations}</td>
                        <td style={{ padding: "10px 12px", fontSize: 12, color: "#22C55E", fontWeight: 600 }}>{r.retours}</td>
                        <td style={{ padding: "10px 12px", fontSize: 12, color: r.en_attente > 0 ? "#F97316" : "#22C55E", fontWeight: 600 }}>{r.en_attente}</td>
                        <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>{r.delai_retour_moy != null ? `${r.delai_retour_moy}j` : "–"}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: "#F1F5F9", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${r.taux_reponse}%`, background: r.taux_reponse >= 90 ? "#22C55E" : r.taux_reponse >= 80 ? "#F97316" : "#EF4444", borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", width: 32 }}>{r.taux_reponse}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Référentiel documentaire ───────────────────────────────────────────────────

const DOC_TYPES: { value: string; label: string; color: string }[] = [
  { value: "plu",   label: "PLU",   color: "#1E40AF" },
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
  file_size: number | null; synthese: string | null; status: string; created_at: string;
  validation_status?: "valide" | "brouillon" | "rejete";
  validated_at?: string | null;
};

type Annotation = {
  id: string;
  segment_id: string;
  kind: "correction" | "precision" | "jurisprudence" | "warning";
  note: string;
  validation_status: "brouillon" | "valide" | "rejete";
  validated_at: string | null;
};

type Segment = {
  id: string;
  segment_code: string;
  raw_text: string;
  metadata: { page?: number; char_count?: number; [k: string]: unknown };
  char_count: number | null;
  annotations: Annotation[];
};

const KIND_META: Record<Annotation["kind"], { label: string; color: string; bg: string }> = {
  correction:    { label: "Correction",    color: "#B91C1C", bg: "#FEE2E2" },
  precision:     { label: "Précision",     color: "#1E40AF", bg: "#DBEAFE" },
  jurisprudence: { label: "Jurisprudence", color: "#9A3412", bg: "#FED7AA" },
  warning:       { label: "Attention",     color: "#92400E", bg: "#FEF3C7" },
};

function SegmentsModal({ docId, docName, onClose }: { docId: string; docName: string; onClose: () => void }) {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ segmentId: string; annotationId?: string } | null>(null);
  const [draft, setDraft] = useState<{ kind: Annotation["kind"]; note: string }>({ kind: "precision", note: "" });
  const [saving, setSaving] = useState(false);

  const reload = () => {
    api.get<Segment[]>(`/mairie/documents/${docId}/segments`)
      .then(setSegments)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur de chargement"));
  };
  useEffect(reload, [docId]);

  const startCreate = (segmentId: string) => { setEditing({ segmentId }); setDraft({ kind: "precision", note: "" }); };
  const startEdit = (segmentId: string, a: Annotation) => { setEditing({ segmentId, annotationId: a.id }); setDraft({ kind: a.kind, note: a.note }); };
  const cancel = () => setEditing(null);

  const save = async () => {
    if (!editing || !draft.note.trim()) return;
    setSaving(true);
    try {
      if (editing.annotationId) {
        await api.patch(`/mairie/annotations/${editing.annotationId}`, { kind: draft.kind, note: draft.note });
      } else {
        await api.post(`/mairie/segments/${editing.segmentId}/annotations`, { kind: draft.kind, note: draft.note });
      }
      setEditing(null);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l'enregistrement");
    } finally { setSaving(false); }
  };

  const setStatus = async (annotationId: string, status: "valide" | "brouillon" | "rejete") => {
    try {
      await api.patch(`/mairie/annotations/${annotationId}`, { validation_status: status });
      reload();
    } catch (e) { alert(e instanceof Error ? e.message : "Échec"); }
  };

  const remove = async (annotationId: string) => {
    if (!confirm("Supprimer cette annotation ?")) return;
    try { await api.delete(`/mairie/annotations/${annotationId}`); reload(); }
    catch (e) { alert(e instanceof Error ? e.message : "Échec"); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 14, maxWidth: 900, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>Passages indexés — {docName}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Annotez un passage pour préciser la jurisprudence locale ou corriger une erreur d'édition.</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {error && <div style={{ color: "#DC2626", padding: 16 }}>{error}</div>}
          {!segments && !error && <div style={{ textAlign: "center", color: "#94a3b8", padding: 40 }}>Chargement…</div>}
          {segments && segments.length === 0 && (
            <div style={{ textAlign: "center", color: "#94a3b8", padding: 40 }}>Aucun passage indexé. L'indexation a peut-être échoué.</div>
          )}
          {segments && segments.map((s) => {
            const page = s.metadata?.page;
            const isEditingThis = editing?.segmentId === s.id;
            return (
              <div key={s.id} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.05em" }}>
                    {s.segment_code}{page != null ? ` · Page ${page}` : ""}
                  </div>
                  {!isEditingThis && (
                    <button onClick={() => startCreate(s.id)} style={{ border: "1px solid #C7D2FE", background: "white", color: "#4F46E5", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Annoter</button>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.55, whiteSpace: "pre-wrap" as const }}>{s.raw_text}</div>

                {s.annotations.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    {s.annotations.map((a) => {
                      const meta = KIND_META[a.kind];
                      const isEditingThisAnn = isEditingThis && editing?.annotationId === a.id;
                      const validated = a.validation_status === "valide";
                      const rejected = a.validation_status === "rejete";
                      return (
                        <div key={a.id} style={{ background: "white", border: `1px solid ${validated ? "#A7F3D0" : rejected ? "#FECACA" : "#FDE68A"}`, borderRadius: 8, padding: 10 }}>
                          {isEditingThisAnn ? (
                            <div>
                              <select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as Annotation["kind"] }))} style={{ border: "1px solid #CBD5E1", borderRadius: 5, padding: "4px 8px", fontSize: 12, marginBottom: 6 }}>
                                {Object.entries(KIND_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                              </select>
                              <textarea value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} rows={3} style={{ width: "100%", border: "1px solid #CBD5E1", borderRadius: 5, padding: 8, fontSize: 12.5, fontFamily: "inherit", boxSizing: "border-box" }} />
                              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                                <button onClick={cancel} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 5, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>Annuler</button>
                                <button onClick={() => void save()} disabled={saving || !draft.note.trim()} style={{ border: "none", background: saving ? "#A5B4FC" : "#4F46E5", color: "white", borderRadius: 5, padding: "4px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{saving ? "…" : "Enregistrer"}</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.04em" }}>{meta.label.toUpperCase()}</span>
                                <span style={{ fontSize: 10, fontWeight: 700, color: validated ? "#047857" : rejected ? "#B91C1C" : "#B45309" }}>
                                  {validated ? `✓ Validé${a.validated_at ? ` ${new Date(a.validated_at).toLocaleDateString("fr-FR")}` : ""}` : rejected ? "✗ Rejeté" : "Brouillon"}
                                </span>
                                <div style={{ flex: 1 }} />
                                <button onClick={() => startEdit(s.id, a)} style={{ border: "none", background: "none", color: "#4F46E5", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Modifier</button>
                                <button onClick={() => void remove(a.id)} style={{ border: "none", background: "none", color: "#94a3b8", fontSize: 11, cursor: "pointer" }}>Supprimer</button>
                              </div>
                              <div style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.5, whiteSpace: "pre-wrap" as const }}>{a.note}</div>
                              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                {!validated && <button onClick={() => void setStatus(a.id, "valide")} style={{ border: "none", background: "#047857", color: "white", borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Valider</button>}
                                {!rejected && <button onClick={() => void setStatus(a.id, "rejete")} style={{ border: "1px solid #FECACA", background: "white", color: "#B91C1C", borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Rejeter</button>}
                                {(validated || rejected) && <button onClick={() => void setStatus(a.id, "brouillon")} style={{ border: "1px solid #E2E8F0", background: "white", color: "#475569", borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Repasser en brouillon</button>}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {isEditingThis && !editing?.annotationId && (
                  <div style={{ marginTop: 10, background: "white", border: "1px dashed #C7D2FE", borderRadius: 8, padding: 10 }}>
                    <select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as Annotation["kind"] }))} style={{ border: "1px solid #CBD5E1", borderRadius: 5, padding: "4px 8px", fontSize: 12, marginBottom: 6 }}>
                      {Object.entries(KIND_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                    </select>
                    <textarea value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} rows={3} placeholder="Ex: La cote NGF de référence est celle de 1997, pas celle reprise par erreur dans cette édition." style={{ width: "100%", border: "1px solid #CBD5E1", borderRadius: 5, padding: 8, fontSize: 12.5, fontFamily: "inherit", boxSizing: "border-box" }} />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                      <button onClick={cancel} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 5, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>Annuler</button>
                      <button onClick={() => void save()} disabled={saving || !draft.note.trim()} style={{ border: "none", background: saving ? "#A5B4FC" : "#4F46E5", color: "white", borderRadius: 5, padding: "4px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{saving ? "…" : "Créer en brouillon"}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DocumentsPanel({ commune }: { commune: string }) {
  const [docs, setDocs] = useState<CommuneDoc[]>([]);
  const [viewingSegments, setViewingSegments] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ type: "ppri", name: "", synthese: "", file: null as File | null });
  const [dragOver, setDragOver] = useState(false);
  const [editingSynthese, setEditingSynthese] = useState<string | null>(null);
  const [syntheseDraft, setSyntheseDraft] = useState("");
  const [savingSynthese, setSavingSynthese] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
    setUploadError(null);
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
        synthese: form.synthese.trim() || undefined,
      });
      setShowForm(false);
      setForm({ type: "ppri", name: "", synthese: "", file: null });
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur d'enregistrement";
      setUploadError(/payload|too large|413/i.test(msg)
        ? "Fichier trop volumineux pour être enregistré. La limite est de 60 Mo."
        : msg);
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
            PLU, PPRI, OAP, PEB, PLH, ZAC et autres plans réglementaires de {commune}
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

          {/* Synthèse */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
              Synthèse <span style={{ color: "#94a3b8", fontWeight: 400 }}>— sur quoi l'outil doit s'appuyer pour instruire</span>
            </label>
            <textarea
              value={form.synthese}
              onChange={(e) => setForm((f) => ({ ...f, synthese: e.target.value }))}
              rows={4}
              placeholder="Résumé en quelques phrases : règles à appliquer, périmètre concerné, articles clés, points de vigilance pour l'instructeur…"
              style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", lineHeight: 1.5, resize: "vertical" }}
            />
          </div>

          {uploadError && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>
              {uploadError}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { setShowForm(false); setForm({ type: "ppri", name: "", synthese: "", file: null }); setUploadError(null); }}
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
                {group.items.map(doc => {
                  const isEditing = editingSynthese === doc.id;
                  // Toute édition de synthèse rebascule le statut en "brouillon" côté
                  // serveur — la synthèse n'alimente plus l'instruction tant que
                  // l'instructeur n'a pas explicitement re-validé.
                  const saveSynthese = async () => {
                    setSavingSynthese(true);
                    try {
                      const updated = await api.patch<CommuneDoc>(`/mairie/documents/${doc.id}`, { synthese: syntheseDraft });
                      setDocs((arr) => arr.map((d) => d.id === doc.id ? { ...d, ...updated } : d));
                      setEditingSynthese(null);
                    } catch { /* ignore */ } finally { setSavingSynthese(false); }
                  };
                  const setStatus = async (next: "valide" | "rejete" | "brouillon") => {
                    try {
                      const updated = await api.patch<CommuneDoc>(`/mairie/documents/${doc.id}`, { validation_status: next });
                      setDocs((arr) => arr.map((d) => d.id === doc.id ? { ...d, ...updated } : d));
                    } catch { /* ignore */ }
                  };
                  const vStatus = doc.validation_status ?? "brouillon";
                  const vBadge =
                    vStatus === "valide" ? { label: "Validé", color: "#047857", bg: "#D1FAE5" } :
                    vStatus === "rejete" ? { label: "Rejeté", color: "#B91C1C", bg: "#FEE2E2" } :
                    { label: "Brouillon", color: "#B45309", bg: "#FEF3C7" };
                  return (
                    <div key={doc.id} style={{
                      background: "white", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 20 }}>📄</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                            {doc.original_filename}
                            {doc.file_size && <span style={{ marginLeft: 8 }}>{fmt(doc.file_size)}</span>}
                            <span style={{ marginLeft: 8 }}>· {new Date(doc.created_at).toLocaleDateString("fr-FR")}</span>
                          </div>
                        </div>
                        {doc.synthese && (
                          <span title={vStatus === "valide" && doc.validated_at ? `Validée le ${new Date(doc.validated_at).toLocaleDateString("fr-FR")}` : "La synthèse ne sera utilisée par l'instructeur qu'une fois validée"} style={{
                            fontSize: 11, fontWeight: 700,
                            color: vBadge.color, background: vBadge.bg,
                            borderRadius: 6, padding: "2px 8px",
                          }}>
                            {vBadge.label}
                          </span>
                        )}
                        {(() => {
                          const indexBadge =
                            doc.status === "indexed" ? { label: "Indexé", color: "#0E7490", bg: "#CFFAFE" } :
                            doc.status === "indexing" ? { label: "Indexation…", color: "#5B21B6", bg: "#EDE9FE" } :
                            doc.status === "indexing_error" ? { label: "Erreur indexation", color: "#B91C1C", bg: "#FEE2E2" } :
                            doc.status === "indexing_empty" ? { label: "Index vide", color: "#92400E", bg: "#FEF3C7" } :
                            doc.status === "ingested" ? { label: "Ingéré", color: "#10B981", bg: "#D1FAE5" } :
                            { label: "Importé", color: "#94a3b8", bg: "#F1F5F9" };
                          return (
                            <span style={{ fontSize: 11, fontWeight: 600, color: indexBadge.color, background: indexBadge.bg, borderRadius: 6, padding: "2px 8px" }}>
                              {indexBadge.label}
                            </span>
                          );
                        })()}
                        {doc.status === "indexed" && (
                          <button onClick={() => setViewingSegments({ id: doc.id, name: doc.name })}
                            title="Voir les passages indexés et les annoter"
                            style={{ border: "1px solid #C7D2FE", background: "white", color: "#4F46E5", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                            📑 Passages
                          </button>
                        )}
                        <button onClick={() => deleteDoc(doc.id)}
                          style={{ border: "none", background: "none", color: "#94a3b8", cursor: "pointer", padding: 4, fontSize: 16, lineHeight: 1 }}
                          title="Supprimer">✕</button>
                      </div>

                      {/* Synthèse — affichage / édition */}
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #E2E8F0" }}>
                        {isEditing ? (
                          <div>
                            <textarea
                              value={syntheseDraft}
                              onChange={(e) => setSyntheseDraft(e.target.value)}
                              rows={4}
                              placeholder="Résumé en quelques phrases : règles à appliquer, périmètre concerné, articles clés…"
                              style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 6, padding: "8px 10px", fontSize: 12.5, fontFamily: "inherit", boxSizing: "border-box", lineHeight: 1.5, resize: "vertical" }}
                            />
                            <div style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>
                              ⓘ La synthèse repassera en brouillon après enregistrement — elle ne sera plus utilisée par l'instructeur tant que vous ne l'aurez pas re-validée.
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                              <button onClick={() => setEditingSynthese(null)}
                                style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: "#374151" }}>
                                Annuler
                              </button>
                              <button onClick={() => void saveSynthese()} disabled={savingSynthese}
                                style={{ border: "none", background: savingSynthese ? "#A5B4FC" : "#4F46E5", color: "white", borderRadius: 6, padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                {savingSynthese ? "Enregistrement…" : "Enregistrer la synthèse"}
                              </button>
                            </div>
                          </div>
                        ) : doc.synthese ? (
                          <div>
                            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#4F46E5", letterSpacing: "0.06em", marginTop: 2 }}>SYNTHÈSE</span>
                              <div style={{ flex: 1, fontSize: 12.5, color: "#374151", lineHeight: 1.55, whiteSpace: "pre-wrap" as const }}>{doc.synthese}</div>
                              <button onClick={() => { setEditingSynthese(doc.id); setSyntheseDraft(doc.synthese ?? ""); }}
                                style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", color: "#4F46E5", fontWeight: 600, flexShrink: 0 }}>
                                Modifier
                              </button>
                            </div>
                            {/* Bandeau de validation : seule la synthèse "valide" est consommée par le moteur d'instruction. */}
                            {vStatus !== "valide" ? (
                              <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: vStatus === "rejete" ? "#FEF2F2" : "#FFFBEB", border: `1px solid ${vStatus === "rejete" ? "#FECACA" : "#FDE68A"}`, borderRadius: 6, padding: "6px 10px" }}>
                                <div style={{ fontSize: 11.5, color: vStatus === "rejete" ? "#991B1B" : "#92400E" }}>
                                  {vStatus === "rejete"
                                    ? "Synthèse rejetée — non utilisée pour l'instruction."
                                    : "Synthèse en brouillon — non utilisée pour l'instruction tant qu'elle n'est pas validée."}
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  {vStatus !== "rejete" && (
                                    <button onClick={() => void setStatus("rejete")}
                                      style={{ border: "1px solid #FECACA", background: "white", color: "#B91C1C", borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                      Rejeter
                                    </button>
                                  )}
                                  <button onClick={() => void setStatus("valide")}
                                    style={{ border: "none", background: "#047857", color: "white", borderRadius: 5, padding: "3px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                    Valider
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 6, padding: "6px 10px" }}>
                                <div style={{ fontSize: 11.5, color: "#065F46" }}>
                                  ✓ Synthèse validée{doc.validated_at ? ` le ${new Date(doc.validated_at).toLocaleDateString("fr-FR")}` : ""} — utilisée par le moteur d'instruction.
                                </div>
                                <button onClick={() => void setStatus("brouillon")}
                                  style={{ border: "1px solid #A7F3D0", background: "white", color: "#047857", borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                  Repasser en brouillon
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <button onClick={() => { setEditingSynthese(doc.id); setSyntheseDraft(""); }}
                            style={{ border: "1px dashed #C7D2FE", background: "#F8FAFC", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#4F46E5", fontWeight: 600, width: "100%", textAlign: "left" as const }}>
                            + Ajouter une synthèse pour l'instruction
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {viewingSegments && (
        <SegmentsModal docId={viewingSegments.id} docName={viewingSegments.name} onClose={() => setViewingSegments(null)} />
      )}
    </div>
  );
}

// ── PLU upload panel (état vide Réglementation) ────────────────────────────────

type ZoneProgress = { code: string; label: string; type: string; status: "pending" | "done"; rules?: number; vision?: number; batch?: number; total_batches?: number };

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

    // Nouveau flux en 3 phases (start → batches → commit). Évite la dépendance
    // à une seule connexion HTTP longue (le proxy Railway/Cloudflare la coupait
    // au bout de quelques minutes → Safari "Load failed"). Chaque requête tient
    // dans le budget proxy ; le client orchestre la parallélisation.
    type ZoneSpec = {
      code: string; label: string; type: string;
      startPage: number; endPage: number;
      batches: Array<{ index: number; firstPage: number; lastPage: number }>;
    };
    type BatchResult = { rules: unknown[]; visionCount: number };

    const postJSON = async <T,>(path: string, body: unknown): Promise<T> => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const txt = await r.text();
      let parsed: unknown = null;
      try { parsed = txt ? JSON.parse(txt) : null; } catch { /* keep raw */ }
      if (!r.ok) {
        const msg = (parsed as { error?: string } | null)?.error ?? txt ?? `HTTP ${r.status}`;
        const err = new Error(msg) as Error & { status?: number; transient?: boolean };
        err.status = r.status;
        // 502/503/504 (Bad Gateway / unavailable / Gateway timeout) sont des
        // erreurs proxy/nginx transitoires : on relancera le batch.
        err.transient = (parsed as { transient?: boolean } | null)?.transient === true
          || r.status === 502 || r.status === 503 || r.status === 504;
        throw err;
      }
      return parsed as T;
    };

    try {
      // Phase 1 — start : extraction du sommaire (1 appel Pixtral, < 30 s).
      setPhase("Lecture du sommaire…");
      const startResp = await postJSON<{ jobId: string; zones: ZoneSpec[] }>(
        "/api/mairie/admin/ingest-plu-pdf/start",
        { commune_name: communeInput.trim(), insee_code: inseeInput.trim(), pdf_base64 },
      );
      const { jobId, zones: zoneSpecs } = startResp;
      setZoneProgress(zoneSpecs.map((z) => ({ code: z.code, label: z.label, type: z.type, status: "pending" })));
      const totalBatchesByZone = new Map(zoneSpecs.map((z) => [z.code, z.batches.length]));
      setPhase(`Sommaire : ${zoneSpecs.length} zones (${zoneSpecs.map((z) => z.code).join(", ")}). Extraction…`);

      // Phase 2 — batches : on aplatit tous les lots en une seule queue et on
      // les exécute avec une concurrence bornée (4 lots en vol). Chaque lot est
      // une requête HTTP courte → aucun risque de timeout proxy. Au passage on
      // met à jour la progression intra-zone (lot X/N).
      type FlatBatch = { zoneCode: string; batchIndex: number };
      const queue: FlatBatch[] = [];
      for (const z of zoneSpecs) for (const b of z.batches) queue.push({ zoneCode: z.code, batchIndex: b.index });
      const zoneAcc = new Map<string, { rules: unknown[]; visionCount: number; doneBatches: number }>();
      for (const z of zoneSpecs) zoneAcc.set(z.code, { rules: [], visionCount: 0, doneBatches: 0 });

      const CONCURRENCY = 4;
      let next = 0;
      let firstError: Error | null = null;

      const worker = async () => {
        while (true) {
          const i = next++;
          if (i >= queue.length) return;
          if (firstError) return;
          const item = queue[i]!;
          // Retry transitoire jusqu'à 3 tentatives sur 502/503/504 + rate
          // limit Mistral, avec backoff exponentiel (1,5 s → 3 s → 6 s).
          // Les batches sont idempotents côté serveur (pas d'état partiel).
          let attempt = 0;
          while (true) {
            try {
              const r = await postJSON<BatchResult>(
                "/api/mairie/admin/ingest-plu-pdf/batch",
                { jobId, zoneCode: item.zoneCode, batchIndex: item.batchIndex },
              );
              const acc = zoneAcc.get(item.zoneCode)!;
              acc.rules.push(...r.rules);
              acc.visionCount += r.visionCount;
              acc.doneBatches += 1;
              const total = totalBatchesByZone.get(item.zoneCode) ?? 0;
              const isZoneDone = acc.doneBatches >= total;
              setZoneProgress((prev) => prev.map((z) =>
                z.code === item.zoneCode
                  ? (isZoneDone
                      ? { ...z, status: "done" as const, rules: acc.rules.length, vision: acc.visionCount, batch: undefined, total_batches: undefined }
                      : { ...z, batch: acc.doneBatches, total_batches: total })
                  : z,
              ));
              break;
            } catch (e) {
              const err = e as Error & { transient?: boolean };
              if (err.transient && attempt < 3) {
                await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
                attempt++;
                continue;
              }
              firstError = err;
              return;
            }
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (firstError) throw firstError;

      // Phase 3 — commit : transaction DB en 1 requête courte.
      setPhase("Enregistrement…");
      const zoneResults = zoneSpecs.map((z) => ({
        zoneCode: z.code,
        rules: zoneAcc.get(z.code)!.rules,
        visionCount: zoneAcc.get(z.code)!.visionCount,
      }));
      const final = await postJSON<{ zones: number; rules: number; needs_review: number }>(
        "/api/mairie/admin/ingest-plu-pdf/commit",
        { jobId, zoneResults },
      );
      setDone({ zones: final.zones, rules: final.rules, needs_review: final.needs_review });
      setPhase(null);
      setTimeout(onSuccess, 1500);
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
                        <>
                          {z.batch && z.total_batches ? (
                            <span style={{ fontSize: 11, color: "#64748b" }}>lot {z.batch}/{z.total_batches}</span>
                          ) : null}
                          <div style={{ width: 12, height: 12, border: "2px solid #C7D2FE", borderTopColor: "#4F46E5", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                        </>
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

type RuleCase = { condition: string; value: number | null; unit: string | null; kind?: "condition" | "parametre" };
type RuleRow = {
  id: string; zone_id: string; article_number: number | null; article_title: string | null;
  topic: string; rule_text: string; value_min: number | null; value_max: number | null;
  value_exact: number | null; unit: string | null; conditions: string | null; exceptions?: string | null; summary: string | null;
  instructor_note: string | null; validation_status: string; cases?: RuleCase[] | null;
  applies_if?: string[] | null; sub_theme?: string | null;
  citizen_title?: string | null; citizen_summary?: string | null; citizen_relevant?: boolean | null;
};
// Sous-règle extraite par l'agent (avant enregistrement).
type ExtractedRule = {
  sub_theme: string | null; article_number: number | null; article_title: string;
  topic: string; rule_text: string; value_min: number | null; value_max: number | null;
  value_exact: number | null; unit: string | null; conditions: string | null; exceptions: string | null; summary: string;
  cases: RuleCase[]; applies_if: string[];
  citizen_title?: string | null; citizen_summary?: string | null; citizen_relevant?: boolean;
};
// Libellés lisibles des tags d'applicabilité.
const APPLIES_LABEL: Record<string, string> = {
  protege_l151_19: "Élément protégé L.151-19", unesco: "Périmètre UNESCO", abf: "Périmètre ABF",
  inondable: "Zone inondable", extension: "Extension", surelevation: "Surélévation",
  ravalement: "Ravalement", demolition: "Démolition", cloture_sur_rue: "Clôture sur rue",
  cloture_limite: "Clôture en limite", annexe: "Annexe", devanture_commerciale: "Devanture commerciale",
  equipement_public: "Équipement public",
};

// Renvois internes : repère les références à d'autres articles de la zone
// (« UA-2 », « article 7 », « art. 10 ») présentes dans le texte d'une règle.
function extractArticleRefs(rule: RuleRow, zoneArticles: Set<number>): number[] {
  const text = `${rule.rule_text} ${rule.conditions ?? ""} ${rule.exceptions ?? ""}`;
  const found = new Set<number>();
  for (const m of text.matchAll(/\b[0-9]?[A-Z]{1,3}[a-z0-9]*-(\d{1,2})(?:\.\d+)?\b/g)) {
    const n = Number(m[1]); if (zoneArticles.has(n) && n !== rule.article_number) found.add(n);
  }
  for (const m of text.matchAll(/\bart(?:icle)?\.?\s+(\d{1,2})\b/gi)) {
    const n = Number(m[1]); if (zoneArticles.has(n) && n !== rule.article_number) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}
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

// Découpe le règlement collé en blocs analysables par l'IA.
// Objectif : aucun bloc > MAX_CHARS (sinon l'appel Claude dépasse 120 s).
//
// Étape 1 — coupe sur les en-têtes d'article (« Article 7 », « Préambule »,
// « ARTICLE U.A.1 », « **Article 11 -** »). Insensible à la casse, tolère
// préfixes markdown, démarre en début de ligne OU en début de texte.
//
// Étape 2 — si un bloc reste trop long (PDF copié sans newlines, format
// inattendu), on le sous-découpe par paragraphes (`\n\n`) en agrégant
// jusqu'à MAX_CHARS. En tout dernier recours, coupe brute par taille pour
// garantir qu'aucun bloc ne dépasse la limite.
// 8000 chars = ~2000 tokens en entrée + une marge pour l'output structuré.
// Un Article 11 (aspect extérieur) bien fourni fait 6-7k chars : on le garde
// entier. Au-delà on sous-découpe par paragraphes pour rester < 60 s par appel.
const MAX_CHARS_PER_CHUNK = 8000;

export function splitZoneIntoChunks(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];

  // Étape 1 : coupe par article (regex permissive)
  // - début de ligne (\n) OU début du texte (^)
  // - préfixes markdown optionnels (** ## ·)
  // - "Article" / "ARTICLE" / "Préambule" / "PRÉAMBULE"
  // - séparateur libre puis chiffre/lettre dans la même ligne (≤120 chars)
  const HEADER = /(?:^|\n)(?:[*#·•\-—–]+\s*)?(?:article|préambule|preambule)\b[^\n]{0,120}/gi;
  const headerMatches: number[] = [];
  for (const m of text.matchAll(HEADER)) {
    // L'index de la regex est celui du `\n` ou du début du texte ; on coupe
    // après ce `\n` (ou à 0 si début de texte) pour démarrer l'en-tête au
    // début du chunk.
    const at = m.index ?? 0;
    headerMatches.push(text[at] === "\n" ? at + 1 : at);
  }

  let chunks: string[] = [];
  if (headerMatches.length > 0) {
    // Insère un point de coupe en 0 si le premier en-tête n'est pas au début
    if (headerMatches[0] !== 0) headerMatches.unshift(0);
    for (let i = 0; i < headerMatches.length; i++) {
      const start = headerMatches[i]!;
      const end = headerMatches[i + 1] ?? text.length;
      const piece = text.slice(start, end).trim();
      if (piece.length > 15) chunks.push(piece);
    }
  } else {
    chunks = [text];
  }

  // Étape 2 : si un bloc reste trop gros, sous-découpe par paragraphe
  const final: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= MAX_CHARS_PER_CHUNK) {
      final.push(chunk);
      continue;
    }
    // Découpe par double saut de ligne puis agrège en respectant MAX_CHARS
    const paragraphs = chunk.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let buf = "";
    for (const p of paragraphs) {
      if (buf && (buf.length + p.length + 2) > MAX_CHARS_PER_CHUNK) {
        final.push(buf);
        buf = "";
      }
      buf = buf ? `${buf}\n\n${p}` : p;
    }
    if (buf) final.push(buf);
  }

  // Étape 3 : coupe brute pour les blocs encore trop longs (texte sans
  // paragraphes). Garantit qu'aucun chunk ne dépasse la limite.
  const safe: string[] = [];
  for (const chunk of final) {
    if (chunk.length <= MAX_CHARS_PER_CHUNK) {
      safe.push(chunk);
      continue;
    }
    for (let i = 0; i < chunk.length; i += MAX_CHARS_PER_CHUNK) {
      safe.push(chunk.slice(i, i + MAX_CHARS_PER_CHUNK));
    }
  }

  return safe;
}

// Consomme un stream SSE structure-article / structure-zone et retourne le
// résultat final. Centralise la logique de parsing pour qu'analyzeArticle et
// analyzeZone partagent exactement le même contrat (events `done` / `error`).
async function consumeStructureStream(resp: Response): Promise<{ rules: ExtractedRule[]; diagnostic: string | null }> {
  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => "");
    throw new Error(txt || `Erreur ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let rules: ExtractedRule[] | null = null;
  let diagnostic: string | null = null;
  let errorMsg: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (ev.type === "done") {
          rules = (ev.rules as ExtractedRule[]) ?? [];
          if (typeof ev.diagnostic === "string") diagnostic = ev.diagnostic;
        } else if (ev.type === "error") {
          errorMsg = (ev.message as string) || "Échec de l'analyse";
        }
      } catch { /* ligne mal formée — on continue */ }
    }
  }
  if (errorMsg) throw new Error(errorMsg);
  return { rules: rules ?? [], diagnostic };
}

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
  const [zoneMode, setZoneMode] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [zoneProgress, setZoneProgress] = useState<{ done: number; total: number } | null>(null);
  const [extracted, setExtracted] = useState<ExtractedRule[]>([]);
  const [addingExtracted, setAddingExtracted] = useState(false);
  const [pasteImage, setPasteImage] = useState<{ data: string; media: string; name: string } | null>(null);

  const pickImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      const data = res.split(",")[1] ?? "";
      setPasteImage({ data, media: file.type || "image/png", name: file.name });
    };
    reader.readAsDataURL(file);
  };

  const analyzeArticle = async (zoneCode: string) => {
    if (pasteText.trim().length < 5 && !pasteImage) return;
    setAnalyzing(true);
    try {
      const resp = await fetch("/api/mairie/reglementation/structure-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: pasteText, zone_code: zoneCode, article_number: newRule.article_number ?? undefined,
          image_base64: pasteImage?.data, image_media_type: pasteImage?.media,
        }),
      });
      const { rules, diagnostic } = await consumeStructureStream(resp);
      setExtracted(rules);
      if (diagnostic) alert(diagnostic);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l'analyse");
    } finally {
      setAnalyzing(false);
    }
  };

  const analyzeZone = async (zoneCode: string) => {
    if (pasteText.trim().length < 50) return;
    // On découpe le pavé par ARTICLE puis on traite chaque article en une petite
    // requête : générer ~40 règles + version citoyen en un seul appel est trop long
    // et finit en timeout. Article par article = requêtes courtes et fiables.
    const raw = pasteText.trim();
    const chunks = splitZoneIntoChunks(raw);

    setAnalyzing(true);
    setExtracted([]);
    setZoneProgress({ done: 0, total: chunks.length });
    const results: (ExtractedRule[] | null)[] = new Array(chunks.length).fill(null);
    const diagnostics: string[] = [];   // raisons rapportées par l'API quand 0 règle
    const errors: string[] = [];        // messages d'erreur HTTP/réseau
    let done = 0;

    // Traitement en parallèle par lots de 4 pour aller vite sans saturer l'API.
    const BATCH = 4;
    try {
      for (let start = 0; start < chunks.length; start += BATCH) {
        const slice = chunks.slice(start, start + BATCH);
        await Promise.all(slice.map(async (text, k) => {
          const idx = start + k;
          try {
            // Stream SSE — voir mairie.ts route /reglementation/structure-zone.
            // Évite le 502 passerelle sur les zones denses (max_tokens 16 k).
            const resp = await fetch("/api/mairie/reglementation/structure-zone", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ text, zone_code: zoneCode }),
            });
            const { rules, diagnostic } = await consumeStructureStream(resp);
            results[idx] = rules;
            if (rules.length === 0 && diagnostic) diagnostics.push(diagnostic);
          } catch (e) {
            results[idx] = [];
            errors.push(e instanceof Error ? e.message : String(e));
          } finally {
            done++;
            setZoneProgress({ done, total: chunks.length });
          }
        }));
        // Affiche au fil de l'eau, dans l'ordre des articles.
        setExtracted(results.flatMap(x => x ?? []));
      }
      const all = results.flatMap(x => x ?? []);
      const failures = errors.length;
      if (all.length === 0) {
        // Diagnostic différencié : panne réseau vs réponse IA vide vs articles abrogés
        if (failures === chunks.length) {
          const sample = errors[0] ?? "erreur inconnue";
          alert(`Toutes les requêtes (${failures}/${chunks.length}) ont échoué.\n\nMessage : ${sample}\n\nVérifiez le réseau ou réessayez dans un instant.`);
        } else if (failures > 0) {
          alert(`Aucune règle extraite. ${failures}/${chunks.length} requête(s) ont échoué et le reste n'a rien renvoyé.\n\nDernière erreur : ${errors[errors.length - 1]}`);
        } else if (diagnostics.length > 0) {
          // Affiche au plus 3 diagnostics distincts (sinon trop long)
          const unique = [...new Set(diagnostics)].slice(0, 3);
          alert(`Aucune règle extraite sur ${chunks.length} bloc(s) analysé(s).\n\n• ${unique.join("\n• ")}`);
        } else {
          alert("Aucune règle n'a pu être extraite. Vérifiez le texte collé ou réessayez.");
        }
      } else if (failures > 0) {
        alert(`${all.length} règle(s) extraite(s). ${failures} bloc(s) n'ont pas pu être analysés — vous pouvez relancer ou les saisir manuellement.`);
      }
    } finally {
      setAnalyzing(false);
      setZoneProgress(null);
    }
  };

  const addExtracted = async (zoneId: string) => {
    if (!extracted.length) return;
    setAddingExtracted(true);
    try {
      await api.post(`/mairie/reglementation/zones/${zoneId}/rules/bulk`, { rules: extracted });
      setExtracted([]); setPasteText(""); setPasteImage(null); setAddingZoneId(null);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l'ajout");
    } finally {
      setAddingExtracted(false);
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
    // Écran d'administration des règles : on doit voir les brouillons et
    // rejetées pour pouvoir les valider. Tous les autres callers (carte,
    // dashboards) reçoivent par défaut uniquement les règles validées.
    api.get<ReglData>(`/mairie/reglementation?${param}&include_drafts=true`)
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
    setExtracted([]);
    setPasteImage(null);
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

              {(() => {
                const zoneArticleNums = new Set(selectedZone.rules.map(r => r.article_number).filter((n): n is number => n != null));
                const goToArticle = (n: number) => document.getElementById(`art-${selectedZone.id}-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                const groups: { article: number | null; rules: typeof selectedZone.rules }[] = [];
                for (const r of selectedZone.rules) {
                  const last = groups[groups.length - 1];
                  if (last && last.article === r.article_number) last.rules.push(r);
                  else groups.push({ article: r.article_number, rules: [r] });
                }
                return groups.map(grp => (
                  <div key={`g${grp.article ?? "na"}`} id={grp.article != null ? `art-${selectedZone.id}-${grp.article}` : undefined} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {grp.article != null && (
                      <div style={{ padding: "4px 2px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Article {grp.article}{PLU_ARTICLES[grp.article] ? ` · ${PLU_ARTICLES[grp.article]!.title}` : ""}
                        </span>
                        <button
                          onClick={() => {
                            const a = grp.article!;
                            const def = PLU_ARTICLES[a];
                            setNewRule({ article_number: a, ...(def ? { topic: def.topic, article_title: def.title } : { topic: "general" }), rule_text: "", summary: "" });
                            setPasteText(""); setExtracted([]); setPasteImage(null);
                            setAddingZoneId(selectedZone.id);
                          }}
                          style={{ border: "1px solid #C7D2FE", background: "white", color: "#4F46E5", borderRadius: 7, padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          + Sous-règle
                        </button>
                      </div>
                    )}
                    {grp.rules.map(rule => {
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
                            {rule.article_number ? `Art. ${rule.article_number} • ` : ""}{meta.label}{rule.sub_theme ? ` — ${rule.sub_theme}` : ""}
                          </span>
                          {statusDot(rule.validation_status)}
                        </div>
                        {!isEditing && (
                          <>
                            <p style={{ margin: "0 0 4px", fontSize: 13, color: "#111827", lineHeight: 1.5 }}>{rule.rule_text}</p>
                            {rule.exceptions && (
                              <p style={{ margin: "0 0 4px", fontSize: 12, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "4px 8px", lineHeight: 1.45 }}>
                                <strong>Sauf :</strong> {rule.exceptions}
                              </p>
                            )}
                            {(rule.value_min != null || rule.value_max != null || rule.value_exact != null) && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                {rule.value_min != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#374151" }}>min {rule.value_min} {rule.unit}</span>}
                                {rule.value_max != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#374151" }}>max {rule.value_max} {rule.unit}</span>}
                                {rule.value_exact != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#374151" }}>{rule.value_exact} {rule.unit}</span>}
                                {rule.conditions && <span style={{ background: "#FFF7ED", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#C2410C" }}>⚠ {rule.conditions}</span>}
                              </div>
                            )}
                            {(rule.cases?.length ?? 0) > 0 && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                {rule.cases!.filter(c => c.value != null).map((c, i) => {
                                  const isCond = c.kind === "condition";
                                  return (
                                    <span key={i} style={{ background: isCond ? "#FFF7ED" : "#EEF2FF", color: isCond ? "#C2410C" : "#4338CA", borderRadius: 6, padding: "2px 8px", fontSize: 11 }}>
                                      {isCond ? "si " : ""}{c.condition} : <strong>{c.value ?? "—"}{c.unit ? ` ${c.unit}` : ""}</strong>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            {(rule.applies_if?.length ?? 0) > 0 && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                {rule.applies_if!.map((t, i) => (
                                  <span key={i} style={{ background: "#FEF3C7", color: "#92400E", borderRadius: 6, padding: "2px 8px", fontSize: 10.5 }}>⊕ {APPLIES_LABEL[t] ?? t}</span>
                                ))}
                              </div>
                            )}
                            {(() => { const refs = extractArticleRefs(rule, zoneArticleNums); return refs.length > 0 && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                                <span style={{ fontSize: 10.5, color: "#9CA3AF" }}>Renvois :</span>
                                {refs.map(n => (
                                  <button key={n} onClick={() => goToArticle(n)} style={{ background: "#EEF2FF", color: "#4338CA", border: "1px solid #C7D2FE", borderRadius: 6, padding: "1px 8px", fontSize: 10.5, fontWeight: 600, cursor: "pointer" }}>→ Article {n}</button>
                                ))}
                              </div>
                            ); })()}
                          </>
                        )}

                        {/* Inline edit form */}
                        {isEditing && (
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                            <input
                              placeholder="Nom de la sous-règle (ex: Toitures, Clôtures sur rue…)"
                              style={{ borderRadius: 8, border: "1px solid #C7D2FE", padding: "6px 10px", fontSize: 12, outline: "none" }}
                              value={(editForm.sub_theme ?? rule.sub_theme) ?? ""}
                              onChange={e => setEditForm(f => ({ ...f, sub_theme: e.target.value || null }))}
                            />
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
                            <input style={{ borderRadius: 8, border: "1px solid #FDE68A", background: "#FFFBEB", padding: "6px 10px", fontSize: 12, outline: "none" }}
                              placeholder="Exceptions / dérogations (sauf… / cf. autre article)…"
                              value={(editForm.exceptions ?? rule.exceptions) ?? ""}
                              onChange={e => setEditForm(f => ({ ...f, exceptions: e.target.value || null }))}
                            />
                            <input style={{ borderRadius: 8, border: "1px solid #E2E8F0", padding: "6px 10px", fontSize: 12, outline: "none" }}
                              placeholder="Résumé (10 mots max)…"
                              value={(editForm.summary ?? rule.summary) ?? ""}
                              onChange={e => setEditForm(f => ({ ...f, summary: e.target.value || null }))}
                            />

                            {/* Version « citoyen » : ce que verra le particulier dans l'analyse publique */}
                            <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, padding: "8px 10px" }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#047857", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                                👤 Version citoyen
                                <label style={{ marginLeft: "auto", fontWeight: 600, color: "#065F46", display: "flex", alignItems: "center", gap: 4 }}>
                                  <input type="checkbox"
                                    checked={(editForm.citizen_relevant ?? rule.citizen_relevant) !== false}
                                    onChange={e => setEditForm(f => ({ ...f, citizen_relevant: e.target.checked }))} />
                                  Visible par le citoyen
                                </label>
                              </div>
                              <input style={{ width: "100%", boxSizing: "border-box", borderRadius: 6, border: "1px solid #A7F3D0", background: "white", padding: "5px 8px", fontSize: 12, fontWeight: 600, color: "#065F46", outline: "none", marginBottom: 5 }}
                                placeholder="Titre court (ex: Hauteur des maisons)…"
                                value={(editForm.citizen_title ?? rule.citizen_title) ?? ""}
                                onChange={e => setEditForm(f => ({ ...f, citizen_title: e.target.value || null }))}
                              />
                              <textarea style={{ width: "100%", boxSizing: "border-box", borderRadius: 6, border: "1px solid #A7F3D0", background: "white", padding: "5px 8px", fontSize: 12, color: "#065F46", outline: "none", resize: "vertical", minHeight: 38, fontFamily: "inherit" }}
                                placeholder="Une phrase simple, en « vous », avec la valeur clé…"
                                value={(editForm.citizen_summary ?? rule.citizen_summary) ?? ""}
                                onChange={e => setEditForm(f => ({ ...f, citizen_summary: e.target.value || null }))}
                              />
                            </div>

                            {/* Cas conditionnels / paramètres */}
                            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px" }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Cas conditionnels / paramètres</div>
                              {(editForm.cases ?? rule.cases ?? []).map((c, i) => (
                                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                                  <input placeholder="Libellé (condition ou paramètre)" style={{ flex: 1, minWidth: 0, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 8px", fontSize: 11.5, outline: "none" }}
                                    value={c.condition}
                                    onChange={e => setEditForm(f => ({ ...f, cases: (f.cases ?? rule.cases ?? []).map((x, j) => j === i ? { ...x, condition: e.target.value } : x) }))}
                                  />
                                  <input type="number" placeholder="val" style={{ width: 56, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 6px", fontSize: 11.5, outline: "none" }}
                                    value={c.value ?? ""}
                                    onChange={e => setEditForm(f => ({ ...f, cases: (f.cases ?? rule.cases ?? []).map((x, j) => j === i ? { ...x, value: e.target.value === "" ? null : Number(e.target.value) } : x) }))}
                                  />
                                  <select style={{ width: 58, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 4px", fontSize: 11.5, outline: "none" }}
                                    value={c.unit ?? ""}
                                    onChange={e => setEditForm(f => ({ ...f, cases: (f.cases ?? rule.cases ?? []).map((x, j) => j === i ? { ...x, unit: e.target.value || null } : x) }))}>
                                    <option value="">—</option><option value="m">m</option><option value="cm">cm</option><option value="%">%</option><option value="m²">m²</option><option value="places">pl.</option>
                                  </select>
                                  <select title="Nature du cas" style={{ width: 84, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 4px", fontSize: 11, outline: "none" }}
                                    value={c.kind ?? "parametre"}
                                    onChange={e => setEditForm(f => ({ ...f, cases: (f.cases ?? rule.cases ?? []).map((x, j) => j === i ? { ...x, kind: e.target.value as "condition" | "parametre" } : x) }))}>
                                    <option value="parametre">paramètre</option>
                                    <option value="condition">condition</option>
                                  </select>
                                  <button onClick={() => setEditForm(f => ({ ...f, cases: (f.cases ?? rule.cases ?? []).filter((_, j) => j !== i) }))}
                                    style={{ border: "none", background: "transparent", color: "#EF4444", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>✕</button>
                                </div>
                              ))}
                              <button onClick={() => setEditForm(f => ({ ...f, cases: [...(f.cases ?? rule.cases ?? []), { condition: "", value: null, unit: (f.unit ?? rule.unit) ?? null, kind: "parametre" }] }))}
                                style={{ border: "1px dashed #C7D2FE", background: "white", color: "#4F46E5", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                + Ajouter un cas
                              </button>
                            </div>

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
                  </div>
                ));
              })()}

              {/* Add rule button */}
              {addingZoneId !== selectedZone.id ? (
                <button onClick={() => setAddingZoneId(selectedZone.id)}
                  style={{ width: "100%", padding: "12px", border: "2px dashed #C7D2FE", borderRadius: 12, background: "transparent", color: "#4F46E5", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
                  + Ajouter une règle
                </button>
              ) : (
                <div style={{ background: "white", borderRadius: 12, border: "1px solid #C7D2FE", padding: "16px 18px" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 12 }}>Nouvelle règle</div>

                  {/* Coller le texte → structuration IA (texte court, pas le PDF) */}
                  <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                    {/* Choix du mode : un article isolé vs le règlement complet de la zone */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      <button onClick={() => { setZoneMode(false); setExtracted([]); }}
                        style={{ flex: 1, fontSize: 11, fontWeight: 600, borderRadius: 8, padding: "6px 8px", cursor: "pointer",
                          border: zoneMode ? "1px solid #DDD6FE" : "1.5px solid #7C3AED",
                          background: zoneMode ? "white" : "#EDE9FE", color: zoneMode ? "#6B7280" : "#6D28D9" }}>
                        Un article
                      </button>
                      <button onClick={() => { setZoneMode(true); setExtracted([]); setPasteImage(null); }}
                        style={{ flex: 1, fontSize: 11, fontWeight: 600, borderRadius: 8, padding: "6px 8px", cursor: "pointer",
                          border: zoneMode ? "1.5px solid #7C3AED" : "1px solid #DDD6FE",
                          background: zoneMode ? "#EDE9FE" : "white", color: zoneMode ? "#6D28D9" : "#6B7280" }}>
                        Règlement complet de la zone
                      </button>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#6D28D9", marginBottom: 6 }}>
                      {zoneMode
                        ? "✨ Collez le règlement complet de la zone (tous les articles). L'IA l'analyse article par article (une règle par sous-section + une version « citoyen » claire)."
                        : "✨ Coller le texte — ou importer une image (tableau / croquis)"}
                    </div>
                    <textarea placeholder={zoneMode ? "Collez ici le règlement complet de la zone (articles 1 à 16)…" : "Collez ici le texte de l'article du PLU…"}
                      style={{ width: "100%", minHeight: zoneMode ? 120 : 60, borderRadius: 8, border: "1px solid #DDD6FE", padding: "8px 10px", fontSize: 12, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                      value={pasteText}
                      onChange={e => setPasteText(e.target.value)}
                    />
                    {!zoneMode && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        <label style={{ fontSize: 11, color: "#6D28D9", cursor: "pointer", border: "1px solid #DDD6FE", borderRadius: 8, padding: "5px 10px", background: "white", fontWeight: 600 }}>
                          📷 Image (tableau / croquis)
                          <input type="file" accept="image/*" style={{ display: "none" }}
                            onChange={e => { const f = e.target.files?.[0]; if (f) pickImage(f); e.target.value = ""; }}
                          />
                        </label>
                        {pasteImage && (
                          <span style={{ fontSize: 11, color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
                            🖼 {pasteImage.name.length > 22 ? pasteImage.name.slice(0, 20) + "…" : pasteImage.name}
                            <button onClick={() => setPasteImage(null)} style={{ border: "none", background: "transparent", color: "#EF4444", cursor: "pointer", fontSize: 13 }}>✕</button>
                          </span>
                        )}
                      </div>
                    )}
                    <button onClick={() => zoneMode ? analyzeZone(selectedZone.zone_code) : analyzeArticle(selectedZone.zone_code)}
                      disabled={analyzing || (zoneMode ? pasteText.trim().length < 50 : (pasteText.trim().length < 5 && !pasteImage))}
                      style={{ marginTop: 8, background: analyzing ? "#A78BFA" : "#7C3AED", color: "white", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: analyzing ? "wait" : "pointer" }}>
                      {analyzing
                        ? (zoneProgress ? `Analyse… article ${zoneProgress.done}/${zoneProgress.total}` : "Analyse…")
                        : zoneMode ? "Analyser toute la zone" : "Analyser et structurer"}
                    </button>
                  </div>

                  {extracted.length === 0 ? (
                  <>
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
                  <input placeholder="Nom de la sous-règle (optionnel — ex: Toitures, Clôtures sur rue…)" style={{ width: "100%", borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none", marginBottom: 8, boxSizing: "border-box" }}
                    value={newRule.sub_theme ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, sub_theme: e.target.value || null }))}
                  />
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
                  <input placeholder="Exceptions / dérogations (ex: sauf sinistre grave ; cf. UA-2)" style={{ marginTop: 6, width: "100%", borderRadius: 8, border: "1px solid #FDE68A", background: "#FFFBEB", padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                    value={newRule.exceptions ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, exceptions: e.target.value || null }))}
                  />
                  <input placeholder="Résumé (10 mots max)" style={{ marginTop: 6, width: "100%", borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                    value={newRule.summary ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, summary: e.target.value }))}
                  />

                  {/* Cas conditionnels (ex: 10 m sens unique / 13 m double sens) */}
                  <div style={{ marginTop: 10, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Cas conditionnels (selon voie, secteur…)</div>
                    {(newRule.cases ?? []).map((c, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                        <input placeholder="Condition (ex: voie à double sens)" style={{ flex: 1, minWidth: 0, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 8px", fontSize: 11.5, outline: "none" }}
                          value={c.condition}
                          onChange={e => setNewRule(f => ({ ...f, cases: (f.cases ?? []).map((x, j) => j === i ? { ...x, condition: e.target.value } : x) }))}
                        />
                        <input type="number" placeholder="val" style={{ width: 56, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 6px", fontSize: 11.5, outline: "none" }}
                          value={c.value ?? ""}
                          onChange={e => setNewRule(f => ({ ...f, cases: (f.cases ?? []).map((x, j) => j === i ? { ...x, value: e.target.value === "" ? null : Number(e.target.value) } : x) }))}
                        />
                        <select style={{ width: 58, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 4px", fontSize: 11.5, outline: "none" }}
                          value={c.unit ?? ""}
                          onChange={e => setNewRule(f => ({ ...f, cases: (f.cases ?? []).map((x, j) => j === i ? { ...x, unit: e.target.value || null } : x) }))}>
                          <option value="">—</option><option value="m">m</option><option value="cm">cm</option><option value="%">%</option><option value="m²">m²</option><option value="places">pl.</option>
                        </select>
                        <select title="Nature du cas" style={{ width: 84, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 4px", fontSize: 11, outline: "none" }}
                          value={c.kind ?? "parametre"}
                          onChange={e => setNewRule(f => ({ ...f, cases: (f.cases ?? []).map((x, j) => j === i ? { ...x, kind: e.target.value as "condition" | "parametre" } : x) }))}>
                          <option value="parametre">paramètre</option>
                          <option value="condition">condition</option>
                        </select>
                        <button onClick={() => setNewRule(f => ({ ...f, cases: (f.cases ?? []).filter((_, j) => j !== i) }))}
                          style={{ border: "none", background: "transparent", color: "#EF4444", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>✕</button>
                      </div>
                    ))}
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6 }}>« condition » = alternative (on en applique une) · « paramètre » = valeur de calcul (toutes s'appliquent)</div>
                    <button onClick={() => setNewRule(f => ({ ...f, cases: [...(f.cases ?? []), { condition: "", value: null, unit: f.unit ?? null, kind: "parametre" }] }))}
                      style={{ border: "1px dashed #C7D2FE", background: "white", color: "#4F46E5", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      + Ajouter un cas
                    </button>
                  </div>

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
                  </>
                  ) : (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>{extracted.length} règle(s) détectée(s) — vérifiez puis ajoutez</div>
                    {extracted.map((r, i) => (
                      <div key={i} style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px", marginBottom: 8, background: "white" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#6B7280" }}>
                            {r.article_number ? `Art. ${r.article_number} · ` : ""}{TOPIC_META[r.topic]?.label ?? r.topic}{r.sub_theme ? ` — ${r.sub_theme}` : ""}
                          </span>
                          <button onClick={() => setExtracted(es => es.filter((_, j) => j !== i))} title="Retirer" style={{ border: "none", background: "transparent", color: "#EF4444", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>✕</button>
                        </div>
                        <p style={{ fontSize: 11.5, color: "#374151", margin: "4px 0 0", lineHeight: 1.45 }}>{r.summary || r.rule_text.slice(0, 180)}</p>
                        {r.exceptions && <p style={{ fontSize: 11, color: "#B45309", margin: "4px 0 0", lineHeight: 1.4 }}><strong>Sauf :</strong> {r.exceptions}</p>}
                        {/* Version « citoyen » générée par l'IA — éditable avant enregistrement */}
                        {(r.citizen_title != null || r.citizen_summary != null) && (
                          <div style={{ marginTop: 6, padding: "6px 8px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8 }}>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: "#047857", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                              👤 Version citoyen
                              <label style={{ marginLeft: "auto", fontWeight: 600, color: "#065F46", display: "flex", alignItems: "center", gap: 4, textTransform: "none", letterSpacing: 0 }}>
                                <input type="checkbox" checked={r.citizen_relevant !== false}
                                  onChange={e => setExtracted(es => es.map((x, j) => j === i ? { ...x, citizen_relevant: e.target.checked } : x))} />
                                Visible
                              </label>
                            </div>
                            <input value={r.citizen_title ?? ""} placeholder="Titre court (ex: Hauteur des maisons)"
                              onChange={e => setExtracted(es => es.map((x, j) => j === i ? { ...x, citizen_title: e.target.value || null } : x))}
                              style={{ width: "100%", boxSizing: "border-box", fontSize: 11.5, fontWeight: 600, color: "#065F46", border: "1px solid #A7F3D0", borderRadius: 6, padding: "4px 7px", outline: "none", background: "white", marginBottom: 4 }} />
                            <textarea value={r.citizen_summary ?? ""} placeholder="Une phrase simple, en « vous », avec la valeur clé."
                              onChange={e => setExtracted(es => es.map((x, j) => j === i ? { ...x, citizen_summary: e.target.value || null } : x))}
                              style={{ width: "100%", boxSizing: "border-box", fontSize: 11.5, color: "#065F46", border: "1px solid #A7F3D0", borderRadius: 6, padding: "4px 7px", outline: "none", background: "white", resize: "vertical", minHeight: 34, fontFamily: "inherit" }} />
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                          {r.value_min != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, color: "#374151" }}>≥{r.value_min} {r.unit}</span>}
                          {r.value_max != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, color: "#374151" }}>≤{r.value_max} {r.unit}</span>}
                          {r.value_exact != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, color: "#374151" }}>{r.value_exact} {r.unit}</span>}
                          {r.cases.filter(c => c.value != null).map((c, ci) => { const isCond = c.kind === "condition"; return (
                            <span key={`c${ci}`} style={{ background: isCond ? "#FFF7ED" : "#EEF2FF", color: isCond ? "#C2410C" : "#4338CA", borderRadius: 6, padding: "2px 8px", fontSize: 10.5 }}>{isCond ? "si " : ""}{c.condition} : <strong>{c.value ?? "—"}{c.unit ? ` ${c.unit}` : ""}</strong></span>
                          ); })}
                          {r.applies_if.map((t, ti) => (
                            <span key={`a${ti}`} style={{ background: "#FEF3C7", color: "#92400E", borderRadius: 6, padding: "2px 8px", fontSize: 10.5 }}>⊕ {APPLIES_LABEL[t] ?? t}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button onClick={() => addExtracted(selectedZone.id)} disabled={addingExtracted || extracted.length === 0}
                        style={{ background: addingExtracted ? "#818CF8" : "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: addingExtracted ? "wait" : "pointer" }}>
                        {addingExtracted ? "Ajout…" : `Ajouter ${extracted.length} règle(s)`}
                      </button>
                      <button onClick={() => setExtracted([])}
                        style={{ background: "#F1F5F9", color: "#374151", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
                        Recommencer
                      </button>
                      <button onClick={() => { setExtracted([]); setPasteText(""); setAddingZoneId(null); }}
                        style={{ background: "transparent", color: "#94a3b8", border: "none", padding: "7px 8px", fontSize: 12, cursor: "pointer" }}>
                        Annuler
                      </button>
                    </div>
                  </div>
                  )}
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

function DelegationsPanel() {
  type DelegationRow = {
    id: string;
    delegate_user_id: string;
    priority: number;
    prenom: string | null;
    nom: string | null;
    email: string | null;
  };
  type InstructeurOption = { id: string; prenom: string; nom: string; email: string };

  const [instructeurs, setInstructeurs] = useState<InstructeurOption[]>([]);
  const [delegates, setDelegates] = useState<string[]>([]);
  const [initial, setInitial] = useState<string[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<InstructeurOption[]>("/mairie/instructeurs").catch(() => []),
      api.get<DelegationRow[]>("/mairie/my-delegations").catch(() => []),
      api.get<{ absences: Absence[] }>("/mairie/my-availability").catch(() => ({ absences: [] as Absence[] })),
    ]).then(([list, delegs, avail]) => {
      setInstructeurs(list);
      const ordered = [...delegs].sort((a, b) => a.priority - b.priority).map((d) => d.delegate_user_id);
      setDelegates(ordered);
      setInitial(ordered);
      setAbsences(avail.absences ?? []);
    }).finally(() => setLoading(false));
  }, []);

  const usersById = useMemo(() => {
    const m = new Map<string, InstructeurOption>();
    instructeurs.forEach((u) => m.set(u.id, u));
    return m;
  }, [instructeurs]);

  const dirty = useMemo(() => {
    if (delegates.length !== initial.length) return true;
    return delegates.some((id, i) => id !== initial[i]);
  }, [delegates, initial]);

  const available = instructeurs.filter((u) => !delegates.includes(u.id));
  const todayIso = new Date().toISOString().slice(0, 10);
  const activeAbsence = absences.find((a) => a.start_date <= todayIso && a.end_date >= todayIso);
  const upcomingAbsence = absences
    .filter((a) => a.start_date > todayIso)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];

  const addDelegate = (id: string) => {
    if (!id || delegates.includes(id)) return;
    setDelegates((prev) => [...prev, id]);
    setMsg(null);
  };
  const removeDelegate = (id: string) => setDelegates((prev) => prev.filter((d) => d !== id));
  const move = (idx: number, dir: -1 | 1) => {
    setDelegates((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      const a = next[idx]!;
      const b = next[j]!;
      next[idx] = b;
      next[j] = a;
      return next;
    });
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.put("/mairie/my-delegations", { delegates });
      setInitial(delegates);
      setMsg({ ok: true, text: "Délégation enregistrée." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setSaving(false);
    }
  };

  const fullName = (u: { prenom?: string | null; nom?: string | null; email?: string | null }) =>
    [u.prenom, u.nom].filter(Boolean).join(" ").trim() || u.email || "—";

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>;

  return (
    <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Délégations</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          Désignez les instructeurs qui prendront le relais pendant vos absences.
        </div>
      </div>

      {(activeAbsence || upcomingAbsence) && (
        <div style={{
          marginBottom: 16,
          padding: "10px 14px",
          borderRadius: 8,
          border: `1px solid ${activeAbsence ? "#FED7AA" : "#BFDBFE"}`,
          background: activeAbsence ? "#FFF7ED" : "#EFF6FF",
          color: activeAbsence ? "#9A3412" : "#1E40AF",
          fontSize: 12.5,
        }}>
          {activeAbsence ? (
            <>Vous êtes en absence jusqu'au <strong>{new Date(activeAbsence.end_date).toLocaleDateString("fr-FR")}</strong>. Vos nouveaux dossiers et ceux dont l'échéance tombe d'ici là sont redirigés vers la chaîne ci-dessous.</>
          ) : (
            <>Prochaine absence prévue du <strong>{new Date(upcomingAbsence!.start_date).toLocaleDateString("fr-FR")}</strong> au <strong>{new Date(upcomingAbsence!.end_date).toLocaleDateString("fr-FR")}</strong>.</>
          )}
        </div>
      )}

      <div style={{ marginBottom: 12, fontSize: 12, color: "#64748b" }}>
        Le 1er instructeur est sollicité en priorité. Si lui-même est absent, le système passe au suivant, et ainsi de suite.
      </div>

      {delegates.length === 0 ? (
        <div style={{
          padding: "24px 16px",
          textAlign: "center",
          border: "1px dashed #E2E8F0",
          borderRadius: 8,
          color: "#94a3b8",
          fontSize: 13,
        }}>
          Aucun délégué configuré. En cas d'absence, vos dossiers resteront sur votre nom.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {delegates.map((id, idx) => {
            const u = usersById.get(id);
            return (
              <div key={id} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                background: "white",
              }}>
                <span style={{
                  background: "#EEF2FF",
                  color: "#4F46E5",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  padding: "3px 8px",
                  flexShrink: 0,
                }}>
                  Priorité {idx + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>
                    {u ? fullName(u) : "Utilisateur introuvable"}
                  </div>
                  {u?.email && <div style={{ fontSize: 11, color: "#64748b" }}>{u.email}</div>}
                </div>
                <button onClick={() => move(idx, -1)} disabled={idx === 0} title="Monter"
                  style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: "#64748b", cursor: idx === 0 ? "not-allowed" : "pointer", opacity: idx === 0 ? 0.4 : 1 }}>↑</button>
                <button onClick={() => move(idx, 1)} disabled={idx === delegates.length - 1} title="Descendre"
                  style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: "#64748b", cursor: idx === delegates.length - 1 ? "not-allowed" : "pointer", opacity: idx === delegates.length - 1 ? 0.4 : 1 }}>↓</button>
                <button onClick={() => removeDelegate(id)} title="Retirer"
                  style={{ border: "1px solid #FECACA", background: "white", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: "#EF4444", cursor: "pointer" }}>Retirer</button>
              </div>
            );
          })}
        </div>
      )}

      {available.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <select
            onChange={(e) => {
              if (e.target.value) addDelegate(e.target.value);
              e.currentTarget.selectedIndex = 0;
            }}
            defaultValue=""
            style={{ flex: 1, padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151" }}
          >
            <option value="" disabled>Ajouter un délégué…</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {fullName(u)} {u.email ? `(${u.email})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {msg && (
        <div style={{
          marginTop: 12,
          padding: "8px 12px",
          borderRadius: 8,
          border: `1px solid ${msg.ok ? "#86EFAC" : "#FECACA"}`,
          background: msg.ok ? "#F0FDF4" : "#FEF2F2",
          color: msg.ok ? "#15803d" : "#DC2626",
          fontSize: 13,
        }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{
            background: !dirty || saving ? "#A5B4FC" : "linear-gradient(135deg,#4F46E5,#6366F1)",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: !dirty || saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
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

          {stab === "Délégations" && <DelegationsPanel />}

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

type DelaiBreakdown = {
  total_mois: number;
  base_date?: string;
  base_date_source?: "completude" | "depot";
  computed_at?: string;
  breakdown: Array<{ label: string; mois: number; article: string }>;
};

type WorkflowMeta = {
  status: DossierStatus;
  next_action: NextAction | null;
  allowed_transitions: DossierStatus[];
  can_take_charge: boolean;
  can_reassign: boolean;
  can_unassign: boolean;
  is_mine: boolean;
};

type DossierInfo = {
  id: string; numero: string; type: string; petitionnaire: string; adresse: string;
  status: string; echeance: string; date_depot?: string;
  date_completude?: string;
  delai?: DelaiBreakdown | null;
  description?: string; parcelle?: string; surface_plancher?: string;
  commune?: string; code_postal?: string;
  instructeur?: string;
  instructeur_id?: string;
  workflow?: WorkflowMeta;
  lat?: number; lng?: number;
  // Analyse parcellaire propagée depuis la création du dossier côté citoyen,
  // évite un re-fetch /analyse-parcelle à l'ouverture.
  cachedParcelAnalysis?: Record<string, unknown> | null;
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

const PC_DECISION_OPTIONS = [
  { key: "accord", label: "Accord", sub: "Autorisation accordée" },
  { key: "accord_prescription", label: "Accord avec prescriptions", sub: "Sous conditions" },
  { key: "refus", label: "Refus", sub: "Opposition au projet" },
  { key: "sursis_a_statuer", label: "Sursis à statuer", sub: "Décision différée" },
];
const CU_DECISION_OPTIONS = [
  { key: "cu_positif", label: "CU positif", sub: "Faisabilité confirmée" },
  { key: "cu_negatif", label: "CU négatif", sub: "Faisabilité impossible" },
];

const DECISION_OPTIONS: Record<string, Array<{ key: string; label: string; sub: string }>> = {
  permis_de_construire: PC_DECISION_OPTIONS,
  permis_de_construire_mi: PC_DECISION_OPTIONS,
  declaration_prealable: [
    { key: "non_opposition", label: "Non-opposition", sub: "Travaux autorisés" },
    { key: "non_opposition_prescription", label: "Non-opposition avec prescriptions", sub: "Sous réserves" },
    { key: "opposition", label: "Opposition", sub: "Travaux refusés" },
    { key: "pieces_complementaires", label: "Demande de pièces", sub: "Pièces manquantes" },
  ],
  certificat_urbanisme: CU_DECISION_OPTIONS,
  certificat_urbanisme_a: CU_DECISION_OPTIONS,
  certificat_urbanisme_b: CU_DECISION_OPTIONS,
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

// "Terrain" remplace "Parcelle" : vue contextuelle (cadastre, contraintes
// fortes, constructibilité synthétique, historique SITADEL/ADS). La carte
// et le règlement détaillé migrent vers "Instruction", devenue l'espace de
// preuve où l'instructeur confronte les pièces aux PDF réglementaires.
const DETAIL_TABS = ["Résumé", "Terrain", "Conformité IA", "Instruction", "Consultations", "Courriers", "Chronologie", "Décision"] as const;
type DetailTab = typeof DETAIL_TABS[number];

const TAB_ICONS: Record<string, React.ReactNode> = {
  "Résumé": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  "Terrain": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>,
  "Conformité IA": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
  "Instruction": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
  "Consultations": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>,
  "Courriers": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
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

// ─── Onglet "Courriers" ──────────────────────────────────────────────────────
// Historique des courriers d'instruction émis pour un dossier. Liste, type,
// auteur, pièces visées, articles cités. Sert de référence auditable pour
// le pétitionnaire et l'instructeur.
function CourriersPanel({ dossierId, onRequestNewPiecesCourrier, onRequestNewGeneralCourrier }: {
  dossierId: string;
  onRequestNewPiecesCourrier: () => void;
  onRequestNewGeneralCourrier: () => void;
}) {
  type CourrierRow = {
    id: string;
    type: string;
    subject: string | null;
    pieces_jointes_ids: Array<{ piece_id?: string; code_piece?: string; nom: string; raison?: string; manquante?: boolean }>;
    articles_cites: string[];
    emis_par: string | null;
    emis_le: string;
    delivery_method: string | null;
  };
  const [rows, setRows] = useState<CourrierRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<CourrierRow[]>(`/mairie/dossiers/${dossierId}/courriers`)
      .then((d) => { if (!cancelled) setRows(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Erreur"); });
    return () => { cancelled = true; };
  }, [dossierId]);

  const COURRIER_LABEL: Record<string, { label: string; color: string; bg: string }> = {
    pieces_complementaires: { label: "Demande de pièces", color: "#B45309", bg: "#FEF3C7" },
    refus: { label: "Refus", color: "#B91C1C", bg: "#FEE2E2" },
    non_opposition: { label: "Non-opposition", color: "#15803D", bg: "#DCFCE7" },
    majoration_delai: { label: "Majoration de délai", color: "#0284C7", bg: "#E0F2FE" },
    daact: { label: "DAACT", color: "#7C3AED", bg: "#EDE9FE" },
    sursis: { label: "Sursis", color: "#475569", bg: "#F1F5F9" },
    notification: { label: "Notification", color: "#0F172A", bg: "#F1F5F9" },
    general: { label: "Général", color: "#6B7280", bg: "#F3F4F6" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Courriers émis</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Historique de tous les courriers envoyés au pétitionnaire pour ce dossier.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onRequestNewPiecesCourrier}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "white", color: "#B45309", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            📎 Demander des pièces
          </button>
          <button onClick={onRequestNewGeneralCourrier}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "#0F172A", color: "white", border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            + Nouveau courrier
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: "#FEE2E2", color: "#991B1B", borderRadius: 8, fontSize: 12.5 }}>{error}</div>
      )}

      {rows === null ? (
        <div style={{ padding: 32, background: "white", borderRadius: 12, border: "1px solid #E8EEF4", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 32, background: "white", borderRadius: 12, border: "1px dashed #CBD5E1", textAlign: "center", color: "#64748b", fontSize: 13 }}>
          Aucun courrier émis pour ce dossier.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((c) => {
            const meta = COURRIER_LABEL[c.type] ?? COURRIER_LABEL.general!;
            const pieces = Array.isArray(c.pieces_jointes_ids) ? c.pieces_jointes_ids : [];
            const articles = Array.isArray(c.articles_cites) ? c.articles_cites : [];
            return (
              <div key={c.id} style={{ background: "white", border: "1px solid #E8EEF4", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, padding: "2px 8px", borderRadius: 5 }}>{meta.label}</span>
                    {c.subject && <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{c.subject}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" as const }}>
                    {new Date(c.emis_le).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {c.delivery_method && <> · <span style={{ textTransform: "capitalize" as const }}>{c.delivery_method}</span></>}
                  </div>
                </div>

                {pieces.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 5 }}>
                      Pièces visées ({pieces.length})
                    </div>
                    <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12.5, color: "#334155" }}>
                      {pieces.map((p, i) => (
                        <li key={i} style={{ marginBottom: 2 }}>
                          {p.code_piece && <span style={{ fontFamily: "monospace", color: "#64748b", marginRight: 6 }}>{p.code_piece}</span>}
                          {p.nom}
                          {p.manquante
                            ? <span style={{ fontSize: 10.5, color: "#B45309", marginLeft: 6 }}>à fournir</span>
                            : <span style={{ fontSize: 10.5, color: "#0284C7", marginLeft: 6 }}>à compléter</span>}
                          {p.raison && <span style={{ color: "#64748b" }}> — {p.raison}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {articles.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 5 }}>
                      Articles cités
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                      {articles.map((a) => (
                        <span key={a} style={{ fontSize: 11, fontWeight: 600, color: "#374151", background: "#F1F5F9", padding: "2px 8px", borderRadius: 5, fontFamily: "monospace" }}>Art. {a}</span>
                      ))}
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

function DossierDetailScreen({ dossier, onBack, navigate }: {
  dossier: DossierInfo;
  onBack: () => void;
  navigate: (s: string) => void;
}) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<DetailTab>("Résumé");
  // Onglet Documents : mode d'affichage côté instructeur — aperçu (3 col.),
  // comparer (pièce ↔ document réglementaire), lecture (plein écran).
  // Persisté en localStorage entre dossiers (préférence utilisateur).
  const [docsViewMode, setDocsViewMode] = useInstructionViewMode();
  // Document réglementaire affiché en mode Comparer (sélection mémorisée
  // tant qu'on reste sur le dossier — réinitialisé entre dossiers).
  const [docsRegulatoryDocId, setDocsRegulatoryDocId] = useState<string | null>(null);
  // Hints transmis au RegulatoryDocViewer quand on arrive depuis une citation
  // de verdict (onglet Conformité IA). docType : auto-sélection PLU/PPRI/OAP…
  // page : ouvre directement à la bonne page via fragment #page=N.
  const [docsRegulatoryDocTypeHint, setDocsRegulatoryDocTypeHint] = useState<string | null>(null);
  const [docsRegulatoryDocPage, setDocsRegulatoryDocPage] = useState<number | null>(null);
  // Repli indépendant des bandeaux latéraux de l'onglet Instruction, disponible
  // dans tous les modes (préférence persistée par instructeur).
  const [docsLeftCollapsed, setDocsLeftCollapsed] = useLocalStorageBool("heureka.instrLeftCollapsed", false);
  const [docsRightCollapsed, setDocsRightCollapsed] = useLocalStorageBool("heureka.instrRightCollapsed", false);
  // Mode « grand écran » de la comparaison (overlay plein viewport). Volontairement
  // non persisté : on ne veut pas rouvrir un dossier coincé en plein écran.
  const [compareFullscreen, setCompareFullscreen] = useState(false);
  // Échap quitte le grand écran.
  useEffect(() => {
    if (!compareFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCompareFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compareFullscreen]);

  // Handler de jump depuis une citation de verdict. Bascule l'onglet, le mode
  // d'affichage, et nourrit les hints du RegulatoryDocViewer.
  const jumpFromCitation = useCallback((ref: { doc_type?: string; page?: number }) => {
    if (!ref.doc_type) return;
    // Pas de bascule automatique : on prépare le viewer pour quand
    // l'utilisateur ouvrira l'onglet Instruction, sans le forcer.
    setDocsViewMode("compare");
    setDocsRegulatoryDocTypeHint(ref.doc_type);
    setDocsRegulatoryDocPage(typeof ref.page === "number" ? ref.page : null);
  }, [setDocsViewMode]);
  // Mode d'ouverture de la modale courrier : null = fermée, "general" = bouton
  // historique, "pieces_complementaires" = entrée dédiée depuis le bandeau
  // workflow. Le mode pilote le panneau de sélection des pièces et le bouton
  // "Émettre" dans la modale.
  const [courrierMode, setCourrierMode] = useState<null | "general" | "pieces_complementaires">(null);
  const [showMapFull, setShowMapFull] = useState(false);

  // ── Analyse parcellaire réelle ──
  type ParcelAnalysis = {
    query: string;
    address?: { label: string; lat: number; lng: number; city: string; postcode: string };
    parcel?: { parcelle_id: string; section: string; numero: string; surface_m2: number; commune: string; code_insee: string };
    plu_zone?: { zone_code: string; zone_label: string; zone_type: string; plu_nom?: string };
    risks?: { flood_risk: string; seismic_zone: string; clay_risk: string };
    db_zone?: { id: string; code: string; label: string | null; type: string | null } | null;
    rules: Array<{
      id: string; topic: string; rule_text: string;
      value_min: number | null; value_max: number | null; value_exact?: number | null;
      unit: string | null; summary: string | null; article_number: number | null;
      sub_theme?: string | null;
      conditions?: string | null;
      exceptions?: string | null;
      cases?: Array<{ condition: string; value: number | null; unit: string | null; kind?: string }> | null;
      relevance?: "general" | "applicable" | "conditional" | "excluded";
    }>;
    buildability: { maxFootprintM2: number; remainingFootprintM2: number; maxHeightM: number | null; minSetbackFromRoadM: number | null; minSetbackFromBoundariesM: number | null; estimatedFloors: number | null; greenSpaceRatio: number | null; greenSpaceRequiredM2: number | null; confidence: number; resultSummary: string } | null;
    data_sources: string[];
    warnings: string[];
    available_zones?: Array<{ zone_code: string; zone_label: string; zone_type: string }>;
    municipality?: { is_rnu: boolean; libelle?: string } | null;
    prescriptions?: Array<{ libelle: string; typepsc: string; txtpsc?: string }>;
    servitudes?: Array<{
      categorie: string;
      libelle?: string;
      nomsup?: string;
      dessup?: string;
      ref_acte?: string;
      urlacte?: string;
      gestionnaire?: string;
      datdecr?: string;
      typeprotect?: string;
    }>;
  };
  const [parcelAnalysis, setParcelAnalysis] = useState<ParcelAnalysis | null>(
    (dossier.cachedParcelAnalysis as ParcelAnalysis | null) ?? null
  );
  const [parcelLoading, setParcelLoading] = useState(false);
  const [parcelError, setParcelError] = useState<string | null>(null);
  const [showAddressEditor, setShowAddressEditor] = useState(false);
  // ── Délai d'instruction (popover sur le chip Échéance) ──
  const [showDelaiPopover, setShowDelaiPopover] = useState(false);
  const [completudeDraft, setCompletudeDraft] = useState<string | null>(null);
  const [delaiSaving, setDelaiSaving] = useState(false);
  const saveCompletude = useCallback(async () => {
    setDelaiSaving(true);
    try {
      await api.patch(`/mairie/dossiers/${dossier.id}/deadline`, { date_completude: completudeDraft || null });
      // Force le rechargement du dossier au prochain mount — ici on signale juste à l'utilisateur.
      alert("Date de complétude enregistrée. Le délai a été recalculé. Rechargez la page pour voir la nouvelle échéance.");
      setShowDelaiPopover(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l'enregistrement");
    } finally {
      setDelaiSaving(false);
    }
  }, [dossier.id, completudeDraft]);
  const [addressOverride, setAddressOverride] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [addrQuery, setAddrQuery] = useState("");
  const [addrSuggestions, setAddrSuggestions] = useState<Array<{ label: string; city: string; postcode: string }>>([]);
  const [addrSugLoading, setAddrSugLoading] = useState(false);
  const [addrSaving, setAddrSaving] = useState(false);
  const [liveAdresse, setLiveAdresse] = useState(dossier.adresse);
  const [liveCommune, setLiveCommune] = useState(dossier.commune ?? null);
  // Édition inline du type de dossier — utile quand l'OCR a renvoyé un type
  // générique (ex. PC au lieu de PCMI) ou pour corriger une erreur de saisie.
  const [liveType, setLiveType] = useState<string>(dossier.type);
  const [showTypeEditor, setShowTypeEditor] = useState(false);
  const [typeSaving, setTypeSaving] = useState(false);
  const saveType = useCallback(async (next: string) => {
    if (next === liveType) {
      setShowTypeEditor(false);
      return;
    }
    setTypeSaving(true);
    try {
      await api.patch(`/mairie/dossiers/${dossier.id}/type`, { type: next });
      setLiveType(next);
      setShowTypeEditor(false);
      alert("Type d'autorisation mis à jour. Le délai d'instruction a été recalculé.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la mise à jour du type");
    } finally {
      setTypeSaving(false);
    }
  }, [dossier.id, liveType]);
  const [clickingParcel, setClickingParcel] = useState(false);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    // Chargement éager : l'analyse identifie notamment la référence
    // cadastrale, qui s'affiche aussi dans le Résumé et l'en-tête.
    if (parcelAnalysis || parcelLoading) return;
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
  }, [dossier.id, parcelAnalysis, parcelLoading, addressOverride, selectedZone, clickedCoords]);

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

  type PieceAnalyse = { score?: string; commentaire?: string; suggestions?: string[] };
  type PieceExtractionLite = {
    piece_type?: string;
    confidence_type?: number;
    quality?: string;
    echelle?: string | null;
    nord_visible?: boolean | null;
    // Phase 5 : checklist graphique étendue. Optionnel pour rétro-compat
    // avec les anciennes extractions stockées en jsonb.
    graphics?: {
      orientation?: { kind?: string; visible?: boolean; evidence?: string | null } | null;
      echelle_graphique?: string | null;
      legende?: string | null;
      limites?: string | null;
      acces?: string | null;
      emprise?: string | null;
      cotes_completes?: string | null;
      altimetries?: string | null;
      prises_de_vue?: Array<{ label: string; page?: number | null }> | null;
    } | null;
    // Phase 2.3 : références cadastrales observées sur la pièce.
    parcelles_observees?: Array<{
      section: string;
      numero: string;
      qualificatif: "entiere" | "partie";
      source_field?: string | null;
      citation?: string | null;
    }> | null;
    cerfa?: Record<string, unknown> | null;
    plan_masse?: Record<string, unknown> | null;
    plan_coupe?: Record<string, unknown> | null;
    plan_facade?: Record<string, unknown> | null;
    notice?: Record<string, unknown> | null;
    photo?: Record<string, unknown> | null;
    missing_elements?: string[];
    // Rétro-compat : les anciennes extractions stockaient des strings, le
    // pipeline actuel renvoie des objets { text, page?, bbox?, confidence? }.
    citations?: Array<string | { text?: string | null; page?: number | null }>;
    notes?: string | null;
  };
  type DossierPiece = {
    id: string;
    nom: string;
    url: string;
    type: string;
    taille: number;
    code_piece: string | null;
    analyse_ia: PieceAnalyse | null;
    extraction_ia: PieceExtractionLite | null;
    instructeur_status: "valide" | "rejete" | "complement_demande" | null;
    instructeur_note: string | null;
    instructeur_status_at: string | null;
    uploaded_at: string;
    // Statut du pipeline OCR — sert à signaler à l'instructeur qu'un
    // document est en cours de traitement ou que l'extraction a échoué
    // (sinon il croit que l'IA a "rien dit", alors qu'elle n'a rien pu lire).
    ocr_status?: "pending" | "processing" | "done" | "failed" | "skipped" | null;
  };
  const [documents, setDocuments] = useState<DossierPiece[] | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<number>(0);
  // Catégories repliées dans l'onglet Documents (3.C.4 — affinage suite à
  // dossiers avec 30+ pièces). Persisté entre les rerenders mais pas en
  // localStorage : c'est un état de session, l'instructeur déplie ce qu'il
  // veut regarder à un instant T sans contaminer ses autres dossiers.
  const [collapsedDocCategories, setCollapsedDocCategories] = useState<Set<string>>(new Set());
  const toggleDocCategory = useCallback((key: string) => {
    setCollapsedDocCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const [extractingPieceId, setExtractingPieceId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== "Instruction" || documents !== null) return;
    setDocumentsLoading(true);
    api.get<DossierPiece[]>(`/mairie/dossiers/${dossier.id}/pieces`)
      .then((data) => { setDocuments(data); setSelectedDoc(0); })
      .catch(() => setDocuments([]))
      .finally(() => setDocumentsLoading(false));
  }, [activeTab, documents, dossier.id]);

  const reExtractPiece = useCallback(async (pieceId: string) => {
    setExtractingPieceId(pieceId);
    try {
      const ext = await api.post<PieceExtractionLite>(`/mairie/dossiers/${dossier.id}/pieces/${pieceId}/extract`, {});
      setDocuments((arr) => arr ? arr.map((d) => d.id === pieceId ? { ...d, extraction_ia: ext } : d) : arr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Échec de l'extraction";
      alert(msg);
    } finally {
      setExtractingPieceId(null);
    }
  }, [dossier.id]);

  // ── Annotation instructeur (statut + note libre) ──
  const [annotatingPieceId, setAnnotatingPieceId] = useState<string | null>(null);
  const [annotationDrafts, setAnnotationDrafts] = useState<Record<string, string>>({});
  const setAnnotationDraft = useCallback((pieceId: string, value: string) => {
    setAnnotationDrafts((prev) => ({ ...prev, [pieceId]: value }));
  }, []);
  const sendAnnotation = useCallback(async (pieceId: string, body: { status?: "valide" | "rejete" | "complement_demande" | null; note?: string | null }) => {
    setAnnotatingPieceId(pieceId);
    try {
      const updated = await api.patch<DossierPiece>(`/mairie/dossiers/${dossier.id}/pieces/${pieceId}/annotation`, body);
      setDocuments((arr) => arr ? arr.map((d) => d.id === pieceId ? { ...d, ...updated } : d) : arr);
      setAnnotationDrafts((prev) => { const next = { ...prev }; delete next[pieceId]; return next; });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Échec de l'enregistrement";
      alert(msg);
    } finally {
      setAnnotatingPieceId(null);
    }
  }, [dossier.id]);

  // ── Chronologie : instruction events ──
  type InstructionEvent = {
    id: string;
    type: string;
    description: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
    actor_name: string | null;
    actor_role: string | null;
  };
  const [events, setEvents] = useState<InstructionEvent[] | null>(null);
  useEffect(() => {
    if (activeTab !== "Chronologie" || events !== null) return;
    api.get<InstructionEvent[]>(`/mairie/dossiers/${dossier.id}/events`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [activeTab, events, dossier.id]);

  // ── Conformité IA (rapport + lancement) ──
  type ConformiteReport = {
    schema_version: number;
    score_global: string;
    score_pct: number;
    pieces_attendues: number;
    pieces_deposees: number;
    pieces_manquantes: Array<{ code: string; nom: string }>;
    pieces_analyses: Array<{ piece_id: string; nom: string; code_piece: string | null; score: string; commentaire: string }>;
    alertes_reglementaires: string[];
    synthese: string;
    rule_verdicts: {
      verdicts: Array<{
        rule_id: string;
        topic: string;
        article: string | null;
        sub_theme: string | null;
        rule_text_short: string;
        verdict: "conforme" | "non_conforme" | "non_verifiable" | "applicable_conditionnel" | "non_applicable";
        raison: string;
        manquant: string | null;
        valeur_observee: { value: number; unit: string | null } | null;
        valeur_attendue: { min?: number | null; max?: number | null; exact?: number | null; unit?: string | null } | null;
        sources: Array<{ piece_id: string; piece_nom: string; citation: string }>;
        regulatory_sources?: Array<{
          segment_id: string;
          doc_type: string;
          doc_source_file: string | null;
          page: number | null;
          citation: string;
        }>;
      }>;
      counts: Record<string, number>;
      warnings: string[];
    } | null;
    warnings: string[];
    analyzed_at: string;
  };
  const [conformite, setConformite] = useState<{ status: string; report: ConformiteReport | null; analyzed_at: string | null } | null>(null);
  const [conformiteLaunching, setConformiteLaunching] = useState(false);

  // Conformité FINALE (3.C.5b) — déclenchée avant arrêté, considère
  // uniquement les pièces validées. Indépendante de l'interim ci-dessus.
  type ConformiteFinale = {
    status: string;
    report: ConformiteReport | null;
    analyzed_at: string | null;
    triggered_by: string | null;
  };
  type FinaleBlockers = {
    pieces_sans_statut: Array<{ id: string; nom: string; code_piece: string | null }>;
    pieces_complement_en_attente: Array<{ id: string; nom: string; code_piece: string | null }>;
    aucune_piece_validee: boolean;
  };
  const [conformiteFinale, setConformiteFinale] = useState<ConformiteFinale | null>(null);
  const [conformiteFinaleLaunching, setConformiteFinaleLaunching] = useState(false);
  const [finaleBlockers, setFinaleBlockers] = useState<{ reason: string; blockers: FinaleBlockers } | null>(null);

  useEffect(() => {
    if (activeTab !== "Conformité IA" || conformite !== null) return;
    api.get<{ status: string; report: ConformiteReport | null; analyzed_at: string | null }>(`/mairie/dossiers/${dossier.id}/conformite`)
      .then(setConformite)
      .catch(() => setConformite({ status: "absent", report: null, analyzed_at: null }));
  }, [activeTab, conformite, dossier.id]);

  // Charge la finale en parallèle de l'interim (1 GET en plus, OK).
  useEffect(() => {
    if (activeTab !== "Conformité IA" || conformiteFinale !== null) return;
    api.get<ConformiteFinale>(`/mairie/dossiers/${dossier.id}/conformite/finale`)
      .then(setConformiteFinale)
      .catch(() => setConformiteFinale({ status: "absent", report: null, analyzed_at: null, triggered_by: null }));
  }, [activeTab, conformiteFinale, dossier.id]);

  const launchConformite = useCallback(async () => {
    setConformiteLaunching(true);
    try {
      await api.post(`/mairie/dossiers/${dossier.id}/conformite/analyse`, { async: false }, { timeoutMs: 240_000 });
      const fresh = await api.get<{ status: string; report: ConformiteReport | null; analyzed_at: string | null }>(`/mairie/dossiers/${dossier.id}/conformite`);
      setConformite(fresh);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Échec du lancement";
      alert(msg);
    } finally {
      setConformiteLaunching(false);
    }
  }, [dossier.id]);

  const launchConformiteFinale = useCallback(async () => {
    setConformiteFinaleLaunching(true);
    setFinaleBlockers(null);
    try {
      await api.post(`/mairie/dossiers/${dossier.id}/conformite/finale`, {}, { timeoutMs: 240_000 });
      const fresh = await api.get<ConformiteFinale>(`/mairie/dossiers/${dossier.id}/conformite/finale`);
      setConformiteFinale(fresh);
    } catch (e) {
      // L'API renvoie 422 + payload { error, blockers } quand les pré-conditions
      // ne sont pas réunies (pièces sans statut, complément en attente, etc.).
      // On extrait via le message JSON-sérialisé du client api.
      const msg = e instanceof Error ? e.message : String(e);
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.blockers) {
          setFinaleBlockers({ reason: parsed.error ?? "Pré-conditions non réunies", blockers: parsed.blockers });
          return;
        }
      } catch { /* pas du JSON, on retombe sur alert */ }
      alert(msg);
    } finally {
      setConformiteFinaleLaunching(false);
    }
  }, [dossier.id]);

  // Documents thématiques de la commune (OAP, PPRI, …) avec leur synthèse.
  // Chargés à l'ouverture de l'onglet Instruction — c'est là qu'ils servent
  // de support à la confrontation pièces ↔ règlement.
  type CommuneDocLite = {
    id: string;
    type: string;
    name: string;
    original_filename: string;
    file_size: number | null;
    synthese: string | null;
    status: string;
    created_at: string;
  };
  const [communeDocs, setCommuneDocs] = useState<CommuneDocLite[] | null>(null);
  useEffect(() => {
    if (activeTab !== "Instruction" || communeDocs !== null) return;
    api.get<CommuneDocLite[]>(`/mairie/dossiers/${dossier.id}/commune-documents`)
      .then(setCommuneDocs)
      .catch(() => setCommuneDocs([]));
  }, [activeTab, communeDocs, dossier.id]);

  // Historique SITADEL/ADS — autorisations passées sur la parcelle.
  // Chargé à l'ouverture de l'onglet Terrain. `scope=parcel` filtre sur la
  // même section/numéro cadastral ; `scope=commune` ouvre à toute la commune
  // si la parcelle n'a aucun historique.
  type SitadelPermit = {
    num_dau: string;
    type_dau: string;
    type_label: string;
    etat: string;
    etat_code: string;
    date_autorisation: string | null;
    date_doc: string | null;
    date_daact: string | null;
    an_depot: number | null;
    adresse: string | null;
    superficie_terrain: number | null;
    cadastre: Array<{ section: string; numero: string }>;
    nature_projet: string | null;
    destination: string | null;
    nb_logements: number | null;
    surface_creee: number | null;
    source: "logements" | "locaux" | "amenager" | "demolir";
  };
  type SitadelHistory = {
    permits: SitadelPermit[];
    total: number;
    truncated: boolean;
    sources_consulted: string[];
    warnings: string[];
  };
  const [sitadelHistory, setSitadelHistory] = useState<SitadelHistory | null>(null);
  const [sitadelLoading, setSitadelLoading] = useState(false);
  const [sitadelScope, setSitadelScope] = useState<"parcel" | "commune">("parcel");
  const [sitadelError, setSitadelError] = useState<string | null>(null);
  useEffect(() => {
    if (activeTab !== "Terrain") return;
    // Sur changement de scope, on relance ; sinon on respecte le cache.
    if (sitadelHistory && sitadelHistory.permits.length >= 0 && !sitadelLoading) {
      // pas de relance si déjà chargé pour ce scope
    }
    setSitadelLoading(true);
    setSitadelError(null);
    api.get<SitadelHistory>(`/mairie/dossiers/${dossier.id}/sitadel-history?scope=${sitadelScope}`)
      .then((data) => setSitadelHistory(data))
      .catch((e) => setSitadelError(e instanceof Error ? e.message : "Indisponible"))
      .finally(() => setSitadelLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dossier.id, sitadelScope]);

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

  const typeLabel = TYPE_LABEL[liveType] ?? liveType;

  // ── Workflow d'instruction (statut + assignation) ──
  // Source de vérité côté serveur : la machine à états partagée. On reflète ici
  // les actions disponibles renvoyées par GET /mairie/dossiers/:id et on
  // rafraîchit après chaque mutation pour rester synchronisé.
  const [workflow, setWorkflow] = useState<WorkflowMeta | null>(dossier.workflow ?? null);
  const [currentStatus, setCurrentStatus] = useState<string>(dossier.status);
  const [currentInstructeur, setCurrentInstructeur] = useState<string | undefined>(dossier.instructeur);
  const [currentInstructeurId, setCurrentInstructeurId] = useState<string | undefined>(dossier.instructeur_id);
  const [instructeurOptions, setInstructeurOptions] = useState<Array<{ id: string; prenom: string; nom: string }>>([]);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [showAssignPicker, setShowAssignPicker] = useState(false);

  const instructeurName = currentInstructeur ?? "Non assigné";

  // Pré-charge les pièces + le rapport conformité quand on entre dans le mode
  // "Demande de pièces complémentaires" — sinon le sélecteur s'ouvrirait sur
  // une liste vide tant que l'instructeur n'a pas visité l'onglet Instruction.
  useEffect(() => {
    if (courrierMode !== "pieces_complementaires") return;
    if (documents === null && !documentsLoading) {
      setDocumentsLoading(true);
      api.get<DossierPiece[]>(`/mairie/dossiers/${dossier.id}/pieces`)
        .then((data) => setDocuments(data))
        .catch(() => setDocuments([]))
        .finally(() => setDocumentsLoading(false));
    }
    if (conformite === null) {
      api.get<{ status: string; report: ConformiteReport | null; analyzed_at: string | null }>(`/mairie/dossiers/${dossier.id}/conformite`)
        .then(setConformite)
        .catch(() => setConformite({ status: "absent", report: null, analyzed_at: null }));
    }
  }, [courrierMode, documents, documentsLoading, conformite, dossier.id]);

  const refreshWorkflow = useCallback(async () => {
    type ApiDetail = {
      status: string;
      instructeur_id: string | null;
      instructeur: { prenom?: string; nom?: string } | null;
      workflow?: WorkflowMeta;
    };
    try {
      const fresh = await api.get<ApiDetail>(`/mairie/dossiers/${dossier.id}`);
      setWorkflow(fresh.workflow ?? null);
      setCurrentStatus(fresh.status);
      setCurrentInstructeur(fresh.instructeur ? ([fresh.instructeur.prenom, fresh.instructeur.nom].filter(Boolean).join(" ") || undefined) : undefined);
      setCurrentInstructeurId(fresh.instructeur_id ?? undefined);
    } catch (e) {
      console.warn("Workflow refresh failed", e);
    }
  }, [dossier.id]);

  const ensureInstructeursLoaded = useCallback(async () => {
    if (instructeurOptions.length > 0) return;
    try {
      const list = await api.get<Array<{ id: string; prenom: string; nom: string }>>("/mairie/instructeurs");
      setInstructeurOptions(list);
    } catch (e) {
      console.warn("Instructeurs list failed", e);
    }
  }, [instructeurOptions.length]);

  const runWorkflowAction = useCallback(async (fn: () => Promise<unknown>) => {
    setWorkflowBusy(true);
    setWorkflowError(null);
    try {
      await fn();
      await refreshWorkflow();
    } catch (e) {
      setWorkflowError(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setWorkflowBusy(false);
    }
  }, [refreshWorkflow]);

  const handleTakeCharge = useCallback(() =>
    runWorkflowAction(() => api.post(`/mairie/dossiers/${dossier.id}/take-charge`, {})),
    [dossier.id, runWorkflowAction]);

  const handleTransition = useCallback((target: DossierStatus, reason?: string) =>
    runWorkflowAction(() => api.patch(`/mairie/dossiers/${dossier.id}/status`, { status: target, reason: reason ?? null })),
    [dossier.id, runWorkflowAction]);

  const handleAssign = useCallback((instructeurId: string) =>
    runWorkflowAction(async () => {
      await api.patch(`/mairie/dossiers/${dossier.id}/assign`, { instructeur_id: instructeurId });
      setShowAssignPicker(false);
    }),
    [dossier.id, runWorkflowAction]);

  const handleUnassign = useCallback(() =>
    runWorkflowAction(() => api.delete(`/mairie/dossiers/${dossier.id}/assign`)),
    [dossier.id, runWorkflowAction]);

  // Fallback si l'API ne renvoie pas encore le bloc workflow (ex. cache front).
  const nextAction = workflow?.next_action ?? primaryNextActionFor(currentStatus as DossierStatus);
  const allowedTransitions = workflow?.allowed_transitions ?? [];
  const canTakeCharge = workflow?.can_take_charge ?? false;
  const canReassign = workflow?.can_reassign ?? false;
  const canUnassign = workflow?.can_unassign ?? false;

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
            <button onClick={() => setCourrierMode("general")} style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "7px 15px", fontSize: 12.5, color: "#374151", cursor: "pointer", fontWeight: 500, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
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
          <div style={{ flex: 1, minWidth: 0, marginRight: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0F172A", margin: 0, letterSpacing: "-0.8px", lineHeight: 1 }}>{dossier.numero}</h1>
              <StatusBadge status={currentStatus} />
            </div>
            {(() => {
              const fullDesc = dossier.description ?? "";
              const shortDesc = fullDesc.length > 60 ? `${fullDesc.slice(0, 60).trimEnd()}…` : fullDesc;
              return (
                <div
                  title={fullDesc ? `${typeLabel} – ${fullDesc}` : typeLabel}
                  style={{ fontSize: 13, color: "#475569", fontWeight: 500, marginBottom: 8 }}
                >{typeLabel}{shortDesc ? ` – ${shortDesc}` : ""}</div>
              );
            })()}
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
              {(() => {
                const pp = parcelAnalysis?.parcel;
                const parcelleLabel = dossier.parcelle ?? (pp ? `${pp.section} ${pp.numero}` : null);
                return parcelleLabel ? (
                  <>
                    <span style={{ color: "#CBD5E1", fontSize: 12 }}>·</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#334155" }}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                      {parcelleLabel}
                    </span>
                  </>
                ) : null;
              })()}
              <span style={{ color: "#CBD5E1", fontSize: 12 }}>·</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#334155" }} title="Instructeur">
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="17 11 19 13 23 9" /></svg>
                <span style={{ fontWeight: 500, color: currentInstructeurId ? "#334155" : "#94a3b8" }}>{instructeurName}</span>
              </span>
            </div>
          </div>
          {/* right: date chips */}
          <div style={{ display: "flex", gap: 6, flexShrink: 0, marginTop: 2 }}>
            <div style={{ background: "#F8FAFC", border: "1px solid #E8EEF4", borderRadius: 10, padding: "8px 14px", textAlign: "center" as const, minWidth: 110 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 3 }}>Déposé le</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{dossier.date_depot ? fmtDate(dossier.date_depot) : "—"}</div>
            </div>
            <div
              style={{ background: "#F8FAFC", border: "1px solid #E8EEF4", borderRadius: 10, padding: "8px 14px", textAlign: "center" as const, minWidth: 110, cursor: dossier.delai ? "pointer" : "default", position: "relative" as const }}
              onClick={() => dossier.delai && setShowDelaiPopover((v) => !v)}
              title={dossier.delai ? `Délai légal : ${dossier.delai.total_mois} mois — cliquer pour détail` : undefined}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 3 }}>Échéance</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{dossier.echeance}</span>
                {daysLeft !== null && (
                  <span style={{ background: daysLeft < 14 ? "#FEF2F2" : "#EFF6FF", color: daysLeft < 14 ? "#DC2626" : "#2563EB", borderRadius: 5, padding: "1px 6px", fontSize: 11, fontWeight: 800, letterSpacing: "-0.2px" }}>
                    J{daysLeft >= 0 ? `-${daysLeft}` : `+${Math.abs(daysLeft)}`}
                  </span>
                )}
              </div>
              {showDelaiPopover && dossier.delai && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute" as const, top: "calc(100% + 6px)", right: 0, width: 360, background: "white", border: "1px solid #E2E8F0", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.12)", padding: 16, zIndex: 1100, textAlign: "left" as const }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Délai légal d'instruction</div>
                    <button onClick={() => setShowDelaiPopover(false)} style={{ border: "none", background: "transparent", fontSize: 16, cursor: "pointer", color: "#94a3b8", padding: 0 }}>✕</button>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 10, lineHeight: 1.5 }}>
                    Calculé à partir du {dossier.delai.base_date ? new Date(dossier.delai.base_date).toLocaleDateString("fr-FR") : "—"}
                    {dossier.delai.base_date_source && (
                      <span> ({dossier.delai.base_date_source === "completude" ? "date de complétude" : "date de dépôt"})</span>
                    )}
                  </div>
                  <div style={{ borderTop: "1px solid #F1F5F9", marginBottom: 6 }} />
                  {dossier.delai.breakdown.map((b, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: i < dossier.delai!.breakdown.length - 1 ? "1px dashed #F1F5F9" : "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: "#0F172A", fontWeight: 500 }}>{b.label}</div>
                        <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{linkifyArticles(b.article)}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5", flexShrink: 0, marginLeft: 8 }}>
                        {b.mois > 0 ? `+${b.mois}` : b.mois} mois
                      </div>
                    </div>
                  ))}
                  <div style={{ borderTop: "1px solid #F1F5F9", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A" }}>Total</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#4F46E5" }}>{dossier.delai.total_mois} mois</span>
                  </div>
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #F1F5F9", display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.04em" }}>DATE DE COMPLÉTUDE</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="date" defaultValue={dossier.date_completude ? dossier.date_completude.slice(0, 10) : ""}
                        onChange={(e) => setCompletudeDraft(e.target.value)}
                        style={{ flex: 1, border: "1px solid #D1D5DB", borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: "inherit" }} />
                      <button onClick={() => void saveCompletude()}
                        disabled={delaiSaving}
                        style={{ border: "none", background: delaiSaving ? "#C7D2FE" : "#4F46E5", color: "white", borderRadius: 6, padding: "5px 12px", fontSize: 11.5, fontWeight: 600, cursor: delaiSaving ? "default" : "pointer" }}>
                        Enregistrer
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Bandeau workflow d'instruction ── */}
        {/* CTA contextuel (prochaine étape attendue) + actions d'assignation.
            Le bloc se rétracte naturellement sur dossiers terminaux (accepté /
            refusé) où aucune action n'est plus attendue. */}
        {(nextAction || canTakeCharge || canReassign || canUnassign || workflowError) && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const,
            padding: "6px 12px", marginBottom: 10,
            background: "#FAFBFF",
            border: "1px solid #E8EBF7", borderRadius: 10,
          }}>
            {/* Côté gauche : action principale ─────────────────────────── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto", minWidth: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#4F46E5", letterSpacing: "0.06em", textTransform: "uppercase" as const, flexShrink: 0 }}>Prochaine étape</span>
              <span style={{ color: "#CBD5E1", fontSize: 12, flexShrink: 0 }}>·</span>
              <span style={{ fontSize: 12.5, color: "#1E293B", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const, minWidth: 0 }}>
                {nextAction
                  ? nextAction.hint
                  : (currentStatus === "decision_en_cours"
                    ? "L'arrêté est en circuit de signature."
                    : currentStatus === "brouillon"
                      ? "Le pétitionnaire n'a pas encore soumis le dossier."
                      : "Aucune action attendue à ce stade.")}
              </span>
            </div>

            {/* Côté droit : CTA + transitions secondaires + assignation ─── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" as const }}>
              {canTakeCharge && (
                <button
                  onClick={handleTakeCharge}
                  disabled={workflowBusy}
                  style={{
                    background: "#4F46E5", color: "white", border: "none",
                    borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600,
                    cursor: workflowBusy ? "default" : "pointer",
                    opacity: workflowBusy ? 0.7 : 1,
                  }}>
                  Prendre en charge
                </button>
              )}

              {nextAction && !canTakeCharge && (
                <button
                  onClick={() => handleTransition(nextAction.target_status)}
                  disabled={workflowBusy}
                  style={{
                    background: nextAction.variant === "success" ? "#16A34A"
                              : nextAction.variant === "warning" ? "#D97706"
                              : "#4F46E5",
                    color: "white", border: "none", borderRadius: 6, padding: "5px 11px",
                    fontSize: 12, fontWeight: 600, cursor: workflowBusy ? "default" : "pointer",
                    opacity: workflowBusy ? 0.7 : 1,
                  }}>
                  {nextAction.label}
                </button>
              )}

              {allowedTransitions.filter(s => s !== nextAction?.target_status).map(target => (
                <button
                  key={target}
                  onClick={() => handleTransition(target)}
                  disabled={workflowBusy}
                  title={`Passer en : ${DOSSIER_STATUS_LABELS[target]}`}
                  style={{
                    background: "transparent", color: "#64748b", border: "1px solid #E2E8F0",
                    borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 500,
                    cursor: workflowBusy ? "default" : "pointer", opacity: workflowBusy ? 0.6 : 1,
                  }}>
                  → {DOSSIER_STATUS_LABELS[target]}
                </button>
              ))}

              {/* Demande de pièces complémentaires : disponible pendant toute
                  la phase de complétude (pre_instruction / incomplet) et même
                  une fois passé à en_instruction si un complément est jugé
                  nécessaire au fond. */}
              {(["pre_instruction", "incomplet", "en_instruction"] as const).includes(currentStatus as "pre_instruction" | "incomplet" | "en_instruction") && (
                <button
                  onClick={() => setCourrierMode("pieces_complementaires")}
                  disabled={workflowBusy}
                  title="Construire et émettre une demande de pièces complémentaires"
                  style={{
                    background: "white", color: "#B45309", border: "1px solid #FDE68A",
                    borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600,
                    cursor: workflowBusy ? "default" : "pointer", display: "flex", alignItems: "center", gap: 5,
                  }}>
                  📎 Demander des pièces
                </button>
              )}

              {(canReassign || canUnassign) && (
                <div style={{ position: "relative" as const }}>
                  <button
                    onClick={() => { setShowAssignPicker(v => !v); if (!showAssignPicker) void ensureInstructeursLoaded(); }}
                    disabled={workflowBusy}
                    style={{
                      background: "transparent", color: "#64748b", border: "1px solid #E2E8F0",
                      borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 500, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                    }}>
                    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    {currentInstructeurId ? "Réassigner" : "Assigner"}
                  </button>
                  {showAssignPicker && (
                    <>
                      <div onClick={() => setShowAssignPicker(false)} style={{ position: "fixed", inset: 0, zIndex: 98 }} />
                      <div style={{
                        position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 99,
                        background: "white", border: "1px solid #E2E8F0", borderRadius: 10,
                        boxShadow: "0 10px 32px rgba(15,23,42,0.16)", minWidth: 240,
                        maxHeight: 320, overflowY: "auto" as const, padding: 4,
                      }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" as const, padding: "8px 12px 4px" }}>Choisir un instructeur</div>
                        {instructeurOptions.length === 0 ? (
                          <div style={{ padding: "10px 12px", fontSize: 12.5, color: "#94a3b8" }}>Chargement…</div>
                        ) : instructeurOptions.map(opt => {
                          const isCurrent = opt.id === currentInstructeurId;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => handleAssign(opt.id)}
                              disabled={workflowBusy || isCurrent}
                              style={{
                                display: "flex", alignItems: "center", gap: 8, width: "100%",
                                background: isCurrent ? "#F1F5F9" : "transparent", border: "none",
                                padding: "8px 12px", borderRadius: 8, fontSize: 13, color: "#0F172A",
                                cursor: isCurrent || workflowBusy ? "default" : "pointer", textAlign: "left" as const,
                              }}
                              onMouseEnter={e => { if (!isCurrent && !workflowBusy) e.currentTarget.style.background = "#F8FAFC"; }}
                              onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}>
                              <span style={{ flex: 1 }}>{opt.prenom} {opt.nom}</span>
                              {isCurrent && <span style={{ fontSize: 10.5, color: "#16A34A", fontWeight: 600 }}>en charge</span>}
                            </button>
                          );
                        })}
                        {canUnassign && (
                          <button
                            onClick={() => { setShowAssignPicker(false); void handleUnassign(); }}
                            disabled={workflowBusy}
                            style={{
                              display: "block", width: "100%", border: "none", background: "transparent",
                              color: "#B91C1C", fontSize: 12.5, padding: "8px 12px", borderTop: "1px solid #F1F5F9",
                              textAlign: "left" as const, cursor: workflowBusy ? "default" : "pointer", marginTop: 4,
                            }}>
                            Retirer l'instructeur
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {workflowError && (
              <div style={{ width: "100%", marginTop: 4, fontSize: 12, color: "#B91C1C" }}>{workflowError}</div>
            )}
          </div>
        )}

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
                  {(() => {
                    const pp = parcelAnalysis?.parcel;
                    const parcelleLabel = dossier.parcelle
                      ?? (pp ? `${pp.section} ${pp.numero}` : null)
                      ?? (parcelLoading ? "Identification…" : "—");
                    return [
                      ["Pétitionnaire", dossier.petitionnaire],
                      ["Adresse", liveAdresse ?? "—"],
                      ["Commune", `${liveCommune ?? "—"}${dossier.code_postal ? ` (${dossier.code_postal})` : ""}`],
                      ["Parcelle", parcelleLabel],
                      ["Surface de plancher", dossier.surface_plancher ? `${dossier.surface_plancher} m²` : "—"],
                      ["Date de dépôt", dossier.date_depot ? fmtDate(dossier.date_depot) : "—"],
                      ["Échéance", dossier.echeance],
                    ];
                  })().reduce<React.ReactNode[]>((acc, [l, v], idx) => {
                    acc.push(
                      <div key={l}>
                        <div style={LABEL_ST}>{l}</div>
                        <div style={VALUE_ST}>{v}</div>
                      </div>,
                    );
                    // Le type de dossier est inséré juste après le pétitionnaire,
                    // avec un éditeur inline qui appelle PATCH /mairie/dossiers/:id/type.
                    if (idx === 0) {
                      acc.push(
                        <div key="type-row">
                          <div style={{ ...LABEL_ST, display: "flex", alignItems: "center", gap: 8 }}>
                            <span>Type de dossier</span>
                            <button
                              onClick={() => setShowTypeEditor(v2 => !v2)}
                              disabled={typeSaving}
                              style={{
                                padding: "1px 6px", fontSize: 10,
                                color: showTypeEditor ? "#4F46E5" : "#94a3b8",
                                background: showTypeEditor ? "#EEF2FF" : "none",
                                border: "1px solid " + (showTypeEditor ? "#4F46E5" : "#E2E8F0"),
                                borderRadius: 4, cursor: typeSaving ? "wait" : "pointer", fontWeight: 500,
                              }}>
                              {showTypeEditor ? "Annuler" : "Modifier"}
                            </button>
                          </div>
                          {showTypeEditor ? (
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                              <select
                                defaultValue={liveType}
                                disabled={typeSaving}
                                onChange={(e) => { void saveType(e.target.value); }}
                                style={{
                                  flex: 1, padding: "7px 8px", border: "1px solid #E2E8F0",
                                  borderRadius: 8, fontSize: 12, background: "white",
                                }}>
                                {DOSSIER_TYPE_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                              {typeSaving && <span style={{ fontSize: 11, color: "#94a3b8" }}>Enregistrement…</span>}
                            </div>
                          ) : (
                            <div style={VALUE_ST}>{typeLabel}</div>
                          )}
                        </div>,
                      );
                    }
                    return acc;
                  }, [])}
                </div>
              </div>
              {/* Avancement */}
              <div style={{ ...CARD, display: "flex", flexDirection: "column" as const }}>
                <SecTitle>Avancement du dossier</SecTitle>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, justifyContent: "center" }}>
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
                </div>
              </div>
              {/* Mini map */}
              <div style={{ ...CARD, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" as const }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 8px", flexShrink: 0 }}>
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
                  <div style={{ flex: 1, minHeight: 200 }}>
                    <MapLeaflet dossiers={[{ id: dossier.id, numero: dossier.numero, type: dossier.type, status: dossier.status, adresse: liveAdresse ?? dossier.adresse, lat: rLat, lng: rLng }]} height="100%" commune={liveCommune ?? dossier.commune} />
                  </div>
                ) : (
                  <div style={{ flex: 1, minHeight: 200, background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 8 }}>
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
          </div>
        )}

        {/* ── PARCELLE ── */}
        {activeTab === "Terrain" && (() => {
          // Écran Terrain — contexte décisionnel.
          // Affiche le cadastre, les contraintes fortes (PLU/risques/SUP/prescriptions
          // surfaciques), une constructibilité synthétique, et l'historique SITADEL/ADS
          // de la parcelle. Le règlement détaillé et les PDF d'OAP/PPRI sont dans
          // l'onglet Instruction — c'est là que se fait la confrontation pièce ↔ règle.
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

          // CTA récurrent : tous les renvois vers le règlement complet, les
          // citations et les PDF d'OAP/PPRI pointent vers l'onglet Instruction.
          const goToInstruction = (docType?: string) => {
            setActiveTab("Instruction");
            if (docType) {
              setDocsViewMode("compare");
              setDocsRegulatoryDocTypeHint(docType);
              setDocsRegulatoryDocPage(null);
            }
          };
          const InstructionLink = ({ label, docType }: { label: string; docType?: string }) => (
            <button
              onClick={() => goToInstruction(docType)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#4F46E5", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              {label} →
            </button>
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

              {/* Renvoi global vers Instruction — règles complètes, PDF, citations */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "10px 16px", background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 10 }}>
                <div style={{ fontSize: 12, color: "#3730A3", lineHeight: 1.5 }}>
                  <strong style={{ fontWeight: 700 }}>Règlement, citations et PDF</strong> — l'espace de preuve et de comparaison est dans l'onglet Instruction.
                </div>
                <button
                  onClick={() => goToInstruction()}
                  style={{ flexShrink: 0, padding: "6px 14px", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 5px rgba(79,70,229,0.3)" }}
                >Ouvrir l'Instruction →</button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {/* ── Colonne gauche : contraintes + ABF + constructibilité ── */}
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
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
                        // Familles SUP (R.151-43 du Code de l'Urbanisme)
                        const supLabels: Record<string, string> = {
                          AC1: "Monuments Historiques — périmètre ABF",
                          AC2: "Sites classés / inscrits",
                          AC3: "Réserves naturelles",
                          AC4: "Parcs nationaux",
                          AS1: "Captage d'eau potable",
                          EL3: "Halage / marchepied",
                          EL7: "Ligne haute tension 63-225 kV",
                          EL11: "Ligne haute tension > 225 kV",
                          I1: "Canalisations d'hydrocarbures",
                          I3: "Canalisations de gaz",
                          I4: "Canalisations électriques",
                          PM1: "PPRI — risque inondation",
                          PM2: "PPRT — risque technologique",
                          PM3: "Risque mouvement de terrain",
                          PT1: "Télécommunications — protection",
                          PT2: "Télécommunications — émission/réception",
                          T1: "Voies ferrées",
                          T4: "Aérodromes — servitudes aéronautiques",
                          T5: "Servitudes aéronautiques de balisage",
                          T7: "Routes nationales",
                        };
                        const friendly = supLabels[s.categorie] ?? s.libelle ?? `SUP ${s.categorie}`;
                        const isABF = s.categorie?.startsWith("AC");
                        const valueRows: Array<[string, string]> = [];
                        if (s.nomsup) valueRows.push(["Élément protégé", s.nomsup]);
                        if (s.typeprotect && s.typeprotect !== s.nomsup) valueRows.push(["Type de protection", s.typeprotect]);
                        if (s.gestionnaire) valueRows.push(["Gestionnaire", s.gestionnaire]);
                        if (s.datdecr) valueRows.push(["Acte de protection", s.datdecr]);
                        if (s.ref_acte) valueRows.push(["Référence", s.ref_acte]);
                        return (
                          <div key={i} style={{ padding: "12px 14px", background: isABF ? "#FFFBEB" : "#F0F9FF", borderRadius: 9, border: `1px solid ${isABF ? "#FDE68A" : "#BAE6FD"}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: valueRows.length > 0 ? 8 : 0 }}>
                              <span style={{ fontSize: 16, flexShrink: 0 }}>{isABF ? "⚜️" : "📜"}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: isABF ? "#92400E" : "#0C4A6E" }}>{friendly}</div>
                              </div>
                            </div>
                            {valueRows.length > 0 && (
                              <div style={{ display: "flex", flexDirection: "column" as const, gap: 4, marginLeft: 26 }}>
                                {valueRows.map(([label, value]) => (
                                  <div key={label} style={{ display: "flex", gap: 8, fontSize: 11.5, lineHeight: 1.5 }}>
                                    <span style={{ color: isABF ? "#B45309" : "#0369A1", flexShrink: 0, minWidth: 130 }}>{label}</span>
                                    <span style={{ color: isABF ? "#7C2D12" : "#0F172A", fontWeight: 500 }}>{value}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {s.dessup && (
                              <div style={{ marginLeft: 26, marginTop: 6, fontSize: 11.5, color: isABF ? "#7C2D12" : "#0F172A", lineHeight: 1.55, fontStyle: "italic" }}>
                                {s.dessup}
                              </div>
                            )}
                            <div style={{ marginLeft: 26, marginTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" as const }}>
                              {s.urlacte && (
                                <a href={s.urlacte} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#4F46E5", fontWeight: 600 }}>
                                  Voir l'acte officiel ↗
                                </a>
                              )}
                              {/* Toute citation du règlement ou du PDF passe par Instruction. */}
                              <InstructionLink
                                label="Confronter aux pièces dans Instruction"
                                docType={s.categorie?.startsWith("PM1") ? "ppri" : s.categorie?.startsWith("PM2") ? "pprt" : undefined}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {/* Prescriptions surfaciques PLU */}
                      {pa?.prescriptions && pa.prescriptions.length > 0 && pa.prescriptions.map((p, i) => {
                        // typepsc — CNIG schema PLU (référentiel prescriptions surfaciques)
                        const pscLabels: Record<string, { titre: string; icon: string }> = {
                          "01": { titre: "Espace Boisé Classé (EBC)", icon: "🌳" },
                          "02": { titre: "Élément paysager / patrimonial à protéger", icon: "🏛️" },
                          "03": { titre: "Terrain cultivé en zone urbaine", icon: "🌾" },
                          "04": { titre: "Emplacement réservé", icon: "📍" },
                          "05": { titre: "Plantations à réaliser ou à conserver", icon: "🌱" },
                          "06": { titre: "Voie / emprise réservée", icon: "🛣️" },
                          "07": { titre: "Continuités écologiques", icon: "🦋" },
                          "08": { titre: "Bâtiment à conserver", icon: "🏠" },
                          "09": { titre: "Périmètre à risque", icon: "⚠️" },
                          "10": { titre: "Zone non aedificandi (inconstructible)", icon: "🚫" },
                          "11": { titre: "Zone d'Aménagement Concerté (ZAC)", icon: "🏗️" },
                          "12": { titre: "Périmètre de constructibilité limitée", icon: "⛔" },
                          "13": { titre: "Périmètre d'attente de projet (PAPA)", icon: "⏳" },
                          "14": { titre: "Mixité sociale", icon: "🏘️" },
                          "15": { titre: "Mixité fonctionnelle", icon: "🏢" },
                          "16": { titre: "Diversité commerciale (linéaires)", icon: "🛍️" },
                          "17": { titre: "Performance énergétique", icon: "🔋" },
                          "18": { titre: "Orientation d'Aménagement et de Programmation (OAP)", icon: "📐" },
                          "19": { titre: "Zone humide", icon: "💧" },
                          "30": { titre: "Hauteur — secteur de gabarit", icon: "📏" },
                          "39": { titre: "Hauteur maximale", icon: "📐" },
                          "40": { titre: "Stationnement — secteur de norme", icon: "🅿️" },
                          "44": { titre: "Stationnement — exigences spécifiques", icon: "🅿️" },
                        };
                        const def = pscLabels[p.typepsc] ?? { titre: "Prescription PLU", icon: "📋" };
                        const title = p.libelle || def.titre;
                        return (
                          <div key={i} style={{ padding: "12px 14px", background: "#F0FDF4", borderRadius: 9, border: "1px solid #BBF7D0" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: p.txtpsc ? 8 : 0 }}>
                              <span style={{ fontSize: 16, flexShrink: 0 }}>{def.icon}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#14532D" }}>{title}</div>
                              </div>
                            </div>
                            {p.txtpsc ? (
                              <div style={{ marginLeft: 26, fontSize: 11.5, color: "#14532D", lineHeight: 1.55, whiteSpace: "pre-wrap" as const }}>
                                {p.txtpsc}
                              </div>
                            ) : (
                              <div style={{ marginLeft: 26, fontSize: 11, color: "#15803D", fontStyle: "italic" }}>
                                Texte réglementaire non publié dans le GPU — se référer au règlement de zone.
                              </div>
                            )}
                            <div style={{ marginLeft: 26, marginTop: 6 }}>
                              <InstructionLink
                                label="Voir le règlement applicable dans Instruction"
                                docType={p.typepsc === "18" ? "oap" : p.typepsc === "09" ? "ppri" : "plu"}
                              />
                            </div>
                          </div>
                        );
                      })}
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

                  {/* Synthèse zone PLU — pointeur seulement, le règlement complet vit dans Instruction */}
                  <div style={CARD}>
                    <SecTitle action={<InstructionLink label="Règlement complet" docType="plu" />}>
                      Zone PLU
                    </SecTitle>
                    {(() => {
                      const zc = pa?.plu_zone ?? (pa?.db_zone ? { zone_code: pa.db_zone.code, zone_label: pa.db_zone.label ?? pa.db_zone.code, zone_type: pa.db_zone.type ?? "U" } : null);
                      if (!zc) {
                        return (
                          <div style={{ fontSize: 12.5, color: "#94a3b8", padding: "8px 0" }}>
                            Zone PLU non identifiée — voir les contraintes ci-contre.
                          </div>
                        );
                      }
                      const ruleCount = pa?.rules?.filter((r) => r.relevance !== "excluded").length ?? 0;
                      return (
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                            {zc.zone_code}
                          </div>
                          <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.5, marginBottom: 12 }}>
                            {zc.zone_label}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                            {ruleCount > 0 && (
                              <span style={{ fontSize: 11.5, fontWeight: 600, color: "#4F46E5", background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 6, padding: "3px 9px" }}>
                                {ruleCount} article{ruleCount > 1 ? "s" : ""} indexé{ruleCount > 1 ? "s" : ""}
                              </span>
                            )}
                            <button
                              onClick={() => goToInstruction("plu")}
                              style={{ fontSize: 11.5, fontWeight: 600, color: "#3730A3", background: "white", border: "1px solid #C7D2FE", borderRadius: 6, padding: "3px 9px", cursor: "pointer" }}
                            >
                              Confronter aux pièces →
                            </button>
                          </div>
                          {pa?.plu_zone?.plu_nom && (
                            <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
                              Source GPU : {pa.plu_zone.plu_nom}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Historique SITADEL/ADS — autorisations passées sur la parcelle/commune */}
                  <div style={CARD}>
                    <SecTitle
                      action={
                        <div style={{ display: "inline-flex", border: "1px solid #E2E8F0", borderRadius: 7, overflow: "hidden", background: "white" }}>
                          {(["parcel", "commune"] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => { setSitadelScope(s); setSitadelHistory(null); }}
                              style={{
                                padding: "4px 11px",
                                background: sitadelScope === s ? "#4F46E5" : "white",
                                color: sitadelScope === s ? "white" : "#475569",
                                border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer",
                              }}
                            >{s === "parcel" ? "Parcelle" : "Commune"}</button>
                          ))}
                        </div>
                      }
                    >Historique SITADEL/ADS</SecTitle>
                    <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 12, marginTop: -10, lineHeight: 1.5 }}>
                      Autorisations d'urbanisme délivrées par le passé (PC, DP, PA, PD) — source : base ouverte SITADEL (SDES, data.gouv.fr).
                    </div>
                    {sitadelLoading ? (
                      <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0" }}>Chargement…</div>
                    ) : sitadelError ? (
                      <div style={{ fontSize: 12, color: "#991B1B", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 10px" }}>
                        Historique indisponible : {sitadelError}
                      </div>
                    ) : !sitadelHistory || sitadelHistory.permits.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#64748b", padding: "8px 0", lineHeight: 1.5 }}>
                        Aucun permis trouvé dans SITADEL pour cette {sitadelScope === "parcel" ? "parcelle" : "commune"} depuis 2013.
                        {sitadelScope === "parcel" && (
                          <button
                            onClick={() => { setSitadelScope("commune"); setSitadelHistory(null); }}
                            style={{ marginLeft: 6, fontSize: 12, color: "#4F46E5", background: "none", border: "none", fontWeight: 600, cursor: "pointer", padding: 0 }}
                          >Élargir à la commune →</button>
                        )}
                      </div>
                    ) : (() => {
                      const typeColor: Record<string, { c: string; bg: string }> = {
                        PC: { c: "#4F46E5", bg: "#EEF2FF" },
                        DP: { c: "#15803D", bg: "#F0FDF4" },
                        PA: { c: "#C2410C", bg: "#FFF7ED" },
                        PD: { c: "#DC2626", bg: "#FEF2F2" },
                      };
                      const etatColor: Record<string, string> = {
                        "3": "#15803D", "5": "#15803D", "6": "#15803D",
                        "4": "#DC2626", "7": "#DC2626", "8": "#94A3B8",
                      };
                      return (
                        <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                          {sitadelHistory.permits.slice(0, 8).map((p) => {
                            const tc = typeColor[p.type_dau] ?? { c: "#64748B", bg: "#F1F5F9" };
                            const ec = etatColor[p.etat_code] ?? "#64748B";
                            const date = p.date_autorisation
                              ? new Date(p.date_autorisation).toLocaleDateString("fr-FR")
                              : p.an_depot ? `Déposé ${p.an_depot}` : "—";
                            return (
                              <div key={`${p.source}-${p.num_dau}`} style={{ padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 9, background: "#FAFBFC" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: tc.c, background: tc.bg, borderRadius: 5, padding: "2px 7px", letterSpacing: "0.04em" }}>{p.type_dau}</span>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                                    {p.num_dau}
                                  </span>
                                  <span style={{ fontSize: 11, color: "#64748b", flexShrink: 0 }}>{date}</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#475569", flexWrap: "wrap" as const }}>
                                  <span style={{ color: ec, fontWeight: 600 }}>{p.etat || "—"}</span>
                                  {p.cadastre.length > 0 && (
                                    <>
                                      <span style={{ color: "#CBD5E1" }}>·</span>
                                      <span>{p.cadastre.map((c) => `${c.section} ${c.numero}`).join(", ")}</span>
                                    </>
                                  )}
                                  {p.nb_logements != null && p.nb_logements > 0 && (
                                    <>
                                      <span style={{ color: "#CBD5E1" }}>·</span>
                                      <span>{p.nb_logements} lgt</span>
                                    </>
                                  )}
                                  {p.surface_creee != null && p.surface_creee > 0 && (
                                    <>
                                      <span style={{ color: "#CBD5E1" }}>·</span>
                                      <span>{Math.round(p.surface_creee)} m²</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {sitadelHistory.total > 8 && (
                            <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" as const, paddingTop: 4 }}>
                              {sitadelHistory.total - 8} autres autorisations non affichées.
                            </div>
                          )}
                          {sitadelHistory.warnings.length > 0 && (
                            <div style={{ fontSize: 10.5, color: "#92400E", marginTop: 4, fontStyle: "italic" }}>
                              ⚠ {sitadelHistory.warnings.join(", ")}
                            </div>
                          )}
                        </div>
                      );
                    })()}
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
          <>
            {/* Bloc Analyse finale avant arrêté (3.C.5c) — affiché en tête
                de l'onglet pour que l'instructeur sache à tout moment où il
                en est sur cette étape juridique. */}
            <div style={{ marginBottom: 16, padding: 16, borderRadius: 12, border: "1.5px solid #C7D2FE", background: "linear-gradient(135deg, #F5F3FF 0%, #EFF6FF 100%)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" as const }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#4F46E5", letterSpacing: "0.05em", textTransform: "uppercase" as const, marginBottom: 4 }}>
                    🛡 Analyse finale avant arrêté
                  </div>
                  {conformiteFinale?.status === "done" && conformiteFinale.analyzed_at ? (
                    <div style={{ fontSize: 12.5, color: "#312E81", lineHeight: 1.5 }}>
                      Effectuée le <strong>{new Date(conformiteFinale.analyzed_at).toLocaleString("fr-FR")}</strong>.
                      Cette analyse ne prend en compte que les pièces explicitement <strong>validées</strong> par l'instructeur, et sert d'ancrage juridique à la décision.
                    </div>
                  ) : conformiteFinale?.status === "failed" ? (
                    <div style={{ fontSize: 12.5, color: "#DC2626", lineHeight: 1.5 }}>
                      Une tentative précédente a échoué. Relance possible une fois les pièces examinées.
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: "#312E81", lineHeight: 1.5 }}>
                      À déclencher juste avant la délivrance de l'arrêté.
                      L'analyse ne prendra en compte <strong>que les pièces validées</strong> (les pièces sans statut ou en complément demandé bloquent le lancement).
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void launchConformiteFinale()}
                  disabled={conformiteFinaleLaunching}
                  style={{
                    background: conformiteFinaleLaunching ? "#C7D2FE" : "#4F46E5",
                    color: "white",
                    border: "none",
                    borderRadius: 9,
                    padding: "9px 16px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: conformiteFinaleLaunching ? "default" : "pointer",
                    boxShadow: "0 2px 6px rgba(79,70,229,0.25)",
                    whiteSpace: "nowrap" as const,
                  }}
                >
                  {conformiteFinaleLaunching
                    ? "Analyse en cours…"
                    : conformiteFinale?.status === "done"
                      ? "↻ Relancer l'analyse finale"
                      : "Lancer l'analyse finale"}
                </button>
              </div>
              {finaleBlockers && (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 9, background: "#FEF2F2", border: "1px solid #FECACA" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#991B1B", marginBottom: 6 }}>
                    ⚠ {finaleBlockers.reason}
                  </div>
                  {finaleBlockers.blockers.pieces_sans_statut.length > 0 && (
                    <div style={{ fontSize: 12, color: "#7F1D1D", marginBottom: 4 }}>
                      <strong>{finaleBlockers.blockers.pieces_sans_statut.length} pièce(s) à examiner :</strong>{" "}
                      {finaleBlockers.blockers.pieces_sans_statut.slice(0, 5).map((p) => p.code_piece || p.nom).join(", ")}
                      {finaleBlockers.blockers.pieces_sans_statut.length > 5 && ` (+${finaleBlockers.blockers.pieces_sans_statut.length - 5} autres)`}
                    </div>
                  )}
                  {finaleBlockers.blockers.pieces_complement_en_attente.length > 0 && (
                    <div style={{ fontSize: 12, color: "#7F1D1D", marginBottom: 4 }}>
                      <strong>{finaleBlockers.blockers.pieces_complement_en_attente.length} complément(s) en attente :</strong>{" "}
                      {finaleBlockers.blockers.pieces_complement_en_attente.slice(0, 5).map((p) => p.code_piece || p.nom).join(", ")}
                    </div>
                  )}
                  {finaleBlockers.blockers.aucune_piece_validee && (
                    <div style={{ fontSize: 12, color: "#7F1D1D" }}>
                      Aucune pièce n'a encore été validée. Au moins une validation explicite est requise.
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "#991B1B", marginTop: 6, fontStyle: "italic" as const }}>
                    Statue les pièces concernées dans l'onglet Documents, puis relance.
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginBottom: 20 }}>
              <RegulatoryChecklist dossierId={dossier.id} onJumpToCitation={jumpFromCitation} />
            </div>
          </>
        )}
        {activeTab === "Conformité IA" && (() => {
          const report = conformite?.report ?? null;
          const status = conformite?.status ?? "absent";
          const verdicts = report?.rule_verdicts?.verdicts ?? [];
          const counts = report?.rule_verdicts?.counts ?? null;
          const verdictMeta: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
            conforme: { label: "Conforme", color: "#15803D", bg: "#F0FDF4", border: "#BBF7D0", icon: "✅" },
            non_conforme: { label: "Non conforme", color: "#DC2626", bg: "#FEE2E2", border: "#FECACA", icon: "❌" },
            non_verifiable: { label: "Non vérifiable", color: "#475569", bg: "#F8FAFC", border: "#E2E8F0", icon: "❓" },
            applicable_conditionnel: { label: "Selon projet", color: "#92400E", bg: "#FEF3C7", border: "#FDE68A", icon: "📌" },
            non_applicable: { label: "Non applicable", color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0", icon: "—" },
          };
          const launchButton = (
            <button
              onClick={() => void launchConformite()}
              disabled={conformiteLaunching || status === "running"}
              style={{
                padding: "9px 18px",
                background: conformiteLaunching || status === "running" ? "#C7D2FE" : "linear-gradient(135deg,#4F46E5,#6366F1)",
                color: "white", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 600,
                cursor: conformiteLaunching || status === "running" ? "default" : "pointer",
                boxShadow: "0 2px 6px rgba(79,70,229,0.3)",
              }}>
              {conformiteLaunching ? "Analyse en cours…" : report ? "Relancer l'analyse" : "Lancer l'analyse"}
            </button>
          );

          if (!report) {
            return (
              <div style={CARD}>
                <div style={{ textAlign: "center" as const, padding: "32px 20px", color: "#64748b" }}>
                  <div style={{ fontSize: 44, marginBottom: 12 }}>🔍</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
                    Conformité IA non encore lancée
                  </div>
                  <p style={{ fontSize: 13, maxWidth: 520, margin: "0 auto 16px", lineHeight: 1.55 }}>
                    L'analyse croise les <strong>extractions des pièces déposées</strong> avec les <strong>règles PLU</strong> de la zone
                    {liveCommune ? ` (${liveCommune})` : ""} et les <strong>synthèses des documents commune</strong> (OAP, PPRI…).
                    Elle peut prendre 1 à 3 minutes selon le nombre de pièces.
                  </p>
                  {launchButton}
                </div>
              </div>
            );
          }

          return (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
              {/* Header — synthèse + bouton */}
              <div style={CARD}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Synthèse</div>
                    <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.55, maxWidth: 760 }}>{report.synthese}</div>
                    {report.analyzed_at && (
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                        Analyse du {new Date(report.analyzed_at).toLocaleString("fr-FR")}
                      </div>
                    )}
                  </div>
                  {launchButton}
                </div>
                {counts && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 8 }}>
                    {(["conforme", "non_conforme", "non_verifiable", "applicable_conditionnel", "non_applicable"] as const).map((k) => {
                      const meta = verdictMeta[k]!;
                      const n = counts[k] ?? 0;
                      if (n === 0) return null;
                      return (
                        <span key={k} style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, borderRadius: 8, padding: "4px 11px", fontSize: 12, fontWeight: 600 }}>
                          {meta.icon} {n} {meta.label.toLowerCase()}
                        </span>
                      );
                    })}
                  </div>
                )}
                {report.warnings.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 11.5, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", lineHeight: 1.5 }}>
                    <strong>Avertissements :</strong> {report.warnings.join(" · ")}
                  </div>
                )}
              </div>

              {/* Verdicts par règle */}
              <div style={CARD}>
                <SecTitle>Verdicts règle par règle</SecTitle>
                {verdicts.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "#64748b", padding: "8px 0" }}>
                    Aucun verdict produit — soit aucune règle PLU n'est indexée pour cette zone, soit aucune pièce n'a encore d'extraction structurée.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                    {verdicts.map((v) => {
                      const meta = verdictMeta[v.verdict] ?? verdictMeta.non_verifiable!;
                      const observed = v.valeur_observee ? `${v.valeur_observee.value}${v.valeur_observee.unit ?? ""}` : null;
                      const expected = v.valeur_attendue ? [
                        v.valeur_attendue.exact != null ? `= ${v.valeur_attendue.exact}` : null,
                        v.valeur_attendue.min != null ? `≥ ${v.valeur_attendue.min}` : null,
                        v.valeur_attendue.max != null ? `≤ ${v.valeur_attendue.max}` : null,
                      ].filter(Boolean).join(", ") + (v.valeur_attendue.unit ?? "") : null;
                      return (
                        <div key={v.rule_id} style={{ padding: "12px 14px", border: `1px solid ${meta.border}`, background: meta.bg, borderRadius: 9 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" as const }}>
                            <span style={{ fontSize: 16 }}>{meta.icon}</span>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: meta.color, background: "white", border: `1px solid ${meta.border}`, borderRadius: 6, padding: "1px 8px" }}>
                              {meta.label}
                            </span>
                            {v.article && <span style={{ fontSize: 11.5, fontWeight: 600, color: "#475569" }}>{linkifyArticles(v.article)}</span>}
                            {v.sub_theme && <span style={{ fontSize: 11.5, color: "#64748b" }}>· {v.sub_theme}</span>}
                          </div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>
                            {v.rule_text_short}
                          </div>
                          <div style={{ fontSize: 12, color: meta.color, lineHeight: 1.55 }}>
                            {v.raison}
                          </div>
                          {(observed || expected) && (
                            <div style={{ marginTop: 6, display: "flex", gap: 14, fontSize: 11.5, color: "#374151", flexWrap: "wrap" as const }}>
                              {observed && (
                                <span><span style={{ color: "#94a3b8" }}>Observé :</span> <strong>{observed}</strong></span>
                              )}
                              {expected && (
                                <span><span style={{ color: "#94a3b8" }}>Attendu :</span> <strong>{expected}</strong></span>
                              )}
                            </div>
                          )}
                          {v.manquant && (
                            <div style={{ marginTop: 6, fontSize: 11.5, color: "#475569", fontStyle: "italic" }}>
                              Manquant pour trancher : {v.manquant}
                            </div>
                          )}
                          {v.sources.length > 0 && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${meta.border}` }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", letterSpacing: "0.04em", marginBottom: 4 }}>SOURCES — PIÈCES DU DOSSIER</div>
                              {v.sources.map((s, i) => (
                                <div key={i} style={{ fontSize: 11.5, color: "#374151", lineHeight: 1.55 }}>
                                  📎 <strong>{s.piece_nom}</strong> — « {s.citation} »
                                </div>
                              ))}
                            </div>
                          )}
                          {(v.regulatory_sources?.length ?? 0) > 0 && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${meta.border}` }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", letterSpacing: "0.04em", marginBottom: 4 }}>
                                SOURCES — RÉGLEMENTATION (PASSAGES VÉRIFIÉS)
                              </div>
                              {v.regulatory_sources!.map((s, i) => {
                                const pageLabel = s.page != null ? `, p. ${s.page}` : "";
                                const fileLabel = s.doc_source_file ? ` · ${s.doc_source_file}` : "";
                                return (
                                  <div key={i} style={{ fontSize: 11.5, color: "#374151", lineHeight: 1.55, marginBottom: i === v.regulatory_sources!.length - 1 ? 0 : 4 }}>
                                    <span style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", color: "#4338CA", borderRadius: 5, padding: "1px 7px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.02em", marginRight: 6 }}>
                                      📑 {s.doc_type}{pageLabel}
                                    </span>
                                    « {s.citation} »
                                    {fileLabel && <span style={{ fontSize: 10.5, color: "#94a3b8", marginLeft: 4 }}>{fileLabel}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pièces manquantes */}
              {report.pieces_manquantes.length > 0 && (
                <div style={CARD}>
                  <SecTitle>Pièces manquantes</SecTitle>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#374151", lineHeight: 1.6 }}>
                    {report.pieces_manquantes.map((p) => (
                      <li key={p.code}><strong>{p.code}</strong> — {p.nom}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── DOCUMENTS ── */}
        {activeTab === "Instruction" && (() => {
          const docs = documents ?? [];
          const sel = docs[selectedDoc] ?? null;

          // ── Regroupement des pièces par catégorie (3.C.4) ────────────────
          // Les pièces déposées partagent un préfixe de code (PC1, PC2,
          // DP-ABF-NDA, etc.) qui dit à quelle pièce du Cerfa elles
          // correspondent. On les groupe par catégorie pour que
          // l'instructeur ait un panneau lisible : "PC2 — Plan de masse"
          // regroupe les versions successives + un éventuel complément.
          // L'index original dans le tableau plat `docs` est mémorisé pour
          // que `setSelectedDoc(i)` continue de fonctionner avec la même
          // sémantique.
          const PIECE_CATEGORIES: Array<{ key: string; label: string; codes: string[] }> = [
            { key: "cerfa", label: "Formulaire CERFA",                       codes: ["CERFA"] },
            { key: "pc1",   label: "PC1 · Plan de situation",                codes: ["PC1", "DP1", "PD1", "CU1"] },
            { key: "pc2",   label: "PC2 · Plan de masse",                    codes: ["PC2", "DP2", "PD2"] },
            { key: "pc3",   label: "PC3 · Plan en coupe",                    codes: ["PC3", "DP3"] },
            { key: "pc4",   label: "PC4 · Notice descriptive",               codes: ["PC4", "DP4", "PD4"] },
            { key: "pc5",   label: "PC5 · Plans façades & toitures",         codes: ["PC5"] },
            { key: "pc6",   label: "PC6 · Insertion paysagère",              codes: ["PC6", "DP6"] },
            { key: "pc7",   label: "PC7 · Photographies de situation",       codes: ["PC7", "DP7"] },
            { key: "pc8",   label: "PC8 · Photographie environnement large", codes: ["PC8"] },
            { key: "pc9",   label: "PC9 · Document graphique d'insertion",   codes: ["PC9"] },
            { key: "abf",   label: "ABF · Notice & avis",                    codes: ["DP-ABF-NDA", "DP-ABF-FTM", "PCABF"] },
            { key: "annexe",label: "Annexes",                                codes: ["ANNEXE"] },
            { key: "other", label: "Autres",                                 codes: [] },
          ];

          type GroupedItem = { doc: DossierPiece; origIndex: number };
          const buckets = new Map<string, GroupedItem[]>();
          PIECE_CATEGORIES.forEach((c) => buckets.set(c.key, []));

          // Quand code_piece n'est pas peuplé (dépôt en annexe libre ou
          // upload citoyen avant la généralisation des slots), on tente
          // d'extraire un code depuis le nom du fichier. C'est ce qui
          // permet de remettre PC2a.pdf dans la rubrique PC2 plutôt que
          // dans Autres.
          const extractCodeFromName = (nom: string): string => {
            // "PC2", "PC2a", "PCMI 04", "DP3", "PD-4"…
            const m = nom.match(/^(PC|DP|PD|CU|PCMI|DPMI)\s*0*(\d+)/i);
            if (m) {
              const prefix = m[1]!.toUpperCase().replace(/MI$/, "");
              return `${prefix}${m[2]}`;
            }
            if (/^Annexe\s/i.test(nom)) return "ANNEXE";
            if (/^cerfa[\s_-]/i.test(nom)) return "CERFA";
            return "";
          };

          docs.forEach((doc, i) => {
            const codeBase = (doc.code_piece ?? "").toUpperCase();
            const code = codeBase || extractCodeFromName(doc.nom);
            // Premier prefix qui matche, "other" si rien.
            const matched = PIECE_CATEGORIES.find((c) => c.codes.length > 0 && c.codes.some((p) => code.startsWith(p)));
            buckets.get(matched?.key ?? "other")!.push({ doc, origIndex: i });
          });

          // Tri intra-groupe : statut d'instructeur (à examiner avant),
          // puis date de dépôt décroissante (dernière version en haut).
          const statusOrder: Record<string, number> = { "": 0, complement_demande: 1, valide: 2, rejete: 3 };
          buckets.forEach((arr) => arr.sort((a, b) => {
            const sa = statusOrder[a.doc.instructeur_status ?? ""] ?? 99;
            const sb = statusOrder[b.doc.instructeur_status ?? ""] ?? 99;
            if (sa !== sb) return sa - sb;
            return new Date(b.doc.uploaded_at).getTime() - new Date(a.doc.uploaded_at).getTime();
          }));

          const grouped = PIECE_CATEGORIES
            .map((c) => ({ key: c.key, label: c.label, items: buckets.get(c.key) ?? [] }))
            .filter((g) => g.items.length > 0);
          const fmtSize = (n: number) => n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / (1024 * 1024)).toFixed(1)} Mo`;
          const fmtUploaded = (iso: string) => {
            const d = new Date(iso);
            return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
          };
          const extOf = (type: string, nom: string) => {
            const fromName = nom.split(".").pop();
            if (fromName && fromName.length <= 5 && fromName !== nom) return fromName.toUpperCase();
            if (type.includes("pdf")) return "PDF";
            if (type.includes("zip")) return "ZIP";
            if (type.includes("image")) return type.split("/")[1]?.toUpperCase() ?? "IMG";
            return "FICHIER";
          };
          const scoreToStatus = (s?: string) => {
            if (s === "conforme") return { label: "Document exploitable", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" };
            if (s === "acceptable") return { label: "Exploitable avec réserves", bg: "#FEF9C3", color: "#854D0E", border: "#FDE68A" };
            if (s === "incomplet") return { label: "À compléter", bg: "#FEF3C7", color: "#92400E", border: "#FDE68A" };
            if (s === "non_conforme") return { label: "À reprendre", bg: "#FEE2E2", color: "#DC2626", border: "#FECACA" };
            return { label: "Déposé", bg: "#EFF6FF", color: "#1D4ED8", border: "#BFDBFE" };
          };

          // Sélecteur de mode d'affichage — persisté par instructeur.
          // apercu  : 3 colonnes historiques · compare : pièce ↔ doc règlementaire (split)
          // lecture : pièce plein écran, panneaux escamotés en bandes
          // Un bandeau passe en bande escamotée soit en mode Lecture (les deux),
          // soit quand l'instructeur l'a explicitement replié (n'importe quel mode).
          const leftIsStripe = docsViewMode === "lecture" || docsLeftCollapsed;
          const rightIsStripe = docsViewMode === "lecture" || docsRightCollapsed;
          const leftW = leftIsStripe ? "44px" : (docsViewMode === "compare" ? "240px" : "280px");
          const rightW = rightIsStripe ? "44px" : "260px";
          const gridTemplate = `${leftW} 1fr ${rightW}`;
          // Déplier un bandeau : si on était en Lecture, on en sort en gardant
          // l'autre bandeau replié pour préserver la sensation de focus.
          const expandLeft = () => {
            if (docsViewMode === "lecture") { setDocsViewMode("apercu"); setDocsRightCollapsed(true); }
            setDocsLeftCollapsed(false);
          };
          const expandRight = () => {
            if (docsViewMode === "lecture") { setDocsViewMode("apercu"); setDocsLeftCollapsed(true); }
            setDocsRightCollapsed(false);
          };
          // Bouton « replier » discret posé dans l'en-tête d'un bandeau.
          const CollapseBtn = ({ side, onClick }: { side: "left" | "right"; onClick: () => void }) => (
            <button
              type="button"
              onClick={onClick}
              title={`Replier le panneau ${side === "left" ? "de gauche" : "de droite"}`}
              style={{
                border: "1px solid #E2E8F0", background: "white", borderRadius: 6,
                width: 22, height: 22, lineHeight: 1, cursor: "pointer", color: "#64748b",
                fontSize: 12, fontWeight: 700, flexShrink: 0, padding: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {side === "left" ? "‹" : "›"}
            </button>
          );
          const stripeStyle: React.CSSProperties = {
            background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9,
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "flex-start", padding: "14px 0", gap: 8,
            cursor: "pointer", color: "#64748b",
          };
          const ModeBtn = ({ value, label, icon, title }: { value: "apercu" | "compare" | "lecture"; label: string; icon: string; title: string }) => (
            <button
              type="button"
              onClick={() => setDocsViewMode(value)}
              title={title}
              style={{
                padding: "5px 12px", border: "none",
                borderLeft: value !== "apercu" ? "1px solid #E2E8F0" : "none",
                background: docsViewMode === value ? "#4F46E5" : "white",
                color: docsViewMode === value ? "white" : "#475569",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}
            >
              <span style={{ fontSize: 13 }}>{icon}</span>{label}
            </button>
          );

          // Split pièce ↔ document réglementaire. Défini une seule fois puis
          // rendu soit dans la grille, soit dans l'overlay grand écran — jamais
          // les deux (un seul PdfAnnotator monté à la fois).
          const compareSplit = (
            <ResizableSplit
              storageKey="heureka.docsCompareSplitPct"
              left={
                <div style={{ height: "100%", background: "#F8FAFC", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid #E2E8F0", fontSize: 12, fontWeight: 600, color: "#1E293B", background: "white" }}>
                    {sel?.nom ?? "Sélectionne une pièce à gauche"}
                  </div>
                  <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", justifyContent: "stretch", background: "#0F172A0A" }}>
                    {sel ? (
                      (sel.type ?? "").toLowerCase().startsWith("image/") ? (
                        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <img src={sel.url} alt={sel.nom} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                        </div>
                      ) : (sel.type === "application/pdf" || sel.nom.toLowerCase().endsWith(".pdf")) ? (
                        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                          <PdfAnnotator key={sel.id} fileUrl={sel.url} originalDownloadUrl={sel.url} />
                        </div>
                      ) : (
                        <div style={{ flex: 1, color: "#94a3b8", fontSize: 12, padding: 24, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>Aperçu indisponible pour ce format</div>
                      )
                    ) : (
                      <div style={{ flex: 1, color: "#94a3b8", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>Sélectionne une pièce à gauche.</div>
                    )}
                  </div>
                </div>
              }
              right={
                <div style={{ height: "100%" }}>
                  <RegulatoryDocViewer
                    communeName={dossier.commune ?? ""}
                    selectedDocId={docsRegulatoryDocId}
                    onSelectDoc={(id) => {
                      setDocsRegulatoryDocId(id);
                      setDocsRegulatoryDocTypeHint(null);
                      setDocsRegulatoryDocPage(null);
                    }}
                    preferredDocType={docsRegulatoryDocTypeHint}
                    page={docsRegulatoryDocPage}
                  />
                </div>
              }
            />
          );

          return (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginBottom: 10 }}>
                {docsViewMode === "compare" && (
                  <button
                    type="button"
                    onClick={() => setCompareFullscreen(true)}
                    title="Ouvrir la comparaison en grand écran (Échap pour quitter)"
                    style={{
                      border: "1px solid #E2E8F0", background: "white", borderRadius: 8,
                      padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#475569",
                      cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    }}
                  >
                    <span style={{ fontSize: 13 }}>⛶</span>Grand écran
                  </button>
                )}
                <div style={{ display: "inline-flex", border: "1px solid #E2E8F0", borderRadius: 8, overflow: "hidden", background: "white", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <ModeBtn value="apercu"  label="Aperçu"   icon="⊞" title="Pièces · viewer · annotation" />
                  <ModeBtn value="compare" label="Comparer" icon="❘❘" title="Pièce et document réglementaire côte à côte" />
                  <ModeBtn value="lecture" label="Lecture"  icon="📖" title="Pièce plein écran, panneaux escamotés" />
                </div>
              </div>
            <div style={{ display: "grid", gridTemplateColumns: gridTemplate, gap: 16, alignItems: "start" }}>
              {leftIsStripe ? (
                <div style={stripeStyle} onClick={expandLeft} title="Déplier le panneau Pièces">
                  <span style={{ fontSize: 14 }}>›</span>
                  <span style={{ fontSize: 10, letterSpacing: "0.08em", writingMode: "vertical-rl", transform: "rotate(180deg)", textTransform: "uppercase" }}>Pièces ({docs.length})</span>
                </div>
              ) : (
              <div style={{ ...CARD, maxHeight: "calc(100vh - 220px)", overflowY: "auto" as const }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <SecTitle>Pièces du dossier</SecTitle>
                  <CollapseBtn side="left" onClick={() => setDocsLeftCollapsed(true)} />
                </div>
                {documentsLoading ? (
                  <div style={{ textAlign: "center" as const, padding: "20px 0", fontSize: 12, color: "#64748b" }}>Chargement…</div>
                ) : docs.length === 0 ? (
                  <div style={{ textAlign: "center" as const, padding: "24px 8px", fontSize: 12.5, color: "#64748b" }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                    Aucune pièce déposée.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
                    {grouped.map((group) => {
                    const isCollapsed = collapsedDocCategories.has(group.key);
                    return (
                    <div key={group.key}>
                      <button
                        type="button"
                        onClick={() => toggleDocCategory(group.key)}
                        style={{
                          width: "100%", textAlign: "left" as const, background: "transparent", border: "none",
                          padding: "4px 4px 6px", cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 6,
                          fontSize: 10.5, fontWeight: 700, color: "#475569",
                          textTransform: "uppercase" as const, letterSpacing: "0.06em",
                          fontFamily: "inherit",
                        }}
                        title={isCollapsed ? "Déplier la catégorie" : "Replier la catégorie"}
                      >
                        <span style={{ fontSize: 9, color: "#94a3b8", display: "inline-block", width: 8, transition: "transform 0.15s", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
                        <span>{group.label}</span>
                        <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>({group.items.length})</span>
                      </button>
                      {!isCollapsed && (
                      <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
                    {group.items.map(({ doc, origIndex: i }) => {
                      const ext = extOf(doc.type, doc.nom);
                      const status = scoreToStatus(doc.analyse_ia?.score);
                      const instMeta: Record<string, { label: string; bg: string; color: string; border: string }> = {
                        valide: { label: "Validé", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" },
                        rejete: { label: "Rejeté", bg: "#FEE2E2", color: "#DC2626", border: "#FECACA" },
                        complement_demande: { label: "Complément", bg: "#FEF3C7", color: "#92400E", border: "#FDE68A" },
                      };
                      const inst = doc.instructeur_status ? instMeta[doc.instructeur_status] : null;
                      const hasNote = !!(doc.instructeur_note && doc.instructeur_note.trim());
                      return (
                        <button key={doc.id} onClick={() => setSelectedDoc(i)} style={{
                          display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 11px", borderRadius: 9, border: selectedDoc === i ? "1.5px solid #C7D2FE" : "1.5px solid transparent", cursor: "pointer", textAlign: "left" as const,
                          background: selectedDoc === i ? "#EEF2FF" : "transparent",
                          transition: "background 0.1s",
                          position: "relative" as const,
                        }}>
                          {inst && (
                            <span title={inst.label} style={{ position: "absolute" as const, top: 8, right: 8, width: 8, height: 8, borderRadius: "50%", background: inst.color }} />
                          )}
                          <div style={{ width: 32, height: 32, borderRadius: 7, background: ext === "ZIP" ? "#FFF7ED" : "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={ext === "ZIP" ? "#F97316" : "#4F46E5"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1E293B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, textDecoration: doc.instructeur_status === "rejete" ? "line-through" : "none" }}>{doc.nom}</div>
                            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{ext} · {fmtSize(doc.taille)} · {fmtUploaded(doc.uploaded_at)}</div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const, marginTop: 4 }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: status.color, background: status.bg, borderRadius: 5, padding: "1px 6px", border: `1px solid ${status.border}` }}>{status.label}</span>
                              {inst && (
                                <span style={{ fontSize: 10.5, fontWeight: 700, color: inst.color, background: inst.bg, borderRadius: 5, padding: "1px 6px", border: `1px solid ${inst.border}` }}>{inst.label}</span>
                              )}
                              {/* Badges de traitement IA — n'apparaissent que lors d'anomalies ou
                                  d'attentes. Quand tout est OK le `status.label` ci-dessus suffit. */}
                              {(doc.ocr_status === "processing" || doc.ocr_status === "pending") && (
                                <span title="OCR en cours sur ce document" style={{ fontSize: 10.5, fontWeight: 700, color: "#C2410C", background: "#FFF7ED", borderRadius: 5, padding: "1px 6px", border: "1px solid #FED7AA" }}>↻ OCR</span>
                              )}
                              {doc.ocr_status === "failed" && (
                                <span title="OCR échoué — l'IA ne peut pas lire ce document" style={{ fontSize: 10.5, fontWeight: 700, color: "#DC2626", background: "#FEE2E2", borderRadius: 5, padding: "1px 6px", border: "1px solid #FECACA" }}>⚠ OCR</span>
                              )}
                              {(doc.ocr_status === "done" || doc.ocr_status === "skipped") && !doc.analyse_ia && (
                                <span title="OCR terminé, analyse IA en cours ou non lancée" style={{ fontSize: 10.5, fontWeight: 700, color: "#C2410C", background: "#FFF7ED", borderRadius: 5, padding: "1px 6px", border: "1px solid #FED7AA" }}>↻ IA</span>
                              )}
                              {hasNote && (
                                <span title="Annotation présente" style={{ fontSize: 10.5, color: "#4F46E5" }}>📝</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                      </div>
                      )}
                    </div>
                    );
                    })}
                  </div>
                )}
              </div>
              )}
              {docsViewMode === "compare" ? (
              // Hauteur dynamique : la comparaison s'étire pour occuper toute la
              // hauteur du cadre (au lieu d'un 640px figé). minHeight garde un
              // viewer exploitable sur petit écran.
              <div style={{ ...CARD, padding: 0, minWidth: 0, display: "flex", flexDirection: "column" as const, height: "calc(100vh - 210px)", minHeight: 460, overflow: "hidden" }}>
                <div style={{ flex: 1, minHeight: 0 }}>
                  {compareFullscreen ? (
                    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#64748b", fontSize: 13 }}>
                      <div style={{ fontSize: 34 }}>⛶</div>
                      <div>Comparaison ouverte en grand écran</div>
                      <button
                        type="button"
                        onClick={() => setCompareFullscreen(false)}
                        style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer" }}
                      >
                        Réduire
                      </button>
                    </div>
                  ) : compareSplit}
                </div>
              </div>
              ) : (
              <div style={{ ...CARD, minWidth: 0, display: "flex", flexDirection: "column" as const }}>
                <SecTitle>{`Aperçu : ${sel?.nom ?? "—"}`}</SecTitle>
                <div style={{ flex: 1, minWidth: 0, background: "#F8FAFC", borderRadius: 11, minHeight: 340, border: "1px solid #EAECF0", overflow: "hidden", position: "relative" as const, display: "flex", flexDirection: "column" as const }}>
                  {sel ? (() => {
                    const t = (sel.type ?? "").toLowerCase();
                    const isImage = t.startsWith("image/");
                    const isPdf = t === "application/pdf" || sel.nom.toLowerCase().endsWith(".pdf");
                    return (
                      <>
                        <div style={{ flex: 1, minHeight: 340, background: "#0F172A0A", display: "flex", alignItems: isImage ? "center" : "stretch", justifyContent: isImage ? "center" : "stretch" }}>
                          {isImage ? (
                            <img src={sel.url} alt={sel.nom} style={{ maxWidth: "100%", maxHeight: 520, objectFit: "contain", display: "block" }} />
                          ) : isPdf ? (
                            <div style={{ flex: 1, minWidth: 0, minHeight: 560 }}>
                              <PdfAnnotator key={sel.id} fileUrl={sel.url} originalDownloadUrl={sel.url} />
                            </div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 12, padding: 32, textAlign: "center" as const }}>
                              <div style={{ width: 64, height: 80, background: "white", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", border: "1px solid #E2E8F0" }}>
                                <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                              </div>
                              <div>
                                <div style={{ fontSize: 13, color: "#64748b" }}>Aperçu indisponible pour ce format</div>
                                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{extOf(sel.type, sel.nom)} · {fmtSize(sel.taille)}</div>
                              </div>
                            </div>
                          )}
                        </div>
                        {/* Barre d'actions */}
                        <div style={{ padding: "10px 14px", borderTop: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontSize: 11.5, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1, minWidth: 0 }}>
                            {extOf(sel.type, sel.nom)} · {fmtSize(sel.taille)} · déposé le {fmtUploaded(sel.uploaded_at)}
                          </div>
                          <a href={sel.url} target="_blank" rel="noopener noreferrer" style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(79,70,229,0.3)", textDecoration: "none", flexShrink: 0 }}>Ouvrir en plein écran ↗</a>
                          <a href={sel.url} download style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "#374151", fontWeight: 500, textDecoration: "none", flexShrink: 0 }}>Télécharger</a>
                        </div>
                      </>
                    );
                  })() : (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#94a3b8" }}>
                      Sélectionnez une pièce à gauche
                    </div>
                  )}
                </div>
              </div>
              )}
              {rightIsStripe ? (
                <div style={stripeStyle} onClick={expandRight} title="Déplier le panneau Annotation">
                  <span style={{ fontSize: 14 }}>‹</span>
                  <span style={{ fontSize: 10, letterSpacing: "0.08em", writingMode: "vertical-rl", transform: "rotate(180deg)", textTransform: "uppercase" }}>Annotation</span>
                </div>
              ) : (
              <div style={CARD}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", marginBottom: 10 }}>
                  <CollapseBtn side="right" onClick={() => setDocsRightCollapsed(true)} />
                </div>
                {/* Annotation de l'instructeur — toujours en haut du panneau de droite */}
                {sel && (() => {
                  const draftKey = sel.id;
                  const currentNote = annotationDrafts[draftKey] !== undefined
                    ? annotationDrafts[draftKey]!
                    : (sel.instructeur_note ?? "");
                  const noteDirty = annotationDrafts[draftKey] !== undefined && (annotationDrafts[draftKey] ?? "") !== (sel.instructeur_note ?? "");
                  const isSaving = annotatingPieceId === sel.id;
                  const STATUS_BUTTONS: Array<{ key: "valide" | "rejete" | "complement_demande"; label: string; bg: string; color: string; icon: string }> = [
                    { key: "valide",             label: "Valider",      bg: "#F0FDF4", color: "#15803D", icon: "✓" },
                    { key: "complement_demande", label: "Complément",   bg: "#FEF3C7", color: "#92400E", icon: "✎" },
                    { key: "rejete",             label: "Rejeter",      bg: "#FEE2E2", color: "#DC2626", icon: "✕" },
                  ];
                  return (
                    <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #E2E8F0" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Annotation instructeur</div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" as const }}>
                        {STATUS_BUTTONS.map((b) => {
                          const active = sel.instructeur_status === b.key;
                          return (
                            <button key={b.key}
                              onClick={() => void sendAnnotation(sel.id, { status: active ? null : b.key })}
                              disabled={isSaving}
                              title={active ? `Annuler le statut "${b.label}"` : `Marquer comme ${b.label.toLowerCase()}`}
                              style={{
                                flex: 1,
                                padding: "6px 8px",
                                borderRadius: 7,
                                border: `1px solid ${active ? b.color : "#E2E8F0"}`,
                                background: active ? b.bg : "white",
                                color: active ? b.color : "#475569",
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: isSaving ? "default" : "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 4,
                              }}>
                              <span>{b.icon}</span> {b.label}
                            </button>
                          );
                        })}
                      </div>
                      {sel.instructeur_status_at && (
                        <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 8 }}>
                          Statut posé le {new Date(sel.instructeur_status_at).toLocaleString("fr-FR")}
                        </div>
                      )}
                      <textarea
                        value={currentNote}
                        onChange={(e) => setAnnotationDraft(draftKey, e.target.value)}
                        rows={3}
                        placeholder="Annotation libre — précisions, motif de rejet, demande de complément…"
                        style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 7, padding: "7px 9px", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" as const, lineHeight: 1.5, resize: "vertical" as const }}
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                        {noteDirty && (
                          <button onClick={() => setAnnotationDrafts((p) => { const n = { ...p }; delete n[draftKey]; return n; })}
                            style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 12px", fontSize: 11.5, cursor: "pointer", color: "#374151" }}>
                            Annuler
                          </button>
                        )}
                        <button onClick={() => void sendAnnotation(sel.id, { note: currentNote.trim() ? currentNote : null })}
                          disabled={!noteDirty || isSaving}
                          style={{ border: "none", background: !noteDirty || isSaving ? "#C7D2FE" : "#4F46E5", color: "white", borderRadius: 6, padding: "4px 14px", fontSize: 11.5, fontWeight: 600, cursor: !noteDirty || isSaving ? "default" : "pointer" }}>
                          {isSaving ? "Enregistrement…" : "Enregistrer la note"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
                <SecTitle>Analyse IA</SecTitle>
                {sel?.analyse_ia?.commentaire ? (
                  <>
                    <div style={{ padding: "14px", background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)", borderRadius: 11, border: "1px solid #C7D2FE", marginBottom: 14 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "#4F46E5", marginBottom: 7, letterSpacing: "0.07em" }}>RÉSULTAT</div>
                      <div style={{ fontSize: 12, color: "#3730A3", lineHeight: 1.6 }}>{sel.analyse_ia.commentaire}</div>
                    </div>
                    {sel.analyse_ia.suggestions && sel.analyse_ia.suggestions.length > 0 && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Suggestions</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
                          {sel.analyse_ia.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
                    {sel ? "Pas d'analyse IA disponible pour cette pièce." : "Sélectionnez une pièce pour voir son analyse."}
                  </div>
                )}

                {/* Extraction structurée */}
                {sel && (() => {
                  const e = sel.extraction_ia;
                  const isExtracting = extractingPieceId === sel.id;
                  return (
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #E2E8F0" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Extraction structurée</div>
                        <button onClick={() => void reExtractPiece(sel.id)} disabled={isExtracting}
                          style={{ border: "1px solid #C7D2FE", background: isExtracting ? "#EEF2FF" : "white", color: "#4F46E5", borderRadius: 7, padding: "3px 10px", fontSize: 11, cursor: isExtracting ? "default" : "pointer", fontWeight: 600 }}>
                          {isExtracting ? "Extraction…" : e ? "Ré-extraire" : "Lancer l'extraction"}
                        </button>
                      </div>
                      {e ? (
                        <div style={{ fontSize: 11.5, color: "#374151", lineHeight: 1.55 }}>
                          <div style={{ marginBottom: 4 }}>
                            <span style={{ color: "#94a3b8" }}>Type :</span> <strong>{e.piece_type ?? "—"}</strong>
                            {typeof e.confidence_type === "number" && (
                              <span style={{ marginLeft: 6, fontSize: 10.5, color: e.confidence_type >= 0.7 ? "#15803D" : "#92400E" }}>
                                ({Math.round(e.confidence_type * 100)}%)
                              </span>
                            )}
                            {e.echelle && <span style={{ marginLeft: 8 }}><span style={{ color: "#94a3b8" }}>Échelle :</span> <strong>{e.echelle}</strong></span>}
                          </div>
                          {(() => {
                            const cites = (e.citations ?? [])
                              .map((c) => {
                                if (typeof c === "string") return { text: c, page: null as number | null };
                                const text = typeof c?.text === "string" ? c.text : "";
                                const page = typeof c?.page === "number" ? c.page : null;
                                return text ? { text, page } : null;
                              })
                              .filter((c): c is { text: string; page: number | null } => c !== null);
                            return cites.length > 0 && (
                              <div style={{ marginTop: 6 }}>
                                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", letterSpacing: "0.04em", marginBottom: 3 }}>CITATIONS</div>
                                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "#374151", lineHeight: 1.5 }}>
                                  {cites.slice(0, 6).map((c, i) => (
                                    <li key={i}>
                                      {c.text}
                                      {c.page !== null && <span style={{ color: "#94a3b8" }}> (p. {c.page})</span>}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })()}
                          {e.missing_elements && e.missing_elements.length > 0 && (
                            <div style={{ marginTop: 6, padding: "6px 9px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6 }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#92400E", letterSpacing: "0.04em", marginBottom: 3 }}>ÉLÉMENTS ABSENTS</div>
                              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "#92400E", lineHeight: 1.5 }}>
                                {e.missing_elements.map((m, i) => <li key={i}>{m}</li>)}
                              </ul>
                            </div>
                          )}
                          {e.notes && (
                            <div style={{ marginTop: 6, fontSize: 11, color: "#64748b", fontStyle: "italic" }}>{e.notes}</div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.5 }}>
                          Pas d'extraction disponible. Lance l'extraction pour récupérer les valeurs cotées (recul, hauteur, surfaces…).
                        </div>
                      )}
                      <PieceRegulatoryLinks
                        dossierId={dossier.id}
                        pieceId={sel.id}
                        onAppendToNote={(line) => {
                          // Append à la fin du brouillon courant (ou de la
                          // note persistée s'il n'y a pas de brouillon).
                          // L'instructeur peut ensuite cliquer "Enregistrer".
                          const current = annotationDrafts[sel.id] !== undefined
                            ? annotationDrafts[sel.id]!
                            : (sel.instructeur_note ?? "");
                          const next = current.trim() ? `${current.trim()}\n${line}` : line;
                          setAnnotationDraft(sel.id, next);
                        }}
                      />
                    </div>
                  );
                })()}
              </div>
              )}
            </div>
            {/* Grand écran : overlay plein viewport réutilisant le même split.
                Rendu hors de la grille pour un position:fixed propre. */}
            {docsViewMode === "compare" && compareFullscreen && (
              <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "white", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", whiteSpace: "nowrap" }}>⛶ Comparaison — grand écran</span>
                  {docs.length > 0 && (
                    <select
                      value={selectedDoc}
                      onChange={(e) => setSelectedDoc(Number(e.target.value))}
                      title="Pièce comparée"
                      style={{ maxWidth: 360, fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid #E2E8F0", background: "white", color: "#374151", cursor: "pointer" }}
                    >
                      {docs.map((doc, i) => (
                        <option key={doc.id} value={i}>{doc.nom}</option>
                      ))}
                    </select>
                  )}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Échap pour quitter</span>
                  <button
                    type="button"
                    onClick={() => setCompareFullscreen(false)}
                    style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer" }}
                  >
                    Quitter ✕
                  </button>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>{compareSplit}</div>
              </div>
            )}
            </>
          );
        })()}

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
        {activeTab === "Chronologie" && (() => {
          const evts = events ?? [];
          const loading = events === null;
          const eventMeta: Record<string, { icon: string; color: string }> = {
            dossier_soumis:                  { icon: "📥", color: "#4F46E5" },
            dossier_complet:                 { icon: "✅", color: "#22C55E" },
            dossier_incomplet:               { icon: "⚠️", color: "#F97316" },
            instruction_demarree:            { icon: "🔍", color: "#3B82F6" },
            decision_prise:                  { icon: "📌", color: "#22C55E" },
            message_instructeur:             { icon: "💬", color: "#8B5CF6" },
            document_demande:                { icon: "📄", color: "#F97316" },
            piece_validee:                   { icon: "✓",  color: "#15803D" },
            piece_rejetee:                   { icon: "✕",  color: "#DC2626" },
            piece_complement_demande:        { icon: "✎",  color: "#92400E" },
            piece_statut_efface:             { icon: "↺",  color: "#64748B" },
            consultation_envoyee:            { icon: "📤", color: "#8B5CF6" },
            consultation_avis_recu:          { icon: "📥", color: "#22C55E" },
          };
          const labelOf = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "flex-start" }}>
              <div style={CARD}>
                <SecTitle>Historique complet</SecTitle>
                {loading ? (
                  <div style={{ textAlign: "center" as const, padding: "24px 0", fontSize: 13, color: "#64748b" }}>Chargement…</div>
                ) : evts.length === 0 ? (
                  <div style={{ textAlign: "center" as const, padding: "32px 16px", color: "#64748b" }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>🕒</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Aucun événement enregistré</div>
                    <p style={{ fontSize: 12.5, maxWidth: 380, margin: "0 auto", lineHeight: 1.55 }}>
                      Les étapes clés du dossier (dépôt, complétude, consultations, validation de pièces, décision…) apparaîtront ici au fur et à mesure de l'instruction.
                    </p>
                  </div>
                ) : (
                  <div>
                    {evts.map((ev, i) => {
                      const meta = eventMeta[ev.type] ?? { icon: "•", color: "#64748B" };
                      const date = new Date(ev.created_at);
                      const ts = isNaN(date.getTime()) ? "—" : date.toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
                      const actor = ev.actor_name ? `${ev.actor_name}${ev.actor_role ? ` (${ev.actor_role})` : ""}` : "Système";
                      const note = ev.metadata && typeof ev.metadata === "object" && typeof (ev.metadata as Record<string, unknown>).note === "string"
                        ? ((ev.metadata as Record<string, unknown>).note as string)
                        : null;
                      return (
                        <div key={ev.id} style={{ display: "flex", gap: 14, paddingBottom: i < evts.length - 1 ? 18 : 0 }}>
                          <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", width: 32 }}>
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: meta.color + "18", border: `2px solid ${meta.color}55`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13, color: meta.color, fontWeight: 700 }}>{meta.icon}</div>
                            {i < evts.length - 1 && <div style={{ width: 2, flex: 1, background: "linear-gradient(to bottom,#E2E8F0,#F8FAFC)", marginTop: 6 }} />}
                          </div>
                          <div style={{ paddingBottom: 4, flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>
                              {ev.description ?? labelOf(ev.type)}
                            </div>
                            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{actor}</div>
                            {note && (
                              <div style={{ marginTop: 6, padding: "6px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, color: "#374151", lineHeight: 1.5, fontStyle: "italic" }}>
                                « {note} »
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: "#CBD5E1", marginTop: 4, fontWeight: 500 }}>{ts}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
              <div style={CARD}>
                <SecTitle>Étapes clés</SecTitle>
                {[
                  { label: "Dépôt", date: dossier.date_depot ? fmtDate(dossier.date_depot) : "—", done: !!dossier.date_depot },
                  { label: "Fin d'instruction", date: dossier.echeance, done: false },
                ].map((e, i, arr) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: i < arr.length - 1 ? "1px solid #F1F5F9" : "none" }}>
                    <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{e.label}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>{e.date}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, background: e.done ? "#F0FDF4" : "#EFF6FF", color: e.done ? "#15803D" : "#2563EB", borderRadius: 5, padding: "2px 7px", border: `1px solid ${e.done ? "#BBF7D0" : "#BFDBFE"}` }}>{e.done ? "Fait" : "Prévu"}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={CARD}>
                <SecTitle>Délais réglementaires</SecTitle>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                  {[["Date limite", dossier.echeance], daysLeft !== null ? ["Temps restant", `J-${Math.max(0, daysLeft)}`] : null].filter(Boolean).map((row, i) => row && (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "6px 0", borderBottom: i < 0 ? "1px solid #F1F5F9" : "none" }}>
                      <span style={{ color: "#64748b" }}>{row[0]}</span>
                      <span style={{ fontWeight: 700, color: i === 1 ? (daysLeft !== null && daysLeft < 14 ? "#DC2626" : "#15803D") : "#0F172A" }}>{row[1]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {/* ── COURRIERS ── */}
        {activeTab === "Courriers" && (
          <CourriersPanel
            dossierId={dossier.id}
            onRequestNewPiecesCourrier={() => setCourrierMode("pieces_complementaires")}
            onRequestNewGeneralCourrier={() => setCourrierMode("general")}
          />
        )}

        {/* ── DÉCISION ── */}
        {activeTab === "Décision" && (
          <DecisionPanel dossier={dossier} liveCommune={liveCommune} currentUserId={user?.id} />
        )}

      </div>
      {courrierMode && (
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
            date_completude: dossier.date_completude,
            echeance: dossier.echeance,
          }}
          mode={courrierMode}
          availablePieces={(documents ?? []).map((d) => ({
            id: d.id,
            nom: d.nom,
            code_piece: d.code_piece,
            instructeur_status: d.instructeur_status,
            ia_score: (d.analyse_ia?.score as "conforme" | "acceptable" | "incomplet" | "non_conforme" | undefined) ?? null,
          }))}
          aiSuggestedMissingPieces={conformite?.report?.pieces_manquantes ?? []}
          onEmitted={() => {
            // Après émission : rafraîchir workflow + pièces pour refléter le
            // nouveau statut "incomplet" et les pièces marquées complement_demande.
            void refreshWorkflow();
            setDocuments(null); // force le rechargement au prochain accès onglet
          }}
          onClose={() => setCourrierMode(null)}
        />
      )}
    </div>
  );
}


type NouveauDossierType =
  | "permis_de_construire"
  | "permis_de_construire_mi"
  | "declaration_prealable"
  | "permis_amenager"
  | "permis_demolir"
  | "permis_lotir"
  | "certificat_urbanisme"
  | "certificat_urbanisme_a"
  | "certificat_urbanisme_b";

type NouveauDossierForm = {
  type: NouveauDossierType;
  petitionnaire_prenom: string;
  petitionnaire_nom: string;
  petitionnaire_email: string;
  adresse: string;
  code_postal: string;
  commune: string;
  parcelle: string;
  surface_plancher: string;
  description: string;
  date_depot: string;
  instructeur_id: string;
};

const DOSSIER_TYPE_OPTIONS: { value: NouveauDossierType; label: string }[] = [
  { value: "permis_de_construire_mi", label: "Permis de construire — Maison individuelle (PCMI)" },
  { value: "permis_de_construire", label: "Permis de construire (PC)" },
  { value: "declaration_prealable", label: "Déclaration préalable (DP)" },
  { value: "permis_amenager", label: "Permis d'aménager (PA)" },
  { value: "permis_demolir", label: "Permis de démolir (PD)" },
  { value: "certificat_urbanisme_a", label: "Certificat d'urbanisme informatif (CUa)" },
  { value: "certificat_urbanisme_b", label: "Certificat d'urbanisme opérationnel (CUb)" },
];

type OcrExtraction = {
  type: NouveauDossierType | null;
  numero_cerfa: string | null;
  petitionnaire_prenom: string | null;
  petitionnaire_nom: string | null;
  petitionnaire_email: string | null;
  siret: string | null;
  adresse: string | null;
  code_postal: string | null;
  commune: string | null;
  parcelle: string | null;
  surface_plancher: string | null;
  description: string | null;
  confidence: number;
};

// Heuristique : à quel code_piece (DP/PC*) correspond le fichier d'après son nom ?
// Permet de pré-coder la pièce avant upload pour que l'extracteur côté serveur
// reçoive un hint pertinent (plan_masse, plan_facade, etc.).
function guessCodePieceFromName(name: string): string {
  const n = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/cerfa|13406|13703|13409|13405|13410/.test(n)) return "CERFA";
  if (/situation|dp1\b|pc1\b/.test(n)) return "DP1";
  if (/masse|dp2\b|pc2\b/.test(n)) return "DP2";
  if (/coupe|dp3\b|pc3\b/.test(n)) return "DP3";
  if (/notice|dp4\b|pc4\b/.test(n)) return "DP4";
  if (/facade|dp5\b|pc5\b/.test(n)) return "DP5";
  if (/insertion|paysag|pc6\b/.test(n)) return "PC6";
  if (/photo.*proche|dp7\b|pc7\b/.test(n)) return "PC7";
  if (/photo.*lointain|dp8\b|pc8\b/.test(n)) return "PC8";
  return "";
}

type StagedFile = {
  id: string;
  file: File;
  isCerfa: boolean;
  status: "queued" | "uploading" | "done" | "error";
  error?: string | null;
};

// Hoistés hors du composant : redéfinis à chaque render, React voyait un nouveau
// type → unmount/remount complet du sous-arbre à chaque setState, ce qui faisait
// "fermer" la modale (clic accidentel sur le backdrop pendant la reconstruction
// du DOM, perte du focus, flickering).
function NouveauDossierOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 16, width: 580, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.22)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function NouveauDossierModalHeader({ title, back, onClose }: { title: string; back?: () => void; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 24px", borderBottom: "1px solid #E2E8F0" }}>
      {back && <button onClick={back} style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18, lineHeight: 1, padding: 0 }}>←</button>}
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", flex: 1 }}>{title}</div>
      <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8", lineHeight: 1 }}>×</button>
    </div>
  );
}

function NouveauDossierModal({ onClose, commune }: { onClose: () => void; commune: string }) {
  const routerNavigate = useNavigate();
  const [mode, setMode] = useState<"choose" | "manual" | "ocr">("choose");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const emptyForm: NouveauDossierForm = {
    type: "permis_de_construire",
    petitionnaire_prenom: "",
    petitionnaire_nom: "",
    petitionnaire_email: "",
    adresse: "",
    code_postal: "",
    commune,
    parcelle: "",
    surface_plancher: "",
    description: "",
    date_depot: today,
    instructeur_id: "",
  };
  const [form, setForm] = useState<NouveauDossierForm>(emptyForm);
  const [instructeurs, setInstructeurs] = useState<{ id: string; prenom: string; nom: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  // OCR state — multi-fichiers : le CERFA pré-remplit le formulaire, les
  // autres pièces sont mises en attente et uploadées après création du dossier.
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [cerfaScanning, setCerfaScanning] = useState(false);
  const [cerfaDone, setCerfaDone] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrNumero, setOcrNumero] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ id: string; prenom: string; nom: string }[]>("/mairie/instructeurs")
      .then(setInstructeurs)
      .catch(() => setInstructeurs([]));
  }, []);

  // Garde le champ "commune" du formulaire en phase avec la commune active
  // si l'opérateur change de commune dans la sidebar tant que la modale est ouverte.
  useEffect(() => {
    setForm(prev => prev.commune ? prev : { ...prev, commune });
  }, [commune]);

  const setField = <K extends keyof NouveauDossierForm>(key: K, value: NouveauDossierForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Lance l'extraction CERFA sur le fichier marqué comme CERFA. Appelé soit
  // au moment où l'utilisateur ajoute des fichiers (le premier CERFA détecté
  // est extrait), soit quand l'utilisateur change le fichier désigné CERFA.
  const runCerfaExtract = async (file: File) => {
    setOcrError(null);
    setCerfaScanning(true);
    setCerfaDone(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/mairie/ocr-cerfa", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        // 413 = Payload Too Large (proxy ou multer 60 Mo). Inutile d'afficher
        // un code HTTP brut au déposant : on traduit en message actionnable.
        if (res.status === 413) {
          throw new Error("Fichier trop volumineux pour l'extraction (limite ~60 Mo).");
        }
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json() as OcrExtraction;
      setForm(prev => ({
        ...prev,
        type: data.type ?? prev.type,
        petitionnaire_prenom: data.petitionnaire_prenom ?? prev.petitionnaire_prenom,
        petitionnaire_nom: data.petitionnaire_nom ?? prev.petitionnaire_nom,
        petitionnaire_email: data.petitionnaire_email ?? prev.petitionnaire_email,
        adresse: data.adresse ?? prev.adresse,
        code_postal: data.code_postal ?? prev.code_postal,
        commune: data.commune ?? prev.commune,
        parcelle: data.parcelle ?? prev.parcelle,
        surface_plancher: data.surface_plancher ?? prev.surface_plancher,
        description: data.description ?? prev.description,
      }));
      setOcrNumero(data.numero_cerfa);
      setCerfaDone(true);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "Échec de l'extraction OCR");
    } finally {
      setCerfaScanning(false);
    }
  };

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setStagedFiles(prev => {
      const next = [...prev];
      const hasCerfa = next.some(f => f.isCerfa);
      for (const file of arr) {
        // Évite les doublons exacts (nom + taille) si l'opérateur ré-importe.
        if (next.some(f => f.file.name === file.name && f.file.size === file.size)) continue;
        const guessed = guessCodePieceFromName(file.name);
        const looksLikeCerfa = guessed === "CERFA";
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          // Premier CERFA détecté → marqué CERFA ; sinon si on n'a encore rien
          // de désigné CERFA et que c'est un PDF, on prend le 1er PDF par défaut.
          isCerfa: looksLikeCerfa && !hasCerfa,
          status: "queued",
        });
      }
      // Si toujours pas de CERFA désigné, prend le premier PDF (fallback).
      if (!next.some(f => f.isCerfa)) {
        const firstPdf = next.find(f => /\.pdf$/i.test(f.file.name));
        if (firstPdf) firstPdf.isCerfa = true;
      }
      return next;
    });
  };

  // Quand le CERFA désigné change, déclenche l'extraction. On lit la liste
  // mise à jour via la callback de setStagedFiles pour ne pas dépendre de
  // l'état périmé.
  useEffect(() => {
    const cerfa = stagedFiles.find(f => f.isCerfa);
    if (!cerfa) {
      setCerfaDone(false);
      setOcrNumero(null);
      return;
    }
    // Re-extraction uniquement quand la cible change.
    void runCerfaExtract(cerfa.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedFiles.find(f => f.isCerfa)?.id]);

  const setCerfa = (id: string) => {
    setStagedFiles(prev => prev.map(f => ({ ...f, isCerfa: f.id === id })));
  };
  const removeFile = (id: string) => {
    setStagedFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      // Si on a retiré le CERFA, promeut le premier fichier restant.
      if (!next.some(f => f.isCerfa) && next.length > 0) next[0]!.isCerfa = true;
      return next;
    });
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitError(null);
    if (!form.petitionnaire_nom.trim()) {
      setSubmitError("Le nom du pétitionnaire est obligatoire.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        type: form.type,
        petitionnaire_nom: form.petitionnaire_nom.trim(),
        petitionnaire_prenom: form.petitionnaire_prenom.trim() || undefined,
        petitionnaire_email: form.petitionnaire_email.trim() || undefined,
        adresse: form.adresse.trim() || undefined,
        code_postal: form.code_postal.trim() || undefined,
        commune: form.commune.trim() || undefined,
        parcelle: form.parcelle.trim() || undefined,
        surface_plancher: form.surface_plancher.trim() || undefined,
        description: form.description.trim() || undefined,
        date_depot: form.date_depot || undefined,
        instructeur_id: form.instructeur_id || undefined,
      };
      if (ocrNumero) {
        payload["metadata"] = { numero_cerfa: ocrNumero, created_via: "ocr" };
      } else if (mode === "manual") {
        payload["metadata"] = { created_via: "manual" };
      }
      const created = await api.post<{ id: string }>("/mairie/dossiers", payload);

      // Upload séquentiel des pièces : on évite de saturer la bande passante
      // côté navigateur (CERFAs scannés à 15 Mo par fichier × N pièces) et on
      // garde un feedback de progression simple. Une erreur sur une pièce
      // n'empêche pas les suivantes : le dossier est déjà créé, l'opérateur
      // pourra rejouer l'ajout depuis l'écran du dossier.
      //
      // Note : depuis le passage de l'OCR en asynchrone côté back, chaque
      // upload retourne en quelques centaines de ms (le temps d'écrire le
      // fichier en stockage et la ligne en DB). L'analyse IA tourne ensuite
      // en arrière-plan et l'instructeur est notifié quand toutes les pièces
      // sont analysées — voir finalize-upload-session ci-dessous.
      if (stagedFiles.length > 0) {
        setUploadProgress({ done: 0, total: stagedFiles.length });
        let done = 0;
        const errors: string[] = [];
        for (const f of stagedFiles) {
          try {
            const fd = new FormData();
            fd.append("file", f.file);
            const code = f.isCerfa ? "CERFA" : guessCodePieceFromName(f.file.name);
            if (code) fd.append("code_piece", code);
            fd.append("nom_piece", f.file.name);
            const res = await fetch(`/api/mairie/dossiers/${created.id}/pieces/upload`, {
              method: "POST",
              credentials: "include",
              body: fd,
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({})) as { error?: string };
              errors.push(`${f.file.name} : ${body.error ?? `Erreur ${res.status}`}`);
            }
          } catch (err) {
            errors.push(`${f.file.name} : ${err instanceof Error ? err.message : "échec"}`);
          } finally {
            done += 1;
            setUploadProgress({ done, total: stagedFiles.length });
          }
        }
        if (errors.length > 0) {
          // Best-effort : on prévient mais on continue vers le détail du dossier
          // pour que l'opérateur voie l'état réel et rejoue les uploads ratés.
          console.warn("[NouveauDossier] uploads en échec :", errors);
        }

        // Signale au back que l'agent a fini de déposer les pièces. Tant que
        // cet appel n'a pas eu lieu, la notification "dossier prêt" reste
        // bloquée — ça évite le faux positif quand l'OCR de la pièce 1 finit
        // avant que la pièce 2 ne soit uploadée.
        try {
          await api.post(`/mairie/dossiers/${created.id}/pieces/finalize-upload-session`, {});
        } catch (err) {
          // Best-effort : l'instructeur recevra quand même la notification au
          // prochain événement sur le dossier, et l'agent voit l'état réel
          // sur l'écran du dossier.
          console.warn("[NouveauDossier] finalize-upload-session:", err);
        }
      }

      onClose();
      routerNavigate(`/mairie/dossiers/${created.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erreur lors de la création");
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };


  const inputStyle = { width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", boxSizing: "border-box" as const, background: "white" };

  if (mode === "choose") return (
    <NouveauDossierOverlay onClose={onClose}>
      <NouveauDossierModalHeader title="Nouveau dossier" onClose={onClose} />
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
    </NouveauDossierOverlay>
  );

  const formFields = (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Type de dossier</label>
        <select value={form.type} onChange={e => setField("type", e.target.value as NouveauDossierType)} style={inputStyle}>
          {DOSSIER_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Prénom du pétitionnaire</label>
          <input value={form.petitionnaire_prenom} onChange={e => setField("petitionnaire_prenom", e.target.value)} placeholder="Jean" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Nom du pétitionnaire *</label>
          <input value={form.petitionnaire_nom} onChange={e => setField("petitionnaire_nom", e.target.value)} placeholder="DUPONT" style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Email du pétitionnaire</label>
        <input type="email" value={form.petitionnaire_email} onChange={e => setField("petitionnaire_email", e.target.value)} placeholder="jean.dupont@example.com" style={inputStyle} />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Adresse du projet</label>
        <input value={form.adresse} onChange={e => setField("adresse", e.target.value)} placeholder="12 rue des Lilas" style={inputStyle} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Code postal</label>
          <input value={form.code_postal} onChange={e => setField("code_postal", e.target.value)} placeholder="37510" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Commune</label>
          <input value={form.commune} onChange={e => setField("commune", e.target.value)} placeholder={commune || "Ballan-Miré"} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Références cadastrales</label>
          <input value={form.parcelle} onChange={e => setField("parcelle", e.target.value)} placeholder="AB 142" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Surface plancher (m²)</label>
          <input value={form.surface_plancher} onChange={e => setField("surface_plancher", e.target.value)} placeholder="95" style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Description du projet</label>
        <textarea value={form.description} onChange={e => setField("description", e.target.value)} rows={2} placeholder="Construction d'une maison individuelle de 95 m²…" style={{ ...inputStyle, resize: "vertical" as const, fontFamily: "inherit" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Date de dépôt</label>
          <input type="date" value={form.date_depot} onChange={e => setField("date_depot", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Instructeur assigné</label>
          <select value={form.instructeur_id} onChange={e => setField("instructeur_id", e.target.value)} style={inputStyle}>
            <option value="">— Non assigné —</option>
            {instructeurs.map(i => <option key={i.id} value={i.id}>{i.prenom} {i.nom}</option>)}
          </select>
        </div>
      </div>
    </div>
  );

  const submitLabel = submitting
    ? (uploadProgress ? `Dépôt ${uploadProgress.done}/${uploadProgress.total}…` : "Création…")
    : (mode === "ocr" && stagedFiles.length > 0 ? `Créer le dossier (${stagedFiles.length} pièce${stagedFiles.length > 1 ? "s" : ""})` : "Créer le dossier");

  const footer = (
    <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E8F0" }}>
      {submitError && (
        <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 12, padding: "8px 12px", borderRadius: 6, marginBottom: 10, border: "1px solid #FECACA" }}>{submitError}</div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onClose} disabled={submitting} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, color: "#374151", cursor: submitting ? "not-allowed" : "pointer", fontWeight: 500, opacity: submitting ? 0.6 : 1 }}>Annuler</button>
        <button onClick={submit} disabled={submitting} style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
          {submitLabel}
        </button>
      </div>
    </div>
  );

  const fileList = stagedFiles.length > 0 && (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", background: "#F8FAFC", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: 0.4, display: "flex", justifyContent: "space-between" }}>
        <span>{stagedFiles.length} fichier{stagedFiles.length > 1 ? "s" : ""}</span>
        <span style={{ textTransform: "none" as const, letterSpacing: 0, fontWeight: 500 }}>Choisissez le CERFA</span>
      </div>
      {stagedFiles.map(f => {
        const code = f.isCerfa ? "CERFA" : guessCodePieceFromName(f.file.name);
        return (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: "1px solid #F1F5F9", fontSize: 13 }}>
            <input type="radio" checked={f.isCerfa} onChange={() => setCerfa(f.id)} title="Désigner comme CERFA" />
            <span style={{ fontSize: 16 }}>{/\.pdf$/i.test(f.file.name) ? "📄" : "🖼️"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#0F172A", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" as const }}>{f.file.name}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                {(f.file.size / 1024).toFixed(0)} Ko
                {code && <> · <span style={{ color: f.isCerfa ? "#4F46E5" : "#64748b", fontWeight: 600 }}>{code}</span></>}
              </div>
            </div>
            <button onClick={() => removeFile(f.id)} title="Retirer" style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, padding: 4 }}>×</button>
          </div>
        );
      })}
      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", borderTop: "1px solid #F1F5F9", background: "#F8FAFC", cursor: "pointer", fontSize: 12, color: "#4F46E5", fontWeight: 600 }}>
        ＋ Ajouter d'autres fichiers
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={e => { if (e.target.files) { addFiles(e.target.files); e.target.value = ""; } }} style={{ display: "none" }} />
      </label>
    </div>
  );

  if (mode === "ocr") return (
    <NouveauDossierOverlay onClose={onClose}>
      <NouveauDossierModalHeader title="Reconnaissance OCR" onClose={onClose} back={() => { setMode("choose"); setStagedFiles([]); setCerfaDone(false); setOcrError(null); setOcrNumero(null); }} />
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column" as const, gap: 16 }}>
        {stagedFiles.length > 0 && !submitting && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8, padding: "10px 14px" }}>
            <span style={{ fontSize: 16 }}>⚡</span>
            <div style={{ fontSize: 12.5, color: "#075985", lineHeight: 1.5 }}>
              Le dépôt prend quelques secondes — l'analyse OCR des pièces tourne ensuite en arrière-plan.
              <strong> L'instructeur reçoit une notification dès que le dossier est entièrement constitué.</strong>
            </div>
          </div>
        )}
        {submitting && uploadProgress && uploadProgress.done >= uploadProgress.total && uploadProgress.total > 0 && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, padding: "10px 14px" }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <div style={{ fontSize: 12.5, color: "#065F46", lineHeight: 1.5 }}>
              Pièces déposées. L'analyse OCR se poursuit en arrière-plan — vous (ou l'instructeur assigné) recevrez une notification dès que tout est prêt.
            </div>
          </div>
        )}
        {stagedFiles.length === 0 ? (
          <>
            <label style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", border: "2px dashed #CBD5E1", borderRadius: 12, padding: "40px 24px", cursor: "pointer", gap: 10, background: "#F8FAFC" }}>
              <span style={{ fontSize: 36 }}>📂</span>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>Déposez vos fichiers ici</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>CERFA + plans + photos — PDF, JPG, PNG (max 25 Mo / fichier)</div>
              <div style={{ background: "#4F46E5", color: "white", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600 }}>Choisir des fichiers</div>
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={e => { if (e.target.files) addFiles(e.target.files); }} style={{ display: "none" }} />
            </label>
            {ocrError && (
              <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 13, padding: "12px 14px", borderRadius: 8, border: "1px solid #FECACA" }}>
                <strong>Échec de l'extraction.</strong> {ocrError}
              </div>
            )}
          </>
        ) : (
          <>
            {fileList}
            {cerfaScanning ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#EEF2FF", borderRadius: 8, padding: "10px 14px", border: "1px solid #C7D2FE" }}>
                <span style={{ fontSize: 18 }}>🔍</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#3730A3" }}>Analyse du CERFA en cours…</div>
                  <div style={{ marginTop: 6, height: 4, background: "#E0E7FF", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: "linear-gradient(90deg,#4F46E5,#6366F1)", borderRadius: 2, width: "60%" }} />
                  </div>
                </div>
              </div>
            ) : ocrError ? (
              <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 13, padding: "12px 14px", borderRadius: 8, border: "1px solid #FECACA" }}>
                <strong>L'extraction du CERFA a échoué.</strong> {ocrError} Vous pouvez quand même remplir le formulaire à la main et créer le dossier — toutes les pièces seront jointes.
              </div>
            ) : cerfaDone ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F0FDF4", borderRadius: 8, padding: "10px 14px", border: "1px solid #BBF7D0" }}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div style={{ fontSize: 13, color: "#15803D", fontWeight: 500 }}>
                  Données extraites du CERFA{ocrNumero ? ` n° ${ocrNumero}` : ""}. Vérifiez et corrigez si besoin.
                </div>
              </div>
            ) : null}
            {formFields}
          </>
        )}
      </div>
      {stagedFiles.length > 0 && footer}
    </NouveauDossierOverlay>
  );

  return (
    <NouveauDossierOverlay onClose={onClose}>
      <NouveauDossierModalHeader title="Nouveau dossier — Saisie manuelle" onClose={onClose} back={() => setMode("choose")} />
      <div style={{ padding: "20px 24px" }}>{formFields}</div>
      {footer}
    </NouveauDossierOverlay>
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
      date_completude: string | null;
      metadata: Record<string, unknown> | null;
      instructeur_id: string | null;
      demandeur: { prenom?: string; nom?: string } | null;
      instructeur: { prenom?: string; nom?: string } | null;
      workflow?: WorkflowMeta;
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
          date_completude: data.date_completude ?? undefined,
          delai: (meta["delai"] as DelaiBreakdown | undefined) ?? null,
          description: data.description ?? undefined,
          parcelle: data.parcelle ?? undefined,
          surface_plancher: data.surface_plancher ?? undefined,
          commune: data.commune ?? undefined,
          code_postal: data.code_postal ?? undefined,
          instructeur: data.instructeur ? ([data.instructeur.prenom, data.instructeur.nom].filter(Boolean).join(" ") || undefined) : undefined,
          instructeur_id: data.instructeur_id ?? undefined,
          workflow: data.workflow,
          lat: isNaN(lat) ? undefined : lat,
          lng: isNaN(lng) ? undefined : lng,
          cachedParcelAnalysis: (meta["parcel_analysis"] && typeof meta["parcel_analysis"] === "object")
            ? (meta["parcel_analysis"] as Record<string, unknown>)
            : null,
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

function NoCommuneAssignedScreen({ prenom }: { prenom: string }) {
  const { logout } = useAuth();
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#F8F9FC", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 480, background: "white", borderRadius: 16, border: "1px solid #E2E8F0", padding: 40, boxShadow: "0 4px 20px rgba(0,0,0,0.06)", textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg, #EEF2FF, #E0E7FF)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
          </svg>
        </div>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#0F172A" }}>
          Bienvenue{prenom ? `, ${prenom}` : ""}
        </h1>
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
          Votre compte Heurekia est bien activé.
        </p>
        <p style={{ margin: "0 0 28px", fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
          L'accès à votre espace sera disponible dès qu'un administrateur vous aura rattaché à une commune. Cette étape ne prend généralement que quelques instants — n'hésitez pas à contacter votre référent si l'attente se prolonge.
        </p>
        <button
          onClick={() => { logout(); }}
          style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 600, color: "#475569", cursor: "pointer" }}
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

export function MairieApp() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canManageUsers = user?.role === "admin" || user?.role === "mairie";
  const [commune, setCommuteRaw] = useState(user?.commune ?? "");
  const [userCommunes, setUserCommunes] = useState<string[]>([]);
  const [communesLoaded, setCommunesLoaded] = useState(false);
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
      .catch(() => {})
      .finally(() => setCommunesLoaded(true));
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

  if (communesLoaded && userCommunes.length === 0) {
    return <NoCommuneAssignedScreen prenom={user?.prenom ?? ""} />;
  }

  // Tant que la liste des communes accessibles n'est pas chargée, on n'affiche
  // rien — sinon les écrans rendent avec `commune=""` ou la commune principale
  // par défaut, ce qui provoque un flash de carte centrée sur Ballan-Miré
  // avant que localStorage restaure la dernière commune sélectionnée.
  if (!communesLoaded) {
    return (
      <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#F8F9FC", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 13 }}>
        Chargement…
      </div>
    );
  }

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
      {showNouveauDossier && <NouveauDossierModal onClose={() => setShowNouveauDossier(false)} commune={commune} />}
    </div>
  );
}
