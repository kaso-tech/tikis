import { useEffect } from "react";
import Constants from "expo-constants";
import { trpc } from "@/lib/trpc";
import { logger } from "@/lib/logger";
import {
  getExpoPushRegistration,
  getPushPermissionStatus,
  requestPushPermission,
  type PushPermissionOutcome,
} from "@/lib/push-notifications";

const PUSH_TOKEN_KEY = "tikis.push.registration.v2";
type Storage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void>; removeItem: (key: string) => Promise<void> };
type StoredRegistration = { phone: string; token: string };

async function readStorage(): Promise<Storage | null> {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
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

async function saveRegistration(phone: string, token: string) {
  const storage = await readStorage();
  await storage?.setItem(PUSH_TOKEN_KEY, JSON.stringify({ phone, token } satisfies StoredRegistration));
}

export async function getStoredPushRegistration(): Promise<StoredRegistration | null> {
  const storage = await readStorage();
  const raw = await storage?.getItem(PUSH_TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredRegistration>;
    return typeof parsed.phone === "string" && typeof parsed.token === "string" ? { phone: parsed.phone, token: parsed.token } : null;
  } catch {
    return null;
  }
}

export async function clearStoredPushRegistration() {
  const storage = await readStorage();
  await storage?.removeItem(PUSH_TOKEN_KEY);
}

export { requestPushPermission };
export type { PushPermissionOutcome };

export function usePushRegistration(phone: string | null | undefined) {
  const { mutateAsync } = trpc.notifications.registerPushToken.useMutation();

  useEffect(() => {
    let cancelled = false;
    if (!phone) return;
    void (async () => {
      const permission = await getPushPermissionStatus();
      if (cancelled || permission !== "granted") return;
      const registration = await getExpoPushRegistration();
      if (!registration || cancelled) return;
      try {
        await mutateAsync({
          token: registration.token,
          platform: registration.platform,
          appVersion: Constants.expoConfig?.version ?? undefined,
          deviceName: (Constants.deviceName as string | null | undefined) ?? undefined,
        });
        await saveRegistration(phone, registration.token);
        logger.info("push", "Token Expo enregistré et actualisé");
      } catch (cause) {
        logger.warn("push", "Échec de l’enregistrement silencieux", cause);
      }
    })();
    return () => { cancelled = true; };
  }, [phone, mutateAsync]);
}

export function usePushEnrollment() {
  const { mutateAsync } = trpc.notifications.registerPushToken.useMutation();

  return async function enablePush(): Promise<PushPermissionOutcome> {
    const outcome = await requestPushPermission();
    if (outcome !== "granted") return outcome;
    const registration = await getExpoPushRegistration();
    if (!registration) return "registration-failed";
    try {
      await mutateAsync({
        token: registration.token,
        platform: registration.platform,
        appVersion: Constants.expoConfig?.version ?? undefined,
        deviceName: (Constants.deviceName as string | null | undefined) ?? undefined,
      });
      await saveRegistration("current", registration.token);
      return "granted";
    } catch (cause) {
      logger.warn("push", "Échec de l’enregistrement après activation", cause);
      return "registration-failed";
    }
  };
}
