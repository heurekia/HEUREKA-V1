import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

// Écran "Calendrier" : vue mensuelle des échéances d'instruction par dossier.
// Autonome (types/sous-composants locaux), extrait de MairieApp.tsx.

export function CalendrierScreen({ commune }: { commune: string }) {
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
