import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

// ─── Types alignés sur l'API régulatoire ────────────────────────────
type FindingStatus = "conforme" | "non_conforme" | "incertain" | "non_applicable";
type FindingSeverity = "bloquant" | "prescription" | "alerte" | "info";
type InstructorDecision = "accepted" | "corrected" | "ignored";

interface SourceRef {
  type: "legal_article" | "zone_rule" | "document_segment" | "annotation";
  rule_id?: string;
  article?: string;
  code?: string;
  ref?: string;
  segment_id?: string;
  doc_type?: string;
  page?: number;
  quote?: string;
}

interface RecommendedAction {
  action_type: string;
  label: string;
  reason?: string;
  priority?: "haute" | "moyenne" | "basse";
  legal_basis?: SourceRef[];
}

interface RegulatoryFinding {
  id: string;
  analysis_id: string;
  dossier_id: string;
  topic: string;
  status: FindingStatus;
  severity: FindingSeverity;
  title: string;
  explanation: string | null;
  legal_basis: SourceRef[];
  source_refs: SourceRef[];
  facts_used: string[];
  missing_facts: string[];
  recommended_action: RecommendedAction | null;
  citizen_summary: string | null;
  rule_id: string | null;
  instructor_decision: InstructorDecision | null;
  instructor_comment: string | null;
  instructor_decided_at: string | null;
}

interface AnalysisSummary {
  counts_by_status: Record<FindingStatus, number>;
  counts_by_severity: Record<FindingSeverity, number>;
  applicable_rules_count: number;
  excluded_rules_count: number;
  superseded_rule_ids: string[];
  rules_without_evaluator: Array<{ rule_id: string; topic: string }>;
  supported_topics: string[];
  warnings: string[];
  duration_ms: number;
}

interface RegulatoryAnalysis {
  id: string;
  status: "running" | "done" | "failed" | "obsolete";
  engine_version: string;
  ruleset_version: string | null;
  summary: AnalysisSummary | null;
  created_at: string;
}

interface DossierFact {
  id: string;
  key: string;
  value: unknown;
  unit: string | null;
  source: "citizen_declaration" | "document_extraction" | "instructor_entry" | "external_data";
  source_ref: { piece_id?: string; nom_piece?: string | null; field?: string } | null;
  confidence: number | null;
  validated_at: string | null;
}

interface LatestResponse {
  analysis: RegulatoryAnalysis;
  findings: RegulatoryFinding[];
  facts: DossierFact[];
}

interface RuleDetail {
  rule_id: string;
  article_number: number | null;
  article_title: string | null;
  rule_text: string;
  exceptions: string | null;
  instructor_note: string | null;
  zone_code: string;
  commune_name: string;
}

// ─── Vocabulaire : le moteur CONSTATE, il ne juge pas ────────────────
// Choix structurant validé avec le métier : aucun verdict ferme. Le moteur
// signale des écarts ou une absence d'écart ; seul l'instructeur qualifie.

type Section = "bloquant" | "prescription" | "verifier" | "conforme" | "non_applicable";

function sectionOf(f: RegulatoryFinding): Section {
  if (f.severity === "bloquant") return "bloquant";
  if (f.severity === "prescription") return "prescription";
  if (f.status === "conforme") return "conforme";
  if (f.status === "non_applicable") return "non_applicable";
  return "verifier"; // incertain, alerte, info
}

const SECTION_META: Record<Section, { title: string; dot: string; collapsedByDefault: boolean }> = {
  bloquant:        { title: "Écarts bloquants",                dot: "#DC2626", collapsedByDefault: false },
  prescription:    { title: "À régulariser par prescription",  dot: "#9333EA", collapsedByDefault: false },
  verifier:        { title: "À vérifier",                       dot: "#D97706", collapsedByDefault: false },
  conforme:        { title: "Sans écart détecté",              dot: "#16A34A", collapsedByDefault: true },
  non_applicable:  { title: "Écartées par le moteur",          dot: "#94A3B8", collapsedByDefault: true },
};
const SECTION_ORDER: Section[] = ["bloquant", "prescription", "verifier", "conforme", "non_applicable"];

