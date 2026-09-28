/**
 * Rôles de la console d'administration et ce que chacun peut faire.
 *
 * Les rôles complets (super_admin, support, finance) sont encadrés procédure par procédure
 * (`requireTikisseAdminRole` dans server/admin-router.ts). Les deux rôles restreints sont encadrés ici, une
 * fois pour toutes, dans le middleware commun (server/_core/trpc.ts) : une procédure ajoutée plus tard leur
 * reste fermée par défaut, sans qu'il faille penser à les exclure.
 *
 *  - `viewer` (lecture seule) : consulte ce que la console montre à tous, ne modifie rien — hormis son
 *    propre compte (mot de passe, double authentification, sessions).
 *  - `kyc_reviewer` (KYC seul) : ne voit que les vérifications d'identité, et son propre compte.
 */
export const ADMIN_ROLES = ["super_admin", "support", "finance", "viewer", "kyc_reviewer"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super admin",
  support: "Support",
  finance: "Finance",
  viewer: "Lecture seule",
  kyc_reviewer: "KYC seul",
};

/** Procédures du compte de l'admin lui-même : ouvertes à tous les rôles. */
export const OWN_ACCOUNT_PATH_PREFIX = "auth.";

export function isAdminPathAllowed(role: AdminRole, path: string, type: "query" | "mutation" | "subscription"): boolean {
  if (path.startsWith(OWN_ACCOUNT_PATH_PREFIX)) return true;
  if (role === "kyc_reviewer") return path.startsWith("kyc.");
  if (role === "viewer") return type === "query";
  return true;
}
