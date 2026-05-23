import { useState, useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { Node as TiptapNode, mergeAttributes, type NodeViewRendererProps } from "@tiptap/core";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { Bold, Italic, Underline as UnderlineIcon, AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Type, ChevronDown, X, Save, ArrowLeft, Plus, Pencil, Trash2, FileText, Printer } from "lucide-react";

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

// ─── Variable groups ───────────────────────────────────────────────────────
const TEMPLATE_VARIABLES = [
  { group: "Demandeur", vars: [
    { label: "Nom complet", name: "demandeur_nom" },
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
    { label: "Nom de la commune", name: "nom_service" },
    { label: "Nom de l'agent", name: "nom_agent" },
    { label: "Date du courrier", name: "date_courrier" },
  ]},
];

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  avis_favorable: { label: "Avis favorable", color: "#16A34A", bg: "#DCFCE7" },
  avis_reserves: { label: "Avis avec réserves", color: "#B45309", bg: "#FEF3C7" },
  avis_defavorable: { label: "Avis défavorable", color: "#DC2626", bg: "#FEE2E2" },
  pieces_complementaires: { label: "Demande de pièces", color: "#0284C7", bg: "#E0F2FE" },
  accord_tacite: { label: "Accord tacite", color: "#7C3AED", bg: "#EDE9FE" },
  notification_decision: { label: "Notification de décision", color: "#0F172A", bg: "#F1F5F9" },
  general: { label: "Général", color: "#6B7280", bg: "#F3F4F6" },
};

const TYPE_LABEL: Record<string, string> = {
  permis_de_construire: "Permis de construire", declaration_prealable: "Déclaration préalable",
  permis_amenager: "Permis d'aménager", permis_demolir: "Permis de démolir",
  permis_lotir: "Permis de lotir", certificat_urbanisme: "Certificat d'urbanisme",
};
const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";

function substituteVariables(html: string, vars: Record<string, string>): string {
  return html.replace(
    /<span[^>]*data-variable="([^"]+)"[^>]*>[^<]*<\/span>/g,
    (_, name: string) => vars[name] ?? `{{${name}}}`
  );
}

