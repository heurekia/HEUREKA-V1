import { Card, CardContent, CardHeader } from "../../components/ui/card";

const settingsSections = [
  { title: "Documents", desc: "Gestion des types de documents et pièces requises" },
  { title: "Utilisateurs", desc: "Gérer les utilisateurs et leurs permissions" },
  { title: "Workflow", desc: "Personnaliser le circuit d'instruction" },
  { title: "Notifications", desc: "Configurer les notifications par canal et par événement" },
  { title: "Intégrations", desc: "Connecter des services externes" },
];

export function Parametres() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
        <p className="text-gray-500 text-sm">Configuration de la plateforme</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {settingsSections.map((s) => (
          <Card key={s.title} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <h3 className="font-semibold text-gray-900 mb-1">{s.title}</h3>
              <p className="text-sm text-gray-500">{s.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
