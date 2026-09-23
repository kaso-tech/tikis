import Constants from "expo-constants";
import { Platform } from "react-native";
import { logger } from "@/lib/logger";

type NotificationsModule = typeof import("expo-notifications");

export const PUSH_CHANNELS = {
  transactional: "tikis-transactional",
  opportunities: "tikis-opportunities",
  tracking: "tikis-delivery-tracking",
} as const;

export type PushPermissionOutcome = "granted" | "denied" | "unsupported" | "registration-failed";
export type PushRegistration = { token: string; platform: "ios" | "android" };

let modulePromise: Promise<NotificationsModule | null> | null = null;
let handlerConfigured = false;
let channelsConfigured = false;

function isExpoGo() {
  return Constants.executionEnvironment === "storeClient" || Constants.appOwnership === "expo";
}

export async function loadNotifications(): Promise<NotificationsModule | null> {
  if (Platform.OS === "web" || isExpoGo()) return null;
  if (!modulePromise) {
    modulePromise = import("expo-notifications").catch((cause) => {
      logger.warn("push", "Module expo-notifications indisponible", cause);
      return null;
    });
  }
  return modulePromise;
}

export async function configurePushNotifications(): Promise<NotificationsModule | null> {
  const Notifications = await loadNotifications();
  if (!Notifications) return null;

  if (!handlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    handlerConfigured = true;
  }

  if (Platform.OS === "android" && !channelsConfigured) {
    await Promise.all([
      Notifications.setNotificationChannelAsync(PUSH_CHANNELS.transactional, {
        name: "Notifications Tikis",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 180, 100, 180],
        lightColor: "#FF9800",
      }),
      Notifications.setNotificationChannelAsync(PUSH_CHANNELS.opportunities, {
        name: "Nouvelles courses",
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
        vibrationPattern: [0, 120],
        lightColor: "#FF9800",
      }),
      Notifications.setNotificationChannelAsync(PUSH_CHANNELS.tracking, {
        name: "Suivi de livraison",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 180, 100, 180],
        lightColor: "#FF9800",
      }),
    ]);
    channelsConfigured = true;
  }

  return Notifications;
}

export async function getPushPermissionStatus(): Promise<"granted" | "denied" | "undetermined" | "unsupported"> {
  const Notifications = await configurePushNotifications();
  if (!Notifications) return "unsupported";
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (permissions.granted || permissions.status === "granted") return "granted";
    if (permissions.status === "denied") return "denied";
    return "undetermined";
  } catch (cause) {
    logger.warn("push", "Impossible de lire les permissions", cause);
    return "unsupported";
  }
}

export async function requestPushPermission(): Promise<PushPermissionOutcome> {
  const Notifications = await configurePushNotifications();
  if (!Notifications) return "unsupported";
  try {
    const current = await Notifications.getPermissionsAsync();
    const permissions = current.granted || current.status === "granted"
      ? current
      : await Notifications.requestPermissionsAsync();
    return permissions.granted || permissions.status === "granted" ? "granted" : "denied";
  } catch (cause) {
    logger.warn("push", "Demande d’autorisation indisponible", cause);
    return "unsupported";
  }
}

function getProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string }; projectId?: string } | undefined;
  const easConfig = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig;
  return extra?.eas?.projectId ?? extra?.projectId ?? easConfig?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
}

export async function getExpoPushRegistration(): Promise<PushRegistration | null> {
  const Notifications = await configurePushNotifications();
  if (!Notifications) return null;
  const projectId = getProjectId();
  if (!projectId) {
    logger.warn("push", "EXPO_PUBLIC_EAS_PROJECT_ID absent : aucun token Expo ne peut être créé");
    return null;
  }
  try {
    const response = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!response.data) return null;
    return { token: response.data, platform: Platform.OS === "ios" ? "ios" : "android" };
  } catch (cause) {
    logger.warn("push", "Impossible d’obtenir le token Expo", cause);
    return null;
  }
}
