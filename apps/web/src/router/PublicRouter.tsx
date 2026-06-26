import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { PublicLayout } from "../layouts/PublicLayout";
import { CitoyenLayout } from "../layouts/CitoyenLayout";
import { AdminPortalRedirect, CrossSubdomainRedirect, ProtectedRoute, PublicOnlyRoute } from "./guards";
import { Accueil } from "../pages/public/Accueil";
import { Login } from "../pages/public/Login";
import { Register } from "../pages/public/Register";
import { MentionsLegales } from "../pages/public/MentionsLegales";
import { PolitiqueConfidentialite } from "../pages/public/PolitiqueConfidentialite";
import { ActiverCompte } from "../pages/public/ActiverCompte";
import { VerifierEmail } from "../pages/public/VerifierEmail";
import { PageLoader } from "../components/PageLoader";

// Pages lourdes / espace citoyen authentifié : chargées à la demande pour ne pas
// alourdir le portail vitrine. AnalyseParcellaire embarque Leaflet (~150 Ko) :
// la sortir du bundle initial allège la home (meilleur LCP, page la plus exposée).
const AnalyseParcellaire = lazy(() => import("../pages/public/AnalyseParcellaire").then((m) => ({ default: m.AnalyseParcellaire })));
const CitoyenDashboard = lazy(() => import("../pages/citoyen/Dashboard").then((m) => ({ default: m.CitoyenDashboard })));
const MesDemandes = lazy(() => import("../pages/citoyen/MesDemandes").then((m) => ({ default: m.MesDemandes })));
const NouvelleDemandeWizard = lazy(() => import("../pages/citoyen/NouvelleDemandeWizard").then((m) => ({ default: m.NouvelleDemandeWizard })));
const DossierDetail = lazy(() => import("../pages/citoyen/DossierDetail").then((m) => ({ default: m.DossierDetail })));
const MessagerieCitoyen = lazy(() => import("../pages/citoyen/Messagerie").then((m) => ({ default: m.MessagerieCitoyen })));
const MesDocuments = lazy(() => import("../pages/citoyen/MesDocuments").then((m) => ({ default: m.MesDocuments })));
const CentreAide = lazy(() => import("../pages/citoyen/CentreAide").then((m) => ({ default: m.CentreAide })));
const Profil = lazy(() => import("../pages/citoyen/Profil").then((m) => ({ default: m.Profil })));

const APP = "https://app.heurekia.com";

export function PublicRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
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
    </Suspense>
  );
}
