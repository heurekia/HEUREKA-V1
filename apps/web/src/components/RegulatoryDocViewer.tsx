import { useEffect, useMemo, useState } from "react";
import { Library, FileText } from "lucide-react";
import { api } from "../lib/api";
import { PdfAnnotator } from "./PdfAnnotator";

/**
 * Second viewer du mode Comparer : affiche un document réglementaire de la
 * commune (PLU, PPRI, OAP…) à côté de la pièce du pétitionnaire pour permettre
 * la confrontation visuelle directe — sans alterner ni imprimer.
 *
 * La sélection se fait via un dropdown alimenté par `GET /api/mairie/documents`,
 * et le rendu PDF utilise le streaming inline `GET /api/mairie/documents/:id/pdf`
 * vers le viewer natif du navigateur (même choix que `PieceViewer`).
 */

const DOC_TYPE_LABELS: Record<string, string> = {
  plu: "PLU", ppri: "PPRI", oap: "OAP", peb: "PEB",
  pprt: "PPRT", plh: "PLH", zac: "ZAC", autre: "Autre",
};

interface CommuneDoc {
  id: string;
  type: string;
  name: string;
  status: string;
}

interface Props {
  /** Nom de la commune du dossier (utilisé pour filtrer la liste). */
  communeName: string;
  /** Mémorisé entre changements de mode pour ne pas perdre le doc en cours. */
  selectedDocId: string | null;
  onSelectDoc: (id: string | null) => void;
  /** Quand on arrive depuis une citation de verdict, on peut suggérer le
   *  type de document (PLU / PPRI / OAP…) pour qu'on auto-sélectionne le
   *  bon plutôt que le PLU par défaut. Le hint l'emporte sur le défaut PLU. */
  preferredDocType?: string | null;
  /** Page sur laquelle ouvrir le PDF. Utilisé pour pointer directement sur
   *  un passage cité (fragment #page=N pris en charge par le viewer natif). */
  page?: number | null;
}

export function RegulatoryDocViewer({ communeName, selectedDocId, onSelectDoc, preferredDocType, page }: Props) {
  const [docs, setDocs] = useState<CommuneDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!communeName) return;
    setLoading(true);
    api.get<CommuneDoc[]>(`/mairie/documents?commune=${encodeURIComponent(communeName)}`)
      .then((list) => {
        // On ne propose que les documents effectivement indexés / lisibles.
        const indexed = list.filter((d) => d.status === "indexed" || d.status === "indexing");
        setDocs(indexed);
        // Auto-sélection du premier PLU disponible si rien n'est encore choisi.
        if (!selectedDocId && indexed.length > 0) {
          const plu = indexed.find((d) => d.type === "plu") ?? indexed[0]!;
          onSelectDoc(plu.id);
        }
      })
      .catch((e) => console.error("[regulatory-viewer] chargement docs", e))
      .finally(() => setLoading(false));
    // selectedDocId/onSelectDoc volontairement hors deps : on initialise une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communeName]);

  // Quand le composant reçoit un type hint (ex: arrivée depuis citation PLU),
  // on bascule sur un doc de ce type s'il en existe un et qu'il diffère du
  // doc courant. Ré-évalué à chaque changement de hint.
  useEffect(() => {
    if (!preferredDocType || docs.length === 0) return;
    const wanted = docs.find((d) => d.type.toLowerCase() === preferredDocType.toLowerCase());
    if (wanted && wanted.id !== selectedDocId) onSelectDoc(wanted.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredDocType, docs]);

  const selected = useMemo(() => docs.find((d) => d.id === selectedDocId) ?? null, [docs, selectedDocId]);

  if (!communeName) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200 p-8">
        <FileText className="w-10 h-10 mb-2" />
        <p className="text-sm">Commune du dossier inconnue.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-[420px] rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Barre d'outils — dropdown de bibliothèque + statut */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 bg-gray-50">
        <Library className="w-4 h-4 text-gray-400 shrink-0" />
        <select
          value={selectedDocId ?? ""}
          onChange={(e) => onSelectDoc(e.target.value || null)}
          className="flex-1 min-w-0 bg-white border border-gray-200 rounded-md px-2 py-1 text-sm text-[#000020] focus:outline-none focus:ring-2 focus:ring-heureka-500/40"
          disabled={loading || docs.length === 0}
        >
          {loading && <option value="">Chargement…</option>}
          {!loading && docs.length === 0 && <option value="">Aucun document indexé pour {communeName}</option>}
          {!loading && docs.length > 0 && (
            <>
              <option value="">— choisir un document —</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {DOC_TYPE_LABELS[d.type] ?? d.type.toUpperCase()} · {d.name}
                </option>
              ))}
            </>
          )}
        </select>
        {selected && selected.status === "indexing" && (
          <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded shrink-0">indexation en cours</span>
        )}
      </div>

      {/* Corps — PdfAnnotator (react-pdf + couches text/annotation) */}
      <div className="flex-1 bg-gray-100 min-h-0">
        {selected ? (
          <PdfAnnotator
            // key inclut le doc pour réinitialiser l'état (page courante)
            // quand l'instructeur change de document.
            key={selected.id}
            fileUrl={`/api/mairie/documents/${selected.id}/pdf`}
            initialPage={typeof page === "number" && page > 0 ? page : 1}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
            <FileText className="w-10 h-10 mb-2" />
            <p className="text-sm">Sélectionnez un document à confronter à la pièce.</p>
          </div>
        )}
      </div>
    </div>
  );
}
