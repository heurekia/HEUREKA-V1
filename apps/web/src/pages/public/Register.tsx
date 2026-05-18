import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader } from "../../components/ui/card";

export function Register() {
  const [form, setForm] = useState({ email: "", password: "", prenom: "", nom: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(form);
      navigate("/citoyen", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'inscription");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link to="/" className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-heureka-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">H</span>
            </div>
            <span className="text-xl font-bold text-gray-900">HEUREKA</span>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Inscription</h1>
          <p className="text-gray-500 text-sm">Créez votre compte citoyen</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
                <Input value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
                <Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required />
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
              {loading ? "Inscription..." : "Créer mon compte"}
            </Button>
          </form>
          <p className="text-center text-sm text-gray-500 mt-4">
            Déjà un compte ?{" "}
            <Link to="/login" className="text-heureka-600 font-medium hover:underline">
              Se connecter
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
