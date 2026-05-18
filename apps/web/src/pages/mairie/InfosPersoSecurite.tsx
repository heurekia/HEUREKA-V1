import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Shield, Save, Smartphone, Key } from "lucide-react";

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

export function InfosPersoSecurite() {
  const loc = useLocation();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Sécurité & Connexion</h1>
        <p className="text-gray-500 text-sm mt-1">Mot de passe, 2FA, sessions</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-6">
          <Card className="border-gray-200/80">
            <CardHeader><h3 className="font-semibold text-[#000020] flex items-center gap-2"><Key className="w-4 h-4 text-heureka-500" /> Mot de passe</h3></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Mot de passe actuel</label><Input type="password" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Nouveau mot de passe</label><Input type="password" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Confirmer</label><Input type="password" /></div>
              </div>
              <div className="flex justify-end"><Button className="gap-2"><Save className="w-4 h-4" /> Changer</Button></div>
            </CardContent>
          </Card>
          <Card className="border-gray-200/80">
            <CardHeader><h3 className="font-semibold text-[#000020] flex items-center gap-2"><Smartphone className="w-4 h-4 text-heureka-500" /> Double authentification</h3></CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 mb-4">Activez la 2FA pour renforcer la sécurité de votre compte.</p>
              <Button variant="outline" className="gap-2"><Shield className="w-4 h-4" /> Activer la 2FA</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
