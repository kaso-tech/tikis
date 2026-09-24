import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Intégration YengaPay. Le mode externe est toujours explicite : une clé API
 * présente seule ne doit jamais transformer le développement en paiement réel.
 *
 * Variables d'environnement :
 * - YENGAPAY_MODE : test | sandbox | live
 * - YENGAPAY_API_KEY, YENGAPAY_ORG_ID, YENGAPAY_PROJECT_ID
 * - YENGAPAY_BASE_URL : URL fournie par la console du projet Sandbox ou Live
 * - YENGAPAY_WEBHOOK_SECRET : HMAC-SHA256 du webhook du projet
 */

export type YengapayMode = "test" | "sandbox" | "live";

export type YengapayPaymentIntent = {
  paymentTransactionId: string;
  providerReference: string;
  amount: number;
  type: "deposit" | "withdrawal";
  checkoutUrl?: string;
  clientToken?: string;
  mode: YengapayMode;
};

export type YengapayWebhookEvent = {
  providerEventId: string;
  eventType: "payment.pending" | "payment.succeeded" | "payment.failed" | "payment.cancelled" | "withdrawal.succeeded" | "withdrawal.failed";
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

const DEFAULT_SANDBOX_BASE_URL = "https://api.sandbox.yengapay.com/api/v1";
const DEFAULT_LIVE_BASE_URL = "https://api.yengapay.com/api/v1";

function configuredValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function isRemoteMode(mode: YengapayMode): mode is "sandbox" | "live" {
  return mode === "sandbox" || mode === "live";
}

export function readYengapayConfig(): YengapayProviderConfig {
  const explicitMode = (process.env.YENGAPAY_MODE ?? "test").trim().toLowerCase();
  const apiKey = configuredValue(process.env.YENGAPAY_API_KEY);
  const orgId = configuredValue(process.env.YENGAPAY_ORG_ID);
  const projectId = configuredValue(process.env.YENGAPAY_PROJECT_ID);
  const webhookSecret = configuredValue(process.env.YENGAPAY_WEBHOOK_SECRET);
  const credentialsReady = Boolean(apiKey && orgId && projectId);
  const requestedMode: YengapayMode = explicitMode === "sandbox" ? "sandbox" : explicitMode === "live" ? "live" : "test";
  const mode = requestedMode === "test" || !credentialsReady ? "test" : requestedMode;
  const defaultBaseUrl = mode === "sandbox" ? DEFAULT_SANDBOX_BASE_URL : DEFAULT_LIVE_BASE_URL;
  const baseUrl = configuredValue(process.env.YENGAPAY_BASE_URL) ?? defaultBaseUrl;
  return { mode, apiKey, orgId, projectId, baseUrl, webhookSecret };
}

/** Un déploiement Live ne démarre jamais sans vérification HMAC des webhooks. */
export function assertYengapayWebhookSecretConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;
  const config = readYengapayConfig();
  if (config.mode !== "live" || config.webhookSecret) return;
  throw new Error("YENGAPAY_MODE=live en production sans YENGAPAY_WEBHOOK_SECRET. Configurez le secret avant de redémarrer.");
}

function generateTestReference(prefix: string) {
  return `${prefix}_test_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPositiveAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

async function callYengapay<T>(config: YengapayProviderConfig, path: string, init: RequestInit): Promise<T> {
  if (!config.apiKey || !config.orgId || !config.projectId || !isRemoteMode(config.mode)) {
    throw new Error("YengaPay externe requiert un mode sandbox/live et YENGAPAY_API_KEY, YENGAPAY_ORG_ID, YENGAPAY_PROJECT_ID.");
  }
  const url = `${config.baseUrl.replace(/\/$/, "")}/groups/${encodeURIComponent(config.orgId)}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`YengaPay ${response.status} : ${text.slice(0, 1200)}`);
  }
  return await response.json() as T;
}

export type CreateCheckoutInput = {
  paymentTransactionId: string;
  amount: number;
  type: "deposit" | "withdrawal";
  phone: string;
  description?: string;
};

