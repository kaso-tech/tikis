import { afterEach, describe, expect, it, vi } from "vitest";

import { readYengapayConfig } from "../server/yengapay";

afterEach(() => vi.unstubAllEnvs());

describe("configuration YengaPay", () => {
  it("reste en simulation locale lorsque le mode n’est pas déclaré", () => {
    vi.stubEnv("YENGAPAY_MODE", "");
    vi.stubEnv("YENGAPAY_API_KEY", "key");
    vi.stubEnv("YENGAPAY_ORG_ID", "org");
    vi.stubEnv("YENGAPAY_PROJECT_ID", "project");

    expect(readYengapayConfig().mode).toBe("test");
  });

  it("active explicitement le Sandbox avec son URL dédiée", () => {
    vi.stubEnv("YENGAPAY_MODE", "sandbox");
    vi.stubEnv("YENGAPAY_API_KEY", "key");
    vi.stubEnv("YENGAPAY_ORG_ID", "org");
    vi.stubEnv("YENGAPAY_PROJECT_ID", "project");
    vi.stubEnv("YENGAPAY_BASE_URL", "https://sandbox.example.test/api/v1");

    expect(readYengapayConfig()).toMatchObject({
      mode: "sandbox",
      baseUrl: "https://sandbox.example.test/api/v1",
    });
  });

  it("ne bascule jamais en mode distant sans le triplet complet", () => {
    vi.stubEnv("YENGAPAY_MODE", "live");
    vi.stubEnv("YENGAPAY_API_KEY", "key");
    vi.stubEnv("YENGAPAY_ORG_ID", "");
    vi.stubEnv("YENGAPAY_PROJECT_ID", "project");

    expect(readYengapayConfig().mode).toBe("test");
  });
});
