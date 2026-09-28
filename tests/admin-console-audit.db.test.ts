/**
 * Audit de la console d'administration, exécuté contre une vraie base MySQL/MariaDB.
 *
 * Même principe que tests/payment-direct-audit.db.test.ts : ces tests appellent les fonctions qui
 * touchent réellement aux Wallets et aux sessions admin, sans rien simuler de la base. Ils ne tournent
 * que si TIKIS_TEST_DATABASE_URL désigne une base jetable dont le schéma a été poussé :
 *
 *   DATABASE_URL=<url> npx drizzle-kit push --force
 *   TIKIS_TEST_DATABASE_URL=<url> npx vitest run tests/admin-console-audit.db.test.ts
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TIKIS_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.TIKIS_ADMIN_SESSION_SECRET ??= "admin-audit-test-secret-0123456789";

type Db = typeof import("../server/db");
let db: Db;
let adminDb: typeof import("../server/admin-db");
let adminAuth: typeof import("../server/admin-auth");
let schema: typeof import("../drizzle/schema");

beforeAll(async () => {
  if (!TEST_DB) return;
  db = await import("../server/db");
  adminDb = await import("../server/admin-db");
  adminAuth = await import("../server/admin-auth");
  schema = await import("../drizzle/schema");
});

const newPhone = () => `+22671${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

async function wallet(phone: string) {
  const handle = (await db.getDb())!;
  const { eq } = await import("drizzle-orm");
  const row = (await handle.select().from(schema.tikisWallets).where(eq(schema.tikisWallets.profilePhone, phone)).limit(1))[0];
  return { available: row?.availableBalance ?? 0, held: row?.heldBalance ?? 0 };
}

/**
 * Une livraison dont un livreur est engagé au stade `stage`, avec exactement les mouvements de Wallet que
 * produisent les parcours réels : candidature (block), sélection (rien), confirmation (commission_debit
 * prélevée sur la réserve).
 */
async function engagedDelivery(stage: "applied" | "selected" | "confirmed", commission = 300) {
  const handle = (await db.getDb())!;
  const driverPhone = newPhone();
  const deliveryId = randomUUID();
  const candidateId = randomUUID();
  await handle.transaction(async (tx) => {
    await db.applyWalletMovement(tx, { profilePhone: driverPhone, operation: "credit", amount: 5000, availableDelta: 5000, heldDelta: 0, reason: "Solde de départ (test)", idempotencyKey: `${candidateId}:seed` });
    await db.applyWalletMovement(tx, { profilePhone: driverPhone, deliveryId, operation: "block", amount: commission, availableDelta: -commission, heldDelta: commission, reason: "Commission temporairement bloquée pour candidature", idempotencyKey: `${candidateId}:block` });
    if (stage === "confirmed") {
      await db.applyWalletMovement(tx, { profilePhone: driverPhone, deliveryId, operation: "commission_debit", amount: commission, availableDelta: 0, heldDelta: -commission, reason: "Commission Tikis prélevée après confirmation de disponibilité", idempotencyKey: `${deliveryId}:commission-debit:${candidateId}` });
    }
  });
  await handle.insert(schema.tikisDeliveries).values({
    id: deliveryId, senderPhone: newPhone(), pickupPlaceId: 1, dropoffPlaceId: 2, title: "Audit admin", details: "",
    deliveryType: "Plis", distanceKm: "3.00", estimatedPrice: 3000, vehicleTypes: "Moto",
    status: stage === "applied" ? "open" : stage === "selected" ? "pending_confirmation" : "active",
    driverPhone: stage === "applied" ? null : driverPhone,
    accruedCommission: stage === "applied" ? null : commission,
  });
  await handle.insert(schema.tikisDeliveryCandidates).values({ id: candidateId, deliveryId, driverPhone, status: stage, commissionBlocked: commission });
  return { deliveryId, driverPhone, commission };
}

