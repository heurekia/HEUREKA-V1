import { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileText, MessageSquare, Eye, Search } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { Seo, ORGANIZATION_JSON_LD, WEBSITE_JSON_LD } from "../../components/Seo";

type BanSuggestion = { label: string };

const features = [
  {
    title: "Comprenez les règles",
    desc: "Consultez les règles d'urbanisme applicables à votre terrain en quelques clics.",
    icon: Search,
  },
  {
    title: "Déposez vos demandes",
    desc: "Déposez vos demandes d'autorisation d'urbanisme en ligne, 24h/24.",
    icon: FileText,
  },
  {
    title: "Suivez vos dossiers",
    desc: "Suivez l'avancement de vos demandes en temps réel.",
    icon: Eye,
  },
  {
    title: "Échangez facilement",
    desc: "Communiquez avec votre commune directement depuis votre espace personnel.",
    icon: MessageSquare,
  },
];

function HouseIllustration() {
  return (
    <svg viewBox="0 0 420 300" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 420, height: 300 }}>
      {/* Background circle */}
      <circle cx="240" cy="155" r="135" fill="#F3F4FF" />

      {/* House shadow */}
      <ellipse cx="233" cy="285" rx="120" ry="8" fill="#E5E7EB" />

      {/* Garage */}
      <rect x="130" y="195" width="75" height="85" rx="2" fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="1.5" />
      <rect x="140" y="210" width="55" height="40" rx="2" fill="#EEF2FF" stroke="#C7D2FE" strokeWidth="1.5" />
      <line x1="167" y1="210" x2="167" y2="250" stroke="#C7D2FE" strokeWidth="1.5" />

      {/* Main house body */}
      <rect x="150" y="155" width="200" height="125" rx="2" fill="white" stroke="#E5E7EB" strokeWidth="2" />

      {/* Roof */}
      <polygon points="135,160 250,80 365,160" fill="#4F46E5" opacity="0.12" />
      <polyline points="135,160 250,82 365,160" stroke="#4F46E5" strokeWidth="2.5" strokeLinejoin="round" />

      {/* Windows – left pair */}
      <rect x="165" y="170" width="50" height="38" rx="3" fill="#EEF2FF" stroke="#C7D2FE" strokeWidth="1.5" />
      <line x1="190" y1="170" x2="190" y2="208" stroke="#C7D2FE" strokeWidth="1" />
      <line x1="165" y1="189" x2="215" y2="189" stroke="#C7D2FE" strokeWidth="1" />

      {/* Windows – right pair */}
      <rect x="235" y="170" width="50" height="38" rx="3" fill="#EEF2FF" stroke="#C7D2FE" strokeWidth="1.5" />
      <line x1="260" y1="170" x2="260" y2="208" stroke="#C7D2FE" strokeWidth="1" />
      <line x1="235" y1="189" x2="285" y2="189" stroke="#C7D2FE" strokeWidth="1" />

      {/* Large window right */}
      <rect x="305" y="165" width="35" height="55" rx="3" fill="#EEF2FF" stroke="#C7D2FE" strokeWidth="1.5" />
      <line x1="305" y1="192" x2="340" y2="192" stroke="#C7D2FE" strokeWidth="1" />

      {/* Door */}
      <rect x="210" y="235" width="36" height="45" rx="4" fill="#C7D2FE" stroke="#A5B4FC" strokeWidth="1.5" />
      <circle cx="239" cy="258" r="2.5" fill="#6366F1" />

      {/* Blueprint card floating */}
      <g transform="rotate(7, 370, 140)">
        <rect x="320" y="75" width="95" height="120" rx="6" fill="white" stroke="#E5E7EB" strokeWidth="1.5" />
        <rect x="332" y="88" width="70" height="50" rx="2" fill="none" stroke="#4F46E5" strokeWidth="1.5" opacity="0.7" />
        <line x1="332" y1="112" x2="402" y2="112" stroke="#4F46E5" strokeWidth="1" opacity="0.5" />
        <line x1="356" y1="88" x2="356" y2="138" stroke="#4F46E5" strokeWidth="1" opacity="0.5" />
        <line x1="332" y1="150" x2="402" y2="150" stroke="#C7D2FE" strokeWidth="1.5" />
        <line x1="332" y1="161" x2="385" y2="161" stroke="#C7D2FE" strokeWidth="1.5" />
        <line x1="332" y1="172" x2="392" y2="172" stroke="#C7D2FE" strokeWidth="1.5" />
      </g>

      {/* Tree */}
      <rect x="113" y="230" width="8" height="48" rx="2" fill="#9CA3AF" />
      <ellipse cx="117" cy="218" rx="22" ry="28" fill="#A7F3D0" />
      <ellipse cx="106" cy="228" rx="16" ry="20" fill="#6EE7B7" />
    </svg>
  );
}

