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
import { MessagerieServices } from "./pages/mairie/MessagerieServices";
import { Statistiques } from "./pages/mairie/Statistiques";
import { StatistiquesDelais } from "./pages/mairie/StatistiquesDelais";
import { StatistiquesServices } from "./pages/mairie/StatistiquesServices";
import { StatistiquesTypes } from "./pages/mairie/StatistiquesTypes";
import { Parametres } from "./pages/mairie/Parametres";
import { ParametresDocuments } from "./pages/mairie/ParametresDocuments";
import { ParametresUtilisateurs } from "./pages/mairie/ParametresUtilisateurs";
import { ParametresWorkflow } from "./pages/mairie/ParametresWorkflow";
import { ParametresNotifications } from "./pages/mairie/ParametresNotifications";
import { ParametresNotificationsEvenements } from "./pages/mairie/ParametresNotificationsEvenements";
import { ParametresIntegrations } from "./pages/mairie/ParametresIntegrations";
import { InfosPerso } from "./pages/mairie/InfosPerso";
import { InfosPersoAPropos } from "./pages/mairie/InfosPersoAPropos";
import { InfosPersoCommunes } from "./pages/mairie/InfosPersoCommunes";
import { InfosPersoDelegations } from "./pages/mairie/InfosPersoDelegations";
import { InfosPersoDisponibilites } from "./pages/mairie/InfosPersoDisponibilites";
import { InfosPersoModeles } from "./pages/mairie/InfosPersoModeles";
import { InfosPersoSignatures } from "./pages/mairie/InfosPersoSignatures";
import { InfosPersoNotifications } from "./pages/mairie/InfosPersoNotifications";
import { InfosPersoPreferences } from "./pages/mairie/InfosPersoPreferences";
import { InfosPersoSecurite } from "./pages/mairie/InfosPersoSecurite";
import { InfosPersoCentreAide } from "./pages/mairie/InfosPersoCentreAide";

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
            <Route path="messagerie/services" element={<MessagerieServices />} />
            <Route path="statistiques" element={<Statistiques />} />
            <Route path="statistiques/delais" element={<StatistiquesDelais />} />
            <Route path="statistiques/services" element={<StatistiquesServices />} />
            <Route path="statistiques/types" element={<StatistiquesTypes />} />
            <Route path="parametres" element={<Parametres />} />
            <Route path="parametres/documents" element={<ParametresDocuments />} />
            <Route path="parametres/utilisateurs" element={<ParametresUtilisateurs />} />
            <Route path="parametres/workflow" element={<ParametresWorkflow />} />
            <Route path="parametres/notifications" element={<ParametresNotifications />} />
            <Route path="parametres/notifications-evenements" element={<ParametresNotificationsEvenements />} />
            <Route path="parametres/integrations" element={<ParametresIntegrations />} />
            <Route path="infos-perso" element={<InfosPerso />} />
            <Route path="infos-perso/a-propos" element={<InfosPersoAPropos />} />
            <Route path="infos-perso/communes" element={<InfosPersoCommunes />} />
            <Route path="infos-perso/delegations" element={<InfosPersoDelegations />} />
            <Route path="infos-perso/disponibilites" element={<InfosPersoDisponibilites />} />
            <Route path="infos-perso/modeles" element={<InfosPersoModeles />} />
            <Route path="infos-perso/signatures" element={<InfosPersoSignatures />} />
            <Route path="infos-perso/notifications" element={<InfosPersoNotifications />} />
            <Route path="infos-perso/preferences" element={<InfosPersoPreferences />} />
            <Route path="infos-perso/securite" element={<InfosPersoSecurite />} />
            <Route path="infos-perso/centre-aide" element={<InfosPersoCentreAide />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
