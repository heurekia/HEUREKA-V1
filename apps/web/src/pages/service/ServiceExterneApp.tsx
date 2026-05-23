import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { Avatar } from "../../components/ui/avatar";
import { LogOut, LayoutDashboard, FolderOpen, MessageSquare, FileText, ChevronRight, Paperclip, Send, Printer } from "lucide-react";

// ─── Shared constants ─────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  brouillon: "Brouillon", soumis: "Déposé", pre_instruction: "Pré-instruction",
  incomplet: "Incomplet", en_instruction: "En instruction",
  decision_en_cours: "Décision en cours", accepte: "Accepté",
  refuse: "Refusé", accord_prescription: "Accord avec prescriptions",
};
const STATUS_COLOR: Record<string, { color: string; bg: string }> = {
  soumis: { color: "#4F46E5", bg: "#EEF2FF" },
  pre_instruction: { color: "#0284C7", bg: "#E0F2FE" },
  incomplet: { color: "#EF4444", bg: "#FEF2F2" },
  en_instruction: { color: "#F97316", bg: "#FFF7ED" },
  decision_en_cours: { color: "#B45309", bg: "#FEF3C7" },
  accepte: { color: "#16A34A", bg: "#DCFCE7" },
  refuse: { color: "#DC2626", bg: "#FEE2E2" },
  accord_prescription: { color: "#7C3AED", bg: "#EDE9FE" },
};
const TYPE_LABEL: Record<string, string> = {
  permis_de_construire: "Permis de construire", declaration_prealable: "Déclaration préalable",
  permis_amenager: "Permis d'aménager", permis_demolir: "Permis de démolir",
  permis_lotir: "Permis de lotir", certificat_urbanisme: "Certificat d'urbanisme",
};
const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";
const fmtDateTime = (d: string | null | undefined) => d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ServiceInfo {
  service: { id: string; name: string; type: string; email: string | null; telephone: string | null };
  communesCount: number;
  communes: string[];
}
interface DossierRow {
  id: string; numero: string; type: string; status: string;
  adresse: string | null; commune: string | null; description: string | null;
  date_depot: string | null; date_limite_instruction: string | null;
  demandeur: string;
}
interface DossierDetail extends DossierRow {
  code_postal: string | null; parcelle: string | null; surface_plancher: string | null;
  demandeur_email: string | null;
  pieces: Array<{ id: string; nom: string; url: string; type: string; taille: number }>;
}
interface Message {
  id: string; from_user_id: string; from_role: string; content: string; created_at: string;
}

