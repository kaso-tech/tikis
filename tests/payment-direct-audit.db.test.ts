/**
 * Audit du paiement direct YengaPay, exécuté contre une vraie base MySQL/MariaDB.
 *
 * Ces tests appellent les fonctions qui créditent réellement les Wallets — règlement, webhook —, sans
 * rien simuler de la base : ce sont elles qu'un défaut ferait payer en argent. Ils ne tournent que si
 * TIKISSE_TEST_DATABASE_URL désigne une base jetable dont le schéma a été poussé :
 *
 *   DATABASE_URL=<url> npx drizzle-kit push --force
 *   TIKISSE_TEST_DATABASE_URL=<url> npx vitest run tests/payment-direct-audit.db.test.ts
 *
 * Jamais une base de production : chaque test crée ses propres profils et transactions.
 */
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TIKISSE_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const SECRET = "whsec_audit_test_only";
const YENGAPAY_ENV = ["YENGAPAY_MODE", "YENGAPAY_API_KEY", "YENGAPAY_ORG_ID", "YENGAPAY_PROJECT_ID", "YENGAPAY_WEBHOOK_SECRET", "NODE_ENV"] as const;
const savedEnv = Object.fromEntries(YENGAPAY_ENV.map((key) => [key, process.env[key]]));

function useRemoteMode(mode: "sandbox" | "live" = "sandbox") {
  process.env.YENGAPAY_MODE = mode;
  process.env.YENGAPAY_API_KEY = "audit-key";
  process.env.YENGAPAY_ORG_ID = "audit-org";
  process.env.YENGAPAY_PROJECT_ID = "audit-project";
  process.env.YENGAPAY_WEBHOOK_SECRET = SECRET;
}

function useTestMode() {
  for (const key of ["YENGAPAY_API_KEY", "YENGAPAY_ORG_ID", "YENGAPAY_PROJECT_ID", "YENGAPAY_WEBHOOK_SECRET"]) delete process.env[key];
  process.env.YENGAPAY_MODE = "test";
}

const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  for (const key of YENGAPAY_ENV) {
    if (savedEnv[key] === undefined) delete env[key];
    else env[key] = savedEnv[key];
  }
});

type Db = typeof import("../server/db");
let db: Db;
let schema: typeof import("../drizzle/schema");

beforeAll(async () => {
  if (!TEST_DB) return;
  db = await import("../server/db");
  schema = await import("../drizzle/schema");
});

