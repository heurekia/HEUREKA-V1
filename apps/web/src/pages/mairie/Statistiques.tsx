import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";

export function Statistiques() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/mairie/stats").then(setStats).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Chargement...</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Statistiques</h1>
        <p className="text-gray-500 text-sm">Analyse de l'activité et des performances</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Total dossiers</p>
            <p className="text-3xl font-bold text-gray-900">{stats?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Délai moyen d'instruction</p>
            <p className="text-3xl font-bold text-heureka-600">--</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Taux de conformité moyen</p>
            <p className="text-3xl font-bold text-green-600">--</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><h3 className="font-semibold text-gray-900">Par type de dossier</h3></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats?.par_type?.map((t: any) => (
                <div key={t.type} className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-700 capitalize">{t.type.replace(/_/g, " ")}</span>
                  <span className="font-medium text-gray-900">{t.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h3 className="font-semibold text-gray-900">Par mois</h3></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats?.par_mois?.slice(-12).map((m: any) => (
                <div key={m.mois} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-20">{m.mois}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div className="bg-heureka-500 h-2 rounded-full" style={{ width: `${Math.min(100, (m.count / Math.max(...stats.par_mois.map((x: any) => x.count))) * 100)}%` }} />
                  </div>
                  <span className="text-sm font-medium text-gray-700 w-8 text-right">{m.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
