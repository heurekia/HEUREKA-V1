import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { RegulatoryChecklist } from "../../components/RegulatoryChecklist";
import { DocumentationPanel } from "../../components/DocumentationPanel";
import { PieceViewer, PieceViewerFullscreen, type PieceLite } from "../../components/PieceViewer";
import { RegulatoryDocViewer } from "../../components/RegulatoryDocViewer";
import { ResizableSplit } from "../../components/ResizableSplit";
import { useInstructionViewMode } from "../../hooks/useInstructionViewMode";
import {
  ArrowLeft, FileText, User, MessageSquare, AlertTriangle, CheckCircle,
  RefreshCw, ChevronDown, ChevronRight, ShieldCheck, ShieldAlert, ShieldX,
  FolderOpen, LayoutGrid, Columns2, BookOpen, Paperclip, Library,
} from "lucide-react";

type PieceScore = "conforme" | "acceptable" | "incomplet" | "non_conforme";

interface NonConformite {
  regle: string;
  article?: string;
  constate: string;
  attendu: string;
  gravite: "info" | "mineure" | "majeure";
}

interface ConformitePiece {
  piece_id: string;
  code_piece: string | null;
  nom: string;
  score: PieceScore;
  commentaire: string;
  suggestions: string[];
  non_conformites?: NonConformite[];
  reglementaire: boolean;
  error?: string;
}

interface ConformiteReport {
  schema_version: number;
  score_global: PieceScore;
  score_pct: number;
  pieces_attendues: number;
  pieces_deposees: number;
  pieces_manquantes: Array<{ code: string; nom: string }>;
  pieces_analyses: ConformitePiece[];
  alertes_reglementaires: string[];
  synthese: string;
  model: string;
  duration_ms: number;
  analyzed_at: string;
  warnings: string[];
}

interface ConformiteResponse {
  status: "absent" | "pending" | "running" | "done" | "failed";
  analyzed_at: string | null;
  report: ConformiteReport | null;
}

const SCORE_META: Record<PieceScore, { label: string; variant: "success" | "warning" | "danger" | "info" | "default"; Icon: typeof ShieldCheck }> = {
  conforme: { label: "Document exploitable", variant: "success", Icon: ShieldCheck },
  acceptable: { label: "Exploitable avec réserves", variant: "info", Icon: ShieldCheck },
  incomplet: { label: "À compléter", variant: "warning", Icon: ShieldAlert },
  non_conforme: { label: "À reprendre", variant: "danger", Icon: ShieldX },
};

const GRAVITE_META: Record<NonConformite["gravite"], { label: string; variant: "warning" | "danger" | "default" }> = {
  info: { label: "Info", variant: "default" },
  mineure: { label: "Mineure", variant: "warning" },
  majeure: { label: "Majeure", variant: "danger" },
};

