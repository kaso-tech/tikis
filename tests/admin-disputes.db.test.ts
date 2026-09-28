/**
 * Lot C — litiges et avis, exécuté contre une vraie base MySQL/MariaDB, par le vrai routeur admin.
 *
 *   TIKISSE_TEST_DATABASE_URL=<url> npx vitest run tests/admin-disputes.db.test.ts
 *
 * (schéma : drizzle/manual/0048_disputes_and_reviews.sql)
 *
 * Aucun super-admin n'est créé ici : tests/admin-governance.db.test.ts compte les super-admins actifs, et
 * les fichiers de tests tournent en parallèle sur la même base.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TIKISSE_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.TIKISSE_ADMIN_TOTP_KEY ??= "cle-totp-de-test-uniquement-0123456789abcdef";

type Role = "super_admin" | "support" | "finance" | "viewer" | "kyc_reviewer";
let db: typeof import("../server/db");
let adminDb: typeof import("../server/admin-db");
let adminAuth: typeof import("../server/admin-auth");
let approvals: typeof import("../server/admin-approvals");
let schema: typeof import("../drizzle/schema");
let orm: typeof import("drizzle-orm");
let previousThreshold = 100_000;

beforeAll(async () => {
  if (!TEST_DB) return;
  db = await import("../server/db");
  adminDb = await import("../server/admin-db");
  adminAuth = await import("../server/admin-auth");
  approvals = await import("../server/admin-approvals");
  schema = await import("../drizzle/schema");
  orm = await import("drizzle-orm");
  previousThreshold = await approvals.getApprovalThreshold();
  await approvals.setApprovalThreshold(100_000);
});

afterAll(async () => {
  if (TEST_DB) await approvals.setApprovalThreshold(previousThreshold);
});

const newPhone = () => `+22674${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

async function session(role: Role) {
  const admin = (await adminDb.createAdminUser({ email: `lot-c-${randomUUID()}@tikisse.test`, passwordHash: await adminAuth.hashAdminPassword("mot-de-passe-lot-c"), fullName: "Lot C", role }))!;
  const { token } = await adminDb.createAdminSession({ adminId: admin.id });
  const { tikisseAdminRouter } = await import("../server/admin-router");
  const { createContext } = await import("../server/_core/context");
  const req = { headers: { "x-tikisse-admin": "1", cookie: `tikisse_admin_session=${token}` }, ip: "198.51.100.7", secure: true, socket: {} } as never;
  const res = { cookie: () => {}, clearCookie: () => {} } as never;
  return { admin, api: tikisseAdminRouter.createCaller(await createContext({ req, res, info: {} as never })) };
}

async function wallet(phone: string) {
  const handle = (await db.getDb())!;
  const row = (await handle.select().from(schema.tikisseWallets).where(orm.eq(schema.tikisseWallets.profilePhone, phone)).limit(1))[0];
  return { available: row?.availableBalance ?? 0, held: row?.heldBalance ?? 0 };
}

async function deliveryRow(deliveryId: string) {
  const handle = (await db.getDb())!;
  return (await handle.select().from(schema.tikisseDeliveries).where(orm.eq(schema.tikisseDeliveries.id, deliveryId)).limit(1))[0]!;
}

async function candidateRow(deliveryId: string, driverPhone: string) {
  const handle = (await db.getDb())!;
  return (await handle.select().from(schema.tikisseDeliveryCandidates).where(orm.and(orm.eq(schema.tikisseDeliveryCandidates.deliveryId, deliveryId), orm.eq(schema.tikisseDeliveryCandidates.driverPhone, driverPhone))).limit(1))[0]!;
}

/** Livraison avec un livreur engagé au stade donné, et les mouvements de Wallet des parcours réels. */
async function engagedDelivery(stage: "applied" | "selected" | "confirmed", commission = 300) {
  const handle = (await db.getDb())!;
  const driverPhone = newPhone();
  const senderPhone = newPhone();
  const deliveryId = randomUUID();
  const candidateId = randomUUID();
  await handle.transaction(async (tx) => {
    await db.applyWalletMovement(tx, { profilePhone: driverPhone, operation: "credit", amount: 5000, availableDelta: 5000, heldDelta: 0, reason: "Solde de départ (test)", idempotencyKey: `${candidateId}:seed` });
    await db.applyWalletMovement(tx, { profilePhone: driverPhone, deliveryId, operation: "block", amount: commission, availableDelta: -commission, heldDelta: commission, reason: "Commission temporairement bloquée pour candidature", idempotencyKey: `${candidateId}:block` });
    if (stage === "confirmed") {
      await db.applyWalletMovement(tx, { profilePhone: driverPhone, deliveryId, operation: "commission_debit", amount: commission, availableDelta: 0, heldDelta: -commission, reason: "Commission Tikisse prélevée après confirmation de disponibilité", idempotencyKey: `${deliveryId}:commission-debit:${candidateId}` });
    }
  });
  await handle.insert(schema.tikisseDeliveries).values({
    id: deliveryId, senderPhone, pickupPlaceId: 1, dropoffPlaceId: 2, title: "Litige lot C", details: "",
    deliveryType: "Plis", distanceKm: "3.00", estimatedPrice: 3000, vehicleTypes: "Moto",
    status: stage === "applied" ? "open" : stage === "selected" ? "pending_confirmation" : "active",
    driverPhone: stage === "applied" ? null : driverPhone,
    accruedCommission: stage === "applied" ? null : commission,
  });
  await handle.insert(schema.tikisseDeliveryCandidates).values({ id: candidateId, deliveryId, driverPhone, status: stage, commissionBlocked: commission });
  return { deliveryId, driverPhone, senderPhone, commission };
}

