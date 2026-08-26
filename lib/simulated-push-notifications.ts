import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { TrackingEvent } from "./gps-simulator";

const TRACKING_CHANNEL = "tikis-delivery-tracking";
let configured = false;

export async function configureSimulatedPushNotifications() {
  if (Platform.OS === "web" || configured) return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(TRACKING_CHANNEL, {
      name: "Suivi de livraison Tikis",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 100, 180],
      lightColor: "#007B8B",
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync();
  configured = permission.status === "granted";
  return configured;
}

export async function presentSimulatedTrackingPush(event: TrackingEvent, deliveryId: string) {
  if (Platform.OS === "web") return false;
  try {
    const granted = await configureSimulatedPushNotifications();
    if (!granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: event.title,
        body: event.body,
        data: { deliveryId, event: event.type, url: `/track/${deliveryId}` },
        sound: false,
        color: "#007B8B",
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

