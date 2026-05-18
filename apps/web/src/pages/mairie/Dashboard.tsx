import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";
import { FileText, Clock, CheckCircle, XCircle, ArrowRight, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

function BarChart({ data, height = 160 }: { data: { label: string; value: number; color: string }[]; height?: number }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
          <span className="text-xs font-medium text-gray-700">{d.value}</span>
          <div
            className="w-full rounded-t-md transition-all"
            style={{
              height: `${(d.value / max) * 100}%`,
              backgroundColor: d.color,
              minHeight: d.value > 0 ? 12 : 0,
            }}
          />
          <span className="text-[10px] text-gray-400 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function MairieDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/mairie/dashboard").then(setStats).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;

  const kpis = [
    { label: "Total dossiers", value: stats?.total_dossiers ?? 0, icon: FileText, color: "text-[#000020]", bg: "bg-heureka-50" },
    { label: "En cours", value: stats?.en_cours ?? 0, icon: Clock, color: "text-heureka-600", bg: "bg-heureka-50" },
    { label: "Acceptés", value: stats?.dossiers_par_statut?.find((s: any) => s.status === "accepte")?.count ?? 0, icon: CheckCircle, color: "text-green-600", bg: "bg-green-50" },
    { label: "Refusés", value: stats?.dossiers_par_statut?.find((s: any) => s.status === "refuse")?.count ?? 0, icon: XCircle, color: "text-red-600", bg: "bg-red-50" },
  ];

  const chartData = stats?.dossiers_par_statut
    ?.filter((s: any) => !["accepte", "refuse"].includes(s.status))
    ?.map((s: any) => ({
      label: statusLabels[s.status]?.label ?? s.status,
      value: s.count,
      color: statusLabels[s.status]?.variant === "success" ? "#16a34a"
        : statusLabels[s.status]?.variant === "warning" ? "#ca8a04"
        : statusLabels[s.status]?.variant === "danger" ? "#dc2626"
        : "#3000f0",
    })) ?? [];

  const weeklyData = [
    { label: "Lun", value: 4, color: "#3000f0" },
    { label: "Mar", value: 7, color: "#3000f0" },
    { label: "Mer", value: 5, color: "#3000f0" },
    { label: "Jeu", value: 9, color: "#3000f0" },
    { label: "Ven", value: 6, color: "#3000f0" },
    { label: "Sam", value: 2, color: "#3000f0" },
    { label: "Dim", value: 1, color: "#3000f0" },
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
            <Card key={kpi.label} className="border-gray-200/80 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{kpi.label}</p>
                    <p className={`text-3xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                  </div>
                  <div className={`w-12 h-12 rounded-xl ${kpi.bg} flex items-center justify-center`}>
                    <Icon className={`w-6 h-6 ${kpi.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <Card className="border-gray-200/80 lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[#000020]">Activité hebdomadaire</h3>
              <TrendingUp className="w-4 h-4 text-gray-400" />
            </div>
          </CardHeader>
          <CardContent>
            <BarChart data={weeklyData} height={180} />
          </CardContent>
        </Card>
        <Card className="border-gray-200/80">
          <CardHeader>
            <h3 className="font-semibold text-[#000020]">Dossiers par statut</h3>
          </CardHeader>
          <CardContent className="pt-0">
            {chartData.length > 0 && <BarChart data={chartData} height={160} />}
            <div className="space-y-2 mt-4 pt-4 border-t border-gray-100">
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
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
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
        <Card className="border-gray-200/80">
          <CardHeader>
            <h3 className="font-semibold text-[#000020]">Délais de traitement</h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { label: "Permis de construire", current: 45, max: 90, color: "bg-green-500" },
                { label: "Déclaration préalable", current: 18, max: 30, color: "bg-heureka-500" },
                { label: "Permis d'aménager", current: 52, max: 90, color: "bg-amber-500" },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">{item.label}</span>
                    <span className="font-medium text-[#000020]">{item.current}j / {item.max}j</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${item.color}`}
                      style={{ width: `${Math.min(100, (item.current / item.max) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
