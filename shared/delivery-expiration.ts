import type { DeliveryStatus } from "./tikis-domain";

export const DELIVERY_EXPIRATION_MS = 24 * 60 * 60 * 1_000;

export function isOpenDeliveryExpired(status: DeliveryStatus, createdAt: Date | string, now = Date.now()): boolean {
  if (status !== "open") return false;
  const timestamp = new Date(createdAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= now - DELIVERY_EXPIRATION_MS;
}
