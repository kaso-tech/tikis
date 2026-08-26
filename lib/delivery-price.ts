export const MIN_OFFERED_PRICE = 100;
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
  const amount = parseOfferedPrice(value);
  return amount === undefined ? `Saisissez un montant entre ${MIN_OFFERED_PRICE.toLocaleString("fr-FR")} et ${MAX_OFFERED_PRICE.toLocaleString("fr-FR")} FCFA.` : undefined;
}

export function priceDifferencePercent(offeredPrice: number, estimatedPrice: number) {
  if (estimatedPrice <= 0) return 0;
  return Math.round(((offeredPrice - estimatedPrice) / estimatedPrice) * 100);
}

export function counterOfferCommission(amount: number, commissionRate: number) {
  return Math.round(amount * commissionRate);
}
