import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { MapLeaflet } from "../../components/MapLeaflet";
import { RegulatoryChecklist, type RegulatoryChecklistHandle } from "../../components/RegulatoryChecklist";
import { PieceRegulatoryLinks } from "../../components/PieceRegulatoryLinks";
import { RegulatoryDocViewer } from "../../components/RegulatoryDocViewer";
import { PdfAnnotator } from "../../components/PdfAnnotator";
import { ResizableSplit } from "../../components/ResizableSplit";
import { ParcelSynthese, type ParcelSynthesisData } from "../../components/ParcelSynthese";
import { CourrierModal } from "./MairieCourrierScreen";
import { DecisionPanel } from "./DecisionPanel";
import PieceReclassControl from "./PieceReclassControl";
import { StatusBadge } from "./ui";
import { fmtDate, TYPE_LABEL, DOSSIER_TYPE_OPTIONS, type DossierInfo, type WorkflowMeta } from "./shared";
import { useAuth } from "../../hooks/useAuth";
import { PieceMarkupEditor } from "../../components/PieceMarkupEditor";
import { useInstructionViewMode } from "../../hooks/useInstructionViewMode";
import { useLocalStorageBool } from "../../hooks/useLocalStorageBool";
import { linkifyArticles } from "../../utils/linkifyArticles";
import {
  STATUS_LABELS as DOSSIER_STATUS_LABELS,
  primaryNextAction as primaryNextActionFor,
  type DossierStatus,
  describeSeismicZone,
  describeFloodRisk,
  describeClayRisk,
  describeRadonLevel,
  seismicShortLabel,
  supConsequence,
  prescriptionConsequence,
} from "@heureka-v1/shared";

// Détail d'un dossier d'instruction : onglets Résumé / Terrain / Documents /
// Instruction / Consultations / Courriers / Chronologie / Décision, plus les
// sous-composants CourriersPanel et InvitePetitionnaireModal. Bloc extrait tel
// quel de MairieApp.tsx (comportement inchangé).

// "Terrain" remplace "Parcelle" : vue contextuelle (cadastre, contraintes
// fortes, constructibilité synthétique, historique SITADEL/ADS). La carte
// et le règlement détaillé vivent dans "Documents", l'espace de preuve où
// l'instructeur confronte les pièces aux PDF réglementaires. "Instruction"
// porte désormais l'analyse réglementaire (constats du moteur + qualification),
// anciennement étiquetée "Conformité IA".
const DETAIL_TABS = ["Résumé", "Terrain", "Documents", "Instruction", "Consultations", "Courriers", "Chronologie", "Décision"] as const;
type DetailTab = typeof DETAIL_TABS[number];

// Slugs d'URL pour chaque onglet du détail dossier : ils permettent de restituer
// l'onglet courant après un rechargement de page (ou via un lien direct), au lieu
// de retomber systématiquement sur "Résumé".
const TAB_TO_SLUG: Record<DetailTab, string> = {
  "Résumé": "resume",
  "Terrain": "terrain",
  "Documents": "documents",
  "Instruction": "instruction",
  "Consultations": "consultations",
  "Courriers": "courriers",
  "Chronologie": "chronologie",
  "Décision": "decision",
};
const SLUG_TO_DETAIL_TAB: Record<string, DetailTab> = Object.fromEntries(
  Object.entries(TAB_TO_SLUG).map(([tab, slug]) => [slug, tab as DetailTab]),
);

const TAB_ICONS: Record<string, React.ReactNode> = {
  "Résumé": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  "Terrain": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>,
  "Instruction": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
  "Documents": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
  "Consultations": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>,
  "Courriers": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
  "Chronologie": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  "Décision": <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><polyline points="9 15 11 17 15 13" /></svg>,
};


