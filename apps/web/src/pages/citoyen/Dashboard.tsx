import { useAuth } from "../../hooks/useAuth";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Link } from "react-router-dom";

export function CitoyenDashboard() {
  const { user } = useAuth();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Bonjour, {user?.prenom}</h1>
        <p className="text-gray-500">Bienvenue sur votre espace citoyen</p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="w-12 h-12 bg-heureka-100 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-heureka-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Nouvelle demande</h3>
            <p className="text-gray-600 text-sm mb-4">Déposer un permis de construire, une déclaration préalable...</p>
            <Link to="/citoyen/mes-demandes">
              <Button className="w-full">Créer une demande</Button>
            </Link>
          </CardContent>
        </Card>
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="w-12 h-12 bg-heureka-100 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-heureka-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Mes demandes</h3>
            <p className="text-gray-600 text-sm mb-4">Suivez l'avancement de vos dossiers en cours.</p>
            <Link to="/citoyen/mes-demandes">
              <Button variant="outline" className="w-full">Voir mes dossiers</Button>
            </Link>
          </CardContent>
        </Card>
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="w-12 h-12 bg-heureka-100 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-heureka-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Messagerie</h3>
            <p className="text-gray-600 text-sm mb-4">Échangez avec les services instructeurs.</p>
            <Link to="/citoyen/messagerie">
              <Button variant="outline" className="w-full">Accéder</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
