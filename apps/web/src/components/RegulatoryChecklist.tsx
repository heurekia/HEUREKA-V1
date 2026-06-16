import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

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

interface RegulatoryAnalysis {
  id: string;
  status: "running" | "done" | "failed" | "obsolete";
  engine_version: string;
  ruleset_version: string | null;
  summary: {
    counts_by_status: Record<FindingStatus, number>;
    counts_by_severity: Record<FindingSeverity, number>;
    applicable_rules_count: number;
    excluded_rules_count: number;
    superseded_rule_ids: string[];
    rules_without_evaluator: Array<{ rule_id: string; topic: string }>;
    supported_topics: string[];
    warnings: string[];
    duration_ms: number;
  } | null;
  triggered_by: string | null;
  validated_by: string | null;
  validated_at: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

interface DossierFact {
  id: string;
  key: string;
  value: unknown;
  unit: string | null;
  source: "citizen_declaration" | "document_extraction" | "instructor_entry" | "external_data";
  source_ref: {
    piece_id?: string;
    piece_type?: string;
    nom_piece?: string | null;
    field?: string;
  } | null;
  confidence: number | null;
  validated_by: string | null;
  validated_at: string | null;
  created_at: string;
}

interface LatestResponse {
  analysis: RegulatoryAnalysis;
  findings: RegulatoryFinding[];
  facts: DossierFact[];
}

const FACT_SOURCE_BADGE: Record<DossierFact["source"], { label: string; variant: "default" | "success" | "warning" | "danger" | "info" | "purple" }> = {
  citizen_declaration: { label: "Déclaration citoyen", variant: "warning" },
  document_extraction: { label: "Pièce", variant: "purple" },
  instructor_entry: { label: "Saisie instructeur", variant: "success" },
  external_data: { label: "Donnée externe", variant: "info" },
};

const FACT_LABELS: Record<string, string> = {
  hauteur: "Hauteur",
  emprise: "Emprise au sol",
  surface_terrain: "Surface du terrain",
  surface_plancher_apres: "Surface plancher (projet)",
  recul_voie: "Recul à la voie",
  reculs_limites: "Reculs aux limites",
  stationnement: "Places de stationnement",
  destination_apres: "Destination après projet",
  nb_logements: "Nombre de logements",
  zonage_plu: "Zonage PLU",
  secteur_abf: "Périmètre ABF",
  risques: "Risques",
  servitudes: "Servitudes",
  nature_travaux: "Nature des travaux",
  parcelle_ref: "Référence parcellaire",
  extension: "Extension",
  surelevation: "Surélévation",
  demolition: "Démolition",
  annexe: "Annexe",
  changement_destination: "Changement de destination",
  ravalement: "Modification d'aspect",
};

function factLabel(key: string): string {
  return FACT_LABELS[key] ?? key;
}

function formatFactValue(fact: DossierFact): string {
  const v = fact.value;
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "number") {
    const rounded = Math.round(v * 100) / 100;
    const isInt = Number.isInteger(rounded);
    const num = isInt ? String(rounded) : rounded.toFixed(2).replace(".", ",");
    return fact.unit ? `${num} ${fact.unit === "m2" ? "m²" : fact.unit}` : num;
  }
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function factSourceCaption(fact: DossierFact): string | null {
  const ref = fact.source_ref;
  if (!ref) return null;
  if (ref.nom_piece) return ref.nom_piece;
  if (ref.field) return ref.field;
  return null;
}

// ─── Présentation ─────────────────────────────────────────────────────
const SEVERITY_ORDER: FindingSeverity[] = ["bloquant", "prescription", "alerte", "info"];

const STATUS_BADGE: Record<FindingStatus, { label: string; variant: "default" | "success" | "warning" | "danger" | "info" | "purple" }> = {
  conforme: { label: "Conforme", variant: "success" },
  non_conforme: { label: "Non conforme", variant: "danger" },
  incertain: { label: "Incertain", variant: "warning" },
  non_applicable: { label: "Non applicable", variant: "default" },
};

const SEVERITY_BADGE: Record<FindingSeverity, { label: string; variant: "default" | "success" | "warning" | "danger" | "info" | "purple" }> = {
  bloquant: { label: "Bloquant", variant: "danger" },
  prescription: { label: "Prescription", variant: "purple" },
  alerte: { label: "Alerte", variant: "warning" },
  info: { label: "Info", variant: "info" },
};

function topicLabel(topic: string): string {
  // Étiquettes lisibles pour les topics fréquents. Inconnu → topic brut.
  const dict: Record<string, string> = {
    hauteur: "Hauteur",
    emprise_sol: "Emprise au sol",
    recul_voie: "Recul par rapport à la voie",
    recul_limite: "Recul par rapport aux limites",
    stationnement: "Stationnement",
    aspect: "Aspect extérieur",
    destinations: "Destinations",
    espaces_verts: "Espaces verts",
    general: "Disposition générale",
  };
  return dict[topic] ?? topic;
}

interface Props {
  dossierId: string;
}

export function RegulatoryChecklist({ dossierId }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LatestResponse | null>(null);
  const [running, setRunning] = useState(false);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<LatestResponse | undefined>(
        `/regulatory/dossier/${dossierId}/latest`,
      );
      setData(res ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [dossierId]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

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
          prev
            ? {
                ...prev,
                findings: prev.findings.map((f) =>
                  f.id === finding.id
                    ? {
                        ...f,
                        instructor_decision: decision,
                        instructor_comment: comment ?? null,
                        instructor_decided_at: new Date().toISOString(),
                      }
                    : f,
                ),
              }
            : prev,
        );
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [],
  );

