import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute, PublicOnlyRoute } from "./guards";
import { ADMIN_BASE, adminPath } from "./adminBase";
import { AdminLogin } from "../pages/admin/AdminLogin";
import { SuperAdminApp } from "../pages/admin/SuperAdminApp";
import { ActiverCompte } from "../pages/public/ActiverCompte";
import { Seo } from "../components/Seo";

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
              <SuperAdminApp />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to={adminPath("/login")} replace />} />
      </Routes>
    </>
  );
}