describe.skipIf(!TEST_DB)("annulation forcée par l'administration — aucun argent créé, aucun argent bloqué à vie", () => {
  for (const stage of ["applied", "selected"] as const) {
    it(`candidat « ${stage} » : la commission réservée est simplement libérée`, async () => {
      const { deliveryId, driverPhone } = await engagedDelivery(stage);
      expect(await wallet(driverPhone)).toEqual({ available: 4700, held: 300 });

      await adminDb.adminForceCancelDelivery({ deliveryId, reason: "Audit", adminId: 1 });

      // Rien n'a quitté le Wallet : le livreur retrouve exactement ses 5 000 FCFA, tous disponibles.
      // Avant correction : 5 000 disponibles ET 300 toujours bloqués — 300 FCFA créés, et une réserve
      // qu'aucun parcours ne libérerait plus jamais.
      expect(await wallet(driverPhone)).toEqual({ available: 5000, held: 0 });
    });
  }

  it("candidat « confirmed » : la commission réellement prélevée est remboursée", async () => {
    const { deliveryId, driverPhone } = await engagedDelivery("confirmed");
    expect(await wallet(driverPhone)).toEqual({ available: 4700, held: 0 });

    await adminDb.adminForceCancelDelivery({ deliveryId, reason: "Audit", adminId: 1 });

    expect(await wallet(driverPhone)).toEqual({ available: 5000, held: 0 });
  });

  it("rejouer l'annulation ne rembourse jamais deux fois", async () => {
    const { deliveryId, driverPhone } = await engagedDelivery("confirmed");
    await adminDb.adminForceCancelDelivery({ deliveryId, reason: "Audit", adminId: 1 });
    await expect(adminDb.adminForceCancelDelivery({ deliveryId, reason: "Audit", adminId: 1 })).rejects.toThrow(/déjà clôturée/);
    expect(await wallet(driverPhone)).toEqual({ available: 5000, held: 0 });
  });
});

describe.skipIf(!TEST_DB)("session admin — l'état du compte fait foi, pas le jeton", () => {
  async function newAdmin(role: "super_admin" | "support" | "finance") {
    const email = `audit-${randomUUID()}@tikis.test`;
    const created = await adminDb.createAdminUser({ email, passwordHash: await adminAuth.hashAdminPassword("mot-de-passe-audit"), fullName: "Audit", role });
    return created!;
  }

  it("un admin suspendu perd l'accès immédiatement, sans attendre l'expiration du jeton", async () => {
    const admin = await newAdmin("support");
    const token = await adminAuth.createAdminSession(admin.id, admin.email, admin.role);
    expect(await adminDb.authenticateAdminSession(token)).toMatchObject({ adminId: admin.id, role: "support" });

    await adminDb.setAdminUserActive({ actorAdminId: -1, adminId: admin.id, active: false });

    expect(await adminDb.authenticateAdminSession(token)).toBeNull();
  });

  it("le rôle appliqué est celui du compte, pas celui figé dans le jeton", async () => {
    const admin = await newAdmin("super_admin");
    const token = await adminAuth.createAdminSession(admin.id, admin.email, admin.role);
    const handle = (await db.getDb())!;
    const { eq } = await import("drizzle-orm");
    await handle.update(schema.tikisAdminUsers).set({ role: "support" }).where(eq(schema.tikisAdminUsers.id, admin.id));

    expect(await adminDb.authenticateAdminSession(token)).toMatchObject({ adminId: admin.id, role: "support" });
  });

  it("un compte supprimé ne s'authentifie plus", async () => {
    const admin = await newAdmin("finance");
    const token = await adminAuth.createAdminSession(admin.id, admin.email, admin.role);
    const handle = (await db.getDb())!;
    const { eq } = await import("drizzle-orm");
    await handle.delete(schema.tikisAdminUsers).where(eq(schema.tikisAdminUsers.id, admin.id));

    expect(await adminDb.authenticateAdminSession(token)).toBeNull();
  });

  it("un super-admin ne peut pas se suspendre lui-même", async () => {
    const admin = await newAdmin("super_admin");
    await expect(adminDb.setAdminUserActive({ actorAdminId: admin.id, adminId: admin.id, active: false })).rejects.toThrow(/vous-même/);
  });

  it("le dernier super-admin actif ne peut pas être suspendu", async () => {
    const handle = (await db.getDb())!;
    const { eq } = await import("drizzle-orm");
    // Isole ce test : un seul super-admin actif en base.
    await handle.update(schema.tikisAdminUsers).set({ active: false }).where(eq(schema.tikisAdminUsers.role, "super_admin"));
    const last = await newAdmin("super_admin");
    const other = await newAdmin("support");
    await expect(adminDb.setAdminUserActive({ actorAdminId: other.id, adminId: last.id, active: false })).rejects.toThrow(/dernier super-admin/);
  });
});

