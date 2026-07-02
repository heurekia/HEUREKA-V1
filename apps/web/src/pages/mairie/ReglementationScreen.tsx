import { useState, useEffect, useRef } from "react";
import { api } from "../../lib/api";

// Écran "Réglementation" : référentiel PLU (zones, règles, ingestion PDF
// via PluUploadPanel, structuration assistée). Bloc auto-contenu.


type ZoneProgress = { code: string; label: string; type: string; status: "pending" | "done"; rules?: number; vision?: number; batch?: number; total_batches?: number };

// Le jobId actif (ingestion en cours côté serveur) est persisté en localStorage
// (clé `plu-ingest-job:<INSEE>` pour le PLU, `spr-ingest-job:<INSEE>` pour le
// SPR — cf. JOB_KEY dans PluUploadPanel) : si l'utilisateur navigue ailleurs
// puis revient, on reprend le polling — l'extraction continue côté serveur tant
// que le process Node tourne, indépendamment de la connexion HTTP.

type ZoneSpec = { code: string; label: string; type: string; total_batches: number };
type StatusResp = {
  jobId: string;
  status: "running" | "done" | "error";
  phase: string;
  commune: { id: string; name: string; insee_code: string };
  zones: Array<{
    code: string; label: string; type: string;
    total_batches: number; done_batches: number;
    rules_so_far: number; vision_so_far: number;
    done: boolean;
  }>;
  result: { zones: number; rules: number; needs_review: number } | null;
  error: string | null;
};

