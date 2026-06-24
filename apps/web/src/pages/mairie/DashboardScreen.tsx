import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { MapLeaflet, type MapDossier } from "../../components/MapLeaflet";
import type { DossierInfo } from "./shared";

// Écran "Tableau de bord" : KPIs, derniers dossiers, mini-carte.

export function DashboardScreen({ navigate, navigateDossiers, commune, inseeCode, onDossierClick }: { navigate: (s: string) => void; navigateDossiers: (filter: string) => void; commune: string; inseeCode?: string; onDossierClick: (d: DossierInfo) => void }) {
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
