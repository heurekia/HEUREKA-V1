import { Routes, Route, Navigate } from "react-router-dom";
import { CrossSubdomainRedirect, ProtectedRoute, PublicOnlyRoute } from "./guards";
import { ActiverCompte } from "../pages/public/ActiverCompte";
import { MairieLogin } from "../pages/mairie/MairieLogin";
import { MairieApp } from "../pages/mairie/MairieApp";
import { SuperAdminApp } from "../pages/admin/SuperAdminApp";
import { ServiceExterneApp } from "../pages/service/ServiceExterneApp";
import { Seo } from "../components/Seo";

const WWW = "https://www.heurekia.com";

export function AppRouter() {
  return (
    <>
      <Seo title="Espace professionnel" noindex />
      <Routes>
      {/* Activation link works on both subdomains */}
      <Route path="/activer-compte" element={<ActiverCompte />} />

      {/* Bridge: /login → citizen login on www */}
      <Route path="/login" element={<CrossSubdomainRedirect to={`${WWW}/login`} />} />

      <Route path="/mairie/login" element={<PublicOnlyRoute context="app"><MairieLogin /></PublicOnlyRoute>} />

      <Route
        path="/mairie/*"
        element={
          <ProtectedRoute roles={["mairie", "instructeur", "admin"]} loginPath="/mairie/login">
            <MairieApp />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/*"
        element={
          <ProtectedRoute roles={["admin"]} loginPath="/mairie/login">
            <SuperAdminApp />
          </ProtectedRoute>
        }
      />

      <Route
        path="/service/*"
        element={
          <ProtectedRoute roles={["service_externe"]} loginPath="/mairie/login">
            <ServiceExterneApp />
          </ProtectedRoute>
        }
      />

      <Route path="/" element={<Navigate to="/mairie/login" replace />} />
      <Route path="*" element={<Navigate to="/mairie/login" replace />} />
      </Routes>
    </>
  );
}
