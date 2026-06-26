import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { ProtectedRoute, PublicOnlyRoute } from "./guards";
import { ADMIN_BASE, adminPath } from "./adminBase";
import { AdminLogin } from "../pages/admin/AdminLogin";
import { ActiverCompte } from "../pages/public/ActiverCompte";
import { Seo } from "../components/Seo";
import { PageLoader } from "../components/PageLoader";

// SuperAdminApp pèse ~8000 lignes : on la charge à la demande pour que la page
// de login admin reste légère.
const SuperAdminApp = lazy(() => import("../pages/admin/SuperAdminApp").then((m) => ({ default: m.SuperAdminApp })));

// Portail super-admin servi sur admin.heurekia.com (et sous /admin en local).
// Session isolée : SuperAdminApp s'authentifie via le cookie `token_admin`,
// distinct de `token_app`/`token_www`. Indexation interdite (noindex).
export function AdminRouter() {
  return (
    <>
      <Seo title="Administration" noindex />
      <Routes>
        {/* Le lien d'activation doit fonctionner sur ce sous-domaine aussi. */}
        <Route path={`${ADMIN_BASE}/activer-compte`} element={<ActiverCompte />} />

        <Route
          path={`${ADMIN_BASE}/login`}
          element={<PublicOnlyRoute context="admin"><AdminLogin /></PublicOnlyRoute>}
        />

        <Route
          path={`${ADMIN_BASE}/*`}
          element={
            <ProtectedRoute roles={["admin"]} loginPath={adminPath("/login")} deniedPath={adminPath("/login")}>
              <Suspense fallback={<PageLoader />}>
                <SuperAdminApp />
              </Suspense>
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to={adminPath("/login")} replace />} />
      </Routes>
    </>
  );
}
