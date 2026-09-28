import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { trpc } from "./trpc";

export type AdminRole = "super_admin" | "support" | "finance";
export type AdminIdentity = { adminId: number; email: string; role: AdminRole };

type AuthState = {
  admin: AdminIdentity | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Le cookie httpOnly est invisible pour la page : seul le serveur sait si une session est ouverte.
    trpc.adminConsole.auth.me.query()
      .then((identity) => setAdmin(identity as AdminIdentity | null))
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const result = await trpc.adminConsole.auth.login.mutate({ email, password });
    setAdmin({ adminId: result.admin.id, email: result.admin.email, role: result.admin.role as AdminRole });
  }

  async function logout() {
    // Révoque la session côté serveur : un cookie copié ailleurs cesse aussitôt de fonctionner.
    try {
      await trpc.adminConsole.auth.logout.mutate();
    } finally {
      setAdmin(null);
    }
  }

  return <AuthContext.Provider value={{ admin, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAdminAuth doit être utilisé dans AdminAuthProvider.");
  return ctx;
}
