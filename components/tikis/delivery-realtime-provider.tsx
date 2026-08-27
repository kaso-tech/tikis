import { useEffect, useMemo } from "react";
import type { PropsWithChildren } from "react";
import { createDeliveryStatusChannel, closeDeliveryTrackingChannel } from "@/lib/supabase-tracking";
import { presentDeliveryStatusPush } from "@/lib/simulated-push-notifications";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

/** Subscribes only to deliveries visible to the signed-in profile; database queries remain the durable fallback. */
export function DeliveryRealtimeProvider({ children }: PropsWithChildren) {
  const { profile } = useTikisStore();
  const utilities = trpc.useUtils();
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 12_000 });
  const deliveryIds = useMemo(() => (deliveriesQuery.data ?? []).map((delivery) => delivery.id).sort(), [deliveriesQuery.data]);
  const deliveryKey = deliveryIds.join("|");

  useEffect(() => {
    if (!deliveryIds.length) return;
    const channels = deliveryIds.map((deliveryId) => createDeliveryStatusChannel(deliveryId, (event) => {
      void Promise.all([
        utilities.deliveries.get.invalidate({ id: event.deliveryId }),
        utilities.deliveries.list.invalidate(),
        utilities.notifications.list.invalidate(),
        utilities.wallet.snapshot.invalidate(),
      ]);
      void presentDeliveryStatusPush(event);
    }));
    return () => { channels.forEach((channel) => void closeDeliveryTrackingChannel(channel)); };
  }, [deliveryIds, deliveryKey, utilities]);

  return <>{children}</>;
}
