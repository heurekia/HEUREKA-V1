import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Avatar } from "../components/ui/avatar";
import { Button } from "../components/ui/button";

const navLinks = [
  { to: "/", label: "Accueil", exact: true },
  { to: "/analyse-parcellaire", label: "Analyse parcellaire" },
  { to: "/citoyen/centre-aide", label: "Centre d'aide" },
];

export function PublicLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-heureka-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">H</span>
              </div>
              <span className="text-xl font-bold text-gray-900">HEUREKA</span>
            </Link>
            <nav className="hidden md:flex items-center gap-6">
              {navLinks.map((link) => {
                const active = link.exact
                  ? location.pathname === link.to
                  : location.pathname.startsWith(link.to);
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`text-sm font-medium transition-colors ${
                      active
                        ? "text-heureka-600"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
            <div className="flex items-center gap-3">
              {user ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">
                    {user.prenom} {user.nom}
                  </span>
                  <Link
                    to={user.role === "mairie" || user.role === "instructeur" ? "/mairie" : "/citoyen"}
                  >
                    <Button variant="secondary" size="sm">
                      Mon espace
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={logout}>
                    Déconnexion
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link to="/login">
                    <Button variant="ghost" size="sm">
                      Connexion
                    </Button>
                  </Link>
                  <Link to="/register">
                    <Button size="sm">S'inscrire</Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-gray-900 text-gray-400 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 bg-heureka-600 rounded flex items-center justify-center">
              <span className="text-white font-bold text-xs">H</span>
            </div>
            <span className="text-white font-bold">HEUREKA</span>
          </div>
          <p className="text-sm">Plateforme de démarches d'urbanisme &copy; 2026</p>
        </div>
      </footer>
    </div>
  );
}
