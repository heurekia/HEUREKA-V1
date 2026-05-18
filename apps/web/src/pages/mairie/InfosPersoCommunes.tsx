import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Building2, Plus, Check } from "lucide-react";

const subNav = [
  { to: "/mairie/infos-perso", label: "Infos personnelles" },
  { to: "/mairie/infos-perso/a-propos", label: "À propos" },
  { to: "/mairie/infos-perso/communes", label: "Communes & Rôles" },
  { to: "/mairie/infos-perso/delegations", label: "Délégations" },
  { to: "/mairie/infos-perso/disponibilites", label: "Disponibilités" },
  { to: "/mairie/infos-perso/modeles", label: "Mes modèles" },
  { to: "/mairie/infos-perso/signatures", label: "Mes signatures" },
  { to: "/mairie/infos-perso/notifications", label: "Notifications" },
  { to: "/mairie/infos-perso/preferences", label: "Préférences" },
  { to: "/mairie/infos-perso/securite", label: "Sécurité & Connexion" },
  { to: "/mairie/infos-perso/centre-aide", label: "Centre d'aide" },
];

const communes = [
  { name: "Tours", role: "Instructeur", active: true },
  { name: "Rochecorbon", role: "Mairie", active: false },
];

export function InfosPersoCommunes() {
  const loc = useLocation();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Communes & Rôles</h1>
        <p className="text-gray-500 text-sm mt-1">Gérer vos communes de rattachement</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Ajouter une commune</Button>
          </div>
          {communes.map((c) => (
            <Card key={c.name} className="border-gray-200/80">
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-heureka-100 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-heureka-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#000020]">{c.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{c.role}</p>
                  </div>
                </div>
                <Badge variant={c.active ? "success" : "default"} className="flex items-center gap-1">
                  {c.active && <Check className="w-3 h-3" />}
                  {c.active ? "Active" : "Inactive"}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
