import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { StatusBadge } from "./ui";

// Écran "Statistiques" : KPIs d'instruction, volumes par mois/type, délais et
// services consultés. Types, libellés, couleurs et sous-composant BarChart
// locaux. Extrait tel quel de MairieApp.tsx.

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

export function StatistiquesScreen({ commune }: { commune: string }) {
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
