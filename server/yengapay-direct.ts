import { randomUUID } from "node:crypto";
import { assertSimulatedSettlementAllowed, readYengapayConfig, asNonEmptyString, yengapayNotConfiguredError, yengapayProviderError } from "./yengapay";
import * as db from "./db";
import { buildUssdCode, type YengapayOperatorCode } from "../shared/yengapay-ussd";

export type YengapayDirectOperator = YengapayOperatorCode;

type RemoteOperator = "ORANGE" | "MOOV";
type RemoteFlow = "ONE_STEP" | "TWO_STEP";

type RemoteOperatorInfo = {
  code?: unknown;
  name?: unknown;
  countryCode?: unknown;
  flow?: unknown;
  ussdCode?: unknown;
  ussdDescription?: unknown;
};

type RemoteDirectResponse = Record<string, unknown> & {
  status?: unknown;
  paymentIntentId?: unknown;
  transactionId?: unknown;
  amount?: unknown;
  fees?: unknown;
  totalAmount?: unknown;
  availableOperators?: unknown;
  nextStep?: unknown;
};

export type YengapayDirectDepositRequest = {
  profilePhone: string;
  amount: number;
  phone: string;
  operator: YengapayOperatorCode;
  countryCode: string;
  idempotencyKey: string;
};

export type YengapayDirectDeposit = {
  transactionId: string;
  providerReference: string;
  ussdCode: string;
  amount: number;
  phone: string;
  operator: YengapayOperatorCode;
  countryCode: string;
  expiresAt: string;
  status: "pending" | "succeeded" | "failed" | "cancelled" | "expired";
  mode: "test" | "sandbox" | "live";
  requiresOtp: boolean;
  flow: RemoteFlow | "TEST";
  otpInstructions?: string;
};

function remoteOperator(operator: YengapayOperatorCode): RemoteOperator {
  return operator === "orange_money" ? "ORANGE" : "MOOV";
}

function localOperator(operator: unknown): YengapayOperatorCode | null {
  const value = String(operator ?? "").trim().toUpperCase();
  if (value === "ORANGE" || value === "ORANGE_MONEY" || value === "ORANGEMONEYAPI") return "orange_money";
  if (value === "MOOV" || value === "MOOV_MONEY" || value === "MOOVMONEYAPI") return "moov_money";
  return null;
}

function asAmount(value: unknown, fallback: number) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
}

function asFlow(value: unknown, operator: YengapayOperatorCode): RemoteFlow {
  return String(value ?? "").trim().toUpperCase() === "TWO_STEP" || operator === "moov_money" ? "TWO_STEP" : "ONE_STEP";
}

function remoteStatus(value: unknown): YengapayDirectDeposit["status"] {
  const status = String(value ?? "").trim().toUpperCase();
  if (["DONE", "SUCCESS", "SUCCEEDED", "COMPLETED", "PAID"].includes(status)) return "succeeded";
  if (["FAILED", "FAIL", "DECLINED", "REJECTED"].includes(status)) return "failed";
  if (["CANCELLED", "CANCELED"].includes(status)) return "cancelled";
  if (["EXPIRED", "TIMEOUT", "TIMED_OUT"].includes(status)) return "expired";
  return "pending";
}

function directPath(config: ReturnType<typeof readYengapayConfig>, suffix: string) {
  return `${config.baseUrl.replace(/\/$/, "")}/groups/${encodeURIComponent(config.orgId!)}/projects/${encodeURIComponent(config.projectId!)}/direct-payment${suffix}`;
}

