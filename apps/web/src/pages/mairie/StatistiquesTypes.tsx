import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";

const subNav = [
  { to: "/mairie/statistiques", label: "Vue d'ensemble" },
  { to: "/mairie/statistiques/delais", label: "Délais d'instruction" },
  { to: "/mairie/statistiques/types", label: "Types de dossiers" },
  { to: "/mairie/statistiques/services", label: "Services consultés" },
];

const types = [
  { type: "permis_de_construire", count: 86, pct: 100 },
  { type: "declaration_prealable", count: 52, pct: 60 },
  { type: "permis_amenager", count: 18, pct: 21 },
  { type: "permis_demolir", count: 7, pct: 8 },
  { type: "certificat_urbanisme", count: 34, pct: 40 },
];

export function StatistiquesTypes() {
  const loc = useLocation();
  const maxCount = Math.max(...types.map(t => t.count));
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Statistiques</h1>
        <p className="text-gray-500 text-sm mt-1">Types de dossiers</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-6">
          <Card className="border-gray-200/80">
            <CardHeader><h3 className="font-semibold text-[#000020]">Répartition par type</h3></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {types.map((t) => (
                  <div key={t.type} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#000020] capitalize">{t.type.replace(/_/g, " ")}</span>
                      <span className="text-sm font-semibold text-gray-700">{t.count}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                      <div className="bg-heureka-500 h-2.5 rounded-full" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