describe.skipIf(!TEST_DB)("bonus et pénalités admin — un identifiant d'opération ne sert qu'à un profil", () => {
  it("le même requestId rejoué sur le même profil ne crédite qu'une fois", async () => {
    const phone = newPhone();
    const requestId = randomUUID();
    await adminDb.adminRewardWallet({ phone, amount: 1000, reason: "Audit", adminId: 1, requestId });
    await adminDb.adminRewardWallet({ phone, amount: 1000, reason: "Audit", adminId: 1, requestId });
    expect(await wallet(phone)).toEqual({ available: 1000, held: 0 });
  });

  it("le même requestId sur un autre profil crédite bien cet autre profil", async () => {
    const first = newPhone();
    const second = newPhone();
    const requestId = randomUUID();
    await adminDb.adminRewardWallet({ phone: first, amount: 1000, reason: "Audit", adminId: 1, requestId });
    await adminDb.adminRewardWallet({ phone: second, amount: 1000, reason: "Audit", adminId: 1, requestId });
    // Avant correction : clé `admin-reward:<requestId>` sans le numéro — le second appel « réussissait »
    // en renvoyant le mouvement du premier profil, et ce profil-ci ne recevait rien.
    expect(await wallet(second)).toEqual({ available: 1000, held: 0 });
  });
});

describe.skipIf(!TEST_DB)("validation manuelle d'un dépôt — jamais sans preuve de paiement YengaPay", () => {
  async function pendingDeposit(provider: "yengapay_live" | "yengapay_direct_live" | "yengapay_test", amount = 5000) {
    const handle = (await db.getDb())!;
    const phone = newPhone();
    const id = randomUUID();
    await handle.insert(schema.tikisPaymentTransactions).values({
      id, profilePhone: phone, type: "deposit", provider, amount, status: "pending", providerReference: `pi_admin_${id}`,
      checkoutUrl: null, idempotencyKey: `admin-audit:${id}`,
      ...(provider === "yengapay_direct_live" ? { phoneE164: phone, operatorCode: "orange_money", countryCode: "BF", ussdCode: "*144#", expiresAt: new Date(Date.now() + 15 * 60_000) } : {}),
    });
    return { id, phone };
  }

  for (const provider of ["yengapay_live", "yengapay_direct_live"] as const) {
    it(`refuse de créditer à la main un dépôt ${provider} en attente`, async () => {
      const { id, phone } = await pendingDeposit(provider);
      await expect(db.adminSettlePaymentTransaction({ paymentId: id, outcome: "succeeded", adminId: 1 })).rejects.toThrow(/seul YengaPay/);
      expect(await wallet(phone)).toEqual({ available: 0, held: 0 });
    });
  }

  it("un rejet manuel reste possible, et n'empêche pas le crédit si YengaPay confirme ensuite", async () => {
    const { id, phone } = await pendingDeposit("yengapay_live");
    await db.adminSettlePaymentTransaction({ paymentId: id, outcome: "failed", adminId: 1 });
    await db.settleYengapayLivePayment({ providerReference: `pi_admin_${id}`, outcome: "succeeded" });
    expect(await wallet(phone)).toEqual({ available: 5000, held: 0 });
  });

  it("un dépôt simulé se valide toujours à la main", async () => {
    const { id, phone } = await pendingDeposit("yengapay_test");
    await db.adminSettlePaymentTransaction({ paymentId: id, outcome: "succeeded", adminId: 1 });
    expect(await wallet(phone)).toEqual({ available: 5000, held: 0 });
  });
});

async function profile(phone: string, accountType: "sender" | "driver") {
  const handle = (await db.getDb())!;
  await handle.insert(schema.tikisProfiles).values({ phone, fullName: "Profil audit", accountType, vehicles: accountType === "driver" ? "[\"Moto\"]" : "[]" });
}

async function candidateStatus(deliveryId: string, driverPhone: string) {
  const handle = (await db.getDb())!;
  const { and, eq } = await import("drizzle-orm");
  return (await handle.select().from(schema.tikisDeliveryCandidates).where(and(eq(schema.tikisDeliveryCandidates.deliveryId, deliveryId), eq(schema.tikisDeliveryCandidates.driverPhone, driverPhone))).limit(1))[0]?.status;
}

