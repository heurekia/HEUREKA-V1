import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MapLeaflet } from "../../components/MapLeaflet";
import { api } from "../../lib/api";
import type { BaseLayer } from "../../components/MapLeaflet";

// ── Types ────────────────────────────────────────────────────────────────────

type ParcelAnalysis = {
  query: string;
  address?: { label: string; lat: number; lng: number; city: string; postcode: string; citycode: string; score?: number };
  parcel?: { parcelle_id: string; section: string; numero: string; surface_m2: number; commune: string; code_insee: string; geometry?: unknown };
  plu_zone?: { zone_code: string; zone_label: string; zone_type: string; plu_nom?: string; plu_etat?: string };
  risks?: { flood_risk: string; seismic_zone: string; clay_risk?: string; landslide_risk?: string; radon_level?: string };
  db_zone?: { id: string; code: string; label: string | null; type: string | null } | null;
  rules: Array<{ id: string; topic: string; rule_text: string; value_min: number | null; value_max: number | null; unit: string | null; summary: string | null; article_number: number | null; conditions: string | null }>;
  buildability: {
    maxFootprintM2: number; remainingFootprintM2: number; maxHeightM: number | null;
    minSetbackFromRoadM: number | null; minSetbackFromBoundariesM: number | null;
    estimatedFloors: number | null; greenSpaceRatio: number | null;
    greenSpaceRequiredM2: number | null; confidence: number; resultSummary: string;
  } | null;
  available_zones?: Array<{ zone_code: string; zone_label: string; zone_type: string }>;
  prescriptions?: Array<{ libelle: string; typepsc: string; txtpsc?: string }>;
  servitudes?: Array<{ categorie: string; libelle?: string }>;
  municipality?: { is_rnu: boolean; libelle?: string } | null;
  data_sources: string[];
  warnings: string[];
};

type BanSuggestion = { label: string; lat: number; lng: number; citycode: string };

// ── Constants ────────────────────────────────────────────────────────────────

const TOPIC_LABEL: Record<string, string> = {
  recul_voie: "Recul voirie", recul_limite: "Recul limites", emprise_sol: "Emprise au sol",
  hauteur: "Hauteur max.", stationnement: "Stationnement", espaces_verts: "Espaces verts",
  terrain_min: "Terrain minimum",
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
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [suggestions, setSuggestions] = useState<BanSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [analysis, setAnalysis] = useState<ParcelAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clickMode, setClickMode] = useState(false);
  const [pluZones, setPluZones] = useState(true);
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("ign-ortho");
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

  // Auto-run when arriving from Accueil with ?q= param
  useEffect(() => {
    const q = searchParams.get("q");
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "white", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* ── Header ── */}
      <header style={{ height: 52, borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", padding: "0 20px", gap: 16, flexShrink: 0, background: "white", zIndex: 10 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}>
          <div style={{ width: 28, height: 28, background: "#4F46E5", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "white", fontWeight: 800, fontSize: 11 }}>H</span>
          </div>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#000020" }}>HEUREKA</span>
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

        <button
          onClick={() => setPluZones(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600,
            border: "1.5px solid", cursor: "pointer", transition: "all 0.12s",
            borderColor: pluZones ? "#4F46E5" : "#E5E7EB",
            background: pluZones ? "#EEF2FF" : "white",
            color: pluZones ? "#4F46E5" : "#6B7280",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
          </svg>
          Zones PLU
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
                  {/* Data sources */}
                  {analysis.data_sources.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4, marginTop: 8 }}>
                      {analysis.data_sources.map(s => (
                        <span key={s} style={{ fontSize: 10, fontWeight: 600, color: "#4F46E5", background: "#EEF2FF", borderRadius: 20, padding: "2px 8px" }}>{s}</span>
                      ))}
                    </div>
                  )}
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
                        ["Emprise restante", analysis.buildability.remainingFootprintM2 > 0 ? `${Math.round(analysis.buildability.remainingFootprintM2)} m²` : "—"],
                        ["Hauteur maximale", analysis.buildability.maxHeightM ? `${analysis.buildability.maxHeightM} m` : "—"],
                        ["Étages estimés", analysis.buildability.estimatedFloors ? `~${analysis.buildability.estimatedFloors}` : "—"],
                        ["Espaces verts requis", analysis.buildability.greenSpaceRequiredM2 ? `${Math.round(analysis.buildability.greenSpaceRequiredM2)} m²` : "—"],
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
                        <span>🌍 Sismique</span><span>Zone {analysis.risks.seismic_zone}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Prescriptions / SUP */}
                {((analysis.prescriptions?.length ?? 0) > 0 || (analysis.servitudes?.length ?? 0) > 0) && (
                  <div style={{ border: "1px solid #FDE68A", borderRadius: 10, padding: "12px 14px", background: "#FFFBEB" }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#92400E", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px" }}>Prescriptions & servitudes</p>
                    {analysis.prescriptions?.map((p, i) => (
                      <p key={i} style={{ fontSize: 12, color: "#92400E", margin: i > 0 ? "4px 0 0" : 0 }}>• {p.libelle || p.typepsc}</p>
                    ))}
                    {analysis.servitudes?.map((s, i) => (
                      <p key={i} style={{ fontSize: 12, color: "#92400E", margin: "4px 0 0" }}>• {s.categorie}{s.libelle ? ` — ${s.libelle}` : ""}</p>
                    ))}
                  </div>
                )}

                {/* Regulatory rules */}
                {analysis.rules.length > 0 ? (
                  <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid #F3F4F6", background: "#F9FAFB" }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                        Règles applicables ({analysis.rules.length})
                      </p>
                    </div>
                    {analysis.rules.map((rule, i) => (
                      <div key={rule.id} style={{ padding: "10px 14px", borderBottom: i < analysis.rules.length - 1 ? "1px solid #F9FAFB" : "none", display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: "#111827", margin: "0 0 2px" }}>{TOPIC_LABEL[rule.topic] ?? rule.topic}</p>
                          <p style={{ fontSize: 11, color: "#6B7280", margin: 0 }}>{rule.summary ?? rule.rule_text.slice(0, 100)}</p>
                          {rule.conditions && <p style={{ fontSize: 10, color: "#9CA3AF", margin: "2px 0 0" }}>↳ {rule.conditions}</p>}
                        </div>
                        {(rule.value_max != null || rule.value_min != null) && (
                          <div style={{ flexShrink: 0, background: "#EEF2FF", borderRadius: 6, padding: "4px 8px", textAlign: "center" }}>
                            <p style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5", margin: 0 }}>
                              {rule.value_max != null ? `≤${rule.value_max}` : `≥${rule.value_min}`}
                            </p>
                            <p style={{ fontSize: 10, color: "#818CF8", margin: 0 }}>{rule.unit ?? ""}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : analysis && !loading && (
                  <div style={{ border: "1px dashed #E5E7EB", borderRadius: 10, padding: "16px", textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>
                    Aucune règle enregistrée dans la base HEUREKA pour cette zone.
                  </div>
                )}

                {/* CTA */}
                <Link to="/register" style={{ display: "block", background: "#4F46E5", color: "white", textAlign: "center", padding: "11px", borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: "none", marginTop: 4 }}>
                  Déposer une demande d'urbanisme →
                </Link>
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
            pluZoneLayer={pluZones}
            clickMode={clickMode}
            onMapClick={handleMapClick}
            highlightGeometry={parcelGeometry}
            defaultCenter={[46.6, 2.3]}
            defaultZoom={6}
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
