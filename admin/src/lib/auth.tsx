import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getAdminSessionToken, setAdminSessionToken, trpc } from "./trpc";

export type AdminRole = "super_admin" | "support" | "finance";
export type AdminIdentity = { adminId: number; email: string; role: AdminRole };

type AuthState = {
  admin: AdminIdentity | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAdminSessionToken();
    if (!token) { setLoading(false); return; }
    trpc.adminConsole.core.auth.me.query()
      .then((identity) => setAdmin(identity as AdminIdentity | null))
      .catch(() => { setAdminSessionToken(null); setAdmin(null); })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const result = await trpc.adminConsole.core.auth.login.mutate({ email, password });
    setAdminSessionToken(result.sessionToken);
    setAdmin({ adminId: result.admin.id, email: result.admin.email, role: result.admin.role as AdminRole });
  }

  function logout() {
    setAdminSessionToken(null);
    setAdmin(null);
  }

  return <AuthContext.Provider value={{ admin, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAdminAuth doit être utilisé dans AdminAuthProvider.");
  return ctx;
}
