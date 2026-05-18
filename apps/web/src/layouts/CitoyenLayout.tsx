import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Avatar } from "../components/ui/avatar";
import { Button } from "../components/ui/button";

const navLinks = [
  { to: "/citoyen", label: "Accueil" },
  { to: "/citoyen/mes-demandes", label: "Mes demandes" },
  { to: "/citoyen/messagerie", label: "Messagerie" },
  { to: "/citoyen/mes-documents", label: "Mes documents" },
  { to: "/citoyen/centre-aide", label: "Centre d'aide" },
];

export function CitoyenLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
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
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`text-sm font-medium transition-colors ${
                    location.pathname === link.to
                      ? "text-heureka-600"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-3">
              {user ? (
                <div className="flex items-center gap-3">
                  <Link to="/citoyen/profil">
                    <Avatar fallback={`${user.prenom} ${user.nom}`} />
                  </Link>
                  <Button variant="ghost" size="sm" onClick={logout}>
                    Déconnexion
                  </Button>
                </div>
              ) : (
                <Link to="/login">
                  <Button size="sm">Connexion</Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
