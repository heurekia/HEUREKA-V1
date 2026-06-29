import { Link, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";
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
  Menu,
  X,
} from "lucide-react";

const navLinks = [
  { to: "/citoyen", label: "Accueil", icon: LayoutDashboard },
  { to: "/citoyen/mes-demandes", label: "Mes demandes", icon: FileText },
  { to: "/citoyen/messagerie", label: "Messagerie", icon: MessageSquare },
  { to: "/citoyen/mes-documents", label: "Mes documents", icon: Folder },
  { to: "/citoyen/centre-aide", label: "Centre d'aide", icon: HelpCircle },
  { to: "/citoyen/profil", label: "Profil", icon: User },
];

// 5 entrées prioritaires pour la bottom-nav mobile (le Centre d'aide reste accessible via le drawer)
const bottomNavLinks = [
  { to: "/citoyen", label: "Accueil", icon: LayoutDashboard },
  { to: "/citoyen/mes-demandes", label: "Demandes", icon: FileText },
  { to: "/citoyen/messagerie", label: "Messages", icon: MessageSquare },
  { to: "/citoyen/mes-documents", label: "Docs", icon: Folder },
  { to: "/citoyen/profil", label: "Profil", icon: User },
];

function isActive(pathname: string, to: string) {
  return to === "/citoyen" ? pathname === "/citoyen" : pathname.startsWith(to);
}

export function CitoyenLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className="min-h-screen bg-[#F0F0F0] lg:flex">
      {/* ── Header mobile (< lg) ─────────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-30 bg-[#000020] text-white flex items-center justify-between px-3 h-12 shadow-sm">
        <Link to="/citoyen" className="flex items-center gap-2">
          <div className="w-7 h-7 bg-heureka-500 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-xs">H</span>
          </div>
          <span className="text-sm font-bold">HEUREKIA</span>
        </Link>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Ouvrir le menu"
          className="p-2 -mr-2 text-white/80 hover:text-white"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* ── Sidebar desktop (≥ lg) ───────────────────────────── */}
      <aside className="hidden lg:flex w-60 bg-[#000020] flex-col shrink-0">
        <div className="p-4 border-b border-white/10">
          <Link to="/citoyen" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-heureka-500 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-xs">H</span>
            </div>
            <span className="text-base font-bold text-white">HEUREKIA</span>
          </Link>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const active = isActive(location.pathname, link.to);
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
              onClick={() => void logout()}
              className="text-white/40 hover:text-white transition-colors"
              title="Déconnexion"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* Liens RGPD — toujours accessibles depuis l'espace connecté (CNIL recommandation) */}
          <div className="mt-3 pt-3 border-t border-white/5 flex flex-col gap-1 text-[10px] text-white/40">
            <Link to="/mentions-legales" className="hover:text-white/80 transition-colors">Mentions légales</Link>
            <Link to="/politique-confidentialite" className="hover:text-white/80 transition-colors">Politique de confidentialité</Link>
          </div>
        </div>
      </aside>

      {/* ── Drawer mobile (overlay + panel) ──────────────────── */}
      {drawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}
      <aside
        className={`lg:hidden fixed top-0 left-0 z-50 h-full w-64 bg-[#000020] flex flex-col shadow-xl transition-transform duration-200 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!drawerOpen}
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <Link to="/citoyen" className="flex items-center gap-2.5" onClick={closeDrawer}>
            <div className="w-8 h-8 bg-heureka-500 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-xs">H</span>
            </div>
            <span className="text-base font-bold text-white">HEUREKIA</span>
          </Link>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Fermer le menu"
            className="p-1 text-white/70 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const active = isActive(location.pathname, link.to);
            return (
              <Link
                key={link.to}
                to={link.to}
                onClick={closeDrawer}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
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
              onClick={() => {
                closeDrawer();
                void logout();
              }}
              className="text-white/40 hover:text-white transition-colors"
              title="Déconnexion"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="mt-3 pt-3 border-t border-white/5 flex flex-col gap-1 text-[10px] text-white/40">
            <Link to="/mentions-legales" onClick={closeDrawer} className="hover:text-white/80 transition-colors">Mentions légales</Link>
            <Link to="/politique-confidentialite" onClick={closeDrawer} className="hover:text-white/80 transition-colors">Politique de confidentialité</Link>
          </div>
        </div>
      </aside>

      {/* ── Contenu ──────────────────────────────────────────── */}
      {/* Cadre « app » sur mobile/tablette : le contenu est plafonné à 480px et
          centré, avec un fond distinct sur les côtés (visible dès que l'écran
          dépasse 480px — grands téléphones, tablettes en portrait). Au-delà de
          `lg`, l'espace mairie passe en sidebar et le cadre est désactivé : le
          rendu desktop est strictement identique à l'existant. */}
      <main className="flex-1 overflow-auto pb-16 lg:pb-0 bg-[#E2E5EA] lg:bg-transparent">
        {/* `flex flex-col` + la règle CSS `.citizen-frame > *` font remplir au
            cadre toute sa hauteur à la page rendue, même quand son contenu est
            court : pas de raccord de fond visible. Désactivé en `lg:block`
            (desktop sidebar inchangé). */}
        <div className="citizen-frame flex flex-col lg:block mx-auto w-full max-w-[480px] lg:max-w-none min-h-[calc(100vh-3rem)] lg:min-h-0 bg-[#F0F0F0] lg:bg-transparent shadow-[0_0_40px_rgba(15,23,42,0.07)] lg:shadow-none">
          <Outlet />
        </div>
      </main>

      {/* ── Bottom-nav mobile (< lg) ─────────────────────────── */}
      {/* pb-[env(safe-area-inset-bottom)] respecte la zone safe iOS */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[#000020] border-t border-white/10 flex justify-around"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {bottomNavLinks.map((link) => {
          const Icon = link.icon;
          const active = isActive(location.pathname, link.to);
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                active ? "text-heureka-400" : "text-white/60 hover:text-white"
              }`}
            >
              <Icon className="w-5 h-5" />
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
