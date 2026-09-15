import { TRPCClientError } from "@trpc/client";

/** Détecte un rejet tRPC de code UNAUTHORIZED, quelle que soit la forme sous laquelle l'erreur
 *  parvient à l'appelant (TRPCClientError typé, ou déjà "dépaquetée" par un point d'entrée
 *  intermédiaire). Module séparé de session-expiry-guard.tsx (qui importe expo-router et React
 *  Native) pour rester testable en isolation, sans dépendance UI. */
export function isUnauthorizedTrpcError(error: unknown): boolean {
  if (error instanceof TRPCClientError) return error.data?.code === "UNAUTHORIZED";
  return Boolean(error && typeof error === "object" && (error as { data?: { code?: string } }).data?.code === "UNAUTHORIZED");
}
