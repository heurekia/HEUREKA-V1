import { useLocation } from "react-router-dom";
import { PublicRouter } from "./PublicRouter";
import { AppRouter } from "./AppRouter";
import { AdminRouter } from "./AdminRouter";
import { ADMIN_HOST } from "./adminBase";

const APP_PREFIXES = ["/mairie", "/service"];

export function HostRouter() {
  const hostname = window.location.hostname;
  const { pathname } = useLocation();

  if (hostname === ADMIN_HOST) return <AdminRouter />;
  if (hostname === "app.heurekia.com") return <AppRouter />;
  if (hostname === "www.heurekia.com") return <PublicRouter />;

  // localhost: route by path prefix. Le portail admin est servi sous /admin
  // (cf. ADMIN_BASE) pour cohabiter avec www/app sur une seule origine.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return <AdminRouter />;
  const isAppPath = APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  return isAppPath ? <AppRouter /> : <PublicRouter />;
}
