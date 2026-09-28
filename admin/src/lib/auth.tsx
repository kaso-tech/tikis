import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { trpc } from "./trpc";

export type AdminRole = "super_admin" | "support" | "finance";
/**
 * `mustEnrollTotp` : la double authentification est exigée pour ce rôle et pas encore activée. Le serveur
 * refuse alors tout sauf l'enrôlement ; la console n'affiche que « Mon compte ».
 */
export type AdminIdentity = { adminId: number; email: string; role: AdminRole; totpEnabled: boolean; mustEnrollTotp: boolean };

type AuthState = {
  admin: AdminIdentity | null;
  loading: boolean;
  /** « totp_required » : mot de passe accepté, code de double authentification attendu. */
  login: (email: string, password: string) => Promise<"ok" | "totp_required">;
  verifyTotp: (code: string) => Promise<{ remainingRecoveryCodes?: number }>;
  logout: () => Promise<void>;
  /** Relit l'identité auprès du serveur (après activation de la double authentification, par exemple). */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function fetchIdentity() {
  // Le cookie httpOnly est invisible pour la page : seul le serveur sait si une session est ouverte.
  return (await trpc.adminConsole.auth.me.query()) as AdminIdentity | null;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchIdentity()
      .then(setAdmin)
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  async function refresh() {
    setAdmin(await fetchIdentity());
  }

  async function login(email: string, password: string) {
    const result = await trpc.adminConsole.auth.login.mutate({ email, password });
    if (result.status === "totp_required") return "totp_required" as const;
    await refresh();
    return "ok" as const;
  }

  async function verifyTotp(code: string) {
    const result = await trpc.adminConsole.auth.verifyTotp.mutate({ code });
    await refresh();
    return { remainingRecoveryCodes: result.remainingRecoveryCodes };
  }

  async function logout() {
    // Révoque la session côté serveur : un cookie copié ailleurs cesse aussitôt de fonctionner.
    try {
      await trpc.adminConsole.auth.logout.mutate();
    } finally {
      setAdmin(null);
    }
  }

  return <AuthContext.Provider value={{ admin, loading, login, verifyTotp, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAdminAuth doit être utilisé dans AdminAuthProvider.");
  return ctx;
}
