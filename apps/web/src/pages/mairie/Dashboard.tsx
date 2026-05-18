import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";
import { FileText, Clock, CheckCircle, XCircle, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export function MairieDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/mairie/dashboard").then(setStats).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;

  const kpis = [
    { label: "Total dossiers", value: stats?.total_dossiers ?? 0, icon: FileText, color: "text-[#000020]" },
    { label: "En cours", value: stats?.en_cours ?? 0, icon: Clock, color: "text-heureka-600" },
    { label: "Acceptés", value: stats?.dossiers_par_statut?.find((s: any) => s.status === "accepte")?.count ?? 0, icon: CheckCircle, color: "text-green-600" },
    { label: "Refusés", value: stats?.dossiers_par_statut?.find((s: any) => s.status === "refuse")?.count ?? 0, icon: XCircle, color: "text-red-600" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Vue d'ensemble de l'activité</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="border-gray-200/80">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{kpi.label}</p>
                    <p className={`text-3xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
                    <Icon className={`w-6 h-6 ${kpi.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-gray-200/80">
          <CardHeader>
            <h3 className="font-semibold text-[#000020]">Dossiers par statut</h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats?.dossiers_par_statut?.map((s: any) => (
                <div key={s.status} className="flex items-center justify-between py-1">
                  <Badge variant={statusLabels[s.status]?.variant ?? "default"}>
                    {statusLabels[s.status]?.label ?? s.status}
                  </Badge>
                  <span className="font-semibold text-[#000020]">{s.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/80">
          <CardHeader className="flex flex-row items-center justify-between">
            <h3 className="font-semibold text-[#000020]">Dossiers récents</h3>
            <Link to="/mairie/dossiers" className="text-sm text-heureka-500 hover:text-heureka-600 flex items-center gap-1">
              Voir tout <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {stats?.dossiers_recents?.slice(0, 5).map((d: any) => (
                <Link key={d.id} to={`/mairie/dossiers/${d.id}`} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-[#000020]">{d.numero}</p>
                    <p className="text-xs text-gray-500">{d.adresse ?? "Sans adresse"}</p>
                  </div>
                  <Badge variant={statusLabels[d.status]?.variant ?? "default"}>
                    {statusLabels[d.status]?.label ?? d.status}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
