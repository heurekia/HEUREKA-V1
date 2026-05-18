import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";

export function MairieDossierDetail() {
  const { id } = useParams();
  const [dossier, setDossier] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>(`/mairie/dossiers/${id}`).then(setDossier).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-center py-12 text-gray-500">Chargement...</div>;
  if (!dossier) return <div className="text-center py-12 text-gray-500">Dossier non trouvé</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dossier {dossier.numero}</h1>
          <p className="text-gray-500 text-sm capitalize">{dossier.type.replace(/_/g, " ")}</p>
        </div>
        <Badge variant={statusLabels[dossier.status]?.variant ?? "default"} className="text-sm px-4 py-1">
          {statusLabels[dossier.status]?.label ?? dossier.status}
        </Badge>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Informations</h3></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <div><dt className="text-sm text-gray-500">Adresse</dt><dd className="font-medium text-gray-900">{dossier.adresse ?? "-"}</dd></div>
                <div><dt className="text-sm text-gray-500">Parcelle</dt><dd className="font-medium text-gray-900">{dossier.parcelle ?? "-"}</dd></div>
                <div><dt className="text-sm text-gray-500">Commune</dt><dd className="font-medium text-gray-900">{dossier.commune ?? "-"}</dd></div>
                <div><dt className="text-sm text-gray-500">Surface plancher</dt><dd className="font-medium text-gray-900">{dossier.surface_plancher ?? "-"}</dd></div>
                <div><dt className="text-sm text-gray-500">Date dépôt</dt><dd className="font-medium text-gray-900">{dossier.date_depot ? new Date(dossier.date_depot).toLocaleDateString("fr-FR") : "-"}</dd></div>
                <div><dt className="text-sm text-gray-500">Date limite instruction</dt><dd className="font-medium text-gray-900">{dossier.date_limite_instruction ? new Date(dossier.date_limite_instruction).toLocaleDateString("fr-FR") : "-"}</dd></div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Analyse parcellaire</h3></CardHeader>
            <CardContent className="p-8 text-center text-gray-500">
              <p>Analyse IA disponible prochainement</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Demandeur</h3></CardHeader>
            <CardContent>
              {dossier.demandeur ? (
                <div>
                  <p className="font-medium text-gray-900">{dossier.demandeur.prenom} {dossier.demandeur.nom}</p>
                  <p className="text-sm text-gray-500">{dossier.demandeur.email}</p>
                </div>
              ) : (
                <p className="text-gray-500">Non disponible</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Actions</h3></CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full">Changer le statut</Button>
              <Button variant="outline" className="w-full">Assigner un instructeur</Button>
              <Button variant="outline" className="w-full">Voir la messagerie</Button>
              <Button variant="danger" className="w-full">Refuser le dossier</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