// Étiquette du constat affichée sur chaque finding (le "tag" coloré).
function constatTag(f: RegulatoryFinding): { label: string; cls: string } {
  const s = sectionOf(f);
  switch (s) {
    case "bloquant":       return { label: "Écart détecté",        cls: "bg-red-50 text-red-700" };
    case "prescription":   return { label: "Écart régularisable",  cls: "bg-purple-50 text-purple-700" };
    case "verifier":       return { label: "Vérification requise", cls: "bg-amber-50 text-amber-800" };
    case "conforme":       return { label: "Sans écart détecté",   cls: "bg-green-50 text-green-700" };
    case "non_applicable": return { label: "Écartée par le moteur", cls: "bg-gray-100 text-gray-600" };
  }
}

const TOPIC_LABELS: Record<string, string> = {
  hauteur: "Hauteur", emprise_sol: "Emprise au sol", recul_voie: "Recul à la voie",
  recul_limite: "Recul aux limites", stationnement: "Stationnement", aspect: "Aspect extérieur",
  destinations: "Destinations", espaces_verts: "Espaces verts", general: "Disposition générale",
};
const topicLabel = (t: string) => TOPIC_LABELS[t] ?? t;

const FACT_LABELS: Record<string, string> = {
  hauteur: "Hauteur", emprise: "Emprise au sol", surface_terrain: "Surface du terrain",
  surface_plancher_apres: "Surface plancher", recul_voie: "Recul à la voie", reculs_limites: "Reculs aux limites",
  stationnement: "Places de stationnement", destination_apres: "Destination", zonage_plu: "Zonage PLU",
  secteur_abf: "Périmètre ABF", risques: "Risques", servitudes: "Servitudes", nature_travaux: "Nature des travaux",
};
const factLabel = (k: string) => FACT_LABELS[k] ?? k;

// ─── Composant principal ─────────────────────────────────────────────
interface Props {
  dossierId: string;
  /** Handler appelé quand l'instructeur clique sur un fondement de type
   *  « document_segment » pour ouvrir le passage cité dans le viewer
   *  (onglet Instruction · mode Comparer). Conservé depuis la refonte
   *  layout de main. Si non fourni, les fondements restent en texte simple. */
  onJumpToCitation?: (ref: SourceRef) => void;
}

