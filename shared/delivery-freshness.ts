import { DELIVERY_EXPIRATION_MS, deliveryActivityTimestamp, isOpenDeliveryExpired } from "./delivery-expiration";
import type { DeliveryStatus } from "./tikis-domain";

export type DeliveryFreshness = {
  createdAt: string | Date | null | undefined;
  updatedAt?: string | Date | null | undefined;
  reactivatedAt?: string | Date | null | undefined;
};

export function isOpenDeliveryStale(delivery: DeliveryFreshness & { status: DeliveryStatus }, now = Date.now()): boolean {
  if (delivery.status !== "open" && delivery.status !== "pending_confirmation" && delivery.status !== "active") return false;
  const activityAt = deliveryActivityTimestamp(delivery);
  if (activityAt === null) return false;
  return now - activityAt >= DELIVERY_EXPIRATION_MS;
}

export function isOpenDeliveryFresh(delivery: DeliveryFreshness & { status: DeliveryStatus }, now = Date.now()): boolean {
  const activityAt = deliveryActivityTimestamp(delivery);
  if (activityAt === null) return false;
  return isOpenDeliveryExpired(delivery.status, activityAt, now);
}