  const findingsBySeverity = useMemo(() => {
    const map = new Map<FindingSeverity, RegulatoryFinding[]>();
    for (const sev of SEVERITY_ORDER) map.set(sev, []);
    for (const f of data?.findings ?? []) {
      const arr = map.get(f.severity) ?? [];
      arr.push(f);
      map.set(f.severity, arr);
    }
    return map;
  }, [data]);

  // Lookup pour résoudre `facts_used: string[]` → DossierFact[].
  const factsByKey = useMemo(() => {
    const map = new Map<string, DossierFact>();
    for (const f of data?.facts ?? []) map.set(f.key, f);
    return map;
  }, [data]);

  if (loading) {
    return (
      <Card>
        <CardContent>Chargement de l'analyse réglementaire…</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-gray-900">Analyse réglementaire</div>
            {data?.analysis ? (
              <div className="text-sm text-gray-500">
                Moteur {data.analysis.engine_version} · lancée le{" "}
                {new Date(data.analysis.created_at).toLocaleString("fr-FR")}
              </div>
            ) : (
              <div className="text-sm text-gray-500">Aucune analyse pour le moment.</div>
            )}
          </div>
          <Button onClick={launchAnalysis} disabled={running}>
            {running ? "Analyse en cours…" : data ? "Relancer l'analyse" : "Lancer l'analyse"}
          </Button>
        </CardHeader>
        {data?.analysis.summary ? (
          <CardContent>
            <Summary summary={data.analysis.summary} />
          </CardContent>
        ) : null}
      </Card>

      {error ? (
        <Card>
          <CardContent className="text-red-700">{error}</CardContent>
        </Card>
      ) : null}

      {data && data.findings.length === 0 ? (
        <Card>
          <CardContent className="text-gray-600">
            Aucun constat produit par cette analyse. Vérifiez les règles candidates et les
            faits déclarés sur le dossier.
          </CardContent>
        </Card>
      ) : null}

      {data
        ? SEVERITY_ORDER.map((sev) => {
            const findings = findingsBySeverity.get(sev) ?? [];
            if (findings.length === 0) return null;
            return (
              <Card key={sev}>
                <CardHeader className="flex items-center justify-between">
                  <div className="text-base font-semibold text-gray-900">
                    {SEVERITY_BADGE[sev].label} · {findings.length} constat
                    {findings.length > 1 ? "s" : ""}
                  </div>
                  <Badge variant={SEVERITY_BADGE[sev].variant}>{SEVERITY_BADGE[sev].label}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {findings.map((f) => (
                    <FindingRow
                      key={f.id}
                      finding={f}
                      factsByKey={factsByKey}
                      onDecision={onDecision}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })
        : null}
    </div>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────

function Summary({ summary }: { summary: NonNullable<RegulatoryAnalysis["summary"]> }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(summary.counts_by_status) as FindingStatus[]).map((s) => (
          <Badge key={s} variant={STATUS_BADGE[s].variant}>
            {STATUS_BADGE[s].label} : {summary.counts_by_status[s]}
          </Badge>
        ))}
      </div>
      <div className="text-gray-600">
        {summary.applicable_rules_count} règle{summary.applicable_rules_count > 1 ? "s" : ""}{" "}
        applicable{summary.applicable_rules_count > 1 ? "s" : ""} · {summary.excluded_rules_count}{" "}
        écartée{summary.excluded_rules_count > 1 ? "s" : ""} · moteur exécuté en{" "}
        {summary.duration_ms} ms.
      </div>
      {summary.rules_without_evaluator.length > 0 ? (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-yellow-900">
          <div className="font-medium">
            {summary.rules_without_evaluator.length} règle
            {summary.rules_without_evaluator.length > 1 ? "s" : ""} non évaluée
            {summary.rules_without_evaluator.length > 1 ? "s" : ""} par le moteur
          </div>
          <div className="text-xs">
            Topics non encore pris en charge :{" "}
            {[...new Set(summary.rules_without_evaluator.map((r) => topicLabel(r.topic)))].join(", ")}.
            À examiner manuellement.
          </div>
        </div>
      ) : null}
      {summary.warnings.length > 0 ? (
        <ul className="list-disc pl-5 text-gray-700">
          {summary.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FindingRow({
  finding,
  factsByKey,
  onDecision,
}: {
  finding: RegulatoryFinding;
  factsByKey: Map<string, DossierFact>;
  onDecision: (f: RegulatoryFinding, d: InstructorDecision, comment?: string) => void;
}) {
  const [factsOpen, setFactsOpen] = useState(false);
  const statusBadge = STATUS_BADGE[finding.status];
  const decided = finding.instructor_decision;
  const resolvedFactsUsed = finding.facts_used
    .map((k) => factsByKey.get(k))
    .filter((f): f is DossierFact => f != null);
  // Faits référencés par la règle mais absents de la base — on les affiche
  // tels quels pour ne pas masquer un trou de mapping.
  const unresolvedFactsUsed = finding.facts_used.filter((k) => !factsByKey.has(k));
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            <span className="text-xs font-medium text-gray-500">{topicLabel(finding.topic)}</span>
            {decided ? (
              <Badge variant="info">
                {decided === "accepted"
                  ? "Accepté par l'instructeur"
                  : decided === "corrected"
                    ? "Corrigé"
                    : "Ignoré"}
              </Badge>
            ) : null}
          </div>
          <div className="text-base font-semibold text-gray-900">{finding.title}</div>
        </div>
      </div>
      {finding.explanation ? (
        <p className="mt-2 text-sm text-gray-700">{finding.explanation}</p>
      ) : null}
      {finding.missing_facts.length > 0 ? (
        <p className="mt-2 text-sm text-gray-600">
          Éléments manquants :{" "}
          {finding.missing_facts.map((k) => factLabel(k)).join(", ")}
        </p>
      ) : null}
      {finding.legal_basis.length > 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          Fondement :{" "}
          {finding.legal_basis
            .map((s) => (s.type === "zone_rule" ? s.article ?? "Règle PLU" : s.ref ?? s.type))
            .join(" · ")}
        </p>
      ) : null}
      {finding.recommended_action ? (
        <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
          <div className="font-medium text-gray-900">{finding.recommended_action.label}</div>
          {finding.recommended_action.reason ? (
            <div className="text-gray-600">{finding.recommended_action.reason}</div>
          ) : null}
        </div>
      ) : null}
      {finding.facts_used.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs font-medium text-heureka-600 hover:underline"
            onClick={() => setFactsOpen((v) => !v)}
          >
            {factsOpen ? "Masquer les faits utilisés" : `Faits utilisés (${finding.facts_used.length})`}
          </button>
          {factsOpen ? (
            <div className="mt-2 space-y-2">
              {resolvedFactsUsed.map((f) => (
                <FactRow key={f.id} fact={f} />
              ))}
              {unresolvedFactsUsed.map((k) => (
                <div key={k} className="rounded-md border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-900">
                  Fait <code className="font-mono">{k}</code> référencé par le verdict mais introuvable dans le dossier (synchronisation manquante ?).
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <DecisionBar finding={finding} onDecision={onDecision} />
    </div>
  );
}

function FactRow({ fact }: { fact: DossierFact }) {
  const badge = FACT_SOURCE_BADGE[fact.source];
  const caption = factSourceCaption(fact);
  return (
    <div className="rounded-md bg-gray-50 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{factLabel(fact.key)}</span>
          <span className="text-gray-700">= {formatFactValue(fact)}</span>
        </div>
        <div className="flex items-center gap-2">
          {fact.validated_at ? (
            <Badge variant="success" className="text-[10px]">Validé instructeur</Badge>
          ) : null}
          <Badge variant={badge.variant} className="text-[10px]">{badge.label}</Badge>
          {fact.confidence != null ? (
            <span className="text-gray-500">{Math.round(fact.confidence * 100)} %</span>
          ) : null}
        </div>
      </div>
      {caption ? <div className="mt-1 text-gray-500">Source : {caption}</div> : null}
    </div>
  );
}

function DecisionBar({
  finding,
  onDecision,
}: {
  finding: RegulatoryFinding;
  onDecision: (f: RegulatoryFinding, d: InstructorDecision, comment?: string) => void;
}) {
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState(finding.instructor_comment ?? "");
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={finding.instructor_decision === "accepted" ? "default" : "outline"}
          onClick={() => onDecision(finding, "accepted")}
        >
          Accepter
        </Button>
        <Button
          size="sm"
          variant={finding.instructor_decision === "corrected" ? "default" : "outline"}
          onClick={() => setCommentOpen((v) => !v)}
        >
          Corriger
        </Button>
        <Button
          size="sm"
          variant={finding.instructor_decision === "ignored" ? "default" : "outline"}
          onClick={() => onDecision(finding, "ignored")}
        >
          Ignorer
        </Button>
      </div>
      {commentOpen ? (
        <div className="space-y-2">
          <textarea
            className="w-full rounded-md border border-gray-300 p-2 text-sm"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Expliquez la correction (visible dans l'audit)"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onDecision(finding, "corrected", comment);
                setCommentOpen(false);
              }}
              disabled={comment.trim().length === 0}
            >
              Enregistrer la correction
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCommentOpen(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
