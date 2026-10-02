import { describe, expect, it } from "vitest";
import { samePhoneNumber } from "../server/routers";

describe("numéro Supabase Auth et numéro Tikisse", () => {
  it("Supabase omet le « + » : même numéro", () => {
    expect(samePhoneNumber("22676212316", "+22676212316")).toBe(true);
    expect(samePhoneNumber("+22676212316", "+22676212316")).toBe(true);
  });

  it("numéros différents ou vides : refus", () => {
    expect(samePhoneNumber("22676212317", "+22676212316")).toBe(false);
    expect(samePhoneNumber("", "+")).toBe(false);
  });
});