async function events(deliveryId: string, eventType: string) {
  const handle = (await db.getDb())!;
  return handle.select().from(schema.tikisseDeliveryEvents).where(orm.and(orm.eq(schema.tikisseDeliveryEvents.deliveryId, deliveryId), orm.eq(schema.tikisseDeliveryEvents.eventType, eventType)));
}

describe.skipIf(!TEST_DB)("dédommagement après litige", () => {
  it("crédite un participant, rattaché à la livraison, une seule fois par opération", async () => {
    const { api } = await session("finance");
    const { deliveryId, senderPhone } = await engagedDelivery("confirmed");
    const requestId = randomUUID();
    const input = { deliveryId, phone: senderPhone, amount: 1500, reason: "Colis abîmé", requestId };
    await expect(api.disputes.refund(input)).resolves.toMatchObject({ approvalRequired: false, amount: 1500 });
    await api.disputes.refund(input);
    expect(await wallet(senderPhone)).toEqual({ available: 1500, held: 0 });
    const timeline = await api.disputes.timeline({ deliveryId });
    expect(timeline?.ledgerEntries.filter((entry) => entry.operation === "refund")).toHaveLength(1);
    expect(await events(deliveryId, "admin_dispute_refund")).toHaveLength(1);
  });

  it("refuse un profil qui n'a pas pris part à la livraison", async () => {
    const { api } = await session("finance");
    const { deliveryId } = await engagedDelivery("confirmed");
    const stranger = newPhone();
    await expect(api.disputes.refund({ deliveryId, phone: stranger, amount: 1000, reason: "Erreur", requestId: randomUUID() })).rejects.toThrow(/pas pris part/);
    expect(await wallet(stranger)).toEqual({ available: 0, held: 0 });
  });

  it("au-delà du seuil : demande de validation, exécutée par un second admin", async () => {
    const requester = await session("finance");
    const approver = await session("finance");
    const { deliveryId, senderPhone } = await engagedDelivery("confirmed");
    const request = await requester.api.disputes.refund({ deliveryId, phone: senderPhone, amount: 150_000, reason: "Marchandise perdue", requestId: randomUUID() });
    expect(request).toMatchObject({ approvalRequired: true });
    expect(await wallet(senderPhone)).toEqual({ available: 0, held: 0 });
    if (!("approvalId" in request)) throw new Error("demande attendue");
    await expect(requester.api.approvals.approve({ approvalId: request.approvalId })).rejects.toThrow(/propre demande/);
    await expect(approver.api.approvals.approve({ approvalId: request.approvalId })).resolves.toMatchObject({ status: "executed" });
    expect(await wallet(senderPhone)).toEqual({ available: 150_000, held: 0 });
  });

  it("la demande de validation vérifie déjà le participant", async () => {
    const { api } = await session("finance");
    const { deliveryId } = await engagedDelivery("confirmed");
    await expect(api.disputes.refund({ deliveryId, phone: newPhone(), amount: 150_000, reason: "Erreur", requestId: randomUUID() })).rejects.toThrow(/pas pris part/);
  });
});

