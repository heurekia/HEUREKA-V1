import { useState, useEffect, useRef, useMemo, type CSSProperties } from "react";
import { api } from "../../lib/api";
import { PdfAnnotator } from "../../components/PdfAnnotator";

// Validation du découpage d'un dépôt groupé (un seul PDF → plusieurs pièces).
// L'agent dépose un dossier complet en un PDF ; le backend propose un découpage
// (1 segment = 1 pièce) que l'instructeur valide/corrige AVANT création réelle.
// Tant qu'il n'a pas validé, AUCUNE pièce n'est créée. Le flux d'upload pièce
// par pièce (existant) n'est pas concerné.
//
// L'aperçu du PDF est affiché à gauche pour visualiser les pages pendant la
// segmentation ; cliquer une page dans la matrice la fait défiler dans l'aperçu.

type ProposedSegment = {
  code: string | null;
  type: string;
  pages: number[];
  nom: string;
  confidence: number;
  shared: boolean;
  needs_review: boolean;
};

type BundleRow = {
  id: string;
  url: string | null;
  status: "segmenting" | "pending_review" | "applied" | "discarded" | "failed";
  page_count: number | null;
  error: string | null;
  proposed_segments: { page_count: number; method: string; segments: ProposedSegment[] } | null;
};

type EditableSegment = {
  key: string;
  code: string; // "" = non affecté
  type: string;
  nom: string;
  pages: number[];
  confidence: number;
};

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "cerfa", label: "CERFA" },
  { value: "plan_situation", label: "Plan de situation" },
  { value: "plan_masse", label: "Plan de masse" },
  { value: "plan_coupe", label: "Plan de coupe" },
  { value: "plan_facade", label: "Façades & toitures" },
  { value: "notice", label: "Notice" },
  { value: "photo", label: "Photographie" },
  { value: "insertion", label: "Insertion graphique" },
  { value: "autre", label: "Autre / à classer" },
];

const TYPE_LABELS: Record<string, string> = {
  cerfa: "Formulaire CERFA", plan_situation: "Plan de situation", plan_masse: "Plan de masse",
  plan_coupe: "Plan de coupe", plan_facade: "Plan des façades et toitures", notice: "Notice descriptive",
  photo: "Photographie", insertion: "Document graphique d'insertion", autre: "Pièce",
};
const TYPE_SHORT: Record<string, string> = {
  cerfa: "CERFA", plan_situation: "Situation", plan_masse: "Masse", plan_coupe: "Coupe",
  plan_facade: "Façades", notice: "Notice", photo: "Photo", insertion: "Insertion", autre: "À classer",
};

const PALETTE = ["#4F46E5", "#0891B2", "#16A34A", "#D97706", "#DB2777", "#7C3AED", "#0EA5E9", "#65A30D", "#DC2626", "#475569"];

