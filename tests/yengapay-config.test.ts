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

  it("reste en mode live quand un identifiant manque, et ne retombe jamais en mode test", () => {
    // Ce test exigeait l'inverse : un mode live incomplet basculait en silence en mode test, où le
    // règlement simulé permet à n'importe quel utilisateur de créditer son Wallet sans payer. Un mode
    // live incomplet doit échouer à chaque appel, pas se transformer en guichet ouvert.
    vi.stubEnv("YENGAPAY_MODE", "live");
    vi.stubEnv("YENGAPAY_API_KEY", "key");
    vi.stubEnv("YENGAPAY_ORG_ID", "");
    vi.stubEnv("YENGAPAY_PROJECT_ID", "project");

    const config = readYengapayConfig();
    expect(config.mode).toBe("live");
    expect(config.orgId).toBeNull();
  });
});
