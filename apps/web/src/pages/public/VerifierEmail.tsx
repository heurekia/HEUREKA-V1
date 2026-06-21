import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { CheckCircle, XCircle } from "lucide-react";

type State = "verifying" | "success" | "error";

export function VerifierEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { verifyEmail } = useAuth();
  const token = params.get("token") ?? "";

  const [state, setState] = useState<State>("verifying");
  const [errorMsg, setErrorMsg] = useState("");
  const [email, setEmail] = useState("");
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  // StrictMode monte les effets deux fois en dev → le token (usage unique)
  // serait consommé deux fois. On garde une garde pour ne vérifier qu'une fois.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState("error");
      setErrorMsg("Lien manquant ou invalide.");
      return;
    }
    verifyEmail(token)
      .then((u) => {
        setState("success");
        setTimeout(() => navigate(u.role === "citoyen" ? "/citoyen" : "/", { replace: true }), 1800);
      })
      .catch((err) => {
        setState("error");
        setErrorMsg(err instanceof Error ? err.message : "Ce lien est invalide ou a déjà été utilisé.");
      });
  }, [token, verifyEmail, navigate]);

  const handleResend = async () => {
    setResendState("sending");
    try {
      await api.post("/auth/resend-verification", { email });
    } catch {
      /* réponse opaque côté API */
    }
    setResendState("sent");
  };

  if (state === "verifying") {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin w-8 h-8 border-4 border-heureka-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-[#000020] mb-2">Adresse confirmée !</h1>
        <p className="text-gray-500 text-sm">Redirection vers votre espace en cours…</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
      <h1 className="text-xl font-bold text-[#000020] mb-2">Lien invalide</h1>
      <p className="text-gray-500 text-sm mb-6">{errorMsg}</p>

      {resendState === "sent" ? (
        <p className="text-sm text-green-700">Un nouveau lien vous a été envoyé. Vérifiez votre boîte mail.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Renvoyer un lien de confirmation :</p>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@exemple.fr"
          />
          <Button className="w-full" onClick={handleResend} disabled={resendState === "sending" || !email}>
            {resendState === "sending" ? "Envoi…" : "Renvoyer le lien"}
          </Button>
        </div>
      )}

      <div className="mt-6">
        <Link to="/login"><Button variant="secondary">Retour à la connexion</Button></Link>
      </div>
    </div>
  );
}
