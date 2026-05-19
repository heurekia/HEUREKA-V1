import { useState } from "react";

const NAV_ITEMS = [
  { label: "Tableau de bord", icon: HomeIcon },
  { label: "Dossiers", icon: FolderIcon },
  { label: "Calendrier", icon: CalendarIcon },
  { label: "Messagerie", icon: MessageIcon, badge: 2 },
  { label: "Carte", icon: MapIcon },
  { label: "Statistiques", icon: ChartIcon },
  { label: "Paramètres", icon: SettingsIcon },
  { label: "Infos Perso", icon: UserIcon },
];

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

function Sidebar({ active, setActive }: { active: string; setActive: (s: string) => void }) {
  return (
    <aside style={{
      width: 180, minWidth: 180, background: "#0f1629",
      display: "flex", flexDirection: "column",
      height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 50,
    }}>
      <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #4F46E5, #7C3AED)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={{ color: "white", fontWeight: 700, fontSize: 16, letterSpacing: "-0.02em" }}>HEUREKA</span>
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Commune sélectionnée</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.06)", borderRadius: 6, padding: "5px 8px", cursor: "pointer" }}>
          <BuildingIcon size={13} />
          <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 500, flex: 1 }}>Ballan-Miré</span>
          <ChevronDownIcon size={12} />
        </div>
      </div>

      <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
        {NAV_ITEMS.map(({ label, icon: Icon, badge }) => {
          const isActive = active === label;
          return (
            <button key={label} onClick={() => setActive(label)} style={{
              width: "100%", border: "none", background: "none",
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 16px",
              color: isActive ? "white" : "#94a3b8",
              fontSize: 13, fontWeight: isActive ? 600 : 400,
              cursor: "pointer", position: "relative", transition: "all 0.15s",
            }}>
              {isActive && (
                <span style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 20, background: "#4F46E5", borderRadius: "0 2px 2px 0" }} />
              )}
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "5px", background: isActive ? "rgba(79,70,229,0.2)" : "transparent", borderRadius: 6, color: isActive ? "#818CF8" : "#64748b" }}>
                <Icon size={16} />
              </span>
              <span>{label}</span>
              {badge && (
                <span style={{ marginLeft: "auto", background: "#4F46E5", color: "white", fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #4F46E5, #7C3AED)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "white", flexShrink: 0 }}>ML</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "white", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Marie L.</div>
          <div style={{ color: "#64748b", fontSize: 11 }}>Instructrice</div>
        </div>
        <ArrowRightIcon size={12} />
      </div>
    </aside>
  );
}

function Topbar({ buttonLabel = "+ Nouveau dossier", commune = "Ballan-Miré", onNewDossier, navigate }: { title?: string; buttonLabel?: string; commune?: string; onNewDossier?: () => void; navigate?: (s: string) => void }) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [showCommune, setShowCommune] = useState(false);
  const [faqQuery, setFaqQuery] = useState("");
  const [faqAnswer, setFaqAnswer] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const communes = ["Ballan-Miré", "Saint-Avertin", "Joué-lès-Tours", "La Riche"];
  const notifs = [
    { icon: "📁", text: "Nouveau dossier PC-2024-0801 déposé", sub: "Il y a 12 min", color: "#4F46E5" },
    { icon: "💬", text: "Nouveau message de Jean Dupont", sub: "Il y a 1h", color: "#4F46E5" },
    { icon: "⏰", text: "Délai dépassé — DP-2024-0111", sub: "Hier", color: "#EF4444" },
  ];
  const allDossiers = [
    { id: "PC-2024-0123", addr: "12 rue des Lilas", pet: "Jean Dupont" },
    { id: "DP-2024-0456", addr: "8 chemin de la Colline", pet: "Sophie Martin" },
    { id: "PC-2024-0789", addr: "45 avenue de la Mer", pet: "SCI Les Oliviers" },
    { id: "DP-2024-0089", addr: "3 impasse des Pins", pet: "Pierre Durand" },
    { id: "PC-2023-0567", addr: "7 rue du Stade", pet: "Marie Bernard" },
    { id: "DP-2024-0111", addr: "15 route des Plages", pet: "Lucas Morel" },
  ];
  const q = searchQuery.toLowerCase();
  const searchResults = searchQuery.length > 1
    ? allDossiers.filter(r => r.id.toLowerCase().includes(q) || r.addr.toLowerCase().includes(q) || r.pet.toLowerCase().includes(q))
    : [];

  const closeAll = () => { setShowNotifs(false); setShowFAQ(false); setShowCommune(false); };

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
                <button key={r.id} onMouseDown={() => { navigate?.("Dossiers"); setSearchQuery(""); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", minWidth: 110 }}>{r.id}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{r.addr} — {r.pet}</span>
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
          <button onClick={() => { setShowNotifs(!showNotifs); setShowFAQ(false); setShowCommune(false); }} style={{ border: "none", background: showNotifs ? "#F1F5F9" : "none", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", padding: 6, borderRadius: 6 }}>
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
          <button onClick={() => { setShowFAQ(!showFAQ); setShowNotifs(false); setShowCommune(false); }} style={{ border: "none", background: showFAQ ? "#F1F5F9" : "none", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", padding: 6, borderRadius: 6 }}>
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

        {/* Commune selector */}
        <div style={{ position: "relative" }}>
          <button onClick={() => { setShowCommune(!showCommune); setShowNotifs(false); setShowFAQ(false); }} style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #E2E8F0", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 13, color: "#374151", fontWeight: 500, background: showCommune ? "#F8FAFC" : "white" }}>
            <BuildingIcon size={14} /><span>{commune}</span><ChevronDownIcon size={12} />
          </button>
          {showCommune && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 220, background: "white", borderRadius: 10, border: "1px solid #E2E8F0", boxShadow: "0 8px 24px rgba(0,0,0,0.14)", zIndex: 200 }}>
              <div style={{ padding: "8px 14px", borderBottom: "1px solid #F1F5F9", fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em" }}>MES COMMUNES</div>
              {communes.map(c => (
                <button key={c} onClick={closeAll} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left", fontSize: 13, color: c === commune ? "#4F46E5" : "#374151", fontWeight: c === commune ? 600 : 400 }}>
                  <BuildingIcon size={13} />{c}
                  {c === commune && <span style={{ marginLeft: "auto", color: "#4F46E5", fontSize: 14 }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New dossier */}
        <button onClick={() => onNewDossier?.()} style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: "0 1px 3px rgba(79,70,229,0.3)" }}>
          <PlusIcon size={14} />{buttonLabel}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; dot: string }> = {
    "En instruction": { bg: "#EFF6FF", color: "#1D4ED8", dot: "#3B82F6" },
    "En consultation": { bg: "#FFF7ED", color: "#C2410C", dot: "#F97316" },
    "Nouveau": { bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
    "En retard": { bg: "#FEF2F2", color: "#B91C1C", dot: "#EF4444" },
    "Terminé": { bg: "#F8FAFC", color: "#475569", dot: "#94A3B8" },
    "Actif": { bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
    "En attente": { bg: "#FFF7ED", color: "#C2410C", dot: "#F97316" },
    "Désactivé": { bg: "#FEF2F2", color: "#B91C1C", dot: "#EF4444" },
    "Décision": { bg: "#FAF5FF", color: "#7E22CE", dot: "#9333EA" },
  };
  const s = map[status] || { bg: "#F1F5F9", color: "#475569", dot: "#94A3B8" };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
      {status}
    </span>
  );
}

function DashboardScreen({ navigate, navigateDossiers }: { navigate: (s: string) => void; navigateDossiers: (filter: string) => void }) {
  const [mapFilter, setMapFilter] = useState<string>("Tous");
  const [activeMarker, setActiveMarker] = useState<number | null>(null);

  const cards = [
    { label: "Nouveaux dossiers", count: 8, sub: "En attente d'ouverture d'instruction", color: "#4F46E5", bg: "#EEF2FF", icon: "📁", onClick: () => navigateDossiers("Nouveau") },
    { label: "Consultations en attente", count: 2, sub: "En attente de retour des services", color: "#F97316", bg: "#FFF7ED", icon: "👥", onClick: () => navigateDossiers("En consultation") },
    { label: "Messages sans réponse", count: 3, sub: "Messages en attente de réponse", color: "#4F46E5", bg: "#EEF2FF", icon: "💬", onClick: () => navigate("Messagerie") },
    { label: "Dossiers en retard", count: 1, sub: "Dépassement de délai constaté", color: "#EF4444", bg: "#FEF2F2", icon: "⏰", alert: true, onClick: () => navigateDossiers("En retard") },
  ];

  const markers = [
    { top: "22%", left: "22%", color: "#4F46E5", status: "Nouveau", n: 2, label: "Rue des Lilas", dossiers: ["PC-2024-0123","DP-2024-0089"] },
    { top: "18%", left: "45%", color: "#22C55E", status: "En instruction", n: 3, label: "Av. de la Mer", dossiers: ["PC-2024-0789","DP-2024-0333","PC-2023-0567"] },
    { top: "38%", left: "60%", color: "#F97316", status: "En consultation", n: 4, label: "Chemin de la Colline", dossiers: ["DP-2024-0456","PC-2023-0166","PC-2024-0222","PC-2024-0166"] },
    { top: "52%", left: "75%", color: "#4F46E5", status: "Nouveau", n: 2, label: "Route des Plages", dossiers: ["DP-2024-0111","PC-2024-0798"] },
    { top: "65%", left: "38%", color: "#22C55E", status: "En instruction", n: 5, label: "Lotissement du Parc", dossiers: ["DP-2024-0333","PC-2024-0456","PC-2024-0789","DP-2024-0451","PC-2024-0123"] },
    { top: "70%", left: "62%", color: "#EF4444", status: "En retard", n: 1, label: "Rue du Stade", dossiers: ["PC-2023-0567"] },
    { top: "42%", left: "30%", color: "#8B5CF6", status: "Décision", n: 2, label: "ZA des Tilleuls", dossiers: ["PC-2023-0166","DP-2024-0090"] },
  ];

  const filterColors: Record<string, string> = {
    "Nouveau": "#4F46E5", "En instruction": "#22C55E",
    "En consultation": "#F97316", "En retard": "#EF4444", "Décision": "#8B5CF6",
  };

  const visibleMarkers = mapFilter === "Tous" ? markers : markers.filter(m => m.status === mapFilter);

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Greeting */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", margin: 0 }}>Bonjour Marie 👋</h1>
        <p style={{ color: "#64748b", fontSize: 13, margin: "3px 0 0" }}>Voici l'essentiel de votre activité aujourd'hui.</p>
      </div>

      {/* KPI cards — full width row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {cards.map((c) => (
          <button key={c.label} onClick={c.onClick} style={{
            background: "white", borderRadius: 12, padding: "16px 18px",
            border: c.alert ? "1.5px solid #FCA5A5" : "1px solid #E2E8F0",
            boxShadow: c.alert ? "0 2px 8px rgba(239,68,68,0.08)" : "0 1px 4px rgba(0,0,0,0.05)",
            cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14,
            transition: "box-shadow 0.15s",
          }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{c.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: c.alert ? "#EF4444" : "#0F172A", lineHeight: 1 }}>{c.count}</span>
                {c.alert && <span style={{ fontSize: 9, background: "#FEF2F2", color: "#B91C1C", borderRadius: 4, padding: "2px 6px", fontWeight: 700, letterSpacing: "0.02em" }}>EN RETARD</span>}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>{c.label}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1, lineHeight: 1.3 }}>{c.sub}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Map */}
      <div style={{ height: 360, background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Map toolbar */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>Carte des demandes</span>
            <span style={{ fontSize: 11, color: "#94A3B8", marginLeft: 8 }}>Ballan-Miré · {markers.reduce((s,m) => s+m.n, 0)} dossiers actifs</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            {["Tous", "Nouveau", "En instruction", "En consultation", "En retard"].map(f => (
              <button key={f} onClick={() => setMapFilter(f)} style={{
                border: mapFilter === f ? `1px solid ${filterColors[f] ?? "#4F46E5"}` : "1px solid #E2E8F0",
                background: mapFilter === f ? `${filterColors[f] ?? "#4F46E5"}15` : "white",
                color: mapFilter === f ? (filterColors[f] ?? "#4F46E5") : "#64748b",
                borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: mapFilter === f ? 600 : 400, cursor: "pointer",
              }}>{f}</button>
            ))}
            <button onClick={() => navigate("Carte")} style={{ border: "1px solid #4F46E5", background: "#EEF2FF", color: "#4F46E5", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", marginLeft: 4 }}>
              Carte complète →
            </button>
          </div>
        </div>

        {/* Map body */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {/* SVG base map */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 900 500" preserveAspectRatio="xMidYMid slice">
            {/* Background terrain */}
            <rect width="900" height="500" fill="#e8f0e8" />
            <rect x="0" y="0" width="900" height="500" fill="url(#grid)" opacity="0.3" />
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#c8d8c8" strokeWidth="0.5" />
              </pattern>
            </defs>
            {/* Zones vertes (espaces naturels) */}
            <ellipse cx="120" cy="380" rx="100" ry="70" fill="#c8e6c8" opacity="0.6" />
            <ellipse cx="780" cy="80" rx="80" ry="60" fill="#c8e6c8" opacity="0.6" />
            <ellipse cx="820" cy="420" rx="70" ry="50" fill="#c8e6c8" opacity="0.5" />
            {/* Cours d'eau */}
            <path d="M 0 260 Q 150 240 280 270 Q 420 300 550 280 Q 680 260 900 290" fill="none" stroke="#a8cce8" strokeWidth="8" opacity="0.7" />
            <path d="M 0 265 Q 150 245 280 275 Q 420 305 550 285 Q 680 265 900 295" fill="none" stroke="#b8d4f0" strokeWidth="4" opacity="0.5" />
            {/* Routes principales */}
            <path d="M 0 200 L 900 220" stroke="#e8e0d0" strokeWidth="12" />
            <path d="M 0 202 L 900 222" stroke="white" strokeWidth="8" opacity="0.6" />
            <path d="M 450 0 L 440 500" stroke="#e8e0d0" strokeWidth="10" />
            <path d="M 452 0 L 442 500" stroke="white" strokeWidth="6" opacity="0.6" />
            {/* Routes secondaires */}
            <path d="M 0 350 Q 200 340 400 360 Q 600 380 900 350" stroke="#ddd8cc" strokeWidth="6" fill="none" />
            <path d="M 200 0 Q 220 180 250 280 Q 280 380 260 500" stroke="#ddd8cc" strokeWidth="5" fill="none" />
            <path d="M 650 0 Q 660 150 680 280 Q 700 380 690 500" stroke="#ddd8cc" strokeWidth="5" fill="none" />
            <path d="M 0 80 Q 250 100 440 80 Q 600 60 750 90 Q 820 110 900 80" stroke="#ddd8cc" strokeWidth="4" fill="none" />
            {/* Quartiers / blocs */}
            <rect x="300" y="100" width="120" height="80" rx="4" fill="#f0ece4" stroke="#ddd8cc" strokeWidth="1" opacity="0.8" />
            <rect x="460" y="90" width="90" height="70" rx="4" fill="#f0ece4" stroke="#ddd8cc" strokeWidth="1" opacity="0.8" />
            <rect x="580" y="110" width="100" height="90" rx="4" fill="#f0ece4" stroke="#ddd8cc" strokeWidth="1" opacity="0.7" />
            <rect x="310" y="310" width="130" height="70" rx="4" fill="#f0ece4" stroke="#ddd8cc" strokeWidth="1" opacity="0.8" />
            <rect x="480" y="320" width="110" height="80" rx="4" fill="#f0ece4" stroke="#ddd8cc" strokeWidth="1" opacity="0.7" />
            <rect x="640" y="300" width="100" height="90" rx="4" fill="#f0ece4" stroke="#ddd8cc" strokeWidth="1" opacity="0.6" />
            <rect x="150" y="120" width="80" height="60" rx="4" fill="#f0ece4" stroke="#ddd8cc" strokeWidth="1" opacity="0.7" />
            <rect x="160" y="370" width="90" height="65" rx="4" fill="#f0ece4" stroke="#ddd8cc" strokeWidth="1" opacity="0.7" />
            {/* Bâtiments publics */}
            <rect x="420" y="170" width="40" height="35" rx="3" fill="#d4e0f0" stroke="#b0bcd8" strokeWidth="1.5" />
            <rect x="350" y="380" width="45" height="38" rx="3" fill="#d4e0f0" stroke="#b0bcd8" strokeWidth="1.5" />
          </svg>

          {/* Clickable markers */}
          {visibleMarkers.map((m, i) => (
            <div key={i}
              onClick={() => { setActiveMarker(activeMarker === i ? null : i); navigate("Dossiers"); }}
              onMouseEnter={() => setActiveMarker(i)}
              onMouseLeave={() => setActiveMarker(null)}
              style={{
                position: "absolute", top: m.top, left: m.left,
                width: 32, height: 32, borderRadius: "50%",
                background: m.color, color: "white",
                fontSize: 12, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: activeMarker === i ? `0 0 0 4px ${m.color}40, 0 4px 12px rgba(0,0,0,0.3)` : "0 2px 8px rgba(0,0,0,0.25)",
                border: "2px solid white", cursor: "pointer",
                transform: activeMarker === i ? "scale(1.2)" : "scale(1)",
                transition: "all 0.15s",
                zIndex: activeMarker === i ? 20 : 10,
              }}>
              {m.n}
              {/* Tooltip */}
              {activeMarker === i && (
                <div style={{
                  position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
                  background: "#0F172A", color: "white", borderRadius: 8,
                  padding: "8px 12px", fontSize: 11, whiteSpace: "nowrap",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.3)", zIndex: 30, minWidth: 160,
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{m.label}</div>
                  <div style={{ color: "#94a3b8", marginBottom: 4 }}>{m.n} dossier{m.n > 1 ? "s" : ""} · {m.status}</div>
                  {m.dossiers.slice(0, 3).map(d => (
                    <div key={d} style={{ color: "#818CF8", fontSize: 10 }}>{d}</div>
                  ))}
                  {m.dossiers.length > 3 && <div style={{ color: "#64748b", fontSize: 10 }}>+{m.dossiers.length - 3} autres</div>}
                  <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid #0F172A" }} />
                </div>
              )}
            </div>
          ))}

          {/* Legend */}
          <div style={{ position: "absolute", bottom: 12, left: 12, background: "white", borderRadius: 8, padding: "8px 12px", fontSize: 11, boxShadow: "0 2px 8px rgba(0,0,0,0.12)", display: "flex", gap: 12 }}>
            {[["#4F46E5","Nouveau"],["#22C55E","Instruction"],["#F97316","Consultation"],["#EF4444","Retard"],["#8B5CF6","Décision"]].map(([c,l]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />
                <span style={{ color: "#374151" }}>{l}</span>
              </div>
            ))}
          </div>

          {/* Stats overlay top-right */}
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
            {[["📍", visibleMarkers.reduce((s,m)=>s+m.n,0), "dossiers"], ["🕐", "38j", "délai moy."]].map(([icon, val, label]) => (
              <div key={String(label)} style={{ background: "white", borderRadius: 8, padding: "6px 10px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>{icon as string}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{val}</div>
                <div style={{ fontSize: 9, color: "#94a3b8" }}>{label as string}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI assistant banner — compact */}
      <div style={{ flexShrink: 0, background: "linear-gradient(135deg, #0f1629, #1e2d5a)", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>✨</span>
          <div>
            <span style={{ color: "white", fontSize: 12, fontWeight: 600 }}>Assistant IA — </span>
            <span style={{ color: "#94a3b8", fontSize: 12 }}>Posez vos questions sur les dossiers, délais ou réglementation.</span>
          </div>
        </div>
        <button onClick={() => alert("Assistant IA — bientôt disponible")} style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          💬 Discuter
        </button>
      </div>
    </div>
  );
}

function DossiersScreen({ onDossierClick, navigate, initialFilter }: { onDossierClick: (d: { id: string; type: string; petitionnaire: string; adresse: string; status: string; echeance: string }) => void; navigate: (s: string) => void; initialFilter?: string }) {
  const tabs = ["Tous", "Nouveau", "En instruction", "En consultation", "En retard", "Décision", "Terminés"];
  const [activeTab, setActiveTab] = useState(initialFilter ?? "Tous");
  const [searchQ, setSearchQ] = useState("");

  const allRows = [
    { id: "PC-2024-0123", pet: "Jean Dupont", addr: "12 rue des Lilas", type: "Permis de construire", status: "En instruction", ech: "12/06/2024" },
    { id: "DP-2024-0456", pet: "Sophie Martin", addr: "8 chemin de la Colline", type: "Déclaration préalable", status: "En consultation", ech: "25/06/2024" },
    { id: "PC-2024-0789", pet: "SCI Les Oliviers", addr: "45 avenue de la Mer", type: "Permis de construire", status: "En instruction", ech: "15/06/2024" },
    { id: "DP-2024-0089", pet: "Pierre Durand", addr: "3 impasse des Pins", type: "Déclaration préalable", status: "Nouveau", ech: "22/06/2024" },
    { id: "PC-2023-0567", pet: "Marie Bernard", addr: "7 rue du Stade", type: "Permis de construire", status: "En instruction", ech: "01/06/2024" },
    { id: "DP-2024-0111", pet: "Lucas Morel", addr: "15 route des Plages", type: "Déclaration préalable", status: "En retard", ech: "10/05/2024" },
    { id: "PC-2023-0166", pet: "SAS Habitat", addr: "ZA des Tilleuls", type: "Permis de construire", status: "En consultation", ech: "05/06/2024" },
    { id: "DP-2024-0333", pet: "Emma Petit", addr: "2 lotissement du Parc", type: "Déclaration préalable", status: "En instruction", ech: "18/06/2024" },
  ];

  const tabCounts: Record<string, number> = Object.fromEntries(
    tabs.map(t => [t, t === "Tous" ? allRows.length : allRows.filter(r => r.status === t).length])
  );
  const rows = allRows.filter(r => {
    const matchTab = activeTab === "Tous" || r.status === activeTab;
    const matchQ = !searchQ || r.id.toLowerCase().includes(searchQ.toLowerCase()) || r.pet.toLowerCase().includes(searchQ.toLowerCase()) || r.addr.toLowerCase().includes(searchQ.toLowerCase());
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
            <button key={t} onClick={() => setActiveTab(t)} style={{ border: "none", background: "none", padding: "8px 14px", fontSize: 13, fontWeight: active ? 600 : 400, color: active ? "#4F46E5" : "#64748b", borderBottom: active ? "2px solid #4F46E5" : "2px solid transparent", marginBottom: -2, cursor: "pointer", whiteSpace: "nowrap" }}>
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
              {["N° Dossier","Pétitionnaire","Adresse","Type de dossier","Statut","Échéance","Actions"].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #F1F5F9", cursor: "pointer" }}
                onClick={() => onDossierClick({ id: r.id, type: r.type, petitionnaire: r.pet, adresse: r.addr, status: r.status, echeance: r.ech })}
                onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                onMouseLeave={e => (e.currentTarget.style.background = "white")}>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "#4F46E5" }}>{r.id}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.pet}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#64748b" }}>{r.addr}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.type}</td>
                <td style={{ padding: "12px 16px" }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.ech}</td>
                <td style={{ padding: "12px 16px" }}>
                  <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", padding: 4 }} onClick={e => e.stopPropagation()}><DotsIcon /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #F1F5F9" }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>Affichage de 1 à 8 sur 24 dossiers</span>
          <div style={{ display: "flex", gap: 4 }}>
            {["‹","1","2","3","›"].map((p, i) => (
              <button key={i} style={{ width: 28, height: 28, border: "1px solid #E2E8F0", background: p === "1" ? "#4F46E5" : "white", color: p === "1" ? "white" : "#64748b", borderRadius: 6, fontSize: 13, fontWeight: p === "1" ? 600 : 400, cursor: "pointer" }}>{p}</button>
            ))}
          </div>
          <select style={{ border: "1px solid #E2E8F0", borderRadius: 6, padding: "4px 8px", fontSize: 12 }}>
            <option>8 dossiers par page</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function MessageScreen({ onDossierClick }: { onDossierClick: (d: { id: string; type: string; petitionnaire: string; adresse: string; status: string; echeance: string }) => void }) {
  const [tab, setTab] = useState("Citoyens");
  const citoyenConvs = [
    { name: "Jean Dupont", dossier: "PC-2024-0123", preview: "Bonjour, pouvez-vous me transmettre...", time: "09:15", badge: 2, initials: "JD", color: "#4F46E5" },
    { name: "Sophie Martin", dossier: "DP-2024-0456", preview: "Merci pour votre retour.", time: "Hier", badge: 1, initials: "SM", color: "#22C55E" },
    { name: "Pierre Durand", dossier: "DP-2024-0089", preview: "Pièce complémentaire envoyée.", time: "Hier", initials: "PD", color: "#F97316" },
    { name: "Lucas Morel", dossier: "PC-2024-0789", preview: "D'accord, merci.", time: "15/05", initials: "LM", color: "#8B5CF6" },
    { name: "SCI Les Oliviers", dossier: "PC-2025-0166", preview: "Nous prenons connaissance.", time: "15/05", initials: "SO", color: "#EC4899" },
    { name: "Emma Petit", dossier: "DP-2024-0333", preview: "Bonjour, j'ai une question sur...", time: "14/05", initials: "EP", color: "#14B8A6" },
  ];
  const serviceConvs = [
    { name: "ABF – Architecte des Bâtiments de France", dossier: "PC-2024-0123", preview: "Avis favorable avec réserves transmis.", time: "10:30", badge: 1, initials: "AB", color: "#8B5CF6" },
    { name: "SDIS – Service Incendie", dossier: "PC-2024-0456", preview: "Consultation en cours d'examen.", time: "Hier", initials: "SD", color: "#EF4444" },
    { name: "Métropole Tours Val de Loire", dossier: "PC-2024-0166", preview: "Retour attendu avant le 17/05.", time: "Hier", initials: "MT", color: "#F97316" },
    { name: "DREAL Centre-Val de Loire", dossier: "PC-2024-0789", preview: "Documents bien reçus, analyse en cours.", time: "14/05", initials: "DR", color: "#22C55E" },
    { name: "Service des Eaux", dossier: "DP-2024-0089", preview: "Avis favorable émis.", time: "13/05", initials: "SE", color: "#3B82F6" },
  ];
  const convs = tab === "Citoyens" ? citoyenConvs : serviceConvs;
  return (
    <div style={{ padding: 0, display: "flex", height: "calc(100vh - 56px)" }}>
      <div style={{ width: 320, borderRight: "1px solid #E2E8F0", display: "flex", flexDirection: "column", background: "white" }}>
        <div style={{ padding: "20px 16px 0" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Messagerie</h1>
          <p style={{ color: "#94A3B8", fontSize: 12, marginBottom: 12 }}>Échangez avec les pétitionnaires et les services consultés.</p>
          <div style={{ display: "flex", gap: 0, marginBottom: 12 }}>
            {["Citoyens 12", "Services / Consultations 8"].map((t) => {
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
          {convs.map((c, i) => (
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
        <div style={{ padding: "8px 16px", borderTop: "1px solid #F1F5F9" }}>
          <button style={{ fontSize: 12, color: "#4F46E5", fontWeight: 500, background: "none", border: "none", cursor: "pointer" }}>Voir toutes les conversations →</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#FAFBFD" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Jean Dupont</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>PC-2024-0123 – Permis de construire</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => onDossierClick({ id: "PC-2024-0123", type: "Permis de construire", petitionnaire: "Jean Dupont", adresse: "12 rue des Lilas", status: "En instruction", echeance: "12/06/2024" })} style={{ padding: "6px 12px", background: "white", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, color: "#374151", cursor: "pointer" }}>Voir le dossier ↗</button>
            <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}><DotsIcon /></button>
          </div>
        </div>
        <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <span style={{ background: "#F1F5F9", color: "#94a3b8", fontSize: 11, borderRadius: 10, padding: "3px 10px" }}>Aujourd'hui</span>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#4F46E5", color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>JD</div>
            <div style={{ maxWidth: "60%" }}>
              <div style={{ background: "white", borderRadius: "4px 12px 12px 12px", padding: "12px 14px", border: "1px solid #E2E8F0", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.5 }}>Bonjour,</p>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#374151", lineHeight: 1.5 }}>Pouvez-vous me transmettre le document manquant s'il vous plaît ?</p>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#374151" }}>Merci d'avance.</p>
              </div>
              <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, display: "block" }}>09:15</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, justifyContent: "flex-end" }}>
            <div style={{ maxWidth: "60%" }}>
              <div style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", borderRadius: "12px 4px 12px 12px", padding: "12px 14px" }}>
                <p style={{ margin: 0, fontSize: 13, color: "white", lineHeight: 1.5 }}>Bonjour Monsieur Dupont,</p>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "rgba(255,255,255,0.9)", lineHeight: 1.5 }}>Vous trouverez en pièce jointe le document complémentaire demandé.</p>
                <div style={{ marginTop: 10, background: "rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "white", fontSize: 18 }}>📄</span>
                  <div>
                    <div style={{ color: "white", fontSize: 12, fontWeight: 600 }}>Plan masse complémentaire.pdf</div>
                    <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>PDF – 2.4 Mo</div>
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, display: "block", textAlign: "right" }}>09:32 ✓✓</span>
            </div>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>ML</div>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#4F46E5", color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>JD</div>
            <div style={{ background: "white", borderRadius: "4px 12px 12px 12px", padding: "10px 14px", border: "1px solid #E2E8F0" }}>
              <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>Merci beaucoup !</p>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>09:55</span>
            </div>
          </div>
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", gap: 10 }}>
          <input placeholder="Écrire un message..." style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 8, padding: "9px 14px", fontSize: 13, outline: "none" }} />
          <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18 }}>📎</button>
          <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18 }}>😊</button>
          <button style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #4F46E5, #6366F1)", border: "none", cursor: "pointer", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}><SendIcon size={14} /></button>
        </div>
      </div>

      <div style={{ width: 260, borderLeft: "1px solid #E2E8F0", background: "white", padding: 16, overflowY: "auto" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Informations</div>
        <div style={{ marginBottom: 4, fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pétitionnaire</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4 }}>Jean Dupont</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>✉ jean.dupont@email.fr</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>📞 06 12 34 56 78</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>📍 12 rue des Lilas, 13400 Saint-Martin</div>
        <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Dossier</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4 }}>PC-2024-0123</div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>Permis de construire</div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Dépôt le 12/04/2024</div>
          <StatusBadge status="En instruction" />
        </div>
        <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#0F172A", marginBottom: 8 }}>Pièces du dossier</div>
          {["Formulaire CERFA","Plan de situation","Plan de masse","Notice descriptive"].map(p => (
            <div key={p} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
              <span style={{ color: "#374151" }}>📄 {p}</span>
              <span style={{ color: "#94a3b8" }}>PDF</span>
            </div>
          ))}
          <button style={{ fontSize: 12, color: "#4F46E5", fontWeight: 500, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Voir toutes les pièces (12) →</button>
        </div>
        <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>Historique des échanges</div>
            <button style={{ fontSize: 11, color: "#4F46E5", background: "none", border: "none", cursor: "pointer" }}>Voir tout</button>
          </div>
          {[["15/05/2024","Pièce complémentaire envoyée","Par vous"],["14/05/2024","Demande de pièce complémentaire","Par vous"],["12/04/2024","Accusé d'enregistrement","Automatique"]].map(([d,e,a]) => (
            <div key={d} style={{ display: "flex", gap: 8, marginBottom: 10, fontSize: 12 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4F46E5", flexShrink: 0, marginTop: 5 }} />
              <div>
                <div style={{ color: "#374151", fontWeight: 500 }}>{e}</div>
                <div style={{ color: "#94a3b8" }}>{a} · {d}</div>
              </div>
            </div>
          ))}
        </div>
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

type DossierInfo = { id: string; type: string; petitionnaire: string; adresse: string; status: string; echeance: string };

function DossierDetailScreen({ dossier, onBack, navigate }: {
  dossier: DossierInfo;
  onBack: () => void;
  navigate: (s: string) => void;
}) {
  const [note, setNote] = useState("");
  const pieces = [
    { name: "Formulaire CERFA", ext: "PDF" },
    { name: "Plan de situation", ext: "PDF" },
    { name: "Plan de masse", ext: "PDF" },
    { name: "Notice descriptive", ext: "PDF" },
    { name: "Photos", ext: "ZIP" },
    { name: "Pièce complémentaire", ext: "PDF" },
  ];
  const timeline = [
    { date: "12/04/2024", event: "Dépôt du dossier", actor: "Jean Dupont (pétitionnaire)" },
    { date: "14/04/2024", event: "Accusé réception envoyé", actor: "Système automatique" },
    { date: "22/04/2024", event: "Envoi en consultation ABF", actor: "Marie Lambert (instructeur)" },
    { date: "30/04/2024", event: "Réception avis ABF", actor: "ABF – Favorable avec réserves" },
    { date: "05/05/2024", event: "Mise en instruction", actor: "Marie Lambert (instructeur)" },
  ];
  const consultations = [
    { service: "ABF – Architecte des Bâtiments de France", status: "Avis reçu", ok: true },
    { service: "SDIS – Service Incendie", status: "En attente", ok: false },
    { service: "Métropole Tours Val de Loire", status: "En attente", ok: false },
  ];
  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "7px 14px", fontSize: 13, color: "#374151", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>← Retour aux dossiers</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", margin: 0 }}>Dossier {dossier.id}</h1>
            <StatusBadge status={dossier.status} />
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{dossier.type} · {dossier.adresse}</div>
        </div>
        <button style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Nouvelle action</button>
      </div>

      {/* Two-column layout */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* Left column */}
        <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Informations générales */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Informations générales</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                ["Pétitionnaire", dossier.petitionnaire],
                ["Adresse", dossier.adresse],
                ["Type de dossier", dossier.type],
                ["Date de dépôt", "12/04/2024"],
                ["Échéance", dossier.echeance],
                ["Instructeur assigné", "Marie Lambert"],
              ].map(([label, value]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Pièces du dossier */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Pièces du dossier</div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
              {pieces.map((p) => (
                <div key={p.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #F1F5F9" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>📄</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{p.ext}</div>
                    </div>
                  </div>
                  <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 10px", fontSize: 12, color: "#4F46E5", cursor: "pointer", fontWeight: 500 }}>Télécharger</button>
                </div>
              ))}
            </div>
          </div>

          {/* Historique */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Historique / Suivi</div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 0 }}>
              {timeline.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 12, paddingBottom: i < timeline.length - 1 ? 16 : 0 }}>
                  <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center" }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#4F46E5", flexShrink: 0, marginTop: 3 }} />
                    {i < timeline.length - 1 && <div style={{ width: 2, flex: 1, background: "#E2E8F0", marginTop: 4 }} />}
                  </div>
                  <div style={{ paddingBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{t.event}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{t.actor} · {t.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, gap: 16 }}>
          {/* Actions rapides */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Actions rapides</div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
              <button style={{ width: "100%", border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left" as const, fontWeight: 500 }}>📎 Demander pièce complémentaire</button>
              <button style={{ width: "100%", border: "1px solid #F97316", background: "#FFF7ED", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#C2410C", cursor: "pointer", textAlign: "left" as const, fontWeight: 500 }}>👥 Envoyer en consultation</button>
              <button style={{ width: "100%", border: "1px solid #4F46E5", background: "#EEF2FF", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#4F46E5", cursor: "pointer", textAlign: "left" as const, fontWeight: 500 }}>📝 Rédiger la décision</button>
              <button onClick={() => navigate("Messagerie")} style={{ width: "100%", border: "1px solid #22C55E", background: "#F0FDF4", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#15803D", cursor: "pointer", textAlign: "left" as const, fontWeight: 500 }}>💬 Contacter le pétitionnaire</button>
            </div>
          </div>

          {/* Consultations */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Consultations</div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
              {consultations.map((c) => (
                <div key={c.service} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
                  <div style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{c.service}</div>
                  <span style={{ fontSize: 11, color: c.ok ? "#15803D" : "#C2410C", background: c.ok ? "#F0FDF4" : "#FFF7ED", borderRadius: 20, padding: "2px 8px", fontWeight: 600, whiteSpace: "nowrap" as const }}>
                    {c.ok ? "✅ Avis reçu" : "⏳ En attente"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Notes internes */}
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Notes internes</div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ajouter une note interne..."
              style={{ width: "100%", minHeight: 80, border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#374151", resize: "vertical" as const, outline: "none", fontFamily: "inherit", boxSizing: "border-box" as const }}
            />
            <button style={{ marginTop: 8, width: "100%", background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Ajouter</button>
          </div>
        </div>
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

export function MairieApp() {
  const [active, setActive] = useState("Tableau de bord");
  const [selectedDossier, setSelectedDossier] = useState<DossierInfo | null>(null);
  const [showNouveauDossier, setShowNouveauDossier] = useState(false);
  const [dossiersFilter, setDossiersFilter] = useState("Tous");

  const handleDossierClick = (dossier: DossierInfo) => {
    setSelectedDossier(dossier);
  };

  const handleDossierBack = () => {
    setSelectedDossier(null);
  };

  const navigateDossiers = (filter: string) => {
    setDossiersFilter(filter);
    setActive("Dossiers");
    setSelectedDossier(null);
  };

  const screenMap = {
    "Tableau de bord": <DashboardScreen navigate={setActive} navigateDossiers={navigateDossiers} />,
    "Dossiers": <DossiersScreen key={dossiersFilter} onDossierClick={handleDossierClick} navigate={setActive} initialFilter={dossiersFilter} />,
    "Messagerie": <MessageScreen onDossierClick={handleDossierClick} />,
    "Paramètres": <ParametresScreen />,
    "Carte": <CarteScreen />,
    "Calendrier": <CalendrierScreen />,
    "Statistiques": <StatistiquesScreen />,
    "Infos Perso": <InfosPersoScreen />,
  };

  const topbarConfig: Record<string, { buttonLabel?: string; commune?: string }> = {
    "Messagerie": { commune: "Saint-Martin" },
    "Carte": { commune: "Saint-Martin" },
    "Calendrier": { commune: "Saint-Martin" },
    "Paramètres": { commune: "Ballan-Miré" },
    "Dossiers": { commune: "Saint-Martin" },
    "Statistiques": { commune: "Ballan-Miré" },
    "Infos Perso": { commune: "Ballan-Miré" },
  };

  const cfg = topbarConfig[active] || {};

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#F8F9FC", minHeight: "100vh", display: "flex" }}>
      <Sidebar active={active} setActive={(s) => { setActive(s); setSelectedDossier(null); }} />
      <div style={{ marginLeft: 180, flex: 1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {active !== "Messagerie" && (
          <Topbar title={active} buttonLabel={cfg.buttonLabel} commune={cfg.commune || "Ballan-Miré"} onNewDossier={() => setShowNouveauDossier(true)} navigate={setActive} />
        )}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {selectedDossier ? (
            <DossierDetailScreen dossier={selectedDossier} onBack={handleDossierBack} navigate={setActive} />
          ) : (
            (Object.hasOwn(screenMap, active) ? screenMap[active as keyof typeof screenMap] : null) ?? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>🏗</div>
                <div style={{ fontSize: 14 }}>Section "{active}" — à implémenter</div>
              </div>
            )
          )}
        </div>
      </div>
      {showNouveauDossier && <NouveauDossierModal onClose={() => setShowNouveauDossier(false)} />}
    </div>
  );
}
