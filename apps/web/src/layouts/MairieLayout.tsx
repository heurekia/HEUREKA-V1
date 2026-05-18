import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Avatar } from "../components/ui/avatar";
import { Input } from "../components/ui/input";
import {
  LayoutDashboard,
  FileText,
  CalendarDays,
  Map,
  MessageSquare,
  BarChart3,
  Settings,
  UserCircle,
  Bell,
  LogOut,
} from "lucide-react";

const sidebarLinks = [
  { to: "/mairie", label: "Dashboard", icon: LayoutDashboard },
  { to: "/mairie/dossiers", label: "Dossiers", icon: FileText },
  { to: "/mairie/calendrier", label: "Calendrier", icon: CalendarDays },
  { to: "/mairie/carte", label: "Carte", icon: Map },
  { to: "/mairie/messagerie", label: "Messagerie", icon: MessageSquare },
  { to: "/mairie/statistiques", label: "Statistiques", icon: BarChart3 },
  { to: "/mairie/parametres", label: "Paramètres", icon: Settings },
  { to: "/mairie/infos-perso", label: "Infos personnelles", icon: UserCircle },
];

export function MairieLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#F0F0F0] flex">
      <aside className="w-52 bg-[#000020] flex flex-col shrink-0">
        <div className="p-4 border-b border-white/10">
          <Link to="/mairie" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-heureka-500 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-xs">H</span>
            </div>
            <span className="text-base font-bold text-white">HEUREKA</span>
          </Link>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {sidebarLinks.map((link) => {
            const Icon = link.icon;
            const active = link.to === "/mairie"
              ? location.pathname === "/mairie"
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
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3">
            <Avatar fallback={user ? `${user.prenom} ${user.nom}` : "U"} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">
                {user?.prenom} {user?.nom}
              </p>
              <p className="text-xs text-white/50 truncate capitalize">{user?.role}</p>
            </div>
            <button
              onClick={logout}
              className="text-white/40 hover:text-white transition-colors"
              title="Déconnexion"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="w-80">
              <Input placeholder="Rechercher un dossier..." className="bg-gray-50 border-gray-200" />
            </div>
            <div className="flex items-center gap-4">
              <button className="relative text-gray-400 hover:text-gray-600 transition-colors">
                <Bell className="w-5 h-5" />
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
