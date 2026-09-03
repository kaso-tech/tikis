import { useEffect, useState } from "react";
import { Platform } from "react-native";

export type NetworkStatus = "online" | "offline" | "unknown";

type NavigatorWithConnection = Navigator & {
  connection?: { effectiveType?: string };
  onLine?: boolean;
};

const HEALTHCHECK_INTERVAL_MS = 20_000;
const HEALTHCHECK_TIMEOUT_MS = 4_000;

function readBrowserOnline(): NetworkStatus {
  if (Platform.OS !== "web") return "unknown";
  if (typeof navigator === "undefined") return "unknown";
  const nav = navigator as NavigatorWithConnection;
  if (typeof nav.onLine === "boolean") return nav.onLine ? "online" : "offline";
  return "unknown";
}

async function pingHealthcheck(): Promise<boolean> {
  if (Platform.OS !== "web") return true;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);
    const response = await fetch("/api/health", { method: "HEAD", signal: controller.signal, credentials: "include" });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/** État réseau de l'app, multi-source :
 *  - web : navigator.onLine + event online/offline + ping périodique /api/health
 *  - mobile : on retourne "online" par défaut (Expo Go) ; un build natif pourra brancher NetInfo plus tard. */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => readBrowserOnline());

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const update = (next: NetworkStatus) => setStatus(next);
    const onOnline = () => {
      update("online");
    };
    const onOffline = () => {
      update("offline");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const interval = setInterval(() => {
      void pingHealthcheck().then((reachable) => update(reachable ? "online" : "offline"));
    }, HEALTHCHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(interval);
    };
  }, []);

  return status;
}
