import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { PublicLayout } from "./layouts/PublicLayout";
import { CitoyenLayout } from "./layouts/CitoyenLayout";
import { Accueil } from "./pages/public/Accueil";
import { AnalyseParcellaire } from "./pages/public/AnalyseParcellaire";
import { Login } from "./pages/public/Login";
import { Register } from "./pages/public/Register";
import { CitoyenDashboard } from "./pages/citoyen/Dashboard";
import { MesDemandes } from "./pages/citoyen/MesDemandes";
import { MessagerieCitoyen } from "./pages/citoyen/Messagerie";
import { MesDocuments } from "./pages/citoyen/MesDocuments";
import { CentreAide } from "./pages/citoyen/CentreAide";
import { Profil } from "./pages/citoyen/Profil";
import { MairieApp } from "./pages/mairie/MairieApp";
import { MairieLogin } from "./pages/mairie/MairieLogin";
import { SuperAdminApp } from "./pages/admin/SuperAdminApp";

function ProtectedRoute({ children, roles, loginPath = "/login" }: { children: React.ReactNode; roles?: string[]; loginPath?: string }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-4 border-heureka-600 border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to={loginPath} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-4 border-heureka-600 border-t-transparent rounded-full" /></div>;
  if (user) {
    const redirect = user.role === "citoyen" ? "/citoyen" : (user.role === "admin" && !user.commune) ? "/admin" : "/mairie";
    return <Navigate to={redirect} replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Analyse parcellaire is full-screen — lives outside PublicLayout */}
          <Route path="/analyse-parcellaire" element={<AnalyseParcellaire />} />

          {/* Mairie login — full-screen, outside PublicLayout */}
          <Route path="/mairie/login" element={<PublicOnlyRoute><MairieLogin /></PublicOnlyRoute>} />

          <Route element={<PublicLayout />}>
            <Route path="/" element={<Accueil />} />
            <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
            <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
          </Route>

          <Route path="/citoyen" element={<ProtectedRoute roles={["citoyen"]}><CitoyenLayout /></ProtectedRoute>}>
            <Route index element={<CitoyenDashboard />} />
            <Route path="mes-demandes" element={<MesDemandes />} />
            <Route path="messagerie" element={<MessagerieCitoyen />} />
            <Route path="mes-documents" element={<MesDocuments />} />
            <Route path="centre-aide" element={<CentreAide />} />
            <Route path="profil" element={<Profil />} />
          </Route>

          <Route
            path="/admin/*"
            element={
              <ProtectedRoute roles={["admin"]} loginPath="/mairie/login">
                <SuperAdminApp />
              </ProtectedRoute>
            }
          />

          <Route
            path="/mairie/*"
            element={
              <ProtectedRoute roles={["mairie", "instructeur", "admin"]} loginPath="/mairie/login">
                <MairieApp />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
