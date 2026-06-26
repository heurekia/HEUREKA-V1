import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { MapLeaflet } from "../../components/MapLeaflet";
import { api } from "../../lib/api";
import type { BaseLayer } from "../../components/MapLeaflet";
import { Seo } from "../../components/Seo";
import { ParcelSynthese, type ParcelSynthesisData } from "../../components/ParcelSynthese";
import { seismicShortLabel } from "@heureka-v1/shared";

// ── Types ────────────────────────────────────────────────────────────────────

type Servitude = {
  categorie: string;
  libelle?: string;
  nomsup?: string;
  dessup?: string;
  geometry_type?: "surface" | "lineaire";
  ref_acte?: string;
  urlacte?: string;
  gestionnaire?: string;
  datdecr?: string;
  typeprotect?: string;
};

type ParcelAnalysis = {
  query: string;
  address?: { label: string; lat: number; lng: number; city: string; postcode: string; citycode: string; score?: number };
  parcel?: { parcelle_id: string; section: string; numero: string; surface_m2: number; commune: string; code_insee: string; geometry?: unknown };
  plu_zone?: { zone_code: string; zone_label: string; zone_type: string; plu_nom?: string; plu_etat?: string };
  risks?: { flood_risk: string; seismic_zone: string; clay_risk?: string; landslide_risk?: string; radon_level?: string };
  db_zone?: { id: string; code: string; label: string | null; type: string | null } | null;
  rules: Array<{ id: string; topic: string; rule_text: string; value_min: number | null; value_max: number | null; value_exact: number | null; unit: string | null; summary: string | null; article_number: number | null; conditions: string | null; cases?: Array<{ condition: string; value: number | null; unit: string | null; kind?: "condition" | "parametre" }> | null; sub_theme?: string | null; applies_if?: string[] | null; relevance?: "general" | "applicable" | "conditional" | "excluded"; exceptions?: string | null; citizen_title?: string | null; citizen_summary?: string | null; citizen_relevant?: boolean | null }>;
  buildability: {
    maxFootprintM2: number; remainingFootprintM2: number | null; maxHeightM: number | null;
    minSetbackFromRoadM: number | null; minSetbackFromBoundariesM: number | null;
    estimatedFloors: number | null; greenSpaceRatio: number | null;
    greenSpaceRequiredM2: number | null; confidence: number; resultSummary: string;
  } | null;
  built_footprint_m2?: number;
  available_zones?: Array<{ zone_code: string; zone_label: string; zone_type: string }>;
  prescriptions?: Array<{ libelle: string; typepsc: string; txtpsc?: string }>;
  servitudes?: Servitude[];
  informations?: Array<{ libelle: string; typeinf?: string; txtinf?: string }>;
  municipality?: { is_rnu: boolean; libelle?: string } | null;
  scot?: string;
  synthesis?: ParcelSynthesisData;
  data_sources: string[];
  warnings: string[];
};

type BanSuggestion = { label: string; lat: number; lng: number; citycode: string };

// Au-delà de ce rayon de précision GPS (mètres), on ne fait PAS confiance à la
// parcelle située sous le point : en ville les parcelles font souvent moins de
// 15 m de large, et un GPS imprécis sélectionnerait la parcelle voisine. Sous ce
// seuil on pré-analyse (avec invitation à vérifier) ; au-dessus on demande à
// l'utilisateur de cliquer lui-même sa parcelle sur la carte.
const GOOD_ACCURACY_M = 20;

// ── Constants ────────────────────────────────────────────────────────────────

const TOPIC_LABEL: Record<string, string> = {
  recul_voie: "Recul voirie", recul_limite: "Recul limites", emprise_sol: "Emprise au sol",
  hauteur: "Hauteur max.", stationnement: "Stationnement", espaces_verts: "Espaces verts",
  terrain_min: "Terrain minimum", recul_batiments: "Recul entre bâtiments",
  destinations: "Destinations autorisées", aspect: "Aspect extérieur", general: "Disposition générale",
};

// Topics whose rule is textual/qualitative (no numeric value) — rendered in full,
// in plain language, rather than as a numeric badge. "aspect" (article 11 du PLU)
// couvre matériaux, couleurs, toitures, menuiseries/huisseries et clôtures.
const QUALITATIVE_TOPICS = new Set(["aspect", "destinations", "general"]);

// Libellés des tags d'applicabilité (affichage citoyen).
const APPLIES_LABEL_PUB: Record<string, string> = {
  protege_l151_19: "si élément protégé (L.151-19)", unesco: "si périmètre UNESCO", abf: "si périmètre ABF",
  inondable: "si zone inondable", extension: "en cas d'extension", surelevation: "en cas de surélévation",
  ravalement: "en cas de ravalement", demolition: "en cas de démolition", cloture_sur_rue: "clôture sur rue",
  cloture_limite: "clôture en limite", annexe: "pour une annexe", devanture_commerciale: "devanture commerciale",
  equipement_public: "équipement public",
};

// Short icon per topic to help the citizen scan the regulatory synthesis.
const TOPIC_ICON: Record<string, string> = {
  recul_voie: "📏", recul_limite: "📐", emprise_sol: "🏗️", hauteur: "📐",
  stationnement: "🅿️", espaces_verts: "🌳", terrain_min: "📦",
  recul_batiments: "↔️", destinations: "🏠", aspect: "🎨", general: "📋",
};

