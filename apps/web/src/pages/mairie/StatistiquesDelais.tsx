import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Clock, AlertTriangle, CheckCircle } from "lucide-react";
import { api } from "../../lib/api";

const subNav = [
  { to: "/mairie/statistiques", label: "Vue d'ensemble" },
  { to: "/mairie/statistiques/delais", label: "Délais d'instruction" },
  { to: "/mairie/statistiques/types", label: "Types de dossiers" },
  { to: "/mairie/statistiques/services", label: "Services consultés" },
];

type DelaisData = {
  delai_moyen: number | null;
  sous_2_mois_pct: number | null;
  hors_delai_pct: number | null;
  evolution: { mois: string; delai_moyen: number }[];
};

export function StatistiquesDelais() {
  const loc = useLocation();
  const [data, setData] = useState<DelaisData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<DelaisData>("/mairie/stats/delais")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const evolution = data?.evolution?.slice(-12) ?? [];
  const maxDelai = evolution.length ? Math.max(...evolution.map((e) => e.delai_moyen), 1) : 1;

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
          {loading ? (
            <div className="text-center py-12 text-gray-400">Chargement...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-gray-200/80">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Délai moyen global</p>
                        <p className="text-3xl font-bold text-heureka-600 mt-1">
                          {data?.delai_moyen != null ? `${data.delai_moyen}j` : "--"}
                        </p>
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
                        <p className="text-3xl font-bold text-green-600 mt-1">
                          {data?.sous_2_mois_pct != null ? `${data.sous_2_mois_pct}%` : "--"}
                        </p>
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
                        <p className="text-3xl font-bold text-red-600 mt-1">
                          {data?.hors_delai_pct != null ? `${data.hors_delai_pct}%` : "--"}
                        </p>
                      </div>
                      <AlertTriangle className="w-8 h-8 text-red-300" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-gray-200/80">
                <CardHeader>
                  <h3 className="font-semibold text-[#000020]">Évolution des délais</h3>
                </CardHeader>
                <CardContent>
                  {evolution.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">Aucun dossier délivré</div>
                  ) : (
                    <div className="space-y-3">
                      {evolution.map((e) => (
                        <div key={e.mois} className="flex items-center gap-3">
                          <span className="text-sm text-gray-600 w-20">{e.mois}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                            <div
                              className="bg-heureka-500 h-3 rounded-full"
                              style={{ width: `${(e.delai_moyen / maxDelai) * 100}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium text-gray-700 w-12 text-right">
                            {e.delai_moyen}j
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
