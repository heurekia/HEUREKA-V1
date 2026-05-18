import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";

const subNav = [
  { to: "/mairie/statistiques", label: "Vue d'ensemble" },
  { to: "/mairie/statistiques/delais", label: "Délais d'instruction" },
  { to: "/mairie/statistiques/types", label: "Types de dossiers" },
  { to: "/mairie/statistiques/services", label: "Services consultés" },
];

const services = [
  { name: "DDT 37", consults: 48, avg: "4.2j" },
  { name: "CAUE", consults: 32, avg: "3.8j" },
  { name: "ABF", consults: 28, avg: "5.1j" },
  { name: "ARS", consults: 15, avg: "6.3j" },
  { name: "SDIS", consults: 12, avg: "2.5j" },
];

export function StatistiquesServices() {
  const loc = useLocation();
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
              <div className="space-y-4">
                {services.map((s) => (
                  <div key={s.name} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <span className="font-medium text-[#000020]">{s.name}</span>
                    <div className="flex items-center gap-6">
                      <span className="text-sm text-gray-500">{s.consults} consultations</span>
                      <Badge variant="info">{s.avg} délai moyen</Badge>
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
