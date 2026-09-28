/**
 * Lot A — contrôle financier de la console, exécuté contre une vraie base MySQL/MariaDB.
 *
 *   DATABASE_URL=<url> npx drizzle-kit push --force
 *   TIKIS_TEST_DATABASE_URL=<url> npx vitest run tests/admin-finance-control.db.test.ts
 *
 * Jamais une base de production : chaque test crée ses propres profils, transactions et mouvements.
 */
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TIKIS_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const SECRET = "whsec_lot_a_test_only";
const YENGAPAY_ENV = ["YENGAPAY_MODE", "YENGAPAY_API_KEY", "YENGAPAY_ORG_ID", "YENGAPAY_PROJECT_ID", "YENGAPAY_WEBHOOK_SECRET"] as const;
const env = process.env as Record<string, string | undefined>;
const savedEnv = Object.fromEntries(YENGAPAY_ENV.map((key) => [key, env[key]]));

function useRemoteMode() {
  env.YENGAPAY_MODE = "sandbox";
  env.YENGAPAY_API_KEY = "lot-a-key";
  env.YENGAPAY_ORG_ID = "lot-a-org";
  env.YENGAPAY_PROJECT_ID = "lot-a-project";
  env.YENGAPAY_WEBHOOK_SECRET = SECRET;
}

afterEach(() => {
  for (const key of YENGAPAY_ENV) {
    if (savedEnv[key] === undefined) delete env[key];
    else env[key] = savedEnv[key];
  }
});

let db: typeof import("../server/db");
let control: typeof import("../server/admin-finance-control");
let webhook: typeof import("../server/yengapay-webhook");
let schema: typeof import("../drizzle/schema");
let orm: typeof import("drizzle-orm");

beforeAll(async () => {
  if (!TEST_DB) return;
  db = await import("../server/db");
  control = await import("../server/admin-finance-control");
  webhook = await import("../server/yengapay-webhook");
  schema = await import("../drizzle/schema");
  orm = await import("drizzle-orm");
});