const newPhone = () => `+22670${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

async function balance(phone: string) {
  return (await db.getTikisseWalletSnapshot(phone)).total;
}

/** Une transaction en attente, telle que la créent les parcours checkout ou paiement direct. */
async function pendingPayment(phone: string, provider: "yengapay_test" | "yengapay_live" | "yengapay_sandbox" | "yengapay_direct_test" | "yengapay_direct_live" | "yengapay_direct_sandbox", amount = 5000) {
  const handle = (await db.getDb())!;
  const id = randomUUID();
  const providerReference = `pi_audit_${id}`;
  await handle.insert(schema.tikissePaymentTransactions).values({
    id, profilePhone: phone, type: "deposit", provider, amount, status: "pending", providerReference,
    checkoutUrl: null, idempotencyKey: `audit:${id}`,
    ...(provider.startsWith("yengapay_direct_") ? { phoneE164: phone, operatorCode: "orange_money", countryCode: "BF", ussdCode: "*144#", expiresAt: new Date(Date.now() + 15 * 60_000) } : {}),
  });
  return { id, providerReference, amount };
}

function signedWebhook(data: Record<string, unknown>, type = "payment.succeeded") {
  const rawBody = JSON.stringify({ type, data });
  return { rawBody, signature: createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex"), headerEvent: null };
}

describe.skipIf(!TEST_DB)("paiement direct — la route de règlement test ne crédite jamais une transaction réelle", () => {
  it("refuse de régler une transaction checkout live", async () => {
    useRemoteMode("live");
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_live", 10_000_000);
    await expect(db.settleYengaPayTestPayment({ profilePhone: phone, paymentId: payment.id, outcome: "succeeded" })).rejects.toThrow();
    expect(await balance(phone)).toBe(0);
  });

  it("refuse de régler un dépôt direct live", async () => {
    useRemoteMode("live");
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_live", 10_000_000);
    await expect(db.settleYengaPayTestPayment({ profilePhone: phone, paymentId: payment.id, outcome: "succeeded" })).rejects.toThrow();
    expect(await balance(phone)).toBe(0);
  });

  it("refuse même quand le serveur est en mode test, si la transaction a été créée en sandbox ou live", async () => {
    // Le mode peut changer entre la création et le règlement : c'est la transaction qui fait foi.
    useTestMode();
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", 7000);
    const { settleYengapayDirectDepositTest } = await import("../server/yengapay-direct");
    await expect(settleYengapayDirectDepositTest({ profilePhone: phone, transactionId: payment.id, outcome: "succeeded" })).rejects.toThrow();
    await expect(db.settleYengaPayTestPayment({ profilePhone: phone, paymentId: payment.id, outcome: "succeeded" })).rejects.toThrow();
    expect(await balance(phone)).toBe(0);
  });

  it("refuse en production quand le mode test n'est pas déclaré, mais seulement supposé par défaut", async () => {
    // Un déploiement qui aurait oublié YENGAPAY_MODE tombe en mode test : sans ce garde-fou, chaque
    // dépôt y serait « réussi » à la demande de l'utilisateur.
    useTestMode();
    delete env.YENGAPAY_MODE;
    env.NODE_ENV = "production";
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_test", 5000);
    await expect(db.settleYengaPayTestPayment({ profilePhone: phone, paymentId: payment.id, outcome: "succeeded" })).rejects.toThrow(/YENGAPAY_MODE=test/);
    expect(await balance(phone)).toBe(0);
  });

  it("règle toujours une vraie transaction de test, en mode test", async () => {
    useTestMode();
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_test", 2500);
    await db.settleYengaPayTestPayment({ profilePhone: phone, paymentId: payment.id, outcome: "succeeded" });
    expect(await balance(phone)).toBe(2500);
  });
});

describe.skipIf(!TEST_DB)("paiement direct — un paiement confirmé par YengaPay est toujours crédité", () => {
  it("après une annulation locale, le webhook de succès crédite quand même", async () => {
    useRemoteMode();
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", 3000);
    await db.cancelTikisseWalletDirectDeposit({ profilePhone: phone, transactionId: payment.id, status: "cancelled" });
    await db.settleYengapayLivePayment({ providerReference: payment.providerReference, outcome: "succeeded" });
    expect(await balance(phone)).toBe(3000);
  });

  it("après une expiration locale, le webhook de succès crédite quand même", async () => {
    useRemoteMode();
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", 4000);
    await db.cancelTikisseWalletDirectDeposit({ profilePhone: phone, transactionId: payment.id, status: "expired" });
    await db.settleYengapayLivePayment({ providerReference: payment.providerReference, outcome: "succeeded" });
    expect(await balance(phone)).toBe(4000);
  });

  it("après une expiration locale, le suivi côté app crédite aussi", async () => {
    useRemoteMode();
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", 4500);
    await db.cancelTikisseWalletDirectDeposit({ profilePhone: phone, transactionId: payment.id, status: "expired" });
    await db.settleTikisseWalletDepositRequest({ profilePhone: phone, transactionId: payment.id });
    expect(await balance(phone)).toBe(4500);
  });

  it("ne crédite qu'une fois quand le webhook et le suivi côté app confirment tous deux", async () => {
    useRemoteMode();
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", 6000);
    await db.settleYengapayLivePayment({ providerReference: payment.providerReference, outcome: "succeeded" });
    await db.settleTikisseWalletDepositRequest({ profilePhone: phone, transactionId: payment.id });
    await db.settleYengapayLivePayment({ providerReference: payment.providerReference, outcome: "succeeded" });
    expect(await balance(phone)).toBe(6000);
  });

  it("une annulation ou un échec tardif ne reprend jamais un dépôt déjà crédité", async () => {
    useRemoteMode();
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", 1500);
    await db.settleYengapayLivePayment({ providerReference: payment.providerReference, outcome: "succeeded" });
    await db.settleYengapayLivePayment({ providerReference: payment.providerReference, outcome: "failed" });
    await db.cancelTikisseWalletDirectDeposit({ profilePhone: phone, transactionId: payment.id, status: "cancelled" });
    expect(await balance(phone)).toBe(1500);
  });
});

describe.skipIf(!TEST_DB)("paiement direct — le webhook ne perd aucun événement", () => {
  it("« en attente » puis « réussi » pour un même paiement : le second crédite", async () => {
    // Les webhooks sans `transId` retombent sur `paymentIntentId` comme identifiant d'événement :
    // les deux portaient le même, et le succès était jeté comme doublon de l'attente.
    useRemoteMode();
    const { processYengapayWebhook } = await import("../server/yengapay-webhook");
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", 8000);
    await processYengapayWebhook(signedWebhook({ paymentIntentId: payment.providerReference, paymentStatus: "PENDING", paymentAmount: 8000 }, "payment.pending"));
    const result = await processYengapayWebhook(signedWebhook({ paymentIntentId: payment.providerReference, paymentStatus: "DONE", paymentAmount: 8000 }));
    expect(result.status).toBe(200);
    expect(await balance(phone)).toBe(8000);
  });

  it("un événement dont le règlement a échoué est traité à sa relivraison", async () => {
    // Le webhook arrive avant que la transaction soit enregistrée : le serveur répond 202 « réessaie ».
    // La relivraison du même événement était vue comme un doublon, et jamais réglée.
    useRemoteMode();
    const { processYengapayWebhook } = await import("../server/yengapay-webhook");
    const phone = newPhone();
    const providerReference = `pi_audit_race_${randomUUID()}`;
    const event = signedWebhook({ paymentIntentId: providerReference, transId: `trans_${randomUUID()}`, paymentStatus: "DONE", paymentAmount: 9000 });
    const first = await processYengapayWebhook(event);
    expect(first.status).toBe(202);

    const handle = (await db.getDb())!;
    await handle.insert(schema.tikissePaymentTransactions).values({
      id: randomUUID(), profilePhone: phone, type: "deposit", provider: "yengapay_direct_sandbox", amount: 9000, status: "pending",
      providerReference, checkoutUrl: null, idempotencyKey: `audit:${providerReference}`,
      phoneE164: phone, operatorCode: "orange_money", countryCode: "BF", ussdCode: "*144#", expiresAt: new Date(Date.now() + 60_000),
    });
    const retry = await processYengapayWebhook(event);
    expect(retry.status).toBe(200);
    expect(await balance(phone)).toBe(9000);
  });

  it("même chose pour un paiement checkout, où rien ne change la clé entre les deux livraisons", async () => {
    // Pour un dépôt direct, la relivraison passait par accident : la première livraison, faute de
    // transaction connue, était rangée sous le fournisseur « checkout », la seconde sous « direct ».
    useRemoteMode();
    const { processYengapayWebhook } = await import("../server/yengapay-webhook");
    const phone = newPhone();
    const providerReference = `pi_audit_race_checkout_${randomUUID()}`;
    const event = signedWebhook({ paymentIntentId: providerReference, transId: `trans_${randomUUID()}`, paymentStatus: "DONE", paymentAmount: 11_000 });
    expect((await processYengapayWebhook(event)).status).toBe(202);

    const handle = (await db.getDb())!;
    await handle.insert(schema.tikissePaymentTransactions).values({
      id: randomUUID(), profilePhone: phone, type: "deposit", provider: "yengapay_sandbox", amount: 11_000, status: "pending",
      providerReference, checkoutUrl: "https://checkout.example/pay", idempotencyKey: `audit:${providerReference}`,
    });
    expect((await processYengapayWebhook(event)).status).toBe(200);
    expect(await balance(phone)).toBe(11_000);
  });

  it("le même succès livré deux fois ne crédite qu'une fois", async () => {
    useRemoteMode();
    const { processYengapayWebhook } = await import("../server/yengapay-webhook");
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", 2000);
    const event = signedWebhook({ paymentIntentId: payment.providerReference, transId: `trans_${randomUUID()}`, paymentStatus: "DONE", paymentAmount: 2000 });
    await processYengapayWebhook(event);
    const again = await processYengapayWebhook(event);
    expect(again.status).toBe(200);
    expect(await balance(phone)).toBe(2000);
  });

  it("une signature invalide ne crédite rien", async () => {
    useRemoteMode();
    const { processYengapayWebhook } = await import("../server/yengapay-webhook");
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", 5000);
    const forged = signedWebhook({ paymentIntentId: payment.providerReference, paymentStatus: "DONE", paymentAmount: 5000 });
    const result = await processYengapayWebhook({ ...forged, signature: "0".repeat(64) });
    expect(result.status).toBe(400);
    expect(await balance(phone)).toBe(0);
  });
});

describe.skipIf(!TEST_DB)("paiement direct — le suivi côté app", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  async function overdueDeposit(phone: string, amount: number) {
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", amount);
    const handle = (await db.getDb())!;
    const { eq } = await import("drizzle-orm");
    await handle.update(schema.tikissePaymentTransactions).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.tikissePaymentTransactions.id, payment.id));
    return payment;
  }
  const intentResponse = (body: Record<string, unknown>) => { global.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch; };

  it("passé le délai, demande d'abord à YengaPay : un code validé à la dernière minute est crédité", async () => {
    useRemoteMode();
    const { getYengapayDirectDepositStatus } = await import("../server/yengapay-direct");
    const phone = newPhone();
    const payment = await overdueDeposit(phone, 3500);
    intentResponse({ id: payment.providerReference, transactionStatus: "DONE" });
    const view = await getYengapayDirectDepositStatus({ profilePhone: phone, transactionId: payment.id });
    expect(view.status).toBe("succeeded");
    expect(await balance(phone)).toBe(3500);
  });

  it("passé le délai et toujours en attente chez YengaPay : expiré, sans crédit", async () => {
    useRemoteMode();
    const { getYengapayDirectDepositStatus } = await import("../server/yengapay-direct");
    const phone = newPhone();
    const payment = await overdueDeposit(phone, 3500);
    intentResponse({ id: payment.providerReference, transactionStatus: "PENDING" });
    expect((await getYengapayDirectDepositStatus({ profilePhone: phone, transactionId: payment.id })).status).toBe("expired");
    expect(await balance(phone)).toBe(0);
  });

  it("ne prend jamais un `status` générique de la réponse pour un paiement réussi", async () => {
    useRemoteMode();
    const { getYengapayDirectDepositStatus } = await import("../server/yengapay-direct");
    const phone = newPhone();
    const payment = await pendingPayment(phone, "yengapay_direct_sandbox", 4200);
    intentResponse({ status: "SUCCESS", id: payment.providerReference });
    expect((await getYengapayDirectDepositStatus({ profilePhone: phone, transactionId: payment.id })).status).toBe("pending");
    expect(await balance(phone)).toBe(0);
  });
});
