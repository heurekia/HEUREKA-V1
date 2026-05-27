import { useState, useEffect, useCallback, useRef } from "react";
import DOMPurify from "dompurify";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { Avatar } from "../../components/ui/avatar";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { Node as TiptapNode, mergeAttributes, type NodeViewRendererProps } from "@tiptap/core";
import { LogOut, LayoutDashboard, FolderOpen, FileText, Settings, ChevronRight, Paperclip, Send, Printer, Plus, Pencil, Trash2, Bold, Italic, Underline as UnderlineIcon, AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Type, ChevronDown, X, Save, ArrowLeft } from "lucide-react";

// ─── Variable Node (TipTap custom inline node) ─────────────────────────────
const VariableNode = TiptapNode.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { name: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-variable]", getAttrs: (el: HTMLElement) => ({ name: el.dataset.variable ?? null }) }];
  },
  renderHTML({ node, HTMLAttributes }: { node: { attrs: Record<string, unknown> }; HTMLAttributes: Record<string, unknown> }) {
    return ["span", mergeAttributes(HTMLAttributes, {
      "data-variable": node.attrs.name as string,
      style: "display:inline-block;background:#dbeafe;color:#1d4ed8;padding:1px 7px;border-radius:10px;font-size:0.8em;font-family:monospace;user-select:none;white-space:nowrap;",
    }), `{{${node.attrs.name as string}}}`];
  },
  addNodeView() {
    return ({ node }: NodeViewRendererProps) => {
      const dom = document.createElement("span");
      dom.setAttribute("data-variable", node.attrs.name as string);
      dom.setAttribute("contenteditable", "false");
      dom.style.cssText = "display:inline-block;background:#dbeafe;color:#1d4ed8;padding:1px 7px;border-radius:10px;font-size:0.8em;font-family:monospace;cursor:default;user-select:none;white-space:nowrap;";
      dom.textContent = `{{${node.attrs.name as string}}}`;
      return { dom };
    };
  },
});

// ─── Template variable groups ──────────────────────────────────────────────
const TEMPLATE_VARIABLES = [
  { group: "Demandeur", vars: [
    { label: "Nom complet", name: "demandeur_nom" },
    { label: "Prénom", name: "demandeur_prenom" },
    { label: "Email", name: "demandeur_email" },
  ]},
  { group: "Dossier", vars: [
    { label: "Numéro dossier", name: "numero_dossier" },
    { label: "Type de dossier", name: "type_dossier" },
    { label: "Adresse travaux", name: "adresse_travaux" },
    { label: "Commune", name: "commune" },
    { label: "Code postal", name: "code_postal" },
    { label: "Référence parcelle", name: "parcelle" },
    { label: "Surface de plancher", name: "surface_plancher" },
    { label: "Date de dépôt", name: "date_depot" },
    { label: "Date limite instruction", name: "date_limite_instruction" },
  ]},
  { group: "Service & Agent", vars: [
    { label: "Nom du service", name: "nom_service" },
    { label: "Nom de l'agent", name: "nom_agent" },
    { label: "Date du courrier", name: "date_courrier" },
  ]},
];

// ─── Shared constants ──────────────────────────────────────────────────────
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
const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  avis_favorable: { label: "Avis favorable", color: "#16A34A", bg: "#DCFCE7" },
  avis_reserves: { label: "Avis avec réserves", color: "#B45309", bg: "#FEF3C7" },
  avis_defavorable: { label: "Avis défavorable", color: "#DC2626", bg: "#FEE2E2" },
  pieces_complementaires: { label: "Demande de pièces", color: "#0284C7", bg: "#E0F2FE" },
  general: { label: "Général", color: "#6B7280", bg: "#F3F4F6" },
};
const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";
const fmtDateTime = (d: string | null | undefined) => d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// ─── Types ─────────────────────────────────────────────────────────────────
interface ServiceInfo {
  service: {
    id: string; name: string; type: string; email: string | null; telephone: string | null;
    letterhead_logo: string | null; letterhead_title: string | null;
    letterhead_subtitle: string | null; letterhead_address: string | null;
    footer_text: string | null; signature_image: string | null;
  };
  communesCount: number;
  communes: string[];
}
interface DossierRow {
  id: string; numero: string; type: string; status: string;
  adresse: string | null; commune: string | null; description: string | null;
  date_depot: string | null; date_limite_instruction: string | null; demandeur: string;
}
interface DossierDetail extends DossierRow {
  code_postal: string | null; parcelle: string | null; surface_plancher: string | null;
  demandeur_prenom: string | null; demandeur_nom: string | null; demandeur_email: string | null;
  pieces: Array<{ id: string; nom: string; url: string; type: string; taille: number }>;
}
interface Message {
  id: string; from_user_id: string; from_role: string; content: string; created_at: string;
}
interface CourrierTemplate {
  id: string; name: string; category: string; body: string;
  created_at: string; updated_at: string;
}
interface Consultation {
  id: string; dossier_id: string; service_name: string; service_type: string;
  external_service_id: string | null; status: string; favorable: boolean | null;
  avis: string | null; date_envoi: string; date_reponse: string | null;
}

