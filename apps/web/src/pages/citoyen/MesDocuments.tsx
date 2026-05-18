import { Card, CardContent } from "../../components/ui/card";

export function MesDocuments() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Mes documents</h1>
        <p className="text-gray-500 text-sm">Retrouvez tous vos documents et pièces jointes</p>
      </div>
      <Card>
        <CardContent className="p-8 text-center text-gray-500">
          <p>Aucun document pour le moment</p>
        </CardContent>
      </Card>
    </div>
  );
}
