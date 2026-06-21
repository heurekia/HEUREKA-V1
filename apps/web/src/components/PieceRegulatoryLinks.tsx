import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

// Lit l'analyse régulatoire courante du dossier, croise les facts actifs
// avec leur source (source_ref.piece_id), et affiche pour UNE pièce les
// règles PLU qu'elle aide à évaluer + le verdict du moteur sur chacune.
//
// Design : un ligne dense par règle (lisible d'un coup d'œil), click
// pour déplier le détail de la règle (article complet, exceptions,
// résumé citoyen), et un bouton "Reporter dans l'annotation" qui injecte
// un bullet structuré dans le textarea d'annotation de la pièce — la
// primitive d'annotation existe déjà côté DossierDetailScreen, on
// branche dessus via un callback.

type FindingStatus = "conforme" | "non_conforme" | "incertain" | "non_applicable";
type FindingSeverity = "bloquant" | "prescription" | "alerte" | "info";

interface RegulatoryFinding {
  id: string;
  topic: string;
  status: FindingStatus;
  severity: FindingSeverity;
  title: string;
  explanation: string | null;
  facts_used: string[];
  rule_id: string | null;
}

interface DossierFact {
  id: string;
  key: string;
  source_ref: { piece_id?: string } | null;
}

interface LatestResponse {
  findings: RegulatoryFinding[];
  facts: DossierFact[];
}

interface RuleDetail {
  rule_id: string;
  article_number: number | null;
  article_title: string | null;
  topic: string;
  sub_theme: string | null;
  rule_text: string;
  summary: string | null;
  conditions: string | null;
  exceptions: string | null;
  value_min: number | null;
  value_max: number | null;
  value_exact: number | null;
  unit: string | null;
  applies_if: string[];
  citizen_title: string | null;
  citizen_summary: string | null;
  instructor_note: string | null;
  zone_code: string;
  zone_label: string | null;
  commune_name: string;
  commune_insee: string;
}

const STATUS_TOKEN: Record<FindingStatus, { dot: string; color: string; label: string }> = {
  conforme:       { dot: "#16A34A", color: "#15803D", label: "Conforme" },
  non_conforme:   { dot: "#DC2626", color: "#DC2626", label: "Non conforme" },
  incertain:      { dot: "#D97706", color: "#92400E", label: "Incertain" },
  non_applicable: { dot: "#94A3B8", color: "#64748B", label: "Non applicable" },
};

const TOPIC_LABELS: Record<string, string> = {
  hauteur: "Hauteur",
  emprise_sol: "Emprise au sol",
  recul_voie: "Recul à la voie",
  recul_limite: "Recul aux limites",
  stationnement: "Stationnement",
  aspect: "Aspect extérieur",
  destinations: "Destinations",
  espaces_verts: "Espaces verts",
};
function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic;
}

interface Props {
  dossierId: string;
  pieceId: string;
  /** Injecte un bloc texte à la fin de l'annotation libre de la pièce. */
  onAppendToNote?: (text: string) => void;
}

export function PieceRegulatoryLinks({ dossierId, pieceId, onAppendToNote }: Props) {
  const [data, setData] = useState<LatestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
    void load();
  }, [load]);

  const linkedFindings = useMemo(() => {
    if (!data) return [];
    const keysFromThisPiece = new Set(
      data.facts.filter((f) => f.source_ref?.piece_id === pieceId).map((f) => f.key),
    );
    if (keysFromThisPiece.size === 0) return [];
    return data.findings.filter((f) => f.facts_used.some((k) => keysFromThisPiece.has(k)));
  }, [data, pieceId]);

  if (loading) {
    return <Hint>Chargement des règles concernées…</Hint>;
  }
  if (error) {
    return <Hint tone="danger">Règles indisponibles : {error}</Hint>;
  }
  if (!data) {
    return <Hint>Pas d'analyse — lancez-la dans l'onglet Instruction pour relier cette pièce aux règles.</Hint>;
  }
  if (linkedFindings.length === 0) {
    return <Hint>Aucune règle PLU n'est encore reliée à cette pièce.</Hint>;
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>
        Règles PLU alimentées par cette pièce
        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: "#94a3b8" }}>
          ({linkedFindings.length})
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {linkedFindings.map((f) => (
          <FindingLine key={f.id} finding={f} onAppendToNote={onAppendToNote} />
        ))}
      </div>
    </div>
  );
}

