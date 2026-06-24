import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ADMIN_HOST, adminPath } from "./adminBase";

const WWW = "www.heurekia.com";
const APP = "app.heurekia.com";

// N'accepte que des chemins internes ("/...") — rejette "//evil.com",
// "/\evil.com" et les URLs absolues pour éviter les open redirects.
export function sanitizeNextParam(next: string | null): string | null {
  if (!next || !next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin w-8 h-8 border-4 border-heureka-600 border-t-transparent rounded-full" />
    </div>
  );
}

// Redirects to a full URL (cross-subdomain) or an in-app path (localhost).
export function CrossSubdomainRedirect({ to }: { to: string }) {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";

  useEffect(() => {
    if (isLocal) {
      const url = new URL(to, window.location.href);
      window.location.pathname = url.pathname;
    } else {
      window.location.href = to;
    }
  }, [to, isLocal]);

  return null;
}

// Compatibilité ascendante : les anciens liens app.heurekia.com/admin/* sont
// renvoyés vers le portail dédié admin.heurekia.com en conservant le sous-chemin
// (le préfixe /admin est retiré : /admin/communes → /communes) et la query.
export function AdminPortalRedirect() {
  useEffect(() => {
    const sub = window.location.pathname.replace(/^\/admin/, "") || "/";
    window.location.href = `https://${ADMIN_HOST}${sub}${window.location.search}`;
  }, []);
  return null;
}

export function ProtectedRoute({
  children,
  roles,
  loginPath = "/login",
  deniedPath = "/",
}: {
  children: React.ReactNode;
  roles?: string[];
  loginPath?: string;
  // Destination quand l'utilisateur est connecté mais n'a pas le bon rôle.
  // Défaut "/" (comportement historique). Sur le portail admin, "/" est
  // lui-même protégé → on passe loginPath pour éviter une boucle de redirection.
  deniedPath?: string;
}) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={loginPath} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={deniedPath} replace />;
  return <>{children}</>;
}

// context="www"   → public portal (www.heurekia.com)
// context="app"   → pro portal (app.heurekia.com)
// context="admin" → super-admin portal (admin.heurekia.com)
export function PublicOnlyRoute({
  children,
  context,
}: {
  children: React.ReactNode;
  context: "www" | "app" | "admin";
}) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;

  // Portail admin (session isolée par le cookie token_admin). On ne redirige
  // que les ADMIN vers la console ; un éventuel non-admin porteur d'un
  // token_admin résiduel reste sur le formulaire (sinon ProtectedRoute le
  // renverrait ici en boucle).
  if (context === "admin") {
    if (user && user.role === "admin") return <Navigate to={adminPath()} replace />;
    return <>{children}</>;
  }

  if (user) {
    const params = new URLSearchParams(location.search);
    const next = sanitizeNextParam(params.get("next"));
    const fallback =
      user.role === "citoyen"
        ? "/citoyen"
        : user.role === "service_externe"
        ? "/service"
        : user.role === "admin" && !user.commune
        ? "/admin"
        : "/mairie";
    const dest = next ?? fallback;

    const host = window.location.hostname;
    const isCitizenDest = dest.startsWith("/citoyen") || dest === "/";

    // Cross-subdomain redirect on real subdomains
    if (host === WWW && !isCitizenDest) {
      window.location.href = `https://${APP}${dest}`;
      return null;
    }
    if (host === APP && isCitizenDest) {
      window.location.href = `https://${WWW}${dest}`;
      return null;
    }

    return <Navigate to={dest} replace />;
  }

  return <>{children}</>;
}
