import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { adminPath } from "../../router/adminBase";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";

interface TokenInfo {
  valid: boolean;
  email: string;
  prenom: string;
  type: "activation" | "reset";
}

interface Rule {
  label: string;
  test: (p: string) => boolean;
}

const RULES: Rule[] = [
  { label: "12 caractères minimum",            test: p => p.length >= 12 },
  { label: "Une lettre majuscule",              test: p => /[A-Z]/.test(p) },
  { label: "Une lettre minuscule",              test: p => /[a-z]/.test(p) },
  { label: "Un chiffre",                        test: p => /[0-9]/.test(p) },
  { label: "Un caractère spécial (!@#$%...)",  test: p => /[^A-Za-z0-9]/.test(p) },
];

function strength(password: string): number {
  return RULES.filter(r => r.test(password)).length;
}

const STRENGTH_LABEL = ["", "Très faible", "Faible", "Moyen", "Fort", "Très fort"];
const STRENGTH_COLOR = ["", "#EF4444", "#F97316", "#EAB308", "#22C55E", "#16A34A"];

export function ActiverCompte() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const token = params.get("token") ?? "";
  const isReset = params.get("mode") === "reset";

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [tokenError, setTokenError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setTokenError("Lien manquant ou invalide."); return; }
    api.get<TokenInfo>(`/auth/activate/${token}`)
      .then(d => setInfo(d))
      .catch(() => setTokenError("Ce lien est invalide ou a déjà été utilisé."));
  }, [token]);

  const score = strength(password);
  const allRulesPass = score === RULES.length;
  const matches = password === confirm;
  const canSubmit = allRulesPass && matches && password.length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await api.post<{ user: { role: string } }>("/auth/activate", { token, password });
      setDone(true);
      // Auto-redirect after 2s
      setTimeout(() => {
        const role = res.user.role;
        navigate(
          role === "citoyen" ? "/citoyen"
          : role === "admin" ? adminPath()
          : role === "service_externe" ? "/service"
          : "/mairie",
        );
      }, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'activation");
    } finally {
      setSubmitting(false);
    }
  };

  if (tokenError) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-[#000020] mb-2">Lien invalide</h1>
        <p className="text-gray-500 text-sm mb-6">{tokenError}</p>
        <Link to="/login"><Button variant="secondary">Retour à la connexion</Button></Link>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin w-8 h-8 border-4 border-heureka-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-[#000020] mb-2">Compte activé !</h1>
        <p className="text-gray-500 text-sm">Redirection vers votre espace en cours…</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#000020] mb-1">
          {isReset ? "Nouveau mot de passe" : "Activez votre compte"}
        </h1>
        <p className="text-gray-500 text-sm">
          Bonjour {info.prenom} — définissez votre mot de passe pour{" "}
          <span className="font-medium text-gray-700">{info.email}</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Mot de passe
          </label>
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Votre nouveau mot de passe"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Strength bar */}
          {password.length > 0 && (
            <div className="mt-2">
              <div className="flex gap-1 mb-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <div
                    key={i}
                    className="flex-1 h-1.5 rounded-full transition-all"
                    style={{ background: i <= score ? STRENGTH_COLOR[score] : "#E5E7EB" }}
                  />
                ))}
              </div>
              <p className="text-xs font-medium" style={{ color: STRENGTH_COLOR[score] }}>
                {STRENGTH_LABEL[score]}
              </p>
            </div>
          )}
        </div>

        {/* Rules checklist */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-1.5">
          {RULES.map(rule => {
            const ok = rule.test(password);
            return (
              <div key={rule.label} className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${ok ? "bg-green-100" : "bg-gray-200"}`}>
                  {ok && <CheckCircle className="w-3 h-3 text-green-600" />}
                </div>
                <span className={`text-xs ${ok ? "text-green-700 font-medium" : "text-gray-500"}`}>
                  {rule.label}
                </span>
              </div>
            );
          })}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Confirmer le mot de passe
          </label>
          <Input
            type={showPw ? "text" : "password"}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Répétez votre mot de passe"
            autoComplete="new-password"
          />
          {confirm.length > 0 && !matches && (
            <p className="text-xs text-red-600 mt-1">Les mots de passe ne correspondent pas</p>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {submitting ? "Activation…" : isReset ? "Enregistrer le mot de passe" : "Activer mon compte"}
        </Button>
      </form>
    </div>
  );
}
