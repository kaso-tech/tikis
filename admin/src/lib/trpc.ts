import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";

// La session vit dans un cookie httpOnly posé par le serveur : aucun script de cette page ne peut la lire,
// donc aucune faille XSS ne peut la voler. L'ancien jeton stocké ici n'est plus accepté ; on l'efface.
const LEGACY_SESSION_KEY = "tikis_admin_session";
try {
  localStorage.removeItem(LEGACY_SESSION_KEY);
} catch {
  // Stockage indisponible (navigation privée stricte) : rien à nettoyer.
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // Le serveur n'accepte le cookie de session qu'accompagné de cet en-tête (protection CSRF).
      headers: () => ({ "x-tikis-admin": "1" }),
      // Nécessaire quand la console et l'API sont sur deux sous-domaines (admin.tikis.app → API).
      fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
    }),
  ],
});

export function isAuthError(error: unknown) {
  return error instanceof TRPCClientError && (error.data?.code === "UNAUTHORIZED" || error.data?.code === "FORBIDDEN");
}
