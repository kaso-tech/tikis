import type { DeliveryStatus } from "./tikis-domain";

export const DELIVERY_EXPIRATION_MS = 24 * 60 * 60 * 1_000;

export type DeliveryExpirationOutcome = "complete" | "expire" | null;

export type DeliveryActivitySource = Date | string | number | null | undefined;

function toTimestamp(value: DeliveryActivitySource): number | null {
  if (value === null || value === undefined) return null;
  const timestamp = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function deliveryActivityTimestamp(input: {
  createdAt?: DeliveryActivitySource;
  updatedAt?: DeliveryActivitySource;
  reactivatedAt?: DeliveryActivitySource;
}): number | null {
  const candidates = [toTimestamp(input.createdAt), toTimestamp(input.updatedAt), toTimestamp(input.reactivatedAt)].filter((value): value is number => value !== null);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

export function deliveryExpirationOutcome(
  status: DeliveryStatus,
  activityAt: Date | string | number | null,
  now = Date.now(),
): DeliveryExpirationOutcome {
  const timestamp = toTimestamp(activityAt);
  if (timestamp === null || timestamp > now - DELIVERY_EXPIRATION_MS) return null;
  if (status === "active") return "complete";
  if (status === "open" || status === "pending_confirmation" || status === "disabled") return "expire";
  return null;
}

export function isOpenDeliveryExpired(status: DeliveryStatus, activityAt: Date | string | number | null, now = Date.now()): boolean {
  return deliveryExpirationOutcome(status, activityAt, now) === "expire";
}
