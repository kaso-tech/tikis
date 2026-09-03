import { describe, expect, it } from "vitest";
import { MAX_OPEN_APPLICATIONS_PER_DRIVER, MAX_APPLICATIONS_PER_DAY } from "../server/_test-helpers/driver-application-limits";

describe("limites anti-fraude des candidatures livreur", () => {
  it("les constantes sont conformes au policy (50 ouvertes / 200 par jour)", () => {
    expect(MAX_OPEN_APPLICATIONS_PER_DRIVER).toBe(50);
    expect(MAX_APPLICATIONS_PER_DAY).toBe(200);
  });

  it("MAX_OPEN_APPLICATIONS_PER_DRIVER est strictement inférieur à MAX_APPLICATIONS_PER_DAY", () => {
    expect(MAX_OPEN_APPLICATIONS_PER_DRIVER).toBeLessThan(MAX_APPLICATIONS_PER_DAY);
  });
});
