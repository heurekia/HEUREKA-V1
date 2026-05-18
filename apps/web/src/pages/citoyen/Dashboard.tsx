import { useAuth } from "../../hooks/useAuth";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Link } from "react-router-dom";
import {
  FilePlus,
  FileText,
  MessageSquare,
  Clock,
  ArrowRight,
  Folder,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

export function CitoyenDashboard() {
  const { user } = useAuth();

  const stats = [
    {
      label: "Mes demandes",
      value: "3 en cours",
      icon: FileText,
      color: "bg-heureka-100 text-heureka-600",
      bg: "bg-heureka-50/50",
    },
    {
      label: "Messages non lus",
      value: "2 nouveaux",
      icon: MessageSquare,
      color: "bg-blue-100 text-blue-600",
      bg: "bg-blue-50/50",
    },
    {
      label: "Documents à fournir",
      value: "1 en attente",
      icon: Folder,
      color: "bg-amber-100 text-amber-600",
      bg: "bg-amber-50/50",
    },
  ];

  const quickActions = [
    {
      title: "Nouvelle demande",
      desc: "Permis de construire, déclaration préalable...",
      icon: FilePlus,
      to: "/citoyen/mes-demandes",
      color: "bg-heureka-500 text-white",
    },
    {
      title: "Consulter mes dossiers",
      desc: "Suivez l'avancement de vos dossiers",
      icon: FileText,
      to: "/citoyen/mes-demandes",
      color: "bg-blue-500 text-white",
    },
    {
      title: "Messagerie",
      desc: "Échangez avec les services instructeurs",
      icon: MessageSquare,
      to: "/citoyen/messagerie",
      color: "bg-emerald-500 text-white",
    },
  ];

  const recentActivity = [
    {
      label: "Dernière connexion",
      value: "Aujourd'hui à 09:24",
      icon: Clock,
    },
    {
      label: "Dossiers actifs",
      value: "3 en cours",
      icon: FileText,
      status: "success" as const,
    },
    {
      label: "Notifications",
      value: "2 non lues",
      icon: AlertCircle,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#000020]">
          Bonjour, {user?.prenom}
        </h1>
        <p className="text-gray-500 mt-1">
          Bienvenue sur votre espace citoyen
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
        {stats.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="border-gray-200/80 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-11 h-11 rounded-xl ${item.color} flex items-center justify-center`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <CheckCircle className="w-5 h-5 text-green-400" />
                </div>
                <p className="text-2xl font-bold text-[#000020]">{item.value}</p>
                <p className="text-sm text-gray-500 mt-1">{item.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <h2 className="text-lg font-semibold text-[#000020] mb-5">
        Actions rapides
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.title} to={action.to}>
              <Card className="hover:shadow-lg transition-all border-gray-200/80 group h-full">
                <CardContent className="p-6 flex flex-col items-start gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${action.color}`}
                  >
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-[#000020] group-hover:text-heureka-600 transition-colors">
                      {action.title}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">{action.desc}</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-heureka-500 transition-colors" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {recentActivity.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="border-gray-200/80">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="text-sm font-semibold text-[#000020]">{item.value}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
