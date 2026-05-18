import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { cn } from "../../lib/utils";
import { FileText, Clock, TrendingUp, BarChart3, PieChart, ArrowRight } from "lucide-react";

const subNav = [
  { to: "/mairie/statistiques", label: "Vue d'ensemble" },
  { to: "/mairie/statistiques/delais", label: "Délais d'instruction" },
  { to: "/mairie/statistiques/types", label: "Types de dossiers" },
  { to: "/mairie/statistiques/services", label: "Services consultés" },
];

export function Statistiques() {
  const loc = useLocation();
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
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
                loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-gray-200/80">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Total dossiers</p>
                    <p className="text-3xl font-bold text-[#000020] mt-1">{stats?.total ?? 0}</p>
                  </div>
                  <FileText className="w-8 h-8 text-gray-300" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200/80">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Délai moyen</p>
                    <p className="text-3xl font-bold text-heureka-600 mt-1">--</p>
                  </div>
                  <Clock className="w-8 h-8 text-amber-300" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200/80">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Conformité moyenne</p>
                    <p className="text-3xl font-bold text-green-600 mt-1">--</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-300" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Card className="border-gray-200/80">
              <CardHeader className="flex flex-row items-center justify-between">
                <h3 className="font-semibold text-[#000020] flex items-center gap-2"><PieChart className="w-4 h-4 text-heureka-500" /> Par type</h3>
                <Link to="/mairie/statistiques/types" className="text-sm text-heureka-500 hover:text-heureka-600 flex items-center gap-1">Voir <ArrowRight className="w-3.5 h-3.5" /></Link>
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
              <CardHeader className="flex flex-row items-center justify-between">
                <h3 className="font-semibold text-[#000020] flex items-center gap-2"><BarChart3 className="w-4 h-4 text-heureka-500" /> Par mois</h3>
                <Link to="/mairie/statistiques/delais" className="text-sm text-heureka-500 hover:text-heureka-600 flex items-center gap-1">Délais <ArrowRight className="w-3.5 h-3.5" /></Link>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stats?.par_mois?.slice(-12).map((m: any) => (
                    <div key={m.mois} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 w-20">{m.mois}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div className="bg-heureka-500 h-3 rounded-full" style={{ width: `${(m.count / maxCount) * 100}%` }} />
                      </div>
                      <span className="text-sm font-medium text-gray-700 w-8 text-right">{m.count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
