import { useState, useEffect, useLayoutEffect, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import DOMPurify from "dompurify";
import { Rnd } from "react-rnd";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { ROLE_LABELS } from "./shared";
import { X, Save, ArrowLeft, Plus, Pencil, Trash2, FileText, Printer } from "lucide-react";

// ─── Variable groups ───────────────────────────────────────────────────────
const TEMPLATE_VARIABLES = [
  { group: "Identification de la mairie", vars: [
    { label: "Nom de la commune", name: "nom_service" },
    { label: "Service instructeur", name: "service_instructeur" },
    { label: "Coordonnées", name: "coordonnees_mairie" },
    { label: "Nom de l'agent", name: "nom_agent" },
    { label: "Téléphone de l'agent", name: "agent_tel" },
    { label: "Email de l'agent", name: "agent_email" },
    { label: "Date du courrier", name: "date_courrier" },
  ]},
  { group: "Références du dossier", vars: [
    { label: "Numéro de dossier", name: "numero_dossier" },
    { label: "Type de dossier", name: "type_dossier" },
    { label: "Identité du demandeur", name: "demandeur_nom" },
    { label: "Email demandeur", name: "demandeur_email" },
    { label: "Date de dépôt", name: "date_depot" },
    { label: "Date de complétude", name: "date_completude" },
    { label: "Date de délivrance", name: "date_delivrance" },
    { label: "Date limite instruction", name: "date_limite_instruction" },
  ]},
  { group: "Identification du terrain", vars: [
    { label: "Adresse des travaux", name: "adresse_travaux" },
    { label: "Commune", name: "commune" },
    { label: "Code postal", name: "code_postal" },
    { label: "Références cadastrales", name: "parcelle" },
    { label: "Superficie (surface plancher)", name: "surface_plancher" },
  ]},
  { group: "Projet", vars: [
    { label: "Description / nature des travaux", name: "description_projet" },
  ]},
  { group: "Signataire", vars: [
    { label: "Nom du signataire", name: "signataire_nom" },
    { label: "Fonction du signataire", name: "signataire_fonction" },
  ]},
  { group: "Demande de pièces complémentaires", vars: [
    { label: "Liste des pièces à compléter", name: "liste_pieces_a_completer" },
    { label: "Nombre de pièces à compléter", name: "nombre_pieces_a_completer" },
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
  permis_de_construire: "Permis de construire",
  permis_de_construire_mi: "Permis de construire (MI)",
  declaration_prealable: "Déclaration préalable",
  permis_amenager: "Permis d'aménager", permis_demolir: "Permis de démolir",
  permis_lotir: "Permis de lotir", certificat_urbanisme: "Certificat d'urbanisme",
  certificat_urbanisme_a: "Certificat d'urbanisme (informatif)",
  certificat_urbanisme_b: "Certificat d'urbanisme (opérationnel)",
};
const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";

// ─── Canvas data types & helpers ─────────────────────────────────────────────
interface CanvasBlock {
  id: string; x: number; y: number; w: number; h: number;
  html: string; fontSize: number;
  fontFamily: "serif" | "sans";
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  borderStyle: "none" | "light" | "medium" | "dashed";
  background: "transparent" | "white" | "blue" | "yellow" | "green";
  padding: number;
}
interface CanvasPage { id: string; blocks: CanvasBlock[]; }

const PAGE_W = 794;
const PAGE_H = 1123; // A4 at 96 dpi
const CANVAS_MARGIN = 40;
const HDR_H = 82;  // letterhead zone height
const FTR_H = 44;  // footer + page number zone height

function isCanvasBody(s: string): boolean {
  try { const d = JSON.parse(s); return d?.version === 1 || d?.version === 2; } catch { return false; }
}
function parseCanvasDoc(body: string): CanvasPage[] {
  if (!body) return [{ id: "p1", blocks: [] }];
  try {
    const d = JSON.parse(body) as { version: number; blocks?: CanvasBlock[]; pages?: CanvasPage[] };
    if (d.version === 2 && d.pages) return d.pages;
    if (d.version === 1 && d.blocks) return [{ id: "p1", blocks: d.blocks }];
  } catch { /* legacy HTML */ }
  return [{ id: "p1", blocks: [{ id: "legacy", x: CANVAS_MARGIN, y: 20, w: PAGE_W - CANVAS_MARGIN * 2, h: 400, html: body, fontSize: 13, fontFamily: "serif", textAlign: "left", verticalAlign: "top", borderStyle: "none", background: "transparent", padding: 8 }] }];
}
function serializeDoc(pages: CanvasPage[]): string {
  return JSON.stringify({ version: 2, pages });
}

const BLOCK_BG: Record<CanvasBlock["background"], string> = {
  transparent: "transparent", white: "white",
  blue: "#EFF6FF", yellow: "#FEFCE8", green: "#F0FDF4",
};
const BLOCK_BORDER: Record<CanvasBlock["borderStyle"], string> = {
  none: "none", light: "1px solid #E2E8F0",
  medium: "1.5px solid #94a3b8", dashed: "1px dashed #94a3b8",
};

// Variante client de renderPieceListHtml (cf. apps/api/src/services/pieceRequest.ts).
// Le rendu doit rester identique à celui produit côté serveur pour que
// l'aperçu corresponde au snapshot persisté à l'émission.
function renderPieceListHtmlClient(pieces: PieceRequestSelection[]): string {
  if (pieces.length === 0) return "";
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] ?? c));
  const items = pieces.map((p) => {
    const codeLabel = p.code_piece ? `<strong>${escape(p.code_piece)}</strong> — ` : "";
    const reason = p.raison ? `<br/><span style="font-size:0.9em;color:#475569;">${escape(p.raison)}</span>` : "";
    const tag = p.manquante
      ? `<span style="font-size:0.78em;color:#B45309;background:#FEF3C7;padding:1px 6px;border-radius:4px;margin-left:6px;">à fournir</span>`
      : `<span style="font-size:0.78em;color:#0284C7;background:#E0F2FE;padding:1px 6px;border-radius:4px;margin-left:6px;">à compléter</span>`;
    return `<li style="margin-bottom:6px;">${codeLabel}${escape(p.nom)}${tag}${reason}</li>`;
  }).join("");
  return `<ul style="padding-left:18px;margin:0;">${items}</ul>`;
}

function substituteVariables(body: string, vars: Record<string, string>): string {
  const subHtml = (html: string) =>
    html.replace(/<span[^>]*data-variable="([^"]+)"[^>]*>[^<]*<\/span>/g,
      (_, name: string) => vars[name] ?? `{{${name}}}`);
  if (!isCanvasBody(body)) return subHtml(body);
  const d = JSON.parse(body) as { version: number; blocks?: CanvasBlock[]; pages?: CanvasPage[] };
  if (d.version === 2 && d.pages) {
    return JSON.stringify({ ...d, pages: d.pages.map(p => ({ ...p, blocks: p.blocks.map(b => ({ ...b, html: subHtml(b.html) })) })) });
  }
  return JSON.stringify({ ...d, blocks: (d.blocks ?? []).map(b => ({ ...b, html: subHtml(b.html) })) });
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
  tampon_image: string | null;
}
export interface DossierForCourrier {
  id: string; numero: string; type: string; petitionnaire: string;
  petitionnaire_email?: string | null;
  adresse?: string; commune?: string; code_postal?: string; parcelle?: string;
  surface_plancher?: string; description?: string | null;
  date_depot?: string; echeance?: string;
  date_completude?: string; date_delivrance?: string;
}

// Pièce déjà déposée par le pétitionnaire — sert au sélecteur "Demande de
// pièces complémentaires" pour proposer les pièces existantes à compléter
// (à côté des entrées libres pour les pièces totalement absentes).
export interface CourrierAvailablePiece {
  id: string;
  nom: string;
  code_piece: string | null;
  instructeur_status: "valide" | "rejete" | "complement_demande" | null;
  // Score IA optionnel — affiché uniquement si l'utilisateur n'a pas désactivé
  // les suggestions IA (préférence persistée côté localStorage).
  ia_score?: "conforme" | "acceptable" | "incomplet" | "non_conforme" | null;
}

// Sélection construite par l'instructeur dans le picker. Convertie en payload
// pour POST /mairie/dossiers/:id/courriers/pieces-complementaires.
export interface PieceRequestSelection {
  // Pièce existante cochée (référence piece_id)
  piece_id?: string;
  // Pièce libre (texte saisi)
  code_piece?: string;
  nom: string;
  raison?: string;
  manquante: boolean;
}
interface MentionRow {
  id: string;
  article_ref: string;
  article_title: string | null;
  article_html: string | null;
  courrier_types: string[];
  dossier_types: string[];
  contexte: string | null;
  suggested: boolean;
}

const COURRIER_TYPES = [
  { value: "pieces_complementaires", label: "Pièces complémentaires" },
  { value: "refus",                  label: "Refus" },
  { value: "non_opposition",         label: "Non-opposition / accord" },
  { value: "majoration_delai",       label: "Majoration de délai" },
  { value: "daact",                  label: "DAACT / achèvement" },
  { value: "sursis",                 label: "Sursis à statuer" },
  { value: "notification",           label: "Notification de décision" },
];

// ─── Draggable stamp / signature overlay ──────────────────────────────────
type Pos = { x: number; y: number };

function DraggableStamp({ src, pos, setPos, caption, onHide }: {
  src: string; pos: Pos; setPos: Dispatch<SetStateAction<Pos>>; caption?: string; onHide: () => void;
}) {
  const isDragging = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      setPos(p => ({ x: p.x + e.movementX, y: p.y + e.movementY }));
    };
    const onUp = () => { isDragging.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [setPos]);

  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); isDragging.current = true; }}
      style={{ position: "absolute", left: pos.x, top: pos.y, cursor: "grab", userSelect: "none", zIndex: 50 }}
    >
      <img src={src} alt="" style={{ display: "block", maxHeight: 80, width: "auto", objectFit: "contain", pointerEvents: "none" }} />
      {caption && <div style={{ fontSize: 12, fontWeight: 600, color: "#1E293B", marginTop: 2, pointerEvents: "none" }}>{caption}</div>}
      {/* Remove button — hidden when printing */}
      <button
        className="no-print-modal"
        onClick={(e) => { e.stopPropagation(); onHide(); }}
        style={{ position: "absolute", top: -8, right: -8, width: 18, height: 18, borderRadius: "50%", background: "#EF4444", border: "none", cursor: "pointer", color: "white", fontSize: 12, lineHeight: "18px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        ×
      </button>
    </div>
  );
}