export function RegulatoryChecklist({ dossierId, onJumpToCitation }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LatestResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<Section, boolean>>({
    bloquant: false, prescription: false, verifier: false, conforme: true, non_applicable: true,
  });

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<LatestResponse | undefined>(`/regulatory/dossier/${dossierId}/latest`);
      setData(res ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [dossierId]);

  useEffect(() => { void loadLatest(); }, [loadLatest]);

  const launchAnalysis = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      await api.post(`/regulatory/analyze/${dossierId}`, {}, { timeoutMs: 180_000 });
      await loadLatest();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }, [dossierId, loadLatest]);

  const onDecision = useCallback(
    async (finding: RegulatoryFinding, decision: InstructorDecision, comment?: string) => {
      try {
        await api.post(`/regulatory/findings/${finding.id}/decision`, { decision, comment });
        setData((prev) =>
          prev ? {
            ...prev,
            findings: prev.findings.map((f) =>
              f.id === finding.id
                ? { ...f, instructor_decision: decision, instructor_comment: comment ?? null, instructor_decided_at: new Date().toISOString() }
                : f,
            ),
          } : prev,
        );
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [],
  );

  const factsByKey = useMemo(() => {
    const m = new Map<string, DossierFact>();
    for (const f of data?.facts ?? []) m.set(f.key, f);
    return m;
  }, [data]);

  const bySection = useMemo(() => {
    const m = new Map<Section, RegulatoryFinding[]>();
    for (const s of SECTION_ORDER) m.set(s, []);
    for (const f of data?.findings ?? []) m.get(sectionOf(f))!.push(f);
    return m;
  }, [data]);

  const validationProgress = useMemo(() => {
    const findings = data?.findings ?? [];
    const decided = findings.filter((f) => f.instructor_decision != null).length;
    return { decided, total: findings.length };
  }, [data]);

  if (loading) {
    return <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Chargement de l'analyse réglementaire…</div>;
  }

  return (
    <div className="space-y-4">
      {/* En-tête + bandeau juridique + progression */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <div className="text-base font-semibold text-gray-900">Analyse réglementaire</div>
            {data?.analysis ? (
              <div className="text-xs text-gray-500">
                Moteur {data.analysis.engine_version} · lancée le {new Date(data.analysis.created_at).toLocaleString("fr-FR")}
              </div>
            ) : (
              <div className="text-xs text-gray-500">Aucune analyse pour le moment.</div>
            )}
          </div>
          <button
            onClick={launchAnalysis}
            disabled={running}
            className="rounded-lg border border-indigo-200 bg-white px-4 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
          >
            {running ? "Analyse en cours…" : data ? "↻ Relancer l'analyse" : "Lancer l'analyse"}
          </button>
        </div>

        {data?.analysis.summary ? (
          <div className="px-5 py-4">
            {/* Bandeau : rien n'est ferme tant que l'instructeur n'a pas validé */}
            <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
              <span>⚖️</span>
              <div>
                Les constats ci-dessous sont <strong>proposés par le moteur</strong> à partir des pièces du dossier.
                Aucun n'a valeur de décision : <strong>chaque constat doit être validé, corrigé ou écarté par vous</strong> avant
                de pouvoir fonder une décision.
              </div>
            </div>

            {/* Progression de validation */}
            <div className="mb-1 flex justify-between text-xs text-gray-500">
              <span>Validation des constats par l'instructeur</span>
              <span className="font-semibold text-gray-800">{validationProgress.decided} / {validationProgress.total} qualifiés</span>
            </div>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-600 to-green-400"
                style={{ width: `${validationProgress.total ? Math.round((validationProgress.decided / validationProgress.total) * 100) : 0}%` }}
              />
            </div>

            {/* Synthèse des constats */}
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Ce que le moteur a relevé (à valider)</div>
            <SynthBar summary={data.analysis.summary} bySection={bySection} />

            {data.analysis.summary.warnings.length > 0 ? (
              <ul className="mt-3 list-disc pl-5 text-xs text-gray-600">
                {data.analysis.summary.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</div> : null}

      {data && data.findings.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600">
          Aucun constat produit. Vérifiez les règles validées de la commune et les faits déclarés sur le dossier.
        </div>
      ) : null}

      {/* Sections par sévérité */}
      {data
        ? SECTION_ORDER.map((section) => {
            const findings = bySection.get(section) ?? [];
            if (findings.length === 0) return null;
            const meta = SECTION_META[section];
            const isCollapsed = collapsed[section];
            return (
              <div key={section}>
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [section]: !c[section] }))}
                  className={`flex w-full items-center justify-between border border-gray-200 bg-white px-4 py-3 ${isCollapsed ? "rounded-xl" : "rounded-t-xl border-b-0"}`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.dot }} />
                    <span className="text-[13px] font-bold uppercase tracking-wide text-gray-800">{meta.title}</span>
                  </span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-bold text-gray-600">{findings.length}</span>
                </button>
                {!isCollapsed ? (
                  <div className="overflow-hidden rounded-b-xl border border-t-0 border-gray-200 bg-white">
                    {findings.map((f) => (
                      <FindingCard
                        key={f.id}
                        finding={f}
                        factsByKey={factsByKey}
                        onDecision={onDecision}
                        onJumpToCitation={onJumpToCitation}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        : null}

      {/* Règles non évaluées par le moteur — transparence */}
      {data?.analysis.summary && data.analysis.summary.rules_without_evaluator.length > 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600">
          <span className="font-semibold text-gray-700">
            {data.analysis.summary.rules_without_evaluator.length} règle(s) non évaluée(s) par le moteur
          </span>{" "}
          — topics à instruire manuellement :{" "}
          {[...new Set(data.analysis.summary.rules_without_evaluator.map((r) => topicLabel(r.topic)))].join(", ")}.
        </div>
      ) : null}
    </div>
  );
}

// ─── Synthèse en pastilles ───────────────────────────────────────────
function SynthBar({ summary, bySection }: { summary: AnalysisSummary; bySection: Map<Section, RegulatoryFinding[]> }) {
  const count = (s: Section) => bySection.get(s)?.length ?? 0;
  const pills: Array<{ n: number; label: string; cls: string; dot: string }> = [
    { n: count("bloquant"),       label: "écart(s) bloquant(s)",      cls: "bg-red-50 text-red-700",       dot: "#DC2626" },
    { n: count("prescription"),   label: "à régulariser",             cls: "bg-purple-50 text-purple-700", dot: "#9333EA" },
    { n: count("verifier"),       label: "à vérifier",                cls: "bg-amber-50 text-amber-800",   dot: "#D97706" },
    { n: count("conforme"),       label: "sans écart détecté",        cls: "bg-green-50 text-green-700",   dot: "#16A34A" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {pills.filter((p) => p.n > 0).map((p, i) => (
        <span key={i} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${p.cls}`}>
          <span className="h-2 w-2 rounded-full" style={{ background: p.dot }} />
          {p.n} {p.label}
        </span>
      ))}
    </div>
  );
}

// ─── Carte d'un constat (proposé / qualifié) ─────────────────────────
function FindingCard({
  finding,
  factsByKey,
  onDecision,
  onJumpToCitation,
}: {
  finding: RegulatoryFinding;
  factsByKey: Map<string, DossierFact>;
  onDecision: (f: RegulatoryFinding, d: InstructorDecision, comment?: string) => void;
  onJumpToCitation?: (ref: SourceRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState<RuleDetail | null>(null);
  const [ruleLoading, setRuleLoading] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [comment, setComment] = useState(finding.instructor_comment ?? "");

  const tag = constatTag(finding);
  const decided = finding.instructor_decision;
  const isQualified = decided != null;

  const toggle = useCallback(() => {
    setOpen((v) => !v);
    if (!rule && !ruleLoading && finding.rule_id) {
      setRuleLoading(true);
      api.get<{ rule: RuleDetail }>(`/regulatory/rules/${finding.rule_id}`)
        .then((r) => setRule(r.rule))
        .catch(() => { /* silencieux : le détail d'article est un bonus */ })
        .finally(() => setRuleLoading(false));
    }
  }, [rule, ruleLoading, finding.rule_id]);

  const usedFacts = finding.facts_used.map((k) => factsByKey.get(k)).filter((f): f is DossierFact => f != null);

  const reviewLabel = decided === "accepted" ? "✓ Validé par vous"
    : decided === "corrected" ? "✎ Corrigé par vous"
    : decided === "ignored" ? "⊘ Écarté par vous"
    : "À valider";

  return (
    <div
      className={`border-t border-gray-100 first:border-t-0 ${isQualified ? "border-l-[3px] border-l-green-500" : "border-l-[3px] border-l-dashed border-l-gray-200"}`}
      style={decided === "ignored" ? { opacity: 0.6 } : undefined}
    >
      <button onClick={toggle} className="grid w-full grid-cols-[1fr_auto] items-start gap-3 px-[18px] py-3 text-left hover:bg-gray-50">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${tag.cls}`}>{tag.label}</span>
            <span className={`rounded px-2 py-0.5 text-[10.5px] font-bold ${isQualified ? "bg-green-50 text-green-700" : "border border-dashed border-orange-300 bg-orange-50 text-orange-700"}`}>
              {reviewLabel}
            </span>
            <span className="text-[11px] text-gray-500">{topicLabel(finding.topic)}</span>
          </div>
          <div className="text-[13.5px] font-semibold leading-snug text-gray-900">{finding.title}</div>
          {usedFacts.length > 0 ? (
            <div className="mt-1 text-[11.5px] text-gray-500">
              Fait utilisé :{" "}
              {usedFacts.map((f) => (
                <span key={f.id} className="mr-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                  {factLabel(f.key)} = {formatFactValue(f)}
                </span>
              ))}
            </div>
          ) : null}
          {finding.missing_facts.length > 0 ? (
            <div className="mt-1 text-[11.5px] text-gray-500">Manque : {finding.missing_facts.map(factLabel).join(", ")}</div>
          ) : null}
        </div>
        <span className="rounded bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-600">
          {finding.legal_basis.find((s) => s.type === "zone_rule")?.article ?? topicLabel(finding.topic)}
        </span>
      </button>

      {open ? (
        <div className="px-[18px] pb-3.5 pl-12">
          {finding.explanation ? <p className="text-[12px] leading-relaxed text-gray-600">{finding.explanation}</p> : null}

          {/* Fondements : les passages de document indexé sont cliquables et
              ouvrent le viewer (onglet Instruction · Comparer). Conservé depuis
              la refonte layout de main. */}
          {finding.legal_basis.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[11.5px] text-gray-500">
              <span>Fondement :</span>
              {finding.legal_basis.map((s, i) => {
                const label = s.type === "zone_rule"
                  ? (s.article ?? "Règle PLU")
                  : s.type === "document_segment"
                    ? `${s.doc_type ?? "Doc"}${s.page != null ? ` p.${s.page}` : ""}`
                    : (s.ref ?? s.type);
                const clickable = onJumpToCitation && s.type === "document_segment" && !!s.doc_type;
                return (
                  <span key={i} className="inline-flex items-center gap-1">
                    {i > 0 ? <span className="text-gray-300">·</span> : null}
                    {clickable ? (
                      <button
                        type="button"
                        onClick={() => onJumpToCitation!(s)}
                        title={s.quote ? `« ${s.quote.slice(0, 140)}${s.quote.length > 140 ? "…" : ""} »` : "Ouvrir le passage cité"}
                        className="inline-flex items-center gap-0.5 rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 hover:bg-indigo-100"
                      >
                        📖 {label}
                      </button>
                    ) : (
                      <span>{label}</span>
                    )}
                  </span>
                );
              })}
            </div>
          ) : null}

          {ruleLoading ? <p className="mt-2 text-[11px] italic text-gray-400">Chargement de l'article…</p> : null}
          {rule ? (
            <div className="mt-2.5 rounded-lg border border-gray-200 bg-[#FAFAFC] px-3 py-2.5 text-[12px] leading-relaxed text-gray-600">
              <div className="mb-1 text-[11.5px] font-bold text-gray-900">
                {rule.article_number != null ? `Article ${rule.article_number}` : "PLU"}
                {rule.article_title ? ` — ${rule.article_title}` : ""}
                <span className="ml-1.5 font-medium text-gray-500">· Zone {rule.zone_code} · {rule.commune_name}</span>
              </div>
              <div className="whitespace-pre-wrap text-gray-700">{rule.rule_text}</div>
              {rule.exceptions ? <div className="mt-1.5 text-[11px] text-orange-800"><strong>Exceptions :</strong> {rule.exceptions}</div> : null}
            </div>
          ) : null}

          {/* Qualification instructeur */}
          {isQualified && !correcting ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-gray-600">
              <span className="font-semibold text-green-700">{reviewLabel}</span>
              {finding.instructor_decided_at ? <span>le {new Date(finding.instructor_decided_at).toLocaleString("fr-FR")}</span> : null}
              {finding.instructor_comment ? <span className="italic">— « {finding.instructor_comment} »</span> : null}
              <button onClick={() => { setCorrecting(true); }} className="ml-1 text-indigo-600 underline">revoir</button>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-indigo-200">
              <div className="bg-indigo-50 px-3 py-2 text-[11.5px] font-bold text-indigo-700">Votre qualification</div>
              <div className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => onDecision(finding, "accepted")} className="rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100">✓ Valider le constat</button>
                  <button onClick={() => setCorrecting((v) => !v)} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100">✎ Corriger</button>
                  <button onClick={() => onDecision(finding, "ignored", comment.trim() || undefined)} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50">⊘ Écarter</button>
                </div>
                {correcting ? (
                  <div className="mt-2.5 space-y-2">
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                      placeholder="Expliquez la correction — ex. « la cote de 10,2 m inclut la souche de cheminée ; hauteur réelle au faîtage 8,9 m »"
                      className="w-full rounded-md border border-gray-300 p-2 text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { onDecision(finding, "corrected", comment.trim()); setCorrecting(false); }}
                        disabled={comment.trim().length === 0}
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Enregistrer la correction
                      </button>
                      <button onClick={() => setCorrecting(false)} className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500">Annuler</button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatFactValue(fact: DossierFact): string {
  const v = fact.value;
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "number") {
    const r = Math.round(v * 100) / 100;
    const num = Number.isInteger(r) ? String(r) : r.toFixed(2).replace(".", ",");
    return fact.unit ? `${num} ${fact.unit === "m2" ? "m²" : fact.unit}` : num;
  }
  return String(v);
}
