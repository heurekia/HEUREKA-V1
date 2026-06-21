import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Seo } from "../../components/Seo";
import { sanitizeNextParam } from "../../router/guards";
import { CheckCircle, MailCheck } from "lucide-react";

// Mêmes règles que la politique appliquée côté API (auth.ts → passwordPolicyErrors)
// et que l'écran d'activation (ActiverCompte.tsx).
const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "12 caractères minimum", test: (p) => p.length >= 12 },
  { label: "Une lettre majuscule", test: (p) => /[A-Z]/.test(p) },
  { label: "Une lettre minuscule", test: (p) => /[a-z]/.test(p) },
  { label: "Un chiffre", test: (p) => /[0-9]/.test(p) },
  { label: "Un caractère spécial (!@#$%…)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function Register() {
  const [form, setForm] = useState({ email: "", password: "", prenom: "", nom: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const { register } = useAuth();
  const [searchParams] = useSearchParams();
  const next = sanitizeNextParam(searchParams.get("next"));

  const passwordOk = RULES.every((r) => r.test(form.password));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordOk) {
      setError("Votre mot de passe ne respecte pas les critères de sécurité.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await register(form);
      setSubmittedEmail(res.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'inscription");
    } finally {
      setLoading(false);
    }
  };

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  // Écran de confirmation après inscription : le compte est créé mais inactif
  // tant que l'email n'est pas confirmé.
  if (submittedEmail) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Seo title="Confirmez votre email" path="/register" noindex />
        <Card className="w-full max-w-md">
          <CardContent className="py-10 text-center">
            <div className="w-14 h-14 bg-heureka-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <MailCheck className="w-7 h-7 text-heureka-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Vérifiez votre boîte mail</h1>
            <p className="text-gray-600 text-sm leading-relaxed mb-1">
              Nous avons envoyé un lien de confirmation à
            </p>
            <p className="text-gray-900 font-medium mb-5">{submittedEmail}</p>
            <p className="text-gray-500 text-sm leading-relaxed mb-6">
              Cliquez sur le lien reçu pour activer votre compte et accéder à votre espace.
              Le lien est valable 24 heures. Pensez à vérifier vos spams.
            </p>
            <Link to={loginHref}>
              <Button variant="secondary" className="w-full">Retour à la connexion</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

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
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required placeholder="12 caractères minimum" autoComplete="new-password" />
              {form.password.length > 0 && (
                <div className="mt-2 grid grid-cols-1 gap-1">
                  {RULES.map((rule) => {
                    const ok = rule.test(form.password);
                    return (
                      <div key={rule.label} className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${ok ? "bg-green-100" : "bg-gray-200"}`}>
                          {ok && <CheckCircle className="w-3 h-3 text-green-600" />}
                        </div>
                        <span className={`text-xs ${ok ? "text-green-700 font-medium" : "text-gray-500"}`}>{rule.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={loading || !passwordOk}>
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
