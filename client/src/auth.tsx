import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  /** Call when any request answers 401: the session is gone, so the guard sends the user to /login. */
  sessionEnded: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: User }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: User }>("/auth/login", { method: "POST", body: { email, password } });
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
    setUser(null);
  }, []);

  const sessionEnded = useCallback(() => setUser(null), []);

  const value = useMemo(() => ({ user, loading, login, logout, sessionEnded }), [user, loading, login, logout, sessionEnded]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
