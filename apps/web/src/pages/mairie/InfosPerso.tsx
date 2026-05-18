import { useAuth } from "../../hooks/useAuth";
import { Card, CardContent, CardHeader } from "../../components/ui/card";

const menuItems = [
  { title: "À propos", desc: "Informations personnelles et coordonnées" },
  { title: "Communes & Rôles", desc: "Gérer vos communes de rattachement" },
  { title: "Délégations", desc: "Configurer vos délégations" },
  { title: "Disponibilités", desc: "Définir vos horaires de travail" },
  { title: "Mes modèles", desc: "Gérer vos modèles de documents" },
  { title: "Mes signatures", desc: "Gérer vos signatures électroniques" },
  { title: "Notifications", desc: "Préférences de notification" },
  { title: "Préférences", desc: "Langue, fuseau horaire, etc." },
  { title: "Sécurité & Connexion", desc: "Mot de passe, 2FA, sessions" },
  { title: "Centre d'aide", desc: "Assistance et documentation" },
];

export function InfosPerso() {
  const { user } = useAuth();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Informations personnelles</h1>
        <p className="text-gray-500 text-sm">Gérez votre profil et vos préférences</p>
      </div>

      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-heureka-100 rounded-full flex items-center justify-center">
              <span className="text-2xl font-bold text-heureka-600">{user?.prenom?.charAt(0)}{user?.nom?.charAt(0)}</span>
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-900">{user?.prenom} {user?.nom}</p>
              <p className="text-sm text-gray-500">{user?.email}</p>
              <p className="text-sm text-gray-500 capitalize">{user?.role}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {menuItems.map((item) => (
          <Card key={item.title} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-4">
              <h3 className="font-medium text-gray-900">{item.title}</h3>
              <p className="text-sm text-gray-500">{item.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
