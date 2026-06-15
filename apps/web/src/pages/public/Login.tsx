import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Seo } from "../../components/Seo";
import { sanitizeNextParam } from "../../router/guards";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = sanitizeNextParam(searchParams.get("next"));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const u = await login(email, password);
      if (u.role === "mairie" || u.role === "instructeur") {
        navigate("/mairie", { replace: true });
      } else {
        navigate(next ?? "/citoyen", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Identifiants incorrects");
    } finally {
      setLoading(false);
    }
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
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
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
