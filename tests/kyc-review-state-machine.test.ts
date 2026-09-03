import { describe, expect, it } from "vitest";
import { canTransitionKyc, KYC_TRANSITIONS } from "../server/_test-helpers/kyc-state-machine";

describe("machine d'état KYC", () => {
  it("submitted peut transiter vers approved ou rejected", () => {
    expect(canTransitionKyc("submitted", "approved")).toBe(true);
    expect(canTransitionKyc("submitted", "rejected")).toBe(true);
  });

  it("approved est terminal (pas de transition autorisée)", () => {
    expect(canTransitionKyc("approved", "rejected")).toBe(false);
    expect(canTransitionKyc("approved", "submitted")).toBe(false);
  });

  it("rejected est terminal", () => {
    expect(canTransitionKyc("rejected", "approved")).toBe(false);
    expect(canTransitionKyc("rejected", "submitted")).toBe(false);
  });

  it("les transitions définies couvrent les 3 états possibles", () => {
    expect(Object.keys(KYC_TRANSITIONS)).toEqual(expect.arrayContaining(["submitted", "approved", "rejected"]));
  });
});