const newPhone = () => `+22672${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

function signedWebhook(data: Record<string, unknown>, type = "payment.succeeded") {
  const rawBody = JSON.stringify({ type, data });
  return { rawBody, signature: createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex"), headerEvent: null };
}

async function pendingDeposit(options: { phone?: string; amount?: number; providerReference?: string; createdAt?: Date } = {}) {
  const handle = (await db.getDb())!;
  const id = randomUUID();
  const providerReference = options.providerReference ?? `pi_lot_a_${id}`;
  await handle.insert(schema.tikisPaymentTransactions).values({
    id, profilePhone: options.phone ?? newPhone(), type: "deposit", provider: "yengapay_sandbox", amount: options.amount ?? 5000, status: "pending",
    providerReference, checkoutUrl: null, idempotencyKey: `lot-a:${id}`, ...(options.createdAt ? { createdAt: options.createdAt } : {}),
  });
  return { id, providerReference };
}

async function available(phone: string) {
  return (await db.getTikisWalletSnapshot(phone)).total;
}

async function eventByReference(providerReference: string) {
  const handle = (await db.getDb())!;
  const rows = await handle.select().from(schema.tikisYengapayWebhookEvents).where(orm.like(schema.tikisYengapayWebhookEvents.payload, `%${providerReference}%`));
  return rows;
}

describe.skipIf(!TEST_DB)("journal des webhooks et relance", () => {
  it("un webhook arrivé avant sa transaction échoue ; relancé depuis la console, il crédite sans attendre YengaPay", async () => {
    useRemoteMode();
    const phone = newPhone();
    const providerReference = `pi_lot_a_early_${randomUUID()}`;
    const reply = await webhook.processYengapayWebhook(signedWebhook({ paymentIntentId: providerReference, transId: `trans_${randomUUID()}`, paymentStatus: "DONE", paymentAmount: 5000 }));
    expect(reply.status).toBe(202);
    const [failed] = await eventByReference(providerReference);
    expect(failed).toMatchObject({ status: "failed" });

    await pendingDeposit({ phone, providerReference });
    const replay = await webhook.replayYengapayWebhookEvent(failed!.id);

    expect(replay.status).toBe("processed");
    expect(await available(phone)).toBe(5000);
    // L'événement d'origine est mis à jour, aucun doublon n'est créé.
    expect(await eventByReference(providerReference)).toHaveLength(1);
  });

  it("un événement déjà traité ne se rejoue pas", async () => {
    useRemoteMode();
    const phone = newPhone();
    const { providerReference } = await pendingDeposit({ phone });
    await webhook.processYengapayWebhook(signedWebhook({ paymentIntentId: providerReference, transId: `trans_${randomUUID()}`, paymentStatus: "DONE", paymentAmount: 5000 }));
    const [processed] = await eventByReference(providerReference);
    await expect(webhook.replayYengapayWebhookEvent(processed!.id)).rejects.toThrow(/déjà été traité/);
    expect(await available(phone)).toBe(5000);
  });

  it("la relance est refusée en mode test, où aucun paiement réel n'existe", async () => {
    env.YENGAPAY_MODE = "test";
    await expect(webhook.replayYengapayWebhookEvent("peu-importe")).rejects.toThrow(/sandbox ou live/);
  });

  it("le journal se filtre par statut et se cherche par identifiant", async () => {
    useRemoteMode();
    const providerReference = `pi_lot_a_list_${randomUUID()}`;
    const transId = `trans_${randomUUID()}`;
    await webhook.processYengapayWebhook(signedWebhook({ paymentIntentId: providerReference, transId, paymentStatus: "DONE", paymentAmount: 1000 }));
    const found = await control.adminListWebhookEvents({ query: transId });
    expect(found.total).toBe(1);
    expect(found.rows[0]).toMatchObject({ status: "failed", eventType: "payment.succeeded" });
    expect(found.rows[0]!.payloadPreview).toContain(providerReference);
    // La référence de paiement, présente dans le contenu reçu, retrouve aussi l'événement.
    expect((await control.adminListWebhookEvents({ query: providerReference })).total).toBe(1);
    const failed = await control.adminListWebhookEvents({ status: "failed", limit: 200 });
    expect(failed.rows.every((row) => row.status === "failed")).toBe(true);
  });
});

describe.skipIf(!TEST_DB)("anomalies de paiement", () => {
  it("un écart entre le montant attendu et celui annoncé par YengaPay est conservé et listé ; le Wallet reçoit le montant attendu", async () => {
    useRemoteMode();
    const phone = newPhone();
    const { id, providerReference } = await pendingDeposit({ phone, amount: 5000 });
    await webhook.processYengapayWebhook(signedWebhook({ paymentIntentId: providerReference, transId: `trans_${randomUUID()}`, paymentStatus: "DONE", paymentAmount: 4000 }));
    expect(await available(phone)).toBe(5000);
    const anomalies = await control.adminPaymentAnomalies();
    // Avant : l'écart n'existait que dans les journaux du serveur.
    expect(anomalies.amountMismatches.rows.find((row) => row.id === id)).toMatchObject({ amount: 5000, providerReportedAmount: 4000 });
  });

  it("un montant conforme n'est pas signalé", async () => {
    useRemoteMode();
    const { id, providerReference } = await pendingDeposit({ amount: 3000 });
    await webhook.processYengapayWebhook(signedWebhook({ paymentIntentId: providerReference, transId: `trans_${randomUUID()}`, paymentStatus: "DONE", paymentAmount: 3000 }));
    expect((await control.adminPaymentAnomalies()).amountMismatches.rows.some((row) => row.id === id)).toBe(false);
  });

  it("un dépôt en attente depuis plus de 30 minutes est listé ; un dépôt récent ne l'est pas", async () => {
    const stale = await pendingDeposit({ createdAt: new Date(Date.now() - 40 * 60_000) });
    const fresh = await pendingDeposit({ createdAt: new Date(Date.now() - 5 * 60_000) });
    const { stalePendingDeposits } = await control.adminPaymentAnomalies();
    expect(stalePendingDeposits.rows.some((row) => row.id === stale.id)).toBe(true);
    expect(stalePendingDeposits.rows.some((row) => row.id === fresh.id)).toBe(false);
  });
});

describe.skipIf(!TEST_DB)("contrôle des Wallets", () => {
  it("un Wallet tenu par le grand livre est cohérent ; modifié hors du grand livre, il est signalé", async () => {
    const handle = (await db.getDb())!;
    const phone = newPhone();
    await handle.transaction(async (tx) => {
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "credit", amount: 5000, availableDelta: 5000, heldDelta: 0, reason: "Solde (test)", idempotencyKey: `${phone}:seed` });
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "block", amount: 300, availableDelta: -300, heldDelta: 300, reason: "Réserve (test)", idempotencyKey: `${phone}:block` });
    });
    expect((await control.adminWalletCheck()).discrepancies.some((row) => row.profilePhone === phone)).toBe(false);

    // Correction « à la main » en base : 1 000 FCFA apparaissent sans aucun mouvement.
    await handle.update(schema.tikisWallets).set({ availableBalance: 5700 }).where(orm.eq(schema.tikisWallets.profilePhone, phone));
    const flagged = (await control.adminWalletCheck()).discrepancies.find((row) => row.profilePhone === phone);
    expect(flagged).toMatchObject({ availableBalance: 5700, ledgerAvailable: 4700, heldBalance: 300, ledgerHeld: 300 });
  });

  it("les totaux couvrent disponible et bloqué", async () => {
    const check = await control.adminWalletCheck();
    expect(check.wallets).toBeGreaterThan(0);
    expect(typeof check.available).toBe("number");
    expect(typeof check.held).toBe("number");
  });
});

describe.skipIf(!TEST_DB)("export comptable mensuel", () => {
  it("un mois se découpe en UTC, bornes comprises au début et exclues à la fin", () => {
    expect(control.monthRange("2019-03")).toEqual({ start: new Date("2019-03-01T00:00:00.000Z"), end: new Date("2019-04-01T00:00:00.000Z") });
    expect(control.monthRange("2019-12").end.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(() => control.monthRange("2019-13")).toThrow(/AAAA-MM/);
  });

  it("totaux par opération, paiements réglés dans le mois, commissions nettes et détail des mouvements", async () => {
    const handle = (await db.getDb())!;
    // Un mois ancien tiré au hasard ; la base de test persiste d'une exécution à l'autre, d'où la comparaison
    // avant/après plutôt qu'avec des totaux absolus.
    const month = `${1980 + Math.floor(Math.random() * 20)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}`;
    const { start } = control.monthRange(month);
    const before = await control.adminAccountingMonth(month);
    const inMonth = new Date(start.getTime() + 10 * 86_400_000);
    const phone = newPhone();
    const keys = [`${phone}:a`, `${phone}:b`, `${phone}:c`, `${phone}:d`];
    await handle.transaction(async (tx) => {
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "credit", amount: 10_000, availableDelta: 10_000, heldDelta: 0, reason: "Dépôt (test)", idempotencyKey: keys[0]! });
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "commission_debit", amount: 800, availableDelta: -800, heldDelta: 0, reason: "Commission (test)", idempotencyKey: keys[1]! });
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "compensation", amount: 300, availableDelta: 300, heldDelta: 0, reason: "Commission rendue (test)", idempotencyKey: keys[2]! });
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "bonus", amount: 500, availableDelta: 500, heldDelta: 0, reason: "Bonus (test)", idempotencyKey: keys[3]! });
    });
    await handle.update(schema.tikisWalletLedger).set({ createdAt: inMonth }).where(orm.inArray(schema.tikisWalletLedger.idempotencyKey, keys));
    // Un mouvement à minuit pile le 1er du mois suivant n'appartient pas au mois.
    await handle.transaction(async (tx) => {
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "bonus", amount: 999, availableDelta: 999, heldDelta: 0, reason: "Bonus mois suivant (test)", idempotencyKey: `${phone}:next` });
    });
    await handle.update(schema.tikisWalletLedger).set({ createdAt: control.monthRange(month).end }).where(orm.eq(schema.tikisWalletLedger.idempotencyKey, `${phone}:next`));
    const deposit = randomUUID();
    await handle.insert(schema.tikisPaymentTransactions).values({ id: deposit, profilePhone: phone, type: "deposit", provider: "yengapay_sandbox", amount: 10_000, status: "succeeded", providerReference: `pi_lot_a_acc_${deposit}`, checkoutUrl: null, idempotencyKey: `lot-a:${deposit}`, settledAt: inMonth });

    const statement = await control.adminAccountingMonth(month);

    expect({
      gross: statement.commissions.gross - before.commissions.gross,
      refunds: statement.commissions.refunds - before.commissions.refunds,
      net: statement.commissions.net - before.commissions.net,
    }).toEqual({ gross: 800, refunds: 300, net: 500 });
    expect(statement.bonuses - before.bonuses).toBe(500);
    expect(statement.deposits.transactions - before.deposits.transactions).toBe(1);
    expect(statement.deposits.total - before.deposits.total).toBe(10_000);
    expect(statement.withdrawals.total - before.withdrawals.total).toBe(0);
    // Les mouvements de ce profil, sans celui du mois suivant. Enregistrés à la même seconde : l'ordre
    // entre eux n'est pas significatif.
    expect(statement.rows.filter((row) => row.profilePhone === phone).map((row) => row.amount).sort((a, b) => a - b)).toEqual([300, 500, 800, 10_000]);
    expect(statement.truncated).toBe(false);
  });
});

describe.skipIf(!TEST_DB)("accès au contrôle financier", () => {
  it("réservé à super-admin et finance : le support est refusé", async () => {
    const adminDb = await import("../server/admin-db");
    const adminAuth = await import("../server/admin-auth");
    const { tikisAdminRouter } = await import("../server/admin-router");
    const { createContext } = await import("../server/_core/context");
    const support = (await adminDb.createAdminUser({ email: `lot-a-${randomUUID()}@tikis.test`, passwordHash: await adminAuth.hashAdminPassword("mot-de-passe-lot-a"), fullName: "Support", role: "support" }))!;
    const { token } = await adminDb.createAdminSession({ adminId: support.id });
    const req = { headers: { "x-tikis-admin": "1", cookie: `tikis_admin_session=${token}` }, ip: "203.0.113.90", secure: true, socket: {} } as never;
    const api = tikisAdminRouter.createCaller(await createContext({ req, res: { cookie: () => {}, clearCookie: () => {} } as never, info: {} as never }));
    await expect(api.finance.control.anomalies()).rejects.toThrow(/rôle/);
    await expect(api.finance.control.accounting({ month: "2019-06" })).rejects.toThrow(/rôle/);
  });
});
