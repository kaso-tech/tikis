import { randomUUID } from "node:crypto";
import { readYengapayConfig, asNonEmptyString } from "./yengapay";
import * as db from "./db";
import { buildUssdCode, type YengapayOperatorCode } from "../shared/yengapay-ussd";

/**
 * Paiement Mobile Money direct (in-app, sans redirection web).
 *
 * Flow complet :
 *  1. Client -> tRPC wallet.requestDirectDeposit({ amount, countryCode, phoneLocal, operator })
 *  2. Serveur -> crée un payment_intent YengaPay avec paymentSource: orange_money | moov_money
 *  3. YengaPay déclenche un push USSD sur le téléphone du client
 *  4. Client compose le code USSD (lien tel: fourni), reçoit un OTP par SMS
 *  5. Client -> tRPC wallet.checkDirectDepositStatus({ transactionId }) -> polling
 *  6. Webhook YengaPay -> server/yengapay.ts parseYengapayWebhookEvent -> payment.succeeded
 *  7. Webhook handler crédite le Wallet via requestTikisWalletOperation
 *
 * En mode test (pas de clé sandbox), on simule le flow : on retourne immédiatement un
 * transactionId, le client suit le même flow de polling, et settleDirectDepositTest
 * permet de créditer ou refuser manuellement.
 */

export type YengapayDirectOperator = YengapayOperatorCode;

export type YengapayDirectDepositRequest = {
  profilePhone: string;
  amount: number;
  phone: string;          // E.164 international, ex: +22670707070
  operator: YengapayOperatorCode;
  countryCode: string;
};

export type YengapayDirectDeposit = {
  transactionId: string;     // ID interne Tikis (UUID)
  providerReference: string;  // ID YengaPay (paymentIntentId) ou test ref
  ussdCode: string;          // Code USSD à composer (*144*4*6*<montant># ou similaire)
  amount: number;
  phone: string;
  operator: YengapayOperatorCode;
  countryCode: string;       // Code ISO du pays (BF, CI, BJ, etc.)
  expiresAt: string;         // ISO 8601, expiration de la demande USSD
  status: "pending" | "succeeded" | "failed" | "cancelled" | "expired";
  mode: "test" | "sandbox" | "live";
};

/** Crée la demande de dépôt direct.
 *  - En mode test : génère un transactionId interne et un providerReference factice.
 *    L'opérateur peut ensuite appeler settleDirectDepositTest pour simuler succès/échec.
 *  - En mode sandbox/live : appelle l'API REST YengaPay avec paymentSource.
 *    Retourne le paymentIntentId (providerReference) + le code USSD. */
export async function createYengapayDirectDeposit(input: YengapayDirectDepositRequest): Promise<YengapayDirectDeposit> {
  const config = readYengapayConfig();
  const transactionId = randomUUID();
  const ussdCode = buildUssdCode(input.operator, input.amount);
  // Expiration 5 minutes : la plupart des opérateurs expirent la demande USSD après 60-120s.
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  if (config.mode === "test") {
    // Mode test : pas d'appel YengaPay. On stocke un record factice pour le polling.
    await db.recordDirectDepositIntent({
      transactionId,
      profilePhone: input.profilePhone,
      amount: input.amount,
      phone: input.phone,
      operator: input.operator,
      countryCode: input.countryCode,
      ussdCode,
      expiresAt,
      mode: "test",
    });
    return {
      transactionId,
      providerReference: `test_direct_${Date.now()}`,
      ussdCode,
      amount: input.amount,
      phone: input.phone,
      operator: input.operator,
      countryCode: input.countryCode,
      expiresAt,
      status: "pending",
      mode: "test",
    };
  }

  // Mode sandbox / live : appel API YengaPay avec paymentSource.
  if (!config.apiKey || !config.orgId || !config.projectId) {
    throw new Error("YengaPay externe requiert YENGAPAY_API_KEY, YENGAPAY_ORG_ID, YENGAPAY_PROJECT_ID.");
  }

  // Crée d'abord l'opération Wallet (status "deposit_request") pour qu'on ait une trace interne.
  await db.requestTikisWalletOperation(input.profilePhone, "deposit", input.amount, transactionId);

  const reference = `TIKIS-DIRECT-${transactionId}`;
  const url = `${config.baseUrl.replace(/\/$/, "")}/groups/${encodeURIComponent(config.orgId)}/payment-intent/${encodeURIComponent(config.projectId)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": config.apiKey },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      paymentAmount: input.amount,
      reference,
      customerNumber: input.phone,
      paymentSource: input.operator,
      articles: [{
        title: "Rechargement Wallet Tikis",
        description: "Dépôt Mobile Money direct via YengaPay",
        price: input.amount,
      }],
      additionalInfos: {
        tikisTransactionId: transactionId,
        purpose: "wallet_deposit_direct",
        countryCode: input.countryCode,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`YengaPay ${response.status} : ${text.slice(0, 1200)}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const providerReference = asNonEmptyString(data.paymentIntentId) ?? asNonEmptyString(data.id) ?? asNonEmptyString(data.reference);
  if (!providerReference) throw new Error("YengaPay n'a pas retourné d'identifiant de paiement.");

  await db.recordDirectDepositIntent({
    transactionId,
    profilePhone: input.profilePhone,
    amount: input.amount,
    phone: input.phone,
    operator: input.operator,
    countryCode: input.countryCode,
    ussdCode,
    expiresAt,
    providerReference,
    mode: config.mode,
  });

  return {
    transactionId,
    providerReference,
    ussdCode,
    amount: input.amount,
    phone: input.phone,
    operator: input.operator,
    countryCode: input.countryCode,
    expiresAt,
    status: "pending",
    mode: config.mode,
  };
}

