import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api } from "../lib/api";

interface User {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  role: string;
  commune?: string;
  telephone?: string;
  avatar_url?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { email: string; password: string; prenom: string; nom: string; role?: string; commune?: string }) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<User>("/auth/me");
      setUser(me);
    } catch {
      localStorage.removeItem("token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>("/auth/login", { email, password });
    localStorage.setItem("token", res.token);
    setUser(res.user);
    return res.user;
  };

  const register = async (data: { email: string; password: string; prenom: string; nom: string; role?: string; commune?: string }) => {
    const res = await api.post<{ token: string; user: User }>("/auth/register", data);
    localStorage.setItem("token", res.token);
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
