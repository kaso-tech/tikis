import { describe, expect, it } from "vitest";
import { REFERRAL_REWARD_AMOUNT, canClaimReferralReward, referralStatusFor } from "../lib/referral-rules";

describe("règles de parrainage Tikis", () => {
  it("rend la récompense éligible après la première course terminée du filleul", () => {
    expect(referralStatusFor(0)).toBe("invited");
    expect(referralStatusFor(1)).toBe("qualified");
    expect(referralStatusFor(2, true)).toBe("rewarded");
  });

  it("n’autorise le crédit Wallet qu’une seule fois", () => {
    expect(REFERRAL_REWARD_AMOUNT).toBe(1000);
    expect(canClaimReferralReward("qualified")).toBe(true);
    expect(canClaimReferralReward("rewarded")).toBe(false);
    expect(canClaimReferralReward("invited")).toBe(false);
  });
});