describe.skipIf(!TEST_DB)("commission rendue au livreur", () => {
  it("rend exactement la commission prélevée, et une seule fois", async () => {
    const { api } = await session("finance");
    const { deliveryId, driverPhone } = await engagedDelivery("confirmed");
    expect((await api.disputes.timeline({ deliveryId }))?.refundableCommissions).toEqual([{ driverPhone, amount: 300 }]);
    await expect(api.disputes.refundCommission({ deliveryId, driverPhone, reason: "Expéditeur absent" })).resolves.toMatchObject({ amount: 300 });
    expect(await wallet(driverPhone)).toEqual({ available: 5000, held: 0 });
    await expect(api.disputes.refundCommission({ deliveryId, driverPhone, reason: "Deuxième essai" })).rejects.toThrow(/Aucune commission/);
    expect(await wallet(driverPhone)).toEqual({ available: 5000, held: 0 });
    expect((await api.disputes.timeline({ deliveryId }))?.refundableCommissions).toEqual([]);
  });

  it("rien à rendre tant que la commission n'est que réservée", async () => {
    const { api } = await session("finance");
    const { deliveryId, driverPhone } = await engagedDelivery("applied");
    await expect(api.disputes.refundCommission({ deliveryId, driverPhone, reason: "Essai" })).rejects.toThrow(/Aucune commission/);
  });
});

describe.skipIf(!TEST_DB)("retrait du livreur", () => {
  it("livreur sélectionné : sa réserve est libérée, la livraison rouverte", async () => {
    const { api } = await session("support");
    const { deliveryId, driverPhone, senderPhone } = await engagedDelivery("selected");
    await expect(api.disputes.removeDriver({ deliveryId, reason: "Injoignable" })).resolves.toMatchObject({ driverPhone, released: 300, refunded: 0 });
    expect(await wallet(driverPhone)).toEqual({ available: 5000, held: 0 });
    const delivery = await deliveryRow(deliveryId);
    expect(delivery).toMatchObject({ status: "open", driverPhone: null, previousDriverPhone: driverPhone, accruedCommission: null });
    expect((await candidateRow(deliveryId, driverPhone)).status).toBe("withdrawn");
    const notified = (await events(deliveryId, "admin_driver_removed")).map((event) => event.recipientPhone).sort();
    expect(notified).toEqual([driverPhone, senderPhone].sort());
  });

  it("livreur confirmé : la commission prélevée est remboursée, et pas une seconde fois ensuite", async () => {
    const { api } = await session("support");
    const finance = (await session("finance")).api;
    const { deliveryId, driverPhone } = await engagedDelivery("confirmed");
    await expect(api.disputes.removeDriver({ deliveryId, reason: "Comportement signalé" })).resolves.toMatchObject({ refunded: 300 });
    expect(await wallet(driverPhone)).toEqual({ available: 5000, held: 0 });
    await expect(finance.disputes.refundCommission({ deliveryId, driverPhone, reason: "Doublon" })).rejects.toThrow(/Aucune commission/);
    await expect(api.disputes.removeDriver({ deliveryId, reason: "Encore" })).rejects.toThrow(/livreur à retirer/);
  });
});

describe.skipIf(!TEST_DB)("clôture par l'administration", () => {
  it("clôt une livraison en cours, jamais une livraison sans livreur confirmé", async () => {
    const { api } = await session("support");
    const active = await engagedDelivery("confirmed");
    await expect(api.disputes.complete({ deliveryId: active.deliveryId, reason: "Colis remis, oubli de clôture" })).resolves.toMatchObject({ status: "completed" });
    expect((await deliveryRow(active.deliveryId)).status).toBe("completed");
    expect((await events(active.deliveryId, "delivery_completed"))[0]?.body).toMatch(/Clôturée par l’équipe Tikisse/);
    await expect(api.disputes.complete({ deliveryId: active.deliveryId, reason: "Encore" })).rejects.toThrow(/Seule une livraison en cours/);
    const pending = await engagedDelivery("selected");
    await expect(api.disputes.complete({ deliveryId: pending.deliveryId, reason: "Essai" })).rejects.toThrow(/Seule une livraison en cours/);
  });
});

