import { Platform } from "react-native";
import Constants from "expo-constants";
import type { TrackingEvent } from "./gps-simulator";

const TRACKING_CHANNEL = "tikis-delivery-tracking";
let configured = false;
const runsInExpoGo = Constants.appOwnership === "expo";
let notificationHandlerConfigured = false;

async function getNativeNotifications() {
  if (Platform.OS === "web" || runsInExpoGo) return null;
  const Notifications = await import("expo-notifications");
  if (!notificationHandlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    notificationHandlerConfigured = true;
  }
  return Notifications;
}

export async function configureSimulatedPushNotifications() {
  if (configured) return true;
  const Notifications = await getNativeNotifications();
  if (!Notifications) return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(TRACKING_CHANNEL, {
      name: "Suivi de livraison Tikis",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 100, 180],
      lightColor: "#9A6201",
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync();
  configured = permission.status === "granted";
  return configured;
}

export async function presentSimulatedTrackingPush(event: TrackingEvent, deliveryId: string) {
  try {
    const Notifications = await getNativeNotifications();
    if (!Notifications) return false;
    const granted = await configureSimulatedPushNotifications();
    if (!granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: event.title,
        body: event.body,
        data: { deliveryId, event: event.type, url: `/delivery/${deliveryId}/map` },
        sound: false,
        color: "#9A6201",
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}

export async function presentDeliveryStatusPush(event: { deliveryId: string; status: string; title: string; body: string }) {
  try {
    const Notifications = await getNativeNotifications();
    if (!Notifications) return false;
    const granted = await configureSimulatedPushNotifications();
    if (!granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: { title: event.title, body: event.body, data: { deliveryId: event.deliveryId, status: event.status, url: `/delivery/${event.deliveryId}/map` }, sound: false, color: "#9A6201" },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
