import { useLocation } from "react-router-dom";
import { PublicRouter } from "./PublicRouter";
import { AppRouter } from "./AppRouter";

const APP_PREFIXES = ["/mairie", "/admin", "/service"];

export function HostRouter() {
  const hostname = window.location.hostname;
  const { pathname } = useLocation();

  if (hostname === "app.heurekia.com") return <AppRouter />;
  if (hostname === "www.heurekia.com") return <PublicRouter />;

  // localhost: route by path prefix
  const isAppPath = APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  return isAppPath ? <AppRouter /> : <PublicRouter />;
}
