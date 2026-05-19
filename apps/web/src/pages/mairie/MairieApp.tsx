import { useState, useRef, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { MapLeaflet, type MapDossier } from "../../components/MapLeaflet";
import { api } from "../../lib/api";

const NAV_ITEMS = [
  { label: "Tableau de bord", icon: HomeIcon, path: "/mairie" },
  { label: "Dossiers", icon: FolderIcon, path: "/mairie/dossiers" },
  { label: "Calendrier", icon: CalendarIcon, path: "/mairie/calendrier" },
  { label: "Messagerie", icon: MessageIcon, badge: 2, path: "/mairie/messagerie" },
  { label: "Carte", icon: MapIcon, path: "/mairie/carte" },
  { label: "Statistiques", icon: ChartIcon, path: "/mairie/statistiques" },
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

function Sidebar({ active, setActive, commune, setCommune }: { active: string; setActive: (s: string) => void; commune: string; setCommune: (c: string) => void }) {
  const [showDrop, setShowDrop] = useState(false);
  const communes = ["Ballan-Miré", "Saint-Avertin", "Joué-lès-Tours", "La Riche"];
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
          <span style={{ color: "white", fontWeight: 800, fontSize: 15, letterSpacing: "0.04em" }}>HEUREKA</span>
        </div>
        {/* Commune selector */}
        <div style={{ position: "relative" }}>
          <div onClick={() => setShowDrop(!showDrop)} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            <BuildingIcon size={14} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1 }}>Commune de</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4 }}>{commune}</div>
            </div>
            <ChevronDownIcon size={12} />
          </div>
          {showDrop && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#1a2540", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 200, overflow: "hidden" }}>
              {communes.map(c => (
                <button key={c} onClick={() => { setCommune(c); setShowDrop(false); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left" as const, fontSize: 12, color: c === commune ? "#818cf8" : "#94a3b8", fontWeight: c === commune ? 600 : 400 }}>
                  <BuildingIcon size={12} />{c}
                  {c === commune && <span style={{ marginLeft: "auto", color: "#818cf8" }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <nav style={{ flex: 1, padding: "4px 10px", overflowY: "auto" }}>
        {NAV_ITEMS.map(({ label, icon: Icon, badge }) => {
          const isActive = active === label;
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
              {badge && (
                <span style={{ background: isActive ? "rgba(255,255,255,0.25)" : "#4F46E5", color: "white", fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div onClick={() => setActive("Infos Perso")} style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <div style={{ width: 34, height: 34, background: "linear-gradient(135deg, #4F46E5, #7C3AED)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "white", flexShrink: 0 }}>ML</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "white", fontSize: 12, fontWeight: 600 }}>Marie L.</div>
          <div style={{ color: "#64748b", fontSize: 11 }}>Instructrice</div>
        </div>
        <ArrowRightIcon size={12} />
      </div>
    </aside>
  );
}

function Topbar({ buttonLabel = "Nouveau dossier", onNewDossier, navigate, onDossierClick }: { title?: string; buttonLabel?: string; onNewDossier?: () => void; navigate?: (s: string) => void; onDossierClick?: (d: DossierInfo) => void }) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [faqQuery, setFaqQuery] = useState("");
  const [faqAnswer, setFaqAnswer] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<ApiDossier[]>([]);
  const notifs = [
    { icon: "📁", text: "Nouveau dossier PC-2024-0801 déposé", sub: "Il y a 12 min", color: "#4F46E5" },
    { icon: "💬", text: "Nouveau message de Jean Dupont", sub: "Il y a 1h", color: "#4F46E5" },
    { icon: "⏰", text: "Délai dépassé — DP-2024-0111", sub: "Hier", color: "#EF4444" },
  ];

  useEffect(() => {
    if (searchQuery.length <= 1) { setSearchResults([]); return; }
    const timer = setTimeout(() => {
      api.get<ApiDossier[]>(`/mairie/dossiers?search=${encodeURIComponent(searchQuery)}`)
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
          <button onClick={() => { setShowNotifs(!showNotifs); setShowFAQ(false); }} style={{ border: "none", background: showNotifs ? "#F1F5F9" : "none", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", padding: 6, borderRadius: 6 }}>
            <BellIcon size={20} />
          </button>
          <span style={{ position: "absolute", top: 2, right: 2, width: 16, height: 16, background: "#EF4444", borderRadius: "50%", fontSize: 9, fontWeight: 700, color: "white", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>3</span>
          {showNotifs && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, background: "white", borderRadius: 12, border: "1px solid #E2E8F0", boxShadow: "0 8px 24px rgba(0,0,0,0.14)", zIndex: 200 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Notifications</span>
                <button style={{ border: "none", background: "none", fontSize: 11, color: "#4F46E5", cursor: "pointer" }}>Tout marquer lu</button>
              </div>
              {notifs.map((n, i) => (
                <div key={i} style={{ padding: "10px 16px", display: "flex", alignItems: "flex-start", gap: 10, borderBottom: "1px solid #F8FAFC", cursor: "pointer" }} onClick={closeAll}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: n.color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{n.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#0F172A", fontWeight: 500 }}>{n.text}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{n.sub}</div>
                  </div>
                </div>
              ))}
              <div style={{ padding: "10px 16px", textAlign: "center" }}>
                <button style={{ border: "none", background: "none", fontSize: 12, color: "#4F46E5", cursor: "pointer" }}>Voir toutes les notifications</button>
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

const FALLBACK: MapDossier[] = [
  { id: "1", numero: "PC-BM-2024-001", type: "permis_de_construire", status: "en_instruction", adresse: "3 Place du 8 Mai 1945", lat: 47.3543, lng: 0.5503 },
  { id: "2", numero: "DP-BM-2024-015", type: "declaration_prealable", status: "soumis", adresse: "12 Avenue de Tours", lat: 47.3562, lng: 0.5490 },
  { id: "3", numero: "PC-BM-2024-022", type: "permis_de_construire", status: "en_instruction", adresse: "5 Rue des Petits Prés", lat: 47.3518, lng: 0.5537 },
  { id: "4", numero: "DP-BM-2024-008", type: "declaration_prealable", status: "incomplet", adresse: "8 Chemin de la Halbardière", lat: 47.3488, lng: 0.5562 },
  { id: "5", numero: "PC-BM-2023-044", type: "permis_de_construire", status: "accepte", adresse: "14 Rue du Moulin de la Planche", lat: 47.3558, lng: 0.5448 },
  { id: "6", numero: "DP-BM-2024-033", type: "declaration_prealable", status: "decision_en_cours", adresse: "2 Impasse des Lilas", lat: 47.3525, lng: 0.5448 },
  { id: "7", numero: "CU-BM-2024-007", type: "certificat_urbanisme", status: "soumis", adresse: "28 Route de Savonnières", lat: 47.3475, lng: 0.5415 },
  { id: "8", numero: "PC-BM-2024-041", type: "permis_de_construire", status: "refuse", adresse: "11 Rue du Val de l'Indre", lat: 47.3510, lng: 0.5592 },
  { id: "9", numero: "DP-BM-2024-019", type: "declaration_prealable", status: "pre_instruction", adresse: "45 Rue de la Liberté", lat: 47.3548, lng: 0.5518 },
];

function DashboardScreen({ navigate, navigateDossiers, commune, onDossierClick }: { navigate: (s: string) => void; navigateDossiers: (filter: string) => void; commune: string; onDossierClick: (d: DossierInfo) => void }) {
  const [mapFilter, setMapFilter] = useState<string>("Tous");
  const [mapTypeFilter, setMapTypeFilter] = useState("Tous les types");
  const [mapDossiers, setMapDossiers] = useState<MapDossier[]>([]);
  const [statsByStatus, setStatsByStatus] = useState<Record<string, number>>({});
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    const FALLBACK: MapDossier[] = [
      { id: "1", numero: "PC-BM-2024-001", type: "permis_de_construire", status: "en_instruction", adresse: "12 Place du 11-Novembre, Ballan-Miré", lat: 47.3551, lng: 0.5497 },
      { id: "2", numero: "DP-BM-2024-015", type: "declaration_prealable", status: "soumis", adresse: "9 Avenue Jean Mermoz, Ballan-Miré", lat: 47.3538, lng: 0.5512 },
      { id: "3", numero: "PC-BM-2024-022", type: "permis_de_construire", status: "en_instruction", adresse: "2 Avenue de l'Orée-des-Bois, Ballan-Miré", lat: 47.3524, lng: 0.5531 },
      { id: "4", numero: "DP-BM-2024-008", type: "declaration_prealable", status: "incomplet", adresse: "9 Rue Jean Mermoz, Ballan-Miré", lat: 47.3540, lng: 0.5508 },
      { id: "5", numero: "PC-BM-2023-044", type: "permis_de_construire", status: "accepte", adresse: "Avenue Jean Mermoz, Ballan-Miré", lat: 47.3535, lng: 0.5520 },
      { id: "6", numero: "DP-BM-2024-033", type: "declaration_prealable", status: "decision_en_cours", adresse: "Place du 11-Novembre, Ballan-Miré", lat: 47.3553, lng: 0.5495 },
      { id: "7", numero: "CU-BM-2024-007", type: "certificat_urbanisme", status: "soumis", adresse: "Rue de la Houssaye, Ballan-Miré", lat: 47.3562, lng: 0.5475 },
      { id: "8", numero: "PC-BM-2024-041", type: "permis_de_construire", status: "refuse", adresse: "Rue du Commerce, Ballan-Miré", lat: 47.3546, lng: 0.5503 },
      { id: "9", numero: "DP-BM-2024-019", type: "declaration_prealable", status: "pre_instruction", adresse: "Rue du Val de l'Indre, Ballan-Miré", lat: 47.3510, lng: 0.5560 },
    ];
    api.get<MapDossier[]>("/mairie/map-dossiers?commune=Ballan-Mir%C3%A9")
      .then(data => setMapDossiers(data.length > 0 ? data : FALLBACK))
      .catch(() => setMapDossiers(FALLBACK));

    api.get<{ dossiers_par_statut: { status: string; count: number }[] }>("/mairie/dashboard")
      .then(data => {
        const map: Record<string, number> = {};
        data.dossiers_par_statut.forEach(r => { map[r.status] = Number(r.count); });
        setStatsByStatus(map);
      })
      .catch(() => {});

    api.get<{ count: number }>("/mairie/conversations/unread-count")
      .then(data => setUnreadMessages(Number(data.count)))
      .catch(() => {});
  }, []);
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
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#0F172A", margin: "0 0 4px" }}>Bonjour Marie,</h1>
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

function DossiersScreen({ onDossierClick }: { onDossierClick: (d: DossierInfo) => void }) {
  const tabs = ["Tous", "Nouveau", "En instruction", "Pré-instruction", "Incomplet", "Décision en cours", "Accepté", "Refusé"];
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("filter") ?? "Tous");

  useEffect(() => {
    setActiveTab(searchParams.get("filter") ?? "Tous");
  }, [searchParams]);
  const [searchQ, setSearchQ] = useState("");
  const [apiDossiers, setApiDossiers] = useState<ApiDossier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<ApiDossier[]>("/mairie/dossiers")
      .then(d => setApiDossiers(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Dossiers</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Retrouvez et suivez l'avancement de tous les dossiers.</p>
      </div>
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
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Rechercher un dossier, une adresse, un pétitionnaire..." style={{ width: "100%", padding: "7px 12px 7px 32px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", color: "#374151" }} />
        </div>
        {["Tous les types", "Tous les secteurs"].map(p => (
          <select key={p} style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", background: "white", cursor: "pointer" }}>
            <option>{p}</option>
          </select>
        ))}
        <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "7px 12px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>+ Plus de filtres</button>
        <div style={{ flex: 1 }} />
        <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "7px 12px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>↕ Trier</button>
      </div>
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC" }}>
              {["N° Dossier","Pétitionnaire","Adresse","Type de dossier","Statut","Dépôt","Actions"].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Chargement…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Aucun dossier trouvé</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #F1F5F9", cursor: "pointer" }}
                onClick={() => onDossierClick({ id: r.id, numero: r.numero, type: r.type, petitionnaire: r.pet, adresse: r.addr, status: r.statusRaw, echeance: r.ech, date_depot: r.dateDepot })}
                onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                onMouseLeave={e => (e.currentTarget.style.background = "white")}>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "#4F46E5" }}>{r.numero}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.pet}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#64748b" }}>{r.addr}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.type}</td>
                <td style={{ padding: "12px 16px" }}><StatusBadge status={r.statusRaw} /></td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.dateDepot}</td>
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

function MessageScreen({ onDossierClick }: { onDossierClick: (d: DossierInfo) => void }) {
  type Conv = { dossier_id: string; numero: string; type: string; status: string; petitionnaire: string; last_content: string; last_from_role: string; last_at: string; unread_count: number };
  type Msg = { id: string; content: string; from_role: string; created_at: string; prenom: string | null; nom: string | null };

  const [tab, setTab] = useState("Citoyens");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);

  useEffect(() => {
    api.get<Conv[]>("/mairie/conversations").then(data => {
      setConvs(data);
      if (data.length > 0) setSelected(s => s ?? (data[0] ?? null));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    api.get<Msg[]>(`/mairie/conversations/${selected.dossier_id}`).then(setThread).catch(() => {});
  }, [selected]);

  const serviceConvs = [
    { name: "ABF – Architecte des Bâtiments de France", dossier: "PC-2024-0123", preview: "Avis favorable avec réserves transmis.", time: "10:30", badge: 1, initials: "AB", color: "#8B5CF6" },
    { name: "SDIS – Service Incendie", dossier: "PC-2024-0456", preview: "Consultation en cours d'examen.", time: "Hier", initials: "SD", color: "#EF4444" },
    { name: "Métropole Tours Val de Loire", dossier: "PC-2024-0166", preview: "Retour attendu avant le 17/05.", time: "Hier", initials: "MT", color: "#F97316" },
    { name: "DREAL Centre-Val de Loire", dossier: "PC-2024-0789", preview: "Documents bien reçus, analyse en cours.", time: "14/05", initials: "DR", color: "#22C55E" },
    { name: "Service des Eaux", dossier: "DP-2024-0089", preview: "Avis favorable émis.", time: "13/05", initials: "SE", color: "#3B82F6" },
  ];

  const totalUnread = convs.reduce((s, c) => s + c.unread_count, 0);

  return (
    <div style={{ padding: 0, display: "flex", height: "calc(100vh - 56px)" }}>
      {/* ── Liste conversations ── */}
      <div style={{ width: 320, borderRight: "1px solid #E2E8F0", display: "flex", flexDirection: "column", background: "white" }}>
        <div style={{ padding: "20px 16px 0" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Messagerie</h1>
          <p style={{ color: "#94A3B8", fontSize: 12, marginBottom: 12 }}>Échangez avec les pétitionnaires et les services consultés.</p>
          <div style={{ display: "flex", gap: 0, marginBottom: 12 }}>
            {[`Citoyens${totalUnread > 0 ? ` ${totalUnread}` : ""}`, "Services / Consultations"].map((t) => {
              const base = t.split(" ")[0] ?? t;
              return (
                <button key={t} onClick={() => setTab(base)} style={{ flex: 1, border: "none", background: "none", padding: "7px 8px", fontSize: 12, fontWeight: tab === base ? 600 : 400, color: tab === base ? "#4F46E5" : "#64748b", borderBottom: tab === base ? "2px solid #4F46E5" : "2px solid #E2E8F0", cursor: "pointer", whiteSpace: "nowrap" }}>{t}</button>
              );
            })}
          </div>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input placeholder="Rechercher une conversation" style={{ width: "100%", padding: "7px 12px 7px 28px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, outline: "none" }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {tab === "Citoyens" ? convs.map((c) => {
            const isActive = selected?.dossier_id === c.dossier_id;
            const color = stringToColor(c.petitionnaire);
            return (
              <div key={c.dossier_id} onClick={() => setSelected(c)} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #F8FAFC", background: isActive ? "#F0F4FF" : "white" }}
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
          }) : serviceConvs.map((c, i) => (
            <div key={i} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #F8FAFC", background: i === 0 ? "#F0F4FF" : "white" }}
              onMouseEnter={e => { if (i !== 0) (e.currentTarget as HTMLDivElement).style.background = "#F8FAFC"; }}
              onMouseLeave={e => { if (i !== 0) (e.currentTarget as HTMLDivElement).style.background = "white"; }}>
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
                {c.badge && <span style={{ background: "#4F46E5", color: "white", borderRadius: "50%", width: 18, height: 18, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{c.badge}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Thread ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#FAFBFD" }}>
        {selected ? (<>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{selected.petitionnaire}</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>{selected.numero} – {TYPE_LABEL[selected.type] ?? selected.type}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onDossierClick({ id: selected.dossier_id, numero: selected.numero, type: selected.type, petitionnaire: selected.petitionnaire, adresse: "—", status: selected.status, echeance: "—" })} style={{ padding: "6px 12px", background: "white", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, color: "#374151", cursor: "pointer" }}>Voir le dossier ↗</button>
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
        {selected ? (<>
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

function ParametresScreen() {
  const settingsTabs = ["Général", "Utilisateurs", "Documents", "Workflow & Délais", "Notifications", "Intégrations"];
  const [stab, setStab] = useState("Notifications");
  const events = [
    { label: "Nouveau dossier déposé", sub: "Lorsqu'un nouveau dossier est déposé par un pétitionnaire.", icon: "📋", active: true },
    { label: "Dossier assigné", sub: "Lorsqu'un dossier vous est assigné.", icon: "👤", active: true },
    { label: "Demande de pièces", sub: "Lorsqu'une demande de pièces complémentaires est envoyée.", icon: "📎", active: true },
    { label: "Pièce complémentaire reçue", sub: "Lorsqu'une pièce complémentaire est déposée.", icon: "⬇️", active: true },
    { label: "Avis émis", sub: "Lorsqu'un avis est émis sur un dossier.", icon: "💬", active: true },
    { label: "Décision prise", sub: "Lorsqu'une décision est prise sur un dossier.", icon: "✅", active: true },
    { label: "Délai dépassé", sub: "Lorsqu'un délai de traitement est dépassé.", icon: "⚠️", active: true },
    { label: "Commentaire sur un dossier", sub: "Lorsqu'un commentaire est ajouté sur un dossier.", icon: "💭", active: true },
  ];
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
      {stab === "Notifications" && (
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ flex: 1, background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Gestion des notifications</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>Configurez les notifications envoyées par la plateforme.</div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["Par événement", "Par canal"].map((t, i) => (
                <button key={t} style={{ border: "1px solid #E2E8F0", borderRadius: 8, background: i === 0 ? "#EEF2FF" : "white", color: i === 0 ? "#4F46E5" : "#64748b", padding: "6px 14px", fontSize: 13, fontWeight: i === 0 ? 600 : 400, cursor: "pointer" }}>{t}</button>
              ))}
            </div>
            <input placeholder="Rechercher un événement..." style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", marginBottom: 12 }} />
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
              <span>ÉVÉNEMENT</span><span>ACTIVÉ</span>
            </div>
            {events.map((ev) => (
              <div key={ev.label} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F8FAFC" }}>
                <span style={{ fontSize: 18, marginRight: 10 }}>{ev.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{ev.label}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{ev.sub}</div>
                </div>
                <div style={{ width: 36, height: 20, borderRadius: 10, background: ev.active ? "#4F46E5" : "#E2E8F0", position: "relative", cursor: "pointer", flexShrink: 0, marginRight: 8 }}>
                  <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: ev.active ? 18 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                </div>
                <span style={{ color: "#CBD5E1" }}>›</span>
              </div>
            ))}
            <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>8 événements</div>
          </div>
          <div style={{ width: 340, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Canaux de notification</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>Sélectionnez les canaux que vous souhaitez utiliser.</div>
              {[{ icon: "✉️", label: "Email", sub: "Recevoir les notifications par email.", active: true }, { icon: "🔔", label: "Plateforme", sub: "Notifications dans la plateforme.", active: true }, { icon: "💬", label: "SMS", sub: "Recevoir les notifications par SMS.", active: false }].map(c => (
                <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: 8, background: "#F8FAFC", borderRadius: 8 }}>
                  <span style={{ fontSize: 16 }}>{c.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{c.label}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{c.sub}</div>
                  </div>
                  <div style={{ width: 32, height: 18, borderRadius: 9, background: c.active ? "#4F46E5" : "#E2E8F0", position: "relative", cursor: "pointer" }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: c.active ? 16 : 2, transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Destinataires</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>Choisissez qui reçoit les notifications.</div>
              {[{ label: "Utilisateurs concernés uniquement", sub: "Seuls les utilisateurs liés au dossier reçoivent les notifications.", active: true }, { label: "Tous les instructeurs", sub: "Tous les instructeurs de la commune reçoivent les notifications.", active: false }, { label: "Personnaliser", sub: "Choisir les utilisateurs qui recevront les notifications.", active: false }].map(d => (
                <div key={d.label} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 1, border: d.active ? "5px solid #4F46E5" : "2px solid #CBD5E1", background: "white" }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "#0F172A" }}>{d.label}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{d.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Plages horaires</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>Définissez les horaires d'envoi des notifications.</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>De</span>
                <select style={{ padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12 }}><option>08:00</option></select>
                <span style={{ fontSize: 12, color: "#64748b" }}>à</span>
                <select style={{ padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12 }}><option>18:00</option></select>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Les notifications en dehors de cette plage seront envoyées le jour ouvré suivant.</div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Réinitialiser</button>
              <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Enregistrer les modifications</button>
            </div>
          </div>
        </div>
      )}
      {stab === "Utilisateurs" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>Utilisateurs</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>Gérez les comptes et les accès des utilisateurs de la commune.</div>
            </div>
            <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Ajouter un utilisateur</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
            {[["18","Utilisateurs",""],["15","Comptes actifs","Actifs 83%"],["2","En attente","11%"],["1","Désactivé","6%"]].map(([n,l,s]) => (
              <div key={l} style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: "#0F172A" }}>{n}</span>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{l}</div>
                  {s && <div style={{ fontSize: 11, color: "#22C55E", fontWeight: 600 }}>{s}</div>}
                </div>
              </div>
            ))}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["Nom & Prénom","E-mail","Rôle","Services / Accès","Statut","Dernière connexion","Actions"].map(h => (
                  <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { init:"ML", name:"Marie L.", you:true, email:"marie.l@saint-martin.fr", role:"Instructrice", service:"Urbanisme, ADS", status:"Actif", conn:"20 mai 2024 à 09:15" },
                { init:"JD", name:"Julien D.", email:"julien.d@saint-martin.fr", role:"Responsable", service:"Urbanisme, ADS, Voirie", status:"Actif", conn:"20 mai 2024 à 08:42" },
                { init:"CP", name:"Claire P.", email:"claire.p@saint-martin.fr", role:"Instructrice", service:"Urbanisme, ADS", status:"Actif", conn:"17 mai 2024 à 16:30" },
                { init:"FG", name:"Florent G.", email:"florent.g@saint-martin.fr", role:"Consultation", service:"Environnement", status:"En attente", conn:"–" },
                { init:"NA", name:"Nadia A.", email:"nadia.a@saint-martin.fr", role:"Instructrice", service:"Urbanisme, ADS", status:"Désactivé", conn:"12 avr. 2024 à 10:11" },
              ].map((u) => (
                <tr key={u.email} style={{ borderBottom: "1px solid #F8FAFC" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "white", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{u.init}</div>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</span>
                      {u.you && <span style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: 10, borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>Vous</span>}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>{u.email}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12 }}>{u.role}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>{u.service}</td>
                  <td style={{ padding: "10px 12px" }}><StatusBadge status={u.status} /></td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>{u.conn}</td>
                  <td style={{ padding: "10px 12px" }}><button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}><DotsIcon /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {stab === "Documents" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>Gestion des modèles de documents</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>Configurez les modèles de courriers, arrêtés et formulaires utilisés par la commune.</div>
            </div>
            <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Nouveau modèle</button>
          </div>
          {[
            { name: "Accusé de réception", type: "Courrier", format: "DOCX", updated: "12/05/2024", status: "Actif" },
            { name: "Demande de pièces complémentaires", type: "Courrier", format: "DOCX", updated: "02/05/2024", status: "Actif" },
            { name: "Arrêté de permis de construire", type: "Arrêté", format: "PDF", updated: "28/04/2024", status: "Actif" },
            { name: "Arrêté de refus", type: "Arrêté", format: "PDF", updated: "15/04/2024", status: "Actif" },
            { name: "Notification de décision", type: "Courrier", format: "DOCX", updated: "10/04/2024", status: "Actif" },
            { name: "Mise en demeure", type: "Courrier", format: "DOCX", updated: "01/04/2024", status: "Désactivé" },
          ].map((doc, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #F8FAFC" }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{doc.name}</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{doc.type} · {doc.format} · Modifié le {doc.updated}</div>
              </div>
              <StatusBadge status={doc.status} />
              <div style={{ display: "flex", gap: 6 }}>
                <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "5px 10px", fontSize: 12, color: "#4F46E5", cursor: "pointer" }}>Éditer</button>
                <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", padding: 4 }}><DotsIcon /></button>
              </div>
            </div>
          ))}
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
      {stab === "Général" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>Informations générales de la commune</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[["Nom de la commune","Ballan-Miré"],["Code INSEE","37015"],["Département","Indre-et-Loire (37)"],["Région","Centre-Val de Loire"],["Population","7 800 habitants"],["Surface","30,7 km²"],["Email contact","urbanisme@ballan-mire.fr"],["Téléphone","02 47 67 XX XX"]].map(([l,v]) => (
              <div key={l}>
                <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{l}</div>
                <input defaultValue={v} style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none" }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
            <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
            <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CarteScreen() {
  const zones = ["Toutes les zones", "UA - Centre ancien", "UB - Zone urbaine mixte", "1AU - À urbaniser (court terme)", "2AU - À urbaniser (long terme)", "UE - Équipements publics", "A - Agricole", "N - Naturelle"];
  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Carte</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Visualisez la répartition des dossiers sur le territoire et filtrez par zone du PLU.</p>
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        {[{ icon: "🗂", n: 128, label: "Dossiers au total" }, { icon: "🆕", n: 28, label: "Nouveaux dossiers" }, { icon: "🏗", n: 68, label: "En instruction" }, { icon: "💬", n: 24, label: "Consultations" }, { icon: "⏰", n: 8, label: "En retard" }].map(s => (
          <div key={s.label} style={{ background: "white", borderRadius: 10, border: "1px solid #E2E8F0", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            <span style={{ fontSize: 16 }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>{s.n}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1, background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 8 }}>
            <select style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: "5px 10px", fontSize: 12 }}><option>Vue par zone PLU</option></select>
          </div>
          <div style={{ position: "relative", height: 480, background: "linear-gradient(160deg, #d4edda 0%, #b8dfc8 40%, #a8d4c0 70%, #d4edda 100%)" }}>
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 600 480">
              <polygon points="300,60 450,100 480,240 380,380 200,380 120,240 180,100" fill="rgba(99,102,241,0.15)" stroke="rgba(99,102,241,0.4)" strokeWidth="2" />
              <polygon points="180,100 300,60 300,240 200,280 150,200" fill="rgba(34,197,94,0.15)" stroke="rgba(34,197,94,0.4)" strokeWidth="2" />
              <polygon points="300,60 450,100 420,240 300,240" fill="rgba(249,115,22,0.15)" stroke="rgba(249,115,22,0.4)" strokeWidth="2" />
              <polygon points="120,240 200,280 200,380 100,360" fill="rgba(236,72,153,0.15)" stroke="rgba(236,72,153,0.4)" strokeWidth="2" />
              <polygon points="300,240 420,240 380,380 200,380 200,280" fill="rgba(234,179,8,0.15)" stroke="rgba(234,179,8,0.4)" strokeWidth="2" />
              <text x="260" y="170" fontSize="13" fontWeight="700" fill="rgba(99,102,241,0.8)">UA</text>
              <text x="180" y="150" fontSize="12" fontWeight="600" fill="rgba(34,197,94,0.8)">UB</text>
              <text x="370" y="170" fontSize="12" fontWeight="600" fill="rgba(249,115,22,0.8)">1AU</text>
              <text x="270" y="310" fontSize="12" fontWeight="600" fill="rgba(234,179,8,0.8)">2AU</text>
              <text x="460" y="290" fontSize="12" fontWeight="600" fill="rgba(148,163,184,0.8)">UE</text>
            </svg>
            {[{ top: "25%", left: "35%", color: "#4F46E5", n: 7 }, { top: "38%", left: "52%", color: "#F97316", n: 3 }, { top: "45%", left: "65%", color: "#EF4444", n: 2 }, { top: "58%", left: "42%", color: "#22C55E", n: 4 }, { top: "65%", left: "32%", color: "#22C55E", n: 5 }, { top: "55%", left: "76%", color: "#22C55E", n: 6 }].map((m, i) => (
              <div key={i} style={{ position: "absolute", top: m.top, left: m.left, width: 30, height: 30, borderRadius: "50%", background: m.color, color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 3px 8px rgba(0,0,0,0.25)", border: "2px solid white" }}>{m.n}</div>
            ))}
            <div style={{ position: "absolute", bottom: 12, left: 12, background: "white", borderRadius: 10, padding: "10px 12px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", fontSize: 11 }}>
              {[["#4F46E5","Nouveau"],["#22C55E","Instruction"],["#F97316","Consultation"],["#EF4444","Retard"],["#8B5CF6","Pièce manquante"],["#94A3B8","Terminé"]].map(([c,l]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block", flexShrink: 0 }} />
                  <span style={{ color: "#374151" }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ width: 240 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Filtres</span>
              <button style={{ fontSize: 12, color: "#4F46E5", background: "none", border: "none", cursor: "pointer" }}>Réinitialiser</button>
            </div>
            {[["Types de dossier","Tous"],["Statut","Tous"],["Services / Organismes","Tous"]].map(([l,v]) => (
              <div key={l} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{l}</div>
                <select style={{ width: "100%", padding: "6px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12 }}><option>{v}</option></select>
              </div>
            ))}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Zone PLU</div>
              <select style={{ width: "100%", padding: "6px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12 }}>
                {zones.map(z => <option key={z}>{z}</option>)}
              </select>
            </div>
            <button style={{ width: "100%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Appliquer les filtres</button>
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Dossiers dans cette zone</div>
            <span style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: 11, borderRadius: 6, padding: "2px 8px", fontWeight: 600, display: "inline-block", marginBottom: 8 }}>UA - Centre ancien</span>
            <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "right", marginBottom: 8 }}>12 dossiers</div>
            {[{ id: "PC-2024-0123", addr: "12 rue des Lilas", status: "En instruction", dist: "150 m" }, { id: "DP-2024-0089", addr: "7 impasse des Chênes", status: "Nouveau", dist: "280 m" }, { id: "PC-2024-0456", addr: "23 avenue de la Mer", status: "En consultation", dist: "450 m" }].map(d => (
              <div key={d.id} style={{ padding: "8px 0", borderBottom: "1px solid #F8FAFC" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#4F46E5" }}>{d.id}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{d.dist}</span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>{d.addr}</div>
                <StatusBadge status={d.status} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendrierScreen() {
  const days = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."];
  type CalCell = { color: string; text: string } | null;
  const grid: CalCell[][] = [
    [null, null, { color:"#22C55E", text:"PC-2024-0789\nFin instruction" }, { color:"#F97316", text:"Consultation ABF\nPC-2024-0123\nFin : 02/05" }, null, null, null],
    [null, { color:"#8B5CF6", text:"Pièce manquante\nDP-2024-0089\nRéponse attendue" }, null, { color:"#F97316", text:"Consultation SDIS\nPC-2024-0456\nFin : 09/05" }, null, null, null],
    [{ color:"#4F46E5", text:"Nouveau dossier\nPC-2024-0798\nOuverture instruction" }, null, { color:"#EF4444", text:"Délai dépassé\nPC-2023-0567\nInstruction dépassée\ndepuis 2 jours" }, null, { color:"#F97316", text:"Consultation Métropole\nPC-2024-0166\nFin : 17/05" }, null, null],
    [null, null, { color:"#F97316", text:"Consultation ABF\nPC-2024-0123\nRelance à faire" }, null, { color:"#8B5CF6", text:"Pièce manquante\nDP-2024-0451\nRéponse attendue" }, null, null],
    [null, { color:"#F97316", text:"Consultation Eau\nPC-2024-0222\nFin : 28/05" }, null, { color:"#22C55E", text:"Fin instruction\nPC-2024-0789" }, { color:"#EF4444", text:"Délai dépassé\nDP-2024-0090" }, null, null],
  ];
  const weekNums = [29, 6, 13, 20, 27];
  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Calendrier</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Visualisez les échéances et planifiez vos tâches.</p>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "5px 10px", cursor: "pointer", color: "#64748b" }}>‹</button>
            <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "5px 10px", cursor: "pointer", color: "#64748b" }}>›</button>
            <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>Aujourd'hui</button>
            <div style={{ marginLeft: 4, display: "flex", alignItems: "center", gap: 4, fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
              Mai 2024 <ChevronDownIcon />
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 4 }}>
              {["Mois","Semaine","Tous les types"].map((t, i) => (
                <button key={t} style={{ border: "1px solid #E2E8F0", background: i === 0 ? "#4F46E5" : "white", color: i === 0 ? "white" : "#64748b", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>{t}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            {[["#4F46E5","Nouveau dossier"],["#22C55E","Instruction en cours"],["#F97316","Consultation externe"],["#EF4444","Retard / Délai dépassé"],["#8B5CF6","Pièce manquante"],["#94A3B8","Terminé"]].map(([c,l]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />
                {l}
              </div>
            ))}
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: "1px solid #E2E8F0" }}>
              {days.map(d => (
                <div key={d} style={{ padding: "8px 10px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#64748b", borderRight: "1px solid #F1F5F9" }}>{d}</div>
              ))}
            </div>
            {grid.map((week, wi) => (
              <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: wi < grid.length - 1 ? "1px solid #F1F5F9" : "none" }}>
                {week.map((day, di) => {
                  const dayNum = (weekNums[wi] ?? 1) + di;
                  const isToday = wi === 3 && di === 2;
                  return (
                    <div key={di} style={{ minHeight: 80, padding: "6px 8px", borderRight: di < 6 ? "1px solid #F1F5F9" : "none", background: dayNum > 31 || dayNum < 1 ? "#F8FAFC" : "white" }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: isToday ? "#4F46E5" : "transparent", color: isToday ? "white" : (dayNum < 1 || dayNum > 31 ? "#CBD5E1" : "#374151"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: isToday ? 700 : 400, marginBottom: 4 }}>
                        {dayNum < 1 ? dayNum + 30 : dayNum > 31 ? dayNum - 31 : dayNum}
                      </div>
                      {day && (
                        <div style={{ background: `${day.color}15`, borderLeft: `3px solid ${day.color}`, borderRadius: "0 4px 4px 0", padding: "3px 5px", fontSize: 10, color: "#374151", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{day.text}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div style={{ width: 240 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Échéances à venir</span>
              <button style={{ fontSize: 12, color: "#4F46E5", background: "none", border: "none", cursor: "pointer" }}>Voir tout</button>
            </div>
            {[{ color:"#F97316", delay:"Dans 2 jours", label:"Fin consultation ABF", id:"PC-2024-0123", date:"24/05/2024" }, { color:"#22C55E", delay:"Dans 3 jours", label:"Fin instruction", id:"PC-2024-0789", date:"25/05/2024" }, { color:"#F97316", delay:"Dans 5 jours", label:"Consultation SDIS", id:"PC-2024-0456", date:"27/05/2024" }, { color:"#8B5CF6", delay:"Dans 7 jours", label:"Pièce manquante", id:"DP-2024-0089", date:"29/05/2024" }, { color:"#EF4444", delay:"En retard", label:"Instruction dépassée", id:"PC-2023-0567", date:"Depuis 2 jours" }].map((e, i) => (
              <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #F8FAFC" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: e.color }}>{e.delay}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{e.date}</span>
                </div>
                <div style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{e.label}</div>
                <div style={{ fontSize: 11, color: "#4F46E5" }}>{e.id}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 10 }}>Filtres</div>
            {[["Types de dossier","Tous"],["Statut","Tous"],["Services / Organismes","Tous"]].map(([l,v]) => (
              <div key={l} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{l}</div>
                <select style={{ width: "100%", padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12 }}><option>{v}</option></select>
              </div>
            ))}
            <button style={{ width: "100%", border: "none", background: "#F1F5F9", color: "#64748b", borderRadius: 8, padding: "7px", fontSize: 12, cursor: "pointer", marginTop: 4 }}>↺ Effacer les filtres</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatistiquesScreen() {
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
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Statistiques</h1>
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

function InfosPersoScreen() {
  const [stab, setStab] = useState("À propos");
  const navItems = [
    { label: "À propos", icon: "👤" },
    { label: "Communes & Rôles", icon: "🏛" },
    { label: "Disponibilités", icon: "📅" },
    { label: "Délégations", icon: "🤝" },
    { label: "Mes Modèles", icon: "📄" },
    { label: "Mes Signatures", icon: "✍️" },
    { label: "Notifications", icon: "🔔" },
    { label: "Préférences", icon: "⚙️" },
    { label: "Sécurité / Connexion", icon: "🔒" },
    { label: "Centre d'aide", icon: "❓" },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Informations personnelles</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Gérez votre profil, vos préférences et vos paramètres de sécurité.</p>
      </div>

      {/* Profile header */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24, marginBottom: 20, display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg, #4F46E5, #7C3AED)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: "white", flexShrink: 0 }}>ML</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Marie Lecomte</div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>Instructrice urbanisme — Commune de Ballan-Miré</div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 10px" }}>Instructrice</span>
            <span style={{ background: "#F0FDF4", color: "#15803D", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 10px" }}>Actif</span>
          </div>
        </div>
        <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#374151", cursor: "pointer" }}>Modifier le profil</button>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[["Prénom","Marie"],["Nom","Lecomte"],["E-mail","marie.lecomte@ballan-mire.fr"],["Téléphone","02 47 67 XX XX"],["Poste","Instructrice urbanisme"],["Service","Direction de l'urbanisme"]].map(([l,v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{l}</div>
                    <div style={{ fontSize: 13, color: "#0F172A", fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid #F1F5F9", marginTop: 20, paddingTop: 20 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Biographie / Notes</div>
                <textarea style={{ width: "100%", border: "1px solid #E2E8F0", borderRadius: 8, padding: "10px 12px", fontSize: 13, outline: "none", resize: "vertical", minHeight: 80, color: "#374151" }} defaultValue="Instructrice urbanisme depuis 2019. Spécialisée dans les permis de construire et les déclarations préalables." />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
                <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
              </div>
            </div>
          )}

          {stab === "Communes & Rôles" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Communes & Rôles</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Communes auxquelles vous avez accès et rôles associés.</div>
              {[
                { commune: "Ballan-Miré", role: "Instructrice", services: "Urbanisme, ADS", status: "Principal", color: "#4F46E5" },
                { commune: "Saint-Avertin", role: "Consultation", services: "Urbanisme", status: "Secondaire", color: "#8B5CF6" },
                { commune: "La Ville-aux-Dames", role: "Lecteur", services: "Tous", status: "Secondaire", color: "#94A3B8" },
              ].map(c => (
                <div key={c.commune} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #F1F5F9" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: `${c.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🏛</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{c.commune}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{c.services}</div>
                  </div>
                  <span style={{ background: `${c.color}20`, color: c.color, fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 10px" }}>{c.role}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{c.status}</span>
                </div>
              ))}
            </div>
          )}

          {stab === "Disponibilités" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Disponibilités</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Définissez vos plages de disponibilité pour le traitement des dossiers.</div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 8 }}>Jours travaillés</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map((j, i) => (
                    <button key={j} style={{ width: 40, height: 40, borderRadius: 8, border: i < 5 ? "2px solid #4F46E5" : "1px solid #E2E8F0", background: i < 5 ? "#EEF2FF" : "white", color: i < 5 ? "#4F46E5" : "#94a3b8", fontSize: 12, fontWeight: i < 5 ? 600 : 400, cursor: "pointer" }}>{j}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 8 }}>Horaires</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Début</div>
                    <select style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13 }}><option>08:30</option></select>
                  </div>
                  <span style={{ color: "#94a3b8", marginTop: 16 }}>—</span>
                  <div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Fin</div>
                    <select style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13 }}><option>17:30</option></select>
                  </div>
                </div>
              </div>
              <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#C2410C", marginBottom: 16 }}>
                <strong>Absence prévue :</strong> 27 mai – 3 juin 2024 (congés). Dossiers redirigés vers Julien D.
              </div>
              <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
            </div>
          )}

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

          {stab === "Mes Modèles" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Mes Modèles</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>Vos modèles de courriers personnalisés.</div>
                </div>
                <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Nouveau modèle</button>
              </div>
              {[
                { name: "Demande de pièce complémentaire", type: "Courrier", updated: "12/05/2024" },
                { name: "Accusé de réception", type: "Courrier", updated: "02/05/2024" },
                { name: "Notification de décision", type: "Arrêté", updated: "28/04/2024" },
                { name: "Mise en demeure", type: "Courrier", updated: "15/04/2024" },
              ].map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #F8FAFC" }}>
                  <span style={{ fontSize: 20 }}>📄</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{m.type} · Modifié le {m.updated}</div>
                  </div>
                  <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "5px 10px", fontSize: 12, color: "#4F46E5", cursor: "pointer" }}>Éditer</button>
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
                {["Mot de passe actuel","Nouveau mot de passe","Confirmer le nouveau mot de passe"].map(l => (
                  <div key={l} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{l}</div>
                    <input type="password" style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} placeholder="••••••••" />
                  </div>
                ))}
                <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>Modifier le mot de passe</button>
              </div>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Double authentification (2FA)</div>
                  <div style={{ width: 36, height: 20, borderRadius: 10, background: "#E2E8F0", position: "relative", cursor: "pointer" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: 2, boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>Ajoutez une couche de sécurité supplémentaire à votre compte.</div>
              </div>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Sessions actives</div>
                {[
                  { device: "Chrome — macOS", location: "Ballan-Miré, France", time: "Maintenant", current: true },
                  { device: "Safari — iPhone", location: "Tours, France", time: "Il y a 2h", current: false },
                ].map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #F8FAFC" }}>
                    <span style={{ fontSize: 20 }}>{s.device.includes("Chrome") ? "💻" : "📱"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{s.device}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{s.location} · {s.time}</div>
                    </div>
                    {s.current ? <span style={{ background: "#F0FDF4", color: "#15803D", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "2px 8px" }}>Actuelle</span> : <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#EF4444", cursor: "pointer" }}>Révoquer</button>}
                  </div>
                ))}
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

function DossierDetailScreen({ dossier, onBack, navigate }: {
  dossier: DossierInfo;
  onBack: () => void;
  navigate: (s: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("Résumé");

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
  };
  const [parcelAnalysis, setParcelAnalysis] = useState<ParcelAnalysis | null>(null);
  const [parcelLoading, setParcelLoading] = useState(false);
  const [parcelError, setParcelError] = useState<string | null>(null);
  const [showAddressEditor, setShowAddressEditor] = useState(false);
  const [addressOverride, setAddressOverride] = useState<string | null>(null);
  const [addrQuery, setAddrQuery] = useState("");
  const [addrSuggestions, setAddrSuggestions] = useState<Array<{ label: string; city: string; postcode: string }>>([]);
  const [addrSugLoading, setAddrSugLoading] = useState(false);
  const [addrSaving, setAddrSaving] = useState(false);

  useEffect(() => {
    if (activeTab !== "Parcelle" || parcelAnalysis || parcelLoading) return;
    setParcelLoading(true);
    setParcelError(null);
    const url = `/mairie/dossiers/${dossier.id}/analyse-parcelle${addressOverride ? `?q=${encodeURIComponent(addressOverride)}` : ""}`;
    api.get<ParcelAnalysis>(url)
      .then(data => setParcelAnalysis(data))
      .catch(e => setParcelError(e instanceof Error ? e.message : "Erreur analyse parcellaire"))
      .finally(() => setParcelLoading(false));
  }, [activeTab, dossier.id, parcelAnalysis, parcelLoading, addressOverride]);

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
  const [selectedConsultation, setSelectedConsultation] = useState<number | null>(0);
  const [selectedDoc, setSelectedDoc] = useState<number>(0);

  const daysLeft = dossier.echeance && dossier.echeance !== "—"
    ? Math.ceil((new Date(dossier.echeance.split("/").reverse().join("-")).getTime() - Date.now()) / 86400000)
    : null;

  const typeLabel = TYPE_LABEL[dossier.type] ?? dossier.type;
  const instructeurName = dossier.instructeur ?? "Non assigné";

  const CONSULTATIONS_DATA = [
    { service: "ABF – Architecte des Bâtiments de France", status: "Avis reçu", favorable: true, date: "30/04/2024", detail: "Avis favorable avec réserves. Respecter le gabarit des constructions avoisinantes et les matériaux traditionnels.", color: "#15803D", bg: "#F0FDF4" },
    { service: "SDIS – Service Incendie", status: "En attente", favorable: null, date: "—", detail: "Consultation envoyée le 22/04/2024. Délai de réponse : 45 jours.", color: "#C2410C", bg: "#FFF7ED" },
    { service: "Métropole Tours Val de Loire", status: "En attente", favorable: null, date: "—", detail: "En attente de transmission.", color: "#C2410C", bg: "#FFF7ED" },
    { service: "Réseaux (ENEDIS)", status: "Avis reçu", favorable: true, date: "25/04/2024", detail: "Aucune contrainte réseau identifiée. Raccordement possible.", color: "#15803D", bg: "#F0FDF4" },
    { service: "ARS – Agence Régionale de Santé", status: "Non requis", favorable: null, date: "—", detail: "Non requis pour ce type de dossier.", color: "#475569", bg: "#F8FAFC" },
  ];

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
            <button style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "7px 15px", fontSize: 12.5, color: "#374151", cursor: "pointer", fontWeight: 500, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
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
                {dossier.adresse}{dossier.commune ? `, ${dossier.commune}` : ""}
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
                    ["Adresse", dossier.adresse],
                    ["Commune", dossier.commune ?? "—"],
                    ["Parcelle", dossier.parcelle ?? "—"],
                    ["Surface plancher", dossier.surface_plancher ?? "—"],
                    ["Type", typeLabel],
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
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", padding: "16px 18px 10px" }}>Localisation</div>
                {dossier.lat && dossier.lng ? (
                  <MapLeaflet dossiers={[{ id: dossier.id, numero: dossier.numero, type: dossier.type, status: dossier.status, adresse: dossier.adresse, lat: dossier.lat, lng: dossier.lng }]} height={220} commune={dossier.commune} />
                ) : (
                  <div style={{ height: 220, background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 8 }}>
                    <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>Géolocalisation indisponible</span>
                  </div>
                )}
              </div>
            </div>
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
              {(parcelError || showAddressEditor) && (
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
                  {parcelError && (
                    <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#991B1B" }}>
                      {parcelError}
                    </div>
                  )}
                  {/* Correction d'adresse */}
                  <div style={{ background: "white", border: "1px solid #4F46E5", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <p style={{ fontSize: 12.5, fontWeight: 600, color: "#374151", margin: 0 }}>Corriger ou préciser l'adresse</p>
                      {showAddressEditor && !parcelError && (
                        <button onClick={() => { setShowAddressEditor(false); setAddrQuery(""); setAddrSuggestions([]); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#94a3b8", lineHeight: 1, padding: 0 }}>×</button>
                      )}
                    </div>
                    <div style={{ position: "relative" as const }}>
                      <input
                        autoFocus
                        value={addrQuery}
                        onChange={e => setAddrQuery(e.target.value)}
                        placeholder="Ex : 12 rue du Commerce, Ballan-Miré"
                        style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const, color: "#0F172A" }}
                      />
                      {addrSugLoading && (
                        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#94a3b8" }}>…</span>
                      )}
                      {addrSuggestions.length > 0 && (
                        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "white", border: "1px solid #E2E8F0", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 50, overflow: "hidden" }}>
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
                    {addrSaving && <p style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>Sauvegarde…</p>}
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
                {/* ── Colonne gauche ── */}
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
                  {/* Carte */}
                  <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
                    <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={SH as React.CSSProperties & { display: string; alignItems: string; gap: number; marginBottom: number }}>
                        <span style={{ width: 3, height: 14, background: "#4F46E5", borderRadius: 2, display: "inline-block" }} />
                        Vue parcellaire
                      </div>
                      {pa && (
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" as const, alignItems: "center" }}>
                          {pa.data_sources.map(s => (
                            <span key={s} style={{ fontSize: 10, fontWeight: 600, color: "#4F46E5", background: "#EEF2FF", borderRadius: 5, padding: "2px 7px" }}>{s}</span>
                          ))}
                          <button
                            title="Modifier l'adresse"
                            onClick={() => { setShowAddressEditor(true); setAddrQuery(""); setAddrSuggestions([]); }}
                            style={{ padding: "2px 7px", fontSize: 10, fontWeight: 600, color: "#64748b", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 5, cursor: "pointer" }}
                          >✏️ Modifier</button>
                        </div>
                      )}
                    </div>
                    {dossier.lat && dossier.lng ? (
                      <MapLeaflet dossiers={[{ id: dossier.id, numero: dossier.numero, type: dossier.type, status: dossier.status, adresse: dossier.adresse, lat: dossier.lat, lng: dossier.lng }]} height={300} commune={dossier.commune} />
                    ) : (
                      <div style={{ height: 300, background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 10 }}>
                        <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                        <span style={{ fontSize: 13, color: "#94a3b8" }}>Coordonnées non disponibles</span>
                      </div>
                    )}
                  </div>

                  {/* Contraintes */}
                  <div style={CARD}>
                    <SecTitle>Contraintes réglementaires</SecTitle>
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
                    </div>
                  </div>

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
                      ["Commune", pa?.parcel?.commune ?? dossier.commune ?? "—"],
                      ["Code INSEE", pa?.parcel?.code_insee ?? "—"],
                      ["Adresse", pa?.address?.label ?? dossier.adresse ?? "—"],
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
                    <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>Analyse basée sur le PLU de {dossier.commune ?? "la commune"} (version 2023) et les documents déposés.</div>
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
        {activeTab === "Consultations" && (
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              {[
                { label: "Total", value: "5", color: "#4F46E5", bg: "#EEF2FF", border: "#C7D2FE" },
                { label: "Avis reçus", value: "2", color: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" },
                { label: "En attente", value: "2", color: "#C2410C", bg: "#FFF7ED", border: "#FED7AA" },
                { label: "Non requis", value: "1", color: "#475569", bg: "#F8FAFC", border: "#E2E8F0" },
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
                  <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 5px rgba(79,70,229,0.3)" }}>+ Lancer une consultation</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 3 }}>
                  {CONSULTATIONS_DATA.map((c, i) => (
                    <button key={i} onClick={() => setSelectedConsultation(i)} style={{
                      display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, alignItems: "center", padding: "12px 14px", border: selectedConsultation === i ? "1.5px solid #C7D2FE" : "1.5px solid transparent", cursor: "pointer", borderRadius: 10, textAlign: "left" as const,
                      background: selectedConsultation === i ? "#EEF2FF" : i % 2 === 0 ? "#F8FAFC" : "white",
                    }}>
                      <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>{c.service}</span>
                      <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{c.date}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.color, background: c.bg, borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" as const, border: `1px solid ${c.color}33` }}>{c.status}</span>
                    </button>
                  ))}
                </div>
              </div>
              {selectedConsultation !== null && (() => {
                const c = CONSULTATIONS_DATA[selectedConsultation];
                if (!c) return null;
                return (
                  <div style={CARD}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 10 }}>{c.service}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.color, background: c.bg, borderRadius: 20, padding: "3px 10px", border: `1px solid ${c.color}33` }}>{c.status}</span>
                      <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Date : {c.date}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.7, padding: "13px 14px", background: "#F8FAFC", borderRadius: 10, border: "1px solid #EAECF0" }}>{c.detail}</div>
                    {c.favorable === null && c.status === "En attente" && (
                      <button style={{ marginTop: 12, width: "100%", border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "9px 0", fontSize: 12.5, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}>Relancer</button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
              <div style={CARD}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#0F172A", marginBottom: 20, letterSpacing: "-0.3px" }}>Projet de décision</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 12 }}>Type de décision</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9, marginBottom: 24 }}>
                  {[
                    { key: "accord", label: "Accord", sub: "Autorisation simple" },
                    { key: "accord_prescription", label: "Accord avec prescriptions", sub: "Autorisation sous conditions" },
                    { key: "refus", label: "Refus", sub: "Opposition au projet" },
                    { key: "sursis", label: "Sursis à statuer", sub: "Attente de complément" },
                    { key: "pieces", label: "Demande de pièces", sub: "Pièces manquantes" },
                  ].map(d => (
                    <button key={d.key} onClick={() => setDecisionType(d.key)} style={{
                      border: `1.5px solid ${decisionType === d.key ? "#4F46E5" : "#E2E8F0"}`,
                      background: decisionType === d.key ? "#EEF2FF" : "white",
                      borderRadius: 11, padding: "13px 12px", cursor: "pointer", textAlign: "left" as const,
                      boxShadow: decisionType === d.key ? "0 2px 8px rgba(79,70,229,0.15)" : "0 1px 2px rgba(0,0,0,0.04)",
                      transition: "all 0.12s",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                        <div style={{ width: 18, height: 18, borderRadius: "50%", background: decisionType === d.key ? "#4F46E5" : "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.12s" }}>
                          <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke={decisionType === d.key ? "white" : "#CBD5E1"} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: decisionType === d.key ? "#4F46E5" : "#374151", lineHeight: 1.3 }}>{d.label}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", paddingLeft: 25 }}>{d.sub}</div>
                    </button>
                  ))}
                </div>
                {/* Prescriptions */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.07em" }}>Prescriptions à intégrer dans l'arrêté</span>
                    <span style={{ background: "#4F46E5", color: "white", borderRadius: "50%", width: 19, height: 19, fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{prescriptions.length}</span>
                  </div>
                  <button onClick={() => setEditingPrescriptions(!editingPrescriptions)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 7, padding: "5px 11px", fontSize: 11.5, color: "#4F46E5", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    Modifier
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 7, marginBottom: 22 }}>
                  {prescriptions.map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "10px 13px", background: "#F8FAFC", borderRadius: 10, border: "1px solid #EAECF0" }}>
                      <span style={{ width: 21, height: 21, borderRadius: "50%", background: "#EEF2FF", color: "#4F46E5", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, border: "1px solid #C7D2FE" }}>{i + 1}</span>
                      {editingPrescriptions ? (
                        <input value={p} onChange={e => { const next = [...prescriptions]; next[i] = e.target.value; setPrescriptions(next); }} style={{ flex: 1, border: "1.5px solid #C7D2FE", borderRadius: 7, padding: "5px 9px", fontSize: 12.5, outline: "none", color: "#374151", background: "white" }} />
                      ) : (
                        <span style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.55 }}>{p}</span>
                      )}
                    </div>
                  ))}
                  {editingPrescriptions && (
                    <button onClick={() => setPrescriptions([...prescriptions, ""])} style={{ border: "2px dashed #C7D2FE", background: "transparent", borderRadius: 10, padding: "9px 0", fontSize: 12.5, color: "#4F46E5", cursor: "pointer", width: "100%", fontWeight: 600 }}>+ Ajouter une prescription</button>
                  )}
                </div>
                {/* Génération documents */}
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 12 }}>Génération des documents</div>
                <div style={{ display: "flex", gap: 9, marginBottom: 18 }}>
                  <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 9, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: "0 2px 6px rgba(79,70,229,0.3)" }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    Générer projet d'arrêté
                  </button>
                  <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "10px 14px", fontSize: 13, color: "#374151", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontWeight: 500, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                    Générer courrier
                  </button>
                  <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "10px 14px", fontSize: 13, color: "#374151", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontWeight: 500, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    Prévisualiser PDF
                  </button>
                </div>
                {/* Arrêté preview */}
                <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                    <span style={{ fontSize: 11.5, color: "#64748b", fontWeight: 500 }}>Aperçu du projet d'arrêté</span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      {["B", "I", "U"].map(f => (
                        <button key={f} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 5, padding: "2px 8px", fontSize: 11, color: "#374151", cursor: "pointer", fontWeight: f === "B" ? 700 : 400, fontStyle: f === "I" ? "italic" as const : "normal", textDecoration: f === "U" ? "underline" : "none" }}>{f}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ padding: "24px 30px", fontFamily: "'Georgia', serif", fontSize: 12.5, lineHeight: 1.9, color: "#1a1a1a", background: "white", minHeight: 240 }}>
                    <div style={{ textAlign: "center" as const, marginBottom: 18 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.12em", textTransform: "uppercase" as const }}>Arrêté</div>
                      <div style={{ fontSize: 13, fontStyle: "italic" as const }}>accordant un permis de construire</div>
                    </div>
                    <p style={{ margin: "0 0 8px" }}>Le Maire de {dossier.commune ?? "la commune"},</p>
                    <p style={{ margin: "0 0 4px" }}>Vu la demande de permis de construire présentée le {dossier.date_depot ? fmtDate(dossier.date_depot) : "—"} par {dossier.petitionnaire}&nbsp;;</p>
                    <p style={{ margin: "0 0 12px" }}>Vu le Code de l'urbanisme&nbsp;;</p>
                    <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13.5, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Arrête</p>
                    <p style={{ margin: "0 0 8px" }}><strong>Article 1<sup>er</sup></strong> – Le permis de construire est <strong>ACCORDÉ</strong> à {dossier.petitionnaire} pour le projet décrit dans la demande susvisée.</p>
                    {prescriptions.length > 0 && <p style={{ margin: "0 0 4px" }}><strong>Article 2</strong> – <em>Prescriptions</em><br />Les prescriptions suivantes devront être respectées :<br />{prescriptions.map((p, i) => <span key={i}>{i + 1}. {p}<br /></span>)}</p>}
                  </div>
                </div>
              </div>
            </div>
            {/* Right */}
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
              <div style={CARD}>
                <SecTitle>Synthèse du dossier</SecTitle>
                {[
                  { label: "Dossier complet", ok: true },
                  { label: "Consultations terminées", ok: true, sub: "5 consultations clôturées" },
                  { label: "Échéance respectée", ok: true, sub: "Instruction dans les délais" },
                  { label: "2 points de vigilance", ok: false, sub: "Voir le détail ci-dessous" },
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "9px 0", borderBottom: i < 3 ? "1px solid #F1F5F9" : "none" }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: item.ok ? "#DCFCE7" : "#FEF9C3", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                      {item.ok
                        ? <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        : <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                      }
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#374151" }}>{item.label}</div>
                      {item.sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{item.sub}</div>}
                    </div>
                  </div>
                ))}
              </div>
              <div style={CARD}>
                <SecTitle>Vérifications avant décision</SecTitle>
                {[
                  { label: "Dossier complet", ok: true },
                  { label: "Consultations clôturées", ok: true },
                  { label: "Pièces obligatoires présentes", ok: true },
                  { label: "Avis ABF avec prescriptions", ok: false },
                  { label: "Signature du maire requise", ok: false },
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: i < 4 ? "1px solid #F8FAFC" : "none" }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: item.ok ? "#DCFCE7" : "#FEF9C3", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {item.ok
                        ? <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        : <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                      }
                    </div>
                    <span style={{ fontSize: 12.5, color: "#374151" }}>{item.label}</span>
                  </div>
                ))}
              </div>
              <div style={CARD}>
                <SecTitle>Signatures</SecTitle>
                {[
                  { initials: instructeurName.split(" ").map(w => w[0]?.toUpperCase() ?? "").join("").slice(0, 2), name: instructeurName, role: "Instructeur·trice", signed: true, date: "17/05/2024" },
                  { initials: "M", name: "Maire", role: "Élu signataire", signed: false, date: "" },
                ].map((sig, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i === 0 ? "1px solid #F1F5F9" : "none" }}>
                    <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, flexShrink: 0, boxShadow: "0 2px 6px rgba(79,70,229,0.25)" }}>{sig.initials}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{sig.name}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{sig.role}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: sig.signed ? "#15803D" : "#C2410C", background: sig.signed ? "#F0FDF4" : "#FFF7ED", borderRadius: 7, padding: "3px 9px", border: `1px solid ${sig.signed ? "#BBF7D0" : "#FED7AA"}`, whiteSpace: "nowrap" as const }}>
                      {sig.signed ? `Signé le ${sig.date}` : "Signature requise"}
                    </span>
                  </div>
                ))}
              </div>
              <button style={{ width: "100%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 12, padding: "15px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, boxShadow: "0 4px 14px rgba(79,70,229,0.4)", letterSpacing: "-0.2px" }}>
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Valider la décision
              </button>
            </div>
          </div>
        )}

      </div>
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

export function MairieApp() {
  const [commune, setCommune] = useState("Ballan-Miré");
  const [showNouveauDossier, setShowNouveauDossier] = useState(false);
  const routerNavigate = useNavigate();
  const location = useLocation();

  const pathname = location.pathname;
  const active = pathname.startsWith("/mairie/dossiers") ? "Dossiers"
    : pathname.startsWith("/mairie/messagerie") ? "Messagerie"
    : pathname.startsWith("/mairie/calendrier") ? "Calendrier"
    : pathname.startsWith("/mairie/carte") ? "Carte"
    : pathname.startsWith("/mairie/statistiques") ? "Statistiques"
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
      <Sidebar active={active} setActive={setActive} commune={commune} setCommune={setCommune} />
      <div style={{ marginLeft: 200, flex: 1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {active !== "Messagerie" && (
          <Topbar onNewDossier={active === "Dossiers" ? () => setShowNouveauDossier(true) : undefined} navigate={setActive} onDossierClick={handleDossierClick} />
        )}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <Routes>
            <Route index element={<DashboardScreen navigate={setActive} navigateDossiers={navigateDossiers} commune={commune} onDossierClick={handleDossierClick} />} />
            <Route path="dossiers" element={<DossiersScreen onDossierClick={handleDossierClick} />} />
            <Route path="dossiers/:id" element={<DossierDetailRoute navigate={setActive} />} />
            <Route path="messagerie" element={<MessageScreen onDossierClick={handleDossierClick} />} />
            <Route path="calendrier" element={<CalendrierScreen />} />
            <Route path="carte" element={<CarteScreen />} />
            <Route path="statistiques" element={<StatistiquesScreen />} />
            <Route path="parametres" element={<ParametresScreen />} />
            <Route path="profil" element={<InfosPersoScreen />} />
            <Route path="*" element={<Navigate to="/mairie" replace />} />
          </Routes>
        </div>
      </div>
      {showNouveauDossier && <NouveauDossierModal onClose={() => setShowNouveauDossier(false)} />}
    </div>
  );
}
