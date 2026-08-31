export const MIN_OFFERED_PRICE = 500;
export const MAX_OFFERED_PRICE = 10_000_000;

/** Removes any non-numeric input before the amount is parsed or displayed. */
export function sanitizeOfferedPriceInput(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 8);
}

export function parseOfferedPrice(value: string): number | undefined {
  const normalized = sanitizeOfferedPriceInput(value);
  if (!normalized) return undefined;
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount) || amount < MIN_OFFERED_PRICE || amount > MAX_OFFERED_PRICE) return undefined;
  return amount;
}

export function offeredPriceError(value: string) {
  if (!value.trim()) return undefined;
  const normalized = sanitizeOfferedPriceInput(value);
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < MIN_OFFERED_PRICE) return `Saisissez un montant supérieur ou égal à ${MIN_OFFERED_PRICE.toLocaleString("fr-FR")} FCFA.`;
  if (amount > MAX_OFFERED_PRICE) return `Saisissez un montant inférieur ou égal à ${MAX_OFFERED_PRICE.toLocaleString("fr-FR")} FCFA.`;
  return undefined;
}

export function priceDifferencePercent(offeredPrice: number, estimatedPrice: number) {
  if (estimatedPrice <= 0) return 0;
  return Math.round(((offeredPrice - estimatedPrice) / estimatedPrice) * 100);
}

export function counterOfferCommission(amount: number, commissionRate: number) {
  return Math.round(amount * commissionRate);
}