async function callDirect(config: ReturnType<typeof readYengapayConfig>, suffix: string, body: Record<string, unknown>) {
  if (!config.apiKey || !config.orgId || !config.projectId || (config.mode !== "sandbox" && config.mode !== "live")) {
    throw yengapayNotConfiguredError();
  }
  const response = await fetch(directPath(config, suffix), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": config.apiKey },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => "");
  let data: RemoteDirectResponse = {};
  try {
    data = text ? JSON.parse(text) as RemoteDirectResponse : {};
  } catch {
    data = {};
  }
  if (!response.ok) throw yengapayProviderError(`paiement direct ${suffix}`, response.status, text);
  return data;
}

async function callDirectGet(config: ReturnType<typeof readYengapayConfig>, providerReference: string) {
  if (!config.apiKey || !config.orgId || !config.projectId || (config.mode !== "sandbox" && config.mode !== "live")) {
    throw yengapayNotConfiguredError();
  }
  const url = `${config.baseUrl.replace(/\/$/, "")}/groups/${encodeURIComponent(config.orgId)}/payment-intent/project/${encodeURIComponent(config.projectId)}/intent/${encodeURIComponent(providerReference)}`;
  const response = await fetch(url, { method: "GET", headers: { "x-api-key": config.apiKey }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  return await response.json() as RemoteDirectResponse;
}

function selectedRemoteOperator(data: RemoteDirectResponse, input: YengapayDirectDepositRequest): { flow: RemoteFlow; ussdCode: string; otpInstructions?: string } {
  const operators = Array.isArray(data.availableOperators) ? data.availableOperators as RemoteOperatorInfo[] : [];
  const requested = remoteOperator(input.operator);
  const selected = operators.find((item) => String(item.code ?? "").trim().toUpperCase() === requested);
  if (!selected) throw new Error(`${input.operator === "orange_money" ? "Orange Money" : "Moov Money"} n'est pas disponible pour ce projet YengaPay.`);
  const flow = asFlow(selected.flow, input.operator);
  const ussdCode = asNonEmptyString(selected.ussdCode) ?? buildUssdCode(input.operator, input.amount);
  const otpInstructions = asNonEmptyString(selected.ussdDescription) ?? (flow === "ONE_STEP"
    ? `Composez ${ussdCode} pour recevoir votre code OTP, puis saisissez-le ici.`
    : "YengaPay vous a envoyé votre code OTP par SMS. Saisissez-le ici.");
  return { flow, ussdCode, otpInstructions };
}

function viewFromStored(stored: db.DirectDepositRecord, mode: YengapayDirectDeposit["mode"]): YengapayDirectDeposit {
  // YengaPay ne crée que des paiements Orange Money et Moov Money (voir server/direct-deposit.ts).
  const operator = stored.operator as YengapayOperatorCode;
  const flow: RemoteFlow | "TEST" = mode === "test" ? "TEST" : operator === "moov_money" ? "TWO_STEP" : "ONE_STEP";
  const requiresOtp = mode !== "test";
  return {
    transactionId: stored.transactionId,
    providerReference: stored.providerReference,
    ussdCode: stored.ussdCode,
    amount: stored.amount,
    phone: stored.phone,
    operator,
    countryCode: stored.countryCode,
    expiresAt: stored.expiresAt,
    status: stored.status,
    mode,
    requiresOtp,
    flow,
    ...(requiresOtp ? { otpInstructions: flow === "ONE_STEP" ? `Composez ${stored.ussdCode} pour recevoir votre code OTP, puis saisissez-le ici.` : "YengaPay vous a envoyé votre code OTP par SMS. Saisissez-le ici." } : {}),
  };
}

export async function createYengapayDirectDeposit(input: YengapayDirectDepositRequest): Promise<YengapayDirectDeposit> {
  const config = readYengapayConfig();
  const existing = await db.getDirectDepositByIdempotencyKey(input.profilePhone, input.idempotencyKey);
  if (existing) return viewFromStored(existing, config.mode);
  const transactionId = randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  if (config.mode === "test") {
    const providerReference = `direct_test_${transactionId}`;
    const ussdCode = buildUssdCode(input.operator, input.amount);
    await db.recordDirectDepositIntent({ transactionId, profilePhone: input.profilePhone, amount: input.amount, phone: input.phone, operator: input.operator, countryCode: input.countryCode, ussdCode, expiresAt, providerReference, idempotencyKey: input.idempotencyKey, mode: "test" });
    return { transactionId, providerReference, ussdCode, amount: input.amount, phone: input.phone, operator: input.operator, countryCode: input.countryCode, expiresAt, status: "pending", mode: "test", requiresOtp: false, flow: "TEST" };
  }

  const reference = `TIKISSE-DIRECT-${transactionId}`;
  const initData = await callDirect(config, "/init", {
    amount: input.amount,
    articles: [{ title: "Rechargement Wallet Tikisse", description: "Dépôt Mobile Money direct via YengaPay", price: input.amount }],
    reference,
  });
  const providerReference = asNonEmptyString(initData.paymentIntentId);
  if (!providerReference) throw new Error("YengaPay n'a pas retourné de paymentIntentId pour le paiement direct.");
  const selected = selectedRemoteOperator(initData, input);
  await db.recordDirectDepositIntent({ transactionId, profilePhone: input.profilePhone, amount: input.amount, phone: input.phone, operator: input.operator, countryCode: input.countryCode, ussdCode: selected.ussdCode, expiresAt, providerReference, idempotencyKey: input.idempotencyKey, mode: config.mode });

  if (selected.flow === "TWO_STEP") {
    await callDirect(config, "/send-otp", { paymentIntentId: providerReference, operatorCode: remoteOperator(input.operator), countryCode: input.countryCode, customerMSISDN: input.phone.replace(/^\+/, "") });
  }

  return { transactionId, providerReference, ussdCode: selected.ussdCode, amount: input.amount, phone: input.phone, operator: input.operator, countryCode: input.countryCode, expiresAt, status: "pending", mode: config.mode, requiresOtp: true, flow: selected.flow, otpInstructions: selected.otpInstructions };
}

export async function payYengapayDirectDeposit(input: { profilePhone: string; transactionId: string; otp: string }): Promise<YengapayDirectDeposit> {
  const config = readYengapayConfig();
  const stored = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (!stored) throw new Error("Transaction de dépôt introuvable ou expirée.");
  if (stored.status !== "pending") return viewFromStored(stored, config.mode);
  if (!/^[0-9]{4,12}$/.test(input.otp)) throw new Error("Le code OTP doit contenir uniquement 4 à 12 chiffres.");
  if (config.mode === "test") return viewFromStored(stored, config.mode);

  const data = await callDirect(config, "/pay", {
    paymentIntentId: stored.providerReference,
    operatorCode: remoteOperator(stored.operator as YengapayOperatorCode),
    countryCode: stored.countryCode,
    customerMSISDN: stored.phone.replace(/^\+/, ""),
    otp: input.otp,
  });
  const status = remoteStatus(data.status ?? data.transactionStatus ?? data.paymentStatus);
  if (status === "succeeded") await db.settleTikisseWalletDepositRequest({ profilePhone: input.profilePhone, transactionId: input.transactionId });
  else if (status === "failed") await db.refuseTikisseWalletDepositRequest({ profilePhone: input.profilePhone, transactionId: input.transactionId });
  else if (status === "cancelled" || status === "expired") await db.cancelTikisseWalletDirectDeposit({ profilePhone: input.profilePhone, transactionId: input.transactionId, status });
  const updated = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (!updated) throw new Error("La transaction directe n'est plus disponible.");
  return viewFromStored(updated, config.mode);
}

export async function resendYengapayDirectOtp(input: { profilePhone: string; transactionId: string }): Promise<YengapayDirectDeposit> {
  const config = readYengapayConfig();
  const stored = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (!stored) throw new Error("Transaction de dépôt introuvable ou expirée.");
  if (stored.status !== "pending") return viewFromStored(stored, config.mode);
  if (config.mode === "test" || stored.operator !== "moov_money") return viewFromStored(stored, config.mode);
  await callDirect(config, "/send-otp", {
    paymentIntentId: stored.providerReference,
    operatorCode: "MOOV",
    countryCode: stored.countryCode,
    customerMSISDN: stored.phone.replace(/^\+/, ""),
  });
  return viewFromStored(stored, config.mode);
}

export async function getYengapayDirectDepositStatus(input: { profilePhone: string; transactionId: string }): Promise<YengapayDirectDeposit> {
  const config = readYengapayConfig();
  const stored = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (!stored) throw new Error("Transaction de dépôt introuvable ou expirée.");
  const pastDeadline = stored.status === "pending" && new Date(stored.expiresAt).getTime() <= Date.now();
  const expireLocally = async () => viewFromStored(await db.cancelTikisseWalletDirectDeposit({ profilePhone: input.profilePhone, transactionId: input.transactionId, status: "expired" }), config.mode);
  if (stored.status !== "pending") return viewFromStored(stored, config.mode);
  if (config.mode === "test") return pastDeadline ? expireLocally() : viewFromStored(stored, config.mode);
  // Passé le délai, on demande d'abord à YengaPay : le client a pu valider son code à la dernière
  // minute. Le déclarer expiré sans le vérifier affichait un échec pour un paiement réussi.
  const data = await callDirectGet(config, stored.providerReference);
  if (!data) return pastDeadline ? expireLocally() : viewFromStored(stored, config.mode);
  // Sur une intention, seuls `paymentStatus`/`transactionStatus` disent l'état du paiement (docs/yengapay-
  // integration-notes.md). Un `status` générique n'est pas lu : s'il désignait l'enveloppe de la réponse
  // (« requête réussie »), un paiement jamais effectué aurait été crédité. À défaut, le webhook tranche.
  const status = remoteStatus(data.paymentStatus ?? data.transactionStatus);
  if (status === "pending" && pastDeadline) return expireLocally();
  if (status === "succeeded") await db.settleTikisseWalletDepositRequest({ profilePhone: input.profilePhone, transactionId: input.transactionId });
  else if (status === "failed") await db.refuseTikisseWalletDepositRequest({ profilePhone: input.profilePhone, transactionId: input.transactionId });
  else if (status === "cancelled" || status === "expired") await db.cancelTikisseWalletDirectDeposit({ profilePhone: input.profilePhone, transactionId: input.transactionId, status });
  const updated = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  return updated ? viewFromStored(updated, config.mode) : viewFromStored(stored, config.mode);
}

export async function cancelYengapayDirectDeposit(input: { profilePhone: string; transactionId: string }) {
  const result = await db.cancelTikisseWalletDirectDeposit({ profilePhone: input.profilePhone, transactionId: input.transactionId, status: "cancelled" });
  return viewFromStored(result, readYengapayConfig().mode);
}

export async function settleYengapayDirectDepositTest(input: { profilePhone: string; transactionId: string; outcome: "succeeded" | "failed" }): Promise<YengapayDirectDeposit> {
  const stored = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (!stored) throw new Error("Transaction de dépôt introuvable ou expirée.");
  // Le mode du serveur ne suffit pas : c'est la transaction qui doit être née en mode test.
  assertSimulatedSettlementAllowed(`yengapay_direct_${stored.mode}`);
  if (input.outcome === "succeeded") await db.settleTikisseWalletDepositRequest({ profilePhone: input.profilePhone, transactionId: input.transactionId });
  else await db.refuseTikisseWalletDepositRequest({ profilePhone: input.profilePhone, transactionId: input.transactionId });
  return getYengapayDirectDepositStatus({ profilePhone: input.profilePhone, transactionId: input.transactionId });
}
