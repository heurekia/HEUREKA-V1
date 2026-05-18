import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Save, Clock } from "lucide-react";

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

const days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

export function InfosPersoDisponibilites() {
  const loc = useLocation();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Disponibilités</h1>
        <p className="text-gray-500 text-sm mt-1">Définir vos horaires de travail</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-6">
          <Card className="border-gray-200/80">
            <CardContent className="p-0 divide-y divide-gray-100">
              {days.map((day) => (
                <div key={day} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-[#000020] w-24">{day}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span>09:00</span>
                    <span className="text-gray-300">—</span>
                    <span>12:30</span>
                    <span className="text-gray-300 mx-2">|</span>
                    <span>14:00</span>
                    <span className="text-gray-300">—</span>
                    <span>17:30</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Button className="gap-2"><Save className="w-4 h-4" /> Enregistrer</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
