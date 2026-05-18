import { Card, CardContent, CardHeader } from "../../components/ui/card";

export function MessagerieCitoyen() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Messagerie</h1>
        <p className="text-gray-500 text-sm">Échangez avec les services instructeurs</p>
      </div>
      <Card>
        <CardContent className="p-8 text-center text-gray-500">
          <p>Sélectionnez une conversation pour voir les messages</p>
        </CardContent>
      </Card>
    </div>
  );
}
