import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
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

export type PushPermissionOutcome = "granted" | "denied" | "unsupported" | "registration-failed";

/** Demande à l'OS l'autorisation d'envoyer des notifications, puis enregistre le token du device.
 *  Appelé au moment où le livreur active ses alertes : c'est le seul instant où la demande a du sens
 *  pour lui, et l'OS ne redemande jamais après un refus — d'où le retour explicite `denied`, que
 *  l'écran de réglages traduit en invitation à ouvrir les paramètres système. */
export async function requestPushPermission(): Promise<PushPermissionOutcome> {
  if (Platform.OS === "web") return "unsupported";
  try {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || current.status === "granted"
      ? current
      : await Notifications.requestPermissionsAsync();
    if (!(granted.granted || granted.status === "granted")) return "denied";
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("tikis-delivery", {
        name: "Courses Tikis",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
      });
    }
    return "granted";
  } catch (cause) {
    logger.warn("[push:hook]", "Demande d’autorisation refusée ou indisponible", cause);
    return "unsupported";
  }
}

async function getDevicePushToken(): Promise<{ token: string; platform: "ios" | "android" | "web" } | null> {
  if (Platform.OS === "web") return null;
  if (Constants.appOwnership === "expo") {
    // Expo Go : pas de push distant, le simulateur local suffit.
    return null;
  }
  try {
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

/** Parcours d'activation déclenché par le livreur depuis ses réglages : autorisation système puis
 *  enregistrement du token. À la différence de `usePushRegistration` (silencieux, au démarrage), cette
 *  fonction fait remonter le résultat pour que l'écran puisse expliquer un refus. */
export function usePushEnrollment() {
  const register = trpc.notifications.registerPushToken.useMutation();

  return async function enablePush(): Promise<PushPermissionOutcome> {
    const outcome = await requestPushPermission();
    if (outcome !== "granted") return outcome;
    const device = await getDevicePushToken();
    // Expo Go et le web ne fournissent pas de token distant : l'autorisation est bien accordée, les
    // notifications in-app restent alimentées, seul le push hors application ne partira pas.
    if (!device) return "granted";
    try {
      const appVersion = (Constants.expoConfig?.version as string | undefined) ?? undefined;
      const deviceName = (Constants.deviceName as string | undefined) ?? undefined;
      await register.mutateAsync({ token: device.token, platform: device.platform, appVersion, deviceName });
      const storage = await readStorage();
      await storage?.setItem(PUSH_TOKEN_KEY, device.token);
    } catch (cause) {
      // Remonté à l'appelant plutôt qu'avalé : sans token côté serveur, aucune alerte ne partira
      // jamais. Annoncer « alertes activées » dans ce cas serait un mensonge silencieux.
      logger.warn("[push:hook]", "Échec de l’enregistrement du push token après activation", cause);
      return "registration-failed";
    }
    return "granted";
  };
}