const overlay: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center",
};
const panel: CSSProperties = {
  background: "white", borderRadius: 16, width: 1160, maxWidth: "96vw",
  height: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
  boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
};
const header: CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "16px 22px",
  borderBottom: "1px solid #E2E8F0", flexShrink: 0,
};
const btnPrimary: CSSProperties = {
  background: "#4F46E5", color: "white", border: "none", borderRadius: 8,
  padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnGhost: CSSProperties = {
  border: "1px solid #E2E8F0", background: "white", borderRadius: 8,
  padding: "9px 18px", fontSize: 13, cursor: "pointer", color: "#374151",
};
const inputSt: CSSProperties = {
  border: "1.5px solid #E2E8F0", borderRadius: 7, padding: "6px 9px",
  fontSize: 12.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};
const sectionTitle: CSSProperties = { fontSize: 12, fontWeight: 700, color: "#374151", margin: "16px 0 8px" };

function confColor(c: number): { bg: string; color: string; label: string } {
  if (c >= 0.7) return { bg: "#F0FDF4", color: "#15803D", label: `${Math.round(c * 100)} %` };
  if (c >= 0.4) return { bg: "#FEF3C7", color: "#92400E", label: `${Math.round(c * 100)} %` };
  return { bg: "#FEE2E2", color: "#DC2626", label: `${Math.round(c * 100)} %` };
}

function pageSpan(pages: number[]): string {
  if (!pages.length) return "aucune page";
  const s = [...pages].sort((a, b) => a - b);
  const first = s[0]!;
  const last = s[s.length - 1]!;
  if (s.length === 1) return `p. ${first}`;
  const contiguous = last - first + 1 === s.length;
  return contiguous ? `p. ${first}–${last}` : `p. ${s.join(", ")}`;
}

function defaultName(code: string, type: string, pages: number[]): string {
  const label = TYPE_LABELS[type] ?? "Pièce";
  const base = code.trim() ? `${code.trim()} – ${label}` : label;
  if (!pages.length) return base;
  const s = [...pages].sort((a, b) => a - b);
  const first = s[0]!;
  const last = s[s.length - 1]!;
  return `${base} (${first === last ? `p. ${first}` : `p. ${first}-${last}`})`;
}

function chipLabel(s: EditableSegment): string {
  return s.code.trim() || TYPE_SHORT[s.type] || "Pièce";
}

export default function BundleSplitModal({
  dossierId,
  file,
  onClose,
}: {
  dossierId: string;
  file: File;
  onClose: (applied: boolean, createdCount?: number) => void;
}) {
  const [phase, setPhase] = useState<"uploading" | "segmenting" | "review" | "applying" | "error">("uploading");
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [method, setMethod] = useState<string>("");
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [viewerPage, setViewerPage] = useState<number>(1);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const startedRef = useRef(false);
  const cancelledRef = useRef(false);
  const seq = useRef(0);
  const nextKey = () => `seg-${seq.current++}`;

  // Aperçu à partir du fichier local (blob) : instantané, sans round-trip
  // serveur ni question d'ACL, et stable pendant toute la durée de la modale.
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void doUpload();
    return () => { cancelledRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doUpload() {
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("nom_piece", file.name);
      const res = await fetch(`/api/mairie/dossiers/${dossierId}/pieces/upload-bundle`, {
        method: "POST", credentials: "include", body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Erreur ${res.status}`);
      }
      const { bundle_id } = (await res.json()) as { bundle_id: string };
      if (cancelledRef.current) return;
      setBundleId(bundle_id);
      setPhase("segmenting");
      void pollBundle(bundle_id, 0);
    } catch (e) {
      if (cancelledRef.current) return;
      setErrorMsg(e instanceof Error ? e.message : "Échec du dépôt");
      setPhase("error");
    }
  }

  async function pollBundle(id: string, attempt: number) {
    if (cancelledRef.current) return;
    try {
      const bundle = await api.get<BundleRow>(`/mairie/dossiers/${dossierId}/pieces/bundles/${id}`);
      if (cancelledRef.current) return;
      if (bundle.status === "pending_review") {
        const segs = bundle.proposed_segments?.segments ?? [];
        setPageCount(bundle.page_count ?? bundle.proposed_segments?.page_count ?? 0);
        setMethod(bundle.proposed_segments?.method ?? "");
        setSegments(segs.map((s) => ({
          key: nextKey(),
          code: s.code ?? "",
          type: s.type,
          nom: s.nom,
          pages: [...s.pages].sort((a, b) => a - b),
          confidence: s.confidence,
        })));
        setPhase("review");
        return;
      }
      if (bundle.status === "failed") {
        setErrorMsg(bundle.error ?? "La segmentation a échoué.");
        setPhase("error");
        return;
      }
      if (attempt > 45) {
        setErrorMsg("La segmentation prend trop de temps. Réessayez plus tard.");
        setPhase("error");
        return;
      }
      setTimeout(() => void pollBundle(id, attempt + 1), 2000);
    } catch (e) {
      if (cancelledRef.current) return;
      setErrorMsg(e instanceof Error ? e.message : "Erreur réseau");
      setPhase("error");
    }
  }

  function updateSeg(key: string, patch: Partial<EditableSegment>) {
    setSegments((arr) => arr.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function removeSeg(key: string) {
    setSegments((arr) => arr.filter((s) => s.key !== key));
  }
  function regenName(key: string) {
    setSegments((arr) => arr.map((s) => (s.key === key ? { ...s, nom: defaultName(s.code, s.type, s.pages) } : s)));
  }
  function addSeg() {
    setSegments((arr) => [...arr, { key: nextKey(), code: "", type: "autre", nom: "Nouvelle pièce", pages: [], confidence: 1 }]);
  }
  function togglePage(key: string, page: number) {
    setSegments((arr) => arr.map((s) => {
      if (s.key !== key) return s;
      const has = s.pages.includes(page);
      const pages = has ? s.pages.filter((p) => p !== page) : [...s.pages, page].sort((a, b) => a - b);
      return { ...s, pages };
    }));
  }

  async function applySplit() {
    if (!bundleId) return;
    setPhase("applying");
    try {
      const result = await api.post<{ created: number }>(`/mairie/dossiers/${dossierId}/pieces/bundles/${bundleId}/apply`, {
        segments: segments
          .filter((s) => s.pages.length > 0)
          .map((s) => ({
            code: s.code.trim() ? s.code.trim() : null,
            type: s.type,
            nom: s.nom,
            pages: s.pages,
            confidence: s.confidence,
          })),
      }, { timeoutMs: 60_000 });
      onClose(true, result.created);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Échec de la création des pièces");
      setPhase("error");
    }
  }

  async function cancelAll() {
    cancelledRef.current = true;
    if (bundleId) {
      try { await api.post(`/mairie/dossiers/${dossierId}/pieces/bundles/${bundleId}/discard`, {}); } catch { /* ignore */ }
    }
    onClose(false);
  }

  const allPages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const colorOf = (key: string) => PALETTE[segments.findIndex((s) => s.key === key) % PALETTE.length] ?? "#475569";
  const uncovered = allPages.filter((p) => !segments.some((s) => s.pages.includes(p)));
  const applicable = segments.filter((s) => s.pages.length > 0).length;
  const closable = phase === "review" || phase === "error";

  return (
    <div style={overlay} onClick={() => { if (closable) void cancelAll(); }}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <span style={{ fontSize: 20 }}>📦</span>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", flex: 1 }}>Découpage du dossier déposé</div>
          <button onClick={() => void cancelAll()} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* ── Aperçu du PDF ── */}
          <div style={{ flex: 1.25, minWidth: 0, borderRight: "1px solid #E2E8F0", background: "#0F172A0A", display: "flex" }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              <PdfAnnotator key={previewUrl} fileUrl={previewUrl} initialPage={viewerPage} />
            </div>
          </div>

          {/* ── Panneau de segmentation ── */}
          <div style={{ width: 470, flexShrink: 0, overflowY: "auto", padding: 20 }}>
            {(phase === "uploading" || phase === "segmenting") && (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: 30, marginBottom: 12 }}>⏳</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1E293B" }}>
                  {phase === "uploading" ? "Dépôt du fichier…" : "Analyse et découpage en cours…"}
                </div>
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 6 }}>
                  Le système identifie les pièces contenues dans le PDF. Vous pouvez déjà feuilleter le document à gauche.
                </div>
              </div>
            )}

            {phase === "error" && (
              <div style={{ padding: "8px 0" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#DC2626", marginBottom: 6 }}>Une erreur est survenue</div>
                <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 18 }}>{errorMsg}</div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={() => onClose(false)} style={btnGhost}>Fermer</button>
                </div>
              </div>
            )}

            {(phase === "review" || phase === "applying") && (
              <>
                <div style={{ fontSize: 12.5, color: "#64748b" }}>
                  {applicable} pièce(s) sur {pageCount} page(s)
                  {method === "text" ? " · lecture du texte" : method === "vision" ? " · lecture visuelle" : ""}.
                </div>
                {uncovered.length > 0 && (
                  <div style={{ fontSize: 11.5, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 7, padding: "5px 9px", marginTop: 6 }}>
                    ⚠ {uncovered.length} page(s) non rattachée(s) : {uncovered.join(", ")}.
                  </div>
                )}

                <div style={sectionTitle}>Pièces</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {segments.map((s) => {
                    const cc = confColor(s.confidence);
                    const flagged = s.confidence < 0.7 || s.pages.length === 0;
                    return (
                      <div key={s.key} style={{
                        border: `1.5px solid ${flagged ? "#FDE68A" : "#E8EEF4"}`,
                        background: flagged ? "#FFFBEB" : "white",
                        borderRadius: 10, padding: "9px 10px",
                        display: "flex", flexDirection: "column", gap: 6,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorOf(s.key), flexShrink: 0 }} />
                          <input value={s.code} onChange={(e) => updateSeg(s.key, { code: e.target.value })} placeholder="Code" style={{ ...inputSt, width: 78, fontFamily: "monospace", fontWeight: 600 }} />
                          <select value={s.type} onChange={(e) => updateSeg(s.key, { type: e.target.value })} style={{ ...inputSt, cursor: "pointer", flex: 1, minWidth: 0 }}>
                            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: cc.color, background: cc.bg, borderRadius: 5, padding: "2px 6px", flexShrink: 0 }}>{cc.label}</span>
                          <button onClick={() => removeSeg(s.key)} title="Supprimer cette pièce" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#cbd5e1", flexShrink: 0 }}>×</button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input value={s.nom} onChange={(e) => updateSeg(s.key, { nom: e.target.value })} style={{ ...inputSt, flex: 1, minWidth: 0 }} />
                          <button onClick={() => regenName(s.key)} title="Régénérer le nom par défaut" style={{ ...inputSt, padding: "6px 8px", cursor: "pointer", background: "white" }}>↻</button>
                        </div>
                        <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{pageSpan(s.pages)}</div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={addSeg} style={{ ...btnGhost, marginTop: 8, fontSize: 12, padding: "6px 12px" }}>+ Ajouter une pièce</button>

                {pageCount > 0 && (
                  <>
                    <div style={sectionTitle}>
                      Répartition des pages
                      <div style={{ fontWeight: 400, color: "#94a3b8", fontSize: 11, marginTop: 2 }}>
                        cliquez le n° de page pour la voir à gauche ; cliquez une pastille pour (dé)rattacher (une page peut être partagée).
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {allPages.map((p) => {
                        const owners = segments.filter((s) => s.pages.includes(p));
                        const active = viewerPage === p;
                        return (
                          <div key={p} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px", borderRadius: 6, background: active ? "#EEF2FF" : "transparent" }}>
                            <button onClick={() => setViewerPage(p)} title="Afficher cette page à gauche"
                              style={{ width: 40, fontSize: 11.5, fontWeight: 700, color: active ? "#4F46E5" : "#475569", flexShrink: 0, border: "none", background: "none", cursor: "pointer", textAlign: "left" }}>
                              p. {p}
                            </button>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
                              {segments.map((s) => {
                                const on = s.pages.includes(p);
                                const col = colorOf(s.key);
                                return (
                                  <button key={s.key} onClick={() => togglePage(s.key, p)} title={s.nom}
                                    style={{
                                      border: `1px solid ${on ? col : "#E2E8F0"}`, background: on ? col : "white",
                                      color: on ? "white" : "#94a3b8", borderRadius: 6, padding: "2px 7px", fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                                    }}>
                                    {chipLabel(s)}
                                  </button>
                                );
                              })}
                            </div>
                            {owners.length === 0 && <span style={{ fontSize: 9.5, color: "#92400E", fontWeight: 600 }}>non rattachée</span>}
                            {owners.length > 1 && <span style={{ fontSize: 9.5, color: "#0891B2", fontWeight: 600 }}>partagée</span>}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 20, position: "sticky", bottom: 0, background: "white", paddingTop: 10 }}>
                  <button onClick={() => void cancelAll()} disabled={phase === "applying"} style={btnGhost}>Annuler</button>
                  <button onClick={() => void applySplit()} disabled={phase === "applying" || applicable === 0}
                    style={{ ...btnPrimary, opacity: phase === "applying" || applicable === 0 ? 0.6 : 1 }}>
                    {phase === "applying" ? "Création…" : `Valider · ${applicable} pièce(s)`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
