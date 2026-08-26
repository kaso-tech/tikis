import type { CommissionPolicy, WalletSnapshot } from "../shared/tikis-domain";
import { availableWalletBalance, commissionFor } from "../shared/tikis-domain";

export function canApplyToDelivery(wallet: WalletSnapshot, price: number, policy: CommissionPolicy) {
  return availableWalletBalance(wallet) >= commissionFor(price, policy);
}

export function sanitizeDeliveryText(value: string) {
  return value.replace(/[<>\[\]{}]/g, "").replace(/\s+/g, " ").trim();
}

export function isAllowedDeliveryText(value: string) {
  return /^[a-zA-Z0-9\s'\-.,àâçéèêëîïôùûüÿñæœÀÂÇÉÈÊËÎÏÔÙÛÜŸÑÆŒ]*$/.test(value);
}

