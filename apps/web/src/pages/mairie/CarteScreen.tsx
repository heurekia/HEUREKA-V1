import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { MapLeaflet, type BaseLayer } from "../../components/MapLeaflet";
import { COMMUNE_INSEE } from "./shared";

// Écran "Carte" : sélection de commune, fond cartographique, zones PLU.

type CarteRegRule = { id: string; article_number: number | null; article_title: string | null; topic: string; rule_text: string; summary: string | null; validation_status: string };
type CarteRegZone = { id: string; zone_code: string; zone_label: string | null; rules: CarteRegRule[]; stats: { total: number } };

export function CarteScreen({ commune, setCommune, communeInseeMap = COMMUNE_INSEE }: { commune: string; setCommune: (c: string) => void; communeInseeMap?: Record<string, string> }) {
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


// ── Statistiques ─────────────────────────────────────────────────────────────

