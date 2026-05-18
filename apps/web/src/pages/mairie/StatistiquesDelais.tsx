import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Clock, TrendingUp, AlertTriangle, CheckCircle } from "lucide-react";

const subNav = [
  { to: "/mairie/statistiques", label: "Vue d'ensemble" },
  { to: "/mairie/statistiques/delais", label: "Délais d'instruction" },
  { to: "/mairie/statistiques/types", label: "Types de dossiers" },
  { to: "/mairie/statistiques/services", label: "Services consultés" },
];

export function StatistiquesDelais() {
  const loc = useLocation();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Statistiques</h1>
        <p className="text-gray-500 text-sm mt-1">Délais d'instruction</p>
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
                    <p className="text-sm text-gray-500">Délai moyen global</p>
                    <p className="text-3xl font-bold text-heureka-600 mt-1">42j</p>
                  </div>
                  <Clock className="w-8 h-8 text-heureka-300" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200/80">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Sous 2 mois</p>
                    <p className="text-3xl font-bold text-green-600 mt-1">78%</p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-300" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200/80">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Hors délai</p>
                    <p className="text-3xl font-bold text-red-600 mt-1">12%</p>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-red-300" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-gray-200/80">
            <CardHeader><h3 className="font-semibold text-[#000020]">Évolution des délais</h3></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {["Jan", "Fév", "Mar", "Avr", "Mai"].map((m, i) => (
                  <div key={m} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-16">{m}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div className="bg-heureka-500 h-3 rounded-full" style={{ width: `${(40 + i * 5)}%` }} />
                    </div>
                    <span className="text-sm font-medium text-gray-700 w-12 text-right">{38 + i * 5}j</span>
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
