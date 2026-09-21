import { useEffect } from "react";
import { router } from "expo-router";
import { logger } from "@/lib/logger";
import { configurePushNotifications } from "@/lib/push-notifications";
import { trpc } from "@/lib/trpc";

type NotificationData = {
  deliveryId?: string;
  eventType?: string;
  status?: string;
  screen?: "delivery" | "tracking" | "notifications";
  notificationId?: string;
};

function readData(response: { notification?: { request?: { content?: { data?: unknown } } } } | null): NotificationData {
  const value = response?.notification?.request?.content?.data;
  if (!value || typeof value !== "object") return {};
  const data = value as Record<string, unknown>;
  return {
    deliveryId: typeof data.deliveryId === "string" ? data.deliveryId : undefined,
    eventType: typeof data.eventType === "string" ? data.eventType : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
    screen: data.screen === "tracking" || data.screen === "notifications" || data.screen === "delivery" ? data.screen : undefined,
    notificationId: typeof data.notificationId === "string" ? data.notificationId : undefined,
  };
}

function openNotification(data: NotificationData, markRead: (notificationId: string) => void) {
  if (data.notificationId) markRead(data.notificationId);
  if (data.screen === "notifications" || !data.deliveryId) {
    router.push("/notifications" as never);
    return;
  }
  if (data.screen === "tracking" || data.status === "active" || data.eventType === "delivery_started") {
    router.push(`/delivery/${data.deliveryId}/map` as never);
    return;
  }
  router.push(`/delivery/${data.deliveryId}` as never);
}

export function PushNotificationRuntime() {
  const { mutate: markOneRead } = trpc.notifications.markOneRead.useMutation();

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const Notifications = await configurePushNotifications();
      if (!Notifications || disposed) return;
      const received = Notifications.addNotificationReceivedListener(() => {
        logger.info("push", "Notification reçue au premier plan");
      });
      const response = Notifications.addNotificationResponseReceivedListener((event) => {
        openNotification(readData(event), (notificationId) => { markOneRead({ notificationId }); });
      });
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!disposed && last) openNotification(readData(last), (notificationId) => { markOneRead({ notificationId }); });
      await Notifications.setBadgeCountAsync(0).catch(() => undefined);
      cleanup = () => {
        received.remove();
        response.remove();
      };
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [markOneRead]);

  return null;
}
