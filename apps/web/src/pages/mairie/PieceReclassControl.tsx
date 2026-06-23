import { useState, type CSSProperties } from "react";
import { api } from "../../lib/api";

// Recatégorisation manuelle d'une pièce par l'instructeur (correction d'une
// erreur de classement, qu'elle provienne d'un éclatement automatique ou d'un
// dépôt individuel). Met à jour l'emplacement (code_piece) et, en option, le
// type ; le backend trace l'action dans la chronologie d'instruction.

type PieceLite = { id: string; code_piece: string | null; nom: string };

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Type : auto (d'après le code)" },
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

const inputSt: CSSProperties = {
  border: "1.5px solid #E2E8F0", borderRadius: 7, padding: "6px 9px",
  fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};
const linkBtn: CSSProperties = {
  border: "none", background: "none", cursor: "pointer", color: "#4F46E5",
  fontSize: 11.5, fontWeight: 600, padding: 0,
};

export default function PieceReclassControl({
  dossierId,
  piece,
  onUpdated,
}: {
  dossierId: string;
  piece: PieceLite;
  onUpdated: (updated: PieceLite) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(piece.code_piece ?? "");
  const [type, setType] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const updated = await api.patch<PieceLite>(
        `/mairie/dossiers/${dossierId}/pieces/${piece.id}/classification`,
        { code_piece: code.trim() ? code.trim() : null, ...(type ? { type } : {}) },
      );
      onUpdated(updated);
      setOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la recatégorisation");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => { setCode(piece.code_piece ?? ""); setType(""); setOpen(true); }} style={linkBtn}>
        ✏️ Reclasser
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 4 }}>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Emplacement (ex. PCMI2)"
        style={{ ...inputSt, width: 130, fontFamily: "monospace", fontWeight: 600 }}
      />
      <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputSt, cursor: "pointer", maxWidth: 200 }}>
        {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button
        onClick={() => void save()}
        disabled={saving}
        style={{ background: "#4F46E5", color: "white", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
      >
        {saving ? "…" : "Enregistrer"}
      </button>
      <button onClick={() => setOpen(false)} disabled={saving} style={{ ...inputSt, cursor: "pointer", background: "white" }}>Annuler</button>
    </div>
  );
}