// ─── Letter templates ──────────────────────────────────────────────────────────
const LETTER_TEMPLATES = [
  {
    id: "favorable",
    label: "Avis favorable",
    color: "#16A34A", bg: "#DCFCE7",
    generate: (d: DossierDetail, service: ServiceInfo["service"], agent: { prenom: string; nom: string }) => `
À ${d.commune}, le ${new Date().toLocaleDateString("fr-FR")}

${service.name}
${service.email ?? ""}

Objet : Avis sur ${TYPE_LABEL[d.type] ?? d.type} n°${d.numero}
Adresse des travaux : ${d.adresse ?? "—"}, ${d.commune ?? "—"}

Madame, Monsieur,

J'ai l'honneur de vous informer que le ${service.name} émet un **avis favorable** concernant le dossier ${d.numero} portant sur ${(TYPE_LABEL[d.type] ?? d.type).toLowerCase()} déposé par ${d.demandeur} pour les travaux situés ${d.adresse ?? "—"}.

Cet avis ne préjuge pas des décisions qui pourraient être prises par l'autorité compétente au titre d'autres réglementations.

Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

${agent.prenom} ${agent.nom}
${service.name}
    `.trim(),
  },
  {
    id: "favorable_reserves",
    label: "Avis favorable avec réserves",
    color: "#B45309", bg: "#FEF3C7",
    generate: (d: DossierDetail, service: ServiceInfo["service"], agent: { prenom: string; nom: string }) => `
À ${d.commune}, le ${new Date().toLocaleDateString("fr-FR")}

${service.name}

Objet : Avis sur ${TYPE_LABEL[d.type] ?? d.type} n°${d.numero}

Madame, Monsieur,

Le ${service.name} émet un **avis favorable avec réserves** sur le dossier ${d.numero} de ${d.demandeur}.

**Réserves :**
[À compléter]

Ces réserves devront être levées avant le commencement des travaux.

Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

${agent.prenom} ${agent.nom}
${service.name}
    `.trim(),
  },
  {
    id: "defavorable",
    label: "Avis défavorable",
    color: "#DC2626", bg: "#FEE2E2",
    generate: (d: DossierDetail, service: ServiceInfo["service"], agent: { prenom: string; nom: string }) => `
À ${d.commune}, le ${new Date().toLocaleDateString("fr-FR")}

${service.name}

Objet : Avis défavorable — ${TYPE_LABEL[d.type] ?? d.type} n°${d.numero}

Madame, Monsieur,

Après examen du dossier ${d.numero} déposé par ${d.demandeur}, le ${service.name} émet un **avis défavorable** pour les motifs suivants :

[Motifs à compléter]

Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

${agent.prenom} ${agent.nom}
${service.name}
    `.trim(),
  },
  {
    id: "pieces_complementaires",
    label: "Demande de pièces complémentaires",
    color: "#0284C7", bg: "#E0F2FE",
    generate: (d: DossierDetail, service: ServiceInfo["service"], agent: { prenom: string; nom: string }) => `
À ${d.commune}, le ${new Date().toLocaleDateString("fr-FR")}

${service.name}

Objet : Demande de pièces complémentaires — Dossier n°${d.numero}

Madame, Monsieur,

Dans le cadre de l'instruction du dossier ${d.numero} (${TYPE_LABEL[d.type] ?? d.type}) déposé par ${d.demandeur}, le ${service.name} sollicite la transmission des pièces complémentaires suivantes :

1. [Pièce 1]
2. [Pièce 2]

Ces éléments sont nécessaires à l'émission de notre avis. Leur transmission devra intervenir dans un délai de [X] jours à compter de la réception du présent courrier.

Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

${agent.prenom} ${agent.nom}
${service.name}
    `.trim(),
  },
];

// ─── Sidebar ───────────────────────────────────────────────────────────────────
const NAV = [
  { path: "/service", exact: true, icon: LayoutDashboard, label: "Tableau de bord" },
  { path: "/service/dossiers", icon: FolderOpen, label: "Dossiers" },
  { path: "/service/courriers", icon: FileText, label: "Courriers types" },
];

