import { describe, expect, it } from "vitest";
import { shouldAutoCredit } from "../server/_test-helpers/loyalty-auto-credit";

describe("règle d'auto-crédit des loyalty grants", () => {
  it("refuse si autoCredit=false (mode manuel par défaut)", () => {
    expect(shouldAutoCredit({ autoCredit: false, autoCreditMaxAmount: 0, bonusAmount: 5000 })).toBe(false);
  });

  it("accepte tout si autoCredit=true et maxAmount=0 (illimité)", () => {
    expect(shouldAutoCredit({ autoCredit: true, autoCreditMaxAmount: 0, bonusAmount: 5000 })).toBe(true);
    expect(shouldAutoCredit({ autoCredit: true, autoCreditMaxAmount: 0, bonusAmount: 100000 })).toBe(true);
  });

  it("accepte si bonus <= maxAmount", () => {
    expect(shouldAutoCredit({ autoCredit: true, autoCreditMaxAmount: 1000, bonusAmount: 500 })).toBe(true);
    expect(shouldAutoCredit({ autoCredit: true, autoCreditMaxAmount: 1000, bonusAmount: 1000 })).toBe(true);
  });

  it("refuse si bonus > maxAmount", () => {
    expect(shouldAutoCredit({ autoCredit: true, autoCreditMaxAmount: 1000, bonusAmount: 1500 })).toBe(false);
    expect(shouldAutoCredit({ autoCredit: true, autoCreditMaxAmount: 5000, bonusAmount: 5001 })).toBe(false);
  });
});