const ZONE_TYPE_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  U:  { bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5" },
  AU: { bg: "#FFEDD5", text: "#9A3412", border: "#FDba74" },
  A:  { bg: "#FEF9C3", text: "#854D0E", border: "#FDE047" },
  N:  { bg: "#DCFCE7", text: "#166534", border: "#86EFAC" },
};

const ZONE_TYPE_LABEL: Record<string, string> = {
  U: "Urbaine", AU: "À urbaniser", A: "Agricole", N: "Naturelle et forestière",
};

// Servitude d'Utilité Publique (SUP) category descriptions
const SUP_GROUPS: Record<string, { label: string; icon: string; color: string; bg: string; border: string; desc: string }> = {
  AC: { label: "Patrimoine — ABF", icon: "⚜", color: "#7C3AED", bg: "#F5F3FF", border: "#C4B5FD",
    desc: "Périmètre de protection d'un monument historique ou secteur sauvegardé. L'Architecte des Bâtiments de France doit donner son avis sur tout projet." },
  EL: { label: "Lignes électriques", icon: "⚡", color: "#B45309", bg: "#FFFBEB", border: "#FCD34D",
    desc: "Présence de lignes électriques (HTA, HTB, THT). Des distances minimales de sécurité s'appliquent aux constructions." },
  PM: { label: "Prévention des risques", icon: "⛔", color: "#991B1B", bg: "#FEF2F2", border: "#FECACA",
    desc: "Plan de Prévention des Risques Naturels ou Technologiques. Des restrictions de construction peuvent s'appliquer." },
  T:  { label: "Réseaux de transport", icon: "🛣", color: "#374151", bg: "#F9FAFB", border: "#E5E7EB",
    desc: "Infrastructure de transport (route, autoroute, voie ferrée). Des marges de recul peuvent être imposées." },
  I:  { label: "Infrastructure industrielle", icon: "🔧", color: "#92400E", bg: "#FFFBEB", border: "#FDE68A",
    desc: "Canalisation de transport d'hydrocarbures ou réseau industriel. Zones de sécurité réglementaires." },
  AS: { label: "Archéologie", icon: "🏛", color: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE",
    desc: "Zone de présomption de prescription archéologique. Un diagnostic archéologique peut être requis avant les travaux." },
  A:  { label: "Agriculture", icon: "🌾", color: "#065F46", bg: "#ECFDF5", border: "#A7F3D0",
    desc: "Espaces agricoles sensibles ou périmètre de protection agricole." },
};

function getSupGroup(categorie: string) {
  const prefix = categorie.replace(/\d/g, "");
  return SUP_GROUPS[prefix] ?? { label: `SUP ${categorie}`, icon: "📌", color: "#374151", bg: "#F9FAFB", border: "#E5E7EB", desc: "Servitude d'utilité publique." };
}

const SUP_CAT_DETAIL: Record<string, string> = {
  AC1: "Protection MH classé (500 m)", AC2: "Protection MH inscrit (500 m)",
  AC3: "ZPPAUP / AVAP", AC4: "Secteur sauvegardé",
  EL1: "HTA (> 50 kV)", EL2: "HTB / THT", EL3: "Ferroviaire électrifié",
  EL7: "Distribution HTA publique", EL11: "Tramway",
  PM1: "PPRn Inondation", PM2: "PPRn Sécheresse/Argiles", PM3: "PPRn Avalanche",
  PM4: "PPRn Incendie forêt", PM5: "PPRn Séisme", PM8: "PPRn Mouvement de terrain",
  T1: "Route nationale", T2: "Autoroute", T4: "Voie ferrée", T7: "Voie navigable",
  I3: "Canalisation hydrocarbures", I4: "Gazoduc",
  AS1: "Zone archéologique présomptive",
};

function riskColor(v: string) {
  return v === "fort" ? { bg: "#FEE2E2", color: "#991B1B" }
    : v === "moyen" ? { bg: "#FEF3C7", color: "#92400E" }
    : v === "faible" ? { bg: "#ECFDF5", color: "#065F46" }
    : v === "nul" ? { bg: "#F0FDF4", color: "#166534" }
    : { bg: "#F9FAFB", color: "#6B7280" };
}

function riskLabel(v: string, labels?: Record<string, string>) {
  const map = labels ?? { fort: "Aléa fort", moyen: "Aléa moyen", faible: "Aléa faible", nul: "Nul", inconnu: "Non déterminé" };
  return map[v] ?? v;
}

function floodColor(v: string) { return riskColor(v); }
function floodLabel(v: string) {
  return riskLabel(v, { fort: "Aléa fort – PPRI", moyen: "Aléa moyen", faible: "Aléa faible", nul: "Hors zone inondable", inconnu: "Non déterminé" });
}

// ── Component ────────────────────────────────────────────────────────────────

