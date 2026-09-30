/**
 * Notifications de livraison, exécuté contre une vraie base PostgreSQL :
 *
 *   TIKISSE_TEST_DATABASE_URL=<url> npx vitest run tests/delivery-notifications.db.test.ts
 *
 * (schéma : drizzle/manual/0051_delivery_events_feed_hidden.sql)
 *
 * L'envoi Expo est remplacé par un espion : on vérifie qui reçoit un push, et quand.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB = process.env.TIKISSE_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const sent = vi.hoisted(() => [] as Array<{ to: string; title: string; body: string }>);
vi.mock("../server/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/push")>()),
  sendPushToTokens: vi.fn(async (messages: Array<{ to: string; title: string; body: string }>) => {
    sent.push(...messages);
    return { sent: messages.length, failed: 0, errors: [], invalidTokens: [] };
  }),
}));

let db: typeof import("../server/db");
let schema: typeof import("../drizzle/schema");
let orm: typeof import("drizzle-orm");

beforeAll(async () => {
  if (!TEST_DB) return;
  db = await import("../server/db");
  schema = await import("../drizzle/schema");
  orm = await import("drizzle-orm");
});

beforeEach(() => { sent.length = 0; });

const newPhone = () => `+22675${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/** Un téléphone avec un appareil enregistré : il reçoit les push. */
async function phoneWithDevice() {
  const phone = newPhone();
  await db.registerPushToken({ phone, token: `ExponentPushToken[${randomUUID()}]`, platform: "android" });
  return phone;
}

const pushesTo = async (phone: string) => {
  const handle = (await db.getDb())!;
  const tokens = (await handle.select().from(schema.tikissePushTokens).where(orm.eq(schema.tikissePushTokens.phone, phone))).map((row) => row.token);
  return sent.filter((message) => tokens.includes(message.to));
};

async function openDelivery(senderPhone: string) {
  const handle = (await db.getDb())!;
  const deliveryId = randomUUID();
  await handle.insert(schema.tikisseDeliveries).values({
    id: deliveryId, senderPhone, pickupPlaceId: 1, dropoffPlaceId: 2, title: "Notifications", details: "",
    deliveryType: "Plis", distanceKm: "3.00", estimatedPrice: 3000, vehicleTypes: "Moto", status: "open",
  });
  return deliveryId;
}

async function fundedDriver() {
  const phone = await phoneWithDevice();
  const handle = (await db.getDb())!;
  await handle.transaction(async (tx) => {
    await db.applyWalletMovement(tx, { profilePhone: phone, operation: "credit", amount: 5000, availableDelta: 5000, heldDelta: 0, reason: "Solde de départ (test)", idempotencyKey: `${phone}:${randomUUID()}:seed` });
  });
  return phone;
}

async function commissionFor(price: number) {
  const handle = (await db.getDb())!;
  await handle.insert(schema.tikissePlatformSettings).values({ id: 1 }).onConflictDoNothing();
  const rate = Number((await handle.select().from(schema.tikissePlatformSettings).limit(1))[0]!.commissionRate);
  return Math.round(price * rate);
}

const apply = async (deliveryId: string, driverPhone: string) =>
  db.applyForTikisseDelivery({ id: randomUUID(), deliveryId, driverPhone, confirmedCommission: await commissionFor(3000) });