function Sidebar({ serviceInfo }: { serviceInfo: ServiceInfo | null }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <aside style={{ width: 220, flexShrink: 0, background: "#000020", height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: "#4F46E5", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ color: "white", fontWeight: 800, fontSize: 14 }}>H</span>
          </div>
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>HEUREKA</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}>Services annexes</div>
          </div>
        </div>
      </div>

      {serviceInfo && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}>
          <div style={{ color: "white", fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{serviceInfo.service.name}</div>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{serviceInfo.communesCount} commune{serviceInfo.communesCount > 1 ? "s" : ""} couverte{serviceInfo.communesCount > 1 ? "s" : ""}</div>
        </div>
      )}

      <nav style={{ flex: 1, padding: "10px 10px" }}>
        {NAV.map(item => {
          const Icon = item.icon;
          const active = item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);
          return (
            <button key={item.path} onClick={() => navigate(item.path)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2, background: active ? "#4F46E5" : "transparent", color: active ? "white" : "rgba(255,255,255,0.65)", fontSize: 13, fontWeight: active ? 600 : 400, textAlign: "left", transition: "all 0.15s" }}>
              <Icon size={15} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar fallback={user ? `${user.prenom} ${user.nom}` : "U"} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "white", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.prenom} {user?.nom}</div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</div>
        </div>
        <button onClick={() => void logout()} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", padding: 4 }} title="Déconnexion">
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ dossiers, serviceInfo }: { dossiers: DossierRow[]; serviceInfo: ServiceInfo | null }) {
  const navigate = useNavigate();
  const enInstruction = dossiers.filter(d => ["soumis", "pre_instruction", "en_instruction", "decision_en_cours"].includes(d.status));
  const recents = [...dossiers].sort((a, b) => new Date(b.date_depot ?? 0).getTime() - new Date(a.date_depot ?? 0).getTime()).slice(0, 5);

  return (
    <div style={{ padding: 32 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>Tableau de bord</h1>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 28 }}>
        {serviceInfo?.service.name} — {serviceInfo?.communesCount ?? 0} commune{(serviceInfo?.communesCount ?? 0) > 1 ? "s" : ""} couverte{(serviceInfo?.communesCount ?? 0) > 1 ? "s" : ""}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
        {[
          { label: "Dossiers en cours", value: enInstruction.length, color: "#4F46E5", bg: "#EEF2FF" },
          { label: "Total dossiers", value: dossiers.length, color: "#0284C7", bg: "#E0F2FE" },
          { label: "Communes couvertes", value: serviceInfo?.communesCount ?? 0, color: "#16A34A", bg: "#DCFCE7" },
        ].map(card => (
          <div key={card.label} style={{ background: card.bg, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 13, color: card.color, opacity: 0.8, marginTop: 4 }}>{card.label}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #F1F5F9", fontWeight: 700, fontSize: 14, color: "#0F172A" }}>
          Dossiers récents
        </div>
        {recents.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>Aucun dossier dans votre périmètre</div>
        ) : recents.map((d, i) => {
          const sc = STATUS_COLOR[d.status] ?? { color: "#6B7280", bg: "#F3F4F6" };
          return (
            <div key={d.id} onClick={() => navigate(`/service/dossiers/${d.id}`)}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: i < recents.length - 1 ? "1px solid #F8FAFC" : "none", cursor: "pointer", transition: "background 0.1s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{d.numero}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{TYPE_LABEL[d.type] ?? d.type} — {d.commune}</div>
              </div>
              <span style={{ padding: "3px 10px", borderRadius: 20, background: sc.bg, color: sc.color, fontSize: 11, fontWeight: 700 }}>{STATUS_LABEL[d.status] ?? d.status}</span>
              <ChevronRight size={14} color="#CBD5E1" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dossiers list ──────────────────────────────────────────────────────────────
function DossiersList({ dossiers, loading }: { dossiers: DossierRow[]; loading: boolean }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const filtered = dossiers.filter(d =>
    !search || d.numero.toLowerCase().includes(search.toLowerCase()) ||
    d.demandeur.toLowerCase().includes(search.toLowerCase()) ||
    (d.commune ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ padding: 32 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>Dossiers</h1>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 20 }}>Dossiers de votre périmètre géographique</p>

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Rechercher un dossier, une adresse, un pétitionnaire…"
        style={{ width: "100%", padding: "9px 14px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, marginBottom: 16, outline: "none", boxSizing: "border-box" }} />

      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>Aucun dossier trouvé</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["N° Dossier", "Pétitionnaire", "Type", "Commune", "Dépôt", "Statut", ""].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => {
                const sc = STATUS_COLOR[d.status] ?? { color: "#6B7280", bg: "#F3F4F6" };
                return (
                  <tr key={d.id} onClick={() => navigate(`/service/dossiers/${d.id}`)}
                    style={{ borderBottom: i < filtered.length - 1 ? "1px solid #F8FAFC" : "none", cursor: "pointer", transition: "background 0.1s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ padding: "11px 16px", fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{d.numero}</td>
                    <td style={{ padding: "11px 16px", fontSize: 13, color: "#374151" }}>{d.demandeur}</td>
                    <td style={{ padding: "11px 16px", fontSize: 12, color: "#64748b" }}>{TYPE_LABEL[d.type] ?? d.type}</td>
                    <td style={{ padding: "11px 16px", fontSize: 13, color: "#374151" }}>{d.commune}</td>
                    <td style={{ padding: "11px 16px", fontSize: 12, color: "#94a3b8" }}>{fmtDate(d.date_depot)}</td>
                    <td style={{ padding: "11px 16px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 20, background: sc.bg, color: sc.color, fontSize: 11, fontWeight: 700 }}>{STATUS_LABEL[d.status] ?? d.status}</span>
                    </td>
                    <td style={{ padding: "11px 16px" }}><ChevronRight size={14} color="#CBD5E1" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Dossier detail ─────────────────────────────────────────────────────────────
function DossierDetail({ serviceInfo }: { serviceInfo: ServiceInfo | null }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dossier, setDossier] = useState<DossierDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgContent, setMsgContent] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"infos" | "messages" | "courrier">("infos");
  const [selectedTemplate, setSelectedTemplate] = useState(LETTER_TEMPLATES[0]!);
  const [letterBody, setLetterBody] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    const [d, msgs] = await Promise.all([
      api.get<DossierDetail>(`/service/dossiers/${id}`),
      api.get<Message[]>(`/service/dossiers/${id}/messages`),
    ]);
    setDossier(d);
    setMessages(msgs);
    setLetterBody(selectedTemplate.generate(d, serviceInfo?.service ?? { id: "", name: "Service", type: "", email: null, telephone: null }, { prenom: user?.prenom ?? "", nom: user?.nom ?? "" }));
  }, [id]);

  useEffect(() => { load().catch(() => navigate("/service/dossiers")); }, [load]);

  useEffect(() => {
    if (dossier && serviceInfo) {
      setLetterBody(selectedTemplate.generate(dossier, serviceInfo.service, { prenom: user?.prenom ?? "", nom: user?.nom ?? "" }));
    }
  }, [selectedTemplate, dossier, serviceInfo]);

  const sendMessage = async () => {
    if (!msgContent.trim() || !id) return;
    setSending(true);
    try {
      const msg = await api.post<Message>(`/service/dossiers/${id}/messages`, { content: msgContent.trim(), type: "consultation" });
      setMessages(prev => [...prev, msg]);
      setMsgContent("");
    } finally {
      setSending(false);
    }
  };

  if (!dossier) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>;

  const sc = STATUS_COLOR[dossier.status] ?? { color: "#6B7280", bg: "#F3F4F6" };

  return (
    <div style={{ padding: 32 }}>
      <button onClick={() => navigate("/service/dossiers")} style={{ border: "none", background: "none", color: "#64748b", fontSize: 13, cursor: "pointer", padding: "0 0 16px", display: "flex", alignItems: "center", gap: 6 }}>
        ← Retour aux dossiers
      </button>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>{dossier.numero}</h1>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: sc.bg, color: sc.color, fontSize: 12, fontWeight: 700 }}>{STATUS_LABEL[dossier.status] ?? dossier.status}</span>
          </div>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>{TYPE_LABEL[dossier.type] ?? dossier.type} — {dossier.adresse}, {dossier.commune}</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E2E8F0", marginBottom: 24 }}>
        {([["infos", "Informations"], ["messages", `Messagerie (${messages.length})`], ["courrier", "Générer un courrier"]] as [typeof tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ border: "none", background: "none", padding: "8px 16px", fontSize: 13, fontWeight: tab === key ? 600 : 400, color: tab === key ? "#4F46E5" : "#64748b", borderBottom: tab === key ? "2px solid #4F46E5" : "2px solid transparent", marginBottom: -2, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "infos" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Informations du dossier</h3>
            {[
              ["Pétitionnaire", dossier.demandeur],
              ["Email", dossier.demandeur_email ?? "—"],
              ["Adresse des travaux", dossier.adresse ?? "—"],
              ["Commune", `${dossier.commune ?? "—"} ${dossier.code_postal ?? ""}`],
              ["Parcelle", dossier.parcelle ?? "—"],
              ["Surface de plancher", dossier.surface_plancher ? `${dossier.surface_plancher} m²` : "—"],
              ["Date de dépôt", fmtDate(dossier.date_depot)],
              ["Date limite instruction", fmtDate(dossier.date_limite_instruction)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "#94a3b8", width: 160, flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>

          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <Paperclip size={14} color="#64748b" />
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", margin: 0 }}>Pièces jointes ({dossier.pieces.length})</h3>
            </div>
            {dossier.pieces.length === 0 ? (
              <p style={{ fontSize: 13, color: "#94a3b8" }}>Aucune pièce jointe</p>
            ) : dossier.pieces.map(p => (
              <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #F8FAFC", textDecoration: "none", color: "#4F46E5", fontSize: 13 }}>
                <Paperclip size={12} />
                <span style={{ flex: 1 }}>{p.nom}</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{(p.taille / 1024).toFixed(0)} Ko</span>
              </a>
            ))}

            {dossier.description && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Description</div>
                <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, margin: 0 }}>{dossier.description}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "messages" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", height: 520 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.length === 0 ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 14 }}>
                <div style={{ textAlign: "center" }}>
                  <MessageSquare size={32} color="#CBD5E1" style={{ marginBottom: 8 }} />
                  <p>Démarrez la consultation en envoyant un message</p>
                </div>
              </div>
            ) : messages.map(msg => {
              const isMe = msg.from_user_id === user?.id;
              const isService = msg.from_role.startsWith("service_externe");
              return (
                <div key={msg.id} style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "70%", background: isMe ? "#4F46E5" : isService ? "#EEF2FF" : "#F1F5F9", color: isMe ? "white" : "#0F172A", borderRadius: 12, padding: "10px 14px", fontSize: 13, lineHeight: 1.5 }}>
                    {!isMe && <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#64748b" }}>{msg.from_role.replace("service_externe:", "")}</div>}
                    <p style={{ margin: 0 }}>{msg.content}</p>
                    <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6, textAlign: "right" }}>{fmtDateTime(msg.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid #F1F5F9", display: "flex", gap: 8 }}>
            <textarea
              value={msgContent}
              onChange={e => setMsgContent(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
              placeholder="Votre message de consultation… (Entrée pour envoyer)"
              style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 12px", fontSize: 13, resize: "none", height: 56, outline: "none", fontFamily: "inherit" }}
            />
            <button onClick={() => void sendMessage()} disabled={!msgContent.trim() || sending}
              style={{ padding: "8px 16px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, cursor: !msgContent.trim() || sending ? "not-allowed" : "pointer", opacity: !msgContent.trim() || sending ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
              <Send size={14} /> Envoyer
            </button>
          </div>
        </div>
      )}

      {tab === "courrier" && (
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {LETTER_TEMPLATES.map(tpl => (
              <button key={tpl.id} onClick={() => setSelectedTemplate(tpl)}
                style={{ padding: "10px 14px", border: `2px solid ${selectedTemplate.id === tpl.id ? tpl.color : "#E2E8F0"}`, borderRadius: 10, background: selectedTemplate.id === tpl.id ? tpl.bg : "white", color: selectedTemplate.id === tpl.id ? tpl.color : "#374151", fontSize: 13, fontWeight: selectedTemplate.id === tpl.id ? 700 : 400, cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                {tpl.label}
              </button>
            ))}
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{selectedTemplate.label}</span>
              <button onClick={() => window.print()}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: "#0F172A", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                <Printer size={13} /> Imprimer / PDF
              </button>
            </div>
            <textarea
              value={letterBody}
              onChange={e => setLetterBody(e.target.value)}
              style={{ flex: 1, border: "none", padding: 24, fontSize: 13, lineHeight: 1.8, fontFamily: "Georgia, serif", resize: "none", outline: "none", minHeight: 480, color: "#1E293B" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Courriers types (catalog) ──────────────────────────────────────────────────
function CourriersCatalog() {
  return (
    <div style={{ padding: 32 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>Courriers types</h1>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 28 }}>Sélectionnez un dossier pour générer et personnaliser un courrier.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {LETTER_TEMPLATES.map(tpl => (
          <div key={tpl.id} style={{ background: tpl.bg, border: `1px solid ${tpl.color}30`, borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: tpl.color, marginBottom: 8 }}>{tpl.label}</div>
            <p style={{ fontSize: 13, color: "#374151", margin: 0, lineHeight: 1.5 }}>
              Disponible dans le détail d'un dossier, onglet <strong>Générer un courrier</strong>.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── App root ──────────────────────────────────────────────────────────────────
export function ServiceExterneApp() {
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [dossiers, setDossiers] = useState<DossierRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<ServiceInfo>("/service/info"),
      api.get<DossierRow[]>("/service/dossiers"),
    ]).then(([info, rows]) => {
      setServiceInfo(info);
      setDossiers(rows);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F0F0F0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{`* { box-sizing: border-box; } @media print { aside { display: none !important; } }`}</style>
      <Sidebar serviceInfo={serviceInfo} />
      <main style={{ flex: 1, overflowY: "auto" }}>
        <Routes>
          <Route path="/" element={<Dashboard dossiers={dossiers} serviceInfo={serviceInfo} />} />
          <Route path="/dossiers" element={<DossiersList dossiers={dossiers} loading={loading} />} />
          <Route path="/dossiers/:id" element={<DossierDetail serviceInfo={serviceInfo} />} />
          <Route path="/courriers" element={<CourriersCatalog />} />
          <Route path="*" element={<Navigate to="/service" replace />} />
        </Routes>
      </main>
    </div>
  );
}