describe.skipIf(!TEST_DB)("changement de rôle — jamais avec de l'argent ou des courses engagés", () => {
  it("refuse de passer expéditeur un livreur qui a une candidature en cours (commission réservée)", async () => {
    const { driverPhone } = await engagedDelivery("applied");
    await profile(driverPhone, "driver");
    // Avant correction : accepté, et les 300 FCFA réservés n'avaient plus aucun chemin de sortie.
    await expect(adminDb.adminChangeProfileRole({ phone: driverPhone, role: "sender" })).rejects.toThrow(/candidature/);
  });

  it("refuse de passer livreur un expéditeur qui a une course ouverte", async () => {
    const handle = (await db.getDb())!;
    const senderPhone = newPhone();
    await profile(senderPhone, "sender");
    await handle.insert(schema.tikisDeliveries).values({
      id: randomUUID(), senderPhone, pickupPlaceId: 1, dropoffPlaceId: 2, title: "Course ouverte", details: "",
      deliveryType: "Plis", distanceKm: "3.00", estimatedPrice: 3000, vehicleTypes: "Moto", status: "open",
    });
    await expect(adminDb.adminChangeProfileRole({ phone: senderPhone, role: "driver" })).rejects.toThrow(/course/);
  });

  it("accepte un profil sans engagement", async () => {
    const phone = newPhone();
    await profile(phone, "sender");
    await expect(adminDb.adminChangeProfileRole({ phone, role: "driver" })).resolves.toMatchObject({ role: "driver" });
  });
});

describe.skipIf(!TEST_DB)("suspension d'un livreur — ses candidatures sont retirées et sa commission libérée", () => {
  for (const status of ["suspended", "banned"] as const) {
    it(`${status} : candidature retirée, réserve rendue`, async () => {
      const { deliveryId, driverPhone } = await engagedDelivery("applied");
      await profile(driverPhone, "driver");

      const result = await adminDb.adminSetProfileStatus({ phone: driverPhone, status, reason: "Audit", adminId: 1 });

      // Avant correction : la candidature restait visible de l'expéditeur, et 300 FCFA restaient bloqués.
      expect(await wallet(driverPhone)).toEqual({ available: 5000, held: 0 });
      expect(await candidateStatus(deliveryId, driverPhone)).toBe("withdrawn");
      expect(result.releasedCandidacies).toBe(1);
    });
  }

  it("une course déjà attribuée n'est pas touchée, mais elle est signalée à l'admin", async () => {
    const { deliveryId, driverPhone } = await engagedDelivery("confirmed");
    await profile(driverPhone, "driver");

    const result = await adminDb.adminSetProfileStatus({ phone: driverPhone, status: "suspended", reason: "Audit", adminId: 1 });

    expect(await candidateStatus(deliveryId, driverPhone)).toBe("confirmed");
    expect(result.engagements).toEqual([expect.objectContaining({ deliveryId, role: "driver", status: "active" })]);
  });

  it("réactiver un profil ne touche à rien", async () => {
    const { deliveryId, driverPhone } = await engagedDelivery("applied");
    await profile(driverPhone, "driver");
    const result = await adminDb.adminSetProfileStatus({ phone: driverPhone, status: "active", adminId: 1 });
    expect(result.releasedCandidacies).toBe(0);
    expect(await candidateStatus(deliveryId, driverPhone)).toBe("applied");
    expect(await wallet(driverPhone)).toEqual({ available: 4700, held: 300 });
  });

  it("une candidature suspendue, reposée puis suspendue de nouveau est libérée les deux fois", async () => {
    const { deliveryId, driverPhone } = await engagedDelivery("applied");
    await profile(driverPhone, "driver");
    await adminDb.adminSetProfileStatus({ phone: driverPhone, status: "suspended", reason: "Audit", adminId: 1 });
    // Réactivé, il repostule : nouvelle réserve de 300 FCFA sur la même ligne de candidature.
    const handle = (await db.getDb())!;
    const { and, eq } = await import("drizzle-orm");
    await handle.transaction(async (tx) => {
      await db.applyWalletMovement(tx, { profilePhone: driverPhone, deliveryId, operation: "block", amount: 300, availableDelta: -300, heldDelta: 300, reason: "Nouvelle candidature (test)", idempotencyKey: `${deliveryId}:${driverPhone}:reblock` });
    });
    await new Promise((resolve) => setTimeout(resolve, 1100)); // updatedAt a une précision d'une seconde
    await handle.update(schema.tikisDeliveryCandidates).set({ status: "applied", updatedAt: new Date() }).where(and(eq(schema.tikisDeliveryCandidates.deliveryId, deliveryId), eq(schema.tikisDeliveryCandidates.driverPhone, driverPhone)));

    await adminDb.adminSetProfileStatus({ phone: driverPhone, status: "suspended", reason: "Audit", adminId: 1 });
    expect(await wallet(driverPhone)).toEqual({ available: 5000, held: 0 });
  });
});

