import { useAuth } from "../../hooks/useAuth";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/avatar";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Save, Camera } from "lucide-react";

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

export function InfosPersoAPropos() {
  const { user } = useAuth();
  const loc = useLocation();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">À propos</h1>
        <p className="text-gray-500 text-sm mt-1">Informations personnelles et coordonnées</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1">
          <Card className="border-gray-200/80">
            <CardContent className="p-6">
              <div className="flex items-center gap-6 mb-8 pb-6 border-b border-gray-100">
                <div className="relative">
                  <Avatar fallback={user ? `${user.prenom} ${user.nom}` : "U"} className="w-20 h-20 text-xl" />
                  <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-heureka-500 text-white flex items-center justify-center shadow-sm hover:bg-heureka-600">
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div>
                  <p className="text-lg font-semibold text-[#000020]">{user?.prenom} {user?.nom}</p>
                  <p className="text-sm text-gray-500 capitalize">{user?.role}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Prénom</label>
                  <Input defaultValue={user?.prenom} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Nom</label>
                  <Input defaultValue={user?.nom} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                  <Input defaultValue={user?.email} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Téléphone</label>
                  <Input defaultValue={user?.telephone ?? ""} placeholder="Votre numéro" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Adresse</label>
                  <Input defaultValue="" placeholder="Votre adresse postale" />
                </div>
              </div>
              <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
                <Button className="gap-2"><Save className="w-4 h-4" />Enregistrer</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
