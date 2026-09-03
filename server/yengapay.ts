/**
 * Intégration YengaPay — abstraction commune entre le mode test (mock) et le mode live (vrai PSP).
 *
 * Variables d'env attendues pour le mode live :
 *   - YENGAPAY_API_KEY
 *   - YENGAPAY_ORG_ID
 *   - YENGAPAY_PROJECT_ID
 *   - YENGAPAY_BASE_URL (défaut : https://api.yengapay.com/api/v1)
 *   - YENGAPAY_WEBHOOK_SECRET (signature HMAC-SHA256)
 *   - YENGAPAY_MODE (live | test, défaut : test)
 *
 * Si YENGAPAY_API_KEY est absent, on bascule automatiquement en mode test (mock local)
 * pour ne pas casser le développement local.
 */

export type YengapayMode = "test" | "live";

export type YengapayPaymentIntent = {
  paymentTransactionId: string;
  providerReference: string;
  amount: number;
  type: "deposit" | "withdrawal";
  /** URL à exposer à l'utilisateur (checkout hosted page ou lien de paiement). */
  redirectUrl?: string;
  /** Token de provider à renvoyer au client (par ex. pour Mobile Money USSD push). */
  clientToken?: string;
  /** Mode effectif. */
  mode: YengapayMode;
};

export type YengapayWebhookEvent = {
  providerEventId: string;
  eventType: "payment.succeeded" | "payment.failed" | "payment.cancelled" | "withdrawal.succeeded" | "withdrawal.failed";
  providerReference: string;
  amount: number;
  rawPayload: string;
  signature: string | null;
};

export type YengapayProviderConfig = {
  mode: YengapayMode;
  apiKey: string | null;
  orgId: string | null;
  projectId: string | null;
  baseUrl: string;
  webhookSecret: string | null;
};

export function readYengapayConfig(): YengapayProviderConfig {
  const explicitMode = (process.env.YENGAPAY_MODE ?? "").toLowerCase();
  const apiKey = process.env.YENGAPAY_API_KEY ?? null;
  const orgId = process.env.YENGAPAY_ORG_ID ?? null;
  const projectId = process.env.YENGAPAY_PROJECT_ID ?? null;
  const baseUrl = process.env.YENGAPAY_BASE_URL ?? "https://api.yengapay.com/api/v1";
  const webhookSecret = process.env.YENGAPAY_WEBHOOK_SECRET ?? null;
  const liveReady = Boolean(apiKey && orgId && projectId);
  const mode: YengapayMode = explicitMode === "live" ? (liveReady ? "live" : "test") : (liveReady ? "live" : "test");
  return { mode, apiKey, orgId, projectId, baseUrl, webhookSecret };
}

function generateTestReference(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_test_${Date.now()}_${random}`;
}

async function callYengapay<T>(config: YengapayProviderConfig, path: string, init: RequestInit): Promise<T> {
  if (!config.apiKey || !config.orgId || !config.projectId) {
    throw new Error("YengaPay n’est pas configuré : YENGAPAY_API_KEY, YENGAPAY_ORG_ID, YENGAPAY_PROJECT_ID requis.");
  }
  const url = `${config.baseUrl.replace(/\/$/, "")}/groups/${config.orgId}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`YengaPay ${response.status} : ${text.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export type CreateCheckoutInput = {
  paymentTransactionId: string;
  amount: number;
  type: "deposit" | "withdrawal";
  phone: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
};

export async function createYengapayPaymentIntent(input: CreateCheckoutInput): Promise<YengapayPaymentIntent> {
  const config = readYengapayConfig();
  if (config.mode === "test") {
    return {
      paymentTransactionId: input.paymentTransactionId,
      providerReference: generateTestReference(input.type),
      amount: input.amount,
      type: input.type,
      mode: "test",
    };
  }
  const data = await callYengapay<{ intentId: string; redirectUrl?: string; clientToken?: string }>(config, `/payment-intent/project/${config.projectId}`, {
    method: "POST",
    body: JSON.stringify({
      amount: input.amount,
      currency: "XAF",
      type: input.type,
      phone: input.phone,
      description: input.description ?? `Tikis ${input.type === "deposit" ? "dépôt" : "retrait"}`,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      externalReference: input.paymentTransactionId,
    }),
  });
  return {
    paymentTransactionId: input.paymentTransactionId,
    providerReference: data.intentId,
    amount: input.amount,
    type: input.type,
    redirectUrl: data.redirectUrl,
    clientToken: data.clientToken,
    mode: "live",
  };
}

export type VerifyCheckoutInput = {
  providerReference: string;
};

export type VerifyCheckoutResult = {
  providerReference: string;
  status: "succeeded" | "failed" | "pending" | "cancelled";
  amount: number;
};

export async function verifyYengapayPayment(input: VerifyCheckoutInput): Promise<VerifyCheckoutResult> {
  const config = readYengapayConfig();
  if (config.mode === "test") {
    return { providerReference: input.providerReference, status: "pending", amount: 0 };
  }
  const data = await callYengapay<{ status: string; amount: number }>(config, `/payment-intent/project/${config.projectId}/intent/${encodeURIComponent(input.providerReference)}`, {
    method: "GET",
  });
  const status = data.status === "succeeded" ? "succeeded" : data.status === "failed" ? "failed" : data.status === "cancelled" ? "cancelled" : "pending";
  return { providerReference: input.providerReference, status, amount: Number(data.amount ?? 0) };
}

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyYengapayWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string | null): boolean {
  if (!secret) return true;
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "").trim();
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

export function parseYengapayWebhookEvent(rawBody: string, signature: string | null): YengapayWebhookEvent {
  const parsed = JSON.parse(rawBody) as Record<string, unknown>;
  const eventId = typeof parsed.id === "string" ? parsed.id : typeof parsed.eventId === "string" ? parsed.eventId : `auto-${Date.now()}`;
  const eventType = typeof parsed.type === "string" ? parsed.type : typeof parsed.event === "string" ? parsed.event : "payment.succeeded";
  const data = (parsed.data ?? parsed) as Record<string, unknown>;
  const providerReference = typeof data.reference === "string" ? data.reference : typeof data.intentId === "string" ? data.intentId : String(data.paymentIntentId ?? "");
  const amount = Number(data.amount ?? 0);
  return {
    providerEventId: eventId,
    eventType: eventType as YengapayWebhookEvent["eventType"],
    providerReference,
    amount,
    rawPayload: rawBody,
    signature,
  };
}
