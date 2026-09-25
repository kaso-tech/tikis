import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parseYengapayWebhookEvent, verifyYengapayWebhookSignature } from "../server/yengapay";

const secret = "secret-webhook-yengapay-test";

describe("webhook YengaPay Direct (paiements Mobile Money in-app)", () => {
  it("reconnaît un paiement Direct réussi avec paymentAmount et paymentIntentId", () => {
    // Payload type envoyé par YengaPay pour les paiements directs — sans checkoutUrl
    // (puisque l'utilisateur compose l'USSD depuis l'app Tikis et non depuis une page
    // checkout). Le format reste compatible avec le parser existant.
    const raw = JSON.stringify({
      type: "payment.succeeded",
      id: "evt_direct_001",
      data: {
        paymentIntentId: "pi_direct_OM_226_xxx",
        transId: "trans_direct_001",
        paymentAmount: 2500,
        paymentStatus: "DONE",
        paymentSource: "orange_money",
        customerNumber: "+22670123456",
      },
    });
    const signature = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    expect(verifyYengapayWebhookSignature(raw, signature, secret)).toBe(true);

    expect(parseYengapayWebhookEvent(raw, signature, "payment.succeeded")).toMatchObject({
      providerEventId: "trans_direct_001",
      providerReference: "pi_direct_OM_226_xxx",
      eventType: "payment.succeeded",
      amount: 2500,
    });
  });

  it("reconnaît un paiement Direct échoué (FAILED)", () => {
    const raw = JSON.stringify({
      type: "payment.failed",
      data: { paymentIntentId: "pi_direct_failed", paymentStatus: "FAILED", paymentAmount: 1000, paymentSource: "moov_money" },
    });
    const signature = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    const event = parseYengapayWebhookEvent(raw, signature, "payment.failed");
    expect(event.eventType).toBe("payment.failed");
    expect(event.providerReference).toBe("pi_direct_failed");
    expect(event.amount).toBe(1000);
  });

  it("reconnaît un paiement Direct annulé par l'utilisateur (CANCELLED)", () => {
    const raw = JSON.stringify({
      type: "payment.cancelled",
      data: { paymentIntentId: "pi_direct_cancelled", paymentStatus: "CANCELLED", paymentAmount: 5000, paymentSource: "orange_money" },
    });
    const signature = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    const event = parseYengapayWebhookEvent(raw, signature, "payment.cancelled");
    expect(event.eventType).toBe("payment.cancelled");
  });

  it("laisse un paiement Direct en pending si le PSP renvoie PENDING", () => {
    const raw = JSON.stringify({
      type: "payment.pending",
      data: { paymentIntentId: "pi_direct_pending", paymentStatus: "PENDING", paymentAmount: 7500, paymentSource: "orange_money" },
    });
    expect(parseYengapayWebhookEvent(raw, null, "payment.pending").eventType).toBe("payment.pending");
  });

  it("rejette une signature HMAC invalide", () => {
    const raw = JSON.stringify({ type: "payment.succeeded", data: { paymentIntentId: "x", paymentStatus: "DONE", paymentAmount: 1 } });
    expect(verifyYengapayWebhookSignature(raw, "deadbeef", secret)).toBe(false);
    expect(verifyYengapayWebhookSignature(raw, null, secret)).toBe(false);
    expect(verifyYengapayWebhookSignature(raw, createHmac("sha256", secret).update(raw).digest("hex"), null)).toBe(false);
  });

  it("accepte la signature avec ou sans le préfixe 'sha256='", () => {
    const raw = JSON.stringify({ type: "payment.succeeded", data: { paymentIntentId: "pi_x", paymentStatus: "DONE", paymentAmount: 1 } });
    const digest = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    expect(verifyYengapayWebhookSignature(raw, digest, secret)).toBe(true);
    expect(verifyYengapayWebhookSignature(raw, `sha256=${digest}`, secret)).toBe(true);
  });

  it("déterre le eventType depuis le body si l'en-tête x-yengapay-event est absent", () => {
    // Le PSP envoie parfois le type d'event dans le body sous 'event' ou 'type' plutôt que dans un header.
    const raw = JSON.stringify({
      event: "payment.succeeded",
      data: { paymentIntentId: "pi_no_header", paymentStatus: "DONE", paymentAmount: 2000, paymentSource: "orange_money" },
    });
    expect(parseYengapayWebhookEvent(raw, null, null).eventType).toBe("payment.succeeded");
  });

  it("lève une erreur si la référence de paiement est absente", () => {
    const raw = JSON.stringify({ type: "payment.succeeded", data: { paymentStatus: "DONE", paymentAmount: 100 } });
    expect(() => parseYengapayWebhookEvent(raw, null, "payment.succeeded")).toThrow(/référence/);
  });
});