function FindingLine({
  finding,
  onAppendToNote,
}: {
  finding: RegulatoryFinding;
  onAppendToNote?: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rule, setRule] = useState<RuleDetail | null>(null);
  const [ruleLoading, setRuleLoading] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const token = STATUS_TOKEN[finding.status];

  const toggle = useCallback(() => {
    setExpanded((v) => !v);
    if (!rule && !ruleLoading && finding.rule_id) {
      setRuleLoading(true);
      api.get<{ rule: RuleDetail }>(`/regulatory/rules/${finding.rule_id}`)
        .then((r) => setRule(r.rule))
        .catch((e) => setRuleError((e as Error).message))
        .finally(() => setRuleLoading(false));
    }
  }, [rule, ruleLoading, finding.rule_id]);

  const reportToNote = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onAppendToNote) return;
    const article = rule?.article_number != null ? `Art. ${rule.article_number} zone ${rule.zone_code}` : topicLabel(finding.topic);
    const line = `• ${article} — ${token.label.toLowerCase()} : ${finding.title}`;
    onAppendToNote(line);
  }, [onAppendToNote, rule, finding, token]);

  return (
    <div style={{ borderTop: "1px solid #F1F5F9" }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "8px 0",
          textAlign: "left" as const,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: token.dot, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: token.color, textTransform: "uppercase", letterSpacing: "0.04em", width: 95, flexShrink: 0 }}>
          {token.label}
        </span>
        <span style={{ fontSize: 11.5, color: "#64748b", width: 110, flexShrink: 0 }}>
          {topicLabel(finding.topic)}
        </span>
        <span style={{ fontSize: 12, color: "#1f2937", flex: 1, lineHeight: 1.4 }}>
          {finding.title}
        </span>
        <span aria-hidden style={{ fontSize: 11, color: "#94a3b8", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
          ›
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "4px 0 12px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          {finding.explanation && (
            <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.5 }}>{finding.explanation}</div>
          )}
          {ruleLoading && <Hint>Chargement de l'article…</Hint>}
          {ruleError && <Hint tone="danger">Article indisponible : {ruleError}</Hint>}
          {rule && (
            <div style={{ fontSize: 11.5, color: "#374151", lineHeight: 1.55, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, padding: "9px 11px" }}>
              <div style={{ fontWeight: 700, color: "#1f2937", marginBottom: 4 }}>
                {rule.article_number != null ? `Article ${rule.article_number}` : "PLU"}
                {rule.article_title ? ` — ${rule.article_title}` : ""}
                <span style={{ marginLeft: 6, fontWeight: 500, color: "#64748b" }}>· Zone {rule.zone_code} · {rule.commune_name}</span>
              </div>
              <div style={{ whiteSpace: "pre-wrap" as const, color: "#334155" }}>{rule.rule_text}</div>
              {rule.exceptions && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#7c2d12" }}>
                  <strong>Exceptions :</strong> {rule.exceptions}
                </div>
              )}
              {rule.instructor_note && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#4338CA", fontStyle: "italic" }}>
                  Note instructeur : {rule.instructor_note}
                </div>
              )}
            </div>
          )}
          {onAppendToNote && (
            <div>
              <button
                type="button"
                onClick={reportToNote}
                style={{
                  border: "1px solid #C7D2FE",
                  background: "white",
                  color: "#4F46E5",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ✎ Reporter dans l'annotation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Hint({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "danger" }) {
  const color = tone === "danger" ? "#DC2626" : "#94a3b8";
  return (
    <div style={{ marginTop: 10, fontSize: 11, color, lineHeight: 1.5 }}>{children}</div>
  );
}
