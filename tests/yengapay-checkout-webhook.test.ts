import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parseYengapayWebhookEvent, verifyYengapayWebhookSignature } from "../server/yengapay";

const secret = "secret-webhook-yengapay-test";
const rawSuccess = JSON.stringify({
  paymentIntentId: "intent_sandbox_123",
  transId: "transaction_sandbox_123",
  paymentAmount: 100,
  paymentStatus: "DONE",
});

describe("webhook Checkout YengaPay", () => {
  it("reconnaît le format Checkout DONE et le lie à l’intention", () => {
    const signature = createHmac("sha256", secret).update(rawSuccess, "utf8").digest("hex");
    expect(verifyYengapayWebhookSignature(rawSuccess, signature, secret)).toBe(true);

    expect(parseYengapayWebhookEvent(rawSuccess, signature, "payment.success")).toMatchObject({
      providerEventId: "transaction_sandbox_123",
      providerReference: "intent_sandbox_123",
      eventType: "payment.succeeded",
      amount: 100,
    });
  });

  it("ne règle jamais un statut restant en attente", () => {
    const rawPending = JSON.stringify({ paymentIntentId: "intent_pending", paymentStatus: "PENDING", paymentAmount: 100 });
    expect(parseYengapayWebhookEvent(rawPending, null, "payment.pending").eventType).toBe("payment.pending");
  });
});
