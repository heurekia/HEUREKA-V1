import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

// Lit l'analyse régulatoire courante du dossier, croise les facts actifs
// avec leur source (source_ref.piece_id), et affiche pour UNE pièce les
// règles PLU qu'elle aide a évaluer + le verdict du moteur sur chacune.
//
// Pourquoi ce composant existe : l'instructeur qui examine un PDF veut
// savoir "quelles règles cette pièce alimente, et le projet y répond-il
// ?". Sans cette vue, il devrait basculer entre l'onglet Documents et
// l'onglet Conformité IA en se rappelant mentalement quel plan
// référence quelle règle.

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
  missing_facts: string[];
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

const STATUS_COLORS: Record<FindingStatus, { bg: string; border: string; color: string; label: string; icon: string }> = {
  conforme:       { bg: "#F0FDF4", border: "#BBF7D0", color: "#15803D", label: "Conforme",       icon: "✓" },
  non_conforme:   { bg: "#FEE2E2", border: "#FECACA", color: "#DC2626", label: "Non conforme",   icon: "✗" },
  incertain:      { bg: "#FEF3C7", border: "#FDE68A", color: "#92400E", label: "Incertain",      icon: "?" },
  non_applicable: { bg: "#F1F5F9", border: "#E2E8F0", color: "#64748B", label: "Non applicable", icon: "—" },
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
}

export function PieceRegulatoryLinks({ dossierId, pieceId }: Props) {
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

  // Pour la pièce courante, trouver les findings qui consomment au moins
  // un fait extrait de cette pièce.
  const linkedFindings = useMemo(() => {
    if (!data) return [];
    const keysFromThisPiece = new Set(
      data.facts.filter((f) => f.source_ref?.piece_id === pieceId).map((f) => f.key),
    );
    if (keysFromThisPiece.size === 0) return [];
    return data.findings.filter((f) => f.facts_used.some((k) => keysFromThisPiece.has(k)));
  }, [data, pieceId]);

  if (loading) {
    return (
      <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
        Chargement des règles concernées…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ marginTop: 10, fontSize: 11, color: "#DC2626" }}>
        Impossible de charger les règles : {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
        Pas d'analyse réglementaire — lancez-la depuis l'onglet "Conformité IA" pour voir les règles
        que cette pièce alimente.
      </div>
    );
  }

  if (linkedFindings.length === 0) {
    return (
      <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
        Aucune règle PLU n'est encore connectée à cette pièce. Re-lancez l'extraction puis l'analyse
        si la pièce porte des cotes (hauteur, emprise, recul…).
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>
          Règles PLU alimentées par cette pièce
        </div>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{linkedFindings.length} règle{linkedFindings.length > 1 ? "s" : ""}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {linkedFindings.map((f) => (
          <FindingMiniRow key={f.id} finding={f} />
        ))}
      </div>
    </div>
  );
}

function FindingMiniRow({ finding }: { finding: RegulatoryFinding }) {
  const s = STATUS_COLORS[finding.status];
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", background: s.bg, border: `1px solid ${s.border}`, borderRadius: 7 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: s.color, lineHeight: 1.2, minWidth: 14 }}>{s.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</span>
          <span style={{ fontSize: 10.5, color: "#64748b" }}>· {topicLabel(finding.topic)}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#1f2937", lineHeight: 1.35 }}>{finding.title}</div>
        {finding.explanation ? (
          <div style={{ fontSize: 11, color: "#475569", marginTop: 3, lineHeight: 1.4 }}>{finding.explanation}</div>
        ) : null}
      </div>
    </div>
  );
}
