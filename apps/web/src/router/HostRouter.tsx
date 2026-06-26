import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { ADMIN_HOST } from "./adminBase";
import { ComingSoonGate } from "../components/ComingSoonGate";
import { PageLoader } from "../components/PageLoader";

// Code splitting par PORTAIL : chaque routeur (et tout ce qu'il importe) part
// dans un chunk distinct, chargé à la demande. Un visiteur de www ne télécharge
// plus le code de l'espace mairie ni du portail super-admin (SuperAdminApp fait
// ~8000 lignes à lui seul), et inversement.
const PublicRouter = lazy(() => import("./PublicRouter").then((m) => ({ default: m.PublicRouter })));
const AppRouter = lazy(() => import("./AppRouter").then((m) => ({ default: m.AppRouter })));
const AdminRouter = lazy(() => import("./AdminRouter").then((m) => ({ default: m.AdminRouter })));

const APP_PREFIXES = ["/mairie", "/service"];

// Le portail public (www + apex) passe par le verrou « bientôt en ligne ».
// app.heurekia.com (espaces mairie / admin / service) reste toujours ouvert —
// notamment pour que le super-admin puisse désactiver le mode.
function PublicPortal() {
  return (
    <ComingSoonGate>
      <PublicRouter />
    </ComingSoonGate>
  );
}

export function HostRouter() {
  const hostname = window.location.hostname;
  const { pathname } = useLocation();

  let portal: React.ReactNode;
  if (hostname === ADMIN_HOST) portal = <AdminRouter />;
  else if (hostname === "app.heurekia.com") portal = <AppRouter />;
  else if (hostname === "www.heurekia.com") portal = <PublicPortal />;
  // localhost: route by path prefix. Le portail admin est servi sous /admin
  // (cf. ADMIN_BASE) pour cohabiter avec www/app sur une seule origine.
  else if (pathname === "/admin" || pathname.startsWith("/admin/")) portal = <AdminRouter />;
  else {
    const isAppPath = APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
    portal = isAppPath ? <AppRouter /> : <PublicPortal />;
  }

  return <Suspense fallback={<PageLoader />}>{portal}</Suspense>;
}
