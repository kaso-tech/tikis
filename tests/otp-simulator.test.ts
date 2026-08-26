import { describe, expect, it } from "vitest";
import { isValidOtp, isValidPhone, maskPhone, normalizePhone, OTP_MAX_ATTEMPTS, verifySimulationOtp } from "../lib/otp-simulator";
import { SIMULATION_OTP } from "../shared/tikis-domain";

describe("OTP de simulation Tikis", () => {
  it("accepte uniquement un code de six chiffres correspondant au code de démonstration", () => {
    expect(isValidOtp(SIMULATION_OTP)).toBe(true);
    expect(verifySimulationOtp(SIMULATION_OTP)).toBe(true);
    expect(isValidOtp("73051")).toBe(false);
    expect(isValidOtp("7305120")).toBe(false);
    expect(isValidOtp("abcdef")).toBe(false);
    expect(verifySimulationOtp("000000")).toBe(false);
  });

  it("normalise et valide un numéro international", () => {
    expect(normalizePhone("+226", "70 00 00 00")).toBe("+22670000000");
    expect(isValidPhone("+226", "70 00 00 00")).toBe(true);
    expect(isValidPhone("+226", "12")).toBe(false);
    expect(maskPhone("+22670000000")).toBe("+226 70 00 •••");
  });

  it("conserve une limite de tentatives définie pour la simulation", () => {
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });
});
