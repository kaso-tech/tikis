import type { ReferralStatus } from "@/shared/tikis-domain";

export const REFERRAL_REWARD_AMOUNT = 1000;

export function referralStatusFor(completedDeliveries: number, rewarded = false): ReferralStatus {
  if (rewarded) return "rewarded";
  return completedDeliveries >= 1 ? "qualified" : "invited";
}

export function canClaimReferralReward(status: ReferralStatus) {
  return status === "qualified";
}
