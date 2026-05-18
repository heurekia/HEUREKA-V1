import { Card, CardContent, CardHeader } from "../../components/ui/card";

export function MessagerieMairie() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Messagerie</h1>
        <p className="text-gray-500 text-sm">Communications avec les citoyens et services</p>
      </div>
      <div className="grid lg:grid-cols-3 gap-6 h-[600px]">
        <Card className="lg:col-span-1">
          <CardContent className="p-0">
            <div className="p-4 border-b border-gray-100">
              <input
                placeholder="Rechercher..."
                className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-heureka-500"
              />
            </div>
            <div className="divide-y divide-gray-100 overflow-y-auto h-[500px]">
              <div className="p-4 hover:bg-gray-50 cursor-pointer bg-heureka-50">
                <p className="text-sm font-medium text-gray-900">Dossier PC-2024-001</p>
                <p className="text-xs text-gray-500 mt-1">Nouveau message du citoyen...</p>
                <p className="text-xs text-gray-400 mt-1">Il y a 2h</p>
              </div>
              <div className="p-4 hover:bg-gray-50 cursor-pointer">
                <p className="text-sm font-medium text-gray-900">Dossier DP-2024-042</p>
                <p className="text-xs text-gray-500 mt-1">Demande de document complémentaire...</p>
                <p className="text-xs text-gray-400 mt-1">Il y a 1j</p>
              </div>
              <div className="p-4 hover:bg-gray-50 cursor-pointer">
                <p className="text-sm font-medium text-gray-900">Service Urbanisme</p>
                <p className="text-xs text-gray-500 mt-1">Réunion commission jeudi prochain...</p>
                <p className="text-xs text-gray-400 mt-1">Il y a 3j</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent className="p-8 text-center text-gray-500 flex flex-col items-center justify-center h-full">
            <svg className="w-12 h-12 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <p>Sélectionnez une conversation</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