// ─── Editor toolbar ────────────────────────────────────────────────────────
function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const [varMenuOpen, setVarMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) setVarMenuOpen(false);
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
      style={{ padding: "4px 7px", border: "none", borderRadius: 5, cursor: "pointer", background: active ? "#E0E7FF" : "transparent", color: active ? "#4F46E5" : "#374151", display: "flex", alignItems: "center" }}>
      {icon}
    </button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "7px 10px", borderBottom: "1px solid #E2E8F0", flexWrap: "wrap", background: "#F8FAFC", borderRadius: "10px 10px 0 0" }}>
      {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold size={13} />, "Gras")}
      {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic size={13} />, "Italique")}
      {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon size={13} />, "Souligné")}
      <div style={{ width: 1, height: 16, background: "#E2E8F0", margin: "0 3px" }} />
      {btn(editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <span style={{ fontSize: 10, fontWeight: 700 }}>H1</span>, "Titre 1")}
      {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <span style={{ fontSize: 10, fontWeight: 700 }}>H2</span>, "Titre 2")}
      {btn(editor.isActive("paragraph"), () => editor.chain().focus().setParagraph().run(), <Type size={13} />, "Paragraphe")}
      <div style={{ width: 1, height: 16, background: "#E2E8F0", margin: "0 3px" }} />
      {btn(editor.isActive({ textAlign: "left" }), () => editor.chain().focus().setTextAlign("left").run(), <AlignLeft size={13} />, "Gauche")}
      {btn(editor.isActive({ textAlign: "center" }), () => editor.chain().focus().setTextAlign("center").run(), <AlignCenter size={13} />, "Centré")}
      {btn(editor.isActive({ textAlign: "right" }), () => editor.chain().focus().setTextAlign("right").run(), <AlignRight size={13} />, "Droite")}
      <div style={{ width: 1, height: 16, background: "#E2E8F0", margin: "0 3px" }} />
      {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List size={13} />, "Liste à puces")}
      {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={13} />, "Liste numérotée")}
      <div style={{ width: 1, height: 16, background: "#E2E8F0", margin: "0 3px" }} />
      <div style={{ position: "relative" }} ref={menuRef}>
        <button type="button" onClick={() => setVarMenuOpen(v => !v)}
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", border: "1px solid #C7D2FE", borderRadius: 6, background: varMenuOpen ? "#EEF2FF" : "white", color: "#4F46E5", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <span>Insérer variable</span><ChevronDown size={11} />
        </button>
        {varMenuOpen && (
          <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, marginTop: 4, background: "white", border: "1px solid #E2E8F0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 220, maxHeight: 320, overflowY: "auto" }}>
            {TEMPLATE_VARIABLES.map(group => (
              <div key={group.group}>
                <div style={{ padding: "7px 12px 3px", fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>{group.group}</div>
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

// ─── TipTap editor ─────────────────────────────────────────────────────────
function TipTapEditorMairie({ content, onChange, placeholder, minHeight = 280, wrapperStyle }: { content: string; onChange: (html: string) => void; placeholder?: string; minHeight?: number; wrapperStyle?: React.CSSProperties }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: placeholder ?? "Rédigez votre modèle…" }),
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
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden", background: "white", ...wrapperStyle }}>
      <EditorToolbar editor={editor} />
      <style>{`
        .tiptap-mairie { outline: none; min-height: ${minHeight}px; padding: 18px 20px; font-size: 14px; line-height: 1.7; color: #1E293B; font-family: Georgia, serif; }
        .tiptap-mairie p { margin: 0 0 10px; }
        .tiptap-mairie h1 { font-size: 1.4em; font-weight: 700; margin: 14px 0 6px; }
        .tiptap-mairie h2 { font-size: 1.2em; font-weight: 600; margin: 12px 0 5px; }
        .tiptap-mairie ul, .tiptap-mairie ol { padding-left: 22px; margin: 6px 0; }
        .tiptap-mairie li { margin-bottom: 3px; }
        .tiptap-mairie p.is-editor-empty:first-child::before { color: #9CA3AF; content: attr(data-placeholder); float: left; height: 0; pointer-events: none; }
        .tiptap-preview-mairie p { margin: 0 0 10px; }
        .tiptap-preview-mairie h1 { font-size: 1.4em; font-weight: 700; margin: 14px 0 6px; }
        .tiptap-preview-mairie h2 { font-size: 1.2em; font-weight: 600; margin: 12px 0 5px; }
        .tiptap-preview-mairie ul, .tiptap-preview-mairie ol { padding-left: 22px; margin: 6px 0; }
        .tiptap-preview-mairie li { margin-bottom: 3px; }
        .tiptap-preview-mairie strong { font-weight: 700; }
        .tiptap-preview-mairie em { font-style: italic; }
        .tiptap-preview-mairie u { text-decoration: underline; }
      `}</style>
      <EditorContent editor={editor} className="tiptap-mairie" />
    </div>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────
export interface CourrierTemplate {
  id: string; name: string; category: string; body: string;
  created_at: string; updated_at: string;
}
interface Letterhead {
  letterhead_logo: string | null;
  letterhead_title: string | null;
  letterhead_subtitle: string | null;
  letterhead_address: string | null;
  footer_text: string | null;
  signature_image: string | null;
}
export interface DossierForCourrier {
  id: string; numero: string; type: string; petitionnaire: string;
  adresse?: string; commune?: string; code_postal?: string; parcelle?: string;
  surface_plancher?: string; date_depot?: string; echeance?: string;
}

// ─── Courrier preview (print-ready, multi-page) ───────────────────────────
function CourrierPrintPreview({ html, letterhead, agentName }: { html: string; letterhead: Letterhead; agentName: string }) {
  const hasHeader = !!(letterhead.letterhead_logo || letterhead.letterhead_title);
  const hasFooter = !!letterhead.footer_text;
  return (
    <div style={{ background: "white", fontFamily: "Georgia, serif", fontSize: 13, lineHeight: 1.7, color: "#1E293B" }}>
      {/* Header — inline on screen, position:fixed on print (repeats every page) */}
      {hasHeader && (
        <div className="lh-print-header" style={{ display: "flex", alignItems: "flex-start", gap: 18, padding: "20px 36px 14px", borderBottom: "2px solid #1E293B", background: "white" }}>
          {letterhead.letterhead_logo && (
            <img src={letterhead.letterhead_logo} alt="" style={{ height: 56, width: "auto", objectFit: "contain", flexShrink: 0 }} />
          )}
          <div>
            {letterhead.letterhead_title && <div style={{ fontSize: 16, fontWeight: 700 }}>{letterhead.letterhead_title}</div>}
            {letterhead.letterhead_subtitle && <div style={{ fontSize: 13 }}>{letterhead.letterhead_subtitle}</div>}
            {letterhead.letterhead_address && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, whiteSpace: "pre-line" }}>{letterhead.letterhead_address}</div>}
          </div>
        </div>
      )}

      {/* Body — padded in print to clear fixed header/footer */}
      <div className="lh-print-body" style={{ padding: "24px 36px" }}>
        <div className="tiptap-preview-mairie" dangerouslySetInnerHTML={{ __html: html }} style={{ minHeight: 200 }} />
        {(letterhead.signature_image || agentName) && (
          <div style={{ marginTop: 36 }}>
            {letterhead.signature_image && <img src={letterhead.signature_image} alt="Signature" style={{ height: 64, width: "auto", objectFit: "contain", display: "block", marginBottom: 3 }} />}
            {agentName && <div style={{ fontSize: 13, fontWeight: 600 }}>{agentName}</div>}
          </div>
        )}
      </div>

      {/* Footer — inline on screen, position:fixed on print (repeats every page) */}
      {hasFooter && (
        <div className="lh-print-footer" style={{ padding: "10px 36px 14px", borderTop: "1px solid #CBD5E1", fontSize: 11, color: "#64748b", textAlign: "center", whiteSpace: "pre-line", background: "white" }}>
          {letterhead.footer_text}
        </div>
      )}
    </div>
  );
}

// ─── Courrier Modal ────────────────────────────────────────────────────────
export function CourrierModal({ dossier, onClose }: { dossier: DossierForCourrier; onClose: () => void }) {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<CourrierTemplate[]>([]);
  const [selected, setSelected] = useState<CourrierTemplate | null>(null);
  const [letterhead, setLetterhead] = useState<Letterhead>({ letterhead_logo: null, letterhead_title: null, letterhead_subtitle: null, letterhead_address: null, footer_text: null, signature_image: null });
  const [substitutedHtml, setSubstitutedHtml] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<CourrierTemplate[]>("/mairie/templates"),
      api.get<Letterhead>("/mairie/commune-letterhead"),
    ]).then(([tpls, lh]) => {
      setTemplates(tpls);
      setLetterhead(lh);
      if (tpls.length > 0) setSelected(tpls[0]!);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected || !user) return;
    const vars: Record<string, string> = {
      demandeur_nom: dossier.petitionnaire,
      demandeur_email: "—",
      numero_dossier: dossier.numero,
      type_dossier: TYPE_LABEL[dossier.type] ?? dossier.type,
      adresse_travaux: dossier.adresse ?? "—",
      commune: dossier.commune ?? "—",
      code_postal: dossier.code_postal ?? "",
      parcelle: dossier.parcelle ?? "—",
      surface_plancher: dossier.surface_plancher ? `${dossier.surface_plancher} m²` : "—",
      date_depot: fmtDate(dossier.date_depot),
      date_limite_instruction: fmtDate(dossier.echeance),
      nom_service: letterhead.letterhead_title ?? dossier.commune ?? "Commune",
      nom_agent: `${user.prenom} ${user.nom}`,
      date_courrier: new Date().toLocaleDateString("fr-FR"),
    };
    setSubstitutedHtml(substituteVariables(selected.body, vars));
  }, [selected, letterhead, dossier, user]);

  return (
    <div className="print-modal-overlay" style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex" }}>
      <style>{`
        @media print {
          .no-print-modal { display: none !important; }

          /* Remove all modal chrome constraints so content paginates freely */
          .print-modal-overlay {
            position: static !important;
            display: block !important;
            z-index: unset !important;
          }
          .print-modal-box {
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            max-height: none !important;
            height: auto !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            overflow: visible !important;
            margin: 0 !important;
            display: block !important;
          }
          .print-modal-body {
            display: block !important;
            overflow: visible !important;
            height: auto !important;
          }
          .print-area {
            overflow: visible !important;
            flex: none !important;
            height: auto !important;
          }

          /* Letterhead header: fixed at top of every page */
          .lh-print-header {
            position: fixed !important;
            top: 0; left: 0; right: 0;
            background: white !important;
            z-index: 10 !important;
          }

          /* Letterhead footer: fixed at bottom of every page */
          .lh-print-footer {
            position: fixed !important;
            bottom: 0; left: 0; right: 0;
            background: white !important;
            z-index: 10 !important;
          }

          /* Body: padding to avoid overlap with fixed header (≈160px) and footer (≈60px) */
          .lh-print-body {
            padding-top: 160px !important;
            padding-bottom: 70px !important;
          }
        }
      `}</style>
      <div className="no-print-modal" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div className="print-modal-box" style={{ position: "relative", width: "90vw", maxWidth: 1100, maxHeight: "92vh", margin: "auto", background: "white", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
        {/* Header */}
        <div className="no-print-modal" style={{ padding: "16px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>Générer un courrier</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{dossier.numero} — {dossier.petitionnaire}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => window.print()}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "#0F172A", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Printer size={14} /> Imprimer / PDF
            </button>
            <button onClick={onClose} style={{ padding: 6, border: "1px solid #E2E8F0", borderRadius: 8, background: "white", cursor: "pointer", display: "flex" }}>
              <X size={16} color="#64748b" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="print-modal-body" style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Template selector */}
          <div className="no-print-modal" style={{ width: 200, borderRight: "1px solid #E2E8F0", padding: "16px 12px", overflowY: "auto", flexShrink: 0 }}>
            {loading ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Chargement…</div>
              : templates.length === 0 ? (
                <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "center", padding: "16px 0" }}>
                  <FileText size={24} color="#CBD5E1" style={{ marginBottom: 8 }} />
                  <p style={{ margin: 0 }}>Aucun modèle.<br />Créez-en dans Paramètres.</p>
                </div>
              ) : templates.map(tpl => {
                const cat = CATEGORY_CONFIG[tpl.category] ?? CATEGORY_CONFIG.general!;
                const isSelected = selected?.id === tpl.id;
                return (
                  <button key={tpl.id} onClick={() => setSelected(tpl)}
                    style={{ width: "100%", padding: "9px 12px", border: `2px solid ${isSelected ? cat.color : "#E2E8F0"}`, borderRadius: 8, background: isSelected ? cat.bg : "white", color: isSelected ? cat.color : "#374151", fontSize: 12, fontWeight: isSelected ? 700 : 400, cursor: "pointer", textAlign: "left", marginBottom: 6, transition: "all 0.1s" }}>
                    <div style={{ marginBottom: 2 }}>{tpl.name}</div>
                    <div style={{ fontSize: 10, opacity: 0.7 }}>{cat.label}</div>
                  </button>
                );
              })}
          </div>

          {/* Print preview */}
          <div className="print-area" style={{ flex: 1, overflowY: "auto" }}>
            {selected ? (
              <CourrierPrintPreview html={substitutedHtml} letterhead={letterhead} agentName={`${user?.prenom ?? ""} ${user?.nom ?? ""}`} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", fontSize: 14 }}>
                Sélectionnez un modèle pour voir l'aperçu
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Letterhead banner (shown inside template editor as paper context) ────────
function LetterheadBanner({ lh }: { lh: Letterhead }) {
  if (!lh.letterhead_logo && !lh.letterhead_title) return null;
  return (
    <div style={{ padding: "14px 20px 12px", borderBottom: "2px solid #1E293B", display: "flex", alignItems: "flex-start", gap: 14, background: "white", userSelect: "none", pointerEvents: "none" }}>
      {lh.letterhead_logo && (
        <img src={lh.letterhead_logo} alt="" style={{ height: 44, width: "auto", objectFit: "contain", flexShrink: 0 }} />
      )}
      <div>
        {lh.letterhead_title && <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>{lh.letterhead_title}</div>}
        {lh.letterhead_subtitle && <div style={{ fontSize: 12, color: "#374151" }}>{lh.letterhead_subtitle}</div>}
        {lh.letterhead_address && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, whiteSpace: "pre-line" }}>{lh.letterhead_address}</div>}
      </div>
      <div style={{ marginLeft: "auto", fontSize: 10, color: "#CBD5E1", fontStyle: "italic", alignSelf: "flex-end" }}>En-tête commune</div>
    </div>
  );
}

function LetterheadFooter({ lh }: { lh: Letterhead }) {
  if (!lh.footer_text && !lh.signature_image) return null;
  return (
    <div style={{ background: "white", borderTop: "1px solid #CBD5E1", padding: "10px 20px", userSelect: "none", pointerEvents: "none" }}>
      {lh.signature_image && (
        <img src={lh.signature_image} alt="Signature" style={{ height: 48, width: "auto", objectFit: "contain", display: "block", marginBottom: 4 }} />
      )}
      {lh.footer_text && (
        <div style={{ fontSize: 10, color: "#64748b", textAlign: "center", whiteSpace: "pre-line", borderTop: "1px solid #E2E8F0", paddingTop: 8, marginTop: 4 }}>
          {lh.footer_text}
        </div>
      )}
      <div style={{ fontSize: 10, color: "#CBD5E1", fontStyle: "italic", textAlign: "right", marginTop: 4 }}>Pied de page commune</div>
    </div>
  );
}

// ─── Template Manager Panel ────────────────────────────────────────────────
export function TemplateManagerPanel() {
  const [templates, setTemplates] = useState<CourrierTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<CourrierTemplate> | null>(null);
  const [saving, setSaving] = useState(false);
  const [letterhead, setLetterhead] = useState<Letterhead>({
    letterhead_logo: null, letterhead_title: null, letterhead_subtitle: null,
    letterhead_address: null, footer_text: null, signature_image: null,
  });

  const load = useCallback(async () => {
    const rows = await api.get<CourrierTemplate[]>("/mairie/templates");
    setTemplates(rows);
    setLoading(false);
  }, []);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);
  useEffect(() => {
    api.get<Letterhead & { commune_configured?: boolean }>("/mairie/commune-letterhead")
      .then(lh => { if (lh.commune_configured !== false) setLetterhead(lh); })
      .catch(() => {});
  }, []);

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing.id) {
        await api.put(`/mairie/templates/${editing.id}`, { name: editing.name, category: editing.category ?? "general", body: editing.body ?? "" });
      } else {
        await api.post("/mairie/templates", { name: editing.name, category: editing.category ?? "general", body: editing.body ?? "" });
      }
      await load();
      setEditing(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Erreur — vérifiez que votre compte est rattaché à une commune.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Supprimer ce modèle de courrier ?")) return;
    await api.delete(`/mairie/templates/${id}`);
    await load();
  };

  const hasLetterhead = !!(letterhead.letterhead_logo || letterhead.letterhead_title);
  const hasFooter = !!(letterhead.footer_text || letterhead.signature_image);

  if (editing !== null) {
    const cat = CATEGORY_CONFIG[editing.category ?? "general"] ?? CATEGORY_CONFIG.general!;
    return (
      <div style={{ padding: "20px 0" }}>
        <button onClick={() => setEditing(null)} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", color: "#64748b", fontSize: 13, cursor: "pointer", padding: "0 0 16px" }}>
          <ArrowLeft size={14} /> Retour à la liste
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>{editing.id ? "Modifier le modèle" : "Nouveau modèle"}</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Nom du modèle *</label>
            <input value={editing.name ?? ""} onChange={e => setEditing(p => ({ ...p!, name: e.target.value }))}
              placeholder="Ex : Demande de pièces complémentaires"
              style={{ width: "100%", padding: "8px 11px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Catégorie</label>
            <select value={editing.category ?? "general"} onChange={e => setEditing(p => ({ ...p!, category: e.target.value }))}
              style={{ width: "100%", padding: "8px 11px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none", background: "white", boxSizing: "border-box" }}>
              {Object.entries(CATEGORY_CONFIG).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Paper view: letterhead header + editable body + letterhead footer */}
        <div style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 14 }}>
          {hasLetterhead && (
            <div style={{ border: "1px solid #E2E8F0", borderBottom: "none", borderRadius: "10px 10px 0 0", overflow: "hidden" }}>
              <LetterheadBanner lh={letterhead} />
            </div>
          )}
          <TipTapEditorMairie
            content={editing.body ?? ""}
            onChange={body => setEditing(p => ({ ...p!, body }))}
            placeholder="Rédigez le corps du courrier… Utilisez Insérer variable pour les champs dynamiques."
            minHeight={220}
            wrapperStyle={hasLetterhead || hasFooter ? {
              borderRadius: hasLetterhead && hasFooter ? 0 : hasLetterhead ? "0 0 10px 10px" : "10px 10px 0 0",
              borderTop: hasLetterhead ? "none" : undefined,
              borderBottom: hasFooter ? "none" : undefined,
            } : undefined}
          />
          {hasFooter && (
            <div style={{ border: "1px solid #E2E8F0", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
              <LetterheadFooter lh={letterhead} />
            </div>
          )}
        </div>

        {!hasLetterhead && (
          <div style={{ marginBottom: 14, padding: "8px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, color: "#64748b" }}>
            💡 Configurez l'en-tête dans <strong>Paramètres → Courriers</strong> pour voir le papier à en-tête ici.
          </div>
        )}

        <div style={{ padding: "10px 14px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0", marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 6 }}>Variables disponibles</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {TEMPLATE_VARIABLES.flatMap(g => g.vars).map(v => (
              <span key={v.name} style={{ background: "#dbeafe", color: "#1d4ed8", padding: "1px 7px", borderRadius: 10, fontSize: 10, fontFamily: "monospace" }}>{`{{${v.name}}}`}</span>
            ))}
          </div>
        </div>

        {saveError && (
          <div style={{ marginBottom: 12, padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, fontSize: 12, color: "#B91C1C" }}>
            {saveError}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={() => void handleSave()} disabled={saving || !editing.name?.trim()}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, cursor: saving || !editing.name?.trim() ? "not-allowed" : "pointer", opacity: saving || !editing.name?.trim() ? 0.6 : 1, fontSize: 13, fontWeight: 600 }}>
            <Save size={13} /> {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#64748b" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: cat.color }} />
            {cat.label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Mes Modèles de Courrier</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Modèles partagés avec toute la commune, avec variables dynamiques.</div>
        </div>
        <button onClick={() => setEditing({ name: "", category: "general", body: "" })}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          <Plus size={13} /> Nouveau modèle
        </button>
      </div>

      {loading ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 20, textAlign: "center" }}>Chargement…</div>
        : templates.length === 0 ? (
          <div style={{ border: "1px dashed #CBD5E1", borderRadius: 10, padding: 36, textAlign: "center" }}>
            <FileText size={32} color="#CBD5E1" style={{ marginBottom: 10 }} />
            <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 14px" }}>Aucun modèle de courrier</p>
            <button onClick={() => setEditing({ name: "", category: "general", body: "" })}
              style={{ padding: "7px 18px", background: "#4F46E5", color: "white", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              Créer un modèle
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {templates.map(tpl => {
              const cat = CATEGORY_CONFIG[tpl.category] ?? CATEGORY_CONFIG.general!;
              return (
                <div key={tpl.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: "1px solid #E2E8F0", borderRadius: 10, background: "white" }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: cat.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{tpl.name}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{cat.label} · Modifié le {fmtDate(tpl.updated_at)}</div>
                  </div>
                  <button onClick={() => setEditing(tpl)} title="Modifier"
                    style={{ padding: "5px 7px", border: "1px solid #E2E8F0", borderRadius: 6, background: "white", cursor: "pointer", color: "#64748b", display: "flex" }}>
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => void handleDelete(tpl.id)} title="Supprimer"
                    style={{ padding: "5px 7px", border: "1px solid #FEE2E2", borderRadius: 6, background: "white", cursor: "pointer", color: "#EF4444", display: "flex" }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ─── Commune Letterhead Panel ──────────────────────────────────────────────
export function CommuneLetterheadPanel() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    letterhead_logo: "", letterhead_title: "", letterhead_subtitle: "",
    letterhead_address: "", footer_text: "", signature_image: "",
  });
  const [communeLogoUrl, setCommuneLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [communeConfigured, setCommuneConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    api.get<typeof form & { commune_configured?: boolean; commune_logo_url?: string | null }>("/mairie/commune-letterhead").then(lh => {
      setCommuneConfigured(lh.commune_configured ?? false);
      if (lh.commune_configured === false) return;
      setCommuneLogoUrl(lh.commune_logo_url ?? null);
      setForm({
        letterhead_logo: lh.letterhead_logo ?? "",
        letterhead_title: lh.letterhead_title ?? (user?.commune ?? ""),
        letterhead_subtitle: lh.letterhead_subtitle ?? "",
        letterhead_address: lh.letterhead_address ?? "",
        footer_text: lh.footer_text ?? "",
        signature_image: lh.signature_image ?? "",
      });
    }).catch(() => { setCommuneConfigured(false); }).finally(() => setLoading(false));
  }, [user]);

  const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.put("/mairie/commune-letterhead", {
        letterhead_logo: form.letterhead_logo || null,
        letterhead_title: form.letterhead_title || null,
        letterhead_subtitle: form.letterhead_subtitle || null,
        letterhead_address: form.letterhead_address || null,
        footer_text: form.footer_text || null,
        signature_image: form.signature_image || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const imageUpload = (label: string, current: string, fieldName: "letterhead_logo" | "signature_image", hint?: string) => (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>{label}</label>
      {hint && <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 7px" }}>{hint}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {current && (
          <div style={{ position: "relative" }}>
            <img src={current} alt="" style={{ height: fieldName === "signature_image" ? 44 : 36, width: "auto", border: "1px solid #E2E8F0", borderRadius: 5, objectFit: "contain", background: "#F8FAFC", padding: 3 }} />
            <button onClick={() => setForm(p => ({ ...p, [fieldName]: "" }))}
              style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: "#EF4444", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={9} color="white" />
            </button>
          </div>
        )}
        <label style={{ padding: "6px 12px", border: "1px dashed #CBD5E1", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#64748b", display: "inline-block" }}>
          {current ? "Remplacer" : "Téléverser"}
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => {
            const f = e.target.files?.[0];
            if (f) setForm(p => ({ ...p, [fieldName]: "" }));
            if (f) { const b64 = await toBase64(f); setForm(p => ({ ...p, [fieldName]: b64 })); }
          }} />
        </label>
      </div>
    </div>
  );

  if (loading) return <div style={{ color: "#94a3b8", fontSize: 13, padding: 20 }}>Chargement…</div>;

  if (communeConfigured === false) return (
    <div style={{ padding: "20px 0", maxWidth: 560 }}>
      <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: "16px 20px", display: "flex", gap: 14, alignItems: "flex-start" }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>⚠️</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>Votre compte n'est pas rattaché à une commune</div>
          <div style={{ fontSize: 13, color: "#78350F", lineHeight: 1.6 }}>
            Pour configurer l'en-tête des courriers et gérer les modèles, votre compte doit être associé à une commune.<br />
            Demandez à votre administrateur d'assigner une commune via <strong>Super Admin → Utilisateurs → Communes</strong>.
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "20px 0", maxWidth: 640 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>En-tête des courriers</div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Logo, titre, adresse et pied de page appliqués à tous les courriers générés.</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Logo de la commune</label>
          <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 7px" }}>PNG/SVG, fond transparent recommandé</p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {form.letterhead_logo && (
              <div style={{ position: "relative" }}>
                <img src={form.letterhead_logo} alt="" style={{ height: 36, width: "auto", border: "1px solid #E2E8F0", borderRadius: 5, objectFit: "contain", background: "#F8FAFC", padding: 3 }} />
                <button onClick={() => setForm(p => ({ ...p, letterhead_logo: "" }))}
                  style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: "#EF4444", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <X size={9} color="white" />
                </button>
              </div>
            )}
            <label style={{ padding: "6px 12px", border: "1px dashed #CBD5E1", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#64748b", display: "inline-block" }}>
              {form.letterhead_logo ? "Remplacer" : "Téléverser"}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => {
                const f = e.target.files?.[0];
                if (f) setForm(p => ({ ...p, letterhead_logo: "" }));
                if (f) { const b64 = await toBase64(f); setForm(p => ({ ...p, letterhead_logo: b64 })); }
              }} />
            </label>
            {communeLogoUrl && !form.letterhead_logo && (
              <button onClick={() => setForm(p => ({ ...p, letterhead_logo: communeLogoUrl }))}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "1px solid #C7D2FE", background: "#EEF2FF", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#4F46E5", fontWeight: 500 }}>
                <img src={communeLogoUrl} alt="" style={{ height: 18, width: "auto", objectFit: "contain" }} />
                Utiliser le logo de la commune
              </button>
            )}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Titre</label>
          <input value={form.letterhead_title} onChange={e => setForm(p => ({ ...p, letterhead_title: e.target.value }))} placeholder="Ex : Mairie de Ballan-Miré"
            style={{ width: "100%", padding: "8px 11px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Sous-titre</label>
          <input value={form.letterhead_subtitle} onChange={e => setForm(p => ({ ...p, letterhead_subtitle: e.target.value }))} placeholder="Ex : Service Urbanisme"
            style={{ width: "100%", padding: "8px 11px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Adresse</label>
          <textarea value={form.letterhead_address} onChange={e => setForm(p => ({ ...p, letterhead_address: e.target.value }))} placeholder={"Place de la Mairie\n37510 Ballan-Miré"}
            style={{ width: "100%", padding: "8px 11px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none", resize: "vertical", minHeight: 64, fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>

        {imageUpload("Signature", form.signature_image, "signature_image", "PNG fond transparent recommandé")}

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Pied de page</label>
          <textarea value={form.footer_text} onChange={e => setForm(p => ({ ...p, footer_text: e.target.value }))} placeholder={"Tél. : 02 47 XX XX XX | urbanisme@ballan-mire.fr\nHoraires : lun-ven 9h-12h / 14h-17h"}
            style={{ width: "100%", padding: "8px 11px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none", resize: "vertical", minHeight: 64, fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>

        {/* Aperçu */}
        {(form.letterhead_logo || form.letterhead_title) && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Aperçu</div>
            <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 8, padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 16, paddingBottom: 14, borderBottom: "2px solid #1E293B" }}>
                {form.letterhead_logo && <img src={form.letterhead_logo} alt="" style={{ height: 44, width: "auto", objectFit: "contain" }} />}
                <div>
                  {form.letterhead_title && <div style={{ fontSize: 15, fontWeight: 700 }}>{form.letterhead_title}</div>}
                  {form.letterhead_subtitle && <div style={{ fontSize: 13 }}>{form.letterhead_subtitle}</div>}
                  {form.letterhead_address && <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "pre-line" }}>{form.letterhead_address}</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {saveError && (
          <div style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, fontSize: 12, color: "#B91C1C" }}>
            {saveError}
          </div>
        )}
        <button onClick={() => void handleSave()} disabled={saving}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 20px", background: saved ? "#16A34A" : "#4F46E5", color: "white", border: "none", borderRadius: 8, cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, width: "fit-content", transition: "background 0.3s" }}>
          <Save size={13} />
          {saved ? "Enregistré ✓" : saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
