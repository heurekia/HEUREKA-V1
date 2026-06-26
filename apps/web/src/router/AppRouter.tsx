import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AdminPortalRedirect, CrossSubdomainRedirect, ProtectedRoute, PublicOnlyRoute } from "./guards";
import { ActiverCompte } from "../pages/public/ActiverCompte";
import { MairieLogin } from "../pages/mairie/MairieLogin";
import { Seo } from "../components/Seo";
import { PageLoader } from "../components/PageLoader";

// Espaces applicatifs volumineux chargés à la demande : la page de login mairie
// reste légère et ne tire pas tout MairieApp / ServiceExterneApp.
const MairieApp = lazy(() => import("../pages/mairie/MairieApp").then((m) => ({ default: m.MairieApp })));
const ServiceExterneApp = lazy(() => import("../pages/service/ServiceExterneApp").then((m) => ({ default: m.ServiceExterneApp })));

const WWW = "https://www.heurekia.com";

export function AppRouter() {
  return (
    <>
      <Seo title="Espace professionnel" noindex />
      <Suspense fallback={<PageLoader />}>
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

      {/* Le portail super-admin a migré sur admin.heurekia.com.
          On conserve une redirection pour les anciens liens/marque-pages. */}
      <Route path="/admin/*" element={<AdminPortalRedirect />} />

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
      </Suspense>
    </>
  );
}
