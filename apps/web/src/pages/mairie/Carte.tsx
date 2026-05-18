import { useState } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Search, Map, MapPin, TreePine, Tractor, Ban } from "lucide-react";

const legendItems = [
  { label: "Zone urbaine", color: "bg-blue-500", icon: MapPin },
  { label: "Zone naturelle", color: "bg-green-500", icon: TreePine },
  { label: "Zone agricole", color: "bg-yellow-500", icon: Tractor },
  { label: "Zone inconstructible", color: "bg-red-400", icon: Ban },
];

export function Carte() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Carte</h1>
        <p className="text-gray-500 text-sm mt-1">Visualisation des parcelles et zones PLU</p>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <Card className="h-[600px] border-gray-200/80 overflow-hidden">
            <CardContent className="p-0 h-full flex items-center justify-center bg-gray-100">
              <div className="text-center text-gray-400">
                <Map className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-sm font-medium">Carte interactive</p>
                <p className="text-xs mt-1">Parcelles, zones PLU et dossiers</p>
                <p className="text-xs mt-4 text-gray-300">(Intégration Leaflet à venir)</p>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="border-gray-200/80">
            <CardHeader>
              <h3 className="font-semibold text-[#000020] flex items-center gap-2">
                <Search className="w-4 h-4 text-heureka-500" />
                Recherche
              </h3>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Adresse ou parcelle..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Button className="w-full gap-2">
                <Search className="w-4 h-4" />
                Rechercher
              </Button>
            </CardContent>
          </Card>
          <Card className="border-gray-200/80">
            <CardHeader>
              <h3 className="font-semibold text-[#000020]">Légende</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {legendItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="flex items-center gap-3 text-sm">
                      <div className={`w-4 h-4 rounded ${item.color}`} />
                      <Icon className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-gray-600">{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
