import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { FileText, Plus, Download, Trash2 } from "lucide-react";

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

export function InfosPersoModeles() {
  const loc = useLocation();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Mes modèles</h1>
        <p className="text-gray-500 text-sm mt-1">Gérer vos modèles de documents</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Nouveau modèle</Button>
          </div>
          <Card className="border-gray-200/80">
            <CardContent className="p-0 divide-y divide-gray-100">
              {["Arrêté de permis de construire", "Certificat de conformité", "Courrier de refus", "Accusé de réception"].map((m) => (
                <div key={m} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-gray-400" />
                    <span className="text-sm font-medium text-[#000020]">{m}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm"><Download className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" className="text-red-500"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
