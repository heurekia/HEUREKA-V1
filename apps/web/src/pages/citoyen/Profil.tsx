import { useAuth } from "../../hooks/useAuth";
import { Card, CardContent, CardHeader } from "../../components/ui/card";

export function Profil() {
  const { user } = useAuth();

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Mon profil</h1>
      </div>
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-500">Prénom</label>
              <p className="font-medium text-gray-900">{user?.prenom}</p>
            </div>
            <div>
              <label className="text-sm text-gray-500">Nom</label>
              <p className="font-medium text-gray-900">{user?.nom}</p>
            </div>
            <div>
              <label className="text-sm text-gray-500">Email</label>
              <p className="font-medium text-gray-900">{user?.email}</p>
            </div>
            <div>
              <label className="text-sm text-gray-500">Rôle</label>
              <p className="font-medium text-gray-900 capitalize">{user?.role}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
