import { useState, useEffect, useRef, type CSSProperties } from "react";
import { api } from "../../lib/api";

// Validation du découpage d'un dépôt groupé (un seul PDF → plusieurs pièces).
// L'agent dépose un dossier complet en un PDF ; le backend propose un découpage
// (1 segment = 1 pièce) que l'instructeur valide/corrige AVANT création réelle.
// Tant qu'il n'a pas validé, AUCUNE pièce n'est créée. Le flux d'upload pièce
// par pièce (existant) n'est pas concerné.

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
  shared: boolean;
  needs_review: boolean;
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

const overlay: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center",
};
const panel: CSSProperties = {
  background: "white", borderRadius: 16, width: 760, maxWidth: "94vw",
  maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
};
const header: CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "18px 24px",
  borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, background: "white", zIndex: 1,
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

function confColor(c: number): { bg: string; color: string; label: string } {
  if (c >= 0.7) return { bg: "#F0FDF4", color: "#15803D", label: `${Math.round(c * 100)} %` };
  if (c >= 0.4) return { bg: "#FEF3C7", color: "#92400E", label: `${Math.round(c * 100)} %` };
  return { bg: "#FEE2E2", color: "#DC2626", label: `${Math.round(c * 100)} %` };
}

function pageSpan(pages: number[]): string {
  if (!pages.length) return "—";
  const s = [...pages].sort((a, b) => a - b);
  const first = s[0]!;
  const last = s[s.length - 1]!;
  if (s.length === 1) return `p. ${first}`;
  const contiguous = last - first + 1 === s.length;
  return contiguous ? `p. ${first}–${last}` : `p. ${s.join(", ")}`;
}

export default function BundleSplitModal({
  dossierId,
  file,
  onClose,
}: {
  dossierId: string;
  file: File;
  onClose: (applied: boolean) => void;
}) {
  const [phase, setPhase] = useState<"uploading" | "segmenting" | "review" | "applying" | "error">("uploading");
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [method, setMethod] = useState<string>("");
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const startedRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    // StrictMode (dev) invoque l'effet deux fois : garde-fou pour ne pas
    // déposer le bundle en double.
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
        method: "POST",
        credentials: "include",
        body: fd,
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
        setPageCount(bundle.page_count ?? bundle.proposed_segments?.page_count ?? null);
        setMethod(bundle.proposed_segments?.method ?? "");
        setSegments(segs.map((s, i) => ({
          key: `${i}-${Math.random().toString(36).slice(2, 7)}`,
          code: s.code ?? "",
          type: s.type,
          nom: s.nom,
          pages: s.pages,
          confidence: s.confidence,
          shared: s.shared,
          needs_review: s.needs_review,
        })));
        setPhase("review");
        return;
      }
      if (bundle.status === "failed") {
        setErrorMsg(bundle.error ?? "La segmentation a échoué.");
        setPhase("error");
        return;
      }
      // segmenting : on continue à interroger (jusqu'à ~90 s).
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

  async function applySplit() {
    if (!bundleId) return;
    setPhase("applying");
    try {
      await api.post(`/mairie/dossiers/${dossierId}/pieces/bundles/${bundleId}/apply`, {
        segments: segments.map((s) => ({
          code: s.code.trim() ? s.code.trim() : null,
          type: s.type,
          nom: s.nom,
          pages: s.pages,
          confidence: s.confidence,
        })),
      }, { timeoutMs: 60_000 });
      onClose(true);
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

  const reviewCount = segments.filter((s) => s.needs_review).length;

  return (
    <div style={overlay} onClick={() => { if (phase === "review" || phase === "error") void cancelAll(); }}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <span style={{ fontSize: 20 }}>📦</span>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", flex: 1 }}>
            Découpage du dossier déposé
          </div>
          <button onClick={() => void cancelAll()} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 24 }}>
          {(phase === "uploading" || phase === "segmenting") && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1E293B" }}>
                {phase === "uploading" ? "Dépôt du fichier…" : "Analyse et découpage en cours…"}
              </div>
              <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 6 }}>
                Le système identifie les pièces contenues dans le PDF. Cela peut prendre quelques dizaines de secondes.
              </div>
            </div>
          )}

          {phase === "error" && (
            <div style={{ padding: "16px 0" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#DC2626", marginBottom: 6 }}>Une erreur est survenue</div>
              <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 18 }}>{errorMsg}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => onClose(false)} style={btnGhost}>Fermer</button>
              </div>
            </div>
          )}

          {(phase === "review" || phase === "applying") && (
            <>
              <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 16 }}>
                {segments.length} pièce(s) détectée(s) sur {pageCount ?? "?"} page(s)
                {method === "text" ? " · lecture du texte" : method === "vision" ? " · lecture visuelle" : ""}.
                {reviewCount > 0 && (
                  <span style={{ color: "#92400E", fontWeight: 600 }}> {reviewCount} à vérifier.</span>
                )}
                {" "}Corrigez l'emplacement ou le nom si besoin, puis validez.
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {segments.map((s) => {
                  const cc = confColor(s.confidence);
                  return (
                    <div key={s.key} style={{
                      border: s.needs_review ? "1.5px solid #FDE68A" : "1.5px solid #E8EEF4",
                      background: s.needs_review ? "#FFFBEB" : "white",
                      borderRadius: 10, padding: "10px 12px",
                      display: "grid", gridTemplateColumns: "82px 120px 1fr 64px 30px", gap: 8, alignItems: "center",
                    }}>
                      <input
                        value={s.code}
                        onChange={(e) => updateSeg(s.key, { code: e.target.value })}
                        placeholder="Code"
                        style={{ ...inputSt, fontFamily: "monospace", fontWeight: 600 }}
                      />
                      <select value={s.type} onChange={(e) => updateSeg(s.key, { type: e.target.value })} style={{ ...inputSt, cursor: "pointer" }}>
                        {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <div style={{ minWidth: 0 }}>
                        <input
                          value={s.nom}
                          onChange={(e) => updateSeg(s.key, { nom: e.target.value })}
                          style={{ ...inputSt, width: "100%" }}
                        />
                        <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3, display: "flex", gap: 6 }}>
                          <span>{pageSpan(s.pages)}</span>
                          {s.shared && <span style={{ color: "#92400E", fontWeight: 600 }}>· page partagée</span>}
                        </div>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: cc.color, background: cc.bg, borderRadius: 5, padding: "2px 6px", textAlign: "center" }}>{cc.label}</span>
                      <button
                        onClick={() => removeSeg(s.key)}
                        title="Retirer cette pièce du découpage"
                        style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#cbd5e1" }}
                      >×</button>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 22 }}>
                <button onClick={() => void cancelAll()} disabled={phase === "applying"} style={btnGhost}>Annuler</button>
                <button
                  onClick={() => void applySplit()}
                  disabled={phase === "applying" || segments.length === 0}
                  style={{ ...btnPrimary, opacity: phase === "applying" || segments.length === 0 ? 0.6 : 1 }}
                >
                  {phase === "applying" ? "Création…" : `Valider et créer ${segments.length} pièce(s)`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
