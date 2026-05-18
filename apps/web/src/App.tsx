import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { PublicLayout } from "./layouts/PublicLayout";
import { CitoyenLayout } from "./layouts/CitoyenLayout";
import { MairieLayout } from "./layouts/MairieLayout";
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
import { MairieDashboard } from "./pages/mairie/Dashboard";
import { MairieDossiers } from "./pages/mairie/Dossiers";
import { MairieDossierDetail } from "./pages/mairie/DossierDetail";
import { Calendrier } from "./pages/mairie/Calendrier";
import { Carte } from "./pages/mairie/Carte";
import { MessagerieMairie } from "./pages/mairie/MessagerieMairie";
import { Statistiques } from "./pages/mairie/Statistiques";
import { Parametres } from "./pages/mairie/Parametres";
import { InfosPerso } from "./pages/mairie/InfosPerso";

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-4 border-heureka-600 border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-4 border-heureka-600 border-t-transparent rounded-full" /></div>;
  if (user) {
    const redirect = user.role === "mairie" || user.role === "instructeur" ? "/mairie" : "/citoyen";
    return <Navigate to={redirect} replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Accueil />} />
            <Route path="/analyse-parcellaire" element={<AnalyseParcellaire />} />
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

          <Route path="/mairie" element={<ProtectedRoute roles={["mairie", "instructeur", "admin"]}><MairieLayout /></ProtectedRoute>}>
            <Route index element={<MairieDashboard />} />
            <Route path="dossiers" element={<MairieDossiers />} />
            <Route path="dossiers/:id" element={<MairieDossierDetail />} />
            <Route path="calendrier" element={<Calendrier />} />
            <Route path="carte" element={<Carte />} />
            <Route path="messagerie" element={<MessagerieMairie />} />
            <Route path="statistiques" element={<Statistiques />} />
            <Route path="parametres" element={<Parametres />} />
            <Route path="infos-perso" element={<InfosPerso />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
