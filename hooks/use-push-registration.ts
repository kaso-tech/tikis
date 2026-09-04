import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { trpc } from "@/lib/trpc";
import { logger } from "@/lib/logger";

const PUSH_TOKEN_KEY = "tikis.push.token";

type Storage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void>; removeItem: (key: string) => Promise<void> };

async function readStorage(): Promise<Storage | null> {
  try {
    if (Platform.OS === "web") {
      if (typeof window === "undefined" || !window.localStorage) return null;
      return {
        getItem: async (key) => window.localStorage.getItem(key),
        setItem: async (key, value) => { window.localStorage.setItem(key, value); },
        removeItem: async (key) => { window.localStorage.removeItem(key); },
      };
    }
    const SecureStore = await import("expo-secure-store");
    return {
      getItem: async (key) => SecureStore.getItemAsync(key),
      setItem: async (key, value) => { await SecureStore.setItemAsync(key, value); },
      removeItem: async (key) => { await SecureStore.deleteItemAsync(key); },
    };
  } catch {
    return null;
  }
}

async function getDevicePushToken(): Promise<{ token: string; platform: "ios" | "android" | "web" } | null> {
  if (Platform.OS === "web") return null;
  if (Constants.appOwnership === "expo") {
    // Expo Go : pas de push distant, le simulateur local suffit.
    return null;
  }
  try {
    const Notifications = await import("expo-notifications");
    const response = await Notifications.getDevicePushTokenAsync();
    const token = response.data as unknown as string;
    if (!token) return null;
    return { token, platform: Platform.OS === "ios" ? "ios" : "android" };
  } catch (cause) {
    logger.warn("[push:hook]", "Impossible d’obtenir le push token", cause);
    return null;
  }
}

/** Enregistre automatiquement le push token Expo du device auprès du serveur quand un profil Tikis est connecté.
 *  À appeler une fois dans le layout racine, sous TikisStoreProvider. */
export function usePushRegistration(phone: string | null | undefined) {
  const register = trpc.notifications.registerPushToken.useMutation();
  const unregister = trpc.notifications.unregisterPushToken.useMutation();

  useEffect(() => {
    let cancelled = false;
    if (!phone) return;
    void (async () => {
      const device = await getDevicePushToken();
      if (!device || cancelled) return;
      const storage = await readStorage();
      if (!storage) return;
      const previous = await storage.getItem(PUSH_TOKEN_KEY);
      if (previous === device.token) return; // déjà enregistré
      try {
        const appVersion = (Constants.expoConfig?.version as string | undefined) ?? undefined;
        const deviceName = (Constants.deviceName as string | undefined) ?? undefined;
        await register.mutateAsync({ token: device.token, platform: device.platform, appVersion, deviceName });
        await storage.setItem(PUSH_TOKEN_KEY, device.token);
        logger.info("[push:hook]", `Token enregistré pour ${phone.slice(0, 5)}…`);
      } catch (cause) {
        logger.warn("[push:hook]", "Échec de l’enregistrement du push token", cause);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phone, register]);

  // Pas d’unregister au logout pour l’instant — l’admin peut purger via la DB si nécessaire.
  // Le token devient inactif côté Expo après 30j sans lastSeenAt (cf. listActivePushTokens).
  void unregister;
}
