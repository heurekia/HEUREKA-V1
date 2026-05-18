import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";

export function MairieDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/mairie/dashboard").then(setStats).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Chargement...</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm">Vue d'ensemble de l'activité</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Total dossiers</p>
            <p className="text-3xl font-bold text-gray-900">{stats?.total_dossiers ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">En cours</p>
            <p className="text-3xl font-bold text-heureka-600">{stats?.en_cours ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Acceptés</p>
            <p className="text-3xl font-bold text-green-600">
              {stats?.dossiers_par_statut?.find((s: any) => s.status === "accepte")?.count ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Refusés</p>
            <p className="text-3xl font-bold text-red-600">
              {stats?.dossiers_par_statut?.find((s: any) => s.status === "refuse")?.count ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><h3 className="font-semibold text-gray-900">Dossiers par statut</h3></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats?.dossiers_par_statut?.map((s: any) => (
                <div key={s.status} className="flex items-center justify-between">
                  <Badge variant={statusLabels[s.status]?.variant ?? "default"}>
                    {statusLabels[s.status]?.label ?? s.status}
                  </Badge>
                  <span className="font-medium text-gray-900">{s.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h3 className="font-semibold text-gray-900">Dossiers récents</h3></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {stats?.dossiers_recents?.slice(0, 5).map((d: any) => (
                <div key={d.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{d.numero}</p>
                    <p className="text-xs text-gray-500">{d.adresse ?? "Sans adresse"}</p>
                  </div>
                  <Badge variant={statusLabels[d.status]?.variant ?? "default"}>{statusLabels[d.status]?.label ?? d.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
