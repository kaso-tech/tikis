import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
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

function createTimeoutSignal(input: RequestInit | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (input?.signal) {
    if (input.signal.aborted) controller.abort();
    else input.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, cancel: () => clearTimeout(timeoutId) };
}

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        transformer: superjson,
        async headers() {
          const token = await Auth.getSessionToken();
          const tikisSessionToken = await getTikisSessionToken();
          return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(tikisSessionToken ? { "x-tikis-session": tikisSessionToken } : {}) };
        },
        fetch(url, options) {
          const { signal, cancel } = createTimeoutSignal(options, DEFAULT_FETCH_TIMEOUT_MS);
          return fetch(url, { ...options, credentials: "include", signal }).finally(() => cancel());
        },
      }),
    ],
  });
}
