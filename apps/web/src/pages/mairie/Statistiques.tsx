import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { FileText, Clock, TrendingUp, BarChart3, PieChart } from "lucide-react";

export function Statistiques() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/mairie/stats").then(setStats).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;

  const maxCount = stats?.par_mois ? Math.max(...stats.par_mois.map((x: any) => x.count)) : 1;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Statistiques</h1>
        <p className="text-gray-500 text-sm mt-1">Analyse de l'activité et des performances</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="border-gray-200/80">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total dossiers</p>
                <p className="text-3xl font-bold text-[#000020] mt-1">{stats?.total ?? 0}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-heureka-100 flex items-center justify-center">
                <FileText className="w-6 h-6 text-heureka-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/80">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Délai moyen d'instruction</p>
                <p className="text-3xl font-bold text-heureka-600 mt-1">--</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/80">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Taux de conformité moyen</p>
                <p className="text-3xl font-bold text-green-600 mt-1">--</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-gray-200/80">
          <CardHeader>
            <h3 className="font-semibold text-[#000020] flex items-center gap-2">
              <PieChart className="w-4 h-4 text-heureka-500" />
              Par type de dossier
            </h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats?.par_type?.map((t: any) => (
                <div key={t.type} className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-700 capitalize">{t.type.replace(/_/g, " ")}</span>
                  <span className="font-semibold text-[#000020]">{t.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/80">
          <CardHeader>
            <h3 className="font-semibold text-[#000020] flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-heureka-500" />
              Par mois
            </h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats?.par_mois?.slice(-12).map((m: any) => (
                <div key={m.mois} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-20">{m.mois}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-heureka-500 h-3 rounded-full transition-all"
                      style={{ width: `${(m.count / maxCount) * 100}%` }}
                    />
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