// ─── Onglet "Courriers" ──────────────────────────────────────────────────────
// Historique des courriers d'instruction émis pour un dossier. Liste, type,
// auteur, pièces visées, articles cités. Sert de référence auditable pour
// le pétitionnaire et l'instructeur.
function CourriersPanel({ dossierId, onRequestNewPiecesCourrier, onRequestNewGeneralCourrier }: {
  dossierId: string;
  onRequestNewPiecesCourrier: () => void;
  onRequestNewGeneralCourrier: () => void;
}) {
  type CourrierRow = {
    id: string;
    type: string;
    subject: string | null;
    pieces_jointes_ids: Array<{ piece_id?: string; code_piece?: string; nom: string; raison?: string; manquante?: boolean }>;
    articles_cites: string[];
    emis_par: string | null;
    emis_le: string;
    delivery_method: string | null;
  };
  const [rows, setRows] = useState<CourrierRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<CourrierRow[]>(`/mairie/dossiers/${dossierId}/courriers`)
      .then((d) => { if (!cancelled) setRows(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Erreur"); });
    return () => { cancelled = true; };
  }, [dossierId]);

  const COURRIER_LABEL: Record<string, { label: string; color: string; bg: string }> = {
    pieces_complementaires: { label: "Demande de pièces", color: "#B45309", bg: "#FEF3C7" },
    refus: { label: "Refus", color: "#B91C1C", bg: "#FEE2E2" },
    non_opposition: { label: "Non-opposition", color: "#15803D", bg: "#DCFCE7" },
    majoration_delai: { label: "Majoration de délai", color: "#0284C7", bg: "#E0F2FE" },
    daact: { label: "DAACT", color: "#7C3AED", bg: "#EDE9FE" },
    sursis: { label: "Sursis", color: "#475569", bg: "#F1F5F9" },
    notification: { label: "Notification", color: "#0F172A", bg: "#F1F5F9" },
    general: { label: "Général", color: "#6B7280", bg: "#F3F4F6" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Courriers émis</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Historique de tous les courriers envoyés au pétitionnaire pour ce dossier.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onRequestNewPiecesCourrier}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "white", color: "#B45309", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            📎 Demander des pièces
          </button>
          <button onClick={onRequestNewGeneralCourrier}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "#0F172A", color: "white", border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            + Nouveau courrier
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: "#FEE2E2", color: "#991B1B", borderRadius: 8, fontSize: 12.5 }}>{error}</div>
      )}

      {rows === null ? (
        <div style={{ padding: 32, background: "white", borderRadius: 12, border: "1px solid #E8EEF4", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 32, background: "white", borderRadius: 12, border: "1px dashed #CBD5E1", textAlign: "center", color: "#64748b", fontSize: 13 }}>
          Aucun courrier émis pour ce dossier.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((c) => {
            const meta = COURRIER_LABEL[c.type] ?? COURRIER_LABEL.general!;
            const pieces = Array.isArray(c.pieces_jointes_ids) ? c.pieces_jointes_ids : [];
            const articles = Array.isArray(c.articles_cites) ? c.articles_cites : [];
            return (
              <div key={c.id} style={{ background: "white", border: "1px solid #E8EEF4", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, padding: "2px 8px", borderRadius: 5 }}>{meta.label}</span>
                    {c.subject && <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{c.subject}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" as const }}>
                    {new Date(c.emis_le).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {c.delivery_method && <> · <span style={{ textTransform: "capitalize" as const }}>{c.delivery_method}</span></>}
                  </div>
                </div>

                {pieces.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 5 }}>
                      Pièces visées ({pieces.length})
                    </div>
                    <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12.5, color: "#334155" }}>
                      {pieces.map((p, i) => (
                        <li key={i} style={{ marginBottom: 2 }}>
                          {p.code_piece && <span style={{ fontFamily: "monospace", color: "#64748b", marginRight: 6 }}>{p.code_piece}</span>}
                          {p.nom}
                          {p.manquante
                            ? <span style={{ fontSize: 10.5, color: "#B45309", marginLeft: 6 }}>à fournir</span>
                            : <span style={{ fontSize: 10.5, color: "#0284C7", marginLeft: 6 }}>à compléter</span>}
                          {p.raison && <span style={{ color: "#64748b" }}> — {p.raison}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {articles.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 5 }}>
                      Articles cités
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                      {articles.map((a) => (
                        <span key={a} style={{ fontSize: 11, fontWeight: 600, color: "#374151", background: "#F1F5F9", padding: "2px 8px", borderRadius: 5, fontFamily: "monospace" }}>Art. {a}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Modale d'invitation du pétitionnaire à activer son espace citoyen. Régularise
// un dossier dont le compte est un placeholder (email obligatoire) ou dont
// l'email n'a jamais été activé (renvoi possible, adresse corrigeable). Si
// l'adresse correspond à un compte existant d'un autre nom, demande confirmation.
function InvitePetitionnaireModal({ dossierId, initialEmail, isPlaceholder, petitionnaireName, onClose, onInvited }: {
  dossierId: string;
  initialEmail: string;
  isPlaceholder: boolean;
  petitionnaireName: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Compte existant trouvé par email dont le nom diffère du pétitionnaire saisi :
  // on bascule sur un écran de confirmation avant de rattacher.
  const [confirmExisting, setConfirmExisting] = useState<{ prenom?: string; nom?: string; verified?: boolean } | null>(null);

  const submit = async (confirm: boolean) => {
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed) { setError("Veuillez saisir une adresse email."); return; }
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ action: string; emailSent?: boolean; code?: string; existing?: { prenom?: string; nom?: string; verified?: boolean } }>(
        `/mairie/dossiers/${dossierId}/inviter-petitionnaire`, { email: trimmed, confirm });
      if (r.action === "confirm" && r.code === "name_mismatch") {
        setConfirmExisting(r.existing ?? {});
        setBusy(false);
        return;
      }
      if (r.action === "invited" && r.emailSent === false) {
        setError("Le compte a été rattaché, mais l'email n'a pas pu être envoyé. Réessayez plus tard.");
        setBusy(false);
        return;
      }
      onInvited();
    } catch (e) {
      const msg = e instanceof ApiError
        ? ((e.body as { error?: string } | undefined)?.error ?? "Échec de l'envoi.")
        : "Échec de l'envoi.";
      setError(msg);
      setBusy(false);
    }
  };

  const existingName = confirmExisting ? [confirmExisting.prenom, confirmExisting.nom].filter(Boolean).join(" ").trim() : "";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 14, width: 460, padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Inviter le pétitionnaire</div>
        {confirmExisting ? (
          <>
            <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 10, padding: "12px 14px", marginBottom: 18 }}>
              <div style={{ fontSize: 12.5, color: "#92400E", lineHeight: 1.65 }}>
                Un compte existe déjà pour <strong>{email.trim()}</strong>{existingName ? <> au nom de <strong>{existingName}</strong></> : null} ({confirmExisting.verified ? "compte actif" : "compte non activé"}).
                <br />Ce nom diffère du pétitionnaire saisi sur le dossier{petitionnaireName ? <> (<strong>{petitionnaireName}</strong>)</> : null}. Confirmez-vous le rattachement de ce dossier à ce compte ?
              </div>
            </div>
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmExisting(null)} disabled={busy} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Revenir</button>
              <button onClick={() => submit(true)} disabled={busy} style={{ background: "#D97706", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                {busy ? "…" : "Rattacher quand même"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.6, margin: "0 0 16px" }}>
              {isPlaceholder
                ? "Ce dossier est rattaché à un compte interne non utilisable. Saisissez l'adresse du pétitionnaire : il recevra une invitation à activer son espace pour suivre son dossier en ligne (ou un rattachement si un compte existe déjà)."
                : "Le pétitionnaire n'a pas encore activé son espace. Vous pouvez lui (re)envoyer l'invitation, et corriger l'adresse si nécessaire."}
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Email du pétitionnaire</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jean.dupont@example.com" autoFocus
              style={{ width: "100%", border: "1.5px solid #E2E8F0", borderRadius: 9, padding: "10px 12px", fontSize: 12.5, outline: "none", boxSizing: "border-box" as const, marginBottom: error ? 8 : 16 }} />
            {error && <div style={{ fontSize: 12, color: "#DC2626", marginBottom: 14, lineHeight: 1.5 }}>{error}</div>}
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
              <button onClick={onClose} disabled={busy} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Annuler</button>
              <button onClick={() => submit(false)} disabled={busy || !email.trim()} style={{ background: "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy || !email.trim() ? 0.6 : 1 }}>
                {busy ? "Envoi…" : "Envoyer l'invitation"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function DossierDetailScreen({ dossier, onBack, navigate }: {
  dossier: DossierInfo;
  onBack: () => void;
  navigate: (s: string) => void;
}) {
  const { user } = useAuth();
  // Invitation du pétitionnaire (compte placeholder / jamais activé). `invited`
  // bascule l'UI localement après envoi, sans re-fetch du détail.
  const [showInvitePetitionnaire, setShowInvitePetitionnaire] = useState(false);
  const [petitionnaireInvited, setPetitionnaireInvited] = useState(false);
  // Onglet actif persisté dans l'URL (?tab=) : un rechargement de page ou un lien
  // direct restitue l'onglet courant au lieu de revenir sur "Résumé".
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTabState] = useState<DetailTab>(
    () => SLUG_TO_DETAIL_TAB[searchParams.get("tab") ?? ""] ?? "Résumé",
  );
  const setActiveTab = useCallback((tab: DetailTab) => {
    setActiveTabState(tab);
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev);
      sp.set("tab", TAB_TO_SLUG[tab]);
      return sp;
    }, { replace: true });
  }, [setSearchParams]);
  // Garde l'onglet synchronisé avec l'URL (navigation arrière/avant, liens directs).
  useEffect(() => {
    const t = SLUG_TO_DETAIL_TAB[searchParams.get("tab") ?? ""];
    if (t && t !== activeTab) setActiveTabState(t);
  }, [searchParams]);
  // Onglet Documents : mode d'affichage côté instructeur — aperçu (3 col.),
  // comparer (pièce ↔ document réglementaire), lecture (plein écran).
  // Persisté en localStorage entre dossiers (préférence utilisateur).
  const [docsViewMode, setDocsViewMode] = useInstructionViewMode();
  // Document réglementaire affiché en mode Comparer (sélection mémorisée
  // tant qu'on reste sur le dossier — réinitialisé entre dossiers).
  const [docsRegulatoryDocId, setDocsRegulatoryDocId] = useState<string | null>(null);
  // Hints transmis au RegulatoryDocViewer quand on arrive depuis une citation
  // de verdict (onglet Instruction). docType : auto-sélection PLU/PPRI/OAP…
  // page : ouvre directement à la bonne page via fragment #page=N.
  const [docsRegulatoryDocTypeHint, setDocsRegulatoryDocTypeHint] = useState<string | null>(null);
  const [docsRegulatoryDocPage, setDocsRegulatoryDocPage] = useState<number | null>(null);
  // Repli indépendant des bandeaux latéraux de l'onglet Instruction, disponible
  // dans tous les modes (préférence persistée par instructeur).
  const [docsLeftCollapsed, setDocsLeftCollapsed] = useLocalStorageBool("heureka.instrLeftCollapsed", false);
  const [docsRightCollapsed, setDocsRightCollapsed] = useLocalStorageBool("heureka.instrRightCollapsed", false);
  // Mode « grand écran » de l'instruction (overlay plein viewport, disponible
  // dans tous les modes d'affichage). Volontairement non persisté : on ne veut
  // pas rouvrir un dossier coincé en plein écran.
  const [docsFullscreen, setDocsFullscreen] = useState(false);
  // Élément overlay sur lequel on déclenche le plein écran natif du navigateur
  // (Fullscreen API) : il masque les onglets/barre du navigateur et occupe tout
  // l'écran, tout en gardant visibles les boutons React posés à l'intérieur.
  const docsFullscreenRef = useRef<HTMLDivElement>(null);
  // Échap quitte le grand écran (en plus de la sortie native gérée par le navigateur).
  useEffect(() => {
    if (!docsFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDocsFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docsFullscreen]);
  // Synchronise l'état avec le plein écran natif. Demande le plein écran natif à
  // l'ouverture de l'overlay ; si l'API est refusée (navigateur, permissions),
  // on garde la dégradation gracieuse : l'overlay position:fixed couvre déjà
  // toute la fenêtre de l'app. À la fermeture, on quitte le plein écran natif.
  useEffect(() => {
    if (docsFullscreen) {
      const el = docsFullscreenRef.current;
      if (el && el.requestFullscreen && !document.fullscreenElement) {
        el.requestFullscreen().catch(() => { /* refusé → overlay seul, OK */ });
      }
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => { /* ignore */ });
    }
  }, [docsFullscreen]);
  // Si l'utilisateur quitte le plein écran natif (Échap/F11), on referme l'overlay
  // pour rester cohérent.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setDocsFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Handler de jump depuis une citation de verdict. Bascule l'onglet, le mode
  // d'affichage, et nourrit les hints du RegulatoryDocViewer.
  const jumpFromCitation = useCallback((ref: { doc_type?: string; page?: number }) => {
    if (!ref.doc_type) return;
    // Pas de bascule automatique : on prépare le viewer pour quand
    // l'utilisateur ouvrira l'onglet Instruction, sans le forcer.
    setDocsViewMode("compare");
    setDocsRegulatoryDocTypeHint(ref.doc_type);
    setDocsRegulatoryDocPage(typeof ref.page === "number" ? ref.page : null);
  }, [setDocsViewMode]);
  // Mode d'ouverture de la modale courrier : null = fermée, "general" = bouton
  // historique, "pieces_complementaires" = entrée dédiée depuis le bandeau
  // workflow. Le mode pilote le panneau de sélection des pièces et le bouton
  // "Émettre" dans la modale.
  const [courrierMode, setCourrierMode] = useState<null | "general" | "pieces_complementaires">(null);
  const [showMapFull, setShowMapFull] = useState(false);

  // ── Analyse parcellaire réelle ──
  type ParcelAnalysis = {
    query: string;
    address?: { label: string; lat: number; lng: number; city: string; postcode: string };
    parcel?: { parcelle_id: string; section: string; numero: string; surface_m2: number; commune: string; code_insee: string };
    plu_zone?: { zone_code: string; zone_label: string; zone_type: string; plu_nom?: string };
    risks?: { flood_risk: string; seismic_zone: string; clay_risk: string; radon_level?: string };
    db_zone?: { id: string; code: string; label: string | null; type: string | null } | null;
    rules: Array<{
      id: string; topic: string; rule_text: string;
      value_min: number | null; value_max: number | null; value_exact?: number | null;
      unit: string | null; summary: string | null; article_number: number | null;
      sub_theme?: string | null;
      conditions?: string | null;
      exceptions?: string | null;
      cases?: Array<{ condition: string; value: number | null; unit: string | null; kind?: string }> | null;
      relevance?: "general" | "applicable" | "conditional" | "excluded";
    }>;
    buildability: { maxFootprintM2: number; remainingFootprintM2: number; maxHeightM: number | null; minSetbackFromRoadM: number | null; minSetbackFromBoundariesM: number | null; estimatedFloors: number | null; greenSpaceRatio: number | null; greenSpaceRequiredM2: number | null; confidence: number; resultSummary: string } | null;
    data_sources: string[];
    warnings: string[];
    available_zones?: Array<{ zone_code: string; zone_label: string; zone_type: string }>;
    municipality?: { is_rnu: boolean; libelle?: string } | null;
    prescriptions?: Array<{ libelle: string; typepsc: string; txtpsc?: string }>;
    servitudes?: Array<{
      categorie: string;
      libelle?: string;
      nomsup?: string;
      dessup?: string;
      ref_acte?: string;
      urlacte?: string;
      gestionnaire?: string;
      datdecr?: string;
      typeprotect?: string;
    }>;
    synthesis?: ParcelSynthesisData;
  };
  const [parcelAnalysis, setParcelAnalysis] = useState<ParcelAnalysis | null>(
    (dossier.cachedParcelAnalysis as ParcelAnalysis | null) ?? null
  );
  const [parcelLoading, setParcelLoading] = useState(false);
  const [parcelError, setParcelError] = useState<string | null>(null);
  const [showAddressEditor, setShowAddressEditor] = useState(false);
  // ── Délai d'instruction (popover sur le chip Échéance) ──
  const [showDelaiPopover, setShowDelaiPopover] = useState(false);
  const [completudeDraft, setCompletudeDraft] = useState<string | null>(null);
  const [delaiSaving, setDelaiSaving] = useState(false);
  const saveCompletude = useCallback(async () => {
    setDelaiSaving(true);
    try {
      await api.patch(`/mairie/dossiers/${dossier.id}/deadline`, { date_completude: completudeDraft || null });
      // Force le rechargement du dossier au prochain mount — ici on signale juste à l'utilisateur.
      alert("Date de complétude enregistrée. Le délai a été recalculé. Rechargez la page pour voir la nouvelle échéance.");
      setShowDelaiPopover(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l'enregistrement");
    } finally {
      setDelaiSaving(false);
    }
  }, [dossier.id, completudeDraft]);
  const [addressOverride, setAddressOverride] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [addrQuery, setAddrQuery] = useState("");
  const [addrSuggestions, setAddrSuggestions] = useState<Array<{ label: string; city: string; postcode: string }>>([]);
  const [addrSugLoading, setAddrSugLoading] = useState(false);
  const [addrSaving, setAddrSaving] = useState(false);
  const [liveAdresse, setLiveAdresse] = useState(dossier.adresse);
  const [liveCommune, setLiveCommune] = useState(dossier.commune ?? null);
  // Édition inline du type de dossier — utile quand l'OCR a renvoyé un type
  // générique (ex. PC au lieu de PCMI) ou pour corriger une erreur de saisie.
  const [liveType, setLiveType] = useState<string>(dossier.type);
  const [showTypeEditor, setShowTypeEditor] = useState(false);
  const [typeSaving, setTypeSaving] = useState(false);
  const saveType = useCallback(async (next: string) => {
    if (next === liveType) {
      setShowTypeEditor(false);
      return;
    }
    setTypeSaving(true);
    try {
      await api.patch(`/mairie/dossiers/${dossier.id}/type`, { type: next });
      setLiveType(next);
      setShowTypeEditor(false);
      alert("Type d'autorisation mis à jour. Le délai d'instruction a été recalculé.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la mise à jour du type");
    } finally {
      setTypeSaving(false);
    }
  }, [dossier.id, liveType]);
  const [clickingParcel, setClickingParcel] = useState(false);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    // Chargement éager : l'analyse identifie notamment la référence
    // cadastrale, qui s'affiche aussi dans le Résumé et l'en-tête.
    if (parcelAnalysis || parcelLoading) return;
    setParcelLoading(true);
    setParcelError(null);
    const params = new URLSearchParams();
    if (addressOverride) params.set("q", addressOverride);
    if (selectedZone) params.set("zone", selectedZone);
    if (clickedCoords) {
      params.set("lat", String(clickedCoords.lat));
      params.set("lng", String(clickedCoords.lng));
    }
    const url = `/mairie/dossiers/${dossier.id}/analyse-parcelle${params.toString() ? "?" + params.toString() : ""}`;
    api.get<ParcelAnalysis>(url)
      .then(data => { setParcelAnalysis(data); setClickingParcel(false); })
      .catch(e => setParcelError(e instanceof Error ? e.message : "Erreur analyse parcellaire"))
      .finally(() => setParcelLoading(false));
  }, [dossier.id, parcelAnalysis, parcelLoading, addressOverride, selectedZone, clickedCoords]);

  // BAN autocomplete
  useEffect(() => {
    if (addrQuery.length < 3) { setAddrSuggestions([]); return; }
    const timer = setTimeout(() => {
      setAddrSugLoading(true);
      fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(addrQuery)}&limit=5`)
        .then(r => r.json())
        .then((d: { features: Array<{ properties: { label: string; city: string; postcode: string } }> }) =>
          setAddrSuggestions(d.features.map(f => ({ label: f.properties.label, city: f.properties.city, postcode: f.properties.postcode }))))
        .catch(() => setAddrSuggestions([]))
        .finally(() => setAddrSugLoading(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [addrQuery]);

  const handleAddressSelect = (suggestion: { label: string; city: string; postcode: string }) => {
    const newAddr = suggestion.label;
    const newCommune = suggestion.city;
    setAddressOverride(newAddr);
    setSelectedZone(null);
    setLiveAdresse(newAddr);
    setLiveCommune(newCommune);
    setAddrQuery("");
    setAddrSuggestions([]);
    setShowAddressEditor(false);
    setParcelAnalysis(null);
    setParcelError(null);
    setAddrSaving(true);
    api.patch(`/mairie/dossiers/${dossier.id}/adresse`, { adresse: newAddr, commune: newCommune })
      .catch(() => {})
      .finally(() => setAddrSaving(false));
  };

  const [decisionType, setDecisionType] = useState<string>("accord_prescription");
  const [prescriptions, setPrescriptions] = useState([
    "Respecter la hauteur maximale de 3,5 m pour l'annexe.",
    "Conserver 30 % d'espaces perméables sur l'unité foncière.",
    "Respecter les prescriptions de l'avis ABF joint au dossier.",
  ]);
  const [editingPrescriptions, setEditingPrescriptions] = useState(false);

  // ── Consultations réelles ──
  type Consultation = {
    id: string;
    dossier_id: string;
    service_name: string;
    service_type: string;
    status: string;
    favorable: boolean | null;
    avis: string | null;
    date_envoi: string | null;
    date_reponse: string | null;
    created_at: string;
  };
  const [consultations, setConsultations] = useState<Consultation[] | null>(null);
  const [consultationsLoading, setConsultationsLoading] = useState(false);
  const [consultationsMissioning, setConsultationsMissioning] = useState(false);
  // Étape "Consultations" du suivi d'avancement (Résumé) : terminée quand au
  // moins une consultation a été lancée et qu'aucune n'est encore en attente
  // d'avis. (Avant : câblée en dur sur `false`, donc jamais validée.)
  const consultationsDone =
    consultations != null && consultations.length > 0 &&
    consultations.every((c) => c.status !== "en_attente");
  const [selectedConsultation, setSelectedConsultation] = useState<string | null>(null);
  // ── Missionner un service annexe (modale de sélection + message) ──
  type AvailableService = { id: string; name: string; type: string; email: string | null };
  const [showMissionModal, setShowMissionModal] = useState(false);
  const [availableServices, setAvailableServices] = useState<AvailableService[] | null>(null);
  const [missionServiceId, setMissionServiceId] = useState<string>("");
  const [missionMessage, setMissionMessage] = useState<string>("");

  type PieceAnalyse = { score?: string; commentaire?: string; suggestions?: string[] };
  type PieceExtractionLite = {
    piece_type?: string;
    confidence_type?: number;
    quality?: string;
    echelle?: string | null;
    nord_visible?: boolean | null;
    // Phase 5 : checklist graphique étendue. Optionnel pour rétro-compat
    // avec les anciennes extractions stockées en jsonb.
    graphics?: {
      orientation?: { kind?: string; visible?: boolean; evidence?: string | null } | null;
      echelle_graphique?: string | null;
      legende?: string | null;
      limites?: string | null;
      acces?: string | null;
      emprise?: string | null;
      cotes_completes?: string | null;
      altimetries?: string | null;
      prises_de_vue?: Array<{ label: string; page?: number | null }> | null;
    } | null;
    // Phase 2.3 : références cadastrales observées sur la pièce.
    parcelles_observees?: Array<{
      section: string;
      numero: string;
      qualificatif: "entiere" | "partie";
      source_field?: string | null;
      citation?: string | null;
    }> | null;
    cerfa?: Record<string, unknown> | null;
    plan_masse?: Record<string, unknown> | null;
    plan_coupe?: Record<string, unknown> | null;
    plan_facade?: Record<string, unknown> | null;
    notice?: Record<string, unknown> | null;
    photo?: Record<string, unknown> | null;
    missing_elements?: string[];
    // Rétro-compat : les anciennes extractions stockaient des strings, le
    // pipeline actuel renvoie des objets { text, page?, bbox?, confidence? }.
    citations?: Array<string | { text?: string | null; page?: number | null }>;
    notes?: string | null;
  };
  type DossierPiece = {
    id: string;
    nom: string;
    url: string;
    type: string;
    taille: number;
    code_piece: string | null;
    analyse_ia: PieceAnalyse | null;
    extraction_ia: PieceExtractionLite | null;
    instructeur_status: "valide" | "rejete" | "complement_demande" | null;
    instructeur_note: string | null;
    instructeur_status_at: string | null;
    uploaded_at: string;
    // Statut du pipeline OCR — sert à signaler à l'instructeur qu'un
    // document est en cours de traitement ou que l'extraction a échoué
    // (sinon il croit que l'IA a "rien dit", alors qu'elle n'a rien pu lire).
    ocr_status?: "pending" | "processing" | "done" | "failed" | "skipped" | null;
  };
  const [documents, setDocuments] = useState<DossierPiece[] | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<number>(0);
  // Pièce ouverte dans l'éditeur d'annotation (entourer/commenter → GED → envoi
  // citoyen). Internalise le retravail aujourd'hui fait sous Inkscape/Foxit.
  // L'éditeur est rendu EN PLACE dans le visualiseur (pas en fenêtre séparée).
  const [annotatePiece, setAnnotatePiece] = useState<DossierPiece | null>(null);
  // Version affichée : "initiale" (pièce déposée par le citoyen) ou "finale"
  // (pièce retravaillée/annotée par l'instructeur, enregistrée dans la GED).
  const [pieceVersion, setPieceVersion] = useState<"initiale" | "finale">("initiale");
  // GED du dossier : documents produits par l'instruction. Sert à savoir quelle
  // pièce possède une version finale et à l'afficher / la comparer.
  type GedDocLite = { id: string; nom: string; url: string; type: string; category: string; source_piece_id: string | null; created_at: string };
  const [gedDocs, setGedDocs] = useState<GedDocLite[]>([]);
  const refreshGed = useCallback(() => {
    api.get<GedDocLite[]>(`/mairie/dossiers/${dossier.id}/documents`)
      .then(setGedDocs)
      .catch(() => setGedDocs([]));
  }, [dossier.id]);
  useEffect(() => { refreshGed(); }, [refreshGed]);
  // Changer de pièce sélectionnée quitte le mode annotation et revient à la
  // version initiale (un seul éditeur à la fois, pas d'annotation par erreur).
  useEffect(() => { setAnnotatePiece(null); setPieceVersion("initiale"); }, [selectedDoc]);
  // Pièce à sélectionner une fois l'onglet Documents chargé. Permet d'ouvrir
  // une pièce justificative depuis un autre onglet (checklist, verdicts) même
  // quand `documents` n'est pas encore chargé : la sélection est différée.
  const [pendingPieceId, setPendingPieceId] = useState<string | null>(null);
  // Catégories repliées dans l'onglet Documents (3.C.4 — affinage suite à
  // dossiers avec 30+ pièces). Persisté entre les rerenders mais pas en
  // localStorage : c'est un état de session, l'instructeur déplie ce qu'il
  // veut regarder à un instant T sans contaminer ses autres dossiers.
  const [collapsedDocCategories, setCollapsedDocCategories] = useState<Set<string>>(new Set());
  const toggleDocCategory = useCallback((key: string) => {
    setCollapsedDocCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const [extractingPieceId, setExtractingPieceId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== "Documents" || documents !== null) return;
    setDocumentsLoading(true);
    api.get<DossierPiece[]>(`/mairie/dossiers/${dossier.id}/pieces`)
      // Ne réinitialise pas la sélection à 0 si une pièce précise est en
      // attente d'ouverture (clic depuis un autre onglet) — l'effet ci-dessous
      // la résout dès que `documents` est disponible.
      .then((data) => { setDocuments(data); if (!pendingPieceId) setSelectedDoc(0); })
      .catch(() => setDocuments([]))
      .finally(() => setDocumentsLoading(false));
  }, [activeTab, documents, dossier.id, pendingPieceId]);

  // Résout une demande d'ouverture de pièce différée : dès que `documents` est
  // chargé, on sélectionne la pièce ciblée puis on purge la demande (qu'elle
  // ait abouti ou non — une pièce archivée/superseded peut être absente).
  useEffect(() => {
    if (!pendingPieceId || documents === null) return;
    const idx = documents.findIndex((d) => d.id === pendingPieceId);
    if (idx >= 0) setSelectedDoc(idx);
    setPendingPieceId(null);
  }, [pendingPieceId, documents]);

  const reExtractPiece = useCallback(async (pieceId: string) => {
    setExtractingPieceId(pieceId);
    try {
      const ext = await api.post<PieceExtractionLite>(`/mairie/dossiers/${dossier.id}/pieces/${pieceId}/extract`, {});
      setDocuments((arr) => arr ? arr.map((d) => d.id === pieceId ? { ...d, extraction_ia: ext } : d) : arr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Échec de l'extraction";
      alert(msg);
    } finally {
      setExtractingPieceId(null);
    }
  }, [dossier.id]);

  // ── Annotation instructeur (statut + note libre) ──
  const [annotatingPieceId, setAnnotatingPieceId] = useState<string | null>(null);
  const [annotationDrafts, setAnnotationDrafts] = useState<Record<string, string>>({});
  const setAnnotationDraft = useCallback((pieceId: string, value: string) => {
    setAnnotationDrafts((prev) => ({ ...prev, [pieceId]: value }));
  }, []);
  const sendAnnotation = useCallback(async (pieceId: string, body: { status?: "valide" | "rejete" | "complement_demande" | null; note?: string | null }) => {
    setAnnotatingPieceId(pieceId);
    try {
      const updated = await api.patch<DossierPiece>(`/mairie/dossiers/${dossier.id}/pieces/${pieceId}/annotation`, body);
      setDocuments((arr) => arr ? arr.map((d) => d.id === pieceId ? { ...d, ...updated } : d) : arr);
      setAnnotationDrafts((prev) => { const next = { ...prev }; delete next[pieceId]; return next; });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Échec de l'enregistrement";
      alert(msg);
    } finally {
      setAnnotatingPieceId(null);
    }
  }, [dossier.id]);

  // Ouvre une pièce justificative par son identifiant : bascule sur l'onglet
  // Documents et sélectionne la pièce. Utilisé par la checklist réglementaire
  // pour rendre cliquable la valeur « Fait utilisé » et remonter à la preuve.
  const openPieceById = useCallback((pieceId: string) => {
    // Bascule TOUJOURS sur l'onglet Documents. Si les pièces sont déjà
    // chargées, on sélectionne immédiatement ; sinon on diffère via
    // pendingPieceId (l'effet de résolution s'en charge au chargement).
    setActiveTab("Documents");
    const idx = (documents ?? []).findIndex((d) => d.id === pieceId);
    if (idx >= 0) setSelectedDoc(idx);
    else setPendingPieceId(pieceId);
  }, [documents]);

  // ── Chronologie : instruction events ──
  type InstructionEvent = {
    id: string;
    type: string;
    description: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
    actor_name: string | null;
    actor_role: string | null;
  };
  const [events, setEvents] = useState<InstructionEvent[] | null>(null);
  useEffect(() => {
    if (activeTab !== "Chronologie" || events !== null) return;
    api.get<InstructionEvent[]>(`/mairie/dossiers/${dossier.id}/events`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [activeTab, events, dossier.id]);

  // ── Instruction (rapport + lancement) ──
  type ConformiteReport = {
    schema_version: number;
    score_global: string;
    score_pct: number;
    pieces_attendues: number;
    pieces_deposees: number;
    pieces_manquantes: Array<{ code: string; nom: string }>;
    pieces_analyses: Array<{ piece_id: string; nom: string; code_piece: string | null; score: string; commentaire: string }>;
    alertes_reglementaires: string[];
    synthese: string;
    rule_verdicts: {
      verdicts: Array<{
        rule_id: string;
        topic: string;
        article: string | null;
        sub_theme: string | null;
        rule_text_short: string;
        verdict: "conforme" | "non_conforme" | "non_verifiable" | "applicable_conditionnel" | "non_applicable";
        raison: string;
        manquant: string | null;
        valeur_observee: { value: number; unit: string | null } | null;
        valeur_attendue: { min?: number | null; max?: number | null; exact?: number | null; unit?: string | null } | null;
        sources: Array<{ piece_id: string; piece_nom: string; citation: string }>;
        regulatory_sources?: Array<{
          segment_id: string;
          doc_type: string;
          doc_source_file: string | null;
          page: number | null;
          citation: string;
        }>;
      }>;
      counts: Record<string, number>;
      warnings: string[];
    } | null;
    warnings: string[];
    analyzed_at: string;
  };
  const [conformite, setConformite] = useState<{ status: string; report: ConformiteReport | null; analyzed_at: string | null } | null>(null);
  const [conformiteLaunching, setConformiteLaunching] = useState(false);

  // Conformité FINALE (3.C.5b) — déclenchée avant arrêté, considère
  // uniquement les pièces validées. Indépendante de l'interim ci-dessus.
  type ConformiteFinale = {
    status: string;
    report: ConformiteReport | null;
    analyzed_at: string | null;
    triggered_by: string | null;
  };
  type FinaleBlockers = {
    pieces_sans_statut: Array<{ id: string; nom: string; code_piece: string | null }>;
    pieces_complement_en_attente: Array<{ id: string; nom: string; code_piece: string | null }>;
    aucune_piece_validee: boolean;
  };
  const [conformiteFinale, setConformiteFinale] = useState<ConformiteFinale | null>(null);
  const [conformiteFinaleLaunching, setConformiteFinaleLaunching] = useState(false);
  const [finaleBlockers, setFinaleBlockers] = useState<{ reason: string; blockers: FinaleBlockers } | null>(null);
  // Erreur de l'analyse de travail, affichée inline dans le bloc d'action
  // (remplace l'ancien alert() pour rester cohérent avec le reste du panneau).
  const [conformiteError, setConformiteError] = useState<string | null>(null);
  // Pilotage du moteur réglementaire (constats) depuis le bloc d'action unifié :
  // la relance « de travail » déclenche en une fois la conformité interim ET
  // les constats réglementaires. Le composant remonte son état via onStatusChange.
  const regulatoryRef = useRef<RegulatoryChecklistHandle>(null);
  const [regulatoryStatus, setRegulatoryStatus] = useState<{ running: boolean; hasData: boolean; lastRunAt: string | null }>({ running: false, hasData: false, lastRunAt: null });
  const onRegulatoryStatus = useCallback((s: { running: boolean; hasData: boolean; lastRunAt: string | null }) => setRegulatoryStatus(s), []);

  useEffect(() => {
    if (activeTab !== "Instruction" || conformite !== null) return;
    api.get<{ status: string; report: ConformiteReport | null; analyzed_at: string | null }>(`/mairie/dossiers/${dossier.id}/conformite`)
      .then(setConformite)
      .catch(() => setConformite({ status: "absent", report: null, analyzed_at: null }));
  }, [activeTab, conformite, dossier.id]);

  // Charge la finale en parallèle de l'interim (1 GET en plus, OK).
  useEffect(() => {
    if (activeTab !== "Instruction" || conformiteFinale !== null) return;
    api.get<ConformiteFinale>(`/mairie/dossiers/${dossier.id}/conformite/finale`)
      .then(setConformiteFinale)
      .catch(() => setConformiteFinale({ status: "absent", report: null, analyzed_at: null, triggered_by: null }));
  }, [activeTab, conformiteFinale, dossier.id]);

  const launchConformite = useCallback(async () => {
    setConformiteLaunching(true);
    setConformiteError(null);
    try {
      // Synchrone (sync: true) : on attend le résultat puis on rafraîchit, afin
      // que la relance combinée affiche directement la synthèse à jour (sinon le
      // mode tâche de fond renverrait un statut "pending" et l'instructeur
      // devrait recharger l'onglet pour voir le résultat).
      await api.post(`/mairie/dossiers/${dossier.id}/conformite/analyse`, { sync: true }, { timeoutMs: 240_000 });
      const fresh = await api.get<{ status: string; report: ConformiteReport | null; analyzed_at: string | null }>(`/mairie/dossiers/${dossier.id}/conformite`);
      setConformite(fresh);
    } catch (e) {
      // On n'émet pas d'exception : la relance combinée doit laisser l'autre
      // moteur (réglementaire) aller au bout. L'erreur est rendue inline.
      setConformiteError(e instanceof Error ? e.message : "Échec de l'analyse de conformité");
    } finally {
      setConformiteLaunching(false);
    }
  }, [dossier.id]);

  // Relance « de travail » : déclenche en une seule action les deux moteurs
  // recalculables pendant l'instruction (conformité interim + constats
  // réglementaires), en parallèle. La finale reste une action distincte.
  const relaunchWorkingAnalysis = useCallback(async () => {
    setConformiteError(null);
    await Promise.all([
      launchConformite(),
      regulatoryRef.current?.run() ?? Promise.resolve(),
    ]);
  }, [launchConformite]);

  const launchConformiteFinale = useCallback(async () => {
    setConformiteFinaleLaunching(true);
    setFinaleBlockers(null);
    try {
      await api.post(`/mairie/dossiers/${dossier.id}/conformite/finale`, {}, { timeoutMs: 240_000 });
      const fresh = await api.get<ConformiteFinale>(`/mairie/dossiers/${dossier.id}/conformite/finale`);
      setConformiteFinale(fresh);
    } catch (e) {
      // L'API renvoie 422 + payload { error, blockers } quand les pré-conditions
      // ne sont pas réunies (pièces sans statut, complément en attente, etc.).
      // On extrait via le message JSON-sérialisé du client api.
      const msg = e instanceof Error ? e.message : String(e);
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.blockers) {
          setFinaleBlockers({ reason: parsed.error ?? "Pré-conditions non réunies", blockers: parsed.blockers });
          return;
        }
      } catch { /* pas du JSON, on retombe sur alert */ }
      alert(msg);
    } finally {
      setConformiteFinaleLaunching(false);
    }
  }, [dossier.id]);

  // Documents thématiques de la commune (OAP, PPRI, …) avec leur synthèse.
  // Chargés à l'ouverture de l'onglet Instruction — c'est là qu'ils servent
  // de support à la confrontation pièces ↔ règlement.
  type CommuneDocLite = {
    id: string;
    type: string;
    name: string;
    original_filename: string;
    file_size: number | null;
    synthese: string | null;
    status: string;
    created_at: string;
  };
  const [communeDocs, setCommuneDocs] = useState<CommuneDocLite[] | null>(null);
  useEffect(() => {
    if (activeTab !== "Documents" || communeDocs !== null) return;
    api.get<CommuneDocLite[]>(`/mairie/dossiers/${dossier.id}/commune-documents`)
      .then(setCommuneDocs)
      .catch(() => setCommuneDocs([]));
  }, [activeTab, communeDocs, dossier.id]);

  // Historique SITADEL/ADS — autorisations passées sur la parcelle.
  // Chargé à l'ouverture de l'onglet Terrain. Le scope "auto" (défaut) cascade
  // côté API : parcelle exacte → même rue (libellé voie) → toute la commune,
  // et garde le premier niveau non vide. L'utilisateur peut forcer un niveau
  // précis (parcel / street / commune) via le toggle. `effective_scope` dans
  // la réponse indique quel niveau a été appliqué pour le rendu.
  type SitadelScope = "auto" | "parcel" | "street" | "commune";
  type SitadelPermit = {
    num_dau: string;
    type_dau: string;
    type_label: string;
    etat: string;
    etat_code: string;
    date_autorisation: string | null;
    date_doc: string | null;
    date_daact: string | null;
    an_depot: number | null;
    adresse: string | null;
    voie: string | null;
    lieudit: string | null;
    superficie_terrain: number | null;
    cadastre: Array<{ section: string; numero: string }>;
    nature_projet: string | null;
    destination: string | null;
    nb_logements: number | null;
    surface_creee: number | null;
    source: "logements" | "locaux" | "amenager" | "demolir";
  };
  type SitadelHistory = {
    permits: SitadelPermit[];
    total: number;
    truncated: boolean;
    effective_scope: "parcel" | "street" | "commune";
    sources_consulted: string[];
    warnings: string[];
  };
  const [sitadelHistory, setSitadelHistory] = useState<SitadelHistory | null>(null);
  const [sitadelLoading, setSitadelLoading] = useState(false);
  const [sitadelScope, setSitadelScope] = useState<SitadelScope>("auto");
  const [sitadelError, setSitadelError] = useState<string | null>(null);
  useEffect(() => {
    if (activeTab !== "Terrain") return;
    setSitadelLoading(true);
    setSitadelError(null);
    api.get<SitadelHistory>(`/mairie/dossiers/${dossier.id}/sitadel-history?scope=${sitadelScope}`)
      .then((data) => setSitadelHistory(data))
      .catch((e) => setSitadelError(e instanceof Error ? e.message : "Indisponible"))
      .finally(() => setSitadelLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dossier.id, sitadelScope]);

  const fetchConsultations = useCallback(() => {
    setConsultationsLoading(true);
    api.get<Consultation[]>(`/mairie/dossiers/${dossier.id}/consultations`)
      .then(data => {
        setConsultations(data);
        if (data.length > 0 && !selectedConsultation) setSelectedConsultation(data[0]?.id ?? null);
      })
      .catch(() => setConsultations([]))
      .finally(() => setConsultationsLoading(false));
  }, [dossier.id, selectedConsultation]);

  // Chargé au montage (et plus seulement sur l'onglet Consultations) : le suivi
  // d'avancement du Résumé a besoin de l'état des consultations dès l'ouverture.
  useEffect(() => {
    if (consultations !== null) return;
    fetchConsultations();
  }, [consultations, fetchConsultations]);

  const hasABFServitude = parcelAnalysis?.servitudes?.some(s => s.categorie?.startsWith("AC")) ?? false;

  // Ouvre la modale "Missionner un service" et charge les services externes
  // enregistrés qui couvrent la commune du dossier (seuls eux peuvent recevoir
  // la consultation dans leur messagerie). On pré-remplit le message avec un
  // libellé mentionnant le dossier.
  const openMissionModal = (preferType?: string) => {
    setMissionServiceId("");
    setMissionMessage(
      `Bonjour,\n\nNous sollicitons votre avis dans le cadre de l'instruction du dossier ${dossier.numero}` +
      `${dossier.adresse ? ` situé ${dossier.adresse}` : ""}.\n\n` +
      `Vous pouvez consulter le dossier et nous répondre directement via cette messagerie.\n\nCordialement,`,
    );
    setShowMissionModal(true);
    // La modale n'est rendue que dans l'onglet « Consultations ». On bascule
    // donc dessus pour que le missionnement déclenché depuis l'onglet
    // « Terrain » (bouton « Missionner l'ABF ») soit visible — sinon l'état est
    // activé mais la fenêtre ne s'affiche pas. Sur l'onglet Consultations,
    // c'est un no-op.
    setActiveTab("Consultations");
    const preselect = (list: AvailableService[]) => {
      if (preferType) {
        const match = list.find(s => s.type === preferType);
        if (match) setMissionServiceId(match.id);
      }
    };
    if (availableServices === null) {
      api.get<AvailableService[]>(`/mairie/dossiers/${dossier.id}/available-services`)
        .then(list => { setAvailableServices(list); preselect(list); })
        .catch(() => setAvailableServices([]));
    } else {
      preselect(availableServices);
    }
  };

  const submitMission = async () => {
    const svc = (availableServices ?? []).find(s => s.id === missionServiceId);
    if (!svc) return;
    setConsultationsMissioning(true);
    try {
      await api.post(`/mairie/dossiers/${dossier.id}/consultations`, {
        service_name: svc.name,
        service_type: svc.type,
        external_service_id: svc.id,
        message: missionMessage.trim() || undefined,
      });
      setShowMissionModal(false);
      // Refresh and switch to consultations tab
      setConsultations(null);
      setActiveTab("Consultations");
    } catch {
      // silently ignore
    } finally {
      setConsultationsMissioning(false);
    }
  };

  const daysLeft = dossier.echeance && dossier.echeance !== "—"
    ? Math.ceil((new Date(dossier.echeance.split("/").reverse().join("-")).getTime() - Date.now()) / 86400000)
    : null;

  const typeLabel = TYPE_LABEL[liveType] ?? liveType;

  // ── Workflow d'instruction (statut + assignation) ──
  // Source de vérité côté serveur : la machine à états partagée. On reflète ici
  // les actions disponibles renvoyées par GET /mairie/dossiers/:id et on
  // rafraîchit après chaque mutation pour rester synchronisé.
  const [workflow, setWorkflow] = useState<WorkflowMeta | null>(dossier.workflow ?? null);
  const [currentStatus, setCurrentStatus] = useState<string>(dossier.status);
  const [currentInstructeur, setCurrentInstructeur] = useState<string | undefined>(dossier.instructeur);
  const [currentInstructeurId, setCurrentInstructeurId] = useState<string | undefined>(dossier.instructeur_id);
  const [instructeurOptions, setInstructeurOptions] = useState<Array<{ id: string; prenom: string; nom: string }>>([]);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [showAssignPicker, setShowAssignPicker] = useState(false);

  const instructeurName = currentInstructeur ?? "Non assigné";

  // Pré-charge les pièces + le rapport conformité quand on entre dans le mode
  // "Demande de pièces complémentaires" — sinon le sélecteur s'ouvrirait sur
  // une liste vide tant que l'instructeur n'a pas visité l'onglet Instruction.
  useEffect(() => {
    if (courrierMode !== "pieces_complementaires") return;
    if (documents === null && !documentsLoading) {
      setDocumentsLoading(true);
      api.get<DossierPiece[]>(`/mairie/dossiers/${dossier.id}/pieces`)
        .then((data) => setDocuments(data))
        .catch(() => setDocuments([]))
        .finally(() => setDocumentsLoading(false));
    }
    if (conformite === null) {
      api.get<{ status: string; report: ConformiteReport | null; analyzed_at: string | null }>(`/mairie/dossiers/${dossier.id}/conformite`)
        .then(setConformite)
        .catch(() => setConformite({ status: "absent", report: null, analyzed_at: null }));
    }
  }, [courrierMode, documents, documentsLoading, conformite, dossier.id]);

  const refreshWorkflow = useCallback(async () => {
    type ApiDetail = {
      status: string;
      instructeur_id: string | null;
      instructeur: { prenom?: string; nom?: string } | null;
      workflow?: WorkflowMeta;
    };
    try {
      const fresh = await api.get<ApiDetail>(`/mairie/dossiers/${dossier.id}`);
      setWorkflow(fresh.workflow ?? null);
      setCurrentStatus(fresh.status);
      setCurrentInstructeur(fresh.instructeur ? ([fresh.instructeur.prenom, fresh.instructeur.nom].filter(Boolean).join(" ") || undefined) : undefined);
      setCurrentInstructeurId(fresh.instructeur_id ?? undefined);
    } catch (e) {
      console.warn("Workflow refresh failed", e);
    }
  }, [dossier.id]);

  const ensureInstructeursLoaded = useCallback(async () => {
    if (instructeurOptions.length > 0) return;
    try {
      const list = await api.get<Array<{ id: string; prenom: string; nom: string }>>("/mairie/instructeurs");
      setInstructeurOptions(list);
    } catch (e) {
      console.warn("Instructeurs list failed", e);
    }
  }, [instructeurOptions.length]);

  const runWorkflowAction = useCallback(async (fn: () => Promise<unknown>) => {
    setWorkflowBusy(true);
    setWorkflowError(null);
    try {
      await fn();
      await refreshWorkflow();
    } catch (e) {
      setWorkflowError(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setWorkflowBusy(false);
    }
  }, [refreshWorkflow]);

  const handleTakeCharge = useCallback(() =>
    runWorkflowAction(() => api.post(`/mairie/dossiers/${dossier.id}/take-charge`, {})),
    [dossier.id, runWorkflowAction]);

  const handleTransition = useCallback((target: DossierStatus, reason?: string) =>
    runWorkflowAction(() => api.patch(`/mairie/dossiers/${dossier.id}/status`, { status: target, reason: reason ?? null })),
    [dossier.id, runWorkflowAction]);

  const handleAssign = useCallback((instructeurId: string) =>
    runWorkflowAction(async () => {
      await api.patch(`/mairie/dossiers/${dossier.id}/assign`, { instructeur_id: instructeurId });
      setShowAssignPicker(false);
    }),
    [dossier.id, runWorkflowAction]);

  const handleUnassign = useCallback(() =>
    runWorkflowAction(() => api.delete(`/mairie/dossiers/${dossier.id}/assign`)),
    [dossier.id, runWorkflowAction]);

  // Fallback si l'API ne renvoie pas encore le bloc workflow (ex. cache front).
  const nextAction = workflow?.next_action ?? primaryNextActionFor(currentStatus as DossierStatus);
  const allowedTransitions = workflow?.allowed_transitions ?? [];
  const canTakeCharge = workflow?.can_take_charge ?? false;
  const canReassign = workflow?.can_reassign ?? false;
  const canUnassign = workflow?.can_unassign ?? false;

  const CARD: React.CSSProperties = { background: "white", borderRadius: 14, border: "1px solid #E8EEF4", padding: 22, boxShadow: "0 1px 4px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)" };
  const SH: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 18 };
  const LABEL_ST: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 };
  const VALUE_ST: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: "#1E293B" };

  const Divider = () => <div style={{ height: 1, background: "#F1F5F9", margin: "4px 0" }} />;

  const SecTitle = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 3, height: 14, background: "#4F46E5", borderRadius: 2, display: "inline-block", flexShrink: 0 }} />
        {children}
      </div>
      {action}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, height: "100%", background: "#F3F4F8" }}>
      {/* ── Sticky header ── */}
      <div style={{ background: "white", borderBottom: "1px solid #E8EEF4", padding: "14px 28px 0", position: "sticky", top: 0, zIndex: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        {/* top bar: back + actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: "none", color: "#64748b", fontSize: 13, cursor: "pointer", padding: 0, fontWeight: 500, letterSpacing: "-0.1px" }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            Retour aux dossiers
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => navigate("Messagerie")} style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "7px 15px", fontSize: 12.5, color: "#374151", cursor: "pointer", fontWeight: 500, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
              Contacter le pétitionnaire
            </button>
            <button onClick={() => setCourrierMode("general")} style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "7px 15px", fontSize: 12.5, color: "#374151", cursor: "pointer", fontWeight: 500, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              Générer un courrier
            </button>
            <button style={{ display: "flex", alignItems: "center", gap: 7, background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 9, padding: "7px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(79,70,229,0.35)" }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Exporter le dossier
            </button>
          </div>
        </div>

        {/* identity row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          {/* left: numero + description + meta */}
          <div style={{ flex: 1, minWidth: 0, marginRight: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0F172A", margin: 0, letterSpacing: "-0.8px", lineHeight: 1 }}>{dossier.numero}</h1>
              <StatusBadge status={currentStatus} />
            </div>
            {(() => {
              const fullDesc = dossier.description ?? "";
              const shortDesc = fullDesc.length > 60 ? `${fullDesc.slice(0, 60).trimEnd()}…` : fullDesc;
              return (
                <div
                  title={fullDesc ? `${typeLabel} – ${fullDesc}` : typeLabel}
                  style={{ fontSize: 13, color: "#475569", fontWeight: 500, marginBottom: 8 }}
                >{typeLabel}{shortDesc ? ` – ${shortDesc}` : ""}</div>
              );
            })()}
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" as const }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#334155" }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                <span style={{ fontWeight: 500 }}>{dossier.petitionnaire}</span>
                {petitionnaireInvited ? (
                  <span title="Invitation envoyée" style={{ fontSize: 11, color: "#16A34A", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>✓ invité</span>
                ) : dossier.petitionnaire_can_invite ? (
                  <button
                    title={dossier.petitionnaire_is_placeholder
                      ? "Ce pétitionnaire n'a pas de compte exploitable — l'inviter à activer son espace"
                      : "Renvoyer l'invitation à activer l'espace citoyen"}
                    onClick={() => setShowInvitePetitionnaire(true)}
                    style={{ padding: "1px 8px", fontSize: 10.5, color: "#B45309", background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 5, cursor: "pointer", marginLeft: 2, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}
                  >
                    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                    Inviter
                  </button>
                ) : null}
              </span>
              {showInvitePetitionnaire && (
                <InvitePetitionnaireModal
                  dossierId={dossier.id}
                  initialEmail={dossier.petitionnaire_email ?? ""}
                  isPlaceholder={!!dossier.petitionnaire_is_placeholder}
                  petitionnaireName={dossier.petitionnaire}
                  onClose={() => setShowInvitePetitionnaire(false)}
                  onInvited={() => { setShowInvitePetitionnaire(false); setPetitionnaireInvited(true); }}
                />
              )}
              <span style={{ color: "#CBD5E1", fontSize: 12 }}>·</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#334155" }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                {liveAdresse ?? "—"}{liveCommune ? `, ${liveCommune}` : ""}
                <button
                  title="Modifier l'adresse"
                  onClick={() => { setShowAddressEditor(v => !v); setAddrQuery(""); setAddrSuggestions([]); }}
                  style={{ padding: "1px 6px", fontSize: 10, color: showAddressEditor ? "#4F46E5" : "#94a3b8", background: showAddressEditor ? "#EEF2FF" : "none", border: "1px solid " + (showAddressEditor ? "#4F46E5" : "#E2E8F0"), borderRadius: 4, cursor: "pointer", marginLeft: 2, fontWeight: 500 }}
                >✏️</button>
              </span>
              {(() => {
                const pp = parcelAnalysis?.parcel;
                const parcelleLabel = dossier.parcelle ?? (pp ? `${pp.section} ${pp.numero}` : null);
                return parcelleLabel ? (
                  <>
                    <span style={{ color: "#CBD5E1", fontSize: 12 }}>·</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#334155" }}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                      {parcelleLabel}
                    </span>
                  </>
                ) : null;
              })()}
              <span style={{ color: "#CBD5E1", fontSize: 12 }}>·</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#334155" }} title="Instructeur">
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="17 11 19 13 23 9" /></svg>
                <span style={{ fontWeight: 500, color: currentInstructeurId ? "#334155" : "#94a3b8" }}>{instructeurName}</span>
              </span>
            </div>
          </div>
          {/* right: date chips */}
          <div style={{ display: "flex", gap: 6, flexShrink: 0, marginTop: 2 }}>
            <div style={{ background: "#F8FAFC", border: "1px solid #E8EEF4", borderRadius: 10, padding: "8px 14px", textAlign: "center" as const, minWidth: 110 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 3 }}>Déposé le</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{dossier.date_depot ? fmtDate(dossier.date_depot) : "—"}</div>
            </div>
            <div
              style={{ background: "#F8FAFC", border: "1px solid #E8EEF4", borderRadius: 10, padding: "8px 14px", textAlign: "center" as const, minWidth: 110, cursor: dossier.delai ? "pointer" : "default", position: "relative" as const }}
              onClick={() => dossier.delai && setShowDelaiPopover((v) => !v)}
              title={dossier.delai ? `Délai légal : ${dossier.delai.total_mois} mois — cliquer pour détail` : undefined}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 3 }}>Échéance</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{dossier.echeance}</span>
                {daysLeft !== null && (
                  <span style={{ background: daysLeft < 14 ? "#FEF2F2" : "#EFF6FF", color: daysLeft < 14 ? "#DC2626" : "#2563EB", borderRadius: 5, padding: "1px 6px", fontSize: 11, fontWeight: 800, letterSpacing: "-0.2px" }}>
                    J{daysLeft >= 0 ? `-${daysLeft}` : `+${Math.abs(daysLeft)}`}
                  </span>
                )}
              </div>
              {showDelaiPopover && dossier.delai && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute" as const, top: "calc(100% + 6px)", right: 0, width: 360, background: "white", border: "1px solid #E2E8F0", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.12)", padding: 16, zIndex: 1100, textAlign: "left" as const }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Délai légal d'instruction</div>
                    <button onClick={() => setShowDelaiPopover(false)} style={{ border: "none", background: "transparent", fontSize: 16, cursor: "pointer", color: "#94a3b8", padding: 0 }}>✕</button>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 10, lineHeight: 1.5 }}>
                    Calculé à partir du {dossier.delai.base_date ? new Date(dossier.delai.base_date).toLocaleDateString("fr-FR") : "—"}
                    {dossier.delai.base_date_source && (
                      <span> ({dossier.delai.base_date_source === "completude" ? "date de complétude" : "date de dépôt"})</span>
                    )}
                  </div>
                  <div style={{ borderTop: "1px solid #F1F5F9", marginBottom: 6 }} />
                  {dossier.delai.breakdown.map((b, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: i < dossier.delai!.breakdown.length - 1 ? "1px dashed #F1F5F9" : "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: "#0F172A", fontWeight: 500 }}>{b.label}</div>
                        <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{linkifyArticles(b.article)}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5", flexShrink: 0, marginLeft: 8 }}>
                        {b.mois > 0 ? `+${b.mois}` : b.mois} mois
                      </div>
                    </div>
                  ))}
                  <div style={{ borderTop: "1px solid #F1F5F9", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A" }}>Total</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#4F46E5" }}>{dossier.delai.total_mois} mois</span>
                  </div>
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #F1F5F9", display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.04em" }}>DATE DE COMPLÉTUDE</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="date" defaultValue={dossier.date_completude ? dossier.date_completude.slice(0, 10) : ""}
                        onChange={(e) => setCompletudeDraft(e.target.value)}
                        style={{ flex: 1, border: "1px solid #D1D5DB", borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: "inherit" }} />
                      <button onClick={() => void saveCompletude()}
                        disabled={delaiSaving}
                        style={{ border: "none", background: delaiSaving ? "#C7D2FE" : "#4F46E5", color: "white", borderRadius: 6, padding: "5px 12px", fontSize: 11.5, fontWeight: 600, cursor: delaiSaving ? "default" : "pointer" }}>
                        Enregistrer
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Bandeau workflow d'instruction ── */}
        {/* CTA contextuel (prochaine étape attendue) + actions d'assignation.
            Le bloc se rétracte naturellement sur dossiers terminaux (accepté /
            refusé) où aucune action n'est plus attendue. */}
        {(nextAction || canTakeCharge || canReassign || canUnassign || workflowError) && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const,
            padding: "6px 12px", marginBottom: 10,
            background: "#FAFBFF",
            border: "1px solid #E8EBF7", borderRadius: 10,
          }}>
            {/* Côté gauche : action principale ─────────────────────────── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto", minWidth: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#4F46E5", letterSpacing: "0.06em", textTransform: "uppercase" as const, flexShrink: 0 }}>Prochaine étape</span>
              <span style={{ color: "#CBD5E1", fontSize: 12, flexShrink: 0 }}>·</span>
              <span style={{ fontSize: 12.5, color: "#1E293B", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const, minWidth: 0 }}>
                {nextAction
                  ? nextAction.hint
                  : (currentStatus === "decision_en_cours"
                    ? "L'arrêté est en circuit de signature."
                    : currentStatus === "brouillon"
                      ? "Le pétitionnaire n'a pas encore soumis le dossier."
                      : "Aucune action attendue à ce stade.")}
              </span>
            </div>

            {/* Côté droit : CTA + transitions secondaires + assignation ─── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" as const }}>
              {canTakeCharge && (
                <button
                  onClick={handleTakeCharge}
                  disabled={workflowBusy}
                  style={{
                    background: "#4F46E5", color: "white", border: "none",
                    borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600,
                    cursor: workflowBusy ? "default" : "pointer",
                    opacity: workflowBusy ? 0.7 : 1,
                  }}>
                  Prendre en charge
                </button>
              )}

              {nextAction && !canTakeCharge && (
                <button
                  onClick={() => handleTransition(nextAction.target_status)}
                  disabled={workflowBusy}
                  style={{
                    background: nextAction.variant === "success" ? "#16A34A"
                              : nextAction.variant === "warning" ? "#D97706"
                              : "#4F46E5",
                    color: "white", border: "none", borderRadius: 6, padding: "5px 11px",
                    fontSize: 12, fontWeight: 600, cursor: workflowBusy ? "default" : "pointer",
                    opacity: workflowBusy ? 0.7 : 1,
                  }}>
                  {nextAction.label}
                </button>
              )}

              {allowedTransitions.filter(s => s !== nextAction?.target_status).map(target => (
                <button
                  key={target}
                  onClick={() => handleTransition(target)}
                  disabled={workflowBusy}
                  title={`Passer en : ${DOSSIER_STATUS_LABELS[target]}`}
                  style={{
                    background: "transparent", color: "#64748b", border: "1px solid #E2E8F0",
                    borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 500,
                    cursor: workflowBusy ? "default" : "pointer", opacity: workflowBusy ? 0.6 : 1,
                  }}>
                  → {DOSSIER_STATUS_LABELS[target]}
                </button>
              ))}

              {/* Demande de pièces complémentaires : disponible pendant toute
                  la phase de complétude (pre_instruction / incomplet) et même
                  une fois passé à en_instruction si un complément est jugé
                  nécessaire au fond. */}
              {(["pre_instruction", "incomplet", "en_instruction"] as const).includes(currentStatus as "pre_instruction" | "incomplet" | "en_instruction") && (
                <button
                  onClick={() => setCourrierMode("pieces_complementaires")}
                  disabled={workflowBusy}
                  title="Construire et émettre une demande de pièces complémentaires"
                  style={{
                    background: "white", color: "#B45309", border: "1px solid #FDE68A",
                    borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600,
                    cursor: workflowBusy ? "default" : "pointer", display: "flex", alignItems: "center", gap: 5,
                  }}>
                  📎 Demander des pièces
                </button>
              )}

              {(canReassign || canUnassign) && (
                <div style={{ position: "relative" as const }}>
                  <button
                    onClick={() => { setShowAssignPicker(v => !v); if (!showAssignPicker) void ensureInstructeursLoaded(); }}
                    disabled={workflowBusy}
                    style={{
                      background: "transparent", color: "#64748b", border: "1px solid #E2E8F0",
                      borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 500, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                    }}>
                    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    {currentInstructeurId ? "Réassigner" : "Assigner"}
                  </button>
                  {showAssignPicker && (
                    <>
                      <div onClick={() => setShowAssignPicker(false)} style={{ position: "fixed", inset: 0, zIndex: 98 }} />
                      <div style={{
                        position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 99,
                        background: "white", border: "1px solid #E2E8F0", borderRadius: 10,
                        boxShadow: "0 10px 32px rgba(15,23,42,0.16)", minWidth: 240,
                        maxHeight: 320, overflowY: "auto" as const, padding: 4,
                      }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" as const, padding: "8px 12px 4px" }}>Choisir un instructeur</div>
                        {instructeurOptions.length === 0 ? (
                          <div style={{ padding: "10px 12px", fontSize: 12.5, color: "#94a3b8" }}>Chargement…</div>
                        ) : instructeurOptions.map(opt => {
                          const isCurrent = opt.id === currentInstructeurId;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => handleAssign(opt.id)}
                              disabled={workflowBusy || isCurrent}
                              style={{
                                display: "flex", alignItems: "center", gap: 8, width: "100%",
                                background: isCurrent ? "#F1F5F9" : "transparent", border: "none",
                                padding: "8px 12px", borderRadius: 8, fontSize: 13, color: "#0F172A",
                                cursor: isCurrent || workflowBusy ? "default" : "pointer", textAlign: "left" as const,
                              }}
                              onMouseEnter={e => { if (!isCurrent && !workflowBusy) e.currentTarget.style.background = "#F8FAFC"; }}
                              onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}>
                              <span style={{ flex: 1 }}>{opt.prenom} {opt.nom}</span>
                              {isCurrent && <span style={{ fontSize: 10.5, color: "#16A34A", fontWeight: 600 }}>en charge</span>}
                            </button>
                          );
                        })}
                        {canUnassign && (
                          <button
                            onClick={() => { setShowAssignPicker(false); void handleUnassign(); }}
                            disabled={workflowBusy}
                            style={{
                              display: "block", width: "100%", border: "none", background: "transparent",
                              color: "#B91C1C", fontSize: 12.5, padding: "8px 12px", borderTop: "1px solid #F1F5F9",
                              textAlign: "left" as const, cursor: workflowBusy ? "default" : "pointer", marginTop: 4,
                            }}>
                            Retirer l'instructeur
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {workflowError && (
              <div style={{ width: "100%", marginTop: 4, fontSize: 12, color: "#B91C1C" }}>{workflowError}</div>
            )}
          </div>
        )}

        {/* Éditeur d'adresse (dans l'en-tête sticky) */}
        {showAddressEditor && (
          <div style={{ padding: "0 0 12px", display: "flex", flexDirection: "column" as const, gap: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ position: "relative" as const, flex: 1 }}>
                <input
                  autoFocus
                  value={addrQuery}
                  onChange={e => setAddrQuery(e.target.value)}
                  placeholder="Ex : 12 rue du Commerce, Ballan-Miré"
                  style={{ width: "100%", padding: "7px 11px", border: "1.5px solid #4F46E5", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const, color: "#0F172A" }}
                />
                {addrSugLoading && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#94a3b8" }}>…</span>}
                {addrSuggestions.length > 0 && (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "white", border: "1px solid #E2E8F0", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 100, overflow: "hidden" }}>
                    {addrSuggestions.map((s, i) => (
                      <button
                        key={i}
                        onMouseDown={() => handleAddressSelect(s)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#374151", borderBottom: i < addrSuggestions.length - 1 ? "1px solid #F1F5F9" : "none" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                        onMouseLeave={e => (e.currentTarget.style.background = "none")}
                      >
                        <span style={{ fontWeight: 500 }}>{s.label}</span>
                        <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 6 }}>{s.postcode}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => { setShowAddressEditor(false); setAddrQuery(""); setAddrSuggestions([]); }} style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, color: "#64748b", background: "white", cursor: "pointer", whiteSpace: "nowrap" as const }}>Annuler</button>
            </div>
            {addrSaving && <span style={{ fontSize: 11, color: "#64748b" }}>Sauvegarde…</span>}
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0 }}>
          {DETAIL_TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              display: "flex", alignItems: "center", gap: 6,
              border: "none", background: "none", padding: "10px 18px", fontSize: 12.5, cursor: "pointer",
              fontWeight: activeTab === tab ? 700 : 500,
              color: activeTab === tab ? "#4F46E5" : "#64748b",
              borderBottom: activeTab === tab ? "2.5px solid #4F46E5" : "2.5px solid transparent",
              transition: "color 0.12s",
              marginBottom: -1,
            }}>
              <span style={{ opacity: activeTab === tab ? 1 : 0.6 }}>{TAB_ICONS[tab]}</span>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflowY: "auto" as const, padding: "20px 24px" }}>

        {/* ── RÉSUMÉ ── */}
        {activeTab === "Résumé" && (
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {/* Infos principales */}
              <div style={CARD}>
                <SecTitle>Informations principales</SecTitle>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
                  {(() => {
                    const pp = parcelAnalysis?.parcel;
                    const parcelleLabel = dossier.parcelle
                      ?? (pp ? `${pp.section} ${pp.numero}` : null)
                      ?? (parcelLoading ? "Identification…" : "—");
                    return [
                      ["Pétitionnaire", dossier.petitionnaire],
                      ["Adresse", liveAdresse ?? "—"],
                      ["Commune", `${liveCommune ?? "—"}${dossier.code_postal ? ` (${dossier.code_postal})` : ""}`],
                      ["Parcelle", parcelleLabel],
                      ["Surface de plancher", dossier.surface_plancher ? `${dossier.surface_plancher} m²` : "—"],
                      ["Date de dépôt", dossier.date_depot ? fmtDate(dossier.date_depot) : "—"],
                      ["Échéance", dossier.echeance],
                    ];
                  })().reduce<React.ReactNode[]>((acc, [l, v], idx) => {
                    acc.push(
                      <div key={l}>
                        <div style={LABEL_ST}>{l}</div>
                        <div style={VALUE_ST}>{v}</div>
                      </div>,
                    );
                    // Le type de dossier est inséré juste après le pétitionnaire,
                    // avec un éditeur inline qui appelle PATCH /mairie/dossiers/:id/type.
                    if (idx === 0) {
                      acc.push(
                        <div key="type-row">
                          <div style={{ ...LABEL_ST, display: "flex", alignItems: "center", gap: 8 }}>
                            <span>Type de dossier</span>
                            <button
                              onClick={() => setShowTypeEditor(v2 => !v2)}
                              disabled={typeSaving}
                              style={{
                                padding: "1px 6px", fontSize: 10,
                                color: showTypeEditor ? "#4F46E5" : "#94a3b8",
                                background: showTypeEditor ? "#EEF2FF" : "none",
                                border: "1px solid " + (showTypeEditor ? "#4F46E5" : "#E2E8F0"),
                                borderRadius: 4, cursor: typeSaving ? "wait" : "pointer", fontWeight: 500,
                              }}>
                              {showTypeEditor ? "Annuler" : "Modifier"}
                            </button>
                          </div>
                          {showTypeEditor ? (
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                              <select
                                defaultValue={liveType}
                                disabled={typeSaving}
                                onChange={(e) => { void saveType(e.target.value); }}
                                style={{
                                  flex: 1, padding: "7px 8px", border: "1px solid #E2E8F0",
                                  borderRadius: 8, fontSize: 12, background: "white",
                                }}>
                                {DOSSIER_TYPE_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                              {typeSaving && <span style={{ fontSize: 11, color: "#94a3b8" }}>Enregistrement…</span>}
                            </div>
                          ) : (
                            <div style={VALUE_ST}>{typeLabel}</div>
                          )}
                        </div>,
                      );
                    }
                    return acc;
                  }, [])}
                </div>
              </div>
              {/* Avancement */}
              <div style={{ ...CARD, display: "flex", flexDirection: "column" as const }}>
                <SecTitle>Avancement du dossier</SecTitle>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, justifyContent: "center" }}>
                  {([
                    { label: "Dépôt", done: true, tab: null },
                    { label: "Complétude", done: !["brouillon","soumis"].includes(dossier.status), tab: "Documents" },
                    { label: "Instruction", done: ["en_instruction","decision_en_cours","accepte","refuse","accord_prescription"].includes(dossier.status), tab: "Instruction" },
                    { label: "Consultations", done: consultationsDone, tab: "Consultations" },
                    { label: "Décision", done: ["accepte","refuse","accord_prescription"].includes(dossier.status), tab: "Décision" },
                  ] as Array<{ label: string; done: boolean; tab: DetailTab | null }>).map((step, i) => (
                    <div
                      key={i}
                      onClick={() => { if (step.tab) setActiveTab(step.tab); }}
                      style={{ display: "flex", alignItems: "center", gap: 12, cursor: step.tab ? "pointer" : "default", borderRadius: 8, padding: step.tab ? "3px 5px" : 0, marginLeft: step.tab ? -5 : 0, marginRight: step.tab ? -5 : 0, marginBottom: i < 4 ? 12 : 0 }}
                      onMouseEnter={(e) => { if (step.tab) (e.currentTarget as HTMLDivElement).style.background = "#F8FAFC"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: step.done ? "linear-gradient(135deg,#4F46E5,#6366F1)" : "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: step.done ? "0 2px 6px rgba(79,70,229,0.3)" : "none" }}>
                        {step.done ? <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : <span style={{ fontSize: 11, color: "#CBD5E1", fontWeight: 700 }}>{i + 1}</span>}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: step.done ? 600 : 400, color: step.done ? "#0F172A" : "#94a3b8" }}>{step.label}</span>
                      {step.tab ? <span style={{ color: "#CBD5E1", fontSize: 16 }}>›</span> : null}
                    </div>
                  ))}
                </div>
              </div>
              {/* Mini map */}
              <div style={{ ...CARD, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" as const }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 8px", flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Localisation</div>
                  {(() => { const rLat = parcelAnalysis?.address?.lat ?? dossier.lat; const rLng = parcelAnalysis?.address?.lng ?? dossier.lng; return (rLat && rLng) ? (
                    <button onClick={() => setShowMapFull(true)} title="Agrandir la carte"
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", border: "1px solid #E2E8F0", borderRadius: 6, background: "white", color: "#64748b", fontSize: 11, cursor: "pointer", fontWeight: 500 }}>
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                      Agrandir
                    </button>
                  ) : null; })()}
                </div>
                {(() => { const rLat = parcelAnalysis?.address?.lat ?? dossier.lat; const rLng = parcelAnalysis?.address?.lng ?? dossier.lng; return rLat && rLng ? (
                  <div style={{ flex: 1, minHeight: 200 }}>
                    <MapLeaflet dossiers={[{ id: dossier.id, numero: dossier.numero, type: dossier.type, status: dossier.status, adresse: liveAdresse ?? dossier.adresse, lat: rLat, lng: rLng }]} height="100%" commune={liveCommune ?? dossier.commune} />
                  </div>
                ) : (
                  <div style={{ flex: 1, minHeight: 200, background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" as const, gap: 8 }}>
                    <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>Géolocalisation indisponible</span>
                  </div>
                ); })()}
              </div>
            </div>

            {/* ── Description du projet ── */}
            <div style={{ ...CARD, display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div style={{ width: 36, height: 36, background: "#EEF2FF", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Description du projet</div>
                {dossier.description ? (
                  <p style={{ margin: 0, fontSize: 14, color: "#1E293B", lineHeight: 1.65 }}>{dossier.description}</p>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>Aucune description renseignée.</p>
                )}
              </div>
            </div>

            {/* Map fullscreen modal */}
            {showMapFull && (() => { const rLat = parcelAnalysis?.address?.lat ?? dossier.lat; const rLng = parcelAnalysis?.address?.lng ?? dossier.lng; return rLat && rLng ? (
              <div style={{ position: "fixed", inset: 0, zIndex: 1001, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowMapFull(false)}>
                <div style={{ width: "85vw", maxWidth: 1000, background: "white", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #E2E8F0" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#0F172A" }}>Localisation — {dossier.numero}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{liveAdresse ?? dossier.adresse}</div>
                    </div>
                    <button onClick={() => setShowMapFull(false)} style={{ padding: 6, border: "1px solid #E2E8F0", borderRadius: 8, background: "white", cursor: "pointer", display: "flex" }}>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                  <MapLeaflet dossiers={[{ id: dossier.id, numero: dossier.numero, type: dossier.type, status: dossier.status, adresse: liveAdresse ?? dossier.adresse, lat: rLat, lng: rLng }]} height={520} commune={liveCommune ?? dossier.commune} />
                </div>
              </div>
            ) : null; })()}
          </div>
        )}

        {/* ── PARCELLE ── */}
        {activeTab === "Terrain" && (() => {
          // Écran Terrain — contexte décisionnel.
          // Affiche le cadastre, les contraintes fortes (PLU/risques/SUP/prescriptions
          // surfaciques), une constructibilité synthétique, et l'historique SITADEL/ADS
          // de la parcelle. Le règlement détaillé et les PDF d'OAP/PPRI sont dans
          // l'onglet Instruction — c'est là que se fait la confrontation pièce ↔ règle.
          const zoneColor = (t?: string) => t === "N" || t === "A" ? { c: "#15803D", bg: "#F0FDF4" } : { c: "#4F46E5", bg: "#EEF2FF" };
          const pa = parcelAnalysis;

          if (parcelLoading) return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 12, color: "#64748b", fontSize: 14 }}>
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              Analyse en cours…
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          );

          // CTA récurrent : tous les renvois vers le règlement complet, les
          // citations et les PDF d'OAP/PPRI pointent vers l'onglet Documents
          // (l'espace de preuve, ex-"Instruction").
          const goToDocuments = (docType?: string) => {
            setActiveTab("Documents");
            if (docType) {
              setDocsViewMode("compare");
              setDocsRegulatoryDocTypeHint(docType);
              setDocsRegulatoryDocPage(null);
            }
          };
          const InstructionLink = ({ label, docType }: { label: string; docType?: string }) => (
            <button
              onClick={() => goToDocuments(docType)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#4F46E5", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              {label} →
            </button>
          );

          // ── Helpers visuels (vue Terrain) ──────────────────────────────
          // Palette de tons partagée par les pastilles et les filets de carte.
          const tones = {
            danger:  { c: "#B91C1C", bg: "#FEF2F2", bd: "#FECACA" },
            warn:    { c: "#B45309", bg: "#FFFBEB", bd: "#FDE68A" },
            ok:      { c: "#15803D", bg: "#F0FDF4", bd: "#BBF7D0" },
            info:    { c: "#4F46E5", bg: "#EEF2FF", bd: "#C7D2FE" },
            abf:     { c: "#92400E", bg: "#FEF3C7", bd: "#FCD34D" },
            neutral: { c: "#475569", bg: "#F8FAFC", bd: "#E2E8F0" },
          } as const;
          type Tone = keyof typeof tones;
          // Pastille de synthèse : lecture « d'un coup d'œil » en tête de carte.
          const Pill = ({ icon, label, tone }: { icon: string; label: string; tone: Tone }) => {
            const t = tones[tone];
            return (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: t.c, background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 999, padding: "4px 11px", whiteSpace: "nowrap" as const }}>
                <span style={{ fontSize: 12 }}>{icon}</span>{label}
              </span>
            );
          };
          // Carte de contrainte unifiée : filet coloré à gauche + pastille icône.
          // Remplace les fonds pleins teintés — plus léger et plus lisible quand
          // plusieurs SUP / prescriptions s'empilent.
          const ConstraintItem = ({ rail, icon, title, code, children, footer }: { rail: string; icon: string; title: string; code?: string; children?: React.ReactNode; footer?: React.ReactNode }) => (
            <div style={{ display: "flex", background: "white", border: "1px solid #E8EEF4", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
              <div style={{ width: 4, background: rail, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, padding: "11px 13px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 7, background: `${rail}1A`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{icon}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: "#0F172A", lineHeight: 1.35 }}>{title}</span>
                  {code && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: "#64748B", background: "#F1F5F9", borderRadius: 5, padding: "2px 6px", letterSpacing: "0.03em" }}>{code}</span>}
                </div>
                {children && <div style={{ marginTop: 8, paddingLeft: 35 }}>{children}</div>}
                {footer && <div style={{ marginTop: 8, paddingLeft: 35, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" as const }}>{footer}</div>}
              </div>
            </div>
          );
          // Intitulé de colonne — oriente la lecture (« contraintes » vs « potentiel »).
          const ColHeading = ({ children }: { children: React.ReactNode }) => (
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.07em", padding: "0 2px 2px" }}>{children}</div>
          );

          return (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
              {/* ── En-tête : carte d'identité du terrain (pleine largeur) ── */}
              {(() => {
                const zc = pa?.plu_zone ?? (pa?.db_zone ? { zone_code: pa.db_zone.code, zone_label: pa.db_zone.label ?? pa.db_zone.code, zone_type: pa.db_zone.type ?? "U" } : null);
                const col = zoneColor(zc?.zone_type);
                const ruleCount = pa?.rules?.filter((r) => r.relevance !== "excluded").length ?? 0;
                const facts: Array<[string, string]> = [
                  ["Référence", pa?.parcel?.parcelle_id ?? dossier.parcelle ?? "—"],
                  ["Section / N°", pa?.parcel ? `${pa.parcel.section} / ${pa.parcel.numero}` : "—"],
                  ["Surface", pa?.parcel?.surface_m2 ? `${pa.parcel.surface_m2} m²` : "—"],
                  ["Commune", pa?.parcel?.commune ?? liveCommune ?? "—"],
                  ["Adresse", pa?.address?.label ?? liveAdresse ?? "—"],
                ];
                return (
                  <div style={{ ...CARD, padding: 18 }}>
                    <div style={{ display: "flex", alignItems: "stretch", justifyContent: "space-between", gap: 18, flexWrap: "wrap" as const }}>
                      <div style={{ display: "flex", gap: 26, rowGap: 14, flexWrap: "wrap" as const, flex: 1, minWidth: 0, alignItems: "flex-start" }}>
                        {facts.map(([l, v]) => (
                          <div key={l} style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>{l}</div>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" as const }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 6, flexShrink: 0, background: col.bg, border: `1px solid ${col.c}33`, borderRadius: 12, padding: "12px 16px", minWidth: 150 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: col.c, textTransform: "uppercase" as const, letterSpacing: "0.06em", opacity: 0.85 }}>Zone PLU</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: col.c, lineHeight: 1 }}>{zc?.zone_code ?? "—"}</div>
                        {zc?.zone_label && <div style={{ fontSize: 11, color: "#475569", textAlign: "right" as const, maxWidth: 200, lineHeight: 1.4 }}>{zc.zone_label}</div>}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" as const, justifyContent: "flex-end" }}>
                          {ruleCount > 0 && <span style={{ fontSize: 10.5, fontWeight: 600, color: "#4F46E5", background: "white", border: "1px solid #C7D2FE", borderRadius: 6, padding: "2px 7px" }}>{ruleCount} article{ruleCount > 1 ? "s" : ""}</span>}
                          <InstructionLink label="Règlement complet" docType="plu" />
                        </div>
                      </div>
                    </div>
                    {pa?.plu_zone?.plu_nom && (
                      <div style={{ marginTop: 12, fontSize: 10.5, color: "#94a3b8", fontStyle: "italic" as const }}>Source GPU : {pa.plu_zone.plu_nom}</div>
                    )}
                  </div>
                );
              })()}
              {/* Warnings — on masque l'alerte ABF, déjà rendue par le bloc
                  dédié « Périmètre ABF » ci-dessous (évite le doublon). */}
              {(() => {
                const shownWarnings = (pa?.warnings ?? []).filter(w => !/ABF|Architecte des Bâtiments/i.test(w));
                if (shownWarnings.length === 0) return null;
                return (
                  <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 10, padding: "10px 14px", display: "flex", flexDirection: "column" as const, gap: 4 }}>
                    {shownWarnings.map((w, i) => (
                      <div key={i} style={{ fontSize: 12.5, color: "#92400E", display: "flex", gap: 6, alignItems: "flex-start" }}>
                        <span style={{ flexShrink: 0 }}>⚠️</span>{w}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {parcelError && (
                <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 12.5, color: "#991B1B" }}>{parcelError}</span>
                  <button
                    onClick={() => { setShowAddressEditor(true); setAddrQuery(""); setAddrSuggestions([]); }}
                    style={{ flexShrink: 0, padding: "5px 11px", background: "white", border: "1px solid #FECACA", borderRadius: 7, fontSize: 12, color: "#991B1B", cursor: "pointer", fontWeight: 600 }}
                  >Corriger l'adresse ✏️</button>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {/* ── Colonne gauche : ce qui contraint le terrain ── */}
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
                  <ColHeading>Ce qui contraint le terrain</ColHeading>
                  {/* Alerte ABF — missionnement direct, remontée en tête pour
                      que l'action soit visible immédiatement. */}
                  {hasABFServitude && (
                    <div style={{ background: "#FFFBEB", borderRadius: 12, padding: "16px 18px", border: "1.5px solid #FCD34D", boxShadow: "0 1px 4px rgba(245,158,11,0.12)" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", background: "#FEF3C7", border: "2px solid #FCD34D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>⚜</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>Périmètre ABF — consultation obligatoire</div>
                          <div style={{ fontSize: 12, color: "#B45309", lineHeight: 1.6, marginBottom: 12 }}>Cette parcelle est en périmètre de protection des Monuments Historiques. L'avis de l'Architecte des Bâtiments de France est requis avant toute décision.</div>
                          <button
                            onClick={() => openMissionModal("ABF")}
                            disabled={consultationsMissioning}
                            style={{ background: consultationsMissioning ? "#F5F3FF" : "linear-gradient(135deg,#8B5CF6,#7C3AED)", color: consultationsMissioning ? "#8B5CF6" : "white", border: consultationsMissioning ? "1px solid #C4B5FD" : "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: consultationsMissioning ? "default" : "pointer", boxShadow: consultationsMissioning ? "none" : "0 2px 5px rgba(124,58,237,0.3)" }}
                          >
                            {consultationsMissioning ? "Envoi en cours…" : "Missionner l'ABF"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Risques & servitudes */}
                  <div style={CARD}>
                    <SecTitle>Risques & servitudes</SecTitle>
                    {/* Synthèse — pastilles « d'un coup d'œil ».
                        Anti-bruit : seuls les signaux exploitables émettent une
                        pastille ; les « non déterminé » sont tus (cf. riskTriage). */}
                    {(() => {
                      const hasPpri = (pa?.servitudes ?? []).some((s) => (s.categorie ?? "").toUpperCase().startsWith("PM"));
                      const flood = describeFloodRisk(pa?.risks?.flood_risk, hasPpri);
                      const clay = describeClayRisk(pa?.risks?.clay_risk);
                      const radon = describeRadonLevel(pa?.risks?.radon_level);
                      const seismicShort = seismicShortLabel(pa?.risks?.seismic_zone);
                      const supCount = pa?.servitudes?.length ?? 0;
                      const pscCount = pa?.prescriptions?.length ?? 0;
                      return (
                        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 7, marginBottom: 14 }}>
                          {hasABFServitude && <Pill icon="⚜️" label="Périmètre ABF" tone="abf" />}
                          {/* Inondation : pastille seulement si aléa avéré (tiers 1-2). */}
                          {flood.show && flood.tier <= 2 && <Pill icon="🌊" label={flood.label} tone={flood.tone as Tone} />}
                          {clay.show && <Pill icon="🟤" label="Argiles" tone={clay.tone as Tone} />}
                          {radon.show && radon.tier <= 2 && <Pill icon="☢️" label="Radon élevé" tone={radon.tone as Tone} />}
                          {seismicShort && <Pill icon="🌍" label={seismicShort} tone="neutral" />}
                          {supCount > 0 && <Pill icon="📜" label={`${supCount} servitude${supCount > 1 ? "s" : ""}`} tone="info" />}
                          {pscCount > 0 && <Pill icon="🌳" label={`${pscCount} prescription${pscCount > 1 ? "s" : ""}`} tone="ok" />}
                        </div>
                      );
                    })()}
                    {/* Zone picker when GPU fails */}
                    {!pa?.plu_zone && pa?.available_zones && pa.available_zones.length > 0 && (
                      <div style={{ marginBottom: 12, padding: "10px 14px", background: "#FFF7ED", border: "1px solid #FCD34D", borderRadius: 8 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#92400E", margin: "0 0 8px" }}>
                          Zone PLU non déterminée automatiquement — sélectionnez la zone applicable :
                        </p>
                        <select
                          value={selectedZone ?? ""}
                          onChange={e => { const v = e.target.value; setSelectedZone(v || null); setParcelAnalysis(null); setParcelError(null); }}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #D97706", borderRadius: 6, fontSize: 13, color: "#374151", background: "white", cursor: "pointer" }}
                        >
                          <option value="">— Choisir la zone —</option>
                          {pa.available_zones.map(z => (
                            <option key={z.zone_code} value={z.zone_code}>
                              {z.zone_code} – {z.zone_label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                      {/* Risques naturels — lignes « parlantes » : libellé + conséquence
                          d'instruction, triées par niveau (opposable → vigilance →
                          contexte). Les « non déterminé » sont masqués (anti-bruit). */}
                      {(() => {
                        const hasPpri = (pa?.servitudes ?? []).some((s) => (s.categorie ?? "").toUpperCase().startsWith("PM"));
                        const readings: Array<{ icon: string; key: string; theme: string; r: ReturnType<typeof describeSeismicZone> }> = [
                          { icon: "🌊", key: "flood", theme: "Inondation", r: describeFloodRisk(pa?.risks?.flood_risk, hasPpri) },
                          { icon: "🟤", key: "clay", theme: "Retrait-gonflement des argiles", r: describeClayRisk(pa?.risks?.clay_risk) },
                          { icon: "☢️", key: "radon", theme: "Radon", r: describeRadonLevel(pa?.risks?.radon_level) },
                          { icon: "🌍", key: "seismic", theme: "Sismicité", r: describeSeismicZone(pa?.risks?.seismic_zone) },
                        ].filter((x) => x.r.show).sort((a, b) => a.r.tier - b.r.tier);
                        const oppoBadge: Record<string, { txt: string; c: string } | undefined> = {
                          opposable: { txt: "Opposable", c: "#B91C1C" },
                          porter_a_connaissance: { txt: "Porter à connaissance", c: "#B45309" },
                          informatif: undefined,
                        };
                        return readings.map(({ icon, key, theme, r }) => {
                          const t = tones[r.tone as Tone];
                          const badge = oppoBadge[r.opposabilite];
                          return (
                            <div key={key} style={{ padding: "9px 14px", background: t.bg, borderRadius: 9, border: `1px solid ${t.bd}` }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A" }}>{icon} {theme}</span>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  {badge && <span style={{ fontSize: 9.5, fontWeight: 700, color: badge.c, background: "#FFFFFF", border: `1px solid ${badge.c}33`, borderRadius: 5, padding: "1px 5px", textTransform: "uppercase" as const, letterSpacing: "0.03em" }}>{badge.txt}</span>}
                                  <span style={{ fontSize: 11.5, fontWeight: 600, color: t.c }}>{r.label}</span>
                                </span>
                              </div>
                              {r.consequence && (
                                <div style={{ marginTop: 5, fontSize: 11, color: "#475569", lineHeight: 1.5 }}>
                                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>Pour l'instruction : </span>{r.consequence}
                                </div>
                              )}
                              <div style={{ marginTop: 3, fontSize: 10, color: "#94a3b8" }}>
                                {r.maille === "parcelle" ? "Évalué à la parcelle" : "Donnée communale"}
                              </div>
                            </div>
                          );
                        });
                      })()}
                      {/* Servitudes d'utilité publique */}
                      {pa?.servitudes && pa.servitudes.length > 0 && pa.servitudes.map((s, i) => {
                        // Familles SUP (R.151-43 du Code de l'Urbanisme)
                        const supLabels: Record<string, string> = {
                          AC1: "Monuments Historiques — périmètre ABF",
                          AC2: "Sites classés / inscrits",
                          AC3: "Réserves naturelles",
                          AC4: "Parcs nationaux",
                          AS1: "Captage d'eau potable",
                          EL3: "Halage / marchepied",
                          EL7: "Ligne haute tension 63-225 kV",
                          EL11: "Ligne haute tension > 225 kV",
                          I1: "Canalisations d'hydrocarbures",
                          I3: "Canalisations de gaz",
                          I4: "Canalisations électriques",
                          PM1: "PPRI — risque inondation",
                          PM2: "PPRT — risque technologique",
                          PM3: "Risque mouvement de terrain",
                          PT1: "Télécommunications — protection",
                          PT2: "Télécommunications — émission/réception",
                          T1: "Voies ferrées",
                          T4: "Aérodromes — servitudes aéronautiques",
                          T5: "Servitudes aéronautiques de balisage",
                          T7: "Routes nationales",
                        };
                        const friendly = supLabels[s.categorie] ?? s.libelle ?? `SUP ${s.categorie}`;
                        const isABF = s.categorie?.startsWith("AC");
                        const meta = supConsequence(s.categorie);
                        const valueRows: Array<[string, string]> = [];
                        if (s.nomsup) valueRows.push(["Élément protégé", s.nomsup]);
                        if (s.typeprotect && s.typeprotect !== s.nomsup) valueRows.push(["Type de protection", s.typeprotect]);
                        if (s.gestionnaire) valueRows.push(["Gestionnaire", s.gestionnaire]);
                        if (s.datdecr) valueRows.push(["Acte de protection", s.datdecr]);
                        if (s.ref_acte) valueRows.push(["Référence", s.ref_acte]);
                        return (
                          <ConstraintItem
                            key={i}
                            rail={isABF ? "#D97706" : "#0EA5E9"}
                            icon={isABF ? "⚜️" : "📜"}
                            title={friendly}
                            code={s.categorie}
                            footer={
                              <>
                                {s.urlacte && (
                                  <a href={s.urlacte} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#4F46E5", fontWeight: 600 }}>
                                    Voir l'acte officiel ↗
                                  </a>
                                )}
                                {/* Toute citation du règlement ou du PDF passe par Instruction. */}
                                <InstructionLink
                                  label="Confronter aux pièces"
                                  docType={s.categorie?.startsWith("PM1") ? "ppri" : s.categorie?.startsWith("PM2") ? "pprt" : undefined}
                                />
                              </>
                            }
                          >
                            <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                              {/* Conséquence d'instruction — ce qui fait passer la SUP
                                  du « bruit » à l'information actionnable. */}
                              {meta && (
                                <div style={{ display: "flex", gap: 7, fontSize: 11.5, lineHeight: 1.5, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, padding: "7px 9px" }}>
                                  <span style={{ flexShrink: 0 }}>⚖️</span>
                                  <span style={{ color: "#334155" }}>
                                    <span style={{ color: "#94a3b8", fontWeight: 700 }}>Pour l'instruction : </span>{meta.consequence}
                                  </span>
                                </div>
                              )}
                              {valueRows.map(([label, value]) => (
                                <div key={label} style={{ display: "flex", gap: 8, fontSize: 11.5, lineHeight: 1.5 }}>
                                  <span style={{ color: "#94a3b8", flexShrink: 0, minWidth: 120 }}>{label}</span>
                                  <span style={{ color: "#334155", fontWeight: 500 }}>{value}</span>
                                </div>
                              ))}
                              {s.dessup && (
                                <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.55, fontStyle: "italic" as const }}>
                                  {s.dessup}
                                </div>
                              )}
                            </div>
                          </ConstraintItem>
                        );
                      })}
                      {/* Prescriptions surfaciques PLU */}
                      {pa?.prescriptions && pa.prescriptions.length > 0 && pa.prescriptions.map((p, i) => {
                        // typepsc — CNIG schema PLU (référentiel prescriptions surfaciques)
                        const pscLabels: Record<string, { titre: string; icon: string }> = {
                          "01": { titre: "Espace Boisé Classé (EBC)", icon: "🌳" },
                          "02": { titre: "Élément paysager / patrimonial à protéger", icon: "🏛️" },
                          "03": { titre: "Terrain cultivé en zone urbaine", icon: "🌾" },
                          "04": { titre: "Emplacement réservé", icon: "📍" },
                          "05": { titre: "Plantations à réaliser ou à conserver", icon: "🌱" },
                          "06": { titre: "Voie / emprise réservée", icon: "🛣️" },
                          "07": { titre: "Continuités écologiques", icon: "🦋" },
                          "08": { titre: "Bâtiment à conserver", icon: "🏠" },
                          "09": { titre: "Périmètre à risque", icon: "⚠️" },
                          "10": { titre: "Zone non aedificandi (inconstructible)", icon: "🚫" },
                          "11": { titre: "Zone d'Aménagement Concerté (ZAC)", icon: "🏗️" },
                          "12": { titre: "Périmètre de constructibilité limitée", icon: "⛔" },
                          "13": { titre: "Périmètre d'attente de projet (PAPA)", icon: "⏳" },
                          "14": { titre: "Mixité sociale", icon: "🏘️" },
                          "15": { titre: "Mixité fonctionnelle", icon: "🏢" },
                          "16": { titre: "Diversité commerciale (linéaires)", icon: "🛍️" },
                          "17": { titre: "Performance énergétique", icon: "🔋" },
                          "18": { titre: "Orientation d'Aménagement et de Programmation (OAP)", icon: "📐" },
                          "19": { titre: "Zone humide", icon: "💧" },
                          "30": { titre: "Hauteur — secteur de gabarit", icon: "📏" },
                          "39": { titre: "Hauteur maximale", icon: "📐" },
                          "40": { titre: "Stationnement — secteur de norme", icon: "🅿️" },
                          "44": { titre: "Stationnement — exigences spécifiques", icon: "🅿️" },
                        };
                        const def = pscLabels[p.typepsc] ?? { titre: "Prescription PLU", icon: "📋" };
                        const title = p.libelle || def.titre;
                        const pscMeta = prescriptionConsequence(p.typepsc);
                        return (
                          <ConstraintItem
                            key={i}
                            rail={pscMeta.tier === 1 ? "#F59E0B" : "#22C55E"}
                            icon={def.icon}
                            title={title}
                            code={`PSC ${p.typepsc}`}
                            footer={
                              <InstructionLink
                                label="Règlement applicable"
                                docType={p.typepsc === "18" ? "oap" : p.typepsc === "09" ? "ppri" : "plu"}
                              />
                            }
                          >
                            <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                              <div style={{ display: "flex", gap: 7, fontSize: 11.5, lineHeight: 1.5, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, padding: "7px 9px" }}>
                                <span style={{ flexShrink: 0 }}>⚖️</span>
                                <span style={{ color: "#334155" }}>
                                  <span style={{ color: "#94a3b8", fontWeight: 700 }}>Pour l'instruction : </span>{pscMeta.consequence}
                                </span>
                              </div>
                              {p.txtpsc ? (
                                <div style={{ fontSize: 11.5, color: "#334155", lineHeight: 1.55, whiteSpace: "pre-wrap" as const }}>
                                  {p.txtpsc}
                                </div>
                              ) : (
                                <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" as const }}>
                                  Texte réglementaire non publié dans le GPU — se référer au règlement de zone.
                                </div>
                              )}
                            </div>
                          </ConstraintItem>
                        );
                      })}
                    </div>
                  </div>

                </div>

                {/* ── Colonne droite : ce qu'on peut y faire ── */}
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
                  <ColHeading>Ce qu'on peut y faire</ColHeading>
                  {/* Constructibilité estimée — synthèse + détail chiffré fusionnés */}
                  {pa?.buildability && (
                    <div style={CARD}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <SecTitle>Constructibilité estimée</SecTitle>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 46, height: 46, borderRadius: "50%", border: "3.5px solid #4F46E5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#4F46E5" }}>{Math.round(pa.buildability.confidence * 100)}%</span>
                          </div>
                          <span style={{ fontSize: 11, color: "#64748b" }}>confiance</span>
                        </div>
                      </div>
                      {pa.buildability.resultSummary && (
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 9, padding: "10px 12px", marginBottom: 12 }}>
                          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                          <p style={{ fontSize: 12.5, color: "#14532D", margin: 0, lineHeight: 1.6 }}>{pa.buildability.resultSummary}</p>
                        </div>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {[
                          ["Emprise restante", pa.buildability.remainingFootprintM2 > 0 ? `${Math.round(pa.buildability.remainingFootprintM2)} m²` : "0 m²"],
                          ["Hauteur max.", pa.buildability.maxHeightM ? `${pa.buildability.maxHeightM} m` : "—"],
                          ["Espaces verts requis", pa.buildability.greenSpaceRequiredM2 ? `${Math.round(pa.buildability.greenSpaceRequiredM2)} m²` : "—"],
                          ["Recul voirie min.", pa.buildability.minSetbackFromRoadM ? `${pa.buildability.minSetbackFromRoadM} m` : "—"],
                          ["Recul limites min.", pa.buildability.minSetbackFromBoundariesM ? `${pa.buildability.minSetbackFromBoundariesM} m` : "—"],
                        ].map(([l, v]) => (
                          <div key={l} style={{ background: "#F8FAFC", borderRadius: 8, padding: "9px 12px" }}>
                            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>{l}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Synthèse réglementaire par thème — vue instructeur : éléments
                      tracés (article / document) regroupés et TRANSVERSAUX entre
                      documents (PLU + risques + servitudes). */}
                  {pa?.synthesis && pa.synthesis.themes.length > 0 && (
                    <div style={CARD}>
                      <ParcelSynthese audience="instructor" synthesis={pa.synthesis} />
                    </div>
                  )}

                  {/* Historique SITADEL/ADS — autorisations passées sur la parcelle/rue/commune */}
                  <div style={CARD}>
                    <SecTitle
                      action={
                        <div style={{ display: "inline-flex", border: "1px solid #E2E8F0", borderRadius: 7, overflow: "hidden", background: "white" }}>
                          {(["auto", "parcel", "street", "commune"] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => { setSitadelScope(s); setSitadelHistory(null); }}
                              style={{
                                padding: "4px 11px",
                                background: sitadelScope === s ? "#4F46E5" : "white",
                                color: sitadelScope === s ? "white" : "#475569",
                                border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer",
                              }}
                              title={
                                s === "auto" ? "Cascade : parcelle → rue → commune"
                                : s === "parcel" ? "Filtre strict sur la section/numéro cadastral"
                                : s === "street" ? "Même libellé de voie (ou lieu-dit)"
                                : "Toutes les autorisations de la commune"
                              }
                            >{s === "auto" ? "Auto" : s === "parcel" ? "Parcelle" : s === "street" ? "Rue" : "Commune"}</button>
                          ))}
                        </div>
                      }
                    >Historique SITADEL/ADS</SecTitle>
                    <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 12, marginTop: -10, lineHeight: 1.5 }}>
                      Autorisations d'urbanisme délivrées par le passé (PC, DP, PA, PD) — source : base ouverte SITADEL (SDES, data.gouv.fr).
                    </div>
                    {sitadelLoading ? (
                      <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0" }}>Chargement…</div>
                    ) : sitadelError ? (
                      <div style={{ fontSize: 12, color: "#991B1B", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 10px" }}>
                        Historique indisponible : {sitadelError}
                      </div>
                    ) : !sitadelHistory || sitadelHistory.permits.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#64748b", padding: "8px 0", lineHeight: 1.5 }}>
                        Aucun permis trouvé dans SITADEL pour {
                          sitadelScope === "parcel" ? "cette parcelle"
                          : sitadelScope === "street" ? "cette rue"
                          : "cette commune"
                        } depuis 2013.
                        {sitadelScope === "parcel" && (
                          <button
                            onClick={() => { setSitadelScope("street"); setSitadelHistory(null); }}
                            style={{ marginLeft: 6, fontSize: 12, color: "#4F46E5", background: "none", border: "none", fontWeight: 600, cursor: "pointer", padding: 0 }}
                          >Élargir à la rue →</button>
                        )}
                        {sitadelScope === "street" && (
                          <button
                            onClick={() => { setSitadelScope("commune"); setSitadelHistory(null); }}
                            style={{ marginLeft: 6, fontSize: 12, color: "#4F46E5", background: "none", border: "none", fontWeight: 600, cursor: "pointer", padding: 0 }}
                          >Élargir à la commune →</button>
                        )}
                      </div>
                    ) : (() => {
                      const typeColor: Record<string, { c: string; bg: string }> = {
                        PC: { c: "#4F46E5", bg: "#EEF2FF" },
                        DP: { c: "#15803D", bg: "#F0FDF4" },
                        PA: { c: "#C2410C", bg: "#FFF7ED" },
                        PD: { c: "#DC2626", bg: "#FEF2F2" },
                      };
                      const etatColor: Record<string, string> = {
                        "3": "#15803D", "5": "#15803D", "6": "#15803D",
                        "4": "#DC2626", "7": "#DC2626", "8": "#94A3B8",
                      };
                      // Bandeau indiquant le niveau effectivement appliqué.
                      // Surtout utile en mode "auto" pour expliquer pourquoi
                      // on voit des permis voisins (cascade rue ou commune)
                      // plutôt que la parcelle elle-même.
                      const eff = sitadelHistory.effective_scope;
                      const effLabel =
                        eff === "parcel" ? { txt: "Parcelle exacte", c: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" }
                        : eff === "street" ? { txt: "Élargi à la rue (aucun permis sur la parcelle)", c: "#C2410C", bg: "#FFF7ED", border: "#FED7AA" }
                        : { txt: "Élargi à la commune (aucun permis sur la parcelle ni la rue)", c: "#9A3412", bg: "#FEF3C7", border: "#FDE68A" };
                      return (
                        <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                          {sitadelScope === "auto" && (
                            <div style={{ fontSize: 10.5, fontWeight: 600, color: effLabel.c, background: effLabel.bg, border: `1px solid ${effLabel.border}`, borderRadius: 6, padding: "4px 8px", marginBottom: 2 }}>
                              {effLabel.txt} · {sitadelHistory.total} résultat{sitadelHistory.total > 1 ? "s" : ""}
                            </div>
                          )}
                          {sitadelHistory.permits.slice(0, 8).map((p) => {
                            const tc = typeColor[p.type_dau] ?? { c: "#64748B", bg: "#F1F5F9" };
                            const ec = etatColor[p.etat_code] ?? "#64748B";
                            const date = p.date_autorisation
                              ? new Date(p.date_autorisation).toLocaleDateString("fr-FR")
                              : p.an_depot ? `Déposé ${p.an_depot}` : "—";
                            return (
                              <div key={`${p.source}-${p.num_dau}`} style={{ padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 9, background: "#FAFBFC" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: tc.c, background: tc.bg, borderRadius: 5, padding: "2px 7px", letterSpacing: "0.04em" }}>{p.type_dau}</span>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: "#0F172A", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                                    {p.num_dau}
                                  </span>
                                  <span style={{ fontSize: 11, color: "#64748b", flexShrink: 0 }}>{date}</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#475569", flexWrap: "wrap" as const }}>
                                  <span style={{ color: ec, fontWeight: 600 }}>{p.etat || "—"}</span>
                                  {p.cadastre.length > 0 && (
                                    <>
                                      <span style={{ color: "#CBD5E1" }}>·</span>
                                      <span>{p.cadastre.map((c) => `${c.section} ${c.numero}`).join(", ")}</span>
                                    </>
                                  )}
                                  {p.nb_logements != null && p.nb_logements > 0 && (
                                    <>
                                      <span style={{ color: "#CBD5E1" }}>·</span>
                                      <span>{p.nb_logements} lgt</span>
                                    </>
                                  )}
                                  {p.surface_creee != null && p.surface_creee > 0 && (
                                    <>
                                      <span style={{ color: "#CBD5E1" }}>·</span>
                                      <span>{Math.round(p.surface_creee)} m²</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {sitadelHistory.total > 8 && (
                            <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" as const, paddingTop: 4 }}>
                              {sitadelHistory.total - 8} autres autorisations non affichées.
                            </div>
                          )}
                          {sitadelHistory.warnings.length > 0 && (
                            <div style={{ fontSize: 10.5, color: "#92400E", marginTop: 4, fontStyle: "italic" }}>
                              ⚠ {sitadelHistory.warnings.join(", ")}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── CONFORMITÉ IA ── */}
        {activeTab === "Instruction" && (() => {
          // Bloc d'action unifié : 2 actions hiérarchisées au lieu de 3 boutons
          // concurrents. (1) « Relancer l'analyse » relance en une fois les deux
          // moteurs recalculables pendant l'instruction (conformité interim +
          // constats réglementaires). (2) « Analyse finale » reste détachée car
          // elle n'opère que sur les pièces validées et engage juridiquement
          // l'arrêté. Les blocs de résultats en dessous ne portent plus de bouton.
          const workingLoading = conformiteLaunching || regulatoryStatus.running;
          const hasWorkingData = !!conformite?.report || regulatoryStatus.hasData;
          const workingTimes = [conformite?.analyzed_at, regulatoryStatus.lastRunAt]
            .filter((d): d is string => !!d)
            .map((d) => new Date(d).getTime())
            .filter((t) => !Number.isNaN(t));
          const lastWorkingRun = workingTimes.length ? new Date(Math.max(...workingTimes)) : null;
          return (
          <>
            <div style={{ ...CARD, padding: 0, overflow: "hidden" as const, marginBottom: 16 }}>
              {/* Tier 1 — analyse de travail : relance unique des deux moteurs */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "18px 20px", flexWrap: "wrap" as const }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 3 }}>Analyse de conformité</div>
                  <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.5, maxWidth: 680 }}>
                    Croise les pièces du dossier avec les <strong>règles PLU</strong> de la zone{liveCommune ? ` (${liveCommune})` : ""} et les <strong>documents commune</strong> (OAP, PPRI…). Produit les constats à valider et la synthèse réglementaire.
                  </div>
                  {lastWorkingRun && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                      Dernière analyse : {lastWorkingRun.toLocaleString("fr-FR")}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void relaunchWorkingAnalysis()}
                  disabled={workingLoading}
                  style={{
                    background: "white",
                    border: "1px solid #C7D2FE",
                    color: "#4F46E5",
                    borderRadius: 9,
                    padding: "9px 16px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: workingLoading ? "default" : "pointer",
                    whiteSpace: "nowrap" as const,
                    opacity: workingLoading ? 0.6 : 1,
                  }}
                >
                  {workingLoading ? "Analyse en cours…" : hasWorkingData ? "↻ Relancer l'analyse" : "Lancer l'analyse"}
                </button>
              </div>
              {conformiteError && (
                <div style={{ margin: "0 20px 14px", padding: "8px 12px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 12, color: "#991B1B" }}>
                  {conformiteError}
                </div>
              )}

              {/* Séparateur entre l'action de travail et l'action finale */}
              <div style={{ height: 1, background: "#EEF2F7" }} />

              {/* Tier 2 — analyse finale avant arrêté (3.C.5c) : action terminale,
                  volontairement détachée car elle engage juridiquement l'arrêté. */}
              <div style={{ padding: "18px 20px", background: "linear-gradient(135deg, #F8F7FF 0%, #F3F7FF 100%)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" as const }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#4F46E5", letterSpacing: "0.05em", textTransform: "uppercase" as const, marginBottom: 4 }}>
                      🛡 Analyse finale avant arrêté
                    </div>
                    {conformiteFinale?.status === "done" && conformiteFinale.analyzed_at ? (
                      <div style={{ fontSize: 12.5, color: "#312E81", lineHeight: 1.5 }}>
                        Effectuée le <strong>{new Date(conformiteFinale.analyzed_at).toLocaleString("fr-FR")}</strong>.
                        Ne prend en compte que les pièces explicitement <strong>validées</strong> par l'instructeur, et sert d'ancrage juridique à la décision.
                      </div>
                    ) : conformiteFinale?.status === "failed" ? (
                      <div style={{ fontSize: 12.5, color: "#DC2626", lineHeight: 1.5 }}>
                        Une tentative précédente a échoué. Relance possible une fois les pièces examinées.
                      </div>
                    ) : (
                      <div style={{ fontSize: 12.5, color: "#312E81", lineHeight: 1.5 }}>
                        À déclencher juste avant la délivrance de l'arrêté.
                        Ne prendra en compte <strong>que les pièces validées</strong> (les pièces sans statut ou en complément demandé bloquent le lancement).
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => void launchConformiteFinale()}
                    disabled={conformiteFinaleLaunching}
                    style={{
                      background: conformiteFinaleLaunching ? "#C7D2FE" : "#4F46E5",
                      color: "white",
                      border: "none",
                      borderRadius: 9,
                      padding: "10px 18px",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: conformiteFinaleLaunching ? "default" : "pointer",
                      boxShadow: "0 2px 6px rgba(79,70,229,0.25)",
                      whiteSpace: "nowrap" as const,
                    }}
                  >
                    {conformiteFinaleLaunching
                      ? "Analyse en cours…"
                      : conformiteFinale?.status === "done"
                        ? "↻ Relancer l'analyse finale"
                        : "Lancer l'analyse finale"}
                  </button>
                </div>
                {finaleBlockers && (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 9, background: "#FEF2F2", border: "1px solid #FECACA" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#991B1B", marginBottom: 6 }}>
                      ⚠ {finaleBlockers.reason}
                    </div>
                    {finaleBlockers.blockers.pieces_sans_statut.length > 0 && (
                      <div style={{ fontSize: 12, color: "#7F1D1D", marginBottom: 4 }}>
                        <strong>{finaleBlockers.blockers.pieces_sans_statut.length} pièce(s) à examiner :</strong>{" "}
                        {finaleBlockers.blockers.pieces_sans_statut.slice(0, 5).map((p) => p.code_piece || p.nom).join(", ")}
                        {finaleBlockers.blockers.pieces_sans_statut.length > 5 && ` (+${finaleBlockers.blockers.pieces_sans_statut.length - 5} autres)`}
                      </div>
                    )}
                    {finaleBlockers.blockers.pieces_complement_en_attente.length > 0 && (
                      <div style={{ fontSize: 12, color: "#7F1D1D", marginBottom: 4 }}>
                        <strong>{finaleBlockers.blockers.pieces_complement_en_attente.length} complément(s) en attente :</strong>{" "}
                        {finaleBlockers.blockers.pieces_complement_en_attente.slice(0, 5).map((p) => p.code_piece || p.nom).join(", ")}
                      </div>
                    )}
                    {finaleBlockers.blockers.aucune_piece_validee && (
                      <div style={{ fontSize: 12, color: "#7F1D1D" }}>
                        Aucune pièce n'a encore été validée. Au moins une validation explicite est requise.
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "#991B1B", marginTop: 6, fontStyle: "italic" as const }}>
                      Statue les pièces concernées dans l'onglet Documents, puis relance.
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <RegulatoryChecklist ref={regulatoryRef} dossierId={dossier.id} onJumpToCitation={jumpFromCitation} onOpenPiece={openPieceById} hideHeaderButton onStatusChange={onRegulatoryStatus} />
            </div>
          </>
          );
        })()}
        {activeTab === "Instruction" && (() => {
          const report = conformite?.report ?? null;
          const verdicts = report?.rule_verdicts?.verdicts ?? [];
          const counts = report?.rule_verdicts?.counts ?? null;
          const verdictMeta: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
            conforme: { label: "Conforme", color: "#15803D", bg: "#F0FDF4", border: "#BBF7D0", icon: "✅" },
            non_conforme: { label: "Non conforme", color: "#DC2626", bg: "#FEE2E2", border: "#FECACA", icon: "❌" },
            non_verifiable: { label: "Non vérifiable", color: "#475569", bg: "#F8FAFC", border: "#E2E8F0", icon: "❓" },
            applicable_conditionnel: { label: "Selon projet", color: "#92400E", bg: "#FEF3C7", border: "#FDE68A", icon: "📌" },
            non_applicable: { label: "Non applicable", color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0", icon: "—" },
          };

          if (!report) {
            return (
              <div style={CARD}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 6 }}>
                  Résultat · synthèse & verdicts règle par règle
                </div>
                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.55 }}>
                  La synthèse de conformité et les verdicts règle par règle s'afficheront ici après le lancement.
                  Utilisez <strong>« Lancer l'analyse »</strong> en haut de l'onglet — le croisement pièces × règles PLU{liveCommune ? ` (${liveCommune})` : ""} × documents commune (OAP, PPRI…) prend 1 à 3 minutes selon le nombre de pièces.
                </div>
              </div>
            );
          }

          return (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
              {/* Header — synthèse (résultat ; la relance est pilotée par le bloc d'action en tête d'onglet) */}
              <div style={CARD}>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 6 }}>
                    Résultat · synthèse & verdicts règle par règle
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Synthèse</div>
                  <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.55, maxWidth: 760 }}>{report.synthese}</div>
                  {report.analyzed_at && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                      Analyse du {new Date(report.analyzed_at).toLocaleString("fr-FR")}
                    </div>
                  )}
                </div>
                {counts && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 8 }}>
                    {(["conforme", "non_conforme", "non_verifiable", "applicable_conditionnel", "non_applicable"] as const).map((k) => {
                      const meta = verdictMeta[k]!;
                      const n = counts[k] ?? 0;
                      if (n === 0) return null;
                      return (
                        <span key={k} style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, borderRadius: 8, padding: "4px 11px", fontSize: 12, fontWeight: 600 }}>
                          {meta.icon} {n} {meta.label.toLowerCase()}
                        </span>
                      );
                    })}
                  </div>
                )}
                {report.warnings.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 11.5, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", lineHeight: 1.5 }}>
                    <strong>Avertissements :</strong> {report.warnings.join(" · ")}
                  </div>
                )}
              </div>

              {/* Verdicts par règle */}
              <div style={CARD}>
                <SecTitle>Verdicts règle par règle</SecTitle>
                {verdicts.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "#64748b", padding: "8px 0" }}>
                    Aucun verdict produit — soit aucune règle PLU n'est indexée pour cette zone, soit aucune pièce n'a encore d'extraction structurée.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                    {verdicts.map((v) => {
                      const meta = verdictMeta[v.verdict] ?? verdictMeta.non_verifiable!;
                      const observed = v.valeur_observee ? `${v.valeur_observee.value}${v.valeur_observee.unit ?? ""}` : null;
                      const expected = v.valeur_attendue ? [
                        v.valeur_attendue.exact != null ? `= ${v.valeur_attendue.exact}` : null,
                        v.valeur_attendue.min != null ? `≥ ${v.valeur_attendue.min}` : null,
                        v.valeur_attendue.max != null ? `≤ ${v.valeur_attendue.max}` : null,
                      ].filter(Boolean).join(", ") + (v.valeur_attendue.unit ?? "") : null;
                      return (
                        <div key={v.rule_id} style={{ padding: "12px 14px", border: `1px solid ${meta.border}`, background: meta.bg, borderRadius: 9 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" as const }}>
                            <span style={{ fontSize: 16 }}>{meta.icon}</span>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: meta.color, background: "white", border: `1px solid ${meta.border}`, borderRadius: 6, padding: "1px 8px" }}>
                              {meta.label}
                            </span>
                            {v.article && <span style={{ fontSize: 11.5, fontWeight: 600, color: "#475569" }}>{linkifyArticles(v.article)}</span>}
                            {v.sub_theme && <span style={{ fontSize: 11.5, color: "#64748b" }}>· {v.sub_theme}</span>}
                          </div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>
                            {v.rule_text_short}
                          </div>
                          <div style={{ fontSize: 12, color: meta.color, lineHeight: 1.55 }}>
                            {v.raison}
                          </div>
                          {(observed || expected) && (
                            <div style={{ marginTop: 6, display: "flex", gap: 14, fontSize: 11.5, color: "#374151", flexWrap: "wrap" as const }}>
                              {observed && (
                                <span><span style={{ color: "#94a3b8" }}>Observé :</span> <strong>{observed}</strong></span>
                              )}
                              {expected && (
                                <span><span style={{ color: "#94a3b8" }}>Attendu :</span> <strong>{expected}</strong></span>
                              )}
                            </div>
                          )}
                          {v.manquant && (
                            <div style={{ marginTop: 6, fontSize: 11.5, color: "#475569", fontStyle: "italic" }}>
                              Manquant pour trancher : {v.manquant}
                            </div>
                          )}
                          {v.sources.length > 0 && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${meta.border}` }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", letterSpacing: "0.04em", marginBottom: 4 }}>SOURCES — PIÈCES DU DOSSIER</div>
                              {v.sources.map((s, i) => {
                                const canOpen = !!s.piece_id;
                                return (
                                  <div
                                    key={i}
                                    onClick={canOpen ? () => openPieceById(s.piece_id) : undefined}
                                    title={canOpen ? "Ouvrir la pièce justificative" : undefined}
                                    style={{
                                      fontSize: 11.5, color: "#374151", lineHeight: 1.55,
                                      cursor: canOpen ? "pointer" : "default",
                                    }}
                                  >
                                    📎 <strong style={canOpen ? { color: "#4338CA", textDecoration: "underline", textDecorationStyle: "dotted" } : undefined}>{s.piece_nom}{canOpen ? " ↗" : ""}</strong> — « {s.citation} »
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {(v.regulatory_sources?.length ?? 0) > 0 && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${meta.border}` }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", letterSpacing: "0.04em", marginBottom: 4 }}>
                                SOURCES — RÉGLEMENTATION (PASSAGES VÉRIFIÉS)
                              </div>
                              {v.regulatory_sources!.map((s, i) => {
                                const pageLabel = s.page != null ? `, p. ${s.page}` : "";
                                const fileLabel = s.doc_source_file ? ` · ${s.doc_source_file}` : "";
                                return (
                                  <div key={i} style={{ fontSize: 11.5, color: "#374151", lineHeight: 1.55, marginBottom: i === v.regulatory_sources!.length - 1 ? 0 : 4 }}>
                                    <span style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", color: "#4338CA", borderRadius: 5, padding: "1px 7px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.02em", marginRight: 6 }}>
                                      📑 {s.doc_type}{pageLabel}
                                    </span>
                                    « {s.citation} »
                                    {fileLabel && <span style={{ fontSize: 10.5, color: "#94a3b8", marginLeft: 4 }}>{fileLabel}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pièces manquantes */}
              {report.pieces_manquantes.length > 0 && (
                <div style={CARD}>
                  <SecTitle>Pièces manquantes</SecTitle>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#374151", lineHeight: 1.6 }}>
                    {report.pieces_manquantes.map((p) => (
                      <li key={p.code}><strong>{p.code}</strong> — {p.nom}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── DOCUMENTS ── */}
        {activeTab === "Documents" && (() => {
          const docs = documents ?? [];
          const sel = docs[selectedDoc] ?? null;
          // Pièce en cours d'annotation en place (éditeur intégré au visualiseur).
          const annotating = !!sel && annotatePiece?.id === sel.id;

          // ── Regroupement des pièces par catégorie (3.C.4) ────────────────
          // Les pièces déposées partagent un préfixe de code (PC1, PC2,
          // DP-ABF-NDA, etc.) qui dit à quelle pièce du Cerfa elles
          // correspondent. On les groupe par catégorie pour que
          // l'instructeur ait un panneau lisible : "PC2 — Plan de masse"
          // regroupe les versions successives + un éventuel complément.
          // L'index original dans le tableau plat `docs` est mémorisé pour
          // que `setSelectedDoc(i)` continue de fonctionner avec la même
          // sémantique.
          const PIECE_CATEGORIES: Array<{ key: string; label: string; codes: string[] }> = [
            { key: "cerfa", label: "Formulaire CERFA",                       codes: ["CERFA"] },
            { key: "pc1",   label: "PC1 · Plan de situation",                codes: ["PC1", "DP1", "PD1", "CU1"] },
            { key: "pc2",   label: "PC2 · Plan de masse",                    codes: ["PC2", "DP2", "PD2"] },
            { key: "pc3",   label: "PC3 · Plan en coupe",                    codes: ["PC3", "DP3"] },
            { key: "pc4",   label: "PC4 · Notice descriptive",               codes: ["PC4", "DP4", "PD4"] },
            { key: "pc5",   label: "PC5 · Plans façades & toitures",         codes: ["PC5"] },
            { key: "pc6",   label: "PC6 · Insertion paysagère",              codes: ["PC6", "DP6"] },
            { key: "pc7",   label: "PC7 · Photographies de situation",       codes: ["PC7", "DP7"] },
            { key: "pc8",   label: "PC8 · Photographie environnement large", codes: ["PC8"] },
            { key: "pc9",   label: "PC9 · Document graphique d'insertion",   codes: ["PC9"] },
            { key: "abf",   label: "ABF · Notice & avis",                    codes: ["DP-ABF-NDA", "DP-ABF-FTM", "PCABF"] },
            { key: "annexe",label: "Annexes",                                codes: ["ANNEXE"] },
            { key: "other", label: "Autres",                                 codes: [] },
          ];

          type GroupedItem = { doc: DossierPiece; origIndex: number };
          const buckets = new Map<string, GroupedItem[]>();
          PIECE_CATEGORIES.forEach((c) => buckets.set(c.key, []));

          // Quand code_piece n'est pas peuplé (dépôt en annexe libre ou
          // upload citoyen avant la généralisation des slots), on tente
          // d'extraire un code depuis le nom du fichier. C'est ce qui
          // permet de remettre PC2a.pdf dans la rubrique PC2 plutôt que
          // dans Autres.
          const extractCodeFromName = (nom: string): string => {
            // "PC2", "PC2a", "PCMI 04", "DP3", "PD-4"…
            const m = nom.match(/^(PC|DP|PD|CU|PCMI|DPMI)\s*0*(\d+)/i);
            if (m) {
              const prefix = m[1]!.toUpperCase().replace(/MI$/, "");
              return `${prefix}${m[2]}`;
            }
            if (/^Annexe\s/i.test(nom)) return "ANNEXE";
            if (/^cerfa[\s_-]/i.test(nom)) return "CERFA";
            return "";
          };

          docs.forEach((doc, i) => {
            const codeBase = (doc.code_piece ?? "").toUpperCase();
            // Normalise les codes « maison individuelle » (PCMI2 → PC2,
            // DPMI3 → DP3) pour qu'ils tombent dans les mêmes catégories que
            // PC*/DP*. Sans ça, "PCMI2".startsWith("PC2") est faux et toutes les
            // pièces issues d'un dépôt PCMI finissent dans « Autres ».
            const code = (codeBase || extractCodeFromName(doc.nom)).replace(/^PCMI/, "PC").replace(/^DPMI/, "DP");
            // Premier prefix qui matche, "other" si rien.
            const matched = PIECE_CATEGORIES.find((c) => c.codes.length > 0 && c.codes.some((p) => code.startsWith(p)));
            buckets.get(matched?.key ?? "other")!.push({ doc, origIndex: i });
          });

          // Tri intra-groupe : statut d'instructeur (à examiner avant),
          // puis date de dépôt décroissante (dernière version en haut).
          const statusOrder: Record<string, number> = { "": 0, complement_demande: 1, valide: 2, rejete: 3 };
          buckets.forEach((arr) => arr.sort((a, b) => {
            const sa = statusOrder[a.doc.instructeur_status ?? ""] ?? 99;
            const sb = statusOrder[b.doc.instructeur_status ?? ""] ?? 99;
            if (sa !== sb) return sa - sb;
            return new Date(b.doc.uploaded_at).getTime() - new Date(a.doc.uploaded_at).getTime();
          }));

          const grouped = PIECE_CATEGORIES
            .map((c) => ({ key: c.key, label: c.label, items: buckets.get(c.key) ?? [] }))
            .filter((g) => g.items.length > 0);
          const fmtSize = (n: number) => n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / (1024 * 1024)).toFixed(1)} Mo`;
          const fmtUploaded = (iso: string) => {
            const d = new Date(iso);
            return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
          };
          const extOf = (type: string, nom: string) => {
            const fromName = nom.split(".").pop();
            if (fromName && fromName.length <= 5 && fromName !== nom) return fromName.toUpperCase();
            if (type.includes("pdf")) return "PDF";
            if (type.includes("zip")) return "ZIP";
            if (type.includes("image")) return type.split("/")[1]?.toUpperCase() ?? "IMG";
            return "FICHIER";
          };
          const scoreToStatus = (s?: string) => {
            if (s === "conforme") return { label: "Document exploitable", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" };
            if (s === "acceptable") return { label: "Exploitable avec réserves", bg: "#FEF9C3", color: "#854D0E", border: "#FDE68A" };
            if (s === "incomplet") return { label: "À compléter", bg: "#FEF3C7", color: "#92400E", border: "#FDE68A" };
            if (s === "non_conforme") return { label: "À reprendre", bg: "#FEE2E2", color: "#DC2626", border: "#FECACA" };
            return { label: "Déposé", bg: "#EFF6FF", color: "#1D4ED8", border: "#BFDBFE" };
          };

          // Sélecteur de mode d'affichage — persisté par instructeur.
          // apercu  : 3 colonnes historiques · compare : pièce ↔ doc règlementaire (split)
          // lecture : pièce plein écran, panneaux escamotés en bandes
          // Un bandeau passe en bande escamotée soit en mode Lecture (les deux),
          // soit quand l'instructeur l'a explicitement replié (n'importe quel mode).
          const leftIsStripe = docsViewMode === "lecture" || docsLeftCollapsed;
          // En annotation, on replie le panneau de droite : l'éditeur (qui liste
          // lui-même les commentaires) gagne toute la largeur sans grand écran.
          const rightIsStripe = docsViewMode === "lecture" || docsRightCollapsed || annotating;
          const leftW = leftIsStripe ? "44px" : (docsViewMode === "compare" ? "240px" : "280px");
          const rightW = rightIsStripe ? "44px" : "260px";
          const gridTemplate = `${leftW} 1fr ${rightW}`;
          // Borne de hauteur commune aux trois colonnes (pièces · viewer ·
          // annotation) pour qu'elles s'alignent et défilent dans les mêmes
          // limites au lieu de grandir indépendamment selon leur contenu.
          const colMaxH = "calc(100vh - 210px)";
          // Déplier un bandeau : si on était en Lecture, on en sort en gardant
          // l'autre bandeau replié pour préserver la sensation de focus.
          const expandLeft = () => {
            if (docsViewMode === "lecture") { setDocsViewMode("apercu"); setDocsRightCollapsed(true); }
            setDocsLeftCollapsed(false);
          };
          const expandRight = () => {
            if (docsViewMode === "lecture") { setDocsViewMode("apercu"); setDocsLeftCollapsed(true); }
            setDocsRightCollapsed(false);
          };
          // Bouton « replier » discret posé dans l'en-tête d'un bandeau.
          const CollapseBtn = ({ side, onClick }: { side: "left" | "right"; onClick: () => void }) => (
            <button
              type="button"
              onClick={onClick}
              title={`Replier le panneau ${side === "left" ? "de gauche" : "de droite"}`}
              style={{
                border: "1px solid #E2E8F0", background: "white", borderRadius: 6,
                width: 22, height: 22, lineHeight: 1, cursor: "pointer", color: "#64748b",
                fontSize: 12, fontWeight: 700, flexShrink: 0, padding: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {side === "left" ? "‹" : "›"}
            </button>
          );
          const stripeStyle: React.CSSProperties = {
            background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9,
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "flex-start", padding: "14px 0", gap: 8,
            cursor: "pointer", color: "#64748b",
          };
          const ModeBtn = ({ value, label, icon, title }: { value: "apercu" | "compare" | "lecture"; label: string; icon: string; title: string }) => (
            <button
              type="button"
              onClick={() => setDocsViewMode(value)}
              title={title}
              style={{
                padding: "5px 12px", border: "none",
                borderLeft: value !== "apercu" ? "1px solid #E2E8F0" : "none",
                background: docsViewMode === value ? "#4F46E5" : "white",
                color: docsViewMode === value ? "white" : "#475569",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}
            >
              <span style={{ fontSize: 13 }}>{icon}</span>{label}
            </button>
          );

          // Annotation en place : si la pièce sélectionnée est en mode
          // annotation, l'éditeur intégré remplace le visualiseur lecture seule
          // — dans la grille comme en grand écran. Les marques sont enregistrées
          // sur le dossier en continu ; l'éditeur gère l'avant/après et l'export.
          // Version finale (annotée) la plus récente pour la pièce sélectionnée
          // (gedDocs est trié du plus récent au plus ancien côté API).
          const finalDoc = sel ? gedDocs.find((d) => d.category === "annotation" && d.source_piece_id === sel.id) ?? null : null;
          const hasFinal = !!finalDoc;
          const piecesWithFinal = new Set(
            gedDocs.filter((d) => d.category === "annotation" && d.source_piece_id).map((d) => d.source_piece_id as string),
          );
          // Source affichée par le visualiseur lecture seule selon la version choisie.
          const showingFinal = hasFinal && pieceVersion === "finale";
          const viewUrl = showingFinal && finalDoc ? finalDoc.url : sel?.url;
          const viewNom = showingFinal && finalDoc ? finalDoc.nom : sel?.nom;
          const viewType = showingFinal && finalDoc ? finalDoc.type : sel?.type;
          const viewIsImage = (viewType ?? "").toLowerCase().startsWith("image/");
          const viewIsPdf = viewType === "application/pdf" || (viewNom ?? "").toLowerCase().endsWith(".pdf");
          const editorNode = sel ? (
            <PieceMarkupEditor
              embedded
              key={`edit-${sel.id}`}
              dossierId={dossier.id}
              piece={sel}
              onClose={() => setAnnotatePiece(null)}
              onExported={() => { refreshGed(); setPieceVersion("finale"); }}
            />
          ) : null;

          // Split pièce ↔ document réglementaire. Défini une seule fois puis
          // rendu soit dans la grille, soit dans l'overlay grand écran — jamais
          // les deux (un seul PdfAnnotator monté à la fois).
          const compareSplit = (
            <ResizableSplit
              storageKey="heureka.docsCompareSplitPct"
              left={
                <div style={{ height: "100%", background: "#F8FAFC", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid #E2E8F0", fontSize: 12, fontWeight: 600, color: "#1E293B", background: "white" }}>
                    {sel?.nom ?? "Sélectionne une pièce à gauche"}
                  </div>
                  <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", justifyContent: "stretch", background: "#0F172A0A" }}>
                    {sel ? (
                      annotating ? editorNode :
                      viewIsImage ? (
                        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <img src={viewUrl} alt={viewNom ?? ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                        </div>
                      ) : viewIsPdf ? (
                        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                          <PdfAnnotator key={viewUrl} fileUrl={viewUrl!} originalDownloadUrl={viewUrl!} />
                        </div>
                      ) : (
                        <div style={{ flex: 1, color: "#94a3b8", fontSize: 12, padding: 24, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>Aperçu indisponible pour ce format</div>
                      )
                    ) : (
                      <div style={{ flex: 1, color: "#94a3b8", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>Sélectionne une pièce à gauche.</div>
                    )}
                  </div>
                </div>
              }
              right={
                <div style={{ height: "100%" }}>
                  <RegulatoryDocViewer
                    communeName={dossier.commune ?? ""}
                    selectedDocId={docsRegulatoryDocId}
                    onSelectDoc={(id) => {
                      setDocsRegulatoryDocId(id);
                      setDocsRegulatoryDocTypeHint(null);
                      setDocsRegulatoryDocPage(null);
                    }}
                    preferredDocType={docsRegulatoryDocTypeHint}
                    page={docsRegulatoryDocPage}
                  />
                </div>
              }
            />
          );

          // Viewer plein cadre de la pièce sélectionnée, réutilisé dans l'overlay
          // grand écran pour les modes Aperçu et Lecture (le mode Comparer y monte
          // compareSplit). Évite de dupliquer la logique de rendu image/PDF.
          const pieceFullscreenBody = (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0F172A0A" }}>
              {sel ? (annotating ? editorNode : (() => {
                return viewIsImage ? (
                  <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <img src={viewUrl} alt={viewNom ?? ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                  </div>
                ) : viewIsPdf ? (
                  <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                    <PdfAnnotator key={viewUrl} fileUrl={viewUrl!} originalDownloadUrl={viewUrl!} />
                  </div>
                ) : (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>Aperçu indisponible pour ce format</div>
                );
              })()) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>Sélectionnez une pièce à gauche.</div>
              )}
            </div>
          );

          // Placeholder affiché dans la grille pendant que la pièce/comparaison
          // est ouverte en grand écran : évite de monter deux viewers simultanés.
          const fullscreenPlaceholder = (
            <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#64748b", fontSize: 13 }}>
              <div style={{ fontSize: 34 }}>⛶</div>
              <div>Ouvert en grand écran</div>
              <button
                type="button"
                onClick={() => setDocsFullscreen(false)}
                style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer" }}
              >
                Réduire
              </button>
            </div>
          );

          return (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginRight: "auto" }}>
                  {(() => {
                    const t = (sel?.type ?? "").toLowerCase();
                    const annotatable = !!sel && (t.startsWith("image/") || t === "application/pdf" || sel.nom.toLowerCase().endsWith(".pdf"));
                    return (
                      <button
                        type="button"
                        disabled={!annotatable}
                        onClick={() => sel && setAnnotatePiece(annotating ? null : sel)}
                        title={annotatable ? "Annoter la pièce en place (entourer, mesurer, commenter) puis l'enregistrer sur le dossier / l'envoyer au citoyen" : "Sélectionnez une pièce PDF ou image à annoter"}
                        style={{
                          border: annotating ? "1px solid #4F46E5" : "none",
                          background: !annotatable ? "#E2E8F0" : annotating ? "white" : "#4F46E5",
                          color: !annotatable ? "#94a3b8" : annotating ? "#4F46E5" : "white", borderRadius: 8,
                          padding: "5px 12px", fontSize: 12, fontWeight: 700,
                          cursor: annotatable ? "pointer" : "not-allowed",
                          display: "inline-flex", alignItems: "center", gap: 5,
                          boxShadow: annotatable && !annotating ? "0 1px 2px rgba(79,70,229,0.3)" : "none",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>✏️</span>{annotating ? "Fermer l'annotation" : "Annoter / Envoyer"}
                      </button>
                    );
                  })()}
                </div>
                {/* Distinction version initiale (citoyen) / version finale
                    (retravaillée par l'instructeur). Visible dès qu'une version
                    finale existe et hors mode annotation. */}
                {hasFinal && !annotating && (
                  <div style={{ display: "inline-flex", border: "1px solid #E2E8F0", borderRadius: 8, overflow: "hidden" }} title="Comparer la version déposée par le citoyen et la version retravaillée par l'instructeur">
                    <button type="button" onClick={() => setPieceVersion("initiale")}
                      style={{ padding: "5px 11px", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: pieceVersion === "initiale" ? "#0F172A" : "white", color: pieceVersion === "initiale" ? "white" : "#475569" }}>
                      Version initiale
                    </button>
                    <button type="button" onClick={() => setPieceVersion("finale")}
                      style={{ padding: "5px 11px", border: "none", borderLeft: "1px solid #E2E8F0", fontSize: 12, fontWeight: 600, cursor: "pointer", background: pieceVersion === "finale" ? "#16A34A" : "white", color: pieceVersion === "finale" ? "white" : "#475569" }}>
                      Version finale ✓
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setDocsFullscreen(true)}
                  title="Ouvrir en grand écran (Échap pour quitter)"
                  style={{
                    border: "1px solid #E2E8F0", background: "white", borderRadius: 8,
                    padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#475569",
                    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                  }}
                >
                  <span style={{ fontSize: 13 }}>⛶</span>Grand écran
                </button>
                <div style={{ display: "inline-flex", border: "1px solid #E2E8F0", borderRadius: 8, overflow: "hidden", background: "white", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <ModeBtn value="apercu"  label="Aperçu"   icon="⊞" title="Pièces · viewer · annotation" />
                  <ModeBtn value="compare" label="Comparer" icon="❘❘" title="Pièce et document réglementaire côte à côte" />
                  <ModeBtn value="lecture" label="Lecture"  icon="📖" title="Pièce plein écran, panneaux escamotés" />
                </div>
              </div>
            <div style={{ display: "grid", gridTemplateColumns: gridTemplate, gap: 16, alignItems: "start" }}>
              {leftIsStripe ? (
                <div style={stripeStyle} onClick={expandLeft} title="Déplier le panneau Pièces">
                  <span style={{ fontSize: 14 }}>›</span>
                  <span style={{ fontSize: 10, letterSpacing: "0.08em", writingMode: "vertical-rl", transform: "rotate(180deg)", textTransform: "uppercase" }}>Pièces ({docs.length})</span>
                </div>
              ) : (
              <div style={{ ...CARD, maxHeight: colMaxH, overflowY: "auto" as const }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <SecTitle>Pièces du dossier</SecTitle>
                  <CollapseBtn side="left" onClick={() => setDocsLeftCollapsed(true)} />
                </div>
                {documentsLoading ? (
                  <div style={{ textAlign: "center" as const, padding: "20px 0", fontSize: 12, color: "#64748b" }}>Chargement…</div>
                ) : docs.length === 0 ? (
                  <div style={{ textAlign: "center" as const, padding: "24px 8px", fontSize: 12.5, color: "#64748b" }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                    Aucune pièce déposée.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
                    {grouped.map((group) => {
                    const isCollapsed = collapsedDocCategories.has(group.key);
                    return (
                    <div key={group.key}>
                      <button
                        type="button"
                        onClick={() => toggleDocCategory(group.key)}
                        style={{
                          width: "100%", textAlign: "left" as const, background: "transparent", border: "none",
                          padding: "4px 4px 6px", cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 6,
                          fontSize: 10.5, fontWeight: 700, color: "#475569",
                          textTransform: "uppercase" as const, letterSpacing: "0.06em",
                          fontFamily: "inherit",
                        }}
                        title={isCollapsed ? "Déplier la catégorie" : "Replier la catégorie"}
                      >
                        <span style={{ fontSize: 9, color: "#94a3b8", display: "inline-block", width: 8, transition: "transform 0.15s", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
                        <span>{dossier.type === "permis_de_construire_mi" ? group.label.replace(/^PC(\d)/, "PCMI$1") : group.label}</span>
                        <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>({group.items.length})</span>
                      </button>
                      {!isCollapsed && (
                      <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
                    {group.items.map(({ doc, origIndex: i }) => {
                      const ext = extOf(doc.type, doc.nom);
                      const status = scoreToStatus(doc.analyse_ia?.score);
                      const instMeta: Record<string, { label: string; bg: string; color: string; border: string }> = {
                        valide: { label: "Validé", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" },
                        rejete: { label: "Rejeté", bg: "#FEE2E2", color: "#DC2626", border: "#FECACA" },
                        complement_demande: { label: "Complément", bg: "#FEF3C7", color: "#92400E", border: "#FDE68A" },
                      };
                      const inst = doc.instructeur_status ? instMeta[doc.instructeur_status] : null;
                      const hasNote = !!(doc.instructeur_note && doc.instructeur_note.trim());
                      return (
                        <button key={doc.id} onClick={() => setSelectedDoc(i)} style={{
                          display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 11px", borderRadius: 9, border: selectedDoc === i ? "1.5px solid #C7D2FE" : "1.5px solid transparent", cursor: "pointer", textAlign: "left" as const,
                          background: selectedDoc === i ? "#EEF2FF" : "transparent",
                          transition: "background 0.1s",
                          position: "relative" as const,
                        }}>
                          {inst && (
                            <span title={inst.label} style={{ position: "absolute" as const, top: 8, right: 8, width: 8, height: 8, borderRadius: "50%", background: inst.color }} />
                          )}
                          <div style={{ width: 32, height: 32, borderRadius: 7, background: ext === "ZIP" ? "#FFF7ED" : "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={ext === "ZIP" ? "#F97316" : "#4F46E5"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1E293B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, textDecoration: doc.instructeur_status === "rejete" ? "line-through" : "none" }}>{doc.nom}</div>
                            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{ext} · {fmtSize(doc.taille)} · {fmtUploaded(doc.uploaded_at)}</div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const, marginTop: 4 }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: status.color, background: status.bg, borderRadius: 5, padding: "1px 6px", border: `1px solid ${status.border}` }}>{status.label}</span>
                              {inst && (
                                <span style={{ fontSize: 10.5, fontWeight: 700, color: inst.color, background: inst.bg, borderRadius: 5, padding: "1px 6px", border: `1px solid ${inst.border}` }}>{inst.label}</span>
                              )}
                              {/* Badges de traitement IA — n'apparaissent que lors d'anomalies ou
                                  d'attentes. Quand tout est OK le `status.label` ci-dessus suffit. */}
                              {(doc.ocr_status === "processing" || doc.ocr_status === "pending") && (
                                <span title="OCR en cours sur ce document" style={{ fontSize: 10.5, fontWeight: 700, color: "#C2410C", background: "#FFF7ED", borderRadius: 5, padding: "1px 6px", border: "1px solid #FED7AA" }}>↻ OCR</span>
                              )}
                              {doc.ocr_status === "failed" && (
                                <span title="OCR échoué — l'IA ne peut pas lire ce document" style={{ fontSize: 10.5, fontWeight: 700, color: "#DC2626", background: "#FEE2E2", borderRadius: 5, padding: "1px 6px", border: "1px solid #FECACA" }}>⚠ OCR</span>
                              )}
                              {(doc.ocr_status === "done" || doc.ocr_status === "skipped") && !doc.analyse_ia && (
                                <span title="OCR terminé, analyse IA en cours ou non lancée" style={{ fontSize: 10.5, fontWeight: 700, color: "#C2410C", background: "#FFF7ED", borderRadius: 5, padding: "1px 6px", border: "1px solid #FED7AA" }}>↻ IA</span>
                              )}
                              {hasNote && (
                                <span title="Annotation présente" style={{ fontSize: 10.5, color: "#4F46E5" }}>📝</span>
                              )}
                              {piecesWithFinal.has(doc.id) && (
                                <span title="Une version finale (retravaillée par l'instructeur) existe pour cette pièce" style={{ fontSize: 10.5, fontWeight: 700, color: "#15803D", background: "#F0FDF4", borderRadius: 5, padding: "1px 6px", border: "1px solid #BBF7D0" }}>✓ finale</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                      </div>
                      )}
                    </div>
                    );
                    })}
                  </div>
                )}
              </div>
              )}
              {docsViewMode === "compare" ? (
              // Hauteur dynamique : la comparaison s'étire pour occuper toute la
              // hauteur du cadre (au lieu d'un 640px figé). minHeight garde un
              // viewer exploitable sur petit écran.
              <div style={{ ...CARD, padding: 0, minWidth: 0, display: "flex", flexDirection: "column" as const, height: colMaxH, minHeight: 460, overflow: "hidden" }}>
                <div style={{ flex: 1, minHeight: 0 }}>
                  {docsFullscreen ? fullscreenPlaceholder : compareSplit}
                </div>
              </div>
              ) : (
              <div style={{ ...CARD, minWidth: 0, display: "flex", flexDirection: "column" as const, height: colMaxH, minHeight: 460, overflow: "hidden" }}>
                <SecTitle>{`Aperçu : ${sel?.nom ?? "—"}`}</SecTitle>
                <div style={{ flex: 1, minWidth: 0, background: "#F8FAFC", borderRadius: 11, minHeight: 340, border: "1px solid #EAECF0", overflow: "hidden", position: "relative" as const, display: "flex", flexDirection: "column" as const }}>
                  {docsFullscreen ? fullscreenPlaceholder : sel ? (annotating ? (
                    <div style={{ flex: 1, minHeight: 340, minWidth: 0, display: "flex" }}>{editorNode}</div>
                  ) : (() => {
                    return (
                      <>
                        {showingFinal && (
                          <div style={{ padding: "6px 12px", background: "#F0FDF4", borderBottom: "1px solid #BBF7D0", fontSize: 11.5, fontWeight: 600, color: "#15803D", display: "flex", alignItems: "center", gap: 6 }}>
                            ✓ Version finale (retravaillée par l'instructeur) — {viewNom}
                          </div>
                        )}
                        <div style={{ flex: 1, minHeight: 340, background: "#0F172A0A", display: "flex", alignItems: viewIsImage ? "center" : "stretch", justifyContent: viewIsImage ? "center" : "stretch" }}>
                          {viewIsImage ? (
                            <img src={viewUrl} alt={viewNom ?? ""} style={{ maxWidth: "100%", maxHeight: 520, objectFit: "contain", display: "block" }} />
                          ) : viewIsPdf ? (
                            <div style={{ flex: 1, minWidth: 0, minHeight: 560 }}>
                              <PdfAnnotator key={viewUrl} fileUrl={viewUrl!} originalDownloadUrl={viewUrl!} />
                            </div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 12, padding: 32, textAlign: "center" as const }}>
                              <div style={{ width: 64, height: 80, background: "white", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", border: "1px solid #E2E8F0" }}>
                                <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                              </div>
                              <div>
                                <div style={{ fontSize: 13, color: "#64748b" }}>Aperçu indisponible pour ce format</div>
                                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{extOf(sel.type, sel.nom)} · {fmtSize(sel.taille)}</div>
                              </div>
                            </div>
                          )}
                        </div>
                        {/* Barre d'actions */}
                        <div style={{ padding: "10px 14px", borderTop: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontSize: 11.5, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1, minWidth: 0 }}>
                            {showingFinal ? "Version finale (GED)" : `${extOf(sel.type, sel.nom)} · ${fmtSize(sel.taille)} · déposé le ${fmtUploaded(sel.uploaded_at)}`}
                          </div>
                          <a href={viewUrl} target="_blank" rel="noopener noreferrer" style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(79,70,229,0.3)", textDecoration: "none", flexShrink: 0 }}>Ouvrir en plein écran ↗</a>
                          <a href={viewUrl} download style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "#374151", fontWeight: 500, textDecoration: "none", flexShrink: 0 }}>Télécharger</a>
                        </div>
                      </>
                    );
                  })()) : (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#94a3b8" }}>
                      Sélectionnez une pièce à gauche
                    </div>
                  )}
                </div>
              </div>
              )}
              {rightIsStripe ? (
                <div style={stripeStyle} onClick={expandRight} title="Déplier le panneau Annotation">
                  <span style={{ fontSize: 14 }}>‹</span>
                  <span style={{ fontSize: 10, letterSpacing: "0.08em", writingMode: "vertical-rl", transform: "rotate(180deg)", textTransform: "uppercase" }}>Annotation</span>
                </div>
              ) : (
              <div style={{ ...CARD, maxHeight: colMaxH, overflowY: "auto" as const }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", marginBottom: 10 }}>
                  <CollapseBtn side="right" onClick={() => setDocsRightCollapsed(true)} />
                </div>
                {/* Annotation de l'instructeur — toujours en haut du panneau de droite */}
                {sel && (() => {
                  const draftKey = sel.id;
                  const currentNote = annotationDrafts[draftKey] !== undefined
                    ? annotationDrafts[draftKey]!
                    : (sel.instructeur_note ?? "");
                  const noteDirty = annotationDrafts[draftKey] !== undefined && (annotationDrafts[draftKey] ?? "") !== (sel.instructeur_note ?? "");
                  const isSaving = annotatingPieceId === sel.id;
                  const STATUS_BUTTONS: Array<{ key: "valide" | "rejete" | "complement_demande"; label: string; bg: string; color: string; icon: string }> = [
                    { key: "valide",             label: "Valider",      bg: "#F0FDF4", color: "#15803D", icon: "✓" },
                    { key: "complement_demande", label: "Complément",   bg: "#FEF3C7", color: "#92400E", icon: "✎" },
                    { key: "rejete",             label: "Rejeter",      bg: "#FEE2E2", color: "#DC2626", icon: "✕" },
                  ];
                  return (
                    <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #E2E8F0" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Annotation instructeur</div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" as const }}>
                        {STATUS_BUTTONS.map((b) => {
                          const active = sel.instructeur_status === b.key;
                          return (
                            <button key={b.key}
                              onClick={() => void sendAnnotation(sel.id, { status: active ? null : b.key })}
                              disabled={isSaving}
                              title={active ? `Annuler le statut "${b.label}"` : `Marquer comme ${b.label.toLowerCase()}`}
                              style={{
                                flex: 1,
                                padding: "6px 8px",
                                borderRadius: 7,
                                border: `1px solid ${active ? b.color : "#E2E8F0"}`,
                                background: active ? b.bg : "white",
                                color: active ? b.color : "#475569",
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: isSaving ? "default" : "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 4,
                              }}>
                              <span>{b.icon}</span> {b.label}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>
                          Emplacement : <strong style={{ color: "#475569", fontFamily: "monospace" }}>{sel.code_piece ?? "non classé"}</strong>
                        </div>
                        <PieceReclassControl
                          dossierId={dossier.id}
                          piece={{ id: sel.id, code_piece: sel.code_piece, nom: sel.nom }}
                          onUpdated={(u) => setDocuments((arr) => arr ? arr.map((d) => d.id === u.id ? { ...d, code_piece: u.code_piece, nom: u.nom } : d) : arr)}
                        />
                      </div>
                      {sel.instructeur_status_at && (
                        <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 8 }}>
                          Statut posé le {new Date(sel.instructeur_status_at).toLocaleString("fr-FR")}
                        </div>
                      )}
                      <textarea
                        value={currentNote}
                        onChange={(e) => setAnnotationDraft(draftKey, e.target.value)}
                        rows={3}
                        placeholder="Annotation libre — précisions, motif de rejet, demande de complément…"
                        style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 7, padding: "7px 9px", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" as const, lineHeight: 1.5, resize: "vertical" as const }}
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                        {noteDirty && (
                          <button onClick={() => setAnnotationDrafts((p) => { const n = { ...p }; delete n[draftKey]; return n; })}
                            style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 12px", fontSize: 11.5, cursor: "pointer", color: "#374151" }}>
                            Annuler
                          </button>
                        )}
                        <button onClick={() => void sendAnnotation(sel.id, { note: currentNote.trim() ? currentNote : null })}
                          disabled={!noteDirty || isSaving}
                          style={{ border: "none", background: !noteDirty || isSaving ? "#C7D2FE" : "#4F46E5", color: "white", borderRadius: 6, padding: "4px 14px", fontSize: 11.5, fontWeight: 600, cursor: !noteDirty || isSaving ? "default" : "pointer" }}>
                          {isSaving ? "Enregistrement…" : "Enregistrer la note"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
                <SecTitle>Analyse IA</SecTitle>
                {sel?.analyse_ia?.commentaire ? (
                  <>
                    <div style={{ padding: "14px", background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)", borderRadius: 11, border: "1px solid #C7D2FE", marginBottom: 14 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "#4F46E5", marginBottom: 7, letterSpacing: "0.07em" }}>RÉSULTAT</div>
                      <div style={{ fontSize: 12, color: "#3730A3", lineHeight: 1.6 }}>{sel.analyse_ia.commentaire}</div>
                    </div>
                    {sel.analyse_ia.suggestions && sel.analyse_ia.suggestions.length > 0 && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Suggestions</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
                          {sel.analyse_ia.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
                    {sel ? "Pas d'analyse IA disponible pour cette pièce." : "Sélectionnez une pièce pour voir son analyse."}
                  </div>
                )}

                {/* Extraction structurée */}
                {sel && (() => {
                  const e = sel.extraction_ia;
                  const isExtracting = extractingPieceId === sel.id;
                  return (
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #E2E8F0" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Extraction structurée</div>
                        <button onClick={() => void reExtractPiece(sel.id)} disabled={isExtracting}
                          style={{ border: "1px solid #C7D2FE", background: isExtracting ? "#EEF2FF" : "white", color: "#4F46E5", borderRadius: 7, padding: "3px 10px", fontSize: 11, cursor: isExtracting ? "default" : "pointer", fontWeight: 600 }}>
                          {isExtracting ? "Extraction…" : e ? "Ré-extraire" : "Lancer l'extraction"}
                        </button>
                      </div>
                      {e ? (
                        <div style={{ fontSize: 11.5, color: "#374151", lineHeight: 1.55 }}>
                          <div style={{ marginBottom: 4 }}>
                            <span style={{ color: "#94a3b8" }}>Type :</span> <strong>{e.piece_type ?? "—"}</strong>
                            {typeof e.confidence_type === "number" && (
                              <span style={{ marginLeft: 6, fontSize: 10.5, color: e.confidence_type >= 0.7 ? "#15803D" : "#92400E" }}>
                                ({Math.round(e.confidence_type * 100)}%)
                              </span>
                            )}
                            {e.echelle && <span style={{ marginLeft: 8 }}><span style={{ color: "#94a3b8" }}>Échelle :</span> <strong>{e.echelle}</strong></span>}
                          </div>
                          {(() => {
                            const cites = (e.citations ?? [])
                              .map((c) => {
                                if (typeof c === "string") return { text: c, page: null as number | null };
                                const text = typeof c?.text === "string" ? c.text : "";
                                const page = typeof c?.page === "number" ? c.page : null;
                                return text ? { text, page } : null;
                              })
                              .filter((c): c is { text: string; page: number | null } => c !== null);
                            return cites.length > 0 && (
                              <div style={{ marginTop: 6 }}>
                                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", letterSpacing: "0.04em", marginBottom: 3 }}>CITATIONS</div>
                                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "#374151", lineHeight: 1.5 }}>
                                  {cites.slice(0, 6).map((c, i) => (
                                    <li key={i}>
                                      {c.text}
                                      {c.page !== null && <span style={{ color: "#94a3b8" }}> (p. {c.page})</span>}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })()}
                          {e.missing_elements && e.missing_elements.length > 0 && (
                            <div style={{ marginTop: 6, padding: "6px 9px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6 }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#92400E", letterSpacing: "0.04em", marginBottom: 3 }}>ÉLÉMENTS ABSENTS</div>
                              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "#92400E", lineHeight: 1.5 }}>
                                {e.missing_elements.map((m, i) => <li key={i}>{m}</li>)}
                              </ul>
                            </div>
                          )}
                          {e.notes && (
                            <div style={{ marginTop: 6, fontSize: 11, color: "#64748b", fontStyle: "italic" }}>{e.notes}</div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.5 }}>
                          Pas d'extraction disponible. Lance l'extraction pour récupérer les valeurs cotées (recul, hauteur, surfaces…).
                        </div>
                      )}
                      <PieceRegulatoryLinks
                        dossierId={dossier.id}
                        pieceId={sel.id}
                        onAppendToNote={(line) => {
                          // Append à la fin du brouillon courant (ou de la
                          // note persistée s'il n'y a pas de brouillon).
                          // L'instructeur peut ensuite cliquer "Enregistrer".
                          const current = annotationDrafts[sel.id] !== undefined
                            ? annotationDrafts[sel.id]!
                            : (sel.instructeur_note ?? "");
                          const next = current.trim() ? `${current.trim()}\n${line}` : line;
                          setAnnotationDraft(sel.id, next);
                        }}
                      />
                    </div>
                  );
                })()}
              </div>
              )}
            </div>
            {/* Grand écran : overlay plein viewport, disponible dans tous les modes.
                On déclenche aussi le plein écran natif (Fullscreen API) sur cet
                élément via docsFullscreenRef → les onglets/barre du navigateur
                disparaissent et l'overlay occupe tout l'écran, tout en gardant
                visibles les boutons React posés à l'intérieur. Rendu hors de la
                grille pour un position:fixed propre (et fallback si le natif
                est refusé). */}
            {docsFullscreen && (
              <div ref={docsFullscreenRef} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "white", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", whiteSpace: "nowrap" }}>
                    ⛶ {docsViewMode === "compare" ? "Comparaison" : "Pièce"} — grand écran
                  </span>
                  {docs.length > 0 && (
                    <select
                      value={selectedDoc}
                      onChange={(e) => setSelectedDoc(Number(e.target.value))}
                      title="Pièce affichée"
                      style={{ maxWidth: 360, fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid #E2E8F0", background: "white", color: "#374151", cursor: "pointer" }}
                    >
                      {docs.map((doc, i) => (
                        <option key={doc.id} value={i}>{doc.nom}</option>
                      ))}
                    </select>
                  )}
                  <div style={{ flex: 1 }} />
                  {(() => {
                    const t = (sel?.type ?? "").toLowerCase();
                    const annotatable = !!sel && (t.startsWith("image/") || t === "application/pdf" || sel.nom.toLowerCase().endsWith(".pdf"));
                    if (!annotatable) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => sel && setAnnotatePiece(annotating ? null : sel)}
                        title="Annoter la pièce en place"
                        style={{ border: annotating ? "1px solid #4F46E5" : "none", background: annotating ? "white" : "#4F46E5", color: annotating ? "#4F46E5" : "white", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
                      >
                        ✏️ {annotating ? "Fermer l'annotation" : "Annoter"}
                      </button>
                    );
                  })()}
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Échap pour quitter</span>
                  <button
                    type="button"
                    onClick={() => setDocsFullscreen(false)}
                    style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer" }}
                  >
                    Quitter ✕
                  </button>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>{docsViewMode === "compare" ? compareSplit : pieceFullscreenBody}</div>
              </div>
            )}
            </>
          );
        })()}

        {/* ── CONSULTATIONS ── */}
        {activeTab === "Consultations" && (() => {
          const cList = consultations ?? [];
          const countTotal = cList.length;
          const countAvis = cList.filter(c => c.status === "avis_recu").length;
          const countAttente = cList.filter(c => c.status === "en_attente").length;
          const countNonRequis = cList.filter(c => c.status === "non_requis").length;

          const statusMeta = (status: string, favorable: boolean | null) => {
            if (status === "avis_recu") return { label: favorable === false ? "Avis défavorable" : favorable === true ? "Avis favorable" : "Avis reçu", color: favorable === false ? "#DC2626" : "#15803D", bg: favorable === false ? "#FEF2F2" : "#F0FDF4" };
            if (status === "non_requis") return { label: "Non requis", color: "#475569", bg: "#F8FAFC" };
            if (status === "refuse") return { label: "Refusé", color: "#DC2626", bg: "#FEF2F2" };
            return { label: "En attente", color: "#C2410C", bg: "#FFF7ED" };
          };

          const fmtDateConsult = (d: string | null) => {
            if (!d) return "—";
            const dt = new Date(d);
            return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("fr-FR");
          };

          const selectedC = selectedConsultation ? cList.find(c => c.id === selectedConsultation) ?? null : null;

          return (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
              {/* Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                {[
                  { label: "Total", value: String(countTotal), color: "#4F46E5", bg: "#EEF2FF", border: "#C7D2FE" },
                  { label: "Avis reçus", value: String(countAvis), color: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" },
                  { label: "En attente", value: String(countAttente), color: "#C2410C", bg: "#FFF7ED", border: "#FED7AA" },
                  { label: "Non requis", value: String(countNonRequis), color: "#475569", bg: "#F8FAFC", border: "#E2E8F0" },
                ].map(s => (
                  <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: "16px 20px", border: `1px solid ${s.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color: s.color, letterSpacing: "-1px", lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginTop: 5 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "flex-start" }}>
                <div style={CARD}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 3, height: 14, background: "#4F46E5", borderRadius: 2, display: "inline-block" }} />
                      Organismes consultés
                    </div>
                    <button
                      onClick={() => openMissionModal()}
                      disabled={consultationsMissioning}
                      style={{ background: consultationsMissioning ? "#EEF2FF" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: consultationsMissioning ? "#4F46E5" : "white", border: consultationsMissioning ? "1px solid #C7D2FE" : "none", borderRadius: 9, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: consultationsMissioning ? "default" : "pointer", boxShadow: consultationsMissioning ? "none" : "0 2px 5px rgba(79,70,229,0.3)" }}
                    >
                      {consultationsMissioning ? "En cours…" : "+ Missionner un service"}
                    </button>
                  </div>
                  {consultationsLoading ? (
                    <div style={{ textAlign: "center" as const, padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>Chargement…</div>
                  ) : cList.length === 0 ? (
                    <div style={{ textAlign: "center" as const, padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>Aucune consultation lancée pour ce dossier.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column" as const, gap: 3 }}>
                      {cList.map((c, i) => {
                        const m = statusMeta(c.status, c.favorable);
                        return (
                          <button key={c.id} onClick={() => setSelectedConsultation(c.id)} style={{
                            display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, alignItems: "center", padding: "12px 14px", border: selectedConsultation === c.id ? "1.5px solid #C7D2FE" : "1.5px solid transparent", cursor: "pointer", borderRadius: 10, textAlign: "left" as const,
                            background: selectedConsultation === c.id ? "#EEF2FF" : i % 2 === 0 ? "#F8FAFC" : "white",
                          }}>
                            <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>{c.service_name}</span>
                            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{fmtDateConsult(c.date_envoi)}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" as const, border: `1px solid ${m.color}33` }}>{m.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {selectedC && (() => {
                  const m = statusMeta(selectedC.status, selectedC.favorable);
                  return (
                    <div style={CARD}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 10 }}>{selectedC.service_name}</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 20, padding: "3px 10px", border: `1px solid ${m.color}33` }}>{m.label}</span>
                        <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Envoyée le {fmtDateConsult(selectedC.date_envoi)}</span>
                      </div>
                      {selectedC.avis ? (
                        <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.7, padding: "13px 14px", background: "#F8FAFC", borderRadius: 10, border: "1px solid #EAECF0" }}>{selectedC.avis}</div>
                      ) : (
                        <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.7, padding: "13px 14px", background: "#F8FAFC", borderRadius: 10, border: "1px solid #EAECF0", fontStyle: "italic" }}>Aucun avis reçu pour l'instant.</div>
                      )}
                      {selectedC.status === "en_attente" && (
                        <button
                          onClick={() => {
                            api.patch(`/mairie/dossiers/${dossier.id}/consultations/${selectedC.id}`, { status: "avis_recu", favorable: true })
                              .then(() => { setConsultations(null); })
                              .catch(() => {});
                          }}
                          style={{ marginTop: 12, width: "100%", border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "9px 0", fontSize: 12.5, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}
                        >
                          Marquer avis reçu
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* ── Modale : missionner un service annexe ── */}
              {showMissionModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => !consultationsMissioning && setShowMissionModal(false)}>
                  <div style={{ background: "white", borderRadius: 14, width: 520, maxWidth: "92vw", padding: 24, boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Missionner un service</div>
                    <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 18 }}>Sélectionnez le service à consulter et rédigez un message. Il sera notifié de cette nouvelle consultation et recevra votre message dans sa messagerie pour le dossier {dossier.numero}.</div>

                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Service à consulter</label>
                    {availableServices === null ? (
                      <div style={{ fontSize: 12.5, color: "#94a3b8", padding: "10px 0", marginBottom: 16 }}>Chargement des services…</div>
                    ) : availableServices.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 9, padding: "11px 13px", marginBottom: 16, lineHeight: 1.5 }}>
                        Aucun service externe n'est rattaché à cette commune. Un administrateur doit d'abord créer le service et lui associer la commune.
                      </div>
                    ) : (
                      <select
                        value={missionServiceId}
                        onChange={e => setMissionServiceId(e.target.value)}
                        style={{ width: "100%", border: "1.5px solid #E2E8F0", borderRadius: 9, padding: "10px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" as const, marginBottom: 16, background: "white", color: "#0F172A", cursor: "pointer" }}
                      >
                        <option value="">— Choisir un service —</option>
                        {availableServices.map(s => (
                          <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
                        ))}
                      </select>
                    )}

                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Message au service</label>
                    <textarea
                      value={missionMessage}
                      onChange={e => setMissionMessage(e.target.value)}
                      rows={6}
                      placeholder="Précisez l'objet de la consultation…"
                      style={{ width: "100%", border: "1.5px solid #E2E8F0", borderRadius: 9, padding: "10px 12px", fontSize: 12.5, outline: "none", resize: "vertical" as const, fontFamily: "inherit", boxSizing: "border-box" as const, marginBottom: 18, lineHeight: 1.6 }}
                    />

                    <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
                      <button onClick={() => setShowMissionModal(false)} disabled={consultationsMissioning} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer", color: "#374151" }}>Annuler</button>
                      <button
                        onClick={submitMission}
                        disabled={!missionServiceId || consultationsMissioning}
                        style={{ background: !missionServiceId || consultationsMissioning ? "#C7D2FE" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: !missionServiceId || consultationsMissioning ? "not-allowed" : "pointer" }}
                      >
                        {consultationsMissioning ? "Envoi en cours…" : "Envoyer la consultation"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── CHRONOLOGIE ── */}
        {activeTab === "Chronologie" && (() => {
          const evts = events ?? [];
          const loading = events === null;
          const eventMeta: Record<string, { icon: string; color: string }> = {
            dossier_soumis:                  { icon: "📥", color: "#4F46E5" },
            dossier_complet:                 { icon: "✅", color: "#22C55E" },
            dossier_incomplet:               { icon: "⚠️", color: "#F97316" },
            instruction_demarree:            { icon: "🔍", color: "#3B82F6" },
            decision_prise:                  { icon: "📌", color: "#22C55E" },
            message_instructeur:             { icon: "💬", color: "#8B5CF6" },
            document_demande:                { icon: "📄", color: "#F97316" },
            piece_validee:                   { icon: "✓",  color: "#15803D" },
            piece_rejetee:                   { icon: "✕",  color: "#DC2626" },
            piece_complement_demande:        { icon: "✎",  color: "#92400E" },
            piece_statut_efface:             { icon: "↺",  color: "#64748B" },
            consultation_envoyee:            { icon: "📤", color: "#8B5CF6" },
            consultation_avis_recu:          { icon: "📥", color: "#22C55E" },
          };
          const labelOf = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "flex-start" }}>
              <div style={CARD}>
                <SecTitle>Historique complet</SecTitle>
                {loading ? (
                  <div style={{ textAlign: "center" as const, padding: "24px 0", fontSize: 13, color: "#64748b" }}>Chargement…</div>
                ) : evts.length === 0 ? (
                  <div style={{ textAlign: "center" as const, padding: "32px 16px", color: "#64748b" }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>🕒</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Aucun événement enregistré</div>
                    <p style={{ fontSize: 12.5, maxWidth: 380, margin: "0 auto", lineHeight: 1.55 }}>
                      Les étapes clés du dossier (dépôt, complétude, consultations, validation de pièces, décision…) apparaîtront ici au fur et à mesure de l'instruction.
                    </p>
                  </div>
                ) : (
                  <div>
                    {evts.map((ev, i) => {
                      const meta = eventMeta[ev.type] ?? { icon: "•", color: "#64748B" };
                      const date = new Date(ev.created_at);
                      const ts = isNaN(date.getTime()) ? "—" : date.toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
                      const actor = ev.actor_name ? `${ev.actor_name}${ev.actor_role ? ` (${ev.actor_role})` : ""}` : "Système";
                      const note = ev.metadata && typeof ev.metadata === "object" && typeof (ev.metadata as Record<string, unknown>).note === "string"
                        ? ((ev.metadata as Record<string, unknown>).note as string)
                        : null;
                      return (
                        <div key={ev.id} style={{ display: "flex", gap: 14, paddingBottom: i < evts.length - 1 ? 18 : 0 }}>
                          <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", width: 32 }}>
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: meta.color + "18", border: `2px solid ${meta.color}55`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13, color: meta.color, fontWeight: 700 }}>{meta.icon}</div>
                            {i < evts.length - 1 && <div style={{ width: 2, flex: 1, background: "linear-gradient(to bottom,#E2E8F0,#F8FAFC)", marginTop: 6 }} />}
                          </div>
                          <div style={{ paddingBottom: 4, flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>
                              {ev.description ?? labelOf(ev.type)}
                            </div>
                            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{actor}</div>
                            {note && (
                              <div style={{ marginTop: 6, padding: "6px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, color: "#374151", lineHeight: 1.5, fontStyle: "italic" }}>
                                « {note} »
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: "#CBD5E1", marginTop: 4, fontWeight: 500 }}>{ts}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
              <div style={CARD}>
                <SecTitle>Étapes clés</SecTitle>
                {[
                  { label: "Dépôt", date: dossier.date_depot ? fmtDate(dossier.date_depot) : "—", done: !!dossier.date_depot },
                  { label: "Fin d'instruction", date: dossier.echeance, done: false },
                ].map((e, i, arr) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: i < arr.length - 1 ? "1px solid #F1F5F9" : "none" }}>
                    <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{e.label}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>{e.date}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, background: e.done ? "#F0FDF4" : "#EFF6FF", color: e.done ? "#15803D" : "#2563EB", borderRadius: 5, padding: "2px 7px", border: `1px solid ${e.done ? "#BBF7D0" : "#BFDBFE"}` }}>{e.done ? "Fait" : "Prévu"}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={CARD}>
                <SecTitle>Délais réglementaires</SecTitle>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                  {[["Date limite", dossier.echeance], daysLeft !== null ? ["Temps restant", `J-${Math.max(0, daysLeft)}`] : null].filter(Boolean).map((row, i) => row && (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "6px 0", borderBottom: i < 0 ? "1px solid #F1F5F9" : "none" }}>
                      <span style={{ color: "#64748b" }}>{row[0]}</span>
                      <span style={{ fontWeight: 700, color: i === 1 ? (daysLeft !== null && daysLeft < 14 ? "#DC2626" : "#15803D") : "#0F172A" }}>{row[1]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {/* ── COURRIERS ── */}
        {activeTab === "Courriers" && (
          <CourriersPanel
            dossierId={dossier.id}
            onRequestNewPiecesCourrier={() => setCourrierMode("pieces_complementaires")}
            onRequestNewGeneralCourrier={() => setCourrierMode("general")}
          />
        )}

        {/* ── DÉCISION ── */}
        {activeTab === "Décision" && (
          <DecisionPanel dossier={dossier} liveCommune={liveCommune} currentUserId={user?.id} />
        )}

      </div>
      {courrierMode && (
        <CourrierModal
          dossier={{
            id: dossier.id,
            numero: dossier.numero,
            type: dossier.type,
            petitionnaire: dossier.petitionnaire,
            adresse: dossier.adresse,
            commune: dossier.commune,
            code_postal: dossier.code_postal,
            parcelle: dossier.parcelle,
            surface_plancher: dossier.surface_plancher,
            date_depot: dossier.date_depot,
            date_completude: dossier.date_completude,
            echeance: dossier.echeance,
          }}
          mode={courrierMode}
          availablePieces={(documents ?? []).map((d) => ({
            id: d.id,
            nom: d.nom,
            code_piece: d.code_piece,
            instructeur_status: d.instructeur_status,
            ia_score: (d.analyse_ia?.score as "conforme" | "acceptable" | "incomplet" | "non_conforme" | undefined) ?? null,
          }))}
          aiSuggestedMissingPieces={conformite?.report?.pieces_manquantes ?? []}
          onEmitted={() => {
            // Après émission : rafraîchir workflow + pièces pour refléter le
            // nouveau statut "incomplet" et les pièces marquées complement_demande.
            void refreshWorkflow();
            setDocuments(null); // force le rechargement au prochain accès onglet
          }}
          onClose={() => setCourrierMode(null)}
        />
      )}
    </div>
  );
}
