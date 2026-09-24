import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createYengapayPaymentIntent, readYengapayConfig } from "../server/yengapay";

const runSandboxCheckout = process.env.YENGAPAY_RUN_SANDBOX_CHECKOUT_TEST === "true";

describe("checkout YengaPay Sandbox", () => {
  it.skipIf(!runSandboxCheckout)("crée une intention de dépôt sans créditer le Wallet Tikis", async () => {
    expect(readYengapayConfig().mode).toBe("sandbox");
    const intent = await createYengapayPaymentIntent({
      paymentTransactionId: randomUUID(),
      amount: 100,
      type: "deposit",
      phone: "+22670000000",
      description: "Validation technique Tikis Sandbox",
    });

    expect(intent.mode).toBe("sandbox");
    expect(intent.amount).toBe(100);
    expect(intent.providerReference).toEqual(expect.any(String));
    expect(intent.checkoutUrl).toMatch(/^https:\/\//);
  }, 20_000);
});
