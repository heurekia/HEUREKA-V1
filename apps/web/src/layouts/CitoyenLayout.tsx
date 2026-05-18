import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Avatar } from "../components/ui/avatar";
import {
  LayoutDashboard,
  FileText,
  MessageSquare,
  Folder,
  HelpCircle,
  User,
  LogOut,
} from "lucide-react";

const navLinks = [
  { to: "/citoyen", label: "Accueil", icon: LayoutDashboard },
  { to: "/citoyen/mes-demandes", label: "Mes demandes", icon: FileText },
  { to: "/citoyen/messagerie", label: "Messagerie", icon: MessageSquare },
  { to: "/citoyen/mes-documents", label: "Mes documents", icon: Folder },
  { to: "/citoyen/centre-aide", label: "Centre d'aide", icon: HelpCircle },
  { to: "/citoyen/profil", label: "Profil", icon: User },
];

export function CitoyenLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#F0F0F0] flex">
      <aside className="w-60 bg-[#000020] flex flex-col shrink-0">
        <div className="p-4 border-b border-white/10">
          <Link to="/citoyen" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-heureka-500 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-xs">H</span>
            </div>
            <span className="text-base font-bold text-white">HEUREKA</span>
          </Link>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const active = link.to === "/citoyen"
              ? location.pathname === "/citoyen"
              : location.pathname.startsWith(link.to);
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                  active
                    ? "bg-heureka-500 text-white"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2.5">
            <Avatar fallback={user ? `${user.prenom} ${user.nom}` : "U"} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white truncate">
                {user?.prenom} {user?.nom}
              </p>
              <p className="text-[10px] text-white/50 truncate">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              className="text-white/40 hover:text-white transition-colors"
              title="Déconnexion"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