/**
 * Crée le Checkout hébergé YengaPay. Les retraits restent hors de ce flux :
 * ils requièrent un projet Payout ou Cash-Out validé par le marchand.
 */
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
  if (input.type !== "deposit") throw new Error("Les retraits YengaPay ne sont pas activés : un projet Payout/Cash-Out est requis.");

  const reference = `TIKIS-${input.paymentTransactionId}`;
  const data = await callYengapay<Record<string, unknown>>(config, `/payment-intent/${encodeURIComponent(config.projectId!)}`, {
    method: "POST",
    body: JSON.stringify({
      paymentAmount: input.amount,
      reference,
      customerNumber: input.phone,
      articles: [{ title: "Rechargement Wallet Tikis", description: input.description ?? "Dépôt sécurisé pour le Wallet Tikis", price: input.amount }],
      additionalInfos: { tikisPaymentTransactionId: input.paymentTransactionId, purpose: "wallet_deposit" },
    }),
  });
  const providerReference = asNonEmptyString(data.paymentIntentId) ?? asNonEmptyString(data.id) ?? asNonEmptyString(data.reference);
  const checkoutUrl = asNonEmptyString(data.checkoutPageUrlWithPaymentToken) ?? asNonEmptyString(data.checkoutUrl) ?? asNonEmptyString(data.redirectUrl);
  if (!providerReference || !checkoutUrl) throw new Error("La réponse YengaPay ne contient pas l’identifiant ou l’URL de checkout attendus.");

  return {
    paymentTransactionId: input.paymentTransactionId,
    providerReference,
    amount: input.amount,
    type: input.type,
    checkoutUrl,
    clientToken: asNonEmptyString(data.token),
    mode: config.mode,
  };
}

export type VerifyCheckoutInput = { providerReference: string };
export type VerifyCheckoutResult = {
  providerReference: string;
  status: "succeeded" | "failed" | "pending" | "cancelled";
  amount: number;
};

function normalizeRemoteStatus(status: unknown): VerifyCheckoutResult["status"] {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (["DONE", "SUCCESS", "SUCCEEDED", "COMPLETED", "PAID"].includes(normalized)) return "succeeded";
  if (["FAILED", "FAIL", "DECLINED", "REJECTED"].includes(normalized)) return "failed";
  if (["CANCELLED", "CANCELED", "EXPIRED"].includes(normalized)) return "cancelled";
  return "pending";
}

export async function verifyYengapayPayment(input: VerifyCheckoutInput): Promise<VerifyCheckoutResult> {
  const config = readYengapayConfig();
  if (config.mode === "test") return { providerReference: input.providerReference, status: "pending", amount: 0 };
  const data = await callYengapay<Record<string, unknown>>(config, `/payment-intent/project/${encodeURIComponent(config.projectId!)}/intent/${encodeURIComponent(input.providerReference)}`, { method: "GET" });
  return {
    providerReference: input.providerReference,
    status: normalizeRemoteStatus(data.paymentStatus ?? data.transactionStatus ?? data.status),
    amount: asPositiveAmount(data.paymentAmount ?? data.amount),
  };
}

export function verifyYengapayWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string | null): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "").trim();
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

export function parseYengapayWebhookEvent(rawBody: string, signature: string | null, headerEvent?: string | null): YengapayWebhookEvent {
  const parsed = JSON.parse(rawBody) as Record<string, unknown>;
  const data = (parsed.data ?? parsed) as Record<string, unknown>;
  const status = normalizeRemoteStatus(data.paymentStatus ?? data.transactionStatus ?? data.status);
  const rawEvent = asNonEmptyString(headerEvent ?? undefined) ?? asNonEmptyString(parsed.type) ?? asNonEmptyString(parsed.event);
  const withdrawal = rawEvent?.startsWith("payout.") || rawEvent?.startsWith("withdrawal.");
  const eventType = withdrawal
    ? (status === "succeeded" ? "withdrawal.succeeded" : "withdrawal.failed")
    : (status === "succeeded" ? "payment.succeeded" : status === "cancelled" ? "payment.cancelled" : status === "pending" ? "payment.pending" : "payment.failed");
  const providerEventId = asNonEmptyString(data.transId) ?? asNonEmptyString(data.transactionId) ?? asNonEmptyString(parsed.id) ?? asNonEmptyString(parsed.eventId) ?? asNonEmptyString(data.paymentIntentId) ?? `auto-${Date.now()}`;
  const providerReference = asNonEmptyString(data.paymentIntentId) ?? asNonEmptyString(data.id) ?? asNonEmptyString(data.reference) ?? "";
  if (!providerReference) throw new Error("Le webhook YengaPay ne contient pas de référence de paiement.");
  return {
    providerEventId,
    eventType,
    providerReference,
    amount: asPositiveAmount(data.paymentAmount ?? data.amount),
    rawPayload: rawBody,
    signature,
  };
}