/** Status de la demande — appelé en polling depuis le client.
 *  - En mode test : lit la table directe_deposits (mise à jour par settleDirectDepositTest).
 *  - En mode sandbox/live : interroge YengaPay et déclenche le crédit Wallet si succeeded. */
export async function getYengapayDirectDepositStatus(input: { profilePhone: string; transactionId: string }): Promise<YengapayDirectDeposit> {
  const config = readYengapayConfig();
  const stored = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (!stored) throw new Error("Transaction de dépôt introuvable ou expirée.");
  if (config.mode === "test") {
    return {
      transactionId: stored.transactionId,
      providerReference: stored.providerReference,
      ussdCode: stored.ussdCode,
      amount: stored.amount,
      phone: stored.phone,
      operator: stored.operator,
      countryCode: stored.countryCode,
      expiresAt: stored.expiresAt,
      status: stored.status,
      mode: "test",
    };
  }
  // Mode sandbox/live : interroge YengaPay pour récupérer le statut courant.
  if (!config.apiKey || !config.orgId || !config.projectId) {
    throw new Error("YengaPay externe requiert YENGAPAY_API_KEY, YENGAPAY_ORG_ID, YENGAPAY_PROJECT_ID.");
  }
  if (stored.status === "succeeded" || stored.status === "failed") {
    return {
      transactionId: stored.transactionId,
      providerReference: stored.providerReference,
      ussdCode: stored.ussdCode,
      amount: stored.amount,
      phone: stored.phone,
      operator: stored.operator,
      countryCode: stored.countryCode,
      expiresAt: stored.expiresAt,
      status: stored.status,
      mode: config.mode,
    };
  }
  const url = `${config.baseUrl.replace(/\/$/, "")}/groups/${encodeURIComponent(config.orgId)}/payment-intent/project/${encodeURIComponent(config.projectId)}/intent/${encodeURIComponent(stored.providerReference)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": config.apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Échec réseau : on conserve le statut pending et on laisse le client réessayer.
    return {
      transactionId: stored.transactionId,
      providerReference: stored.providerReference,
      ussdCode: stored.ussdCode,
      amount: stored.amount,
      phone: stored.phone,
      operator: stored.operator,
      countryCode: stored.countryCode,
      expiresAt: stored.expiresAt,
      status: stored.status,
      mode: config.mode,
    };
  }
  const data = await response.json() as Record<string, unknown>;
  const remoteStatus = String(data.paymentStatus ?? data.transactionStatus ?? data.status ?? "").trim().toUpperCase();
  let normalized: YengapayDirectDeposit["status"] = "pending";
  if (["DONE", "SUCCESS", "SUCCEEDED", "COMPLETED", "PAID"].includes(remoteStatus)) normalized = "succeeded";
  else if (["FAILED", "FAIL", "DECLINED", "REJECTED"].includes(remoteStatus)) normalized = "failed";
  else if (["CANCELLED", "CANCELED", "EXPIRED"].includes(remoteStatus)) normalized = "cancelled";

  if (normalized === "succeeded") {
    await db.settleTikisWalletDepositRequest({ profilePhone: input.profilePhone, transactionId: input.transactionId });
  } else if (normalized === "failed") {
    await db.refuseTikisWalletDepositRequest({ profilePhone: input.profilePhone, transactionId: input.transactionId });
  }

  return {
    transactionId: stored.transactionId,
    providerReference: stored.providerReference,
    ussdCode: stored.ussdCode,
    amount: stored.amount,
    phone: stored.phone,
    operator: stored.operator,
    countryCode: stored.countryCode,
    expiresAt: stored.expiresAt,
    status: normalized,
    mode: config.mode,
  };
}

/** Permet de simuler manuellement succès/échec en mode test. */
export async function settleYengapayDirectDepositTest(input: { profilePhone: string; transactionId: string; outcome: "succeeded" | "failed" }): Promise<YengapayDirectDeposit> {
  if (input.outcome === "succeeded") {
    await db.settleTikisWalletDepositRequest({ profilePhone: input.profilePhone, transactionId: input.transactionId });
  } else {
    await db.refuseTikisWalletDepositRequest({ profilePhone: input.profilePhone, transactionId: input.transactionId });
  }
  return getYengapayDirectDepositStatus({ profilePhone: input.profilePhone, transactionId: input.transactionId });
}
