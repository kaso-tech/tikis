import type { DeliveryStatus } from "./tikis-domain";

export const DELIVERY_EXPIRATION_MS = 24 * 60 * 60 * 1_000;

export type DeliveryExpirationOutcome = "complete" | "expire" | null;

export function deliveryExpirationOutcome(status: DeliveryStatus, createdAt: Date | string, now = Date.now()): DeliveryExpirationOutcome {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp) || timestamp > now - DELIVERY_EXPIRATION_MS) return null;
  if (status === "active") return "complete";
  if (status === "open" || status === "pending_confirmation" || status === "disabled") return "expire";
  return null;
}

export function isOpenDeliveryExpired(status: DeliveryStatus, createdAt: Date | string, now = Date.now()): boolean {
  return deliveryExpirationOutcome(status, createdAt, now) === "expire";
}
