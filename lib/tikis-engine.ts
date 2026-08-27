import type { CommissionPolicy, WalletSnapshot } from "../shared/tikis-domain";
import { availableWalletBalance, commissionFor } from "../shared/tikis-domain";

export function canApplyToDelivery(wallet: WalletSnapshot, price: number, policy: CommissionPolicy) {
  return availableWalletBalance(wallet) >= commissionFor(price, policy);
}

export function sanitizeDeliveryText(value: string, options: { preserveTrailingSpace?: boolean } = {}) {
  const normalized = value.replace(/[<>\[\]{}]/g, "").replace(/\s+/g, " ");
  return options.preserveTrailingSpace ? normalized.replace(/^\s+/, "") : normalized.trim();
}

export function isAllowedDeliveryText(value: string) {
  return /^[a-zA-Z0-9\s'\-.,àâçéèêëîïôùûüÿñæœÀÂÇÉÈÊËÎÏÔÙÛÜŸÑÆŒ]*$/.test(value);
}