describe.skipIf(!TEST_DB)("modération des avis", () => {
  async function review(driverPhone: string, rating: number, comment: string | null) {
    const handle = (await db.getDb())!;
    const id = randomUUID();
    await handle.insert(schema.tikisseDeliveryReviews).values({ id, deliveryId: randomUUID(), reviewerPhone: newPhone(), driverPhone, rating, comment });
    return id;
  }

  it("un avis masqué ne compte plus dans la note ; rétabli, il compte de nouveau", async () => {
    const { api } = await session("support");
    const driverPhone = newPhone();
    await review(driverPhone, 5, "Parfait");
    const insult = await review(driverPhone, 1, "Propos injurieux");
    expect(await db.getTikisseDriverStats(driverPhone)).toMatchObject({ rating: 3, reviewsCount: 2 });

    await expect(api.reviews.setHidden({ reviewId: insult, hidden: true })).rejects.toThrow(/pourquoi/);
    await api.reviews.setHidden({ reviewId: insult, hidden: true, reason: "Injurieux" });
    expect(await db.getTikisseDriverStats(driverPhone)).toMatchObject({ rating: 5, reviewsCount: 1 });
    expect(await db.listTikisseDeliveryReviewsForProfile(driverPhone, "driver")).toHaveLength(1);
    const hidden = await api.reviews.list({ filter: "hidden", query: driverPhone });
    expect(hidden.rows.map((row) => row.id)).toEqual([insult]);
    expect(hidden.rows[0]).toMatchObject({ hiddenReason: "Injurieux" });

    await api.reviews.setHidden({ reviewId: insult, hidden: false });
    expect(await db.getTikisseDriverStats(driverPhone)).toMatchObject({ rating: 3, reviewsCount: 2 });
  });

  it("filtre les avis négatifs et commentés", async () => {
    const { api } = await session("support");
    const driverPhone = newPhone();
    await review(driverPhone, 4, null);
    const low = await review(driverPhone, 2, "");
    const commented = await review(driverPhone, 5, "Très poli");
    expect((await api.reviews.list({ filter: "low", query: driverPhone })).rows.map((row) => row.id)).toEqual([low]);
    expect((await api.reviews.list({ filter: "commented", query: driverPhone })).rows.map((row) => row.id)).toEqual([commented]);
    expect((await api.reviews.list({ filter: "all", query: driverPhone })).total).toBe(3);
  });
});

describe.skipIf(!TEST_DB)("rôles", () => {
  it("argent : finance et super-admin ; livreur et statut : support et super-admin ; avis : ni finance ni lecture seule", async () => {
    const { deliveryId, driverPhone, senderPhone } = await engagedDelivery("confirmed");
    const support = (await session("support")).api;
    const finance = (await session("finance")).api;
    const viewer = (await session("viewer")).api;
    await expect(support.disputes.refund({ deliveryId, phone: senderPhone, amount: 100, reason: "Essai", requestId: randomUUID() })).rejects.toThrow(/rôle/);
    await expect(support.disputes.refundCommission({ deliveryId, driverPhone, reason: "Essai" })).rejects.toThrow(/rôle/);
    await expect(finance.disputes.removeDriver({ deliveryId, reason: "Essai" })).rejects.toThrow(/rôle/);
    await expect(finance.disputes.complete({ deliveryId, reason: "Essai" })).rejects.toThrow(/rôle/);
    await expect(finance.reviews.list({})).rejects.toThrow(/rôle/);
    await expect(viewer.reviews.list({})).rejects.toThrow(/rôle/);
    await expect(viewer.disputes.timeline({ deliveryId })).resolves.toBeTruthy();
    expect(await wallet(senderPhone)).toEqual({ available: 0, held: 0 });
    expect((await deliveryRow(deliveryId)).status).toBe("active");
  });
});