describe.skipIf(!TEST_DB)("candidatures reçues — une seule notification par livraison", () => {
  it("la première candidature sonne, les suivantes mettent à jour la même ligne sans sonner", async () => {
    const senderPhone = await phoneWithDevice();
    const deliveryId = await openDelivery(senderPhone);
    const [first, second, third] = [await fundedDriver(), await fundedDriver(), await fundedDriver()];

    await apply(deliveryId, first);
    await settle();
    expect(await pushesTo(senderPhone)).toHaveLength(1);

    await apply(deliveryId, second);
    await apply(deliveryId, third);
    await settle();
    expect(await pushesTo(senderPhone)).toHaveLength(1);

    const feed = (await db.listTikisseDeliveryEvents(senderPhone)).filter((item) => item.deliveryId === deliveryId);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ title: "Nouvelles candidatures", body: "3 livreurs se sont proposés pour votre livraison.", read: false });
  });

  it("le livreur ne reçoit pas de push pour sa propre candidature, mais la retrouve dans son fil", async () => {
    const deliveryId = await openDelivery(newPhone());
    const driver = await fundedDriver();
    await apply(deliveryId, driver);
    await settle();
    expect(await pushesTo(driver)).toHaveLength(0);
    expect((await db.listTikisseDeliveryEvents(driver)).map((item) => item.title)).toContain("Candidature envoyée");
  });

  it("un retrait ne notifie pas l'expéditeur : hors de son fil, sans push", async () => {
    const senderPhone = await phoneWithDevice();
    const deliveryId = await openDelivery(senderPhone);
    const driver = await fundedDriver();
    await apply(deliveryId, driver);
    await db.markTikisseDeliveryEventsRead(senderPhone);
    await settle();
    sent.length = 0;

    await db.withdrawTikisseDeliveryCandidateWithWallet(deliveryId, driver);
    await settle();
    expect(await pushesTo(senderPhone)).toHaveLength(0);
    expect(await pushesTo(driver)).toHaveLength(0);
    const feed = (await db.listTikisseDeliveryEvents(senderPhone)).filter((item) => item.deliveryId === deliveryId);
    expect(feed.map((item) => item.title)).toEqual(["Nouvelle candidature"]);
    expect(feed.every((item) => item.read)).toBe(true);
  });
});

describe.skipIf(!TEST_DB)("appendDeliveryEvent — push", () => {
  const event = (deliveryId: string, recipientPhone: string, idempotencyKey = randomUUID()) => ({
    deliveryId, eventType: "delivery_updated", status: "open" as const, recipientPhone, title: "Test", body: "Corps", tone: "info" as const, idempotencyKey,
  });

  it("feed: false — conservé pour l'historique, absent du fil, jamais poussé ni compté comme non lu", async () => {
    const phone = await phoneWithDevice();
    const deliveryId = await openDelivery(newPhone());
    const handle = (await db.getDb())!;
    await db.appendDeliveryEvent(handle, { ...event(deliveryId, phone), feed: false });
    await settle();
    expect(await pushesTo(phone)).toHaveLength(0);
    expect(await db.listTikisseDeliveryEvents(phone)).toHaveLength(0);
    const stored = await handle.select().from(schema.tikisseDeliveryEvents).where(orm.eq(schema.tikisseDeliveryEvents.recipientPhone, phone));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.feedHidden).toBe(true);
  });

  it("un événement déjà enregistré (même clé) ne sonne pas une seconde fois", async () => {
    const phone = await phoneWithDevice();
    const deliveryId = await openDelivery(newPhone());
    const handle = (await db.getDb())!;
    const key = randomUUID();
    await db.appendDeliveryEvent(handle, event(deliveryId, phone, key));
    await db.appendDeliveryEvent(handle, event(deliveryId, phone, key));
    await settle();
    expect(await pushesTo(phone)).toHaveLength(1);
  });

  it("dans une transaction, le push part après la validation — jamais si elle échoue", async () => {
    const phone = await phoneWithDevice();
    const deliveryId = await openDelivery(newPhone());
    const handle = (await db.getDb())!;

    await expect(handle.transaction(async (tx) => {
      await db.appendDeliveryEvent(tx, event(deliveryId, phone));
      throw new Error("échec plus loin dans la transaction");
    })).rejects.toThrow("échec plus loin");
    await settle();
    expect(await pushesTo(phone)).toHaveLength(0);

    await handle.transaction(async (tx) => {
      await db.appendDeliveryEvent(tx, event(deliveryId, phone));
      await settle();
      expect(await pushesTo(phone)).toHaveLength(0);
    });
    await settle();
    expect(await pushesTo(phone)).toHaveLength(1);
  });
});
