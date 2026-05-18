import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ArrowLeft, FileText, User, MessageSquare, AlertTriangle, CheckCircle } from "lucide-react";

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

          <Card className="border-gray-200/80">
            <CardHeader>
              <h3 className="font-semibold text-[#000020] flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-heureka-500" />
                Analyse parcellaire
              </h3>
            </CardHeader>
            <CardContent className="p-8 text-center text-gray-400">
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>Analyse IA disponible prochainement</p>
            </CardContent>
          </Card>
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