export function Accueil() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<BanSuggestion[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState("");
  // Fix GPS courant (si l'utilisateur s'est localisé). On le conserve pour
  // analyser la parcelle à partir des coordonnées exactes — plus fiable que de
  // re-géocoder l'adresse affichée. Remis à null dès que l'utilisateur tape.
  const [geoCoords, setGeoCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  // « Me localiser » : on récupère la position GPS du navigateur, on la
  // reverse-géocode (BAN) pour afficher l'adresse dans la barre, et on garde les
  // coordonnées exactes pour l'analyse de parcelle. On ne navigue pas tout de
  // suite : l'utilisateur voit l'adresse trouvée puis lance « Analyser mon projet ».
  const handleLocate = () => {
    setGeoError("");
    if (!("geolocation" in navigator)) {
      setGeoError("La géolocalisation n'est pas disponible sur votre appareil.");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setGeoCoords({ lat: latitude, lng: longitude, accuracy });
        // Reverse-géocodage : on restitue l'adresse dans la barre.
        try {
          const r = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${longitude}&lat=${latitude}`);
          const data = await r.json() as { features?: Array<{ properties: { label: string } }> };
          const label = data.features?.[0]?.properties.label;
          if (label) { setQuery(label); setSuggestions([]); setShowSugg(false); }
        } catch { /* l'adresse n'a pas pu être résolue — les coordonnées suffisent */ }
        setGeoLoading(false);
      },
      (err) => {
        setGeoLoading(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Localisation refusée. Autorisez l'accès ou saisissez votre adresse."
            : "Impossible de vous localiser. Saisissez votre adresse ci-dessus."
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleDeposer = () => {
    if (user?.role === "citoyen") navigate("/citoyen/nouvelle-demande");
    else navigate("/register?next=/citoyen/nouvelle-demande");
  };

  const goAnalyse = (q: string) => {
    setSuggestions([]);
    setShowSugg(false);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    // Si on s'est localisé, on transmet les coordonnées exactes (+ précision) :
    // l'analyse de parcelle s'appuie dessus plutôt que sur l'adresse re-géocodée.
    if (geoCoords) {
      params.set("lat", geoCoords.lat.toFixed(6));
      params.set("lng", geoCoords.lng.toFixed(6));
      params.set("acc", String(Math.round(geoCoords.accuracy)));
    }
    navigate(`/analyse-parcellaire?${params.toString()}`);
  };

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setGeoCoords(null); // l'utilisateur saisit une adresse : le fix GPS n'est plus pertinent
    setShowSugg(true);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (val.length < 3) { setSuggestions([]); return; }
    suggestTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(val)}&limit=6`);
        const data = await r.json() as { features?: Array<{ properties: { label: string } }> };
        setSuggestions((data.features ?? []).map(f => ({ label: f.properties.label })));
      } catch { setSuggestions([]); }
    }, 250);
  };

  return (
    <div className="bg-white">
      <Seo
        path="/"
        description="Heurekia simplifie l'urbanisme : analysez votre parcelle, comprenez les règles du PLU, déposez et suivez vos demandes d'autorisation d'urbanisme en ligne."
        jsonLd={[ORGANIZATION_JSON_LD, WEBSITE_JSON_LD]}
      />
      {/* ── Hero ── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-10 flex items-center justify-between gap-10">
        <div className="max-w-xl">
          <h1 className="text-4xl sm:text-5xl font-black text-[#000020] leading-tight mb-6 tracking-tight">
            L'urbanisme{" "}<br className="hidden sm:block" />
            simplifié,{" "}
            <span className="text-heureka-500">pour tous.</span>
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed mb-8">
            Comprenez les règles applicables à votre projet,<br className="hidden sm:block" />
            {" "}déposez vos demandes et suivez leur avancement,<br className="hidden sm:block" />
            {" "}simplement.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleDeposer}
              className="flex items-center gap-2 bg-heureka-500 hover:bg-heureka-600 text-white px-6 py-3.5 rounded-xl font-semibold text-base transition-colors shadow-sm shadow-heureka-200"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
              Déposer une demande d'urbanisme
            </button>
            <Link to="/analyse-parcellaire">
              <button className="flex items-center gap-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 px-5 py-3.5 rounded-xl font-medium text-base transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                Analyser mon terrain
              </button>
            </Link>
          </div>
          <p className="text-xs text-gray-400 mt-4">Gratuit · Sans rendez-vous · En 10 minutes</p>
        </div>
        <div className="hidden lg:block flex-shrink-0">
          <HouseIllustration />
        </div>
      </section>

      {/* ── Analyser une adresse ── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-6">
          {/* Icon + text */}
          <div className="flex items-center gap-4 sm:flex-shrink-0">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#000020]">Analyser une adresse</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Obtenez les règles d'urbanisme applicables<br className="hidden sm:block" /> et une première analyse de votre projet.
              </p>
            </div>
          </div>

          {/* Input + button */}
          <div className="flex flex-col flex-1 gap-2 min-w-0">
           <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-4 bg-gray-50">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
                </svg>
                <input
                  value={query}
                  onChange={e => handleQueryChange(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && query.trim()) goAnalyse(query); if (e.key === "Escape") setShowSugg(false); }}
                  onFocus={() => suggestions.length > 0 && setShowSugg(true)}
                  onBlur={() => setTimeout(() => setShowSugg(false), 150)}
                  placeholder="Ex. : 15 rue des Lilas, 75012 Paris"
                  className="flex-1 bg-transparent py-3.5 text-sm text-gray-700 placeholder-gray-400 outline-none"
                />
                {query && (
                  <button onClick={() => { setQuery(""); setSuggestions([]); setGeoCoords(null); }} className="text-gray-400 hover:text-gray-600 text-base leading-none">×</button>
                )}
              </div>

              {/* BAN suggestions dropdown */}
              {showSugg && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onMouseDown={() => goAnalyse(s.label)}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-50 last:border-none"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
                      </svg>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Boutons d'action — regroupés pour passer sous l'input sur mobile */}
            <div className="flex gap-3">
            {/* Bouton « Me localiser » (icône) — avant « Analyser mon projet » */}
            <button
              type="button"
              onClick={handleLocate}
              disabled={geoLoading}
              title="Me localiser"
              aria-label="Me localiser"
              className="flex-shrink-0 flex items-center justify-center w-12 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 text-heureka-600 disabled:opacity-60 disabled:cursor-default transition-colors"
            >
              {geoLoading ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
              )}
            </button>

            <button
              onClick={() => (query.trim() || geoCoords) && goAnalyse(query)}
              className="flex-1 sm:flex-none flex-shrink-0 flex items-center justify-center gap-2 bg-heureka-500 hover:bg-heureka-600 text-white px-6 py-3.5 rounded-xl font-semibold text-sm transition-colors whitespace-nowrap"
            >
              Analyser mon projet
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
            </div>
           </div>

           {geoError && <span className="text-xs text-amber-600">{geoError}</span>}
          </div>
        </div>
      </section>

      {/* ── Tout ce dont vous avez besoin ── */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-center text-[#000020] mb-12">Tout ce dont vous avez besoin</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map(({ title, desc, icon: Icon }) => (
              <div key={title} className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-heureka-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#000020] mb-1">{title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-gray-50 border-t border-gray-200 py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="text-xl font-bold text-[#000020] mb-1">Prêt à simplifier vos démarches ?</h2>
            <p className="text-sm text-gray-500">Créez votre compte gratuitement pour déposer vos demandes<br />et suivre tous vos projets.</p>
          </div>
          <div className="flex gap-3 flex-shrink-0">
            <button
              onClick={handleDeposer}
              className="bg-heureka-500 hover:bg-heureka-600 text-white px-6 py-3 rounded-lg text-sm font-semibold transition-colors"
            >
              Déposer une demande →
            </button>
            {!user && (
              <Link to="/login">
                <button className="border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 px-5 py-3 rounded-lg text-sm font-semibold transition-colors">
                  Se connecter
                </button>
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
