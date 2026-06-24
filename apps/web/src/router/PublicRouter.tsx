import { Routes, Route, Navigate } from "react-router-dom";
import { PublicLayout } from "../layouts/PublicLayout";
import { CitoyenLayout } from "../layouts/CitoyenLayout";
import { AdminPortalRedirect, CrossSubdomainRedirect, ProtectedRoute, PublicOnlyRoute } from "./guards";
import { Accueil } from "../pages/public/Accueil";
import { AnalyseParcellaire } from "../pages/public/AnalyseParcellaire";
import { Login } from "../pages/public/Login";
import { Register } from "../pages/public/Register";
import { MentionsLegales } from "../pages/public/MentionsLegales";
import { PolitiqueConfidentialite } from "../pages/public/PolitiqueConfidentialite";
import { ActiverCompte } from "../pages/public/ActiverCompte";
import { VerifierEmail } from "../pages/public/VerifierEmail";
import { CitoyenDashboard } from "../pages/citoyen/Dashboard";
import { MesDemandes } from "../pages/citoyen/MesDemandes";
import { NouvelleDemandeWizard } from "../pages/citoyen/NouvelleDemandeWizard";
import { DossierDetail } from "../pages/citoyen/DossierDetail";
import { MessagerieCitoyen } from "../pages/citoyen/Messagerie";
import { MesDocuments } from "../pages/citoyen/MesDocuments";
import { CentreAide } from "../pages/citoyen/CentreAide";
import { Profil } from "../pages/citoyen/Profil";

const APP = "https://app.heurekia.com";

export function PublicRouter() {
  return (
    <Routes>
      <Route path="/analyse-parcellaire" element={<AnalyseParcellaire />} />

      <Route element={<PublicLayout />}>
        <Route path="/" element={<Accueil />} />
        <Route path="/login" element={<PublicOnlyRoute context="www"><Login /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute context="www"><Register /></PublicOnlyRoute>} />
        <Route path="/mentions-legales" element={<MentionsLegales />} />
        <Route path="/politique-confidentialite" element={<PolitiqueConfidentialite />} />
        <Route path="/activer-compte" element={<ActiverCompte />} />
        <Route path="/verifier-email" element={<VerifierEmail />} />
      </Route>

      <Route path="/citoyen" element={<ProtectedRoute roles={["citoyen"]}><CitoyenLayout /></ProtectedRoute>}>
        <Route index element={<CitoyenDashboard />} />
        <Route path="mes-demandes" element={<MesDemandes />} />
        <Route path="mes-demandes/:id" element={<DossierDetail />} />
        <Route path="nouvelle-demande" element={<NouvelleDemandeWizard />} />
        <Route path="messagerie" element={<MessagerieCitoyen />} />
        <Route path="mes-documents" element={<MesDocuments />} />
        <Route path="centre-aide" element={<CentreAide />} />
        <Route path="profil" element={<Profil />} />
      </Route>

      {/* Bridge routes: redirect pro paths to app subdomain */}
      <Route path="/mairie/*" element={<CrossSubdomainRedirect to={`${APP}/mairie`} />} />
      {/* Le portail super-admin a son propre sous-domaine (admin.heurekia.com) */}
      <Route path="/admin/*" element={<AdminPortalRedirect />} />
      <Route path="/service/*" element={<CrossSubdomainRedirect to={`${APP}/service`} />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
