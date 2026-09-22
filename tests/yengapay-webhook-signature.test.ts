import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertYengapayWebhookSecretConfigured, verifyYengapayWebhookSignature } from "../server/yengapay";

const BODY = '{"type":"payment.succeeded","data":{"reference":"YENGA-LIVE-ABC123"}}';

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("la signature du webhook YengaPay", () => {
  it("accepte une signature correcte", () => {
    const secret = "un-secret-de-test-suffisamment-long";
    expect(verifyYengapayWebhookSignature(BODY, sign(secret, BODY), secret)).toBe(true);
  });

  it("rejette une signature incorrecte", () => {
    const secret = "un-secret-de-test-suffisamment-long";
    expect(verifyYengapayWebhookSignature(BODY, sign("autre-secret", BODY), secret)).toBe(false);
  });

  it("rejette quand l'en-tête de signature est absent", () => {
    expect(verifyYengapayWebhookSignature(BODY, null, "un-secret")).toBe(false);
  });

  it("rejette tout, y compris sans en-tête, quand le secret n'est pas configuré", () => {
    // C'était `return true` : n'importe qui connaissant une `providerReference`
    // (visible du client qui a initié son propre dépôt) pouvait s'auto-créditer
    // en postant lui-même l'événement de succès, sans jamais avoir payé.
    expect(verifyYengapayWebhookSignature(BODY, null, null)).toBe(false);
    expect(verifyYengapayWebhookSignature(BODY, "sha256=n'importe-quoi", null)).toBe(false);
  });
});

describe("le démarrage refuse un déploiement live sans secret de webhook", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("YENGAPAY_MODE", "live");
    vi.stubEnv("YENGAPAY_API_KEY", "key");
    vi.stubEnv("YENGAPAY_ORG_ID", "org");
    vi.stubEnv("YENGAPAY_PROJECT_ID", "project");
    vi.stubEnv("YENGAPAY_WEBHOOK_SECRET", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("refuse de démarrer en production, mode live, sans YENGAPAY_WEBHOOK_SECRET", () => {
    expect(() => assertYengapayWebhookSecretConfigured()).toThrow(/YENGAPAY_WEBHOOK_SECRET/);
  });

  it("démarre une fois le secret configuré", () => {
    vi.stubEnv("YENGAPAY_WEBHOOK_SECRET", "un-secret-de-webhook-suffisamment-long");
    expect(() => assertYengapayWebhookSecretConfigured()).not.toThrow();
  });

  it("ne bloque pas le mode test, même sans secret", () => {
    vi.stubEnv("YENGAPAY_API_KEY", "");
    vi.stubEnv("YENGAPAY_ORG_ID", "");
    vi.stubEnv("YENGAPAY_PROJECT_ID", "");
    expect(() => assertYengapayWebhookSecretConfigured()).not.toThrow();
  });

  it("ne bloque pas hors production, même en mode live sans secret", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertYengapayWebhookSecretConfigured()).not.toThrow();
  });
});
