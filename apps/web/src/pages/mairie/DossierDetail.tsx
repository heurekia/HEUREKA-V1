import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  ArrowLeft, FileText, User, MessageSquare, AlertTriangle, CheckCircle,
  RefreshCw, ChevronDown, ChevronRight, ShieldCheck, ShieldAlert, ShieldX,
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
  conforme: { label: "Conforme", variant: "success", Icon: ShieldCheck },
  acceptable: { label: "Acceptable", variant: "info", Icon: ShieldCheck },
  incomplet: { label: "Incomplet", variant: "warning", Icon: ShieldAlert },
  non_conforme: { label: "Non conforme", variant: "danger", Icon: ShieldX },
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

export function MairieDossierDetail() {
  const { id } = useParams();
  const [dossier, setDossier] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>(`/mairie/dossiers/${id}`).then(setDossier).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;
  if (!dossier) return <div className="text-center py-12 text-gray-400">Dossier non trouvé</div>;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
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
    </div>
  );
}
