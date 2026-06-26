import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Avatar } from "../../components/ui/avatar";
import { Camera, Save, Download, Trash2, AlertTriangle, X, IdCard } from "lucide-react";

export function Profil() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Profil CERFA mémorisé (RGPD — consentement révocable). consentAt = date de
  // l'opt-in ; null = aucune mémorisation. Chargé une fois à l'affichage.
  const [cerfaConsentAt, setCerfaConsentAt] = useState<string | null>(null);
  const [forgettingProfile, setForgettingProfile] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/auth/me/cerfa-profile", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { profile?: unknown; consent_at?: string | null } | null) => {
        if (alive && d && d.profile && Object.keys(d.profile).length > 0) {
          setCerfaConsentAt(d.consent_at ?? null);
        }
      })
      .catch(() => { /* non bloquant */ });
    return () => { alive = false; };
  }, []);

  const handleForgetCerfaProfile = async () => {
    setForgettingProfile(true);
    try {
      const res = await fetch("/api/auth/me/cerfa-profile", { method: "DELETE", credentials: "include" });
      if (res.ok) setCerfaConsentAt(null);
    } catch {
      // non bloquant — l'utilisateur peut réessayer
    } finally {
      setForgettingProfile(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/auth/me/export", { credentials: "include" });
      if (!res.ok) throw new Error("Erreur export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mes-donnees-heurekia-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent fail — user sees nothing happened, they can retry
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    setDeleteError("");
    setDeleting(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setDeleteError(data.error ?? "Erreur lors de la suppression");
        return;
      }
      await logout();
      navigate("/");
    } catch {
      setDeleteError("Erreur réseau, réessayez.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-[#000020]">Mon profil</h1>
        <p className="text-gray-500 text-sm mt-1">Gérez vos informations personnelles</p>
      </div>

      <Card className="border-gray-200/80 mb-6">
        <CardContent className="p-5 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 mb-6 sm:mb-8 pb-6 border-b border-gray-100">
            <div className="relative">
              <Avatar
                fallback={user ? `${user.prenom} ${user.nom}` : "U"}
                className="w-20 h-20 text-xl"
              />
              <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-heureka-500 text-white flex items-center justify-center shadow-sm hover:bg-heureka-600 transition-colors">
                <Camera className="w-3.5 h-3.5" />
              </button>
            </div>
            <div>
              <p className="text-lg font-semibold text-[#000020]">
                {user?.prenom} {user?.nom}
              </p>
              <p className="text-sm text-gray-500 capitalize">{user?.role}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Prénom</label>
              <Input defaultValue={user?.prenom} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Nom</label>
              <Input defaultValue={user?.nom} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
              <Input defaultValue={user?.email} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Téléphone</label>
              <Input defaultValue={user?.telephone ?? ""} placeholder="Votre numéro" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Adresse</label>
              <Input defaultValue="" placeholder="Votre adresse postale" />
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
            <Button className="gap-2 w-full sm:w-auto justify-center">
              <Save className="w-4 h-4" />
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* RGPD */}
      <Card className="border-gray-200/80 mb-6">
        <CardContent className="p-5 sm:p-8">
          <h2 className="text-base font-semibold text-[#000020] mb-1">Mes données personnelles (RGPD)</h2>
          <p className="text-sm text-gray-500 mb-6">
            Vous disposez de plusieurs droits sur vos données personnelles. Vous pouvez les exercer librement depuis cette page.
          </p>

          {/* Droit d'accès / portabilité */}
          <div className="rounded-lg border border-gray-200 p-4 mb-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-[#000020] mb-1">Télécharger toutes mes données</div>
                <div className="text-xs text-gray-500 leading-relaxed mb-3">
                  Export JSON conforme aux articles 15 (droit d'accès) et 20 (portabilité) du RGPD. Inclut votre profil, vos dossiers, vos pièces, vos messages, le consentement à l'analyse IA, le journal des appels IA effectués sur vos dossiers (avec empreinte SHA-256) et votre historique d'authentification.
                </div>
                <Button variant="secondary" className="gap-2" onClick={handleExport} disabled={exporting}>
                  <Download className="w-4 h-4" />
                  {exporting ? "Préparation…" : "Télécharger (JSON)"}
                </Button>
              </div>
            </div>
          </div>

          {/* Profil CERFA mémorisé — affiché seulement si une mémorisation est active */}
          {cerfaConsentAt !== null && (
            <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-4 mb-3">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[#000020] mb-1 flex items-center gap-2">
                    <IdCard className="w-4 h-4 text-violet-600" />
                    Informations mémorisées pour le pré-remplissage
                  </div>
                  <div className="text-xs text-gray-500 leading-relaxed mb-3">
                    Vous avez accepté de mémoriser votre état civil (civilité, date et lieu de naissance, qualité,
                    adresse postale) pour pré-remplir vos prochaines demandes. Ces données sont conservées chiffrées
                    et ne sont jamais transmises à des tiers. Retrait du consentement (RGPD art. 7-3) :
                  </div>
                  <Button
                    variant="secondary"
                    className="gap-2"
                    onClick={handleForgetCerfaProfile}
                    disabled={forgettingProfile}
                  >
                    <Trash2 className="w-4 h-4" />
                    {forgettingProfile ? "Suppression…" : "Oublier ces informations"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Droit à l'effacement */}
          <div className="rounded-lg border border-red-100 bg-red-50/30 p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-[#000020] mb-1">Supprimer mon compte</div>
                <div className="text-xs text-gray-500 leading-relaxed mb-3">
                  Article 17 RGPD (droit à l'effacement). Supprime irréversiblement votre profil, vos dossiers et tous les fichiers déposés (sur disque et en base). Le journal d'authentification est conservé de manière anonymisée pendant 12 mois pour des raisons de sécurité (CCSC Art. 4.14).
                </div>
                <Button
                  variant="ghost"
                  className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => { setShowDeleteModal(true); setDeletePassword(""); setDeleteError(""); }}
                >
                  <Trash2 className="w-4 h-4" />
                  Supprimer définitivement mon compte
                </Button>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-4 leading-relaxed">
            Autres droits (rectification, opposition à l'analyse IA, limitation) : modifiez vos informations ci-dessus, ou contactez le Délégué à la Protection des Données :{" "}
            <a href="mailto:dpd@heurekia.com" className="underline hover:text-gray-600">
              dpd@heurekia.com
            </a>
            . Pour les questions liées à votre dossier d'urbanisme, contactez le DPD de votre mairie.
          </p>
        </CardContent>
      </Card>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#000020]">Supprimer mon compte</h3>
                  <p className="text-xs text-gray-500">Cette action est irréversible</p>
                </div>
              </div>
              <button onClick={() => setShowDeleteModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              La suppression de votre compte entraîne la suppression définitive de toutes vos données : profil, dossiers en cours, documents et messages. Cette action <strong>ne peut pas être annulée</strong>.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Confirmez avec votre mot de passe
              </label>
              <Input
                type="password"
                placeholder="Votre mot de passe"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && deletePassword && handleDelete()}
              />
              {deleteError && (
                <p className="text-xs text-red-600 mt-1">{deleteError}</p>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
                Annuler
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white gap-2"
                onClick={handleDelete}
                disabled={!deletePassword || deleting}
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? "Suppression…" : "Supprimer définitivement"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
