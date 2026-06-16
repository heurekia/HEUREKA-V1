import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api";

const subNav = [
  { to: "/mairie/statistiques", label: "Vue d'ensemble" },
  { to: "/mairie/statistiques/delais", label: "Délais d'instruction" },
  { to: "/mairie/statistiques/types", label: "Types de dossiers" },
  { to: "/mairie/statistiques/services", label: "Services consultés" },
];

type ServiceRow = { name: string; consults: number; avg_jours: number | null };

export function StatistiquesServices() {
  const loc = useLocation();
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<ServiceRow[]>("/mairie/stats/services")
      .then((d) => setServices(d ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Statistiques</h1>
        <p className="text-gray-500 text-sm mt-1">Services consultés</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-6">
          <Card className="border-gray-200/80">
            <CardHeader><h3 className="font-semibold text-[#000020]">Services consultés</h3></CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8 text-gray-400">Chargement...</div>
              ) : services.length === 0 ? (
                <div className="text-center py-8 text-gray-400">Aucune consultation</div>
              ) : (
                <div className="space-y-4">
                  {services.map((s) => (
                    <div key={s.name} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <span className="font-medium text-[#000020]">{s.name}</span>
                      <div className="flex items-center gap-6">
                        <span className="text-sm text-gray-500">{s.consults} consultation{s.consults > 1 ? "s" : ""}</span>
                        {s.avg_jours != null && (
                          <Badge variant="info">{s.avg_jours}j délai moyen</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
