import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api } from "../lib/api";

export interface User {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  role: string;
  commune?: string;
  commune_insee?: string;
  telephone?: string;
  avatar_url?: string;
  // false tant que l'agent n'a pas vu la pop-up d'onboarding (1re connexion).
  // Absent pour les comptes hors espace mairie (ex. citoyen FranceConnect).
  onboarding_completed?: boolean;
  // MFA : état d'activation et éligibilité (renseignés par /auth/me).
  mfa_enabled?: boolean;
  mfa_available?: boolean;
}

// Résultat de login : soit la session est ouverte (status "ok"), soit une 2e
// étape MFA est requise (status "mfa" + ticket à présenter à verifyMfaLogin).
export type LoginResult = { status: "ok"; user: User } | { status: "mfa"; ticket: string };

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfaLogin: (ticket: string, code: string) => Promise<User>;
  register: (data: { email: string; password: string; prenom: string; nom: string; role?: string; commune?: string }) => Promise<{ pendingVerification: boolean; email: string }>;
  verifyEmail: (token: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Pré-chauffe le cache PLU dès qu'on connaît la commune de l'utilisateur, pour
// que l'onglet Carte s'affiche instantanément (la réponse est mise en cache
// HTTP par le navigateur grâce à Cache-Control / ETag côté serveur).
function prewarmPluZones(user: User | null) {
  if (!user?.commune_insee) return;
  if (user.role !== "mairie" && user.role !== "instructeur" && user.role !== "admin") return;
  // Pas de await — feu et oublie
  fetch(`/api/mairie/plu-zones?insee_code=${encodeURIComponent(user.commune_insee)}`, {
    credentials: "include",
  }).catch(() => { /* silencieux : sera retenté quand l'utilisateur ouvrira la carte */ });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const me = await api.get<User>("/auth/me");
      setUser(me);
      prewarmPluZones(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  const login = async (email: string, password: string): Promise<LoginResult> => {
    const res = await api.post<{ user?: User; mfa_required?: boolean; mfa_ticket?: string }>("/auth/login", { email, password });
    // MFA activée : pas de session encore, on remonte le ticket pour la 2e étape.
    if (res.mfa_required && res.mfa_ticket) return { status: "mfa", ticket: res.mfa_ticket };
    if (res.user) {
      setUser(res.user);
      prewarmPluZones(res.user);
      return { status: "ok", user: res.user };
    }
    throw new Error("Réponse de connexion inattendue");
  };

  const verifyMfaLogin = async (ticket: string, code: string): Promise<User> => {
    const res = await api.post<{ user: User }>("/auth/mfa/login-verify", { mfa_ticket: ticket, code });
    setUser(res.user);
    prewarmPluZones(res.user);
    return res.user;
  };

  // L'inscription ne connecte plus l'utilisateur : il doit confirmer son email.
  // On renvoie l'état "en attente de vérification" pour que l'UI affiche
  // l'écran « consultez votre boîte mail ».
  const register = async (data: { email: string; password: string; prenom: string; nom: string; role?: string; commune?: string }) => {
    return api.post<{ pendingVerification: boolean; email: string }>("/auth/register", data);
  };

  const verifyEmail = async (token: string) => {
    const res = await api.post<{ user: User }>("/auth/verify-email", { token });
    setUser(res.user);
    prewarmPluZones(res.user);
    return res.user;
  };

  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyMfaLogin, register, verifyEmail, logout, refreshUser: fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
