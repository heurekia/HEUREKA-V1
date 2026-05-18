import { useAuth } from "../../hooks/useAuth";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Avatar } from "../../components/ui/avatar";
import { Camera, Save } from "lucide-react";

export function Profil() {
  const { user } = useAuth();

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#000020]">Mon profil</h1>
        <p className="text-gray-500 text-sm mt-1">Gérez vos informations personnelles</p>
      </div>

      <Card className="border-gray-200/80 mb-6">
        <CardContent className="p-8">
          <div className="flex items-center gap-6 mb-8 pb-6 border-b border-gray-100">
            <div className="relative">
              <Avatar
                fallback={user ? `${user.prenom} ${user.nom}` : "U"}
                className="w-20 h-20 text-xl"
              />
              <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-heureka-500 text-white flex items-center justify-center shadow-sm hover:bg-heureka-600 transition-colors">
                <Camera className="w-3.5 h-3.5" />
              </button>
            </div>
            <div>
              <p className="text-lg font-semibold text-[#000020]">
                {user?.prenom} {user?.nom}
              </p>
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
            <Button className="gap-2">
              <Save className="w-4 h-4" />
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
