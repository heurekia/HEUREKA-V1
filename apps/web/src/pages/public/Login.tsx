import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Seo } from "../../components/Seo";
import { sanitizeNextParam } from "../../router/guards";
import { api, ApiError } from "../../lib/api";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Affiché quand la connexion échoue car l'email n'est pas confirmé : permet
  // de renvoyer le lien de vérification.
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [fcEnabled, setFcEnabled] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = sanitizeNextParam(searchParams.get("next"));

  // Erreur renvoyée par le callback FranceConnect (?fc_error=...).
  const fcError = searchParams.get("fc_error");
  useEffect(() => {
    if (fcError) setError(fcError);
  }, [fcError]);

  // Le bouton FranceConnect n'apparaît que si le serveur est configuré
  // (client_id / client_secret présents côté API).
  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/auth/franceconnect/status")
      .then((s) => setFcEnabled(s.enabled))
      .catch(() => setFcEnabled(false));
  }, []);

  const franceConnectHref = next
    ? `/api/auth/franceconnect/login?next=${encodeURIComponent(next)}`
    : "/api/auth/franceconnect/login";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNeedsVerification(false);
    setLoading(true);
    try {
      const u = await login(email, password);
      if (u.role === "mairie" || u.role === "instructeur") {
        navigate("/mairie", { replace: true });
      } else {
        navigate(next ?? "/citoyen", { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError && (err.body as { code?: string })?.code === "email_not_verified") {
        setNeedsVerification(true);
      }
      setError(err instanceof Error ? err.message : "Identifiants incorrects");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendState("sending");
    try {
      await api.post("/auth/resend-verification", { email });
    } catch {
      /* réponse volontairement opaque côté API — on confirme dans tous les cas */
    }
    setResendState("sent");
  };

  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : "/register";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Seo title="Connexion" path="/login" noindex />
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link to="/" className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-heureka-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">H</span>
            </div>
            <span className="text-xl font-bold text-gray-900">HEUREKIA</span>
          </Link>
          {next && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 mb-2 text-sm text-indigo-700">
              Connectez-vous pour continuer votre démarche.
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900">Connexion</h1>
          <p className="text-gray-500 text-sm">Accédez à votre espace personnel</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
                <p>{error}</p>
                {needsVerification && (
                  resendState === "sent" ? (
                    <p className="mt-2 text-red-600">Lien renvoyé. Consultez votre boîte mail (et vos spams).</p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendState === "sending" || !email}
                      className="mt-2 font-medium text-heureka-700 underline hover:text-heureka-800 disabled:opacity-50"
                    >
                      {resendState === "sending" ? "Envoi…" : "Renvoyer le lien de confirmation"}
                    </button>
                  )
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="vous@exemple.fr" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="········" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Connexion..." : "Se connecter"}
            </Button>
          </form>

          {fcEnabled && (
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-gray-400">ou</span>
                </div>
              </div>
              {/* Lien (navigation pleine page, pas fetch) : le flux OIDC repose
                  sur des redirections navigateur + cookies de session. */}
              <a
                href={franceConnectHref}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                S'identifier avec
                <span className="font-bold text-[#000091]">FranceConnect</span>
              </a>
              <p className="mt-2 text-center text-xs text-gray-400">
                FranceConnect est la solution proposée par l'État pour sécuriser et
                simplifier la connexion à vos services en ligne.
              </p>
            </div>
          )}

          <p className="text-center text-sm text-gray-500 mt-4">
            Pas encore de compte ?{" "}
            <Link to={registerHref} className="text-heureka-600 font-medium hover:underline">
              S'inscrire gratuitement
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
