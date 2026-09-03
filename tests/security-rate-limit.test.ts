import { describe, expect, it } from "vitest";
import { enforcePerPhoneRateLimit } from "../server/_test-helpers/rate-limit-test";

describe("per-phone rate limit", () => {
  it("bloque après 5 tentatives dans la fenêtre de 10 minutes", () => {
    const phone = "+237699000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => enforcePerPhoneRateLimit("test", phone)).not.toThrow();
    }
    expect(() => enforcePerPhoneRateLimit("test", phone)).toThrow(/Trop de tentatives/);
  });

  it("isole les buckets par scope", () => {
    const phone = "+237699000001";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => enforcePerPhoneRateLimit("scopeA", phone)).not.toThrow();
    }
    expect(() => enforcePerPhoneRateLimit("scopeA", phone)).toThrow();
    expect(() => enforcePerPhoneRateLimit("scopeB", phone)).not.toThrow();
  });

  it("isole les buckets par téléphone", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => enforcePerPhoneRateLimit("test", "+237699000002")).not.toThrow();
    }
    expect(() => enforcePerPhoneRateLimit("test", "+237699000003")).not.toThrow();
  });
});