describe.skipIf(!TEST_DB)("validation manuelle d'un retrait — jamais sans preuve de versement", () => {
  async function pendingWithdrawal(amount = 2000) {
    const handle = (await db.getDb())!;
    const phone = newPhone();
    const id = randomUUID();
    await handle.transaction(async (tx) => {
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "credit", amount: 5000, availableDelta: 5000, heldDelta: 0, reason: "Solde de départ (test)", idempotencyKey: `${id}:seed` });
    });
    await handle.insert(schema.tikisPaymentTransactions).values({
      id, profilePhone: phone, type: "withdrawal", provider: "yengapay_test", amount, status: "pending", providerReference: `wd_admin_${id}`,
      checkoutUrl: null, idempotencyKey: `admin-audit-wd:${id}`,
    });
    return { id, phone };
  }

  it("refuse de valider un retrait sans référence de versement", async () => {
    const { id, phone } = await pendingWithdrawal();
    await expect(db.adminSettlePaymentTransaction({ paymentId: id, outcome: "succeeded", adminId: 1, notes: "Versé" })).rejects.toThrow(/référence/);
    expect(await wallet(phone)).toEqual({ available: 5000, held: 0 });
  });

  it("refuse de valider un retrait sans note", async () => {
    const { id } = await pendingWithdrawal();
    await expect(db.adminSettlePaymentTransaction({ paymentId: id, outcome: "succeeded", adminId: 1, payoutReference: "OM-123456" })).rejects.toThrow(/note/);
  });

  it("valide avec référence et note, et les enregistre avec l'admin", async () => {
    const { id, phone } = await pendingWithdrawal();
    await db.adminSettlePaymentTransaction({ paymentId: id, outcome: "succeeded", adminId: 42, payoutReference: ` OM-${id.slice(0, 8)} `, notes: "Versé par Orange Money" });
    expect(await wallet(phone)).toEqual({ available: 3000, held: 0 });
    const handle = (await db.getDb())!;
    const { eq } = await import("drizzle-orm");
    const row = (await handle.select().from(schema.tikisPaymentTransactions).where(eq(schema.tikisPaymentTransactions.id, id)).limit(1))[0]!;
    expect(row).toMatchObject({ status: "succeeded", payoutReference: `OM-${id.slice(0, 8)}`, adminNotes: "Versé par Orange Money", settledByAdminId: 42 });
  });

  it("une même référence ne justifie jamais deux retraits", async () => {
    const first = await pendingWithdrawal();
    const second = await pendingWithdrawal();
    const reference = `OM-${first.id.slice(0, 12)}`;
    await db.adminSettlePaymentTransaction({ paymentId: first.id, outcome: "succeeded", adminId: 1, payoutReference: reference, notes: "Versé" });
    await expect(db.adminSettlePaymentTransaction({ paymentId: second.id, outcome: "succeeded", adminId: 1, payoutReference: reference, notes: "Versé" })).rejects.toThrow(/déjà utilisée/);
    expect(await wallet(second.phone)).toEqual({ available: 5000, held: 0 });
  });

  it("un rejet de retrait se fait sans référence", async () => {
    const { id, phone } = await pendingWithdrawal();
    await db.adminSettlePaymentTransaction({ paymentId: id, outcome: "failed", adminId: 1, notes: "Numéro invalide" });
    expect(await wallet(phone)).toEqual({ available: 5000, held: 0 });
  });
});
