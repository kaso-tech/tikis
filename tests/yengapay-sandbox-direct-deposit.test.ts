import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createYengapayDirectDeposit } from "../server/yengapay-direct";
import { readYengapayConfig, readYengapayConfig as readBaseConfig } from "../server/yengapay";

/**
 * Test d'intégration YengaPay Sandbox pour les paiements directs Mobile Money.
 *
 * Activé uniquement quand l'utilisateur pose YENGAPAY_RUN_SANDBOX_DIRECT_DEPOSIT_TEST=true
 * ET que les credentials sandbox sont configurés (YENGAPAY_API_KEY, YENGAPAY_ORG_ID,
 * YENGAPAY_PROJECT_ID).
 *
 * Ce test :
 *  - crée une intention de dépôt direct via l'API YengaPay sandbox (mode `sandbox`),
 *  - vérifie que la réponse contient un paymentIntentId (providerReference) + un code USSD,
 *  - vérifie que le mode retourné est bien `sandbox`,
 *  - vérifie qu'on peut interroger le statut immédiatement après (pending).
 *
 * Le test est isolé : il utilise des UUIDs aléatoires et un faux numéro de téléphone
 * (le PSP sandbox ne fait pas de vraie transaction — il valide juste le contrat).
 */

const SANDBOX_BASE_URL = "https://api.sandbox.yengapay.com/api/v1";

const runSandboxDirectDeposit = process.env.YENGAPAY_RUN_SANDBOX_DIRECT_DEPOSIT_TEST === "true";

const hasSandboxCredentials = Boolean(
  process.env.YENGAPAY_API_KEY
  && process.env.YENGAPAY_ORG_ID
  && process.env.YENGAPAY_PROJECT_ID,
);

// Snapshot du mode avant le test, restauré en afterAll — le test doit être transparent
// pour les autres tests de la suite (qui s'attendent à `mode === "test"` par défaut).
let previousMode: string | undefined;

beforeAll(() => {
  previousMode = process.env.YENGAPAY_MODE;
  process.env.YENGAPAY_MODE = "sandbox";
  if (!process.env.YENGAPAY_BASE_URL) {
    process.env.YENGAPAY_BASE_URL = SANDBOX_BASE_URL;
  }
});

afterAll(() => {
  if (previousMode === undefined) {
    delete process.env.YENGAPAY_MODE;
  } else {
    process.env.YENGAPAY_MODE = previousMode;
  }
});

describe("paiement direct YengaPay Sandbox", () => {
  it.skipIf(!runSandboxDirectDeposit || !hasSandboxCredentials)("crée une intention de dépôt direct Orange Money", async () => {
    expect(readBaseConfig().mode).toBe("sandbox");
    expect(readYengapayConfig().mode).toBe("sandbox");

    const intent = await createYengapayDirectDeposit({
      profilePhone: "+22670000000", // Faux numéro — la sandbox ne débite pas
      amount: 100,
      phone: "+22670000000",
      operator: "orange_money",
      countryCode: "BF",
      idempotencyKey: `sandbox-orange-${randomUUID().replace(/-/g, "")}`,
    });

    expect(intent.mode).toBe("sandbox");
    expect(intent.amount).toBe(100);
    expect(intent.phone).toBe("+22670000000");
    expect(intent.operator).toBe("orange_money");
    expect(intent.status).toBe("pending");
    expect(intent.providerReference).toEqual(expect.any(String));
    expect(intent.providerReference.length).toBeGreaterThan(0);
    expect(intent.ussdCode).toMatch(/^\*/); // commence par * (code USSD)
    expect(intent.ussdCode).toMatch(/#$/); // termine par #
    expect(intent.expiresAt).toEqual(expect.any(String));
    expect(new Date(intent.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // transactionId est un UUID Tikis interne
    expect(intent.transactionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }, 25_000);

  it.skipIf(!runSandboxDirectDeposit || !hasSandboxCredentials)("crée une intention de dépôt direct Moov Money", async () => {
    expect(readYengapayConfig().mode).toBe("sandbox");

    const intent = await createYengapayDirectDeposit({
      profilePhone: "+22990000000",
      amount: 500,
      phone: "+22990000000",
      operator: "moov_money",
      countryCode: "BJ",
      idempotencyKey: `sandbox-moov-${randomUUID().replace(/-/g, "")}`,
    });

    expect(intent.mode).toBe("sandbox");
    expect(intent.amount).toBe(500);
    expect(intent.operator).toBe("moov_money");
    expect(intent.countryCode).toBe("BJ");
    expect(intent.ussdCode).toMatch(/^\*555/); // Pattern Moov : *555*...
  }, 25_000);
});
