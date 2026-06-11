import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Seo } from "../../components/Seo";
import { sanitizeNextParam } from "../../router/guards";

export function Register() {
  const [form, setForm] = useState({ email: "", password: "", prenom: "", nom: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = sanitizeNextParam(searchParams.get("next"));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(form);
      navigate(next ?? "/citoyen", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'inscription");
    } finally {
      setLoading(false);
    }
  };

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Seo title="Créer un compte" path="/register" noindex />
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
              Créez votre compte pour déposer votre demande — c'est gratuit et rapide.
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900">Créer mon compte</h1>
          <p className="text-gray-500 text-sm">Gratuit · Aucun engagement</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
                <Input value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required placeholder="Marie" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
                <Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required placeholder="Dupont" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required placeholder="vous@exemple.fr" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required placeholder="Minimum 8 caractères" minLength={8} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Création du compte..." : "Créer mon compte →"}
            </Button>
            <p className="text-center text-xs text-gray-400">
              En créant un compte, vous acceptez nos{" "}
              <Link to="/mentions-legales" className="underline hover:text-gray-600">conditions d'utilisation</Link>.
            </p>
          </form>
          <p className="text-center text-sm text-gray-500 mt-4">
            Déjà un compte ?{" "}
            <Link to={loginHref} className="text-heureka-600 font-medium hover:underline">
              Se connecter
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
