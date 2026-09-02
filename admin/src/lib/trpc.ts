import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";

const SESSION_KEY = "tikis_admin_session";

export function getAdminSessionToken(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function setAdminSessionToken(token: string | null) {
  if (token) localStorage.setItem(SESSION_KEY, token);
  else localStorage.removeItem(SESSION_KEY);
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        const token = getAdminSessionToken();
        return token ? { "x-tikis-admin-session": token } : {};
      },
    }),
  ],
});

export function isAuthError(error: unknown) {
  return error instanceof TRPCClientError && (error.data?.code === "UNAUTHORIZED" || error.data?.code === "FORBIDDEN");
}