// ─── Variable substitution ─────────────────────────────────────────────────
function substituteVariables(html: string, vars: Record<string, string>): string {
  return html.replace(
    /<span[^>]*data-variable="([^"]+)"[^>]*>[^<]*<\/span>/g,
    (_, name: string) => vars[name] ?? `{{${name}}}`
  );
}

// ─── TipTap editor toolbar ─────────────────────────────────────────────────
function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const [varMenuOpen, setVarMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setVarMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!editor) return null;

  const insertVariable = (name: string) => {
    editor.chain().focus().insertContent({ type: "variable", attrs: { name } }).run();
    setVarMenuOpen(false);
  };

  const btn = (active: boolean, onClick: () => void, icon: React.ReactNode, title: string) => (
    <button type="button" title={title} onClick={onClick}
      style={{ padding: "4px 7px", border: "none", borderRadius: 5, cursor: "pointer", background: active ? "#E0E7FF" : "transparent", color: active ? "#4F46E5" : "#374151", display: "flex", alignItems: "center", transition: "background 0.1s" }}>
      {icon}
    </button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "8px 12px", borderBottom: "1px solid #E2E8F0", flexWrap: "wrap", background: "#F8FAFC" }}>
      {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold size={14} />, "Gras")}
      {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic size={14} />, "Italique")}
      {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon size={14} />, "Souligné")}
      <div style={{ width: 1, height: 18, background: "#E2E8F0", margin: "0 4px" }} />
      {btn(editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <span style={{ fontSize: 11, fontWeight: 700 }}>H1</span>, "Titre 1")}
      {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <span style={{ fontSize: 11, fontWeight: 700 }}>H2</span>, "Titre 2")}
      {btn(editor.isActive("paragraph"), () => editor.chain().focus().setParagraph().run(), <Type size={14} />, "Paragraphe")}
      <div style={{ width: 1, height: 18, background: "#E2E8F0", margin: "0 4px" }} />
      {btn(editor.isActive({ textAlign: "left" }), () => editor.chain().focus().setTextAlign("left").run(), <AlignLeft size={14} />, "Aligner à gauche")}
      {btn(editor.isActive({ textAlign: "center" }), () => editor.chain().focus().setTextAlign("center").run(), <AlignCenter size={14} />, "Centrer")}
      {btn(editor.isActive({ textAlign: "right" }), () => editor.chain().focus().setTextAlign("right").run(), <AlignRight size={14} />, "Aligner à droite")}
      <div style={{ width: 1, height: 18, background: "#E2E8F0", margin: "0 4px" }} />
      {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List size={14} />, "Liste à puces")}
      {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={14} />, "Liste numérotée")}
      <div style={{ width: 1, height: 18, background: "#E2E8F0", margin: "0 4px" }} />
      <div style={{ position: "relative" }} ref={menuRef}>
        <button type="button" onClick={() => setVarMenuOpen(v => !v)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", border: "1px solid #C7D2FE", borderRadius: 6, background: varMenuOpen ? "#EEF2FF" : "white", color: "#4F46E5", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <span>Insérer variable</span>
          <ChevronDown size={12} />
        </button>
        {varMenuOpen && (
          <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, marginTop: 4, background: "white", border: "1px solid #E2E8F0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 220, maxHeight: 340, overflowY: "auto" }}>
            {TEMPLATE_VARIABLES.map(group => (
              <div key={group.group}>
                <div style={{ padding: "8px 12px 4px", fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>{group.group}</div>
                {group.vars.map(v => (
                  <button key={v.name} type="button" onClick={() => insertVariable(v.name)}
                    style={{ width: "100%", padding: "7px 12px", border: "none", background: "none", textAlign: "left", fontSize: 13, color: "#374151", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                    <span>{v.label}</span>
                    <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>{`{{${v.name}}}`}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TipTap editor wrapper ─────────────────────────────────────────────────
function TipTapEditor({ content, onChange, placeholder }: { content: string; onChange: (html: string) => void; placeholder?: string }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: placeholder ?? "Rédigez votre courrier…" }),
      VariableNode,
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "", { emitUpdate: false });
    }
  }, [content, editor]);

  return (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden", background: "white" }}>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} style={{ minHeight: 300 }} />
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────
const NAV = [
  { path: "/service", exact: true, icon: LayoutDashboard, label: "Tableau de bord" },
  { path: "/service/dossiers", icon: FolderOpen, label: "Dossiers" },
  { path: "/service/courriers", icon: FileText, label: "Courriers types" },
  { path: "/service/parametres", icon: Settings, label: "Paramètres" },
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
            <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>HEUREKIA</div>
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
          const active = item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path) && !(item.path === "/service" && location.pathname !== "/service");
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

// ─── Dashboard ─────────────────────────────────────────────────────────────
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
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #F1F5F9", fontWeight: 700, fontSize: 14, color: "#0F172A" }}>Dossiers récents</div>
        {recents.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>Aucun dossier dans votre périmètre</div>
        ) : recents.map((d, i) => {
          const sc = STATUS_COLOR[d.status] ?? { color: "#6B7280", bg: "#F3F4F6" };
          return (
            <div key={d.id} onClick={() => navigate(`/service/dossiers/${d.id}`)}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: i < recents.length - 1 ? "1px solid #F8FAFC" : "none", cursor: "pointer" }}
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

// ─── Dossiers list ──────────────────────────────────────────────────────────
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
        {loading ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>
          : filtered.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>Aucun dossier trouvé</div>
          : (
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
                      style={{ borderBottom: i < filtered.length - 1 ? "1px solid #F8FAFC" : "none", cursor: "pointer" }}
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

// ─── Courrier preview (print-ready) ───────────────────────────────────────
function CourrierPreview({ html, service, agentName }: {
  html: string;
  service: ServiceInfo["service"];
  agentName: string;
}) {
  return (
    <div className="print-page" style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "32px 40px", fontFamily: "Georgia, serif", fontSize: 13, lineHeight: 1.7, color: "#1E293B", maxWidth: 760 }}>
      {/* En-tête */}
      {(service.letterhead_logo || service.letterhead_title) && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24, paddingBottom: 20, borderBottom: "2px solid #1E293B" }}>
          {service.letterhead_logo && (
            <img src={service.letterhead_logo} alt="" style={{ height: 60, width: "auto", objectFit: "contain", flexShrink: 0 }} />
          )}
          <div>
            {service.letterhead_title && <div style={{ fontSize: 16, fontWeight: 700 }}>{service.letterhead_title}</div>}
            {service.letterhead_subtitle && <div style={{ fontSize: 13 }}>{service.letterhead_subtitle}</div>}
            {service.letterhead_address && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, whiteSpace: "pre-line" }}>{service.letterhead_address}</div>}
          </div>
        </div>
      )}

      {/* Corps du courrier */}
      <div
        className="tiptap-preview"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
        style={{ minHeight: 300 }}
      />

      {/* Signature */}
      {(service.signature_image || agentName) && (
        <div style={{ marginTop: 32 }}>
          {service.signature_image && (
            <img src={service.signature_image} alt="Signature" style={{ height: 70, width: "auto", objectFit: "contain", display: "block", marginBottom: 4 }} />
          )}
          {agentName && <div style={{ fontSize: 13, fontWeight: 600 }}>{agentName}</div>}
        </div>
      )}

      {/* Pied de page */}
      {service.footer_text && (
        <div style={{ marginTop: 40, paddingTop: 14, borderTop: "1px solid #CBD5E1", fontSize: 11, color: "#64748b", textAlign: "center", whiteSpace: "pre-line" }}>
          {service.footer_text}
        </div>
      )}
    </div>
  );
}

// ─── Dossier detail ─────────────────────────────────────────────────────────
function DossierDetail({ serviceInfo }: { serviceInfo: ServiceInfo | null }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dossier, setDossier] = useState<DossierDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgContent, setMsgContent] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"infos" | "messages" | "courrier" | "consultation">("infos");
  const [templates, setTemplates] = useState<CourrierTemplate[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<CourrierTemplate | null>(null);
  const [editedBody, setEditedBody] = useState("");
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [avisForm, setAvisForm] = useState<{ favorable: boolean | null; avis: string }>({ favorable: null, avis: "" });
  const [submittingAvis, setSubmittingAvis] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [d, msgs, tpls, consults] = await Promise.all([
      api.get<DossierDetail>(`/service/dossiers/${id}`),
      api.get<Message[]>(`/service/dossiers/${id}/messages`),
      api.get<CourrierTemplate[]>("/service/templates"),
      api.get<Consultation[]>(`/service/dossiers/${id}/consultations`),
    ]);
    setDossier(d);
    setMessages(msgs);
    setTemplates(tpls);
    setConsultations(consults);
    if (tpls.length > 0) {
      const first = tpls[0]!;
      setSelectedTpl(first);
    }
  }, [id]);

  useEffect(() => { load().catch(() => navigate("/service/dossiers")); }, [load]);

  useEffect(() => {
    if (selectedTpl && dossier && serviceInfo && user) {
      const vars: Record<string, string> = {
        demandeur_nom: dossier.demandeur,
        demandeur_prenom: dossier.demandeur_prenom ?? "",
        demandeur_email: dossier.demandeur_email ?? "—",
        numero_dossier: dossier.numero,
        type_dossier: TYPE_LABEL[dossier.type] ?? dossier.type,
        adresse_travaux: dossier.adresse ?? "—",
        commune: dossier.commune ?? "—",
        code_postal: dossier.code_postal ?? "",
        parcelle: dossier.parcelle ?? "—",
        surface_plancher: dossier.surface_plancher ? `${dossier.surface_plancher} m²` : "—",
        date_depot: fmtDate(dossier.date_depot),
        date_limite_instruction: fmtDate(dossier.date_limite_instruction),
        nom_service: serviceInfo.service.name,
        nom_agent: `${user.prenom} ${user.nom}`,
        date_courrier: new Date().toLocaleDateString("fr-FR"),
      };
      setEditedBody(substituteVariables(selectedTpl.body, vars));
    }
  }, [selectedTpl, dossier, serviceInfo, user]);

  const submitAvis = async (consultationId: string) => {
    if (avisForm.favorable === null) return;
    setSubmittingAvis(true);
    try {
      const updated = await api.patch<Consultation>(`/service/dossiers/${id}/consultations/${consultationId}`, {
        favorable: avisForm.favorable,
        avis: avisForm.avis,
      });
      setConsultations(prev => prev.map(c => c.id === consultationId ? updated : c));
    } finally {
      setSubmittingAvis(false);
    }
  };

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
        {([
          ["infos", "Informations"],
          ["messages", `Messagerie (${messages.length})`],
          ["consultation", consultations.length > 0 ? `Consultation (${consultations.length})` : "Consultation"],
          ["courrier", "Générer un courrier"],
        ] as [typeof tab, string][]).map(([key, label]) => {
          const hasPending = key === "consultation" && consultations.some(c => c.status === "en_attente");
          return (
            <button key={key} onClick={() => setTab(key)}
              style={{ border: "none", background: "none", padding: "8px 16px", fontSize: 13, fontWeight: tab === key ? 600 : 400, color: tab === key ? "#4F46E5" : "#64748b", borderBottom: tab === key ? "2px solid #4F46E5" : "2px solid transparent", marginBottom: -2, cursor: "pointer", position: "relative" }}>
              {label}
              {hasPending && <span style={{ display: "inline-block", width: 7, height: 7, background: "#EF4444", borderRadius: "50%", position: "absolute", top: 6, right: 4 }} />}
            </button>
          );
        })}
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
            {dossier.pieces.length === 0 ? <p style={{ fontSize: 13, color: "#94a3b8" }}>Aucune pièce jointe</p>
              : dossier.pieces.map(p => (
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
                  <div style={{ marginBottom: 8 }}><Send size={32} color="#CBD5E1" /></div>
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
            <textarea value={msgContent} onChange={e => setMsgContent(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
              placeholder="Votre message de consultation… (Entrée pour envoyer)"
              style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 12px", fontSize: 13, resize: "none", height: 56, outline: "none", fontFamily: "inherit" }} />
            <button onClick={() => void sendMessage()} disabled={!msgContent.trim() || sending}
              style={{ padding: "8px 16px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, cursor: !msgContent.trim() || sending ? "not-allowed" : "pointer", opacity: !msgContent.trim() || sending ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
              <Send size={14} /> Envoyer
            </button>
          </div>
        </div>
      )}

      {tab === "consultation" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {consultations.length === 0 ? (
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
              Aucune demande de consultation adressée à votre service pour ce dossier.
            </div>
          ) : consultations.map(c => {
            const isPending = c.status === "en_attente";
            const isDone = c.status === "avis_recu";
            return (
              <div key={c.id} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{c.service_name}</span>
                    <span style={{ marginLeft: 12, fontSize: 12, color: "#94a3b8" }}>Saisine du {fmtDate(c.date_envoi)}</span>
                  </div>
                  <span style={{
                    padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: isPending ? "#FFF7ED" : isDone ? "#DCFCE7" : "#F1F5F9",
                    color: isPending ? "#C2410C" : isDone ? "#15803D" : "#64748B",
                  }}>
                    {isPending ? "En attente d'avis" : isDone ? "Avis rendu" : c.status}
                  </span>
                </div>

                {isDone && (
                  <div style={{ background: c.favorable ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${c.favorable ? "#BBF7D0" : "#FECACA"}`, borderRadius: 8, padding: 16, marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: c.favorable ? "#15803D" : "#DC2626", marginBottom: c.avis ? 8 : 0 }}>
                      {c.favorable ? "Avis favorable" : "Avis défavorable"}
                    </div>
                    {c.avis && <p style={{ fontSize: 13, color: "#374151", margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.avis}</p>}
                    {c.date_reponse && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Rendu le {fmtDate(c.date_reponse)}</div>}
                  </div>
                )}

                {isPending && (
                  <div style={{ background: "#F8FAFC", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>Rendre votre avis</div>

                    <div style={{ display: "flex", gap: 10 }}>
                      {[
                        { value: true, label: "Favorable", color: "#15803D", bg: "#DCFCE7", border: "#86EFAC" },
                        { value: false, label: "Défavorable", color: "#DC2626", bg: "#FEE2E2", border: "#FCA5A5" },
                      ].map(opt => {
                        const isActive = avisForm.favorable === opt.value;
                        return (
                          <button key={String(opt.value)} type="button" onClick={() => setAvisForm(f => ({ ...f, favorable: opt.value }))}
                            style={{ flex: 1, padding: "10px 16px", border: `2px solid ${isActive ? opt.border : "#E2E8F0"}`, borderRadius: 8, background: isActive ? opt.bg : "white", color: isActive ? opt.color : "#374151", fontSize: 13, fontWeight: isActive ? 700 : 400, cursor: "pointer", transition: "all 0.15s" }}>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>

                    <textarea
                      value={avisForm.avis}
                      onChange={e => setAvisForm(f => ({ ...f, avis: e.target.value }))}
                      placeholder="Motivations, prescriptions, conditions particulières…"
                      rows={5}
                      style={{ width: "100%", border: "1px solid #E2E8F0", borderRadius: 8, padding: "10px 12px", fontSize: 13, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                    />

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => void submitAvis(c.id)}
                        disabled={avisForm.favorable === null || submittingAvis}
                        style={{ padding: "9px 22px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: avisForm.favorable === null || submittingAvis ? "not-allowed" : "pointer", opacity: avisForm.favorable === null || submittingAvis ? 0.5 : 1 }}>
                        {submittingAvis ? "Envoi…" : "Soumettre l'avis"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "courrier" && (
        <div>
          {templates.length === 0 ? (
            <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 12, padding: 24, textAlign: "center" }}>
              <p style={{ color: "#92400E", fontSize: 14, margin: "0 0 12px" }}>Aucun modèle de courrier disponible.</p>
              <p style={{ color: "#78350F", fontSize: 13, margin: 0 }}>Créez des modèles dans <strong>Courriers types</strong> pour pouvoir les utiliser ici.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
              {/* Template selector */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {templates.map(tpl => {
                  const cat = CATEGORY_CONFIG[tpl.category] ?? CATEGORY_CONFIG.general!;
                  const isSelected = selectedTpl?.id === tpl.id;
                  return (
                    <button key={tpl.id} onClick={() => setSelectedTpl(tpl)}
                      style={{ padding: "10px 14px", border: `2px solid ${isSelected ? cat.color : "#E2E8F0"}`, borderRadius: 10, background: isSelected ? cat.bg : "white", color: isSelected ? cat.color : "#374151", fontSize: 13, fontWeight: isSelected ? 700 : 400, cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                      <div>{tpl.name}</div>
                      <div style={{ fontSize: 11, marginTop: 2, opacity: 0.7 }}>{cat.label}</div>
                    </button>
                  );
                })}
              </div>

              {/* Preview + print */}
              <div>
                <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                  <button onClick={() => window.print()}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "#0F172A", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    <Printer size={14} /> Imprimer / PDF
                  </button>
                </div>
                {selectedTpl && serviceInfo && user && (
                  <CourrierPreview
                    html={editedBody}
                    service={serviceInfo.service}
                    agentName={`${user.prenom} ${user.nom}`}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Courriers types (template manager) ──────────────────────────────────────
function CourriersCatalog() {
  const [templates, setTemplates] = useState<CourrierTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<CourrierTemplate> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const rows = await api.get<CourrierTemplate[]>("/service/templates");
    setTemplates(rows);
    setLoading(false);
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  const handleSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setSaving(true);
    try {
      if (editing.id) {
        await api.put(`/service/templates/${editing.id}`, { name: editing.name, category: editing.category ?? "general", body: editing.body ?? "" });
      } else {
        await api.post("/service/templates", { name: editing.name, category: editing.category ?? "general", body: editing.body ?? "" });
      }
      await load();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Supprimer ce modèle de courrier ?")) return;
    await api.delete(`/service/templates/${id}`);
    await load();
  };

  if (editing !== null) {
    const cat = CATEGORY_CONFIG[editing.category ?? "general"] ?? CATEGORY_CONFIG.general!;
    return (
      <div style={{ padding: 32 }}>
        <button onClick={() => setEditing(null)} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", color: "#64748b", fontSize: 13, cursor: "pointer", padding: "0 0 20px" }}>
          <ArrowLeft size={14} /> Retour à la liste
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0F172A", marginBottom: 24 }}>{editing.id ? "Modifier le modèle" : "Nouveau modèle"}</h1>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Nom du modèle *</label>
            <input value={editing.name ?? ""} onChange={e => setEditing(prev => ({ ...prev!, name: e.target.value }))}
              placeholder="Ex : Avis favorable ABF"
              style={{ width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Catégorie</label>
            <select value={editing.category ?? "general"} onChange={e => setEditing(prev => ({ ...prev!, category: e.target.value }))}
              style={{ width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", background: "white", boxSizing: "border-box" }}>
              {Object.entries(CATEGORY_CONFIG).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Corps du courrier</label>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>— Utilisez le bouton <strong>Insérer variable</strong> pour les champs dynamiques</span>
        </div>
        <TipTapEditor
          content={editing.body ?? ""}
          onChange={body => setEditing(prev => ({ ...prev!, body }))}
          placeholder="Rédigez votre modèle de courrier…"
        />

        {/* Variable reference */}
        <div style={{ marginTop: 16, padding: "14px 16px", background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Variables disponibles</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {TEMPLATE_VARIABLES.flatMap(g => g.vars).map(v => (
              <span key={v.name} style={{ background: "#dbeafe", color: "#1d4ed8", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontFamily: "monospace" }}>{`{{${v.name}}}`}</span>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 24, display: "flex", gap: 10 }}>
          <button onClick={() => void handleSave()} disabled={saving || !editing.name?.trim()}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 20px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, cursor: saving || !editing.name?.trim() ? "not-allowed" : "pointer", opacity: saving || !editing.name?.trim() ? 0.6 : 1, fontSize: 13, fontWeight: 600 }}>
            <Save size={14} /> {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <span style={{ padding: "0 4px", display: "inline-flex", alignItems: "center" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: cat.color, marginRight: 6 }} />
            <span style={{ fontSize: 12, color: "#64748b" }}>{cat.label}</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>Courriers types</h1>
        <button onClick={() => setEditing({ name: "", category: "general", body: "" })}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          <Plus size={14} /> Nouveau modèle
        </button>
      </div>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>Créez et gérez vos modèles de courrier avec variables dynamiques.</p>

      {loading ? <div style={{ textAlign: "center", color: "#94a3b8", padding: 40 }}>Chargement…</div>
        : templates.length === 0 ? (
          <div style={{ background: "white", borderRadius: 12, border: "1px dashed #CBD5E1", padding: 48, textAlign: "center" }}>
            <FileText size={36} color="#CBD5E1" style={{ marginBottom: 12 }} />
            <p style={{ color: "#94a3b8", fontSize: 14, margin: "0 0 16px" }}>Aucun modèle de courrier créé</p>
            <button onClick={() => setEditing({ name: "", category: "general", body: "" })}
              style={{ padding: "8px 20px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              Créer mon premier modèle
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {templates.map(tpl => {
              const cat = CATEGORY_CONFIG[tpl.category] ?? CATEGORY_CONFIG.general!;
              return (
                <div key={tpl.id} style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>{tpl.name}</div>
                      <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 20, background: cat.bg, color: cat.color, fontSize: 11, fontWeight: 700 }}>{cat.label}</span>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button onClick={() => setEditing(tpl)} title="Modifier"
                        style={{ padding: "6px 8px", border: "1px solid #E2E8F0", borderRadius: 7, background: "white", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center" }}>
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => void handleDelete(tpl.id)} title="Supprimer"
                        style={{ padding: "6px 8px", border: "1px solid #FEE2E2", borderRadius: 7, background: "white", cursor: "pointer", color: "#EF4444", display: "flex", alignItems: "center" }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    Modifié le {fmtDate(tpl.updated_at)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ─── Service settings (letterhead, footer, signature) ─────────────────────
function ServiceSettingsPage({ serviceInfo, onSave }: { serviceInfo: ServiceInfo | null; onSave: () => void }) {
  const [form, setForm] = useState({
    letterhead_logo: serviceInfo?.service.letterhead_logo ?? "",
    letterhead_title: serviceInfo?.service.letterhead_title ?? serviceInfo?.service.name ?? "",
    letterhead_subtitle: serviceInfo?.service.letterhead_subtitle ?? "",
    letterhead_address: serviceInfo?.service.letterhead_address ?? "",
    footer_text: serviceInfo?.service.footer_text ?? "",
    signature_image: serviceInfo?.service.signature_image ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (serviceInfo) {
      setForm({
        letterhead_logo: serviceInfo.service.letterhead_logo ?? "",
        letterhead_title: serviceInfo.service.letterhead_title ?? serviceInfo.service.name,
        letterhead_subtitle: serviceInfo.service.letterhead_subtitle ?? "",
        letterhead_address: serviceInfo.service.letterhead_address ?? "",
        footer_text: serviceInfo.service.footer_text ?? "",
        signature_image: serviceInfo.service.signature_image ?? "",
      });
    }
  }, [serviceInfo]);

  const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleImageUpload = async (field: "letterhead_logo" | "signature_image", file: File) => {
    const b64 = await toBase64(file);
    setForm(prev => ({ ...prev, [field]: b64 }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put("/service/settings", {
        letterhead_logo: form.letterhead_logo || null,
        letterhead_title: form.letterhead_title || null,
        letterhead_subtitle: form.letterhead_subtitle || null,
        letterhead_address: form.letterhead_address || null,
        footer_text: form.footer_text || null,
        signature_image: form.signature_image || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSave();
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder?: string, multiline?: boolean) => (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          style={{ width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", resize: "vertical", minHeight: 80, fontFamily: "inherit", boxSizing: "border-box" }} />
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          style={{ width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
      )}
    </div>
  );

  const imageUpload = (label: string, current: string, fieldName: "letterhead_logo" | "signature_image", hint?: string) => (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>{label}</label>
      {hint && <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 8px" }}>{hint}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {current ? (
          <div style={{ position: "relative" }}>
            <img src={current} alt="" style={{ height: fieldName === "signature_image" ? 50 : 40, width: "auto", border: "1px solid #E2E8F0", borderRadius: 6, objectFit: "contain", background: "#F8FAFC", padding: 4 }} />
            <button onClick={() => setForm(prev => ({ ...prev, [fieldName]: "" }))}
              style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "#EF4444", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={10} color="white" />
            </button>
          </div>
        ) : null}
        <label style={{ padding: "7px 14px", border: "1px dashed #CBD5E1", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#64748b", display: "inline-block" }}>
          {current ? "Remplacer" : "Téléverser"} une image
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) void handleImageUpload(fieldName, f); }} />
        </label>
      </div>
    </div>
  );

  return (
    <div style={{ padding: 32, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>Paramètres du service</h1>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 32 }}>Configurez l'en-tête, le pied de page et la signature pour vos courriers.</p>

      {/* Letterhead section */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 20, marginTop: 0 }}>En-tête du courrier</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {imageUpload("Logo", form.letterhead_logo, "letterhead_logo", "Format PNG ou SVG recommandé, fond transparent")}
          {field("Nom / Titre", form.letterhead_title, v => setForm(p => ({ ...p, letterhead_title: v })), serviceInfo?.service.name)}
          {field("Sous-titre / Direction", form.letterhead_subtitle, v => setForm(p => ({ ...p, letterhead_subtitle: v })), "Ex : Direction Urbanisme et Territoire")}
          {field("Adresse", form.letterhead_address, v => setForm(p => ({ ...p, letterhead_address: v })), "Ex : 1 place Jean-Jaurès\n37000 Tours", true)}
        </div>
      </div>

      {/* Signature */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 20, marginTop: 0 }}>Signature</h2>
        {imageUpload("Image de signature", form.signature_image, "signature_image", "PNG avec fond transparent recommandé")}
      </div>

      {/* Footer */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 20, marginTop: 0 }}>Pied de page</h2>
        {field("Texte du pied de page", form.footer_text, v => setForm(p => ({ ...p, footer_text: v })), "Ex : Tél. : 02 XX XX XX XX | service.abf@culture.gouv.fr\nHoraires d'ouverture : lun-ven 9h-12h / 14h-17h", true)}
      </div>

      {/* Preview */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 12 }}>Aperçu de l'en-tête</div>
        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E2E8F0", padding: 24 }}>
          {(form.letterhead_logo || form.letterhead_title) ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 20, paddingBottom: 16, borderBottom: "2px solid #1E293B" }}>
              {form.letterhead_logo && <img src={form.letterhead_logo} alt="" style={{ height: 52, width: "auto", objectFit: "contain" }} />}
              <div>
                {form.letterhead_title && <div style={{ fontSize: 16, fontWeight: 700, color: "#1E293B" }}>{form.letterhead_title}</div>}
                {form.letterhead_subtitle && <div style={{ fontSize: 13, color: "#374151" }}>{form.letterhead_subtitle}</div>}
                {form.letterhead_address && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, whiteSpace: "pre-line" }}>{form.letterhead_address}</div>}
              </div>
            </div>
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>Renseignez le titre ou un logo pour voir l'aperçu</div>
          )}
        </div>
      </div>

      <button onClick={() => void handleSave()} disabled={saving}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 24px", background: saved ? "#16A34A" : "#4F46E5", color: "white", border: "none", borderRadius: 8, cursor: saving ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 600, transition: "background 0.3s" }}>
        <Save size={15} />
        {saved ? "Enregistré ✓" : saving ? "Enregistrement…" : "Enregistrer"}
      </button>
    </div>
  );
}

// ─── App root ──────────────────────────────────────────────────────────────
export function ServiceExterneApp() {
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [dossiers, setDossiers] = useState<DossierRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(() => {
    Promise.all([
      api.get<ServiceInfo>("/service/info"),
      api.get<DossierRow[]>("/service/dossiers"),
    ]).then(([info, rows]) => {
      setServiceInfo(info);
      setDossiers(rows);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F0F0F0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        .tiptap { outline: none; min-height: 280px; padding: 20px 24px; font-size: 14px; line-height: 1.7; color: #1E293B; font-family: Georgia, serif; }
        .tiptap p { margin: 0 0 12px; }
        .tiptap h1 { font-size: 1.4em; font-weight: 700; margin: 16px 0 8px; }
        .tiptap h2 { font-size: 1.2em; font-weight: 600; margin: 14px 0 6px; }
        .tiptap ul, .tiptap ol { padding-left: 24px; margin: 8px 0; }
        .tiptap li { margin-bottom: 4px; }
        .tiptap p.is-editor-empty:first-child::before { color: #9CA3AF; content: attr(data-placeholder); float: left; height: 0; pointer-events: none; }
        .tiptap-preview p { margin: 0 0 12px; }
        .tiptap-preview h1 { font-size: 1.4em; font-weight: 700; margin: 16px 0 8px; }
        .tiptap-preview h2 { font-size: 1.2em; font-weight: 600; margin: 14px 0 6px; }
        .tiptap-preview ul, .tiptap-preview ol { padding-left: 24px; margin: 8px 0; }
        .tiptap-preview li { margin-bottom: 4px; }
        .tiptap-preview strong { font-weight: 700; }
        .tiptap-preview em { font-style: italic; }
        .tiptap-preview u { text-decoration: underline; }
        @media print {
          aside, .no-print { display: none !important; }
          main { overflow: visible !important; }
          .print-page { border: none !important; border-radius: 0 !important; box-shadow: none !important; max-width: 100% !important; padding: 20px !important; }
        }
      `}</style>
      <Sidebar serviceInfo={serviceInfo} />
      <main style={{ flex: 1, overflowY: "auto" }}>
        <Routes>
          <Route path="/" element={<Dashboard dossiers={dossiers} serviceInfo={serviceInfo} />} />
          <Route path="/dossiers" element={<DossiersList dossiers={dossiers} loading={loading} />} />
          <Route path="/dossiers/:id" element={<DossierDetail serviceInfo={serviceInfo} />} />
          <Route path="/courriers" element={<CourriersCatalog />} />
          <Route path="/parametres" element={<ServiceSettingsPage serviceInfo={serviceInfo} onSave={loadData} />} />
          <Route path="*" element={<Navigate to="/service" replace />} />
        </Routes>
      </main>
    </div>
  );
}
