import { useEffect, useState } from "react";

import { closeDeliveryTrackingChannel, createDeliveryTrackingChannel, type DeliveryPosition } from "@/lib/supabase-tracking";
import { trpc } from "@/lib/trpc";

const EMPTY_DELIVERY_ID = "00000000-0000-0000-0000-000000000000";

export function useLiveDeliveryPosition(deliveryId: string | null, enabled: boolean) {
  const [broadcastPosition, setBroadcastPosition] = useState<DeliveryPosition | null>(null);
  const positionQuery = trpc.deliveries.livePosition.useQuery(
    { deliveryId: deliveryId ?? EMPTY_DELIVERY_ID },
    { enabled: Boolean(deliveryId && enabled), refetchInterval: 2_000, refetchOnMount: "always" },
  );

  useEffect(() => {
    setBroadcastPosition(null);
  }, [deliveryId]);

  useEffect(() => {
    if (!deliveryId || !enabled) return;
    const channel = createDeliveryTrackingChannel(deliveryId, setBroadcastPosition);
    return () => { void closeDeliveryTrackingChannel(channel); };
  }, [deliveryId, enabled]);

  return broadcastPosition ?? positionQuery.data ?? null;
}
