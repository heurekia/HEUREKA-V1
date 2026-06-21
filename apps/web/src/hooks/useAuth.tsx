import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api } from "../lib/api";

interface User {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  role: string;
  commune?: string;
  commune_insee?: string;
  telephone?: string;
  avatar_url?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
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

  const login = async (email: string, password: string) => {
    const res = await api.post<{ user: User }>("/auth/login", { email, password });
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
    <AuthContext.Provider value={{ user, loading, login, register, verifyEmail, logout, refreshUser: fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
