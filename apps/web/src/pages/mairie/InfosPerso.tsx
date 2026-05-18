import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { Card, CardContent } from "../../components/ui/card";
import { Avatar } from "../../components/ui/avatar";
import {
  User,
  Building2,
  Users,
  Clock,
  FileText,
  PenSquare,
  Bell,
  Globe,
  Shield,
  HelpCircle,
  ChevronRight,
} from "lucide-react";

const menuItems = [
  { title: "À propos", desc: "Informations personnelles et coordonnées", icon: User, to: "/mairie/infos-perso/a-propos" },
  { title: "Communes & Rôles", desc: "Gérer vos communes de rattachement", icon: Building2, to: "/mairie/infos-perso/communes" },
  { title: "Délégations", desc: "Configurer vos délégations", icon: Users, to: "/mairie/infos-perso/delegations" },
  { title: "Disponibilités", desc: "Définir vos horaires de travail", icon: Clock, to: "/mairie/infos-perso/disponibilites" },
  { title: "Mes modèles", desc: "Gérer vos modèles de documents", icon: FileText, to: "/mairie/infos-perso/modeles" },
  { title: "Mes signatures", desc: "Gérer vos signatures électroniques", icon: PenSquare, to: "/mairie/infos-perso/signatures" },
  { title: "Notifications", desc: "Préférences de notification", icon: Bell, to: "/mairie/infos-perso/notifications" },
  { title: "Préférences", desc: "Langue, fuseau horaire, etc.", icon: Globe, to: "/mairie/infos-perso/preferences" },
  { title: "Sécurité & Connexion", desc: "Mot de passe, 2FA, sessions", icon: Shield, to: "/mairie/infos-perso/securite" },
  { title: "Centre d'aide", desc: "Assistance et documentation", icon: HelpCircle, to: "/mairie/infos-perso/centre-aide" },
];

export function InfosPerso() {
  const { user } = useAuth();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Informations personnelles</h1>
        <p className="text-gray-500 text-sm mt-1">Gérez votre profil et vos préférences</p>
      </div>

      <Card className="border-gray-200/80 mb-6">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Avatar
              fallback={user ? `${user.prenom} ${user.nom}` : "U"}
              className="w-16 h-16 text-xl"
            />
            <div>
              <p className="text-lg font-semibold text-[#000020]">{user?.prenom} {user?.nom}</p>
              <p className="text-sm text-gray-500">{user?.email}</p>
              <p className="text-sm text-gray-500 capitalize">{user?.role}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.title} to={item.to}>
              <Card className="border-gray-200/80 hover:shadow-md transition-all cursor-pointer group">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-heureka-100 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-heureka-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-[#000020] group-hover:text-heureka-600 transition-colors">{item.title}</h3>
                      <p className="text-sm text-gray-500 truncate">{item.desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-heureka-500 transition-colors shrink-0" />
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
