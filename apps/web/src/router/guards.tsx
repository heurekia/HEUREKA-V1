import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const WWW = "www.heurekia.com";
const APP = "app.heurekia.com";

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

export function ProtectedRoute({
  children,
  roles,
  loginPath = "/login",
}: {
  children: React.ReactNode;
  roles?: string[];
  loginPath?: string;
}) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={loginPath} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// context="www" → public portal (www.heurekia.com)
// context="app" → pro portal (app.heurekia.com)
export function PublicOnlyRoute({
  children,
  context,
}: {
  children: React.ReactNode;
  context: "www" | "app";
}) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;

  if (user) {
    const params = new URLSearchParams(location.search);
    const next = params.get("next");
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
