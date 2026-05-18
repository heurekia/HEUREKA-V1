import { Link } from "react-router-dom";
import { Card, CardContent } from "../../components/ui/card";
import { Users, FileText, Bell, Link2, Workflow, ChevronRight } from "lucide-react";

const settingsSections = [
  { title: "Documents", desc: "Gestion des types de documents et pièces requises", icon: FileText, to: "/mairie/parametres/documents" },
  { title: "Utilisateurs", desc: "Gérer les utilisateurs et leurs permissions", icon: Users, to: "/mairie/parametres/utilisateurs" },
  { title: "Workflow", desc: "Personnaliser le circuit d'instruction", icon: Workflow, to: "/mairie/parametres/workflow" },
  { title: "Notifications", desc: "Configurer les notifications par canal et par événement", icon: Bell, to: "/mairie/parametres/notifications" },
  { title: "Intégrations", desc: "Connecter des services externes", icon: Link2, to: "/mairie/parametres/integrations" },
];

export function Parametres() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Paramètres</h1>
        <p className="text-gray-500 text-sm mt-1">Configuration de la plateforme</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {settingsSections.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.title} to={s.to}>
              <Card className="border-gray-200/80 hover:shadow-md transition-all cursor-pointer group">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-heureka-100 flex items-center justify-center shrink-0">
                      <Icon className="w-6 h-6 text-heureka-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-[#000020] group-hover:text-heureka-600 transition-colors">{s.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">{s.desc}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-heureka-500 transition-colors mt-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
