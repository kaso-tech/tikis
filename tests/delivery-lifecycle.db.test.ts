/**
 * Parcours complet d'une course contre une vraie base PostgreSQL : lieux, favoris, périmètre du livreur,
 * création, candidature, sélection, confirmation, position GPS, clôture, avis, statistiques. Écrit pour
 * le passage de MySQL à PostgreSQL : chaque étape exerce une requête propre à ce parcours (upserts,
 * agrégats, identifiants générés, dates).
 *
 *   TIKISSE_TEST_DATABASE_URL=<url> npx vitest run tests/delivery-lifecycle.db.test.ts
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB = process.env.TIKISSE_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

vi.mock("../server/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/push")>()),
  sendPushToTokens: vi.fn(async () => ({ sent: 0, failed: 0, errors: [], invalidTokens: [] })),
}));

let db: typeof import("../server/db");
let metrics: typeof import("../server/analytics-metrics");
let schema: typeof import("../drizzle/schema");

beforeAll(async () => {
  if (!TEST_DB) return;
  db = await import("../server/db");
  metrics = await import("../server/analytics-metrics");
  schema = await import("../drizzle/schema");
});

const newPhone = () => `+22676${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
const coordinate = () => (12 + Math.random()).toFixed(7);

describe.skipIf(!TEST_DB)("parcours d'une course sous PostgreSQL", () => {
  it("de la création à l'avis, avec des nombres là où l'app attend des nombres", async () => {
    const senderPhone = newPhone();
    const driverPhone = newPhone();
    const referralCode = `R${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
    await db.createTikisseProfile({ phone: driverPhone, fullName: "Livreur PG", accountType: "driver", vehicles: JSON.stringify(["Moto"]), referralCode });
    const sender = await db.createTikisseProfile({ phone: senderPhone, fullName: "Expéditeur PG", accountType: "sender", vehicles: "[]" });
    expect(typeof sender.id).toBe("number");
    await db.createReferralIfCodeProvided(senderPhone, referralCode);
    await db.createReferralIfCodeProvided(senderPhone, referralCode);
    expect(await db.listReferralsForReferrer(driverPhone)).toHaveLength(1);

    // Lieux : l'identifiant vient de la base (plus d'`insertId` MySQL) ; un même point n'est enregistré qu'une fois.
    const place = { latitude: coordinate(), longitude: "-1.5200000", formattedAddress: "Rue PG, Ouagadougou", placeName: "Rue PG", city: "Ouagadougou", country: "Burkina Faso", provider: "mapbox", source: "reverse", featureType: "address", precision: "exact" };
    const pickup = await db.saveTikissePlace(place);
    expect(typeof pickup.id).toBe("number");
    expect((await db.saveTikissePlace(place)).id).toBe(pickup.id);
    const dropoff = await db.saveTikissePlace({ ...place, latitude: coordinate(), formattedAddress: "Autre rue PG" });
    await db.saveFavoritePlace(senderPhone, pickup.id, "Maison");
    await db.saveFavoritePlace(senderPhone, pickup.id, "Bureau");
    const favorites = await db.listFavoritePlaces(senderPhone);
    expect(favorites).toHaveLength(1);

    // Périmètre du livreur : upsert sans champ fourni, puis avec.
    await db.updateDriverPerimeterPreferences(driverPhone, {});
    await db.updateDriverPerimeterPreferences(driverPhone, { opportunityPushEnabled: true });
    const perimeter = await db.updateDriverBasePosition(driverPhone, 12.37, -1.52);
    expect(perimeter.opportunityPushEnabled).toBe(true);

    const deliveryId = randomUUID();
    await db.createTikisseDelivery({ id: deliveryId, senderPhone, pickupPlaceId: pickup.id, dropoffPlaceId: dropoff.id, title: "Colis PG", details: "", deliveryType: "Plis", distanceKm: "4.20", estimatedPrice: 2000, vehicleTypes: "Moto", status: "open" });

    const handle = (await db.getDb())!;
    await handle.transaction(async (tx) => {
      await db.applyWalletMovement(tx, { profilePhone: driverPhone, operation: "credit", amount: 5000, availableDelta: 5000, heldDelta: 0, reason: "Solde de départ (test)", idempotencyKey: `${driverPhone}:seed` });
    });
    await handle.insert(schema.tikissePlatformSettings).values({ id: 1 }).onConflictDoNothing();
    const rate = Number((await handle.select().from(schema.tikissePlatformSettings).limit(1))[0]!.commissionRate);
    await db.applyForTikisseDelivery({ id: randomUUID(), deliveryId, driverPhone, confirmedCommission: Math.round(2000 * rate) });

    const candidates = await db.listTikisseDeliveryCandidates(deliveryId);
    expect(candidates).toHaveLength(1);

    await db.selectTikisseDeliveryCandidateWithWallet(deliveryId, candidates[0]!.id, senderPhone);
    await db.confirmTikisseDeliveryWithEvents(deliveryId, driverPhone);
    expect((await db.getTikisseDeliveryRecordById(deliveryId))?.status).toBe("active");

    await db.saveTikisseDeliveryLiveLocation({ deliveryId, driverPhone, latitude: 12.37, longitude: -1.52, heading: 90 });
    await db.saveTikisseDeliveryLiveLocation({ deliveryId, driverPhone, latitude: 12.38, longitude: -1.53, heading: 180 });
    const live = await db.getTikisseDeliveryLiveLocation(deliveryId);
    expect(live?.latitude).toBeCloseTo(12.38);

    expect((await db.listTikisseDeliveriesForProfile(senderPhone, "sender")).map((delivery) => delivery.id)).toContain(deliveryId);
    expect((await db.listTikisseDeliveriesForProfile(driverPhone, "driver")).map((delivery) => delivery.id)).toContain(deliveryId);

    await db.completeTikisseDeliveryWithEvents(deliveryId, senderPhone);
    expect((await db.getTikisseDeliveryRecordById(deliveryId))?.status).toBe("completed");

    await db.saveTikisseDeliveryReview({ id: randomUUID(), deliveryId, reviewerPhone: senderPhone, driverPhone, rating: 5, comment: "Parfait" });
    const stats = await db.getTikisseDriverStats(driverPhone);
    // COUNT et SUM PostgreSQL arrivent en texte si on ne les convertit pas : « 1 » + « 1 » = « 11 ».
    expect(stats).toEqual({ rating: 5, completedDeliveries: 1, reviewsCount: 1 });

    const wallet = await db.getTikisseWalletSnapshot(driverPhone);
    expect(typeof wallet.total).toBe("number");
    expect(typeof wallet.blocked).toBe("number");

    const today = new Date().toISOString().slice(0, 10);
    const day = await metrics.computeDailyMetrics(today);
    expect(day.deliveriesCompleted).toBeGreaterThanOrEqual(1);
    expect(typeof day.gmvTotal).toBe("number");
    await metrics.computeDailyMetrics(today);
  });

  it("une course ouverte sans activité expire", async () => {
    const senderPhone = newPhone();
    await db.createTikisseProfile({ phone: senderPhone, fullName: "Expéditeur expiration", accountType: "sender", vehicles: "[]" });
    const place = await db.saveTikissePlace({ latitude: coordinate(), longitude: "-1.5100000", formattedAddress: "Rue expiration", placeName: "Rue expiration", provider: "mapbox", source: "reverse", featureType: "address", precision: "exact" });
    const deliveryId = randomUUID();
    await db.createTikisseDelivery({ id: deliveryId, senderPhone, pickupPlaceId: place.id, dropoffPlaceId: place.id, title: "Expire", details: "", deliveryType: "Plis", distanceKm: "1.00", estimatedPrice: 1000, vehicleTypes: "Moto", status: "open" });
    await db.expireOpenTikisseDeliveries(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    expect((await db.getTikisseDeliveryRecordById(deliveryId))?.status).toBe("expired");
  });

  it("limite de tentatives par numéro : compteur partagé en base", async () => {
    const phone = newPhone();
    const results = [];
    for (let attempt = 0; attempt < 12; attempt++) results.push(await db.checkPhoneAttemptLimit("pg-test", phone));
    expect(results[0]).toEqual({ allowed: true });
    expect(results.at(-1)?.allowed).toBe(false);
  });
});
