import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Avatar } from "../components/ui/avatar";
import { Button } from "../components/ui/button";
import { sanitizeNextParam } from "../router/guards";

const navLinks = [
  { to: "/", label: "Accueil", exact: true },
  { to: "/comment-ca-marche", label: "Comment ça marche ?" },
  { to: "/aide", label: "Aide" },
  { to: "/actualites", label: "Actualités" },
];

export function PublicLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  // Conserve la destination en cours (?next=/citoyen/nouvelle-demande…) sur les
  // boutons « Se connecter » / « Créer un compte » de l'en-tête : sans cela, un
  // pétitionnaire engagé dans un dépôt qui clique ici repart sans next et
  // atterrit sur l'accueil de l'espace au lieu de revenir à sa démarche.
  const next = sanitizeNextParam(new URLSearchParams(location.search).get("next"));
  const authSuffix = next ? `?next=${encodeURIComponent(next)}` : "";
  const loginHref = `/login${authSuffix}`;
  const registerHref = `/register${authSuffix}`;

  return (
    <div className="min-h-screen bg-[#F0F0F0] flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-7 h-7 bg-heureka-500 rounded flex items-center justify-center">
                <span className="text-white font-bold text-xs">H</span>
              </div>
              <span className="text-lg font-bold text-[#000020]">HEUREKIA</span>
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
                        ? "text-heureka-500"
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
                  <Button variant="ghost" size="sm" onClick={() => void logout()}>
                    Déconnexion
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link to={loginHref}>
                    <Button variant="ghost" size="sm">
                      Se connecter
                    </Button>
                  </Link>
                  <Link to={registerHref}>
                    <Button size="sm">
                      Créer un compte
                    </Button>
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

      <footer className="bg-white border-t border-gray-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 bg-heureka-500 rounded flex items-center justify-center">
                <span className="text-white font-bold text-[10px]">H</span>
              </div>
              <span className="text-sm text-gray-500">© {new Date().getFullYear()} Heurekia</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <Link to="/mentions-legales" className="hover:text-gray-900">Mentions légales</Link>
              <Link to="/politique-confidentialite" className="hover:text-gray-900">Politique de confidentialité</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