function ConformitePanel({ dossierId }: { dossierId: string }) {
  const [data, setData] = useState<ConformiteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      const d = await api.get<ConformiteResponse>(`/mairie/dossiers/${dossierId}/conformite`);
      setData(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [dossierId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Polling tant que l'analyse est en cours
  useEffect(() => {
    if (data?.status !== "pending" && data?.status !== "running") return;
    const t = setInterval(fetchData, 4000);
    return () => clearInterval(t);
  }, [data?.status, fetchData]);

  const launch = async () => {
    setLaunching(true);
    try {
      await api.post(`/mairie/dossiers/${dossierId}/conformite/analyse`, {});
      await fetchData();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <Card className="border-gray-200/80">
        <CardHeader>
          <h3 className="font-semibold text-[#000020] flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-heureka-500" />
            Analyse de conformité
          </h3>
        </CardHeader>
        <CardContent className="p-8 text-center text-gray-400">Chargement…</CardContent>
      </Card>
    );
  }

  const status = data?.status ?? "absent";
  const report = data?.report ?? null;
  const running = status === "pending" || status === "running";

  return (
    <Card className="border-gray-200/80">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-[#000020] flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-heureka-500" />
            Analyse de conformité
          </h3>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={launch}
            disabled={launching || running}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
            {running ? "Analyse en cours…" : report ? "Relancer" : "Lancer l'analyse"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {status === "absent" && !report && (
          <p className="text-sm text-gray-500">
            Aucune analyse réalisée. Cliquez sur « Lancer l'analyse » pour vérifier les pièces déposées
            par rapport au CERFA et au PLU applicable.
          </p>
        )}

        {status === "failed" && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
            L'analyse précédente a échoué. Vous pouvez la relancer.
          </div>
        )}

        {running && !report && (
          <p className="text-sm text-gray-500">
            Analyse en cours. Les pièces sont croisées avec les règles du PLU et la nomenclature CERFA.
          </p>
        )}

        {report && (
          <div className="space-y-5">
            {/* Synthèse globale */}
            <div className="flex items-start gap-4 p-4 rounded-lg border border-gray-200 bg-gray-50">
              <div className="text-3xl font-bold text-[#000020] min-w-[64px] text-center">
                {report.score_pct}%
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={SCORE_META[report.score_global].variant}>
                    {SCORE_META[report.score_global].label}
                  </Badge>
                  <span className="text-xs text-gray-500">
                    {report.pieces_deposees}/{report.pieces_attendues} pièce{report.pieces_attendues > 1 ? "s" : ""}
                  </span>
                </div>
                <p className="text-sm text-gray-700">{report.synthese}</p>
                <p className="text-[11px] text-gray-400 mt-1">
                  Analysé le {new Date(report.analyzed_at).toLocaleString("fr-FR")} · {(report.duration_ms / 1000).toFixed(1)} s
                </p>
              </div>
            </div>

            {/* Pièces manquantes */}
            {report.pieces_manquantes.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <h4 className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Pièces manquantes ({report.pieces_manquantes.length})
                </h4>
                <ul className="text-sm text-amber-900 space-y-1">
                  {report.pieces_manquantes.map((p) => (
                    <li key={p.code}>
                      <span className="font-mono text-xs mr-2 text-amber-700">{p.code}</span>{p.nom}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Alertes réglementaires */}
            {report.alertes_reglementaires.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">Contraintes réglementaires</h4>
                <ul className="text-sm text-blue-900 space-y-1 list-disc list-inside">
                  {report.alertes_reglementaires.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}

            {/* Pièces analysées */}
            {report.pieces_analyses.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-[#000020] mb-2">
                  Pièces déposées ({report.pieces_analyses.length})
                </h4>
                <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg">
                  {report.pieces_analyses.map((p) => {
                    const meta = SCORE_META[p.score];
                    const isOpen = expanded.has(p.piece_id);
                    const ncCount = p.non_conformites?.length ?? 0;
                    return (
                      <li key={p.piece_id}>
                        <button
                          type="button"
                          onClick={() => toggle(p.piece_id)}
                          className="w-full text-left p-3 flex items-start gap-3 hover:bg-gray-50"
                        >
                          <div className="mt-0.5">
                            {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {p.code_piece && (
                                <span className="font-mono text-xs text-gray-500">{p.code_piece}</span>
                              )}
                              <span className="text-sm font-medium text-[#000020]">{p.nom}</span>
                              <Badge variant={meta.variant}>{meta.label}</Badge>
                              {ncCount > 0 && (
                                <Badge variant="warning">{ncCount} non-conf.</Badge>
                              )}
                              {!p.reglementaire && (
                                <span className="text-[10px] text-gray-400">qualité visuelle uniquement</span>
                              )}
                            </div>
                            {!isOpen && (
                              <p className="text-xs text-gray-600 mt-1 line-clamp-1">{p.commentaire}</p>
                            )}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="px-3 pb-4 pl-10 space-y-3">
                            <p className="text-sm text-gray-700">{p.commentaire}</p>
                            {p.non_conformites && p.non_conformites.length > 0 && (
                              <div className="space-y-2">
                                <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                  Non-conformités
                                </h5>
                                {p.non_conformites.map((nc, i) => (
                                  <div
                                    key={i}
                                    className="text-sm border border-gray-200 rounded-md p-2.5 bg-white"
                                  >
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <span className="font-medium text-[#000020]">{nc.regle}</span>
                                      <Badge variant={GRAVITE_META[nc.gravite].variant}>
                                        {GRAVITE_META[nc.gravite].label}
                                      </Badge>
                                    </div>
                                    {nc.article && (
                                      <p className="text-[11px] text-gray-500 mb-1">Réf : {nc.article}</p>
                                    )}
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                      <div>
                                        <span className="text-gray-500">Constaté :</span>{" "}
                                        <span className="text-gray-800">{nc.constate || "—"}</span>
                                      </div>
                                      <div>
                                        <span className="text-gray-500">Attendu :</span>{" "}
                                        <span className="text-gray-800">{nc.attendu || "—"}</span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {p.suggestions.length > 0 && (
                              <div>
                                <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                                  Suggestions
                                </h5>
                                <ul className="list-disc list-inside text-sm text-gray-700 space-y-0.5">
                                  {p.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                                </ul>
                              </div>
                            )}
                            {p.error && (
                              <p className="text-xs text-red-600">Erreur analyse : {p.error}</p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {report.warnings.length > 0 && (
              <div className="text-xs text-gray-500 border-t border-gray-100 pt-3">
                <p className="font-medium mb-1">Avertissements techniques</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Liste des pièces du dossier — sélection de la pièce active ───────────────
//
// Pour éviter le bruit visuel quand l'instruction avance, les pièces sont
// rangées dans quatre sections dépliantes selon le statut posé par
// l'instructeur (à examiner / acceptées / refusées / compléments demandés).
// Par défaut "à examiner" et "compléments demandés" sont ouverts (état chaud
// de l'instruction), les autres pliées. À l'intérieur de chaque section, on
// garde le regroupement par rubrique (PC1, PC2, …) pour préserver la lecture
// "bordereau" : on n'ajoute jamais d'organisation sans en justifier l'utilité.
//
// Les pièces archivées (anciennes versions remplacées suite à un complément)
// sont chargées à la demande via le bouton dédié en pied de liste.

type PieceStatusKey = "a_examiner" | "valide" | "complement_demande" | "rejete";

const STATUS_SECTIONS: ReadonlyArray<{
  key: PieceStatusKey;
  label: string;
  variant: "default" | "success" | "warning" | "danger";
  defaultOpen: boolean;
}> = [
  { key: "a_examiner",         label: "À examiner",          variant: "default", defaultOpen: true },
  { key: "complement_demande", label: "Compléments demandés", variant: "warning", defaultOpen: true },
  { key: "valide",             label: "Acceptées",            variant: "success", defaultOpen: false },
  { key: "rejete",             label: "Refusées",             variant: "danger",  defaultOpen: false },
];

function statusKeyOf(p: PieceLite): PieceStatusKey {
  switch (p.instructeur_status) {
    case "valide": return "valide";
    case "rejete": return "rejete";
    case "complement_demande": return "complement_demande";
    default: return "a_examiner";
  }
}

interface SlotGroup {
  code: string | null;
  label: string;
  files: PieceLite[];
}

// Regroupement par emplacement (code_piece). Tri : codifiées d'abord (PC1, …),
// annexes libres ensuite. À l'intérieur d'un groupe, ordre d'origine (desc par
// date d'upload côté API).
function groupBySlot(pieces: PieceLite[]): SlotGroup[] {
  const map = new Map<string, SlotGroup>();
  for (const p of pieces) {
    const code = p.code_piece && p.code_piece.length > 0 ? p.code_piece : null;
    const key = code ?? `__annexe_${p.id}__`;
    let g = map.get(key);
    if (!g) {
      const dash = p.nom.indexOf(" - ");
      const label = code
        ? (dash > 0 ? p.nom.slice(0, dash).trim() : p.nom)
        : (dash > 0 ? p.nom.slice(dash + 3).trim() : p.nom);
      g = { code, label, files: [] };
      map.set(key, g);
    }
    g.files.push(p);
  }
  return Array.from(map.values()).sort((a, b) => {
    if ((a.code === null) !== (b.code === null)) return a.code === null ? 1 : -1;
    return (a.code ?? "").localeCompare(b.code ?? "", "fr", { numeric: true });
  });
}

function PiecesList({
  pieces,
  selectedId,
  onSelect,
  archived,
  archivedLoading,
  onLoadArchived,
}: {
  pieces: PieceLite[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  archived: PieceLite[] | null;
  archivedLoading: boolean;
  onLoadArchived: () => void;
}) {
  const [open, setOpen] = useState<Record<PieceStatusKey, boolean>>(() => {
    const init = {} as Record<PieceStatusKey, boolean>;
    for (const s of STATUS_SECTIONS) init[s.key] = s.defaultOpen;
    return init;
  });
  const [showArchived, setShowArchived] = useState(false);

  // Partition par statut puis groupage par slot — on évite ainsi le double
  // recalcul à chaque toggle de section.
  const byStatus = useMemo(() => {
    const buckets: Record<PieceStatusKey, PieceLite[]> = {
      a_examiner: [], valide: [], complement_demande: [], rejete: [],
    };
    for (const p of pieces) buckets[statusKeyOf(p)].push(p);
    const out = {} as Record<PieceStatusKey, SlotGroup[]>;
    for (const k of Object.keys(buckets) as PieceStatusKey[]) out[k] = groupBySlot(buckets[k]);
    return out;
  }, [pieces]);

  const archivedGroups = useMemo(
    () => (archived && archived.length > 0 ? groupBySlot(archived) : []),
    [archived],
  );

  const renderSlot = (g: SlotGroup, opts?: { archived?: boolean }) => (
    <div key={(opts?.archived ? "a:" : "") + (g.code ?? g.files[0]!.id)}>
      {/* En-tête de groupe : code + libellé du slot */}
      <div className="flex items-center gap-2 px-2 py-1">
        {g.code ? (
          <span className="font-mono text-[10px] font-bold text-heureka-700 bg-heureka-50 border border-heureka-200 rounded px-1.5 py-0.5 shrink-0">
            {g.code}
          </span>
        ) : (
          <span className="font-mono text-[10px] font-bold text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 shrink-0">
            ANNEXE
          </span>
        )}
        <span className="text-[11px] font-semibold text-gray-600 truncate" title={g.label}>
          {g.label}
        </span>
        {g.files.length > 1 && (
          <span className="text-[10px] text-gray-400 shrink-0">· {g.files.length} fichiers</span>
        )}
      </div>
      <ul>
        {g.files.map((p) => {
          const active = p.id === selectedId;
          const dash = p.nom.indexOf(" - ");
          const filename = dash > 0 ? p.nom.slice(dash + 3).trim() : p.nom;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                className={`w-full text-left pl-5 pr-3 py-1.5 rounded-md transition-colors ${
                  active ? "bg-heureka-50 ring-1 ring-heureka-500/40" : "hover:bg-gray-50"
                } ${opts?.archived ? "opacity-60" : ""}`}
                aria-current={active ? "true" : undefined}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#000020] truncate flex-1" title={filename}>{filename}</span>
                  {opts?.archived && <span className="text-[10px] text-gray-400 italic shrink-0">archivée</span>}
                  {!opts?.archived && p.instructeur_status === "valide" && <Badge variant="success">✓</Badge>}
                  {!opts?.archived && p.instructeur_status === "rejete" && <Badge variant="danger">!</Badge>}
                  {!opts?.archived && p.instructeur_status === "complement_demande" && <Badge variant="warning">?</Badge>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <Card className="border-gray-200/80">
      <CardHeader>
        <h3 className="font-semibold text-[#000020] flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-heureka-500" />
          Pièces déposées ({pieces.length})
        </h3>
      </CardHeader>
      <CardContent className="p-2">
        {pieces.length === 0 ? (
          <p className="text-sm text-gray-400 p-4 text-center">Aucune pièce déposée.</p>
        ) : (
          <div className="max-h-[520px] overflow-y-auto">
            {STATUS_SECTIONS.map((s) => {
              const groups = byStatus[s.key];
              const count = groups.reduce((n, g) => n + g.files.length, 0);
              const isOpen = open[s.key];
              return (
                <div key={s.key} className="border-b border-gray-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpen((prev) => ({ ...prev, [s.key]: !prev[s.key] }))}
                    className="w-full flex items-center gap-2 px-2 py-2 hover:bg-gray-50 text-left"
                    aria-expanded={isOpen}
                  >
                    {isOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    )}
                    <Badge variant={s.variant}>{s.label}</Badge>
                    <span className="text-[11px] text-gray-500 ml-auto tabular-nums">
                      {count}
                    </span>
                  </button>
                  {isOpen && (
                    count === 0 ? (
                      <p className="text-[11px] text-gray-400 italic px-7 pb-2">Aucune pièce dans cette section.</p>
                    ) : (
                      <div className="pb-2 space-y-2">{groups.map((g) => renderSlot(g))}</div>
                    )
                  )}
                </div>
              );
            })}

            {/* Versions archivées — anciennes pièces remplacées par un nouvel
                import après une demande de complément. Cachées par défaut. */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!showArchived && archived === null) onLoadArchived();
                  setShowArchived((v) => !v);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-gray-500 hover:bg-gray-50 rounded-md"
              >
                {showArchived ? (
                  <ChevronDown className="w-3 h-3 text-gray-400" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-gray-400" />
                )}
                <span>
                  {archivedLoading
                    ? "Chargement des versions précédentes…"
                    : archived === null
                      ? "Afficher les versions précédentes"
                      : archived.length === 0
                        ? "Aucune version précédente"
                        : `Versions précédentes (${archived.length})`}
                </span>
              </button>
              {showArchived && archivedGroups.length > 0 && (
                <div className="mt-1 space-y-2 border-t border-dashed border-gray-200 pt-2">
                  {archivedGroups.map((g) => renderSlot(g, { archived: true }))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MairieDossierDetail() {
  const { id } = useParams();
  const [dossier, setDossier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pieces, setPieces] = useState<PieceLite[]>([]);
  // Versions archivées — chargées à la demande seulement. null = non encore
  // demandé, [] = chargé mais vide.
  const [archivedPieces, setArchivedPieces] = useState<PieceLite[] | null>(null);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // Bascule entre la vue « Instruction » (pièces / viewer / documentation) et
  // la vue « Synthèse » (informations + conformité + checklist réglementaire).
  // Conserver les deux pour ne pas régresser sur les écrans existants.
  const [view, setView] = useState<"instruction" | "synthese">("instruction");
  // Mode d'affichage de l'Instruction : aperçu (3 col.) · comparer (2 viewers
  // côte à côte) · lecture (1 viewer plein écran, sidebars en bandes).
  // Persisté en localStorage par instructeur.
  const [viewMode, setViewMode] = useInstructionViewMode();
  // Document réglementaire affiché dans le second viewer en mode Comparer.
  // null = pas encore choisi → le RegulatoryDocViewer auto-sélectionne le PLU.
  const [regulatoryDocId, setRegulatoryDocId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<any>(`/mairie/dossiers/${id}`).then(setDossier).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    api.get<PieceLite[]>(`/mairie/dossiers/${id}/pieces`)
      .then((list) => {
        setPieces(list);
        // Sélectionne la première pièce examinable par défaut.
        if (list.length > 0 && !selectedPieceId) setSelectedPieceId(list[0]!.id);
      })
      .catch(console.error);
    // selectedPieceId est intentionnellement omis : on ne veut pas resélectionner
    // quand l'utilisateur change manuellement de pièce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadArchived = useCallback(() => {
    if (!id || archivedLoading || archivedPieces !== null) return;
    setArchivedLoading(true);
    api.get<PieceLite[]>(`/mairie/dossiers/${id}/pieces?include_archived=1`)
      .then((all) => {
        // L'API renvoie tout (archivées + actives) ; on ne retient que les
        // archivées pour ne pas dupliquer la liste principale.
        setArchivedPieces(all.filter((p) => !!p.archived_at));
      })
      .catch((e) => {
        console.error(e);
        setArchivedPieces([]);
      })
      .finally(() => setArchivedLoading(false));
  }, [id, archivedLoading, archivedPieces]);

  // L'utilisateur peut sélectionner une pièce active OU une archivée (pour
  // consulter une ancienne version dans le viewer). On cherche dans les deux.
  const selectedPiece = useMemo(
    () => pieces.find((p) => p.id === selectedPieceId)
      ?? archivedPieces?.find((p) => p.id === selectedPieceId)
      ?? null,
    [pieces, archivedPieces, selectedPieceId],
  );

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;
  if (!dossier) return <div className="text-center py-12 text-gray-400">Dossier non trouvé</div>;

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <Link to="/mairie/dossiers" className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[#000020]">Dossier {dossier.numero}</h1>
          <p className="text-gray-500 text-sm capitalize">{dossier.type?.replace(/_/g, " ")}</p>
        </div>
        <Badge variant={statusLabels[dossier.status]?.variant ?? "default"} className="text-sm px-4 py-1">
          {statusLabels[dossier.status]?.label ?? dossier.status}
        </Badge>
      </div>

      {/* Switch de vue — onglets « Instruction » / « Synthèse » + mode d'affichage. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setView("instruction")}
            className={`px-4 py-1.5 text-sm font-medium ${
              view === "instruction" ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Instruction
          </button>
          <button
            type="button"
            onClick={() => setView("synthese")}
            className={`px-4 py-1.5 text-sm font-medium ${
              view === "synthese" ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Synthèse
          </button>
        </div>

        {view === "instruction" && (
          <div className="inline-flex rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("apercu")}
              className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 ${
                viewMode === "apercu" ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
              title="Pièces · viewer · documentation"
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Aperçu
            </button>
            <button
              type="button"
              onClick={() => setViewMode("compare")}
              className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border-l border-gray-200 ${
                viewMode === "compare" ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
              title="Pièce et document réglementaire côte à côte"
            >
              <Columns2 className="w-3.5 h-3.5" /> Comparer
            </button>
            <button
              type="button"
              onClick={() => setViewMode("lecture")}
              className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 border-l border-gray-200 ${
                viewMode === "lecture" ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
              title="Document plein écran, sidebars escamotés"
            >
              <BookOpen className="w-3.5 h-3.5" /> Lecture
            </button>
          </div>
        )}
      </div>

      {view === "instruction" ? (
        viewMode === "apercu" ? (
          <div className="grid lg:grid-cols-12 gap-4">
            {/* Colonne 1 — Liste des pièces */}
            <div className="lg:col-span-3">
              <PiecesList
                pieces={pieces}
                selectedId={selectedPieceId}
                onSelect={setSelectedPieceId}
                archived={archivedPieces}
                archivedLoading={archivedLoading}
                onLoadArchived={loadArchived}
              />
            </div>
            {/* Colonne 2 — Visualiseur de la pièce */}
            <div className="lg:col-span-6 min-h-[560px]">
              <PieceViewer piece={selectedPiece} onExpand={() => setFullscreen(true)} />
            </div>
            {/* Colonne 3 — Documentation contextuelle */}
            <div className="lg:col-span-3 space-y-4">
              <DocumentationPanel dossierId={id!} pieceId={selectedPieceId} />
            </div>
          </div>
        ) : viewMode === "compare" ? (
          <div className="flex gap-2 h-[calc(100vh-220px)] min-h-[600px]">
            <div className="shrink-0 w-[220px] overflow-y-auto">
              <PiecesList
                pieces={pieces}
                selectedId={selectedPieceId}
                onSelect={setSelectedPieceId}
                archived={archivedPieces}
                archivedLoading={archivedLoading}
                onLoadArchived={loadArchived}
              />
            </div>
            <div className="flex-1 min-w-0">
              <ResizableSplit
                storageKey="heureka.compareSplitPct"
                left={<PieceViewer piece={selectedPiece} onExpand={() => setFullscreen(true)} />}
                right={
                  <RegulatoryDocViewer
                    communeName={dossier.commune ?? ""}
                    selectedDocId={regulatoryDocId}
                    onSelectDoc={setRegulatoryDocId}
                  />
                }
              />
            </div>
            <button
              type="button"
              onClick={() => setViewMode("apercu")}
              className="shrink-0 w-[44px] flex flex-col items-center justify-start gap-2 py-4 bg-gray-50 hover:bg-heureka-50 border border-gray-200 rounded-xl text-gray-500 hover:text-heureka-600 transition-colors"
              title="Rouvrir le panneau Documentation"
            >
              <Library className="w-4 h-4" />
              <span className="text-[10px] tracking-widest uppercase [writing-mode:vertical-rl] rotate-180">Doc</span>
            </button>
          </div>
        ) : (
          /* lecture — sidebars en bandes, un seul viewer plein écran sur fond papier */
          <div className="flex gap-2 h-[calc(100vh-220px)] min-h-[600px]">
            <button
              type="button"
              onClick={() => setViewMode("apercu")}
              className="shrink-0 w-[44px] flex flex-col items-center justify-start gap-2 py-4 bg-gray-50 hover:bg-heureka-50 border border-gray-200 rounded-xl text-gray-500 hover:text-heureka-600 transition-colors"
              title="Rouvrir le panneau Pièces"
            >
              <Paperclip className="w-4 h-4" />
              <span className="text-[10px] tracking-widest uppercase [writing-mode:vertical-rl] rotate-180">Pièces ({pieces.length})</span>
            </button>
            <div className="flex-1 min-w-0 bg-[#faf8f3] rounded-xl border border-gray-200 overflow-hidden">
              <PieceViewer piece={selectedPiece} onExpand={() => setFullscreen(true)} />
            </div>
            <button
              type="button"
              onClick={() => setViewMode("apercu")}
              className="shrink-0 w-[44px] flex flex-col items-center justify-start gap-2 py-4 bg-gray-50 hover:bg-heureka-50 border border-gray-200 rounded-xl text-gray-500 hover:text-heureka-600 transition-colors"
              title="Rouvrir le panneau Documentation"
            >
              <Library className="w-4 h-4" />
              <span className="text-[10px] tracking-widest uppercase [writing-mode:vertical-rl] rotate-180">Doc</span>
            </button>
          </div>
        )
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="border-gray-200/80">
              <CardHeader>
                <h3 className="font-semibold text-[#000020] flex items-center gap-2">
                  <FileText className="w-4 h-4 text-heureka-500" />
                  Informations
                </h3>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wide">Adresse</dt>
                    <dd className="font-medium text-[#000020] mt-0.5">{dossier.adresse ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wide">Parcelle</dt>
                    <dd className="font-medium text-[#000020] mt-0.5">{dossier.parcelle ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wide">Commune</dt>
                    <dd className="font-medium text-[#000020] mt-0.5">{dossier.commune ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wide">Surface plancher</dt>
                    <dd className="font-medium text-[#000020] mt-0.5">{dossier.surface_plancher ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wide">Date dépôt</dt>
                    <dd className="font-medium text-[#000020] mt-0.5">
                      {dossier.date_depot ? new Date(dossier.date_depot).toLocaleDateString("fr-FR") : "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wide">Date limite instruction</dt>
                    <dd className="font-medium text-[#000020] mt-0.5">
                      {dossier.date_limite_instruction ? new Date(dossier.date_limite_instruction).toLocaleDateString("fr-FR") : "-"}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <ConformitePanel dossierId={id!} />

            <RegulatoryChecklist dossierId={id!} />
          </div>

          <div className="space-y-6">
            <Card className="border-gray-200/80">
              <CardHeader>
                <h3 className="font-semibold text-[#000020] flex items-center gap-2">
                  <User className="w-4 h-4 text-heureka-500" />
                  Demandeur
                </h3>
              </CardHeader>
              <CardContent>
                {dossier.demandeur ? (
                  <div>
                    <p className="font-medium text-[#000020]">{dossier.demandeur.prenom} {dossier.demandeur.nom}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{dossier.demandeur.email}</p>
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">Non disponible</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-gray-200/80">
              <CardHeader>
                <h3 className="font-semibold text-[#000020] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-heureka-500" />
                  Actions
                </h3>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Changer le statut
                </Button>
                <Button variant="outline" className="w-full gap-2">
                  <User className="w-4 h-4" />
                  Assigner un instructeur
                </Button>
                <Button variant="outline" className="w-full gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Voir la messagerie
                </Button>
                <Button variant="danger" className="w-full gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Refuser le dossier
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {fullscreen && (
        <PieceViewerFullscreen piece={selectedPiece} onClose={() => setFullscreen(false)} />
      )}
    </div>
  );
}
