import { useState } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

export function Carte() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Carte</h1>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <Card className="h-[600px]">
            <CardContent className="p-0 h-full flex items-center justify-center bg-gray-100 rounded-xl overflow-hidden">
              <div className="text-center text-gray-400">
                <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                <p className="text-sm">Carte interactive (Leaflet à intégrer)</p>
                <p className="text-xs mt-1">Parcelles, zones PLU et dossiers</p>
              </div>
            </CardContent>
          </Card>
        </div>
        <div>
          <Card>
            <CardHeader><h3 className="font-semibold text-gray-900">Recherche</h3></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Adresse ou parcelle..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              <Button className="w-full">Rechercher</Button>
            </CardContent>
          </Card>
          <Card className="mt-4">
            <CardHeader><h3 className="font-semibold text-gray-900">Légende</h3></CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><div className="w-4 h-4 bg-blue-500 rounded" /> Zone urbaine</div>
                <div className="flex items-center gap-2"><div className="w-4 h-4 bg-green-500 rounded" /> Zone naturelle</div>
                <div className="flex items-center gap-2"><div className="w-4 h-4 bg-yellow-500 rounded" /> Zone agricole</div>
                <div className="flex items-center gap-2"><div className="w-4 h-4 bg-red-400 rounded rounded" /> Zone inconstructible</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
