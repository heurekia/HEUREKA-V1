import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { DotsIcon, StatusBadge } from "./ui";
import { fmtDate, STATUS_LABEL, TYPE_LABEL, type ApiDossier, type DossierInfo } from "./shared";

// Écran "Dossiers" : liste filtrable/paginée des dossiers de la commune.

export function DossiersScreen({ commune, onDossierClick }: { commune: string; onDossierClick: (d: DossierInfo) => void }) {
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
  // Bounding box du bouton « ⋮ » cliqué : le menu se positionne en fixed par
  // rapport à elle (cf. rendu) pour échapper à l'overflow:hidden de la carte.
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
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
    // Tant que l'OCR/IA tourne sur une pièce, on grise la ligne et on bloque
    // l'ouverture — l'instructeur sera notifié quand tout sera prêt.
    ocrProcessing: !!d.ocr_processing,
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
              <tr key={r.id} style={{
                borderBottom: "1px solid #F1F5F9",
                cursor: r.ocrProcessing ? "not-allowed" : "pointer",
                background: r.ocrProcessing ? "#F8FAFC" : "white",
                opacity: r.ocrProcessing ? 0.75 : 1,
              }}
                onClick={() => {
                  if (r.ocrProcessing) return;
                  onDossierClick({ id: r.id, numero: r.numero, type: r.type, petitionnaire: r.pet, adresse: r.addr, status: r.statusRaw, echeance: r.ech, date_depot: r.dateDepot });
                }}
                onMouseEnter={e => { if (!r.ocrProcessing) e.currentTarget.style.background = "#F8FAFC"; }}
                onMouseLeave={e => { if (!r.ocrProcessing) e.currentTarget.style.background = "white"; }}
                title={r.ocrProcessing ? "Analyse OCR/IA des pièces en cours — le dossier sera ouvert dès qu'il sera prêt (notification dans la cloche)." : undefined}>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: r.ocrProcessing ? "#94A3B8" : "#4F46E5" }}>{r.numero}</td>
                {visibleCols.has("petitionnaire") && <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.pet}</td>}
                {visibleCols.has("adresse") && <td style={{ padding: "12px 16px", fontSize: 13, color: "#64748b", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.addr}</td>}
                {visibleCols.has("type") && <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151" }}>{r.type}</td>}
                {visibleCols.has("statut") && <td style={{ padding: "12px 16px" }}>
                  {r.ocrProcessing ? (
                    <span style={{ background: "#F0F9FF", color: "#075985", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#38BDF8", display: "inline-block" }} />
                      Chargement en cours…
                    </span>
                  ) : (
                    <StatusBadge status={r.statusRaw} />
                  )}
                </td>}
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
                    onClick={e => {
                      e.stopPropagation();
                      if (menuOpenId === r.id) { setMenuOpenId(null); setMenuAnchor(null); }
                      else { setMenuAnchor(e.currentTarget.getBoundingClientRect()); setMenuOpenId(r.id); }
                    }}
                    aria-label="Actions du dossier"
                  >
                    <DotsIcon />
                  </button>
                  {menuOpenId === r.id && menuAnchor && (() => {
                    // Positionnement en fixed (relatif au viewport) pour ne pas être
                    // rogné par l'overflow:hidden de la carte. Ancré sous le bouton,
                    // aligné à droite, avec bascule vers le haut s'il manque de place.
                    const MENU_W = 224;
                    const itemCount = 1 + (isSupervisor && r.instructeur ? 1 : 0) + (isSupervisor ? 1 : 0);
                    const estH = itemCount * 36 + (isSupervisor ? 9 : 0) + 8;
                    const left = Math.max(8, Math.min(menuAnchor.right - MENU_W, window.innerWidth - MENU_W - 8));
                    const openUp = menuAnchor.bottom + estH + 8 > window.innerHeight;
                    const top = openUp ? Math.max(8, menuAnchor.top - estH - 4) : menuAnchor.bottom + 4;
                    return (
                    <>
                      <div
                        onClick={e => { e.stopPropagation(); setMenuOpenId(null); setMenuAnchor(null); }}
                        style={{ position: "fixed", inset: 0, zIndex: 98 }}
                      />
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{ position: "fixed", top, left, width: MENU_W, background: "white", border: "1px solid #E2E8F0", borderRadius: 8, padding: 4, zIndex: 99, boxShadow: "0 8px 24px rgba(0,0,0,0.10)" }}
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
                        {/* [TEMP_DELETE_DOSSIER] Bouton de suppression définitive — TEMPORAIRE,
                            le temps de la base de test. À retirer avant la prod réelle
                            (rechercher "TEMP_DELETE_DOSSIER" back + front). */}
                        {isSupervisor && (
                          <>
                            <div style={{ height: 1, background: "#F1F5F9", margin: "4px 0" }} />
                            <button
                              disabled={rowActionBusy}
                              onClick={async () => {
                                if (!confirm(`Supprimer définitivement le dossier ${r.numero} ?\n\nCette action est irréversible : pièces, courriers, décisions et historique seront effacés.`)) return;
                                setRowActionBusy(true);
                                try {
                                  await api.delete(`/mairie/dossiers/${r.id}`);
                                  setRefreshKey(k => k + 1);
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : "Suppression impossible");
                                } finally {
                                  setRowActionBusy(false);
                                  setMenuOpenId(null);
                                }
                              }}
                              style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: "8px 10px", fontSize: 13, color: "#B91C1C", cursor: rowActionBusy ? "wait" : "pointer", borderRadius: 6, opacity: rowActionBusy ? 0.6 : 1 }}
                              onMouseEnter={e => (e.currentTarget.style.background = "#FEF2F2")}
                              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                            >
                              Supprimer le dossier
                            </button>
                          </>
                        )}
                      </div>
                    </>
                    );
                  })()}
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
