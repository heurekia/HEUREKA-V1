import { useLocation } from "react-router-dom";
import { PublicRouter } from "./PublicRouter";
import { AppRouter } from "./AppRouter";
import { ComingSoonGate } from "../components/ComingSoonGate";

const APP_PREFIXES = ["/mairie", "/admin", "/service"];

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

  if (hostname === "app.heurekia.com") return <AppRouter />;
  if (hostname === "www.heurekia.com") return <PublicPortal />;

  // localhost: route by path prefix
  const isAppPath = APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  return isAppPath ? <AppRouter /> : <PublicPortal />;
}