// ─── Canvas print view (multi-page A4) ───────────────────────────────────────
function CanvasPrintView({ pages, letterhead, extraHtml }: { pages: CanvasPage[]; letterhead: Letterhead; extraHtml?: string }) {
  const hasLH = !!(letterhead.letterhead_logo || letterhead.letterhead_title);
  const hH = hasLH ? HDR_H : 0;
  return (
    <div>
      {pages.map((page, i) => (
        <div key={page.id} style={{
          position: "relative", width: PAGE_W, height: PAGE_H, background: "white",
          ...(i < pages.length - 1 ? { marginBottom: 32, pageBreakAfter: "always", breakAfter: "page" } : {}),
        }}>
          {hasLH && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: hH, overflow: "hidden", borderBottom: "2px solid #1E293B", display: "flex", alignItems: "center", padding: "0 20px", gap: 14, background: "white" }}>
              {letterhead.letterhead_logo && <img src={letterhead.letterhead_logo} alt="" style={{ height: 44, width: "auto", objectFit: "contain", flexShrink: 0 }} />}
              <div>
                {letterhead.letterhead_title && <div style={{ fontSize: 15, fontWeight: 700 }}>{letterhead.letterhead_title}</div>}
                {letterhead.letterhead_subtitle && <div style={{ fontSize: 12 }}>{letterhead.letterhead_subtitle}</div>}
                {letterhead.letterhead_address && <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "pre-line" }}>{letterhead.letterhead_address}</div>}
              </div>
            </div>
          )}
          <div style={{ position: "absolute", top: hH, left: 0, right: 0, bottom: FTR_H }}>
            {page.blocks.map(b => (
              <div key={b.id} style={{
                position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h,
                display: "flex", flexDirection: "column",
                justifyContent: b.verticalAlign === "middle" ? "center" : b.verticalAlign === "bottom" ? "flex-end" : "flex-start",
                padding: b.padding, fontSize: b.fontSize, lineHeight: 1.6, boxSizing: "border-box",
                fontFamily: b.fontFamily === "serif" ? "Georgia, serif" : "system-ui, sans-serif",
                textAlign: b.textAlign, background: BLOCK_BG[b.background],
                border: BLOCK_BORDER[b.borderStyle], overflow: "hidden",
              }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(b.html) }} />
            ))}
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: FTR_H, borderTop: "1px solid #CBD5E1", display: "flex", alignItems: "center", padding: "0 20px", background: "white" }}>
            <span style={{ fontSize: 10, color: "#64748b", flex: 1 }}>{letterhead.footer_text ?? ""}</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{i + 1} / {pages.length}</span>
          </div>
        </div>
      ))}
      {extraHtml && (
        <div style={{ background: "white", padding: "24px 40px", width: PAGE_W, boxSizing: "border-box" }}>
          <div style={{ paddingTop: 18, borderTop: "1px solid #CBD5E1" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Références législatives et réglementaires</div>
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(extraHtml) }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Corps de courrier éditable (contentEditable, seedé une fois au montage) ──
// Monté uniquement en mode édition : on injecte le HTML au montage puis on laisse
// l'utilisateur taper librement (aucune ré-injection → pas de saut de curseur).
// Chaque frappe remonte le HTML courant via onChange.
function EditableBody({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.innerHTML = DOMPurify.sanitize(html);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      ref={ref}
      className="tiptap-preview-mairie courrier-editable-active"
      contentEditable
      suppressContentEditableWarning
      onInput={(e) => onChange(e.currentTarget.innerHTML)}
      style={{ outline: "2px dashed #6366F1", outlineOffset: 6, borderRadius: 4, minHeight: 60 }}
    />
  );
}

// ─── Courrier preview (print-ready, multi-page) ───────────────────────────
function CourrierPrintPreview({ html, letterhead, extraHtml, editable = false, onBodyChange }: { html: string; letterhead: Letterhead; extraHtml?: string; editable?: boolean; onBodyChange?: (html: string) => void }) {
  if (isCanvasBody(html)) {
    return <CanvasPrintView pages={parseCanvasDoc(html)} letterhead={letterhead} extraHtml={extraHtml} />;
  }

  const hasHeader = !!(letterhead.letterhead_logo || letterhead.letterhead_title);
  const hasFooter = !!letterhead.footer_text;
  return (
    <div style={{ background: "white", fontFamily: "Georgia, serif", fontSize: 13, lineHeight: 1.7, color: "#1E293B" }}>
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
      <div className="lh-print-body" style={{ padding: "24px 36px", minHeight: 400 }}>
        {editable
          ? <EditableBody html={html} onChange={onBodyChange ?? (() => {})} />
          : <div className="tiptap-preview-mairie" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />}
        {extraHtml && (
          <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid #CBD5E1" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              Références législatives et réglementaires
            </div>
            <div className="tiptap-preview-mairie" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(extraHtml) }} />
          </div>
        )}
      </div>
      {hasFooter && (
        <div className="lh-print-footer" style={{ padding: "10px 36px 14px", borderTop: "1px solid #CBD5E1", fontSize: 11, color: "#64748b", textAlign: "center", whiteSpace: "pre-line", background: "white" }}>
          {letterhead.footer_text}
        </div>
      )}
    </div>
  );
}

// ─── Courrier Modal ────────────────────────────────────────────────────────
// `mode` détermine le scénario d'usage :
//   - "general"               : génération libre (comportement historique)
//   - "pieces_complementaires" : préfiltrage sur la catégorie, panneau de
//     sélection des pièces actif, bouton "Émettre" qui appelle la route
//     d'émission. L'instructeur reste maître de la sélection — l'IA suggère
//     mais ne coche rien d'office si la préférence "sans IA" est activée.
export type CourrierMode = "general" | "pieces_complementaires";

export interface CourrierModalProps {
  dossier: DossierForCourrier;
  onClose: () => void;
  mode?: CourrierMode;
  // Pièces déjà déposées sur le dossier, requises en mode pieces_complementaires.
  availablePieces?: CourrierAvailablePiece[];
  // Pièces manquantes détectées par l'analyse de conformité IA. Affichées
  // comme suggestions repliables, jamais pré-cochées.
  aiSuggestedMissingPieces?: Array<{ code: string; nom: string }>;
  // Callback appelé après une émission réussie (le parent rafraîchit le dossier).
  onEmitted?: () => void;
  // INSEE de la commune du dossier. Sans lui, les modèles et l'en-tête sont lus
  // sur la commune principale du compte et non sur celle du dossier : un agent
  // multi-communes qui a créé ses modèles sous la commune sélectionnée ne les
  // retrouvait pas dans l'onglet Courriers. On relit donc sur le même périmètre
  // que la création (cf. TemplateManagerPanel).
  inseeCode?: string;
  // Courrier existant à rouvrir (brouillon à reprendre, ou courrier émis à
  // consulter). Quand fourni, le corps enregistré prime sur la substitution du
  // modèle et le modal s'ouvre en reprise plutôt qu'en création.
  initialCourrier?: {
    id: string;
    type: string;
    subject: string | null;
    body_snapshot: string | null;
    statut: "brouillon" | "envoye";
    articles_cites?: string[];
    pieces_jointes_ids?: Array<{ piece_id?: string; code_piece?: string; nom: string; raison?: string; manquante?: boolean }>;
    delivery_method?: string | null;
  };
}

const NO_AI_HINTS_KEY = "heureka_no_ai_hints";

export function CourrierModal({
  dossier, onClose,
  mode = "general",
  availablePieces = [],
  aiSuggestedMissingPieces = [],
  onEmitted,
  inseeCode,
  initialCourrier,
}: CourrierModalProps) {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<CourrierTemplate[]>([]);
  const [selected, setSelected] = useState<CourrierTemplate | null>(null);
  const [letterhead, setLetterhead] = useState<Letterhead>({ letterhead_logo: null, letterhead_title: null, letterhead_subtitle: null, letterhead_address: null, footer_text: null, signature_image: null, tampon_image: null });
  // Signataire désigné de la commune (nom + fonction + image signature/tampon)
  // pour le bloc signature. Les images priment sur celles de la commune.
  const [signataire, setSignataire] = useState<{ nom: string; fonction: string; signature_image: string | null; tampon_image: string | null } | null>(null);
  const [substitutedHtml, setSubstitutedHtml] = useState("");
  const [loading, setLoading] = useState(true);
  // Draggable signature & tampon
  const [sigPos, setSigPos] = useState<Pos>({ x: 60, y: 520 });
  const [tampPos, setTampPos] = useState<Pos>({ x: 340, y: 520 });
  const [showSig, setShowSig] = useState(false);
  const [showTamp, setShowTamp] = useState(false);
  // Legal mentions panel
  const [showMentions, setShowMentions] = useState(false);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [allMentions, setAllMentions] = useState<MentionRow[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set(initialCourrier?.articles_cites ?? []));
  const [courrierType, setCourrierType] = useState(mode === "pieces_complementaires" ? "pieces_complementaires" : "");
  const [insertedMentionsHtml, setInsertedMentionsHtml] = useState("");
  const [viewingArticle, setViewingArticle] = useState<MentionRow | null>(null);

  // ── Pièces complémentaires : état de sélection ──
  // Préférence persistée : un instructeur peut décider de ne pas voir les
  // suggestions IA (score par pièce + liste détectée comme manquante). On
  // ne change jamais le comportement métier — uniquement l'affichage.
  const [noAiHints, setNoAiHints] = useState<boolean>(() => {
    try { return localStorage.getItem(NO_AI_HINTS_KEY) === "1"; } catch { return false; }
  });
  const toggleNoAiHints = useCallback(() => {
    setNoAiHints((v) => {
      const next = !v;
      try { localStorage.setItem(NO_AI_HINTS_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  // Pré-sélection automatique : pièces déjà marquées par l'instructeur comme
  // "rejete" ou "complement_demande". Aucune pré-sélection automatique sur
  // base d'un score IA — l'instructeur est seul juge.
  const initialSelected = (): Set<string> => {
    const s = new Set<string>();
    for (const p of availablePieces) {
      if (p.instructeur_status === "rejete" || p.instructeur_status === "complement_demande") s.add(p.id);
    }
    return s;
  };
  // À la réouverture d'un courrier de pièces, on reconstruit la sélection depuis
  // les pièces enregistrées (sinon un ré-enregistrement écraserait la liste).
  const [selectedPieceIds, setSelectedPieceIds] = useState<Set<string>>(() => {
    if (initialCourrier?.pieces_jointes_ids) {
      return new Set(initialCourrier.pieces_jointes_ids.filter((p) => p.piece_id).map((p) => p.piece_id as string));
    }
    return initialSelected();
  });
  const [pieceReasons, setPieceReasons] = useState<Record<string, string>>(() => {
    const r: Record<string, string> = {};
    for (const p of initialCourrier?.pieces_jointes_ids ?? []) {
      if (p.piece_id && p.raison) r[p.piece_id] = p.raison;
    }
    return r;
  });
  const [extraPieces, setExtraPieces] = useState<Array<{ id: string; nom: string; code_piece: string; raison: string }>>(
    () => (initialCourrier?.pieces_jointes_ids ?? [])
      .filter((p) => !p.piece_id)
      .map((p, i) => ({ id: `seed-${i}`, nom: p.nom, code_piece: p.code_piece ?? "", raison: p.raison ?? "" })),
  );
  const [showPiecesPanel, setShowPiecesPanel] = useState<boolean>(mode === "pieces_complementaires");
  const [emitting, setEmitting] = useState(false);
  const [emitError, setEmitError] = useState<string | null>(null);
  const [emittedAt, setEmittedAt] = useState<string | null>(initialCourrier?.statut === "envoye" ? new Date().toISOString() : null);

  // ── Cycle de vie : brouillon (enregistré, modifiable) / envoyé (figé) ──
  // draftId non nul = le courrier existe en base. bodyOverride prime sur la
  // substitution du modèle dès qu'on rouvre un enregistrement ou qu'on édite
  // le texte à la main.
  const [draftId, setDraftId] = useState<string | null>(initialCourrier?.id ?? null);
  const [statut, setStatut] = useState<"brouillon" | "envoye" | null>(initialCourrier?.statut ?? null);
  const [bodyOverride, setBodyOverride] = useState<string | null>(initialCourrier?.body_snapshot ?? null);
  const [isEditingBody, setIsEditingBody] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isSent = statut === "envoye";

  // Synthèse des pièces sélectionnées (pour la prévisualisation HTML et la
  // bascule serveur). Ordre : pièces déposées sélectionnées, puis ajouts libres.
  const requestedPieces: PieceRequestSelection[] = [
    ...availablePieces.filter((p) => selectedPieceIds.has(p.id)).map((p) => ({
      piece_id: p.id,
      code_piece: p.code_piece ?? undefined,
      nom: p.nom,
      raison: pieceReasons[p.id]?.trim() || undefined,
      manquante: false,
    })),
    ...extraPieces.filter((e) => e.nom.trim().length > 0).map((e) => ({
      code_piece: e.code_piece.trim() || undefined,
      nom: e.nom.trim(),
      raison: e.raison.trim() || undefined,
      manquante: true,
    })),
  ];
  const piecesListHtml = renderPieceListHtmlClient(requestedPieces);

  // Corps réellement affiché / imprimé / enregistré. Un brouillon rouvert ou une
  // édition manuelle (bodyOverride) priment sur la substitution live du modèle.
  const effectiveBody = bodyOverride ?? substitutedHtml;
  const canEditBody = !isSent && !isCanvasBody(effectiveBody);

  const loadMentions = useCallback((ct: string) => {
    setMentionsLoading(true);
    const params = new URLSearchParams();
    if (dossier.type) params.set("type", dossier.type);
    if (ct) params.set("courrier_type", ct);
    api.get<MentionRow[]>(`/mairie/legal-mentions?${params}`)
      .then(rows => {
        setAllMentions(rows);
        // Auto-select suggested articles
        setSelectedRefs(new Set(rows.filter(r => r.suggested).map(r => r.article_ref)));
      })
      .catch(() => setAllMentions([]))
      .finally(() => setMentionsLoading(false));
  }, [dossier.type]);

  const handleToggleMentions = useCallback(() => {
    setShowMentions(v => {
      if (!v && allMentions.length === 0) loadMentions(courrierType);
      return !v;
    });
  }, [allMentions.length, loadMentions, courrierType]);

  // ── Phase 1.5 : pièces jointes GED (documents produits par l'instruction —
  //    ex. plan annoté) joignables au courrier de demande. ──
  const [gedDocs, setGedDocs] = useState<{ id: string; nom: string; type: string; url: string }[]>([]);
  const [attachDocIds, setAttachDocIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.get<{ id: string; nom: string; type: string; url: string }[]>(`/mairie/dossiers/${dossier.id}/documents`)
      .then(setGedDocs)
      .catch(() => setGedDocs([]));
  }, [dossier.id]);

  // ── Émission de la demande de pièces complémentaires ──
  // 1) POST courrier (snapshot + pièces + articles) — gère la transition de
  //    statut et le marquage des pièces côté serveur. 2) verrouille la modale
  //    (emittedAt) pour éviter une double émission. 3) notifie le parent
  //    pour qu'il rafraîchisse le dossier.
  // Type métier persisté (pilote le libellé dans l'historique des courriers).
  const courrierTypeForSave = mode === "pieces_complementaires"
    ? "pieces_complementaires"
    : (selected?.category ?? initialCourrier?.type ?? "general");

  // Enregistre / met à jour le courrier en BROUILLON — sans aucun effet métier
  // (le dossier ne bascule pas, les pièces ne sont pas marquées). Permet de
  // préparer un courrier et de décider plus tard quoi en faire.
  const handleSaveDraft = useCallback(async () => {
    if (saving || isSent) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        type: courrierTypeForSave,
        subject: selected?.name ?? null,
        body_snapshot: effectiveBody || null,
        articles_cites: Array.from(selectedRefs),
        pieces: mode === "pieces_complementaires" ? requestedPieces : [],
      };
      if (draftId) {
        await api.put(`/mairie/dossiers/${dossier.id}/courriers/${draftId}`, payload);
      } else {
        const row = await api.post<{ id: string }>(`/mairie/dossiers/${dossier.id}/courriers/drafts`, payload);
        setDraftId(row.id);
      }
      setStatut("brouillon");
      setSavedAt(new Date().toISOString());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }, [saving, isSent, courrierTypeForSave, selected, effectiveBody, selectedRefs, mode, requestedPieces, draftId, dossier.id]);

  // Envoie le courrier (brouillon → envoyé). Pour une demande de pièces,
  // déclenche les effets métier côté serveur (marquage des pièces, bascule du
  // dossier). Si un brouillon existe, on l'envoie via /send (le serveur réutilise
  // les pièces stockées) ; sinon émission directe (pièces) ou création+envoi.
  const handleSend = useCallback(async () => {
    if (emitting || isSent) return;
    setEmitting(true);
    setEmitError(null);
    try {
      if (mode === "pieces_complementaires" && !draftId) {
        if (requestedPieces.length === 0) { setEmitError("Sélectionnez au moins une pièce"); return; }
        await api.post(`/mairie/dossiers/${dossier.id}/courriers/pieces-complementaires`, {
          pieces: requestedPieces,
          articles_cites: Array.from(selectedRefs),
          body_snapshot: effectiveBody || null,
          subject: selected?.name ?? "Demande de pièces complémentaires",
          delivery_method: "print",
          attachment_document_ids: Array.from(attachDocIds),
        });
      } else {
        let id = draftId;
        if (!id) {
          const row = await api.post<{ id: string }>(`/mairie/dossiers/${dossier.id}/courriers/drafts`, {
            type: courrierTypeForSave,
            subject: selected?.name ?? null,
            body_snapshot: effectiveBody || null,
            articles_cites: Array.from(selectedRefs),
            pieces: mode === "pieces_complementaires" ? requestedPieces : [],
          });
          id = row.id;
          setDraftId(id);
        }
        await api.post(`/mairie/dossiers/${dossier.id}/courriers/${id}/send`, {
          body_snapshot: effectiveBody || null,
          delivery_method: "print",
          attachment_document_ids: Array.from(attachDocIds),
          // Pour une demande de pièces, on transmet la sélection à jour (le
          // serveur retombe sur l'état stocké si on n'envoie rien).
          ...(mode === "pieces_complementaires"
            ? { pieces: requestedPieces, articles_cites: Array.from(selectedRefs) }
            : {}),
        });
      }
      setEmittedAt(new Date().toISOString());
      setStatut("envoye");
      setIsEditingBody(false);
      onEmitted?.();
    } catch (e) {
      setEmitError(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setEmitting(false);
    }
  }, [emitting, isSent, mode, draftId, requestedPieces, selectedRefs, effectiveBody, selected, attachDocIds, courrierTypeForSave, dossier.id, onEmitted]);

  // Sélection d'un modèle par l'utilisateur : on repart de la substitution du
  // modèle (abandon d'une édition manuelle ou d'un corps rouvert).
  const selectTemplate = useCallback((tpl: CourrierTemplate) => {
    setSelected(tpl);
    setBodyOverride(null);
    setIsEditingBody(false);
  }, []);

  // Édition manuelle du corps : on capte le HTML et on invalide l'indicateur
  // "Enregistré ✓" (il y a de nouveau des modifications non sauvegardées).
  const handleBodyChange = useCallback((html: string) => {
    setBodyOverride(html);
    setSavedAt(null);
  }, []);

  const handleInsertMentions = useCallback(() => {
    if (selectedRefs.size === 0) return;
    const chosen = allMentions.filter(m => selectedRefs.has(m.article_ref));
    const html = chosen.map(m => `
      <div style="margin-bottom:12px;">
        <div style="font-weight:600;font-size:0.9em;margin-bottom:3px;">Art. ${m.article_ref} — ${m.article_title ?? ""}</div>
        <div style="font-size:0.85em;color:#374151;">${m.article_html ?? ""}</div>
      </div>`).join("");
    setInsertedMentionsHtml(html);
    setShowMentions(false);
  }, [allMentions, selectedRefs]);

  useEffect(() => {
    // Périmètre = commune DU DOSSIER, résolue côté serveur via dossier_id : ça
    // ne dépend ni de la commune principale du compte ni d'une table nom→INSEE
    // côté client. insee_code reste transmis comme secours (repli serveur).
    const params = new URLSearchParams({ dossier_id: dossier.id });
    if (inseeCode) params.set("insee_code", inseeCode);
    const q = `?${params.toString()}`;
    Promise.all([
      api.get<CourrierTemplate[]>(`/mairie/templates${q}`),
      api.get<Letterhead & { commune_configured?: boolean }>(`/mairie/commune-letterhead${q}`),
    ]).then(([tpls, lh]) => {
      setTemplates(tpls);
      setLetterhead(lh);
      // En reprise d'un courrier existant, on n'auto-sélectionne pas de modèle :
      // le corps enregistré (bodyOverride) prime sur la substitution.
      if (tpls.length > 0 && !initialCourrier) setSelected(tpls[0]!);
    }).catch((e) => {
      // Ne pas avaler l'erreur en silence : un échec serveur affichait
      // « Aucun modèle » à tort (indiscernable d'une liste vide légitime).
      console.error("[CourrierModal] chargement modèles/en-tête échoué", e);
    }).finally(() => setLoading(false));
  }, [dossier.id, inseeCode]);

  // Signataire de la commune pour le bloc signature. Hors décision (ex. pièces
  // manquantes), on retient le signataire délégué (arrêté de délégation), sinon
  // le maire, sinon le premier actif. La fonction libre prime sur le rôle.
  useEffect(() => {
    const commune = dossier.commune;
    if (!commune) { setSignataire(null); return; }
    type SignataireRow = {
      role: string; fonction: string | null; active?: boolean; delegation_arrete: string | null;
      signature_image: string | null; tampon_image: string | null;
      user: { prenom: string; nom: string } | null;
    };
    api.get<SignataireRow[]>(`/decisions/communes/${encodeURIComponent(commune)}/signataires`)
      .then((rows) => {
        const actifs = rows.filter((r) => r.active !== false);
        const chosen = actifs.find((r) => r.delegation_arrete) ?? actifs.find((r) => r.role === "maire") ?? actifs[0] ?? null;
        if (!chosen) { setSignataire(null); return; }
        setSignataire({
          nom: chosen.user ? `${chosen.user.prenom} ${chosen.user.nom}` : "",
          fonction: chosen.fonction || ROLE_LABELS[chosen.role] || chosen.role,
          signature_image: chosen.signature_image ?? null,
          tampon_image: chosen.tampon_image ?? null,
        });
      })
      .catch(() => setSignataire(null));
  }, [dossier.commune]);

  useEffect(() => {
    if (!selected || !user) return;
    const vars: Record<string, string> = {
      // Mairie
      nom_service: letterhead.letterhead_title ?? dossier.commune ?? "Commune",
      service_instructeur: letterhead.letterhead_subtitle ?? "—",
      coordonnees_mairie: letterhead.letterhead_address ?? "—",
      nom_agent: `${user.prenom} ${user.nom}`,
      agent_tel: user.telephone ?? "—",
      agent_email: user.email ?? "—",
      date_courrier: new Date().toLocaleDateString("fr-FR"),
      // Dossier
      numero_dossier: dossier.numero,
      type_dossier: TYPE_LABEL[dossier.type] ?? dossier.type,
      demandeur_nom: dossier.petitionnaire,
      demandeur_email: dossier.petitionnaire_email || "—",
      date_depot: fmtDate(dossier.date_depot),
      date_completude: fmtDate(dossier.date_completude),
      date_delivrance: fmtDate(dossier.date_delivrance),
      date_limite_instruction: fmtDate(dossier.echeance),
      // Terrain
      adresse_travaux: dossier.adresse ?? "—",
      commune: dossier.commune ?? "—",
      code_postal: dossier.code_postal ?? "—",
      parcelle: dossier.parcelle ?? "—",
      surface_plancher: dossier.surface_plancher ? `${dossier.surface_plancher} m²` : "—",
      // Projet
      description_projet: dossier.description || "—",
      // Signataire (délégué de la commune, cf. effet dédié)
      signataire_nom: signataire?.nom || "—",
      signataire_fonction: signataire?.fonction || "—",
      // Demande de pièces complémentaires : liste dynamique injectée
      // dans le corps du template via la variable {liste_pieces_a_completer}.
      liste_pieces_a_completer: piecesListHtml || "—",
      nombre_pieces_a_completer: String(requestedPieces.length),
    };
    setSubstitutedHtml(substituteVariables(selected.body, vars));
  }, [selected, letterhead, dossier, user, signataire, piecesListHtml, requestedPieces.length]);

  // Auto-sélection d'un template de catégorie "pieces_complementaires" quand
  // la modale est ouverte en mode demande de pièces — fallback : premier
  // template disponible.
  useEffect(() => {
    if (mode !== "pieces_complementaires" || selected || templates.length === 0 || initialCourrier) return;
    const preferred = templates.find((t) => t.category === "pieces_complementaires");
    setSelected(preferred ?? templates[0] ?? null);
  }, [mode, templates, selected, initialCourrier]);

  return (
    <div className="print-modal-overlay" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex" }}>
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

          /* L'encadré d'édition ne doit jamais apparaître à l'impression. */
          .courrier-editable-active { outline: none !important; }
        }
      `}</style>
      <div className="no-print-modal" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div className="print-modal-box" style={{ position: "relative", width: "90vw", maxWidth: 1100, maxHeight: "92vh", margin: "auto", background: "white", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
        {/* Header */}
        <div className="no-print-modal" style={{ padding: "12px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>Générer un courrier</span>
              {statut && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5,
                  color: isSent ? "#15803D" : "#B45309",
                  background: isSent ? "#DCFCE7" : "#FEF3C7",
                }}>
                  {isSent ? "Envoyé" : "Brouillon"}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{dossier.numero} — {dossier.petitionnaire}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* Signature toggle */}
            {(signataire?.signature_image || letterhead.signature_image) && (
              <button onClick={() => setShowSig(v => !v)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", border: `1px solid ${showSig ? "#4F46E5" : "#E2E8F0"}`, borderRadius: 7, background: showSig ? "#EEF2FF" : "white", color: showSig ? "#4F46E5" : "#64748b", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
                ✍️ Signature
              </button>
            )}
            {/* Tampon toggle */}
            {(signataire?.tampon_image || letterhead.tampon_image) && (
              <button onClick={() => setShowTamp(v => !v)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", border: `1px solid ${showTamp ? "#4F46E5" : "#E2E8F0"}`, borderRadius: 7, background: showTamp ? "#EEF2FF" : "white", color: showTamp ? "#4F46E5" : "#64748b", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
                🔵 Tampon
              </button>
            )}
            {/* Pièces à demander — visible uniquement en mode pieces_complementaires */}
            {mode === "pieces_complementaires" && (
              <button onClick={() => { setShowPiecesPanel((v) => !v); if (showMentions) setShowMentions(false); }}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", border: `1px solid ${showPiecesPanel ? "#B45309" : "#E2E8F0"}`, borderRadius: 7, background: showPiecesPanel ? "#FEF3C7" : "white", color: showPiecesPanel ? "#B45309" : "#64748b", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
                📎 Pièces à demander {requestedPieces.length > 0 ? `(${requestedPieces.length})` : ""}
              </button>
            )}
            {/* Mentions légales toggle */}
            <button onClick={() => { handleToggleMentions(); if (showPiecesPanel) setShowPiecesPanel(false); }}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", border: `1px solid ${showMentions ? "#0284C7" : "#E2E8F0"}`, borderRadius: 7, background: showMentions ? "#E0F2FE" : "white", color: showMentions ? "#0284C7" : "#64748b", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
              📜 Mentions légales
            </button>
            {/* Édition du texte (corps HTML uniquement, hors courrier déjà envoyé) */}
            {canEditBody && (
              <button onClick={() => setIsEditingBody((v) => !v)}
                title="Modifier le texte du courrier avant de l'enregistrer ou de l'envoyer"
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", border: `1px solid ${isEditingBody ? "#6366F1" : "#E2E8F0"}`, borderRadius: 7, background: isEditingBody ? "#EEF2FF" : "white", color: isEditingBody ? "#4F46E5" : "#64748b", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
                <Pencil size={13} /> {isEditingBody ? "Fin d'édition" : "Modifier le texte"}
              </button>
            )}
            <div style={{ width: 1, height: 20, background: "#E2E8F0" }} />
            {/* Enregistrer en brouillon — aucun effet métier */}
            {!isSent && (
              <button onClick={handleSaveDraft} disabled={saving}
                title="Enregistrer ce courrier en brouillon, sans l'envoyer ni modifier le dossier"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "white", color: saving ? "#94a3b8" : "#334155", border: "1px solid #CBD5E1", borderRadius: 8, cursor: saving ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}>
                <Save size={14} /> {saving ? "Enregistrement…" : (savedAt && !saveError ? "Enregistré ✓" : "Enregistrer le brouillon")}
              </button>
            )}
            <button onClick={() => window.print()}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "#0F172A", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Printer size={14} /> Imprimer / PDF
            </button>
            {mode === "pieces_complementaires" ? (
              <button
                onClick={handleSend}
                disabled={emitting || isSent || (!draftId && requestedPieces.length === 0)}
                title={isSent ? "Courrier déjà émis" : (!draftId && requestedPieces.length === 0) ? "Sélectionnez au moins une pièce" : "Émettre et basculer le dossier en incomplet"}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 16px",
                  background: (emitting || isSent || (!draftId && requestedPieces.length === 0)) ? "#E2E8F0" : "linear-gradient(135deg,#D97706,#F59E0B)",
                  color: (emitting || isSent || (!draftId && requestedPieces.length === 0)) ? "#94a3b8" : "white",
                  border: "none", borderRadius: 8,
                  cursor: (emitting || isSent || (!draftId && requestedPieces.length === 0)) ? "default" : "pointer",
                  fontSize: 13, fontWeight: 600,
                }}>
                {isSent ? "✓ Émise" : emitting ? "Émission…" : "Émettre la demande"}
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={emitting || isSent || (!selected && !draftId)}
                title={isSent ? "Courrier déjà envoyé" : "Marquer ce courrier comme envoyé (après impression / remise). Aucune transmission automatique."}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 16px",
                  background: (emitting || isSent || (!selected && !draftId)) ? "#E2E8F0" : "linear-gradient(135deg,#0F766E,#10B981)",
                  color: (emitting || isSent || (!selected && !draftId)) ? "#94a3b8" : "white",
                  border: "none", borderRadius: 8,
                  cursor: (emitting || isSent || (!selected && !draftId)) ? "default" : "pointer",
                  fontSize: 13, fontWeight: 600,
                }}>
                {isSent ? "✓ Envoyé" : emitting ? "Envoi…" : "Marquer comme envoyé"}
              </button>
            )}
            <button onClick={onClose} style={{ padding: 6, border: "1px solid #E2E8F0", borderRadius: 8, background: "white", cursor: "pointer", display: "flex" }}>
              <X size={16} color="#64748b" />
            </button>
          </div>
        </div>

        {emitError && (
          <div className="no-print-modal" style={{ padding: "8px 20px", background: "#FEE2E2", color: "#991B1B", fontSize: 12, borderBottom: "1px solid #FCA5A5" }}>
            {emitError}
          </div>
        )}
        {saveError && (
          <div className="no-print-modal" style={{ padding: "8px 20px", background: "#FEE2E2", color: "#991B1B", fontSize: 12, borderBottom: "1px solid #FCA5A5" }}>
            {saveError}
          </div>
        )}

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
                  <button key={tpl.id} onClick={() => selectTemplate(tpl)}
                    style={{ width: "100%", padding: "9px 12px", border: `2px solid ${isSelected ? cat.color : "#E2E8F0"}`, borderRadius: 8, background: isSelected ? cat.bg : "white", color: isSelected ? cat.color : "#374151", fontSize: 12, fontWeight: isSelected ? 700 : 400, cursor: "pointer", textAlign: "left", marginBottom: 6, transition: "all 0.1s" }}>
                    <div style={{ marginBottom: 2 }}>{tpl.name}</div>
                    <div style={{ fontSize: 10, opacity: 0.7 }}>{cat.label}</div>
                  </button>
                );
              })}
          </div>

          {/* Print preview */}
          <div className="print-area" style={{ flex: 1, overflowY: "auto" }}>
            {(selected || bodyOverride) ? (
              <div style={{ position: "relative" }}>
                <CourrierPrintPreview html={effectiveBody} letterhead={letterhead} extraHtml={insertedMentionsHtml || undefined} editable={isEditingBody} onBodyChange={handleBodyChange} />
                {/* Draggable signature */}
                {showSig && (signataire?.signature_image || letterhead.signature_image) && (
                  <DraggableStamp
                    src={signataire?.signature_image || letterhead.signature_image || ""}
                    pos={sigPos}
                    setPos={setSigPos}
                    caption={signataire?.nom || `${user?.prenom ?? ""} ${user?.nom ?? ""}`}
                    onHide={() => setShowSig(false)}
                  />
                )}
                {/* Draggable tampon */}
                {showTamp && (signataire?.tampon_image || letterhead.tampon_image) && (
                  <DraggableStamp
                    src={signataire?.tampon_image || letterhead.tampon_image || ""}
                    pos={tampPos}
                    setPos={setTampPos}
                    onHide={() => setShowTamp(false)}
                  />
                )}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", fontSize: 14 }}>
                Sélectionnez un modèle pour voir l'aperçu
              </div>
            )}
          </div>

          {/* Legal mentions panel (slide-in right column) */}
          {showMentions && (
            <div className="no-print-modal" style={{ width: 300, borderLeft: "1px solid #E2E8F0", display: "flex", flexDirection: "column", flexShrink: 0, background: "#FAFAFA" }}>
              {/* Panel header */}
              <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid #E2E8F0", background: "white" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", marginBottom: 8 }}>📜 Mentions légales recommandées</div>
                <select
                  value={courrierType}
                  onChange={(e) => {
                    const ct = e.target.value;
                    setCourrierType(ct);
                    loadMentions(ct);
                  }}
                  style={{ width: "100%", padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12, background: "white", color: "#374151", cursor: "pointer" }}>
                  <option value="">— Type de courrier —</option>
                  {COURRIER_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              {/* Article list */}
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {mentionsLoading ? (
                  <div style={{ padding: "20px 14px", color: "#94a3b8", fontSize: 12, textAlign: "center" }}>Chargement…</div>
                ) : allMentions.length === 0 ? (
                  <div style={{ padding: "20px 14px", color: "#94a3b8", fontSize: 12, textAlign: "center" }}>
                    <p style={{ margin: 0 }}>Aucune mention disponible.</p>
                    <p style={{ margin: "6px 0 0", fontSize: 11 }}>Créez des articles dans Administration → Configuration.</p>
                  </div>
                ) : allMentions.map(m => {
                  const checked = selectedRefs.has(m.article_ref);
                  return (
                    <div key={m.article_ref} style={{ padding: "8px 14px", borderBottom: "1px solid #F1F5F9", background: checked ? "#EFF6FF" : "transparent" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <input type="checkbox" checked={checked}
                          onChange={() => setSelectedRefs(prev => {
                            const next = new Set(prev);
                            if (next.has(m.article_ref)) next.delete(m.article_ref); else next.add(m.article_ref);
                            return next;
                          })}
                          style={{ marginTop: 3, flexShrink: 0, cursor: "pointer" }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#1E293B" }}>Art. {m.article_ref}</span>
                            {m.suggested && (
                              <span style={{ fontSize: 10, fontWeight: 600, color: "#0284C7", background: "#E0F2FE", borderRadius: 4, padding: "1px 5px" }}>Recommandé</span>
                            )}
                          </div>
                          {m.article_title && <div style={{ fontSize: 11, color: "#374151", marginTop: 1, lineHeight: 1.4, fontWeight: 500 }}>{m.article_title}</div>}
                          {m.contexte && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, lineHeight: 1.4 }}>{m.contexte}</div>}
                        </div>
                        <button onClick={() => setViewingArticle(m)}
                          title="Voir l'article"
                          style={{ flexShrink: 0, background: "none", border: "1px solid #E2E8F0", borderRadius: 5, cursor: "pointer", padding: "2px 7px", fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
                          Voir
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div style={{ padding: "10px 14px", borderTop: "1px solid #E2E8F0", background: "white" }}>
                {insertedMentionsHtml && (
                  <button onClick={() => { setInsertedMentionsHtml(""); setSelectedRefs(new Set()); }}
                    style={{ width: "100%", padding: "6px 12px", marginBottom: 6, border: "1px solid #FCA5A5", borderRadius: 7, background: "white", color: "#DC2626", fontSize: 11, cursor: "pointer", fontWeight: 500 }}>
                    ✕ Retirer les mentions insérées
                  </button>
                )}
                <button onClick={handleInsertMentions} disabled={selectedRefs.size === 0}
                  style={{ width: "100%", padding: "8px 12px", border: "none", borderRadius: 7, background: selectedRefs.size > 0 ? "#0F172A" : "#E2E8F0", color: selectedRefs.size > 0 ? "white" : "#94a3b8", fontSize: 12, fontWeight: 600, cursor: selectedRefs.size > 0 ? "pointer" : "default" }}>
                  Ajouter au courrier {selectedRefs.size > 0 ? `(${selectedRefs.size})` : ""}
                </button>
              </div>
            </div>
          )}

          {/* ── Pièces à demander (mode pieces_complementaires) ─────────── */}
          {mode === "pieces_complementaires" && showPiecesPanel && (
            <div className="no-print-modal" style={{ width: 320, borderLeft: "1px solid #E2E8F0", display: "flex", flexDirection: "column", flexShrink: 0, background: "#FAFAFA" }}>
              {/* Panel header */}
              <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid #E2E8F0", background: "white" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", marginBottom: 6 }}>📎 Pièces à demander au pétitionnaire</div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, lineHeight: 1.4 }}>
                  Sélectionnez les pièces déposées à compléter, et ajoutez les pièces absentes.
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#475569", cursor: "pointer" }}>
                  <input type="checkbox" checked={noAiHints} onChange={toggleNoAiHints} style={{ cursor: "pointer" }} />
                  Masquer les suggestions IA (préférence personnelle)
                </label>
              </div>

              {/* Available pieces */}
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {availablePieces.length === 0 ? (
                  <div style={{ padding: "16px 14px", color: "#94a3b8", fontSize: 12, textAlign: "center" }}>Aucune pièce déposée sur ce dossier.</div>
                ) : (
                  <>
                    <div style={{ padding: "4px 14px 6px", fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      Pièces déposées ({availablePieces.length})
                    </div>
                    {availablePieces.map((p) => {
                      const checked = selectedPieceIds.has(p.id);
                      const score = p.ia_score;
                      const scoreLabel = score && !noAiHints ? (
                        <span title={`Avis IA : ${score}`} style={{
                          fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 4, marginLeft: 6,
                          color: score === "non_conforme" || score === "incomplet" ? "#B91C1C" : score === "acceptable" ? "#B45309" : "#15803D",
                          background: score === "non_conforme" || score === "incomplet" ? "#FEE2E2" : score === "acceptable" ? "#FEF3C7" : "#DCFCE7",
                        }}>IA: {score.replace("_", " ")}</span>
                      ) : null;
                      const statusBadge = p.instructeur_status === "valide"
                        ? <span style={{ fontSize: 9.5, fontWeight: 600, color: "#15803D", marginLeft: 6 }}>✓ validée</span>
                        : p.instructeur_status === "rejete"
                          ? <span style={{ fontSize: 9.5, fontWeight: 600, color: "#B91C1C", marginLeft: 6 }}>✕ rejetée</span>
                          : p.instructeur_status === "complement_demande"
                            ? <span style={{ fontSize: 9.5, fontWeight: 600, color: "#B45309", marginLeft: 6 }}>↻ déjà demandée</span>
                            : null;
                      return (
                        <div key={p.id} style={{ padding: "6px 14px", borderBottom: "1px solid #F1F5F9", background: checked ? "#FEF3C7" : "transparent" }}>
                          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                            <input type="checkbox" checked={checked}
                              onChange={() => setSelectedPieceIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                                return next;
                              })}
                              style={{ marginTop: 3, flexShrink: 0, cursor: "pointer" }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                                {p.code_piece && <span style={{ fontFamily: "monospace", fontSize: 10.5, color: "#64748b" }}>{p.code_piece}</span>}
                                <span style={{ fontSize: 12, color: "#1E293B", fontWeight: 500 }}>{p.nom}</span>
                                {statusBadge}
                                {scoreLabel}
                              </div>
                              {checked && (
                                <input
                                  type="text"
                                  placeholder="Raison (facultatif) — ex. plan illisible"
                                  value={pieceReasons[p.id] ?? ""}
                                  onChange={(e) => setPieceReasons((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                  onClick={(e) => e.preventDefault()}
                                  style={{ width: "100%", marginTop: 6, padding: "4px 8px", border: "1px solid #E2E8F0", borderRadius: 5, fontSize: 11, color: "#374151" }}
                                />
                              )}
                            </div>
                          </label>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* Suggestions IA — repliable et masquable par préférence */}
                {!noAiHints && aiSuggestedMissingPieces.length > 0 && (
                  <div style={{ padding: "12px 14px 4px" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
                      Suggestions IA — pièces détectées comme absentes
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
                      Cliquez pour ajouter à la liste libre.
                    </div>
                    {aiSuggestedMissingPieces.map((s) => {
                      const alreadyAdded = extraPieces.some((e) => e.code_piece === s.code || e.nom === s.nom);
                      return (
                        <button
                          key={s.code}
                          disabled={alreadyAdded}
                          onClick={() => setExtraPieces((prev) => [...prev, { id: Math.random().toString(36).slice(2), code_piece: s.code, nom: s.nom, raison: "" }])}
                          style={{
                            display: "block", width: "100%", textAlign: "left", padding: "5px 8px",
                            background: alreadyAdded ? "#F1F5F9" : "white", border: "1px solid #E2E8F0",
                            borderRadius: 6, marginBottom: 4, fontSize: 11.5, color: alreadyAdded ? "#94a3b8" : "#374151",
                            cursor: alreadyAdded ? "default" : "pointer",
                          }}>
                          <span style={{ fontFamily: "monospace", color: "#94a3b8", marginRight: 6 }}>{s.code}</span>{s.nom}{alreadyAdded ? " ✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Pièces libres */}
                <div style={{ padding: "12px 14px 4px" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
                    Pièces à fournir ({extraPieces.length})
                  </div>
                  {extraPieces.map((e, idx) => (
                    <div key={e.id} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8, padding: 8, border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 6 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          type="text"
                          placeholder="Code (ex. PC2)"
                          value={e.code_piece}
                          onChange={(ev) => setExtraPieces((prev) => prev.map((x, i) => i === idx ? { ...x, code_piece: ev.target.value } : x))}
                          style={{ width: 80, padding: "4px 6px", border: "1px solid #FDE68A", borderRadius: 5, fontSize: 11, fontFamily: "monospace" }}
                        />
                        <input
                          type="text"
                          placeholder="Nom de la pièce"
                          value={e.nom}
                          onChange={(ev) => setExtraPieces((prev) => prev.map((x, i) => i === idx ? { ...x, nom: ev.target.value } : x))}
                          style={{ flex: 1, padding: "4px 6px", border: "1px solid #FDE68A", borderRadius: 5, fontSize: 11 }}
                        />
                        <button onClick={() => setExtraPieces((prev) => prev.filter((_, i) => i !== idx))}
                          style={{ padding: "2px 8px", background: "white", border: "1px solid #FCA5A5", color: "#B91C1C", borderRadius: 5, fontSize: 11, cursor: "pointer" }}>×</button>
                      </div>
                      <input
                        type="text"
                        placeholder="Raison ou précision (facultatif)"
                        value={e.raison}
                        onChange={(ev) => setExtraPieces((prev) => prev.map((x, i) => i === idx ? { ...x, raison: ev.target.value } : x))}
                        style={{ width: "100%", padding: "4px 6px", border: "1px solid #FDE68A", borderRadius: 5, fontSize: 11 }}
                      />
                    </div>
                  ))}
                  <button onClick={() => setExtraPieces((prev) => [...prev, { id: Math.random().toString(36).slice(2), code_piece: "", nom: "", raison: "" }])}
                    style={{ width: "100%", padding: "6px 8px", background: "white", border: "1px dashed #CBD5E1", borderRadius: 6, fontSize: 11.5, color: "#64748b", cursor: "pointer" }}>
                    + Ajouter une pièce
                  </button>
                </div>

                {/* Pièces jointes GED — documents produits par l'instruction
                    (ex. plan annoté) à joindre au courrier envoyé au citoyen. */}
                <div style={{ padding: "12px 14px 4px", borderTop: "1px solid #EEF2F7" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
                    Documents joints (GED) {attachDocIds.size > 0 ? `(${attachDocIds.size})` : ""}
                  </div>
                  {gedDocs.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>
                      Aucun document dans la GED. Annotez une pièce (bouton « Annoter / Envoyer » dans l'onglet Pièces) et enregistrez-la pour pouvoir la joindre ici.
                    </div>
                  ) : (
                    gedDocs.map((d) => {
                      const checked = attachDocIds.has(d.id);
                      return (
                        <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", borderRadius: 6, cursor: "pointer", background: checked ? "#EEF2FF" : "transparent" }}>
                          <input type="checkbox" checked={checked}
                            onChange={() => setAttachDocIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                              return next;
                            })}
                            style={{ cursor: "pointer", flexShrink: 0 }} />
                          <span style={{ fontSize: 11.5, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {d.nom}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div style={{ padding: "10px 14px", borderTop: "1px solid #E2E8F0", background: "white", fontSize: 11, color: "#64748b" }}>
                {requestedPieces.length} pièce{requestedPieces.length > 1 ? "s" : ""} sera{requestedPieces.length > 1 ? "ont" : ""} listée{requestedPieces.length > 1 ? "s" : ""} dans le courrier (variable <code style={{ fontSize: 10, background: "#F1F5F9", padding: "1px 4px", borderRadius: 3 }}>{"{liste_pieces_a_completer}"}</code>).
              </div>
            </div>
          )}
        </div>

        {/* Article viewer modal */}
        {viewingArticle && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => setViewingArticle(null)}>
            <div style={{ background: "white", borderRadius: 12, padding: 24, width: "min(560px, 90vw)", maxHeight: "70vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.2)" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Art. {viewingArticle.article_ref}</div>
                  {viewingArticle.article_title && <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{viewingArticle.article_title}</div>}
                </div>
                <button onClick={() => setViewingArticle(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "#94a3b8", lineHeight: 1 }}>×</button>
              </div>
              {viewingArticle.contexte && (
                <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#0369A1" }}>
                  {viewingArticle.contexte}
                </div>
              )}
              {viewingArticle.article_html
                ? <div style={{ fontSize: 13, lineHeight: 1.7, color: "#374151" }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(viewingArticle.article_html) }} />
                : <div style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>Texte non renseigné. Ajoutez-le dans Administration → Configuration.</div>
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Block content editor (contentEditable via ref to avoid cursor reset) ────
function BlockEditor({ block, isEditing, onStartEdit, onContentChange, onEndEdit }: {
  block: CanvasBlock; isEditing: boolean;
  onStartEdit: () => void;
  onContentChange: (html: string) => void;
  onEndEdit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = DOMPurify.sanitize(block.html);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Only reset DOM from state when not editing (prevents overwriting in-progress text)
  useEffect(() => {
    if (!isEditing && ref.current) ref.current.innerHTML = DOMPurify.sanitize(block.html);
  }, [block.html, isEditing]);

  const justifyContent = block.verticalAlign === "middle" ? "center" : block.verticalAlign === "bottom" ? "flex-end" : "flex-start";

  return (
    <div
      style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent, background: BLOCK_BG[block.background], border: BLOCK_BORDER[block.borderStyle], boxSizing: "border-box", cursor: isEditing ? "text" : "default" }}
      onDoubleClick={() => { if (!isEditing) onStartEdit(); }}
    >
      <div
        ref={ref}
        contentEditable={isEditing}
        suppressContentEditableWarning
        onInput={(e) => { if (isEditing) onContentChange(e.currentTarget.innerHTML); }}
        onBlur={() => { if (isEditing) onEndEdit(); }}
        style={{ width: "100%", padding: block.padding, boxSizing: "border-box", fontSize: block.fontSize, lineHeight: 1.6, fontFamily: block.fontFamily === "serif" ? "Georgia, serif" : "system-ui, sans-serif", textAlign: block.textAlign, outline: "none", cursor: isEditing ? "text" : "default", wordBreak: "break-word", color: "#1E293B" }}
      />
    </div>
  );
}

// ─── Canvas template editor (A4 multi-page) ───────────────────────────────────
function CanvasTemplateEditor({ editing, setEditing, letterhead, handleSave, saving, saveError }: {
  editing: Partial<CourrierTemplate>;
  setEditing: Dispatch<SetStateAction<Partial<CourrierTemplate> | null>>;
  letterhead: Letterhead;
  handleSave: () => Promise<void>;
  saving: boolean;
  saveError: string | null;
}) {
  const [pages, setPages] = useState<CanvasPage[]>(() => parseCanvasDoc(editing.body ?? ""));
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const hasLH = !!(letterhead.letterhead_logo || letterhead.letterhead_title);
  const hH = hasLH ? HDR_H : 0;
  const contentH = PAGE_H - hH - FTR_H;

  useEffect(() => {
    setEditing(prev => prev ? { ...prev, body: serializeDoc(pages) } : prev);
  }, [pages, setEditing]);

  const activePage = pages[Math.min(activePageIdx, pages.length - 1)];
  const selectedBlock = activePage?.blocks.find(b => b.id === selectedId) ?? null;

  const addPage = () => {
    const newPage: CanvasPage = { id: Math.random().toString(36).slice(2), blocks: [] };
    setPages(prev => [...prev, newPage]);
    setActivePageIdx(pages.length);
    setSelectedId(null); setEditingId(null);
  };

  const addBlock = () => {
    if (!activePage) return;
    const nb: CanvasBlock = {
      id: Math.random().toString(36).slice(2),
      x: CANVAS_MARGIN,
      y: activePage.blocks.length > 0 ? Math.max(...activePage.blocks.map(b => b.y + b.h)) + 10 : 10,
      w: PAGE_W - CANVAS_MARGIN * 2, h: 120,
      html: "", fontSize: 13, fontFamily: "serif",
      textAlign: "left", verticalAlign: "top", borderStyle: "none", background: "transparent", padding: 8,
    };
    setPages(prev => prev.map((p, i) => i === activePageIdx ? { ...p, blocks: [...p.blocks, nb] } : p));
    setSelectedId(nb.id);
  };

  const updateBlock = (id: string, patch: Partial<CanvasBlock>) =>
    setPages(prev => prev.map((p, i) => i === activePageIdx
      ? { ...p, blocks: p.blocks.map(b => b.id === id ? { ...b, ...patch } : b) } : p));

  const deleteBlock = (id: string) => {
    setPages(prev => prev.map((p, i) => i === activePageIdx ? { ...p, blocks: p.blocks.filter(b => b.id !== id) } : p));
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) setEditingId(null);
  };

  const deletePage = (idx: number) => {
    if (pages.length <= 1) return;
    setPages(prev => prev.filter((_, i) => i !== idx));
    setActivePageIdx(prev => Math.min(prev, pages.length - 2));
    setSelectedId(null); setEditingId(null);
  };

  const insertVariable = (varName: string) => {
    if (!editingId) return;
    // execCommand insertHTML properly resets the browser's "pending format" after the span,
    // preventing Chrome's sticky-formatting from carrying the variable's color to subsequent text.
    document.execCommand(
      "insertHTML", false,
      `<span data-variable="${varName}" style="background:#EEF2FF;color:#4F46E5;border-radius:3px;padding:1px 5px;font-size:0.85em;font-weight:500;">${varName}</span>&#8203;`
    );
    // Save the updated HTML
    const ce = document.activeElement as HTMLElement;
    if (ce?.isContentEditable) updateBlock(editingId, { html: ce.innerHTML });
  };

  // Thumbnail scale helpers
  const THUMB_W = 68; const THUMB_H = 96;
  const thumbHdrH = Math.round(hH * THUMB_H / PAGE_H);
  const thumbFtrH = Math.round(FTR_H * THUMB_H / PAGE_H);
  const thumbContentH = THUMB_H - thumbHdrH - thumbFtrH;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "#F1F5F9", display: "flex", flexDirection: "column" }}>
      {/* ── Top bar ── */}
      <div style={{ height: 56, background: "white", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 10, padding: "0 20px", flexShrink: 0 }}>
        <button onClick={() => setEditing(null)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", border: "1px solid #E2E8F0", borderRadius: 7, background: "white", cursor: "pointer", fontSize: 12, color: "#64748b" }}>
          <ArrowLeft size={13} /> Retour
        </button>
        <div style={{ width: 1, height: 20, background: "#E2E8F0" }} />
        <input value={editing.name ?? ""} onChange={e => setEditing(p => p ? { ...p, name: e.target.value } : p)}
          placeholder="Nom du modèle…"
          style={{ flex: 1, maxWidth: 280, padding: "6px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none" }} />
        <select value={editing.category ?? "general"} onChange={e => setEditing(p => p ? { ...p, category: e.target.value } : p)}
          style={{ padding: "6px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, background: "white", outline: "none", cursor: "pointer" }}>
          {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={addBlock}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 13px", border: "1px solid #E2E8F0", borderRadius: 7, background: "white", cursor: "pointer", fontSize: 12, color: "#374151", fontWeight: 500 }}>
          <Plus size={13} /> Ajouter un bloc
        </button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {saveError && <span style={{ fontSize: 11, color: "#DC2626" }}>{saveError}</span>}
          <button onClick={() => void handleSave()} disabled={saving}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            <Save size={13} /> {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Page list */}
        <div style={{ width: 100, background: "#E8EDF2", borderRight: "1px solid #CBD5E1", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 8px" }}>
            {pages.map((page, i) => (
              <div key={page.id} style={{ marginBottom: 8, textAlign: "center", position: "relative" }}>
                <div onClick={() => { setActivePageIdx(i); setSelectedId(null); setEditingId(null); }}
                  style={{ width: THUMB_W, height: THUMB_H, background: "white", margin: "0 auto 4px", border: `1.5px solid ${i === activePageIdx ? "#4F46E5" : "#CBD5E1"}`, borderRadius: 2, position: "relative", overflow: "hidden", boxShadow: i === activePageIdx ? "0 0 0 2px #C7D2FE" : "none", cursor: "pointer" }}>
                  {hasLH && <div style={{ height: thumbHdrH, background: "#F1F5F9", borderBottom: "1px solid #CBD5E1" }} />}
                  {page.blocks.map(b => (
                    <div key={b.id} style={{
                      position: "absolute",
                      left: Math.round(b.x * THUMB_W / PAGE_W),
                      top: thumbHdrH + Math.round(b.y * thumbContentH / contentH),
                      width: Math.max(2, Math.round(b.w * THUMB_W / PAGE_W)),
                      height: Math.max(2, Math.round(b.h * thumbContentH / contentH)),
                      background: "#CBD5E1", borderRadius: 1,
                    }} />
                  ))}
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: thumbFtrH, background: "#F1F5F9", borderTop: "1px solid #CBD5E1" }} />
                </div>
                {pages.length > 1 && (
                  <button onClick={() => deletePage(i)} title="Supprimer la page"
                    style={{ position: "absolute", top: -4, right: 4, width: 16, height: 16, borderRadius: "50%", background: "#EF4444", border: "none", cursor: "pointer", color: "white", fontSize: 11, lineHeight: "16px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5 }}>
                    ×
                  </button>
                )}
                <span style={{ fontSize: 10, fontWeight: i === activePageIdx ? 700 : 400, color: i === activePageIdx ? "#4F46E5" : "#64748b" }}>{i + 1}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "8px", borderTop: "1px solid #CBD5E1" }}>
            <button onClick={addPage}
              style={{ width: "100%", padding: "6px 0", border: "1.5px dashed #94a3b8", borderRadius: 6, background: "white", cursor: "pointer", fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
              <Plus size={11} /> Page
            </button>
          </div>
        </div>

        {/* Canvas scroll area */}
        <div
          style={{ flex: 1, overflow: "auto", padding: "32px 40px", display: "flex", alignItems: "flex-start", justifyContent: "center" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setSelectedId(null); setEditingId(null); } }}
        >
          {activePage && (
            <div style={{ position: "relative", width: PAGE_W, height: PAGE_H, background: "white", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", borderRadius: 2, flexShrink: 0 }}>
              {/* Header zone */}
              {hasLH && (
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: hH, zIndex: 2, pointerEvents: "none", borderBottom: "2px solid #1E293B", display: "flex", alignItems: "center", padding: "0 20px", gap: 14, background: "white", overflow: "hidden" }}>
                  {letterhead.letterhead_logo && <img src={letterhead.letterhead_logo} alt="" style={{ height: 44, width: "auto", objectFit: "contain", flexShrink: 0 }} />}
                  <div>
                    {letterhead.letterhead_title && <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>{letterhead.letterhead_title}</div>}
                    {letterhead.letterhead_subtitle && <div style={{ fontSize: 12, color: "#374151" }}>{letterhead.letterhead_subtitle}</div>}
                    {letterhead.letterhead_address && <div style={{ fontSize: 11, color: "#64748b", marginTop: 1, whiteSpace: "pre-line" }}>{letterhead.letterhead_address}</div>}
                  </div>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#CBD5E1", fontStyle: "italic" }}>En-tête commune</span>
                </div>
              )}

              {/* Content zone */}
              <div
                style={{ position: "absolute", top: hH, left: 0, right: 0, bottom: FTR_H }}
                onMouseDown={(e) => { if (e.target === e.currentTarget) { setSelectedId(null); setEditingId(null); } }}
              >
                <div style={{ position: "absolute", top: 0, bottom: 0, left: CANVAS_MARGIN, borderLeft: "1px dashed #BFDBFE", pointerEvents: "none" }} />
                <div style={{ position: "absolute", top: 0, bottom: 0, right: CANVAS_MARGIN, borderRight: "1px dashed #BFDBFE", pointerEvents: "none" }} />

                {activePage.blocks.length === 0 && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#CBD5E1", pointerEvents: "none" }}>
                    <Plus size={28} color="#CBD5E1" />
                    <span style={{ fontSize: 13 }}>Cliquez sur "Ajouter un bloc" pour commencer</span>
                  </div>
                )}

                {activePage.blocks.map(block => (
                  <Rnd key={block.id}
                    position={{ x: block.x, y: block.y }}
                    size={{ width: block.w, height: block.h }}
                    bounds="parent"
                    disableDragging={editingId === block.id}
                    enableResizing={selectedId === block.id && editingId !== block.id
                      ? { top: true, right: true, bottom: true, left: true, topRight: true, bottomRight: true, bottomLeft: true, topLeft: true }
                      : false}
                    onDragStop={(_, d) => updateBlock(block.id, { x: d.x, y: d.y })}
                    onResizeStop={(_, __, ref, ___, pos) => updateBlock(block.id, { w: parseInt(ref.style.width), h: parseInt(ref.style.height), x: pos.x, y: pos.y })}
                    style={{ zIndex: selectedId === block.id ? 10 : 1 }}
                    onMouseDown={() => { if (editingId !== block.id) setSelectedId(block.id); }}
                  >
                    <div style={{ width: "100%", height: "100%", outline: selectedId === block.id ? (editingId === block.id ? "2px solid #4F46E5" : "1.5px solid #6366F1") : "1px dashed #E2E8F0" }}>
                      <BlockEditor block={block} isEditing={editingId === block.id}
                        onStartEdit={() => { setSelectedId(block.id); setEditingId(block.id); }}
                        onContentChange={(html) => updateBlock(block.id, { html })}
                        onEndEdit={() => setEditingId(null)}
                      />
                    </div>
                  </Rnd>
                ))}
              </div>

              {/* Footer zone */}
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: FTR_H, borderTop: "1px solid #CBD5E1", display: "flex", alignItems: "center", padding: "0 20px", background: "white", zIndex: 2, pointerEvents: "none" }}>
                <span style={{ fontSize: 10, color: "#64748b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{letterhead.footer_text ?? ""}</span>
                <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{activePageIdx + 1} / {pages.length}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div style={{ width: 256, background: "white", borderLeft: "1px solid #E2E8F0", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
          <div style={{ borderBottom: "1px solid #E2E8F0", padding: "12px 14px", overflowY: "auto", maxHeight: "60vh" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#0F172A", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
              {selectedBlock ? "Bloc sélectionné" : "Blocs"}
            </div>
            {selectedBlock ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Font size */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 3 }}>Taille du texte</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="range" min={9} max={24} value={selectedBlock.fontSize}
                      onChange={e => updateBlock(selectedBlock.id, { fontSize: Number(e.target.value) })} style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: "#64748b", minWidth: 20, textAlign: "right" }}>{selectedBlock.fontSize}</span>
                  </div>
                </div>
                {/* Font family */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 3 }}>Police</label>
                  <div style={{ display: "flex", gap: 5 }}>
                    {(["serif", "sans"] as const).map(f => (
                      <button key={f} onClick={() => updateBlock(selectedBlock.id, { fontFamily: f })}
                        style={{ flex: 1, padding: "4px 0", border: `1.5px solid ${selectedBlock.fontFamily === f ? "#4F46E5" : "#E2E8F0"}`, borderRadius: 5, background: selectedBlock.fontFamily === f ? "#EEF2FF" : "white", cursor: "pointer", fontSize: f === "serif" ? 12 : 11, fontFamily: f === "serif" ? "Georgia, serif" : "system-ui", color: selectedBlock.fontFamily === f ? "#4F46E5" : "#374151", fontWeight: selectedBlock.fontFamily === f ? 700 : 400 }}>
                        {f === "serif" ? "Serif" : "Sans"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Horizontal align */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 3 }}>Alignement horizontal</label>
                  <div style={{ display: "flex", gap: 5 }}>
                    {([["left", "G"], ["center", "C"], ["right", "D"]] as const).map(([a, lbl]) => (
                      <button key={a} onClick={() => updateBlock(selectedBlock.id, { textAlign: a })}
                        style={{ flex: 1, padding: "4px 0", border: `1.5px solid ${selectedBlock.textAlign === a ? "#4F46E5" : "#E2E8F0"}`, borderRadius: 5, background: selectedBlock.textAlign === a ? "#EEF2FF" : "white", cursor: "pointer", fontSize: 11, color: selectedBlock.textAlign === a ? "#4F46E5" : "#374151", fontWeight: selectedBlock.textAlign === a ? 700 : 400 }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Vertical align */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 3 }}>Alignement vertical</label>
                  <div style={{ display: "flex", gap: 5 }}>
                    {([["top", "↑ Haut"], ["middle", "↕ Milieu"], ["bottom", "↓ Bas"]] as const).map(([a, lbl]) => (
                      <button key={a} onClick={() => updateBlock(selectedBlock.id, { verticalAlign: a })}
                        style={{ flex: 1, padding: "4px 2px", border: `1.5px solid ${selectedBlock.verticalAlign === a ? "#4F46E5" : "#E2E8F0"}`, borderRadius: 5, background: selectedBlock.verticalAlign === a ? "#EEF2FF" : "white", cursor: "pointer", fontSize: 10, color: selectedBlock.verticalAlign === a ? "#4F46E5" : "#374151", fontWeight: selectedBlock.verticalAlign === a ? 700 : 400 }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Border */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 3 }}>Bordure</label>
                  <select value={selectedBlock.borderStyle}
                    onChange={e => updateBlock(selectedBlock.id, { borderStyle: e.target.value as CanvasBlock["borderStyle"] })}
                    style={{ width: "100%", padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 5, fontSize: 11, background: "white", outline: "none", cursor: "pointer" }}>
                    <option value="none">Aucune</option>
                    <option value="light">Fine</option>
                    <option value="medium">Moyenne</option>
                    <option value="dashed">Pointillée</option>
                  </select>
                </div>
                {/* Background */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 3 }}>Fond</label>
                  <div style={{ display: "flex", gap: 5 }}>
                    {(["transparent", "white", "blue", "yellow", "green"] as const).map(bg => (
                      <button key={bg} onClick={() => updateBlock(selectedBlock.id, { background: bg })} title={bg}
                        style={{ width: 24, height: 24, border: `2px solid ${selectedBlock.background === bg ? "#4F46E5" : "#E2E8F0"}`, borderRadius: 4, background: BLOCK_BG[bg], cursor: "pointer", padding: 0 }} />
                    ))}
                  </div>
                </div>
                {/* Delete */}
                <button onClick={() => deleteBlock(selectedBlock.id)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "6px 0", border: "1px solid #FEE2E2", borderRadius: 7, background: "white", cursor: "pointer", fontSize: 11, color: "#DC2626", fontWeight: 500, marginTop: 2 }}>
                  <Trash2 size={12} /> Supprimer ce bloc
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 11, color: "#94a3b8", margin: 0, lineHeight: 1.5 }}>
                Cliquez sur un bloc pour le sélectionner. Double-cliquez pour éditer son texte.
              </p>
            )}
          </div>

          {/* Variables */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#0F172A", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              Variables
              {editingId && <span style={{ fontSize: 10, fontWeight: 400, color: "#4F46E5", marginLeft: 6, textTransform: "none" }}>cliquez pour insérer</span>}
            </div>
            {TEMPLATE_VARIABLES.map(group => (
              <div key={group.group} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{group.group}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {group.vars.map(v => (
                    <button key={v.name}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertVariable(v.name)}
                      disabled={!editingId}
                      style={{ padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 5, background: editingId ? "#FAFAFA" : "white", cursor: editingId ? "pointer" : "default", fontSize: 11, textAlign: "left", color: "#374151", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: editingId ? 1 : 0.55 }}>
                      <span>{v.label}</span>
                      <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>{`{{${v.name}}}`}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── Template Manager Panel ────────────────────────────────────────────────
export function TemplateManagerPanel({ inseeCode }: { inseeCode?: string }) {
  const [templates, setTemplates] = useState<CourrierTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<CourrierTemplate> | null>(null);
  const [saving, setSaving] = useState(false);
  const [letterhead, setLetterhead] = useState<Letterhead>({
    letterhead_logo: null, letterhead_title: null, letterhead_subtitle: null,
    letterhead_address: null, footer_text: null, signature_image: null, tampon_image: null,
  });

  // Commune sélectionnée dans l'interface : on la transmet pour que les modèles
  // et l'en-tête correspondent au sélecteur, et non à la commune principale du
  // compte (sinon un agent multi-communes retombe toujours sur la même).
  const q = inseeCode ? `?insee_code=${encodeURIComponent(inseeCode)}` : "";

  const load = useCallback(async () => {
    const rows = await api.get<CourrierTemplate[]>(`/mairie/templates${q}`);
    setTemplates(rows);
    setLoading(false);
  }, [q]);

  useEffect(() => { setLoading(true); load().catch(() => setLoading(false)); }, [load]);
  useEffect(() => {
    api.get<Letterhead & { commune_configured?: boolean }>(`/mairie/commune-letterhead${q}`)
      .then(lh => { if (lh.commune_configured !== false) setLetterhead(lh); })
      .catch(() => {});
  }, [q]);

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing.id) {
        await api.put(`/mairie/templates/${editing.id}${q}`, { name: editing.name, category: editing.category ?? "general", body: editing.body ?? "" });
      } else {
        await api.post(`/mairie/templates${q}`, { name: editing.name, category: editing.category ?? "general", body: editing.body ?? "" });
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
    await api.delete(`/mairie/templates/${id}${q}`);
    await load();
  };

  if (editing !== null) {
    return (
      <CanvasTemplateEditor
        editing={editing}
        setEditing={setEditing}
        letterhead={letterhead}
        handleSave={handleSave}
        saving={saving}
        saveError={saveError}
      />
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
export function CommuneLetterheadPanel({ inseeCode }: { inseeCode?: string }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    letterhead_logo: "", letterhead_title: "", letterhead_subtitle: "",
    letterhead_address: "", footer_text: "", signature_image: "", tampon_image: "",
  });
  const [communeLogoUrl, setCommuneLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [communeConfigured, setCommuneConfigured] = useState<boolean | null>(null);

  // En-tête de la commune sélectionnée dans le sélecteur, pas de la commune
  // principale du compte (cf. TemplateManagerPanel).
  const q = inseeCode ? `?insee_code=${encodeURIComponent(inseeCode)}` : "";

  useEffect(() => {
    setLoading(true);
    api.get<typeof form & { commune_configured?: boolean; commune_logo_url?: string | null }>(`/mairie/commune-letterhead${q}`).then(lh => {
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
        tampon_image: (lh as typeof lh & { tampon_image?: string }).tampon_image ?? "",
      });
    }).catch(() => { setCommuneConfigured(false); }).finally(() => setLoading(false));
  }, [user, q]);

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
      await api.put(`/mairie/commune-letterhead${q}`, {
        letterhead_logo: form.letterhead_logo || null,
        letterhead_title: form.letterhead_title || null,
        letterhead_subtitle: form.letterhead_subtitle || null,
        letterhead_address: form.letterhead_address || null,
        footer_text: form.footer_text || null,
        signature_image: form.signature_image || null,
        tampon_image: form.tampon_image || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const imageUpload = (label: string, current: string, fieldName: "letterhead_logo" | "signature_image" | "tampon_image", hint?: string) => (
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

        {imageUpload("Signature (repli commune)", form.signature_image, "signature_image", "Repli si le signataire n'a pas sa propre signature. À définir de préférence par signataire (Utilisateurs → Signataires).")}
        {imageUpload("Tampon / Cachet (repli commune)", form.tampon_image, "tampon_image", "Repli si le signataire n'a pas son propre tampon. À définir de préférence par signataire (Utilisateurs → Signataires).")}

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
