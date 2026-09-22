import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";
import { getTikisSessionToken } from "@/lib/tikis-session";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
/** kyc.submit envoie jusqu'à ~20 Mo (3 images en base64) : sur une connexion mobile lente,
 *  15 s suffit à peine à les recevoir, encore moins à les envoyer. */
const KYC_UPLOAD_TIMEOUT_MS = 60_000;

function createTimeoutSignal(input: RequestInit | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (input?.signal) {
    if (input.signal.aborted) controller.abort();
    else input.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, cancel: () => clearTimeout(timeoutId) };
}

async function authHeaders() {
  const token = await Auth.getSessionToken();
  const tikisSessionToken = await getTikisSessionToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(tikisSessionToken ? { "x-tikis-session": tikisSessionToken } : {}) };
}

function fetchWithTimeout(timeoutMs: number) {
  return (url: RequestInfo | URL, options: RequestInit | undefined) => {
    const { signal, cancel } = createTimeoutSignal(options, timeoutMs);
    return fetch(url, { ...options, credentials: "include", signal }).finally(() => cancel());
  };
}

export function createTRPCClient() {
  const base = getApiBaseUrl();
  return trpc.createClient({
    links: [
      // kyc.submit passe par sa propre route, non groupée avec le reste : le serveur (voir
      // server/_core/index.ts) ne relève la limite de charge que sur cette route précise, et une
      // limite élargie sur une requête groupée aurait couvert tout ce qui l'accompagne dans le
      // même lot. httpLink (pas de groupage) rend aussi cette requête isolable côté réseau, avec
      // son propre délai, plus généreux qu'un appel ordinaire.
      splitLink({
        condition: (op) => op.path === "kyc.submit",
        true: httpLink({
          url: `${base}/api/trpc-kyc`,
          transformer: superjson,
          headers: authHeaders,
          fetch: fetchWithTimeout(KYC_UPLOAD_TIMEOUT_MS),
        }),
        false: httpBatchLink({
          url: `${base}/api/trpc`,
          transformer: superjson,
          headers: authHeaders,
          fetch: fetchWithTimeout(DEFAULT_FETCH_TIMEOUT_MS),
        }),
      }),
    ],
  });
}