export function AnalyseParcellaire() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  const handleDeposer = () => {
    const wizardUrl = `/citoyen/nouvelle-demande${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`;
    if (!authLoading && user?.role === "citoyen") {
      navigate(wizardUrl);
    } else if (!authLoading) {
      navigate(`/login?next=${encodeURIComponent(wizardUrl)}`);
    }
    // If still loading, do nothing — button should be shown as loading
  };
  const [suggestions, setSuggestions] = useState<BanSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [analysis, setAnalysis] = useState<ParcelAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clickMode, setClickMode] = useState(false);
  const [geoPosition, setGeoPosition] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("ign-ortho");
  const [rulesOpen, setRulesOpen] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const doAnalyse = useCallback(async (params: Record<string, string>) => {
    setLoading(true);
    setError("");
    setAnalysis(null);
    setSuggestions([]);
    setShowSuggestions(false);
    try {
      const qs = new URLSearchParams(params).toString();
      const result = await api.get<ParcelAnalysis>(`/public/analyse?${qs}`);
      setAnalysis(result);
      setClickMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de recherche");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    doAnalyse({ q: query.trim() });
  }, [query, doAnalyse]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    doAnalyse({ lat: String(lat), lng: String(lng) });
  }, [doAnalyse]);

  // Auto-run when arriving from Accueil with ?q= (address) or ?lat/lng (geoloc)
  useEffect(() => {
    const q = searchParams.get("q");
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    // « Me localiser » : on arrive avec des coordonnées GPS (+ précision), et
    // éventuellement l'adresse re-géocodée à afficher dans la barre. L'analyse
    // s'appuie sur les coordonnées exactes, plus fiables que l'adresse.
    if (lat && lng) {
      if (q?.trim()) setQuery(q);
      const accParam = searchParams.get("acc");
      const accuracy = accParam != null ? Number(accParam) : undefined;
      setGeoPosition({ lat: Number(lat), lng: Number(lng), accuracy });
      if (accuracy != null && Number.isFinite(accuracy) && accuracy <= GOOD_ACCURACY_M) {
        // Précision suffisante : on pré-analyse la parcelle sous le point, mais
        // on invite l'utilisateur à vérifier (bandeau ci-dessous).
        doAnalyse({ lat, lng });
      } else {
        // Précision insuffisante : on laisse l'utilisateur confirmer sa parcelle.
        setClickMode(true);
      }
      return;
    }
    if (q?.trim()) {
      setQuery(q);
      doAnalyse({ q: q.trim() });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BAN address autocomplete
  const handleQueryChange = (val: string) => {
    setQuery(val);
    setShowSuggestions(true);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (val.length < 3) { setSuggestions([]); return; }
    suggestTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(val)}&limit=6&type=housenumber`);
        const data = await r.json() as {
          features?: Array<{ properties: { label: string; citycode: string }; geometry: { coordinates: [number, number] } }>;
        };
        setSuggestions(
          (data.features ?? []).map(f => ({
            label: f.properties.label,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
            citycode: f.properties.citycode,
          }))
        );
      } catch { setSuggestions([]); }
    }, 250);
  };

  const pickSuggestion = (s: BanSuggestion) => {
    setQuery(s.label);
    setSuggestions([]);
    setShowSuggestions(false);
    doAnalyse({ q: s.label });
  };

  const zone = analysis?.plu_zone ?? (analysis?.db_zone ? {
    zone_code: analysis.db_zone.code,
    zone_label: analysis.db_zone.label ?? analysis.db_zone.code,
    zone_type: analysis.db_zone.type ?? "U",
  } : null);

  const confidence = analysis?.buildability ? Math.round(analysis.buildability.confidence * 100) : null;
  const parcelGeometry = analysis?.parcel?.geometry as object | undefined;

  // When arriving via "Me localiser", center the map on the GPS point (read from
  // the URL so it's available before the map mounts) rather than the France view.
  const geoLatParam = searchParams.get("lat");
  const geoLngParam = searchParams.get("lng");
  const hasGeoParams = !!(geoLatParam && geoLngParam);
  const mapCenter: [number, number] = hasGeoParams ? [Number(geoLatParam), Number(geoLngParam)] : [46.6, 2.3];
  const mapZoom = hasGeoParams ? 18 : 6;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "white", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <Seo
        title="Analyse parcellaire — PLU, risques et constructibilité"
        description="Analysez gratuitement une parcelle cadastrale : zone PLU, règles d'urbanisme applicables, risques (inondation, séisme, argile, radon) et constructibilité."
        path="/analyse-parcellaire"
      />
      {/* ── Header ── */}
      <header style={{ height: 52, borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", padding: "0 20px", gap: 16, flexShrink: 0, background: "white", zIndex: 10 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}>
          <div style={{ width: 28, height: 28, background: "#4F46E5", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "white", fontWeight: 800, fontSize: 11 }}>H</span>
          </div>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#000020" }}>HEUREKIA</span>
        </Link>

        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>

        <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>Analyse de parcelle</span>

        <div style={{ flex: 1 }} />

        {/* Map controls */}
        <button
          onClick={() => setClickMode(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600,
            border: "1.5px solid", cursor: "pointer", transition: "all 0.12s",
            borderColor: clickMode ? "#4F46E5" : "#E5E7EB",
            background: clickMode ? "#EEF2FF" : "white",
            color: clickMode ? "#4F46E5" : "#6B7280",
          }}
          title="Cliquez sur la carte pour analyser un point"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8z" /><circle cx="12" cy="10" r="3" />
          </svg>
          {clickMode ? "Cliquer sur la carte…" : "Cliquer sur la carte"}
        </button>

        <div style={{ display: "flex", border: "1px solid #E5E7EB", borderRadius: 7, overflow: "hidden" }}>
          {([
            { key: "ign-ortho", label: "Photo" },
            { key: "carto-light", label: "Neutre" },
            { key: "ign-plan", label: "Plan" },
          ] as { key: BaseLayer; label: string }[]).map(({ key, label }, i, arr) => (
            <button key={key} onClick={() => setBaseLayer(key)} style={{
              padding: "5px 10px", border: "none",
              borderRight: i < arr.length - 1 ? "1px solid #E5E7EB" : "none",
              cursor: "pointer", fontSize: 11.5, fontWeight: baseLayer === key ? 700 : 400,
              background: baseLayer === key ? "#4F46E5" : "white",
              color: baseLayer === key ? "white" : "#6B7280",
            }}>{label}</button>
          ))}
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left panel ── */}
        <div style={{ width: 420, flexShrink: 0, borderRight: "1px solid #E5E7EB", display: "flex", flexDirection: "column", overflowY: "auto", background: "white" }}>

          {/* Search */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #F3F4F6", flexShrink: 0, position: "sticky", top: 0, background: "white", zIndex: 5 }}>
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "0 12px", background: "#F9FAFB" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => handleQueryChange(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { handleSearch(); setShowSuggestions(false); } if (e.key === "Escape") setShowSuggestions(false); }}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  placeholder="Adresse ou réf. cadastrale…"
                  style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 13, color: "#111827", padding: "10px 0" }}
                />
                {query && (
                  <button onClick={() => { setQuery(""); setSuggestions([]); setAnalysis(null); setError(""); inputRef.current?.focus(); }}
                    style={{ border: "none", background: "none", cursor: "pointer", color: "#9CA3AF", padding: 0, fontSize: 16, lineHeight: 1 }}>×</button>
                )}
              </div>

              {/* Suggestions dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "white", border: "1px solid #E5E7EB", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.1)", zIndex: 100, overflow: "hidden" }}>
                  {suggestions.map((s, i) => (
                    <button key={i} onMouseDown={() => pickSuggestion(s)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left" as const, fontSize: 13, color: "#374151", borderBottom: i < suggestions.length - 1 ? "1px solid #F9FAFB" : "none" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#F9FAFB")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
                      </svg>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={handleSearch} disabled={loading || !query.trim()} style={{ flex: 1, padding: "8px 0", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: loading || !query.trim() ? "not-allowed" : "pointer", opacity: loading || !query.trim() ? 0.6 : 1, transition: "opacity 0.12s" }}>
                {loading ? "Analyse…" : "Analyser"}
              </button>
            </div>

            <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 7, lineHeight: 1.4 }}>
              Adresse libre · référence cadastrale (37018000AB0050) · ou cliquez sur la carte →
            </p>
          </div>

          {/* Content area */}
          <div style={{ flex: 1, padding: "14px 16px" }}>

            {/* Bandeau géolocalisation — fiabilité de la parcelle */}
            {geoPosition && (
              <div style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", gap: 8 }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>📍</span>
                <p style={{ fontSize: 12, color: "#3730A3", margin: 0, lineHeight: 1.45 }}>
                  {analysis
                    ? <>Parcelle déterminée depuis votre position GPS{geoPosition.accuracy != null ? ` (précision ±${Math.round(geoPosition.accuracy)} m)` : ""}. <strong>Vérifiez sur la carte qu'il s'agit bien de votre terrain</strong> — au besoin, cliquez sur la bonne parcelle.</>
                    : <>Position GPS approximative{geoPosition.accuracy != null ? ` (±${Math.round(geoPosition.accuracy)} m)` : ""}. <strong>Cliquez sur votre parcelle</strong> sur la carte pour l'analyser.</>}
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px", color: "#991B1B", fontSize: 13, marginBottom: 12 }}>
                {error}
              </div>
            )}

            {/* Loading skeleton */}
            {loading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 0" }}>
                {[100, 80, 60, 90, 70].map((w, i) => (
                  <div key={i} style={{ height: 16, background: "#F3F4F6", borderRadius: 4, width: `${w}%`, animation: "pulse 1.5s ease-in-out infinite" }} />
                ))}
                <p style={{ fontSize: 12, color: "#9CA3AF", textAlign: "center", marginTop: 8 }}>
                  Interrogation des APIs IGN, GPU, GéoRisques…
                </p>
              </div>
            )}

            {/* Warnings */}
            {!loading && analysis?.warnings && analysis.warnings.length > 0 && (
              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
                {analysis.warnings.map((w, i) => (
                  <p key={i} style={{ fontSize: 12, color: "#92400E", margin: i > 0 ? "4px 0 0" : 0 }}>⚠ {w}</p>
                ))}
              </div>
            )}

            {/* Analysis results */}
            {!loading && analysis && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                {/* Address & parcel info */}
                <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "12px 14px" }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
                    {analysis.address?.label ?? analysis.parcel?.parcelle_id ?? analysis.query}
                  </p>
                  {analysis.parcel && (
                    <div style={{ marginBottom: 6 }}>
                      <p style={{ fontSize: 12, color: "#6B7280", margin: "0 0 4px" }}>
                        {analysis.parcel.commune} ({analysis.parcel.code_insee}) · {analysis.parcel.surface_m2.toLocaleString("fr-FR")} m²
                      </p>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const }}>
                        <span style={{ fontSize: 11, color: "#374151" }}>
                          <span style={{ color: "#9CA3AF" }}>Réf. cadastrale </span>
                          <strong>{analysis.parcel.parcelle_id}</strong>
                        </span>
                        <span style={{ fontSize: 11, color: "#374151" }}>
                          <span style={{ color: "#9CA3AF" }}>Section </span>
                          <strong>{analysis.parcel.section}</strong>
                          <span style={{ color: "#9CA3AF" }}> N° </span>
                          <strong>{analysis.parcel.numero}</strong>
                        </span>
                      </div>
                      {analysis.address && (
                        <p style={{ fontSize: 10, color: "#9CA3AF", margin: "4px 0 0" }}>
                          {analysis.address.lat.toFixed(5)}, {analysis.address.lng.toFixed(5)}
                          {analysis.address.score != null && analysis.address.score < 0.7 && (
                            <span style={{ marginLeft: 6, color: "#D97706" }}>⚠ Géocodage approx. ({Math.round(analysis.address.score * 100)}%)</span>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Sources techniques (BAN, IGN, GPU, BD TOPO…) volontairement
                      masquées de la vue citoyen : elles restent dans la réponse
                      API (`analysis.data_sources`) pour traçabilité et analyses
                      côté serveur, mais polluent inutilement la lecture publique. */}
                </div>

                {/* Zone PLU */}
                {zone && (() => {
                  const zoneTypeKey = zone.zone_type?.startsWith("AU") ? "AU" : zone.zone_type?.startsWith("U") ? "U" : zone.zone_type?.startsWith("N") ? "N" : zone.zone_type?.startsWith("A") ? "A" : "U";
                  const zc = ZONE_TYPE_COLOR[zoneTypeKey] ?? ZONE_TYPE_COLOR["U"]!;
                  const pluEtat = analysis.plu_zone?.plu_etat?.toLowerCase() ?? "";
                  const isApproved = pluEtat.includes("approuv");
                  return (
                    <div style={{ border: `1.5px solid ${zc.border}`, borderRadius: 10, padding: "12px 14px", background: zc.bg }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <p style={{ fontSize: 10, fontWeight: 700, color: zc.text, textTransform: "uppercase" as const, letterSpacing: "0.06em", margin: 0 }}>Zone réglementaire</p>
                        {pluEtat && (
                          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: isApproved ? "#D1FAE5" : "#FEF3C7", color: isApproved ? "#065F46" : "#92400E" }}>
                            PLU {isApproved ? "approuvé" : "en cours"}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 28, fontWeight: 900, color: zc.text, lineHeight: 1 }}>{zone.zone_code}</span>
                        <span style={{ fontSize: 13, color: zc.text, fontWeight: 500 }}>{zone.zone_label}</span>
                      </div>
                      <p style={{ fontSize: 11, color: zc.text, opacity: 0.8, margin: "0 0 2px" }}>
                        Zone {zoneTypeKey} — {ZONE_TYPE_LABEL[zoneTypeKey] ?? zoneTypeKey}
                      </p>
                      {analysis.plu_zone?.plu_nom && (
                        <p style={{ fontSize: 10, color: zc.text, opacity: 0.6, margin: "2px 0 0" }}>{analysis.plu_zone.plu_nom}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Available zones selector (when GPU failed) */}
                {!zone && analysis.available_zones && analysis.available_zones.length > 0 && (
                  <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 14px" }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px" }}>
                      Zone PLU non déterminée — sélectionnez manuellement
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {analysis.available_zones.map(z => (
                        <button key={z.zone_code} onClick={() => doAnalyse({ q: analysis.query, zone: z.zone_code })}
                          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #C7D2FE", background: "#EEF2FF", color: "#4F46E5", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          {z.zone_code}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Constructibility */}
                {analysis.buildability && (
                  <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Constructibilité</p>
                      {confidence !== null && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: confidence >= 80 ? "#059669" : confidence >= 50 ? "#D97706" : "#DC2626", background: confidence >= 80 ? "#D1FAE5" : confidence >= 50 ? "#FEF3C7" : "#FEE2E2", borderRadius: 20, padding: "2px 8px" }}>
                          {confidence}% données
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {[
                        ["Emprise au sol max.", analysis.buildability.maxFootprintM2 > 0 ? `${Math.round(analysis.buildability.maxFootprintM2)} m²` : "—"],
                        // Bâti existant mesuré (BD TOPO®) et emprise restante réelle — affichés
                        // seulement si le bâti a pu être déterminé.
                        ...(analysis.built_footprint_m2 != null
                          ? [["Bâti existant", `${Math.round(analysis.built_footprint_m2)} m²`]]
                          : []),
                        ...(analysis.buildability.remainingFootprintM2 != null
                          ? [["Emprise restante", `${Math.round(analysis.buildability.remainingFootprintM2)} m²`]]
                          : []),
                        ["Hauteur maximale", analysis.buildability.maxHeightM ? `${analysis.buildability.maxHeightM} m` : "—"],
                        ["Espaces verts à préserver", analysis.buildability.greenSpaceRequiredM2 ? `${Math.round(analysis.buildability.greenSpaceRequiredM2)} m²` : "—"],
                      ].map(([l, v]) => (
                        <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span style={{ color: "#6B7280" }}>{l}</span>
                          <span style={{ fontWeight: 600, color: "#111827" }}>{v}</span>
                        </div>
                      ))}
                    </div>
                    {analysis.buildability.resultSummary && (
                      <p style={{ fontSize: 12, color: "#059669", background: "#D1FAE5", borderRadius: 6, padding: "6px 10px", marginTop: 8, margin: "8px 0 0" }}>✓ {analysis.buildability.resultSummary}</p>
                    )}
                  </div>
                )}

                {/* Risks */}
                {analysis.risks && (
                  <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 14px" }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase" as const, letterSpacing: "0.06em", margin: "0 0 8px" }}>Risques naturels</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {/* Inondation */}
                      {(() => { const c = floodColor(analysis.risks.flood_risk); return (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, background: c.bg, color: c.color, borderRadius: 6, padding: "6px 10px" }}>
                          <span>💧 Inondation</span><span>{floodLabel(analysis.risks.flood_risk)}</span>
                        </div>
                      ); })()}
                      {/* Mouvement de terrain */}
                      {analysis.risks.landslide_risk && analysis.risks.landslide_risk !== "inconnu" && (() => {
                        const c = riskColor(analysis.risks.landslide_risk!);
                        return (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, background: c.bg, color: c.color, borderRadius: 6, padding: "6px 10px" }}>
                            <span>⛰ Mouvement de terrain</span>
                            <span>{riskLabel(analysis.risks.landslide_risk!)}</span>
                          </div>
                        );
                      })()}
                      {/* Retrait-gonflement argiles */}
                      {analysis.risks.clay_risk && analysis.risks.clay_risk !== "inconnu" && (() => {
                        const c = riskColor(analysis.risks.clay_risk!);
                        return (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, background: c.bg, color: c.color, borderRadius: 6, padding: "6px 10px" }}>
                            <span>🪨 Argiles (R-G)</span>
                            <span>{riskLabel(analysis.risks.clay_risk!, { fort: "Aléa fort", moyen: "Aléa moyen", faible: "Aléa faible", nul: "Nul" })}</span>
                          </div>
                        );
                      })()}
                      {/* Radon */}
                      {analysis.risks.radon_level && analysis.risks.radon_level !== "inconnu" && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600,
                          background: analysis.risks.radon_level === "3" ? "#FEE2E2" : analysis.risks.radon_level === "2" ? "#FEF3C7" : "#F9FAFB",
                          color: analysis.risks.radon_level === "3" ? "#991B1B" : analysis.risks.radon_level === "2" ? "#92400E" : "#374151",
                          borderRadius: 6, padding: "6px 10px" }}>
                          <span>☢ Radon</span>
                          <span>Zone {analysis.risks.radon_level} {analysis.risks.radon_level === "3" ? "(potentiel élevé)" : analysis.risks.radon_level === "2" ? "(potentiel moyen)" : "(potentiel faible)"}</span>
                        </div>
                      )}
                      {/* Sismique */}
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, background: "#F9FAFB", color: "#374151", borderRadius: 6, padding: "6px 10px" }}>
                        <span>🌍 Sismique</span><span>{seismicShortLabel(analysis.risks.seismic_zone) ?? `Zone ${analysis.risks.seismic_zone}`} (zone {analysis.risks.seismic_zone})</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* SCoT */}
                {analysis.scot && (
                  <div style={{ border: "1px solid #E0E7FF", borderRadius: 10, padding: "10px 14px", background: "#EEF2FF", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>🗺</span>
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "#4F46E5", textTransform: "uppercase" as const, letterSpacing: "0.06em", margin: "0 0 1px" }}>SCoT</p>
                      <p style={{ fontSize: 12, color: "#312E81", fontWeight: 600, margin: 0 }}>{analysis.scot}</p>
                    </div>
                  </div>
                )}

                {/* Périmètres d'informations */}
                {(analysis.informations?.length ?? 0) > 0 && (
                  <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 14px" }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase" as const, letterSpacing: "0.06em", margin: "0 0 8px" }}>
                      Périmètres d'informations ({analysis.informations!.length})
                    </p>
                    {analysis.informations!.map((info, i) => (
                      <div key={i} style={{ marginBottom: i < analysis.informations!.length - 1 ? 6 : 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          {info.typeinf && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#374151", background: "#F3F4F6", borderRadius: 4, padding: "1px 5px" }}>{info.typeinf}</span>
                          )}
                          <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{info.libelle}</span>
                        </div>
                        {info.txtinf && (
                          <p style={{ fontSize: 11, color: "#6B7280", margin: "2px 0 0", lineHeight: 1.4 }}>{info.txtinf.slice(0, 160)}{info.txtinf.length > 160 ? "…" : ""}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Prescriptions PLU */}
                {(analysis.prescriptions?.length ?? 0) > 0 && (
                  <div style={{ border: "1px solid #FDE68A", borderRadius: 10, padding: "12px 14px", background: "#FFFBEB" }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#92400E", textTransform: "uppercase" as const, letterSpacing: "0.06em", margin: "0 0 8px" }}>
                      Prescriptions PLU ({analysis.prescriptions!.length})
                    </p>
                    {analysis.prescriptions!.map((p, i) => (
                      <div key={i} style={{ marginBottom: i < analysis.prescriptions!.length - 1 ? 6 : 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#92400E" }}>
                          {p.typepsc && <span style={{ background: "#FEF3C7", borderRadius: 4, padding: "1px 5px", fontSize: 10, marginRight: 6 }}>{p.typepsc}</span>}
                          {p.libelle || p.typepsc}
                        </div>
                        {p.txtpsc && <div style={{ fontSize: 11, color: "#B45309", marginTop: 2, lineHeight: 1.4 }}>{p.txtpsc.slice(0, 140)}{p.txtpsc.length > 140 ? "…" : ""}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Servitudes d'utilité publique */}
                {(analysis.servitudes?.length ?? 0) > 0 && (() => {
                  const groups = new Map<string, Servitude[]>();
                  for (const s of analysis.servitudes!) {
                    const prefix = (s.categorie || "SUP").replace(/\d/g, "");
                    if (!groups.has(prefix)) groups.set(prefix, []);
                    groups.get(prefix)!.push(s);
                  }
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase" as const, letterSpacing: "0.06em", margin: 0 }}>
                        Servitudes d'utilité publique ({analysis.servitudes!.length})
                      </p>
                      {Array.from(groups.entries()).map(([prefix, items]) => {
                        const g = getSupGroup(items[0]?.categorie ?? "");
                        return (
                          <div key={prefix} style={{ border: `1px solid ${g.border}`, borderRadius: 10, padding: "12px 14px", background: g.bg }}>
                            {/* Group header */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <span style={{ fontSize: 16 }}>{g.icon}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: g.color }}>{g.label}</span>
                            </div>
                            <p style={{ fontSize: 11, color: g.color, opacity: 0.75, margin: "0 0 10px", lineHeight: 1.4 }}>{g.desc}</p>

                            {/* Per-servitude cards */}
                            {items.map((s, i) => (
                              <div key={i} style={{ background: "rgba(255,255,255,0.7)", borderRadius: 8, padding: "10px 12px", marginBottom: i < items.length - 1 ? 6 : 0, border: `1px solid ${g.border}` }}>

                                {/* Top row: badge + sous-type + géom */}
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const, marginBottom: 4 }}>
                                  {s.categorie && (
                                    <span style={{ fontSize: 10, fontWeight: 700, color: g.color, background: g.bg, border: `1px solid ${g.border}`, borderRadius: 4, padding: "1px 6px" }}>
                                      {s.categorie}
                                    </span>
                                  )}
                                  {SUP_CAT_DETAIL[s.categorie] && (
                                    <span style={{ fontSize: 10, color: g.color, opacity: 0.75, fontStyle: "italic" }}>{SUP_CAT_DETAIL[s.categorie]}</span>
                                  )}
                                  {s.typeprotect && !SUP_CAT_DETAIL[s.categorie] && (
                                    <span style={{ fontSize: 10, color: g.color, opacity: 0.75, fontStyle: "italic" }}>{s.typeprotect}</span>
                                  )}
                                  {s.geometry_type === "lineaire" && (
                                    <span style={{ fontSize: 9, color: "#6B7280", background: "#F3F4F6", borderRadius: 4, padding: "1px 4px" }}>linéaire</span>
                                  )}
                                </div>

                                {/* Monument / nom principal */}
                                {s.nomsup && (
                                  <p style={{ fontSize: 12, color: g.color, fontWeight: 600, margin: "0 0 3px", lineHeight: 1.3 }}>
                                    {s.nomsup}
                                  </p>
                                )}

                                {/* Libellé de la catégorie si différent du nom */}
                                {s.libelle && s.libelle !== s.nomsup && (
                                  <p style={{ fontSize: 11, color: g.color, opacity: 0.8, margin: "0 0 3px" }}>{s.libelle}</p>
                                )}

                                {/* Description textuelle */}
                                {s.dessup && (
                                  <p style={{ fontSize: 11, color: "#374151", margin: "0 0 4px", lineHeight: 1.4 }}>{s.dessup}</p>
                                )}

                                {/* Meta row: gestionnaire + date */}
                                {(s.gestionnaire || s.datdecr) && (
                                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const, marginTop: 4 }}>
                                    {s.gestionnaire && (
                                      <span style={{ fontSize: 10, color: "#6B7280", background: "#F3F4F6", borderRadius: 4, padding: "1px 6px" }}>
                                        {s.gestionnaire}
                                      </span>
                                    )}
                                    {s.datdecr && (
                                      <span style={{ fontSize: 10, color: "#6B7280" }}>
                                        Protégé le {new Date(s.datdecr).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Footer: réf. acte + lien */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 5, gap: 6 }}>
                                  {s.ref_acte && (
                                    <span style={{ fontSize: 10, color: "#9CA3AF" }}>Réf. {s.ref_acte}</span>
                                  )}
                                  {s.urlacte && (
                                    <a href={s.urlacte} target="_blank" rel="noopener noreferrer"
                                      style={{ fontSize: 10, color: g.color, fontWeight: 600, textDecoration: "underline", marginLeft: "auto" }}>
                                      Voir l'acte →
                                    </a>
                                  )}
                                </div>

                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* La synthèse citoyenne « en clair » ne vit plus dans le corps
                    principal : elle est désormais accessible via le panneau
                    « Que puis-je faire ici ? » ci-dessous. */}

                {/* Que puis-je faire ici ? — panneau de synthèse citoyenne */}
                {(() => {
                  // La synthèse citoyenne (règles PLU + risques + servitudes, déjà
                  // filtrée et mise « en clair » côté serveur) est la matière du panneau.
                  // On n'affiche le bouton que s'il y a au moins un point citoyen à montrer.
                  const citizenThemes = analysis.synthesis?.themes.filter(t => t.citizen.points.length > 0) ?? [];
                  if (citizenThemes.length === 0) {
                    return analysis.rules.length === 0 ? (
                      <div style={{ border: "1px dashed #E5E7EB", borderRadius: 10, padding: "16px", textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>
                        Aucune règle enregistrée dans la base HEUREKIA pour cette zone.
                      </div>
                    ) : null;
                  }
                  const pointCount = citizenThemes.reduce((n, t) => n + t.citizen.points.length, 0);
                  return (
                    <>
                      <button onClick={() => setRulesOpen(true)}
                        style={{ width: "100%", textAlign: "left", border: "1px solid #C7D2FE", borderRadius: 14, padding: "16px 18px", background: "linear-gradient(180deg,#F5F7FF,#EEF2FF)", cursor: "pointer", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 2px 6px rgba(79,70,229,0.12)" }}>
                        <span style={{ fontSize: 28, flexShrink: 0 }}>📖</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 15, fontWeight: 800, color: "#1E1B4B" }}>Que puis-je faire ici ?</span>
                          <span style={{ display: "block", fontSize: 12.5, color: "#4F46E5", marginTop: 2 }}>Voir les {pointCount} règle{pointCount > 1 ? "s" : ""} d'urbanisme, en clair</span>
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "white", background: "#4F46E5", borderRadius: 999, padding: "8px 16px", flexShrink: 0 }}>Voir →</span>
                      </button>

                      {rulesOpen && analysis.synthesis && (
                        <div onClick={() => setRulesOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.35)", display: "flex", alignItems: "stretch", justifyContent: "flex-start", padding: 0, zIndex: 1100 }}>
                          <div onClick={e => e.stopPropagation()} style={{ background: "white", width: "min(460px, 92vw)", height: "100vh", overflow: "auto", boxShadow: "8px 0 40px rgba(0,0,0,0.25)" }}>
                            <div style={{ padding: "16px 18px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "white", zIndex: 1 }}>
                              <div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Que puis-je faire ici ?</div>
                                <div style={{ fontSize: 12, color: "#6B7280" }}>{analysis.plu_zone?.zone_label ?? analysis.parcel?.commune ?? "Votre parcelle"}</div>
                              </div>
                              <button onClick={() => setRulesOpen(false)} style={{ border: "none", background: "#F1F5F9", borderRadius: 10, width: 34, height: 34, cursor: "pointer", fontSize: 16 }}>✕</button>
                            </div>
                            <div style={{ padding: "14px" }}>
                              <ParcelSynthese audience="citizen" synthesis={analysis.synthesis} />
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* CTA */}
                <button
                  onClick={handleDeposer}
                  disabled={authLoading}
                  style={{ display: "block", width: "100%", background: authLoading ? "#818CF8" : "#4F46E5", color: "white", textAlign: "center", padding: "11px", borderRadius: 10, fontWeight: 700, fontSize: 14, border: "none", cursor: authLoading ? "not-allowed" : "pointer", marginTop: 4, opacity: authLoading ? 0.7 : 1 }}
                >
                  {authLoading ? "Chargement…" : "Déposer une demande d'urbanisme →"}
                </button>
              </div>
            )}

            {/* Empty state */}
            {!loading && !analysis && !error && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", color: "#9CA3AF", textAlign: "center" }}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}>
                  <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#6B7280", margin: "0 0 6px" }}>Entrez une adresse ci-dessus</p>
                <p style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                  ou activez <strong>Cliquer sur la carte</strong><br />
                  pour analyser un point directement
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Map panel ── */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <MapLeaflet
            dossiers={[]}
            height="100%"
            baseLayer={baseLayer}
            parcelLayer={true}
            pluZoneLayer={false}
            clickMode={clickMode}
            onMapClick={handleMapClick}
            highlightGeometry={parcelGeometry}
            positionMarker={geoPosition}
            defaultCenter={mapCenter}
            defaultZoom={mapZoom}
          />
          {clickMode && (
            <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(79,70,229,0.92)", color: "white", borderRadius: 20, padding: "7px 18px", fontSize: 12, fontWeight: 600, pointerEvents: "none", whiteSpace: "nowrap" }}>
              Cliquez sur la parcelle à analyser
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
