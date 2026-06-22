import { STATUS_LABEL } from "./shared";

// Composants de présentation partagés du module mairie, extraits de
// MairieApp.tsx (comportement inchangé).

export function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const styles: Record<string, { bg: string; color: string; dot: string }> = {
    "En instruction": { bg: "#EFF6FF", color: "#1D4ED8", dot: "#3B82F6" },
    "Nouveau": { bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
    "Pré-instruction": { bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
    "Incomplet": { bg: "#FFF7ED", color: "#C2410C", dot: "#F97316" },
    "Décision en cours": { bg: "#FAF5FF", color: "#7E22CE", dot: "#9333EA" },
    "Accepté": { bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
    "Refusé": { bg: "#FEF2F2", color: "#B91C1C", dot: "#EF4444" },
    "Brouillon": { bg: "#F8FAFC", color: "#475569", dot: "#94A3B8" },
    "Accord prescriptions": { bg: "#EFF6FF", color: "#1D4ED8", dot: "#3B82F6" },
    "Actif": { bg: "#F0FDF4", color: "#15803D", dot: "#22C55E" },
    "En attente": { bg: "#FFF7ED", color: "#C2410C", dot: "#F97316" },
    "Désactivé": { bg: "#FEF2F2", color: "#B91C1C", dot: "#EF4444" },
  };
  const s = styles[label] ?? { bg: "#F1F5F9", color: "#475569", dot: "#94A3B8" };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
      {label}
    </span>
  );
}
