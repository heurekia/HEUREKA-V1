import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Save, Globe } from "lucide-react";

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

export function InfosPersoPreferences() {
  const loc = useLocation();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Préférences</h1>
        <p className="text-gray-500 text-sm mt-1">Langue, fuseau horaire, etc.</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1">
          <Card className="border-gray-200/80">
            <CardHeader><h3 className="font-semibold text-[#000020] flex items-center gap-2"><Globe className="w-4 h-4 text-heureka-500" /> Préférences générales</h3></CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Langue</label>
                  <select className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm">
                    <option>Français</option>
                    <option>English</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Fuseau horaire</label>
                  <select className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm">
                    <option>Europe/Paris (UTC+1)</option>
                    <option>Europe/London (UTC+0)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Format de date</label>
                  <select className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm">
                    <option>JJ/MM/AAAA</option>
                    <option>MM/JJ/AAAA</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre d'éléments par page</label>
                  <select className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm">
                    <option>20</option>
                    <option>50</option>
                    <option>100</option>
                  </select>
                </div>
              </div>
              <div className="pt-4 border-t border-gray-100 flex justify-end">
                <Button className="gap-2"><Save className="w-4 h-4" /> Enregistrer</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
