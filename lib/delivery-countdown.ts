import { DELIVERY_EXPIRATION_MS } from "../shared/delivery-expiration";

export function deliveryRemainingMs(createdAt: Date | string, now = Date.now()): number | null {
  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return null;
  return Math.max(0, createdAtMs + DELIVERY_EXPIRATION_MS - now);
}

export function formatDeliveryCountdown(remainingMs: number | null): string {
  if (remainingMs === null) return "Échéance indisponible";
  if (remainingMs <= 0) return "Échéance atteinte";
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours} h ${String(minutes).padStart(2, "0")} min ${String(seconds).padStart(2, "0")} s`;
}