function PluUploadPanel({ commune, inseeCode, onSuccess, loadError, onCancel, onManual, spr }: { commune: string; inseeCode?: string; onSuccess: () => void; loadError: string | null; onCancel?: () => void; onManual?: () => void; spr?: boolean }) {
  // Mode SPR : réutilise TOUTE la mécanique d'ingestion (job de fond, /start,
  // polling /status, reprise sur remontage, affichage de progression par
  // section). Seuls changent : la clé de reprise (localStorage), la requête de
  // démarrage (création d'un document `spr` + ingestion en mode doc_id) et
  // quelques libellés. Le chemin PLU (spr absent) reste identique à l'existant.
  const JOB_KEY = (insee: string) => `${spr ? "spr" : "plu"}-ingest-job:${insee.trim()}`;
  const L = spr
    ? { title: "règlement SPR", desc: "Importez le règlement écrit du Site Patrimonial Remarquable en PDF. L'IA extrait les secteurs et prescriptions — les règles sont créées en brouillon (distinctes du PLU) pour validation.", detected: "Secteurs détectés", action: "Analyser le SPR", unit: "secteur", hint: "Règlement écrit du SPR · max ~35 Mo", accent: "#9D174D", accentSoft: "#FDF2F8", accentBorder: "#FBCFE8" }
    : { title: "PLU", desc: "Importez le règlement PLU en PDF. L'IA extrait les zones et règles automatiquement — les règles sont créées en brouillon pour validation.", detected: "Zones détectées", action: "Analyser le PLU", unit: "zone", hint: "Règlement PLU uniquement (pas le RI) · max ~35 Mo", accent: "#4F46E5", accentSoft: "#EEF2FF", accentBorder: "#C7D2FE" };
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [communeInput, setCommuneInput] = useState(commune);
  const [inseeInput, setInseeInput] = useState(inseeCode ?? "");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [zoneProgress, setZoneProgress] = useState<ZoneProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ zones: number; rules: number; needs_review: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setCommuneInput(commune); setInseeInput(inseeCode ?? ""); }, [commune, inseeCode]);

  const stopPolling = () => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  };

  const applyStatus = (s: StatusResp) => {
    setPhase(s.phase);
    setZoneProgress(s.zones.map((z) => ({
      code: z.code, label: z.label, type: z.type,
      status: z.done ? "done" : "pending",
      rules: z.rules_so_far, vision: z.vision_so_far,
      batch: z.done ? undefined : z.done_batches,
      total_batches: z.done ? undefined : z.total_batches,
    })));
    if (s.status === "done" && s.result) {
      setDone({ zones: s.result.zones, rules: s.result.rules, needs_review: s.result.needs_review });
      setPhase(null);
      setLoading(false);
      stopPolling();
      try { localStorage.removeItem(JOB_KEY(s.commune.insee_code)); } catch { /* SSR-safe */ }
      setTimeout(onSuccess, 1500);
    } else if (s.status === "error") {
      setError(s.error ?? "Erreur serveur");
      setPhase(null);
      setLoading(false);
      stopPolling();
      try { localStorage.removeItem(JOB_KEY(s.commune.insee_code)); } catch { /* SSR-safe */ }
    }
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    const tick = async () => {
      try {
        const r = await fetch(`/api/mairie/admin/ingest-plu-pdf/status?jobId=${encodeURIComponent(jobId)}`, { credentials: "include" });
        if (r.status === 404) {
          // Job expiré / process redémarré → on nettoie et on demande à
          // l'utilisateur de relancer.
          setError("Le job d'ingestion a expiré côté serveur (process redémarré ?). Relancez l'import.");
          setPhase(null); setLoading(false); stopPolling();
          try { localStorage.removeItem(JOB_KEY(inseeInput)); } catch { /* SSR-safe */ }
          return;
        }
        if (!r.ok) return; // erreur transitoire (réseau, 5xx) → on retentera au prochain tick
        const s = await r.json() as StatusResp;
        applyStatus(s);
      } catch { /* network blip — tick suivant */ }
    };
    // 1er tick immédiat puis toutes les 2,5 s.
    void tick();
    pollTimerRef.current = setInterval(tick, 2500);
  };

  // Au montage : reprend automatiquement le polling si un job était en cours
  // pour ce code INSEE (l'utilisateur a navigué ailleurs puis est revenu).
  useEffect(() => {
    const insee = (inseeCode ?? "").trim();
    if (!insee) return;
    let savedJob: string | null = null;
    try { savedJob = localStorage.getItem(JOB_KEY(insee)); } catch { /* SSR-safe */ }
    if (!savedJob) return;
    setLoading(true);
    setPhase("Reprise de l'ingestion en cours…");
    startPolling(savedJob);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inseeCode]);

  const handleFile = (f: File | null) => { setPdfFile(f); setError(null); setDone(null); setZoneProgress([]); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") handleFile(f);
    else setError("Seuls les fichiers PDF sont acceptés.");
  };

  const handleSubmit = async () => {
    if (!communeInput.trim() || !inseeInput.trim() || !pdfFile) { setError("Commune, code INSEE et PDF sont requis."); return; }
    setLoading(true); setError(null); setDone(null); setZoneProgress([]); setPhase("Lecture du PDF…");

    const pdf_base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]!);
      reader.onerror = reject;
      reader.readAsDataURL(pdfFile);
    });

    type StartResp = { jobId: string; zones: Array<ZoneSpec & { batches: Array<{ index: number; firstPage: number; lastPage: number }> }> };
    const postJSON = async <T,>(path: string, body: unknown): Promise<T> => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const txt = await r.text();
      let parsed: unknown = null;
      try { parsed = txt ? JSON.parse(txt) : null; } catch { /* keep raw */ }
      if (!r.ok) {
        const msg = (parsed as { error?: string } | null)?.error ?? txt ?? `HTTP ${r.status}`;
        const err = new Error(msg) as Error & { status?: number; transient?: boolean };
        err.status = r.status;
        err.transient = (parsed as { transient?: boolean } | null)?.transient === true
          || r.status === 502 || r.status === 503 || r.status === 504;
        throw err;
      }
      return parsed as T;
    };
    const postJSONWithRetry = async <T,>(path: string, body: unknown, maxAttempts = 2): Promise<T> => {
      let attempt = 0;
      while (true) {
        try { return await postJSON<T>(path, body); }
        catch (e) {
          const err = e as Error & { transient?: boolean };
          if (err.transient && attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
            attempt++; continue;
          }
          throw err;
        }
      }
    };

    try {
      // Corps de démarrage selon le mode : SPR = on crée d'abord un document
      // `spr` (mode commune) puis on ingère en MODE DOCUMENT (doc_id) → zones
      // SPR isolées, PLU jamais purgé. PLU = mode commune historique inchangé.
      let startBody: unknown;
      if (spr) {
        setPhase("Création du document SPR…");
        const doc = await postJSON<{ id: string }>("/api/mairie/documents", {
          commune_name: communeInput.trim(), type: "spr", name: `SPR — ${communeInput.trim()}`,
          original_filename: pdfFile.name, file_size: pdfFile.size,
        });
        startBody = { doc_id: doc.id, pdf_base64 };
      } else {
        startBody = { commune_name: communeInput.trim(), insee_code: inseeInput.trim(), pdf_base64 };
      }
      setPhase(spr ? "Analyse du règlement SPR…" : "Lecture du sommaire…");
      const startResp = await postJSONWithRetry<StartResp>("/api/mairie/admin/ingest-plu-pdf/start", startBody);
      const { jobId, zones: zoneSpecs } = startResp;
      // Persiste le jobId : si l'utilisateur navigue ailleurs, on reprendra au
      // remount via le useEffect ci-dessus.
      try { localStorage.setItem(JOB_KEY(inseeInput.trim()), jobId); } catch { /* SSR-safe */ }
      setZoneProgress(zoneSpecs.map((z) => ({ code: z.code, label: z.label, type: z.type, status: "pending" })));
      setPhase(`${zoneSpecs.length} ${L.unit}${zoneSpecs.length > 1 ? "s" : ""} détecté${zoneSpecs.length > 1 ? "s" : ""}. Extraction en arrière-plan…`);
      // Le serveur fait tout le travail (extraction des règles + écriture DB).
      // On suit l'avancée via polling de /status.
      startPolling(jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur serveur");
      setPhase(null);
      setLoading(false);
    }
  };

  const ZONE_COLORS: Record<string, string> = { U: "#4338CA", AU: "#C2410C", A: "#A16207", N: "#15803D", spr: "#9D174D" };
  const doneCount = zoneProgress.filter(z => z.status === "done").length;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 24px", minHeight: 400 }}>
      <div style={{ width: "100%", maxWidth: 540, background: "white", borderRadius: 16, border: "1px solid #E2E8F0", padding: 32, boxShadow: "0 2px 16px rgba(0,0,0,0.06)" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, marginBottom: 10 }}>📄</div>
          <div style={{ fontWeight: 700, color: "#0F172A", fontSize: 16, marginBottom: 6 }}>Charger le {L.title} de {commune || "la commune"}</div>
          <div style={{ fontSize: 13, color: "#64748b" }}>
            {L.desc}
          </div>
          {loadError && <div style={{ marginTop: 10, fontSize: 12, color: "#DC2626" }}>Erreur de chargement : {loadError}</div>}
        </div>

        {!loading && (
          <>
            {/* Commune/INSEE éditables au bootstrap PLU ; en mode SPR la commune
                est fixée (onglet d'une commune donnée) → champs masqués. */}
            {!spr && (
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 2 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>COMMUNE</div>
                  <input value={communeInput} onChange={e => setCommuneInput(e.target.value)} placeholder="ex : Tours" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>CODE INSEE</div>
                  <input value={inseeInput} onChange={e => setInseeInput(e.target.value)} placeholder="ex : 37261" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
                </div>
              </div>
            )}

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{ border: `2px dashed ${dragging ? "#4F46E5" : pdfFile ? "#22c55e" : "#CBD5E1"}`, borderRadius: 12, padding: "28px 16px", textAlign: "center", cursor: "pointer", background: dragging ? "#EEF2FF" : pdfFile ? "#F0FDF4" : "#F8FAFC", transition: "all 0.15s", marginBottom: 16 }}
            >
              {pdfFile ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>✓ {pdfFile.name}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{(pdfFile.size / 1024 / 1024).toFixed(1)} Mo — cliquez pour changer</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}>Glissez le PDF ici ou cliquez pour parcourir</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{L.hint}</div>
                </>
              )}
              <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => handleFile(e.target.files?.[0] ?? null)} />
            </div>
          </>
        )}

        {/* ── Progression en cours ── */}
        {loading && (
          <div style={{ marginBottom: 16 }}>
            {phase && (
              <div style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#4F46E5", display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 14, height: 14, border: "2px solid #4F46E5", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                {phase}
              </div>
            )}
            {zoneProgress.length > 0 && (
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10, lineHeight: 1.5 }}>
                ℹ Vous pouvez fermer cet onglet ou naviguer ailleurs — l'extraction continue côté serveur. Revenez ici pour suivre l'avancée.
              </div>
            )}
            {zoneProgress.length > 0 && (
              <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "8px 14px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", fontSize: 11, fontWeight: 600, color: "#64748b", display: "flex", justifyContent: "space-between" }}>
                  <span>{L.detected}</span>
                  <span style={{ color: "#4F46E5" }}>{doneCount} / {zoneProgress.length}</span>
                </div>
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {zoneProgress.map(z => (
                    <div key={z.code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: ZONE_COLORS[z.type] ?? "#4F46E5", background: `${ZONE_COLORS[z.type] ?? "#4F46E5"}18`, border: `1px solid ${ZONE_COLORS[z.type] ?? "#4F46E5"}33`, borderRadius: 5, padding: "1px 6px", minWidth: 28, textAlign: "center" }}>{z.code}</span>
                      <span style={{ flex: 1, fontSize: 12, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{z.label}</span>
                      {z.status === "done" ? (
                        <span style={{ fontSize: 11, color: "#15803D", fontWeight: 600 }}>✓ {z.rules} règle{(z.rules ?? 0) > 1 ? "s" : ""}</span>
                      ) : (
                        <>
                          {z.batch && z.total_batches ? (
                            <span style={{ fontSize: 11, color: "#64748b" }}>lot {z.batch}/{z.total_batches}</span>
                          ) : null}
                          <div style={{ width: 12, height: 12, border: "2px solid #C7D2FE", borderTopColor: "#4F46E5", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ height: 4, background: "#E2E8F0" }}>
                  <div style={{ height: "100%", background: "#4F46E5", width: `${zoneProgress.length ? (doneCount / zoneProgress.length) * 100 : 0}%`, transition: "width 0.4s" }} />
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#DC2626", marginBottom: 14 }}>⚠ {error}</div>
        )}
        {done && (
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 8, padding: "12px 14px", fontSize: 13, color: "#15803d", marginBottom: 14 }}>
            ✓ {done.zones} {L.unit}{done.zones > 1 ? "s" : ""} · {done.rules} règle{done.rules > 1 ? "s" : ""} extraites
            {done.needs_review > 0 && ` · ${done.needs_review} à vérifier`} — chargement…
          </div>
        )}

        {!loading && (
          <>
            <button
              onClick={handleSubmit}
              disabled={!pdfFile || !communeInput || !inseeInput}
              style={{ width: "100%", background: !pdfFile || !communeInput || !inseeInput ? "#A5B4FC" : L.accent, color: "white", border: "none", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 700, cursor: !pdfFile ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
            >
              {L.action}
            </button>
            {onManual && (
              <>
                <div style={{ textAlign: "center", margin: "14px 0 10px", fontSize: 12, color: "#94a3b8" }}>— ou —</div>
                <button onClick={onManual} style={{ width: "100%", background: "white", border: "1px solid #C7D2FE", borderRadius: 10, padding: "11px 20px", fontSize: 13, fontWeight: 600, color: "#4F46E5", cursor: "pointer" }}>
                  ✏️ Créer / saisir les zones manuellement
                </button>
                <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.5 }}>
                  Créez vos zones, puis collez le texte de chaque article : l'IA le structure et vous validez.
                </div>
              </>
            )}
            {onCancel && (
              <button onClick={onCancel} style={{ width: "100%", marginTop: 10, background: "none", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 20px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>
                ← Retour à la réglementation
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Réglementation screen ──────────────────────────────────────────────────────

type RuleCase = { condition: string; value: number | null; unit: string | null; kind?: "condition" | "parametre" };
type RuleRow = {
  id: string; zone_id: string; article_number: number | null; article_title: string | null;
  topic: string; rule_text: string; value_min: number | null; value_max: number | null;
  value_exact: number | null; unit: string | null; conditions: string | null; exceptions?: string | null; summary: string | null;
  instructor_note: string | null; validation_status: string; cases?: RuleCase[] | null;
  applies_if?: string[] | null; sub_theme?: string | null;
  citizen_title?: string | null; citizen_summary?: string | null; citizen_relevant?: boolean | null;
};
// Sous-règle extraite par l'agent (avant enregistrement).
type ExtractedRule = {
  sub_theme: string | null; article_number: number | null; article_title: string;
  topic: string; rule_text: string; value_min: number | null; value_max: number | null;
  value_exact: number | null; unit: string | null; conditions: string | null; exceptions: string | null; summary: string;
  cases: RuleCase[]; applies_if: string[];
  citizen_title?: string | null; citizen_summary?: string | null; citizen_relevant?: boolean;
};
// Libellés lisibles des tags d'applicabilité.
const APPLIES_LABEL: Record<string, string> = {
  protege_l151_19: "Élément protégé L.151-19", unesco: "Périmètre UNESCO", abf: "Périmètre ABF",
  inondable: "Zone inondable", extension: "Extension", surelevation: "Surélévation",
  ravalement: "Ravalement", demolition: "Démolition", cloture_sur_rue: "Clôture sur rue",
  cloture_limite: "Clôture en limite", annexe: "Annexe", devanture_commerciale: "Devanture commerciale",
  equipement_public: "Équipement public",
};

// Renvois internes : repère les références à d'autres articles de la zone
// (« UA-2 », « article 7 », « art. 10 ») présentes dans le texte d'une règle.
function extractArticleRefs(rule: RuleRow, zoneArticles: Set<number>): number[] {
  const text = `${rule.rule_text} ${rule.conditions ?? ""} ${rule.exceptions ?? ""}`;
  const found = new Set<number>();
  for (const m of text.matchAll(/\b[0-9]?[A-Z]{1,3}[a-z0-9]*-(\d{1,2})(?:\.\d+)?\b/g)) {
    const n = Number(m[1]); if (zoneArticles.has(n) && n !== rule.article_number) found.add(n);
  }
  for (const m of text.matchAll(/\bart(?:icle)?\.?\s+(\d{1,2})\b/gi)) {
    const n = Number(m[1]); if (zoneArticles.has(n) && n !== rule.article_number) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}
type ZoneRow = {
  id: string; zone_code: string; zone_label: string; zone_type: string; summary: string | null;
  rules: RuleRow[];
  stats: { total: number; valide: number; brouillon: number; rejete: number };
};
type ReglData = { commune: { id: string; name: string; insee_code: string; has_spr?: boolean }; zones: ZoneRow[] };

const TOPIC_META: Record<string, { label: string; icon: string }> = {
  interdictions:    { label: "Occupations interdites",     icon: "🚫" },
  conditions:       { label: "Occupations sous conditions", icon: "⚠️" },
  desserte_voies:   { label: "Voies et accès",             icon: "🚗" },
  desserte_reseaux: { label: "Réseaux",                    icon: "🔌" },
  terrain_min:      { label: "Caractéristiques terrains",  icon: "📏" },
  recul_voie:       { label: "Implantation / voies",       icon: "🛣️" },
  recul_limite:     { label: "Implantation / limites",     icon: "📐" },
  recul_batiments:  { label: "Implantation entre bâtiments", icon: "🏢" },
  emprise_sol:      { label: "Emprise au sol",             icon: "🏠" },
  hauteur:          { label: "Hauteur max.",               icon: "📐" },
  aspect:           { label: "Aspect extérieur",           icon: "🎨" },
  stationnement:    { label: "Stationnement",              icon: "🅿️" },
  espaces_verts:    { label: "Espaces libres / plantations", icon: "🌳" },
  cos:              { label: "COS",                        icon: "📊" },
  destinations:     { label: "Destinations",               icon: "🏗️" },
  general:          { label: "Général",                    icon: "📋" },
};

// Structure nationale du règlement PLU (art. R.123-9) : 14 articles par zone.
// Articles 5 et 14 abrogés par la loi ALUR (24 mars 2014) → "sans objet".
const PLU_ARTICLES: Record<number, { title: string; topic: string; abroge?: boolean }> = {
  1:  { title: "Occupations et utilisations du sol interdites", topic: "interdictions" },
  2:  { title: "Occupations soumises à des conditions particulières", topic: "conditions" },
  3:  { title: "Desserte par les voies — accès aux voies ouvertes au public", topic: "desserte_voies" },
  4:  { title: "Desserte par les réseaux", topic: "desserte_reseaux" },
  5:  { title: "Caractéristiques des terrains (sans objet — loi ALUR)", topic: "terrain_min", abroge: true },
  6:  { title: "Implantation par rapport aux voies et emprises publiques", topic: "recul_voie" },
  7:  { title: "Implantation par rapport aux limites séparatives", topic: "recul_limite" },
  8:  { title: "Implantation des constructions les unes par rapport aux autres", topic: "recul_batiments" },
  9:  { title: "Emprise au sol des constructions", topic: "emprise_sol" },
  10: { title: "Hauteur maximale des constructions", topic: "hauteur" },
  11: { title: "Aspect extérieur et aménagement des abords", topic: "aspect" },
  12: { title: "Aires de stationnement", topic: "stationnement" },
  13: { title: "Espaces libres et plantations", topic: "espaces_verts" },
  14: { title: "Coefficient d'occupation des sols — COS (sans objet — loi ALUR)", topic: "cos", abroge: true },
};


const ZONE_TYPE_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  U:  { bg: "#EEF2FF", color: "#4338CA", border: "#C7D2FE", label: "Urbaine" },
  AU: { bg: "#FFF7ED", color: "#C2410C", border: "#FED7AA", label: "À urbaniser" },
  A:  { bg: "#FEFCE8", color: "#A16207", border: "#FDE68A", label: "Agricole" },
  N:  { bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0", label: "Naturelle" },
  spr: { bg: "#FDF2F8", color: "#9D174D", border: "#FBCFE8", label: "Secteur SPR" },
};

// Découpe le règlement collé en blocs analysables par l'IA.
// Objectif : aucun bloc > MAX_CHARS (sinon l'appel LLM dépasse 120 s).
//
// Étape 1 — coupe sur les en-têtes d'article (« Article 7 », « Préambule »,
// « ARTICLE U.A.1 », « **Article 11 -** »). Insensible à la casse, tolère
// préfixes markdown, démarre en début de ligne OU en début de texte.
//
// Étape 2 — si un bloc reste trop long (PDF copié sans newlines, format
// inattendu), on le sous-découpe par paragraphes (`\n\n`) en agrégant
// jusqu'à MAX_CHARS. En tout dernier recours, coupe brute par taille pour
// garantir qu'aucun bloc ne dépasse la limite.
// 8000 chars = ~2000 tokens en entrée + une marge pour l'output structuré.
// Un Article 11 (aspect extérieur) bien fourni fait 6-7k chars : on le garde
// entier. Au-delà on sous-découpe par paragraphes pour rester < 60 s par appel.
const MAX_CHARS_PER_CHUNK = 8000;

export function splitZoneIntoChunks(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];

  // Étape 1 : coupe par article (regex permissive)
  // - début de ligne (\n) OU début du texte (^)
  // - préfixes markdown optionnels (** ## ·)
  // - "Article" / "ARTICLE" / "Préambule" / "PRÉAMBULE"
  // - séparateur libre puis chiffre/lettre dans la même ligne (≤120 chars)
  const HEADER = /(?:^|\n)(?:[*#·•\-—–]+\s*)?(?:article|préambule|preambule)\b[^\n]{0,120}/gi;
  const headerMatches: number[] = [];
  for (const m of text.matchAll(HEADER)) {
    // L'index de la regex est celui du `\n` ou du début du texte ; on coupe
    // après ce `\n` (ou à 0 si début de texte) pour démarrer l'en-tête au
    // début du chunk.
    const at = m.index ?? 0;
    headerMatches.push(text[at] === "\n" ? at + 1 : at);
  }

  let chunks: string[] = [];
  if (headerMatches.length > 0) {
    // Insère un point de coupe en 0 si le premier en-tête n'est pas au début
    if (headerMatches[0] !== 0) headerMatches.unshift(0);
    for (let i = 0; i < headerMatches.length; i++) {
      const start = headerMatches[i]!;
      const end = headerMatches[i + 1] ?? text.length;
      const piece = text.slice(start, end).trim();
      if (piece.length > 15) chunks.push(piece);
    }
  } else {
    chunks = [text];
  }

  // Étape 2 : si un bloc reste trop gros, sous-découpe par paragraphe
  const final: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= MAX_CHARS_PER_CHUNK) {
      final.push(chunk);
      continue;
    }
    // Découpe par double saut de ligne puis agrège en respectant MAX_CHARS
    const paragraphs = chunk.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let buf = "";
    for (const p of paragraphs) {
      if (buf && (buf.length + p.length + 2) > MAX_CHARS_PER_CHUNK) {
        final.push(buf);
        buf = "";
      }
      buf = buf ? `${buf}\n\n${p}` : p;
    }
    if (buf) final.push(buf);
  }

  // Étape 3 : coupe brute pour les blocs encore trop longs (texte sans
  // paragraphes). Garantit qu'aucun chunk ne dépasse la limite.
  const safe: string[] = [];
  for (const chunk of final) {
    if (chunk.length <= MAX_CHARS_PER_CHUNK) {
      safe.push(chunk);
      continue;
    }
    for (let i = 0; i < chunk.length; i += MAX_CHARS_PER_CHUNK) {
      safe.push(chunk.slice(i, i + MAX_CHARS_PER_CHUNK));
    }
  }

  return safe;
}

// Consomme un stream SSE structure-article / structure-zone et retourne le
// résultat final. Centralise la logique de parsing pour qu'analyzeArticle et
// analyzeZone partagent exactement le même contrat (events `done` / `error`).
async function consumeStructureStream(resp: Response): Promise<{ rules: ExtractedRule[]; diagnostic: string | null }> {
  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => "");
    throw new Error(txt || `Erreur ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let rules: ExtractedRule[] | null = null;
  let diagnostic: string | null = null;
  let errorMsg: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (ev.type === "done") {
          rules = (ev.rules as ExtractedRule[]) ?? [];
          if (typeof ev.diagnostic === "string") diagnostic = ev.diagnostic;
        } else if (ev.type === "error") {
          errorMsg = (ev.message as string) || "Échec de l'analyse";
        }
      } catch { /* ligne mal formée — on continue */ }
    }
  }
  if (errorMsg) throw new Error(errorMsg);
  return { rules: rules ?? [], diagnostic };
}

export function ReglementationScreen({ commune, inseeCode }: { commune: string; inseeCode?: string }) {
  const [data, setData] = useState<ReglData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  // Onglet actif Réglementation : "plu" (défaut, comportement historique) ou
  // "spr". L'onglet SPR n'est proposé que si la commune a activé has_spr.
  const [regTab, setRegTab] = useState<"plu" | "spr">("plu");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<RuleRow>>({});
  const [saving, setSaving] = useState(false);
  const [addingZoneId, setAddingZoneId] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<Partial<RuleRow>>({ topic: "recul_voie", article_number: null, rule_text: "", summary: "" });
  const [showUpload, setShowUpload] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [addingZone, setAddingZone] = useState(false);
  const [newZone, setNewZone] = useState({ code: "", label: "", type: "U" });
  const [savingZone, setSavingZone] = useState(false);
  const [purging, setPurging] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [zoneMode, setZoneMode] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [zoneProgress, setZoneProgress] = useState<{ done: number; total: number } | null>(null);
  const [extracted, setExtracted] = useState<ExtractedRule[]>([]);
  const [addingExtracted, setAddingExtracted] = useState(false);
  const [pasteImage, setPasteImage] = useState<{ data: string; media: string; name: string } | null>(null);

  const pickImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      const data = res.split(",")[1] ?? "";
      setPasteImage({ data, media: file.type || "image/png", name: file.name });
    };
    reader.readAsDataURL(file);
  };

  const analyzeArticle = async (zoneCode: string) => {
    if (pasteText.trim().length < 5 && !pasteImage) return;
    setAnalyzing(true);
    try {
      const resp = await fetch("/api/mairie/reglementation/structure-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: pasteText, zone_code: zoneCode, article_number: newRule.article_number ?? undefined,
          image_base64: pasteImage?.data, image_media_type: pasteImage?.media,
        }),
      });
      const { rules, diagnostic } = await consumeStructureStream(resp);
      setExtracted(rules);
      if (diagnostic) alert(diagnostic);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l'analyse");
    } finally {
      setAnalyzing(false);
    }
  };

  const analyzeZone = async (zoneCode: string) => {
    if (pasteText.trim().length < 50) return;
    // On découpe le pavé par ARTICLE puis on traite chaque article en une petite
    // requête : générer ~40 règles + version citoyen en un seul appel est trop long
    // et finit en timeout. Article par article = requêtes courtes et fiables.
    const raw = pasteText.trim();
    const chunks = splitZoneIntoChunks(raw);

    setAnalyzing(true);
    setExtracted([]);
    setZoneProgress({ done: 0, total: chunks.length });
    const results: (ExtractedRule[] | null)[] = new Array(chunks.length).fill(null);
    const diagnostics: string[] = [];   // raisons rapportées par l'API quand 0 règle
    const errors: string[] = [];        // messages d'erreur HTTP/réseau
    let done = 0;

    // Traitement en parallèle par lots de 4 pour aller vite sans saturer l'API.
    const BATCH = 4;
    try {
      for (let start = 0; start < chunks.length; start += BATCH) {
        const slice = chunks.slice(start, start + BATCH);
        await Promise.all(slice.map(async (text, k) => {
          const idx = start + k;
          try {
            // Stream SSE — voir mairie.ts route /reglementation/structure-zone.
            // Évite le 502 passerelle sur les zones denses (max_tokens 16 k).
            const resp = await fetch("/api/mairie/reglementation/structure-zone", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ text, zone_code: zoneCode }),
            });
            const { rules, diagnostic } = await consumeStructureStream(resp);
            results[idx] = rules;
            if (rules.length === 0 && diagnostic) diagnostics.push(diagnostic);
          } catch (e) {
            results[idx] = [];
            errors.push(e instanceof Error ? e.message : String(e));
          } finally {
            done++;
            setZoneProgress({ done, total: chunks.length });
          }
        }));
        // Affiche au fil de l'eau, dans l'ordre des articles.
        setExtracted(results.flatMap(x => x ?? []));
      }
      const all = results.flatMap(x => x ?? []);
      const failures = errors.length;
      if (all.length === 0) {
        // Diagnostic différencié : panne réseau vs réponse IA vide vs articles abrogés
        if (failures === chunks.length) {
          const sample = errors[0] ?? "erreur inconnue";
          alert(`Toutes les requêtes (${failures}/${chunks.length}) ont échoué.\n\nMessage : ${sample}\n\nVérifiez le réseau ou réessayez dans un instant.`);
        } else if (failures > 0) {
          alert(`Aucune règle extraite. ${failures}/${chunks.length} requête(s) ont échoué et le reste n'a rien renvoyé.\n\nDernière erreur : ${errors[errors.length - 1]}`);
        } else if (diagnostics.length > 0) {
          // Affiche au plus 3 diagnostics distincts (sinon trop long)
          const unique = [...new Set(diagnostics)].slice(0, 3);
          alert(`Aucune règle extraite sur ${chunks.length} bloc(s) analysé(s).\n\n• ${unique.join("\n• ")}`);
        } else {
          alert("Aucune règle n'a pu être extraite. Vérifiez le texte collé ou réessayez.");
        }
      } else if (failures > 0) {
        alert(`${all.length} règle(s) extraite(s). ${failures} bloc(s) n'ont pas pu être analysés — vous pouvez relancer ou les saisir manuellement.`);
      }
    } finally {
      setAnalyzing(false);
      setZoneProgress(null);
    }
  };

  const addExtracted = async (zoneId: string) => {
    if (!extracted.length) return;
    setAddingExtracted(true);
    try {
      await api.post(`/mairie/reglementation/zones/${zoneId}/rules/bulk`, { rules: extracted });
      setExtracted([]); setPasteText(""); setPasteImage(null); setAddingZoneId(null);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l'ajout");
    } finally {
      setAddingExtracted(false);
    }
  };

  const purgeAll = async () => {
    if (!inseeCode) { alert("Code INSEE de la commune introuvable."); return; }
    if (!confirm(`Vider toute la réglementation de ${commune} ? Cette action supprime toutes les zones et règles de cette commune.`)) return;
    setPurging(true);
    try {
      await api.delete(`/mairie/reglementation?insee_code=${encodeURIComponent(inseeCode)}`);
      setSelectedZoneId(null);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la suppression");
    } finally {
      setPurging(false);
    }
  };

  const load = () => {
    setLoading(true);
    setLoadError(null);
    const param = inseeCode
      ? `insee_code=${encodeURIComponent(inseeCode)}`
      : `commune_name=${encodeURIComponent(commune)}`;
    // Écran d'administration des règles : on doit voir les brouillons et
    // rejetées pour pouvoir les valider. Tous les autres callers (carte,
    // dashboards) reçoivent par défaut uniquement les règles validées.
    api.get<ReglData>(`/mairie/reglementation?${param}&include_drafts=true`)
      .then(d => {
        setData(d);
        if (d.zones[0] && !selectedZoneId) setSelectedZoneId(d.zones[0].id);
      })
      .catch(e => { setData(null); setLoadError(e.message ?? "Erreur de chargement"); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [commune, inseeCode]);

  // Si une ingestion PLU est en cours côté serveur pour cette commune
  // (jobId persisté en localStorage par PluUploadPanel), on force l'affichage
  // du panneau d'upload — qui détectera de son côté le job actif et lancera
  // le polling de /status. Sans ça, lorsqu'un référentiel existe déjà en DB,
  // ce composant rendait la liste des zones et l'avancée d'ingestion restait
  // invisible (transaction d'écriture seulement à la fin du worker).
  useEffect(() => {
    const insee = (inseeCode ?? "").trim();
    if (!insee) return;
    let active: string | null = null;
    try { active = localStorage.getItem(`plu-ingest-job:${insee}`); } catch { /* SSR-safe */ }
    if (active) setShowUpload(true);
  }, [inseeCode]);

  const patchRule = async (id: string, patch: Partial<RuleRow>) => {
    setSaving(true);
    try {
      await api.patch(`/mairie/reglementation/rules/${id}`, patch);
      setData(prev => prev ? {
        ...prev,
        zones: prev.zones.map(z => ({
          ...z,
          rules: z.rules.map(r => r.id === id ? { ...r, ...patch } : r),
          stats: computeStats(z.rules.map(r => r.id === id ? { ...r, ...patch } : r)),
        })),
      } : null);
    } finally { setSaving(false); }
  };

  // Valide d'un coup tous les brouillons — d'une zone (zoneId fourni) ou de
  // toute la commune. Ne touche pas aux règles déjà validées/rejetées.
  const bulkValidate = async (zoneId?: string) => {
    const draftCount = zoneId
      ? (data?.zones.find(z => z.id === zoneId)?.stats.brouillon ?? 0)
      : (data?.zones.reduce((n, z) => n + z.stats.brouillon, 0) ?? 0);
    if (draftCount === 0) return;
    const label = zoneId
      ? `Valider les ${draftCount} brouillon(s) de cette zone ?`
      : `Valider les ${draftCount} brouillon(s) de toutes les zones de ${commune} ?`;
    if (!confirm(label)) return;
    setSaving(true);
    try {
      await api.post("/mairie/reglementation/rules/bulk-validate",
        zoneId ? { zone_id: zoneId } : (inseeCode ? { insee_code: inseeCode } : { commune_name: commune }));
      const promote = (r: RuleRow): RuleRow =>
        (r.validation_status === "brouillon" || r.validation_status === "draft")
          ? { ...r, validation_status: "valide" } : r;
      setData(prev => prev ? {
        ...prev,
        zones: prev.zones.map(z => (zoneId && z.id !== zoneId) ? z : {
          ...z,
          rules: z.rules.map(promote),
          stats: computeStats(z.rules.map(promote)),
        }),
      } : null);
    } finally { setSaving(false); }
  };

  const deleteRule = async (id: string) => {
    if (!confirm("Supprimer cette règle ?")) return;
    await api.delete(`/mairie/reglementation/rules/${id}`);
    setData(prev => prev ? {
      ...prev,
      zones: prev.zones.map(z => ({
        ...z,
        rules: z.rules.filter(r => r.id !== id),
        stats: computeStats(z.rules.filter(r => r.id !== id)),
      })),
    } : null);
  };

  const addRule = async (zoneId: string) => {
    if (!newRule.rule_text || !newRule.topic) return;
    const created = await api.post<RuleRow>(`/mairie/reglementation/zones/${zoneId}/rules`, newRule);
    setData(prev => prev ? {
      ...prev,
      zones: prev.zones.map(z => z.id === zoneId
        ? { ...z, rules: [...z.rules, created], stats: computeStats([...z.rules, created]) }
        : z),
    } : null);
    setAddingZoneId(null);
    setNewRule({ topic: "recul_voie", article_number: null, rule_text: "", summary: "" });
    setPasteText("");
    setExtracted([]);
    setPasteImage(null);
  };

  const addZone = async () => {
    if (!newZone.code.trim() || !newZone.label.trim()) return;
    setSavingZone(true);
    try {
      const created = await api.post<ZoneRow>("/mairie/reglementation/zones", {
        ...(inseeCode ? { insee_code: inseeCode } : { commune_name: commune }),
        zone_code: newZone.code.trim().toUpperCase(),
        zone_label: newZone.label.trim(),
        zone_type: newZone.type,
      });
      setData(prev => prev ? { ...prev, zones: [...prev.zones, { ...created, rules: [], stats: { total: 0, valide: 0, brouillon: 0, rejete: 0 } }] } : null);
      setSelectedZoneId(created.id);
      setAddingZone(false);
      setNewZone({ code: "", label: "", type: "U" });
    } finally { setSavingZone(false); }
  };

  const deleteZone = async (zoneId: string) => {
    if (!confirm("Supprimer cette zone et toutes ses règles ?")) return;
    await api.delete(`/mairie/reglementation/zones/${zoneId}`);
    setData(prev => prev ? { ...prev, zones: prev.zones.filter(z => z.id !== zoneId) } : null);
    if (selectedZoneId === zoneId) setSelectedZoneId(null);
  };

  const computeStats = (rules: RuleRow[]) => ({
    total: rules.length,
    valide: rules.filter(r => r.validation_status === "valide").length,
    brouillon: rules.filter(r => r.validation_status === "brouillon" || r.validation_status === "draft").length,
    rejete: rules.filter(r => r.validation_status === "rejete").length,
  });

  // Onglets PLU / SPR (SPR proposé seulement si la commune l'a activé). Le
  // filtrage par zone_type est purement front : les zones PLU (U/AU/A/N) restent
  // à l'identique dans l'onglet PLU, les zones SPR (zone_type "spr") vont dans
  // l'onglet SPR. Aucune commune sans has_spr ne voit de changement.
  const hasSprTab = !!data?.commune.has_spr;
  const sprZones = data ? data.zones.filter(z => z.zone_type === "spr") : [];
  const pluZones = data ? data.zones.filter(z => z.zone_type !== "spr") : [];
  const onSpr = hasSprTab && regTab === "spr";
  const visibleZones = onSpr ? sprZones : pluZones;
  const selectedZone = visibleZones.find(z => z.id === selectedZoneId);
  const totalStats = visibleZones.length ? visibleZones.reduce((acc, z) => ({
    total: acc.total + z.stats.total,
    valide: acc.valide + z.stats.valide,
  }), { total: 0, valide: 0 }) : null;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #E2E8F0", borderTopColor: "#4F46E5", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  if (!data || ((data.zones.length === 0 || showUpload) && !manualMode)) return (
    <PluUploadPanel
      commune={commune}
      inseeCode={inseeCode}
      onSuccess={() => { setShowUpload(false); load(); }}
      loadError={loadError}
      onCancel={data && data.zones.length > 0 ? () => setShowUpload(false) : undefined}
      onManual={() => { setManualMode(true); setShowUpload(false); }}
    />
  );

  const statusDot = (status: string) => {
    const s = status === "valide" ? { bg: "#DCFCE7", color: "#15803D", label: "Validée" }
      : status === "rejete" ? { bg: "#FEE2E2", color: "#DC2626", label: "Rejetée" }
      : { bg: "#FEF9C3", color: "#A16207", label: "À valider" };
    return (
      <span style={{ background: s.bg, color: s.color, borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>{s.label}</span>
    );
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 56px)", background: "#F8FAFC" }}>

      {/* ── Left: zone list ── */}
      <div style={{ width: 288, flexShrink: 0, borderRight: "1px solid #E2E8F0", background: "white", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #F1F5F9" }}>
          {/* Onglets PLU / SPR — uniquement si la commune a activé le SPR. */}
          {hasSprTab && (
            <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E2E8F0", marginBottom: 14 }}>
              {(["plu", "spr"] as const).map(t => (
                <button key={t} onClick={() => { setRegTab(t); setSelectedZoneId(null); setShowUpload(false); }}
                  style={{ border: "none", background: "none", padding: "6px 14px", fontSize: 13,
                    fontWeight: regTab === t ? 600 : 400, color: regTab === t ? "#9D174D" : "#64748b",
                    borderBottom: regTab === t ? "2px solid #9D174D" : "2px solid transparent", marginBottom: -2, cursor: "pointer" }}>
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#000020" }}>Réglementation {onSpr ? "SPR" : "PLU"}</div>
            {/* Actions PLU (vider / importer) réservées à l'onglet PLU — l'upload
                SPR se fait via son propre panneau dans la zone de droite. */}
            {!onSpr && (
              <div style={{ display: "flex", gap: 6 }}>
                {pluZones.length > 0 && (
                  <button onClick={purgeAll} disabled={purging} title="Vider la réglementation de cette commune" style={{ border: "1px solid #FECACA", background: "white", borderRadius: 7, padding: "4px 9px", fontSize: 11, color: "#DC2626", cursor: purging ? "wait" : "pointer", fontWeight: 600 }}>{purging ? "Suppression…" : "🗑 Vider"}</button>
                )}
                <button onClick={() => { setManualMode(false); setShowUpload(true); }} title="Importer un PLU (PDF)" style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 7, padding: "4px 9px", fontSize: 11, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}>↑ Importer PDF</button>
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>{commune}</div>
          {totalStats && (
            <div style={{ marginTop: 12, background: "#F8FAFC", borderRadius: 10, padding: "10px 14px", border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "#6B7280" }}>Progression globale</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5" }}>
                  {totalStats.valide} / {totalStats.total}
                </span>
              </div>
              <div style={{ height: 6, background: "#E2E8F0", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${totalStats.total ? (totalStats.valide / totalStats.total) * 100 : 0}%`, background: "#4F46E5", borderRadius: 99, transition: "width 0.3s" }} />
              </div>
              {(() => {
                const drafts = visibleZones.reduce((n, z) => n + z.stats.brouillon, 0);
                if (drafts === 0) return null;
                return (
                  <button onClick={() => bulkValidate()} disabled={saving} title="Valider tous les brouillons de toutes les zones"
                    style={{ marginTop: 10, width: "100%", padding: "7px 0", border: "1px solid #BBF7D0", background: "#F0FDF4", borderRadius: 8, fontSize: 12, color: "#15803D", cursor: saving ? "wait" : "pointer", fontWeight: 600 }}>
                    ✓ Valider {drafts} brouillon{drafts > 1 ? "s" : ""}
                  </button>
                );
              })()}
            </div>
          )}
        </div>

        {/* Zone cards */}
        <div style={{ flex: 1, padding: "12px 12px" }}>
          {visibleZones.map(zone => {
            const ts = ZONE_TYPE_STYLE[zone.zone_type] ?? ZONE_TYPE_STYLE["U"]!;
            const pct = zone.stats.total ? Math.round((zone.stats.valide / zone.stats.total) * 100) : 0;
            const isSelected = zone.id === selectedZoneId;
            return (
              <button key={zone.id} onClick={() => setSelectedZoneId(zone.id)} style={{
                width: "100%", border: `1px solid ${isSelected ? "#4F46E5" : "#E2E8F0"}`, borderRadius: 10, padding: "12px 14px",
                background: isSelected ? "#EEF2FF" : "white", marginBottom: 6, cursor: "pointer", textAlign: "left",
                transition: "all 0.12s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ background: ts.bg, color: ts.color, border: `1px solid ${ts.border}`, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                    {zone.zone_code}
                  </span>
                  <span style={{ fontSize: 12, color: "#374151", fontWeight: isSelected ? 600 : 400, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {zone.zone_label.replace(/^Zone [A-Z0-9]+ [-–] /, "")}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: "#F1F5F9", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#22C55E" : "#4F46E5", borderRadius: 99, transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: 11, color: pct === 100 ? "#16A34A" : "#6B7280", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {pct === 100 ? "✓ Tout validé" : `${zone.stats.valide}/${zone.stats.total}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Nouvelle zone ── */}
        <div style={{ padding: "12px 12px 16px", borderTop: "1px solid #F1F5F9" }}>
          {addingZone ? (
            <div style={{ background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0", padding: 12 }}>
              <input
                value={newZone.code}
                onChange={e => {
                  const code = e.target.value.toUpperCase();
                  // Type déduit automatiquement du code (surchargeable via le menu).
                  const type = /^[0-9]*AU/.test(code) ? "AU"
                    : code.startsWith("U") ? "U"
                    : code.startsWith("A") ? "A"
                    : code.startsWith("N") ? "N"
                    : newZone.type;
                  setNewZone(z => ({ ...z, code, type }));
                }}
                placeholder="Code (ex : Ni)"
                style={{ width: "100%", padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none", marginBottom: 8, boxSizing: "border-box" as const }}
              />
              <input
                value={newZone.label} onChange={e => setNewZone(z => ({ ...z, label: e.target.value }))}
                placeholder="Libellé (ex : Zone Ni – Naturelle inondable)"
                style={{ width: "100%", padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none", marginBottom: 8, boxSizing: "border-box" as const }}
              />
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Type (déduit du code — modifiable)</div>
              <select value={newZone.type} onChange={e => setNewZone(z => ({ ...z, type: e.target.value }))}
                style={{ width: "100%", padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none", marginBottom: 10, background: "white", boxSizing: "border-box" as const }}>
                <option value="U">U — Urbaine</option>
                <option value="AU">AU — À urbaniser</option>
                <option value="A">A — Agricole</option>
                <option value="N">N — Naturelle</option>
              </select>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setAddingZone(false); setNewZone({ code: "", label: "", type: "U" }); }} style={{ flex: 1, padding: "7px 0", border: "1px solid #E2E8F0", background: "white", borderRadius: 7, fontSize: 12, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                <button onClick={addZone} disabled={savingZone || !newZone.code || !newZone.label} style={{ flex: 1, padding: "7px 0", border: "none", background: "#4F46E5", color: "white", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {savingZone ? "…" : "Créer"}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingZone(true)} style={{ width: "100%", padding: "8px 0", border: "1px dashed #C7D2FE", background: "#F5F3FF", borderRadius: 8, fontSize: 12, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}>
              + Nouvelle zone
            </button>
          )}
        </div>
      </div>

      {/* ── Right: rules ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        {onSpr && sprZones.length === 0 ? (
          // Onglet SPR sans règlement encore chargé → même panneau d'ingestion
          // que le PLU, en mode `spr` (crée le document + ingère en doc_id ;
          // réutilise job de fond, polling, reprise et progression par secteur).
          <PluUploadPanel spr commune={commune} inseeCode={inseeCode} onSuccess={load} loadError={null} />
        ) : !selectedZone ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#9CA3AF", fontSize: 14 }}>
            ← Sélectionnez {onSpr ? "un secteur" : "une zone"}
          </div>
        ) : (
          <>
            {/* Zone header */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                {(() => { const ts = ZONE_TYPE_STYLE[selectedZone.zone_type] ?? ZONE_TYPE_STYLE["U"]!; return (
                  <span style={{ background: ts.bg, color: ts.color, border: `1px solid ${ts.border}`, borderRadius: 8, padding: "4px 12px", fontSize: 13, fontWeight: 700 }}>
                    {selectedZone.zone_code} — {ts.label}
                  </span>
                ); })()}
                <span style={{ fontSize: 16, fontWeight: 700, color: "#000020", flex: 1 }}>{selectedZone.zone_label}</span>
                {selectedZone.stats.brouillon > 0 && (
                  <button onClick={() => bulkValidate(selectedZone.id)} disabled={saving} title="Valider tous les brouillons de cette zone"
                    style={{ border: "1px solid #BBF7D0", background: "#F0FDF4", borderRadius: 7, padding: "4px 10px", fontSize: 11, color: "#15803D", cursor: saving ? "wait" : "pointer", fontWeight: 600 }}>
                    ✓ Valider {selectedZone.stats.brouillon} brouillon{selectedZone.stats.brouillon > 1 ? "s" : ""}
                  </button>
                )}
                <button onClick={() => deleteZone(selectedZone.id)} title="Supprimer la zone" style={{ border: "1px solid #FECACA", background: "#FFF5F5", borderRadius: 7, padding: "4px 10px", fontSize: 11, color: "#EF4444", cursor: "pointer" }}>✕ Zone</button>
              </div>
            </div>

            {/* Rules list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selectedZone.rules.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#9CA3AF", background: "white", borderRadius: 12, border: "1px dashed #E2E8F0" }}>
                  Aucune règle pour cette zone.
                </div>
              )}

              {(() => {
                const zoneArticleNums = new Set(selectedZone.rules.map(r => r.article_number).filter((n): n is number => n != null));
                const goToArticle = (n: number) => document.getElementById(`art-${selectedZone.id}-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                const groups: { article: number | null; rules: typeof selectedZone.rules }[] = [];
                for (const r of selectedZone.rules) {
                  const last = groups[groups.length - 1];
                  if (last && last.article === r.article_number) last.rules.push(r);
                  else groups.push({ article: r.article_number, rules: [r] });
                }
                return groups.map(grp => (
                  <div key={`g${grp.article ?? "na"}`} id={grp.article != null ? `art-${selectedZone.id}-${grp.article}` : undefined} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {grp.article != null && (
                      <div style={{ padding: "4px 2px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Article {grp.article}{PLU_ARTICLES[grp.article] ? ` · ${PLU_ARTICLES[grp.article]!.title}` : ""}
                        </span>
                        <button
                          onClick={() => {
                            const a = grp.article!;
                            const def = PLU_ARTICLES[a];
                            setNewRule({ article_number: a, ...(def ? { topic: def.topic, article_title: def.title } : { topic: "general" }), rule_text: "", summary: "" });
                            setPasteText(""); setExtracted([]); setPasteImage(null);
                            setAddingZoneId(selectedZone.id);
                          }}
                          style={{ border: "1px solid #C7D2FE", background: "white", color: "#4F46E5", borderRadius: 7, padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          + Sous-règle
                        </button>
                      </div>
                    )}
                    {grp.rules.map(rule => {
                const meta = TOPIC_META[rule.topic] ?? { label: rule.topic, icon: "📋" };
                const isEditing = editingId === rule.id;
                const statusColor = rule.validation_status === "valide" ? "#22C55E"
                  : rule.validation_status === "rejete" ? "#EF4444" : "#F59E0B";

                return (
                  <div key={rule.id} style={{
                    background: "white", borderRadius: 12, border: "1px solid #E2E8F0",
                    borderLeft: `4px solid ${statusColor}`, overflow: "hidden",
                  }}>
                    {/* Rule header */}
                    <div style={{ padding: "14px 18px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            {rule.article_number ? `Art. ${rule.article_number} • ` : ""}{meta.label}{rule.sub_theme ? ` — ${rule.sub_theme}` : ""}
                          </span>
                          {statusDot(rule.validation_status)}
                        </div>
                        {!isEditing && (
                          <>
                            <p style={{ margin: "0 0 4px", fontSize: 13, color: "#111827", lineHeight: 1.5 }}>{rule.rule_text}</p>
                            {rule.exceptions && (
                              <p style={{ margin: "0 0 4px", fontSize: 12, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "4px 8px", lineHeight: 1.45 }}>
                                <strong>Sauf :</strong> {rule.exceptions}
                              </p>
                            )}
                            {(rule.value_min != null || rule.value_max != null || rule.value_exact != null) && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                {rule.value_min != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#374151" }}>min {rule.value_min} {rule.unit}</span>}
                                {rule.value_max != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#374151" }}>max {rule.value_max} {rule.unit}</span>}
                                {rule.value_exact != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#374151" }}>{rule.value_exact} {rule.unit}</span>}
                                {rule.conditions && <span style={{ background: "#FFF7ED", borderRadius: 6, padding: "2px 8px", fontSize: 11, color: "#C2410C" }}>⚠ {rule.conditions}</span>}
                              </div>
                            )}
                            {(rule.cases?.length ?? 0) > 0 && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                {rule.cases!.filter(c => c.value != null).map((c, i) => {
                                  const isCond = c.kind === "condition";
                                  return (
                                    <span key={i} style={{ background: isCond ? "#FFF7ED" : "#EEF2FF", color: isCond ? "#C2410C" : "#4338CA", borderRadius: 6, padding: "2px 8px", fontSize: 11 }}>
                                      {isCond ? "si " : ""}{c.condition} : <strong>{c.value ?? "—"}{c.unit ? ` ${c.unit}` : ""}</strong>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            {(rule.applies_if?.length ?? 0) > 0 && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                {rule.applies_if!.map((t, i) => (
                                  <span key={i} style={{ background: "#FEF3C7", color: "#92400E", borderRadius: 6, padding: "2px 8px", fontSize: 10.5 }}>⊕ {APPLIES_LABEL[t] ?? t}</span>
                                ))}
                              </div>
                            )}
                            {(() => { const refs = extractArticleRefs(rule, zoneArticleNums); return refs.length > 0 && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                                <span style={{ fontSize: 10.5, color: "#9CA3AF" }}>Renvois :</span>
                                {refs.map(n => (
                                  <button key={n} onClick={() => goToArticle(n)} style={{ background: "#EEF2FF", color: "#4338CA", border: "1px solid #C7D2FE", borderRadius: 6, padding: "1px 8px", fontSize: 10.5, fontWeight: 600, cursor: "pointer" }}>→ Article {n}</button>
                                ))}
                              </div>
                            ); })()}
                          </>
                        )}

                        {/* Inline edit form */}
                        {isEditing && (
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                            <input
                              placeholder="Nom de la sous-règle (ex: Toitures, Clôtures sur rue…)"
                              style={{ borderRadius: 8, border: "1px solid #C7D2FE", padding: "6px 10px", fontSize: 12, outline: "none" }}
                              value={(editForm.sub_theme ?? rule.sub_theme) ?? ""}
                              onChange={e => setEditForm(f => ({ ...f, sub_theme: e.target.value || null }))}
                            />
                            <textarea
                              style={{ width: "100%", minHeight: 72, borderRadius: 8, border: "1px solid #C7D2FE", padding: "8px 10px", fontSize: 13, resize: "vertical", outline: "none", fontFamily: "inherit" }}
                              value={editForm.rule_text ?? rule.rule_text}
                              onChange={e => setEditForm(f => ({ ...f, rule_text: e.target.value }))}
                            />
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {[["value_min", "Min"], ["value_max", "Max"], ["value_exact", "Exact"]].map(([field, label]) => (
                                <label key={field} style={{ fontSize: 11, color: "#6B7280", display: "flex", alignItems: "center", gap: 4 }}>
                                  {label}
                                  <input type="number" style={{ width: 70, borderRadius: 6, border: "1px solid #E2E8F0", padding: "4px 6px", fontSize: 12, outline: "none" }}
                                    value={(editForm[field as keyof RuleRow] ?? rule[field as keyof RuleRow]) as number ?? ""}
                                    onChange={e => setEditForm(f => ({ ...f, [field as string]: e.target.value === "" ? null : Number(e.target.value) }))}
                                  />
                                </label>
                              ))}
                              <label style={{ fontSize: 11, color: "#6B7280", display: "flex", alignItems: "center", gap: 4 }}>
                                Unité
                                <select style={{ borderRadius: 6, border: "1px solid #E2E8F0", padding: "4px 6px", fontSize: 12, outline: "none" }}
                                  value={(editForm.unit ?? rule.unit) ?? ""}
                                  onChange={e => setEditForm(f => ({ ...f, unit: e.target.value || null }))}>
                                  <option value="">—</option>
                                  <option value="m">m</option>
                                  <option value="%">%</option>
                                  <option value="m²">m²</option>
                                  <option value="places">places</option>
                                </select>
                              </label>
                            </div>
                            <input style={{ borderRadius: 8, border: "1px solid #E2E8F0", padding: "6px 10px", fontSize: 12, outline: "none" }}
                              placeholder="Conditions particulières…"
                              value={(editForm.conditions ?? rule.conditions) ?? ""}
                              onChange={e => setEditForm(f => ({ ...f, conditions: e.target.value || null }))}
                            />
                            <input style={{ borderRadius: 8, border: "1px solid #FDE68A", background: "#FFFBEB", padding: "6px 10px", fontSize: 12, outline: "none" }}
                              placeholder="Exceptions / dérogations (sauf… / cf. autre article)…"
                              value={(editForm.exceptions ?? rule.exceptions) ?? ""}
                              onChange={e => setEditForm(f => ({ ...f, exceptions: e.target.value || null }))}
                            />
                            <input style={{ borderRadius: 8, border: "1px solid #E2E8F0", padding: "6px 10px", fontSize: 12, outline: "none" }}
                              placeholder="Résumé (10 mots max)…"
                              value={(editForm.summary ?? rule.summary) ?? ""}
                              onChange={e => setEditForm(f => ({ ...f, summary: e.target.value || null }))}
                            />

                            {/* Version « citoyen » : ce que verra le particulier dans l'analyse publique */}
                            <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, padding: "8px 10px" }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#047857", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                                👤 Version citoyen
                                <label style={{ marginLeft: "auto", fontWeight: 600, color: "#065F46", display: "flex", alignItems: "center", gap: 4 }}>
                                  <input type="checkbox"
                                    checked={(editForm.citizen_relevant ?? rule.citizen_relevant) !== false}
                                    onChange={e => setEditForm(f => ({ ...f, citizen_relevant: e.target.checked }))} />
                                  Visible par le citoyen
                                </label>
                              </div>
                              <input style={{ width: "100%", boxSizing: "border-box", borderRadius: 6, border: "1px solid #A7F3D0", background: "white", padding: "5px 8px", fontSize: 12, fontWeight: 600, color: "#065F46", outline: "none", marginBottom: 5 }}
                                placeholder="Titre court (ex: Hauteur des maisons)…"
                                value={(editForm.citizen_title ?? rule.citizen_title) ?? ""}
                                onChange={e => setEditForm(f => ({ ...f, citizen_title: e.target.value || null }))}
                              />
                              <textarea style={{ width: "100%", boxSizing: "border-box", borderRadius: 6, border: "1px solid #A7F3D0", background: "white", padding: "5px 8px", fontSize: 12, color: "#065F46", outline: "none", resize: "vertical", minHeight: 38, fontFamily: "inherit" }}
                                placeholder="Une phrase simple, en « vous », avec la valeur clé…"
                                value={(editForm.citizen_summary ?? rule.citizen_summary) ?? ""}
                                onChange={e => setEditForm(f => ({ ...f, citizen_summary: e.target.value || null }))}
                              />
                            </div>

                            {/* Cas conditionnels / paramètres */}
                            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px" }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Cas conditionnels / paramètres</div>
                              {(editForm.cases ?? rule.cases ?? []).map((c, i) => (
                                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                                  <input placeholder="Libellé (condition ou paramètre)" style={{ flex: 1, minWidth: 0, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 8px", fontSize: 11.5, outline: "none" }}
                                    value={c.condition}
                                    onChange={e => setEditForm(f => ({ ...f, cases: (f.cases ?? rule.cases ?? []).map((x, j) => j === i ? { ...x, condition: e.target.value } : x) }))}
                                  />
                                  <input type="number" placeholder="val" style={{ width: 56, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 6px", fontSize: 11.5, outline: "none" }}
                                    value={c.value ?? ""}
                                    onChange={e => setEditForm(f => ({ ...f, cases: (f.cases ?? rule.cases ?? []).map((x, j) => j === i ? { ...x, value: e.target.value === "" ? null : Number(e.target.value) } : x) }))}
                                  />
                                  <select style={{ width: 58, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 4px", fontSize: 11.5, outline: "none" }}
                                    value={c.unit ?? ""}
                                    onChange={e => setEditForm(f => ({ ...f, cases: (f.cases ?? rule.cases ?? []).map((x, j) => j === i ? { ...x, unit: e.target.value || null } : x) }))}>
                                    <option value="">—</option><option value="m">m</option><option value="cm">cm</option><option value="%">%</option><option value="m²">m²</option><option value="places">pl.</option>
                                  </select>
                                  <select title="Nature du cas" style={{ width: 84, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 4px", fontSize: 11, outline: "none" }}
                                    value={c.kind ?? "parametre"}
                                    onChange={e => setEditForm(f => ({ ...f, cases: (f.cases ?? rule.cases ?? []).map((x, j) => j === i ? { ...x, kind: e.target.value as "condition" | "parametre" } : x) }))}>
                                    <option value="parametre">paramètre</option>
                                    <option value="condition">condition</option>
                                  </select>
                                  <button onClick={() => setEditForm(f => ({ ...f, cases: (f.cases ?? rule.cases ?? []).filter((_, j) => j !== i) }))}
                                    style={{ border: "none", background: "transparent", color: "#EF4444", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>✕</button>
                                </div>
                              ))}
                              <button onClick={() => setEditForm(f => ({ ...f, cases: [...(f.cases ?? rule.cases ?? []), { condition: "", value: null, unit: (f.unit ?? rule.unit) ?? null, kind: "parametre" }] }))}
                                style={{ border: "1px dashed #C7D2FE", background: "white", color: "#4F46E5", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                + Ajouter un cas
                              </button>
                            </div>

                            <div style={{ display: "flex", gap: 8 }}>
                              <button onClick={async () => { await patchRule(rule.id, { ...editForm, validation_status: "valide" }); setEditingId(null); setEditForm({}); }} disabled={saving}
                                style={{ background: "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                {saving ? "…" : "Sauvegarder & Valider"}
                              </button>
                              <button onClick={() => { setEditingId(null); setEditForm({}); }}
                                style={{ background: "#F1F5F9", color: "#374151", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
                                Annuler
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      {!isEditing && (
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          {rule.validation_status !== "valide" && (
                            <button title="Valider" onClick={() => patchRule(rule.id, { validation_status: "valide" })}
                              style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #BBF7D0", background: "#F0FDF4", color: "#16A34A", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</button>
                          )}
                          {rule.validation_status !== "rejete" && (
                            <button title="Rejeter" onClick={() => patchRule(rule.id, { validation_status: "rejete" })}
                              style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✗</button>
                          )}
                          <button title="Modifier" onClick={() => { setEditingId(rule.id); setEditForm({}); }}
                            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#6B7280", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✏</button>
                          <button title="Supprimer" onClick={() => deleteRule(rule.id)}
                            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#9CA3AF", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>🗑</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
                    })}
                  </div>
                ));
              })()}

              {/* Add rule button */}
              {addingZoneId !== selectedZone.id ? (
                <button onClick={() => setAddingZoneId(selectedZone.id)}
                  style={{ width: "100%", padding: "12px", border: "2px dashed #C7D2FE", borderRadius: 12, background: "transparent", color: "#4F46E5", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
                  + Ajouter une règle
                </button>
              ) : (
                <div style={{ background: "white", borderRadius: 12, border: "1px solid #C7D2FE", padding: "16px 18px" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 12 }}>Nouvelle règle</div>

                  {/* Coller le texte → structuration IA (texte court, pas le PDF) */}
                  <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                    {/* Choix du mode : un article isolé vs le règlement complet de la zone */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      <button onClick={() => { setZoneMode(false); setExtracted([]); }}
                        style={{ flex: 1, fontSize: 11, fontWeight: 600, borderRadius: 8, padding: "6px 8px", cursor: "pointer",
                          border: zoneMode ? "1px solid #DDD6FE" : "1.5px solid #7C3AED",
                          background: zoneMode ? "white" : "#EDE9FE", color: zoneMode ? "#6B7280" : "#6D28D9" }}>
                        Un article
                      </button>
                      <button onClick={() => { setZoneMode(true); setExtracted([]); setPasteImage(null); }}
                        style={{ flex: 1, fontSize: 11, fontWeight: 600, borderRadius: 8, padding: "6px 8px", cursor: "pointer",
                          border: zoneMode ? "1.5px solid #7C3AED" : "1px solid #DDD6FE",
                          background: zoneMode ? "#EDE9FE" : "white", color: zoneMode ? "#6D28D9" : "#6B7280" }}>
                        Règlement complet de la zone
                      </button>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#6D28D9", marginBottom: 6 }}>
                      {zoneMode
                        ? "✨ Collez le règlement complet de la zone (tous les articles). L'IA l'analyse article par article (une règle par sous-section + une version « citoyen » claire)."
                        : "✨ Coller le texte — ou importer une image (tableau / croquis)"}
                    </div>
                    <textarea placeholder={zoneMode ? "Collez ici le règlement complet de la zone (articles 1 à 16)…" : "Collez ici le texte de l'article du PLU…"}
                      style={{ width: "100%", minHeight: zoneMode ? 120 : 60, borderRadius: 8, border: "1px solid #DDD6FE", padding: "8px 10px", fontSize: 12, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                      value={pasteText}
                      onChange={e => setPasteText(e.target.value)}
                    />
                    {!zoneMode && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        <label style={{ fontSize: 11, color: "#6D28D9", cursor: "pointer", border: "1px solid #DDD6FE", borderRadius: 8, padding: "5px 10px", background: "white", fontWeight: 600 }}>
                          📷 Image (tableau / croquis)
                          <input type="file" accept="image/*" style={{ display: "none" }}
                            onChange={e => { const f = e.target.files?.[0]; if (f) pickImage(f); e.target.value = ""; }}
                          />
                        </label>
                        {pasteImage && (
                          <span style={{ fontSize: 11, color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
                            🖼 {pasteImage.name.length > 22 ? pasteImage.name.slice(0, 20) + "…" : pasteImage.name}
                            <button onClick={() => setPasteImage(null)} style={{ border: "none", background: "transparent", color: "#EF4444", cursor: "pointer", fontSize: 13 }}>✕</button>
                          </span>
                        )}
                      </div>
                    )}
                    <button onClick={() => zoneMode ? analyzeZone(selectedZone.zone_code) : analyzeArticle(selectedZone.zone_code)}
                      disabled={analyzing || (zoneMode ? pasteText.trim().length < 50 : (pasteText.trim().length < 5 && !pasteImage))}
                      style={{ marginTop: 8, background: analyzing ? "#A78BFA" : "#7C3AED", color: "white", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: analyzing ? "wait" : "pointer" }}>
                      {analyzing
                        ? (zoneProgress ? `Analyse… article ${zoneProgress.done}/${zoneProgress.total}` : "Analyse…")
                        : zoneMode ? "Analyser toute la zone" : "Analyser et structurer"}
                    </button>
                  </div>

                  {extracted.length === 0 ? (
                  <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <select style={{ borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none", flex: 1 }}
                      value={newRule.topic ?? "recul_voie"}
                      onChange={e => setNewRule(f => ({ ...f, topic: e.target.value }))}>
                      {Object.entries(TOPIC_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                    </select>
                    <input type="number" placeholder="Art. n°" style={{ width: 80, borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      value={newRule.article_number ?? ""}
                      onChange={e => {
                        const n = e.target.value === "" ? null : Number(e.target.value);
                        const def = n != null ? PLU_ARTICLES[n] : undefined;
                        // Auto-remplit titre + thème depuis la grille R.123-9 (modifiable ensuite).
                        setNewRule(f => ({ ...f, article_number: n, ...(def ? { topic: def.topic, article_title: def.title } : {}) }));
                      }}
                    />
                  </div>
                  <input placeholder="Nom de la sous-règle (optionnel — ex: Toitures, Clôtures sur rue…)" style={{ width: "100%", borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none", marginBottom: 8, boxSizing: "border-box" }}
                    value={newRule.sub_theme ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, sub_theme: e.target.value || null }))}
                  />
                  <textarea placeholder="Texte de la règle…" style={{ width: "100%", minHeight: 72, borderRadius: 8, border: "1px solid #E2E8F0", padding: "8px 10px", fontSize: 13, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                    value={newRule.rule_text ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, rule_text: e.target.value }))}
                  />
                  {/* Valeurs structurées */}
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <input type="number" placeholder="Min" style={{ width: 70, borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      value={newRule.value_min ?? ""}
                      onChange={e => setNewRule(f => ({ ...f, value_min: e.target.value === "" ? null : Number(e.target.value) }))}
                    />
                    <input type="number" placeholder="Max" style={{ width: 70, borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      value={newRule.value_max ?? ""}
                      onChange={e => setNewRule(f => ({ ...f, value_max: e.target.value === "" ? null : Number(e.target.value) }))}
                    />
                    <input type="number" placeholder="Exact" style={{ width: 70, borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      value={newRule.value_exact ?? ""}
                      onChange={e => setNewRule(f => ({ ...f, value_exact: e.target.value === "" ? null : Number(e.target.value) }))}
                    />
                    <select style={{ width: 90, borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none" }}
                      value={newRule.unit ?? ""}
                      onChange={e => setNewRule(f => ({ ...f, unit: e.target.value || null }))}>
                      <option value="">unité</option>
                      <option value="m">m</option>
                      <option value="%">%</option>
                      <option value="m²">m²</option>
                      <option value="places">places</option>
                    </select>
                  </div>
                  <input placeholder="Conditions / sous-secteurs (ex: UBai: 10%)" style={{ marginTop: 6, width: "100%", borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                    value={newRule.conditions ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, conditions: e.target.value || null }))}
                  />
                  <input placeholder="Exceptions / dérogations (ex: sauf sinistre grave ; cf. UA-2)" style={{ marginTop: 6, width: "100%", borderRadius: 8, border: "1px solid #FDE68A", background: "#FFFBEB", padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                    value={newRule.exceptions ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, exceptions: e.target.value || null }))}
                  />
                  <input placeholder="Résumé (10 mots max)" style={{ marginTop: 6, width: "100%", borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                    value={newRule.summary ?? ""}
                    onChange={e => setNewRule(f => ({ ...f, summary: e.target.value }))}
                  />

                  {/* Cas conditionnels (ex: 10 m sens unique / 13 m double sens) */}
                  <div style={{ marginTop: 10, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Cas conditionnels (selon voie, secteur…)</div>
                    {(newRule.cases ?? []).map((c, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                        <input placeholder="Condition (ex: voie à double sens)" style={{ flex: 1, minWidth: 0, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 8px", fontSize: 11.5, outline: "none" }}
                          value={c.condition}
                          onChange={e => setNewRule(f => ({ ...f, cases: (f.cases ?? []).map((x, j) => j === i ? { ...x, condition: e.target.value } : x) }))}
                        />
                        <input type="number" placeholder="val" style={{ width: 56, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 6px", fontSize: 11.5, outline: "none" }}
                          value={c.value ?? ""}
                          onChange={e => setNewRule(f => ({ ...f, cases: (f.cases ?? []).map((x, j) => j === i ? { ...x, value: e.target.value === "" ? null : Number(e.target.value) } : x) }))}
                        />
                        <select style={{ width: 58, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 4px", fontSize: 11.5, outline: "none" }}
                          value={c.unit ?? ""}
                          onChange={e => setNewRule(f => ({ ...f, cases: (f.cases ?? []).map((x, j) => j === i ? { ...x, unit: e.target.value || null } : x) }))}>
                          <option value="">—</option><option value="m">m</option><option value="cm">cm</option><option value="%">%</option><option value="m²">m²</option><option value="places">pl.</option>
                        </select>
                        <select title="Nature du cas" style={{ width: 84, borderRadius: 6, border: "1px solid #E2E8F0", padding: "5px 4px", fontSize: 11, outline: "none" }}
                          value={c.kind ?? "parametre"}
                          onChange={e => setNewRule(f => ({ ...f, cases: (f.cases ?? []).map((x, j) => j === i ? { ...x, kind: e.target.value as "condition" | "parametre" } : x) }))}>
                          <option value="parametre">paramètre</option>
                          <option value="condition">condition</option>
                        </select>
                        <button onClick={() => setNewRule(f => ({ ...f, cases: (f.cases ?? []).filter((_, j) => j !== i) }))}
                          style={{ border: "none", background: "transparent", color: "#EF4444", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>✕</button>
                      </div>
                    ))}
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6 }}>« condition » = alternative (on en applique une) · « paramètre » = valeur de calcul (toutes s'appliquent)</div>
                    <button onClick={() => setNewRule(f => ({ ...f, cases: [...(f.cases ?? []), { condition: "", value: null, unit: f.unit ?? null, kind: "parametre" }] }))}
                      style={{ border: "1px dashed #C7D2FE", background: "white", color: "#4F46E5", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      + Ajouter un cas
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => addRule(selectedZone.id)}
                      style={{ background: "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      Ajouter
                    </button>
                    <button onClick={() => setAddingZoneId(null)}
                      style={{ background: "#F1F5F9", color: "#374151", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
                      Annuler
                    </button>
                  </div>
                  </>
                  ) : (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>{extracted.length} règle(s) détectée(s) — vérifiez puis ajoutez</div>
                    {extracted.map((r, i) => (
                      <div key={i} style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px", marginBottom: 8, background: "white" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#6B7280" }}>
                            {r.article_number ? `Art. ${r.article_number} · ` : ""}{TOPIC_META[r.topic]?.label ?? r.topic}{r.sub_theme ? ` — ${r.sub_theme}` : ""}
                          </span>
                          <button onClick={() => setExtracted(es => es.filter((_, j) => j !== i))} title="Retirer" style={{ border: "none", background: "transparent", color: "#EF4444", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>✕</button>
                        </div>
                        <p style={{ fontSize: 11.5, color: "#374151", margin: "4px 0 0", lineHeight: 1.45 }}>{r.summary || r.rule_text.slice(0, 180)}</p>
                        {r.exceptions && <p style={{ fontSize: 11, color: "#B45309", margin: "4px 0 0", lineHeight: 1.4 }}><strong>Sauf :</strong> {r.exceptions}</p>}
                        {/* Version « citoyen » générée par l'IA — éditable avant enregistrement */}
                        {(r.citizen_title != null || r.citizen_summary != null) && (
                          <div style={{ marginTop: 6, padding: "6px 8px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8 }}>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: "#047857", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                              👤 Version citoyen
                              <label style={{ marginLeft: "auto", fontWeight: 600, color: "#065F46", display: "flex", alignItems: "center", gap: 4, textTransform: "none", letterSpacing: 0 }}>
                                <input type="checkbox" checked={r.citizen_relevant !== false}
                                  onChange={e => setExtracted(es => es.map((x, j) => j === i ? { ...x, citizen_relevant: e.target.checked } : x))} />
                                Visible
                              </label>
                            </div>
                            <input value={r.citizen_title ?? ""} placeholder="Titre court (ex: Hauteur des maisons)"
                              onChange={e => setExtracted(es => es.map((x, j) => j === i ? { ...x, citizen_title: e.target.value || null } : x))}
                              style={{ width: "100%", boxSizing: "border-box", fontSize: 11.5, fontWeight: 600, color: "#065F46", border: "1px solid #A7F3D0", borderRadius: 6, padding: "4px 7px", outline: "none", background: "white", marginBottom: 4 }} />
                            <textarea value={r.citizen_summary ?? ""} placeholder="Une phrase simple, en « vous », avec la valeur clé."
                              onChange={e => setExtracted(es => es.map((x, j) => j === i ? { ...x, citizen_summary: e.target.value || null } : x))}
                              style={{ width: "100%", boxSizing: "border-box", fontSize: 11.5, color: "#065F46", border: "1px solid #A7F3D0", borderRadius: 6, padding: "4px 7px", outline: "none", background: "white", resize: "vertical", minHeight: 34, fontFamily: "inherit" }} />
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                          {r.value_min != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, color: "#374151" }}>≥{r.value_min} {r.unit}</span>}
                          {r.value_max != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, color: "#374151" }}>≤{r.value_max} {r.unit}</span>}
                          {r.value_exact != null && <span style={{ background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, color: "#374151" }}>{r.value_exact} {r.unit}</span>}
                          {r.cases.filter(c => c.value != null).map((c, ci) => { const isCond = c.kind === "condition"; return (
                            <span key={`c${ci}`} style={{ background: isCond ? "#FFF7ED" : "#EEF2FF", color: isCond ? "#C2410C" : "#4338CA", borderRadius: 6, padding: "2px 8px", fontSize: 10.5 }}>{isCond ? "si " : ""}{c.condition} : <strong>{c.value ?? "—"}{c.unit ? ` ${c.unit}` : ""}</strong></span>
                          ); })}
                          {r.applies_if.map((t, ti) => (
                            <span key={`a${ti}`} style={{ background: "#FEF3C7", color: "#92400E", borderRadius: 6, padding: "2px 8px", fontSize: 10.5 }}>⊕ {APPLIES_LABEL[t] ?? t}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button onClick={() => addExtracted(selectedZone.id)} disabled={addingExtracted || extracted.length === 0}
                        style={{ background: addingExtracted ? "#818CF8" : "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: addingExtracted ? "wait" : "pointer" }}>
                        {addingExtracted ? "Ajout…" : `Ajouter ${extracted.length} règle(s)`}
                      </button>
                      <button onClick={() => setExtracted([])}
                        style={{ background: "#F1F5F9", color: "#374151", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
                        Recommencer
                      </button>
                      <button onClick={() => { setExtracted([]); setPasteText(""); setAddingZoneId(null); }}
                        style={{ background: "transparent", color: "#94a3b8", border: "none", padding: "7px 8px", fontSize: 12, cursor: "pointer" }}>
                        Annuler
                      </button>
                    </div>
                  </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
