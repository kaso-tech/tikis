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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TIKIS_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.TIKIS_ADMIN_TOTP_KEY ??= "cle-totp-de-test-uniquement-0123456789abcdef";

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
    const { token } = await adminDb.createAdminSession({ adminId: admin.id });
    expect(await adminDb.authenticateAdminSession(token)).toMatchObject({ adminId: admin.id, role: "support" });

    await adminDb.setAdminUserActive({ actorAdminId: -1, adminId: admin.id, active: false });

    expect(await adminDb.authenticateAdminSession(token)).toBeNull();
  });

  it("le rôle appliqué est celui du compte, pas celui figé dans le jeton", async () => {
    const admin = await newAdmin("super_admin");
    const { token } = await adminDb.createAdminSession({ adminId: admin.id });
    const handle = (await db.getDb())!;
    const { eq } = await import("drizzle-orm");
    await handle.update(schema.tikisAdminUsers).set({ role: "support" }).where(eq(schema.tikisAdminUsers.id, admin.id));

    expect(await adminDb.authenticateAdminSession(token)).toMatchObject({ adminId: admin.id, role: "support" });
  });

  it("un compte supprimé ne s'authentifie plus", async () => {
    const admin = await newAdmin("finance");
    const { token } = await adminDb.createAdminSession({ adminId: admin.id });
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

describe.skipIf(!TEST_DB)("lot 2 — session admin révocable, en cookie", () => {
  async function newAdmin(role: "super_admin" | "support" | "finance" = "support", password = "mot-de-passe-audit") {
    const email = `lot2-${randomUUID()}@tikis.test`;
    return (await adminDb.createAdminUser({ email, passwordHash: await adminAuth.hashAdminPassword(password), fullName: "Audit", role }))!;
  }

  /** Appelle le vrai routeur admin avec une requête Express minimale, et capture les cookies posés. */
  async function caller(options: { ip?: string; cookie?: string; consoleHeader?: boolean } = {}) {
    const { tikisAdminRouter } = await import("../server/admin-router");
    const { createContext } = await import("../server/_core/context");
    const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const cleared: string[] = [];
    const headers: Record<string, string> = {};
    if (options.cookie) headers.cookie = options.cookie;
    if (options.consoleHeader !== false) headers["x-tikis-admin"] = "1";
    const req = { headers, ip: options.ip ?? "203.0.113.7", secure: true, socket: {} } as never;
    const res = {
      cookie: (name: string, value: string, cookieOptions: Record<string, unknown>) => { cookies.push({ name, value, options: cookieOptions }); },
      clearCookie: (name: string) => { cleared.push(name); },
    } as never;
    const ctx = await createContext({ req, res, info: {} as never });
    return { api: tikisAdminRouter.createCaller(ctx), cookies, cleared };
  }

  it("la connexion pose un cookie httpOnly strict et ne renvoie aucun jeton à la page", async () => {
    const admin = await newAdmin();
    const { api, cookies } = await caller();
    const result = await api.auth.login({ email: admin.email, password: "mot-de-passe-audit" });
    expect(JSON.stringify(result)).not.toMatch(/token/i);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ name: "tikis_admin_session", options: { httpOnly: true, sameSite: "strict", path: "/api", secure: true } });
    expect(cookies[0].options.domain).toBeUndefined();
  });

  it("le cookie authentifie avec l'en-tête de la console, et seulement avec lui", async () => {
    const admin = await newAdmin();
    const { token } = await adminDb.createAdminSession({ adminId: admin.id });
    const withHeader = await caller({ cookie: `tikis_admin_session=${token}` });
    expect(await withHeader.api.auth.me()).toMatchObject({ adminId: admin.id });
    // Une requête forgée par un autre site porterait le cookie, jamais l'en-tête.
    const forged = await caller({ cookie: `tikis_admin_session=${token}`, consoleHeader: false });
    expect(await forged.api.auth.me()).toBeNull();
  });

  it("la déconnexion révoque la session côté serveur : le cookie copié ne vaut plus rien", async () => {
    const admin = await newAdmin();
    const { token } = await adminDb.createAdminSession({ adminId: admin.id });
    const session = await caller({ cookie: `tikis_admin_session=${token}` });
    await session.api.auth.logout();
    expect(session.cleared).toContain("tikis_admin_session");
    expect(await adminDb.authenticateAdminSession(token)).toBeNull();
  });

  it("une session expirée est refusée", async () => {
    const admin = await newAdmin();
    const { token } = await adminDb.createAdminSession({ adminId: admin.id });
    const handle = (await db.getDb())!;
    const { eq } = await import("drizzle-orm");
    await handle.update(schema.tikisAdminSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.tikisAdminSessions.adminId, admin.id));
    expect(await adminDb.authenticateAdminSession(token)).toBeNull();
  });

  it("réactiver un admin suspendu ne ressuscite pas ses anciennes sessions", async () => {
    const admin = await newAdmin();
    const { token } = await adminDb.createAdminSession({ adminId: admin.id });
    await adminDb.setAdminUserActive({ actorAdminId: -1, adminId: admin.id, active: false });
    await adminDb.setAdminUserActive({ actorAdminId: -1, adminId: admin.id, active: true });
    expect(await adminDb.authenticateAdminSession(token)).toBeNull();
  });

  it("5 échecs depuis la même IP bloquent ce compte depuis cette IP, même avec le bon mot de passe", async () => {
    const admin = await newAdmin();
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect((await caller({ ip })).api.auth.login({ email: admin.email, password: "mauvais-mot-de-passe" })).rejects.toThrow(/Identifiants invalides/);
    }
    await expect((await caller({ ip })).api.auth.login({ email: admin.email, password: "mot-de-passe-audit" })).rejects.toThrow(/Trop de tentatives/);
  });

  it("changer d'IP ne contourne plus la limite : 20 échecs sur un même compte le bloquent partout", async () => {
    const admin = await newAdmin();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect((await caller({ ip: `192.0.2.${attempt}` })).api.auth.login({ email: admin.email, password: "mauvais-mot-de-passe" })).rejects.toThrow(/Identifiants invalides/);
    }
    // Avant correction : clé IP + email seulement — chaque nouvelle IP repartait de zéro.
    await expect((await caller({ ip: "192.0.2.250" })).api.auth.login({ email: admin.email, password: "mot-de-passe-audit" })).rejects.toThrow(/Trop de tentatives/);
  });

  it("les compteurs vivent en base : ils survivent à un redémarrage du processus", async () => {
    const admin = await newAdmin();
    const ip = "198.51.100.250";
    await adminDb.recordAdminLoginFailure(admin.email, ip);
    const handle = (await db.getDb())!;
    const { like } = await import("drizzle-orm");
    const rows = await handle.select().from(schema.tikisRateLimits).where(like(schema.tikisRateLimits.rateLimitKey, `admin-login:%${admin.email}%`));
    expect(rows.length).toBe(2);
  });

  it("un email inconnu donne la même erreur qu'un mauvais mot de passe", async () => {
    await expect((await caller({ ip: "198.51.100.251" })).api.auth.login({ email: `inconnu-${randomUUID()}@tikis.test`, password: "peu importe" })).rejects.toThrow(/^Identifiants invalides\.$/);
  });

  it("la carte en direct est refusée au rôle Finance", async () => {
    const admin = await newAdmin("finance");
    const { token } = await adminDb.createAdminSession({ adminId: admin.id });
    const { api } = await caller({ cookie: `tikis_admin_session=${token}` });
    await expect(api.deliveriesOps.liveLocations({ maxAgeSeconds: 120 })).rejects.toThrow(/rôle/);
  });
});

describe.skipIf(!TEST_DB)("lot 3 — double authentification TOTP", () => {
  const PASSWORD = "mot-de-passe-lot3";

  async function newAdmin(role: "super_admin" | "support" | "finance" = "support") {
    const email = `lot3-${randomUUID()}@tikis.test`;
    return (await adminDb.createAdminUser({ email, passwordHash: await adminAuth.hashAdminPassword(PASSWORD), fullName: "Audit", role }))!;
  }

  async function caller(cookie?: string) {
    const { tikisAdminRouter } = await import("../server/admin-router");
    const { createContext } = await import("../server/_core/context");
    const cookies: Array<{ name: string; value: string }> = [];
    const headers: Record<string, string> = { "x-tikis-admin": "1" };
    if (cookie) headers.cookie = `tikis_admin_session=${cookie}`;
    const req = { headers, ip: `203.0.113.${Math.floor(Math.random() * 250)}`, secure: true, socket: {} } as never;
    const res = { cookie: (name: string, value: string) => { cookies.push({ name, value }); }, clearCookie: () => {} } as never;
    const ctx = await createContext({ req, res, info: {} as never });
    return { api: tikisAdminRouter.createCaller(ctx), cookies };
  }

  /** Enrôle un compte comme le ferait la console ; renvoie le secret et les codes de secours. */
  async function enroll(adminId: number) {
    const { token } = await adminDb.createAdminSession({ adminId });
    const { api } = await caller(token);
    const { secret, qrSvg, otpauthUri } = await api.auth.totp.begin();
    expect(qrSvg).toContain("<svg");
    expect(otpauthUri).toContain(`secret=${secret}`);
    const { recoveryCodes } = await api.auth.totp.confirm({ code: totp.totpCode(secret) });
    return { secret, recoveryCodes, token };
  }

  let totp: typeof import("../server/admin-totp");
  beforeAll(async () => { if (TEST_DB) totp = await import("../server/admin-totp"); });

  async function setPolicy(required: boolean) {
    const handle = (await db.getDb())!;
    await handle.insert(schema.tikisPlatformSettings).values({ id: 1, adminTotpRequired: required }).onDuplicateKeyUpdate({ set: { adminTotpRequired: required } });
  }
  afterAll(async () => { if (TEST_DB) await setPolicy(false); });

  it("l'enrôlement active la double authentification et rend 10 codes de secours ; le secret est chiffré en base", async () => {
    const admin = await newAdmin();
    const { secret, recoveryCodes, token } = await enroll(admin.id);
    expect(recoveryCodes).toHaveLength(10);
    const { api } = await caller(token);
    expect(await api.auth.me()).toMatchObject({ adminId: admin.id, totpEnabled: true, mustEnrollTotp: false });
    const handle = (await db.getDb())!;
    const { eq } = await import("drizzle-orm");
    const row = (await handle.select().from(schema.tikisAdminUsers).where(eq(schema.tikisAdminUsers.id, admin.id)).limit(1))[0]!;
    expect(row.totpSecret).not.toContain(secret);
    expect(row.totpRecoveryCodes).not.toContain(recoveryCodes[0]);
  });

  it("un code faux ne confirme pas l'enrôlement", async () => {
    const admin = await newAdmin();
    const { token } = await adminDb.createAdminSession({ adminId: admin.id });
    const { api } = await caller(token);
    await api.auth.totp.begin();
    await expect(api.auth.totp.confirm({ code: "000000" })).rejects.toThrow(/Code invalide/);
    expect(await api.auth.me()).toMatchObject({ totpEnabled: false });
  });

  it("avec la double authentification, le mot de passe seul n'ouvre rien", async () => {
    const admin = await newAdmin();
    await enroll(admin.id);
    const login = await caller();
    expect(await login.api.auth.login({ email: admin.email, password: PASSWORD })).toEqual({ status: "totp_required" });
    const pendingToken = login.cookies[0]!.value;
    const pending = await caller(pendingToken);
    expect(await pending.api.auth.me()).toBeNull();
    await expect(pending.api.dashboard.metrics({ periodDays: 7 })).rejects.toThrow(/invalide ou expirée/);
  });

  it("le bon code ouvre une session neuve ; le jeton d'attente ne vaut plus rien", async () => {
    const admin = await newAdmin();
    const { secret } = await enroll(admin.id);
    const login = await caller();
    await login.api.auth.login({ email: admin.email, password: PASSWORD });
    const pendingToken = login.cookies[0]!.value;
    const verify = await caller(pendingToken);
    // Pas suivant : celui de l'enrôlement vient d'être consommé.
    await expect(verify.api.auth.verifyTotp({ code: totp.totpCode(secret, Date.now() + 30_000) })).resolves.toMatchObject({ status: "ok" });
    const activeToken = verify.cookies[0]!.value;
    expect(activeToken).not.toBe(pendingToken);
    expect(await (await caller(activeToken)).api.auth.me()).toMatchObject({ adminId: admin.id });
    await expect((await caller(pendingToken)).api.auth.verifyTotp({ code: "123456" })).rejects.toThrow(/expirée/);
  });

  it("un code déjà utilisé est refusé (pas de rejeu)", async () => {
    const admin = await newAdmin();
    const { secret } = await enroll(admin.id);
    const code = totp.totpCode(secret, Date.now() + 30_000);
    const first = await caller();
    await first.api.auth.login({ email: admin.email, password: PASSWORD });
    await (await caller(first.cookies[0]!.value)).api.auth.verifyTotp({ code });
    const second = await caller();
    await second.api.auth.login({ email: admin.email, password: PASSWORD });
    await expect((await caller(second.cookies[0]!.value)).api.auth.verifyTotp({ code })).rejects.toThrow(/Code invalide/);
  });

  it("un code de secours fonctionne une seule fois", async () => {
    const admin = await newAdmin();
    const { recoveryCodes } = await enroll(admin.id);
    const first = await caller();
    await first.api.auth.login({ email: admin.email, password: PASSWORD });
    await expect((await caller(first.cookies[0]!.value)).api.auth.verifyTotp({ code: recoveryCodes[0]!.toUpperCase() })).resolves.toMatchObject({ remainingRecoveryCodes: 9 });
    const second = await caller();
    await second.api.auth.login({ email: admin.email, password: PASSWORD });
    await expect((await caller(second.cookies[0]!.value)).api.auth.verifyTotp({ code: recoveryCodes[0]! })).rejects.toThrow(/Code invalide/);
  });

  it("5 codes faux révoquent la tentative : il faut repasser par le mot de passe", async () => {
    const admin = await newAdmin();
    const { secret } = await enroll(admin.id);
    const login = await caller();
    await login.api.auth.login({ email: admin.email, password: PASSWORD });
    const pendingToken = login.cookies[0]!.value;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect((await caller(pendingToken)).api.auth.verifyTotp({ code: "000000" })).rejects.toThrow(/Code invalide/);
    }
    await expect((await caller(pendingToken)).api.auth.verifyTotp({ code: totp.totpCode(secret, Date.now() + 30_000) })).rejects.toThrow(/Trop de codes/);
  });

  it("l'obligation ne peut pas être activée tant qu'un super-admin ou finance n'est pas enrôlé", async () => {
    const handle = (await db.getDb())!;
    const { inArray } = await import("drizzle-orm");
    await handle.update(schema.tikisAdminUsers).set({ active: false }).where(inArray(schema.tikisAdminUsers.role, ["super_admin", "finance"]));
    const actor = await newAdmin("super_admin");
    const { token } = await enroll(actor.id);
    const laggard = await newAdmin("finance");
    const { api } = await caller(token);
    await expect(api.security.setTotpRequired({ required: true })).rejects.toThrow(new RegExp(laggard.email.replace(/[.]/g, "\\.")));
    await enroll(laggard.id);
    await expect(api.security.setTotpRequired({ required: true })).resolves.toEqual({ required: true });
    await setPolicy(false);
  });

  it("obligation active : un compte finance non enrôlé n'accède qu'à son enrôlement", async () => {
    await setPolicy(true);
    try {
      const admin = await newAdmin("finance");
      const { token } = await adminDb.createAdminSession({ adminId: admin.id });
      const { api } = await caller(token);
      expect(await api.auth.me()).toMatchObject({ mustEnrollTotp: true });
      await expect(api.finance.transactions({})).rejects.toThrow(/double authentification/);
      await expect(api.auth.totp.begin()).resolves.toMatchObject({ secret: expect.any(String) });
      // Le support n'est pas concerné par l'obligation.
      const support = await newAdmin("support");
      const supportSession = await adminDb.createAdminSession({ adminId: support.id });
      expect(await (await caller(supportSession.token)).api.auth.me()).toMatchObject({ mustEnrollTotp: false });
    } finally {
      await setPolicy(false);
    }
  });

  it("obligation active : un super-admin ne peut pas désactiver sa double authentification ; un support le peut", async () => {
    const boss = await newAdmin("super_admin");
    const bossEnrolled = await enroll(boss.id);
    const support = await newAdmin("support");
    const supportEnrolled = await enroll(support.id);
    await setPolicy(true);
    try {
      await expect((await caller(bossEnrolled.token)).api.auth.totp.disable({ code: bossEnrolled.recoveryCodes[0]! })).rejects.toThrow(/obligatoire/);
      await (await caller(supportEnrolled.token)).api.auth.totp.disable({ code: supportEnrolled.recoveryCodes[0]! });
      expect(await (await caller(supportEnrolled.token)).api.auth.me()).toMatchObject({ totpEnabled: false });
    } finally {
      await setPolicy(false);
    }
  });

  it("téléphone perdu : un super-admin réinitialise un autre compte, dont les sessions tombent ; jamais le sien", async () => {
    const boss = await newAdmin("super_admin");
    const bossSession = await adminDb.createAdminSession({ adminId: boss.id });
    const target = await newAdmin("finance");
    const { token: targetToken } = await enroll(target.id);
    const { api } = await caller(bossSession.token);
    await api.security.resetTotp({ adminId: target.id });
    expect(await adminDb.authenticateAdminSession(targetToken)).toBeNull();
    const list = await api.admins.list();
    expect(list.find((row) => row.id === target.id)).toMatchObject({ totpEnabled: false });
    await expect(api.security.resetTotp({ adminId: boss.id })).rejects.toThrow(/propre/);
  });
});

describe.skipIf(!TEST_DB)("lot 4 — pièces KYC et pièces jointes, réservées à la console", () => {
  const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const reads: string[] = [];
  const fakeRead = async (key: string) => { reads.push(key); return { body: IMAGE, contentType: "image/jpeg" }; };

  async function sessionFor(role: "super_admin" | "support" | "finance") {
    const admin = (await adminDb.createAdminUser({ email: `lot4-${randomUUID()}@tikis.test`, passwordHash: await adminAuth.hashAdminPassword("mot-de-passe-lot4"), fullName: "Audit", role }))!;
    return { admin, token: (await adminDb.createAdminSession({ adminId: admin.id })).token };
  }

  async function submission() {
    const phone = newPhone();
    const { id } = await db.createKycSubmission({ driverPhone: phone, idFrontKey: `tikis-kyc/${phone}/front.jpg`, idBackKey: `tikis-kyc/${phone}/back.jpg`, selfieKey: `tikis-kyc/${phone}/selfie.jpg` });
    return { id, phone };
  }

  it("le support voit la pièce demandée, lue d'après la base, et la consultation est journalisée", async () => {
    const documents = await import("../server/admin-documents");
    const { admin, token } = await sessionFor("support");
    const { id, phone } = await submission();
    const result = await documents.resolveAdminDocument({ sessionToken: token, request: { kind: "kyc", submissionId: id, side: "selfie" } }, fakeRead);
    expect(result).toMatchObject({ status: 200, contentType: "image/jpeg" });
    expect(reads.at(-1)).toBe(`tikis-kyc/${phone}/selfie.jpg`);
    const log = await adminDb.listAdminAuditLog({ targetType: "kyc_submission", targetId: id });
    expect(log.rows[0]).toMatchObject({ adminId: admin.id, action: "kyc_document_viewed" });
  });

  it("sans session : 401, et le stockage n'est jamais lu", async () => {
    const documents = await import("../server/admin-documents");
    const { id } = await submission();
    const before = reads.length;
    expect(await documents.resolveAdminDocument({ sessionToken: undefined, request: { kind: "kyc", submissionId: id, side: "id-front" } }, fakeRead)).toMatchObject({ status: 401 });
    expect(reads.length).toBe(before);
  });

  it("le rôle Finance n'a pas accès aux pièces d'identité", async () => {
    const documents = await import("../server/admin-documents");
    const { token } = await sessionFor("finance");
    const { id } = await submission();
    expect(await documents.resolveAdminDocument({ sessionToken: token, request: { kind: "kyc", submissionId: id, side: "id-front" } }, fakeRead)).toMatchObject({ status: 403 });
  });

  it("une session en attente du code de double authentification n'ouvre pas les pièces", async () => {
    const documents = await import("../server/admin-documents");
    const { admin } = await sessionFor("support");
    const pending = await adminDb.createAdminSession({ adminId: admin.id, stage: "pending_totp" });
    const { id } = await submission();
    expect(await documents.resolveAdminDocument({ sessionToken: pending.token, request: { kind: "kyc", submissionId: id, side: "id-front" } }, fakeRead)).toMatchObject({ status: 401 });
  });

  it("un côté inconnu ou un dossier inexistant : 404 — la route ne sert que les clés rangées en base", async () => {
    const documents = await import("../server/admin-documents");
    const { token } = await sessionFor("super_admin");
    const { id } = await submission();
    expect(await documents.resolveAdminDocument({ sessionToken: token, request: { kind: "kyc", submissionId: id, side: "idFrontKey" } }, fakeRead)).toMatchObject({ status: 404 });
    expect(await documents.resolveAdminDocument({ sessionToken: token, request: { kind: "kyc", submissionId: id, side: "__proto__" } }, fakeRead)).toMatchObject({ status: 404 });
    expect(await documents.resolveAdminDocument({ sessionToken: token, request: { kind: "kyc", submissionId: randomUUID(), side: "selfie" } }, fakeRead)).toMatchObject({ status: 404 });
  });

  it("un type de fichier inattendu n'est jamais servi comme contenu interprétable", async () => {
    const documents = await import("../server/admin-documents");
    const { token } = await sessionFor("support");
    const { id } = await submission();
    const result = await documents.resolveAdminDocument({ sessionToken: token, request: { kind: "kyc", submissionId: id, side: "id-back" } }, async () => ({ body: Buffer.from("<script>"), contentType: "text/html" }));
    expect(result).toMatchObject({ status: 200, contentType: "application/octet-stream" });
  });

  it("la route HTTP réelle : cookie de session exigé, en-têtes anti-cache", async () => {
    const express = (await import("express")).default;
    const { registerAdminDocumentRoutes } = await import("../server/admin-documents");
    const app = express();
    registerAdminDocumentRoutes(app);
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const port = (server.address() as import("node:net").AddressInfo).port;
      const { id } = await submission();
      const { token } = await sessionFor("support");
      const anonymous = await fetch(`http://127.0.0.1:${port}/api/admin/documents/kyc/${id}/selfie`);
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get("cache-control")).toBe("no-store, private");
      // Avec session : la lecture réelle du stockage échoue ici (aucun stockage configuré en test) → 502,
      // preuve que l'authentification et la recherche en base sont passées.
      const authed = await fetch(`http://127.0.0.1:${port}/api/admin/documents/kyc/${id}/selfie`, { headers: { cookie: `tikis_admin_session=${token}` } });
      expect(authed.status).toBe(502);
    } finally {
      server.close();
    }
  });

  it("pièce jointe de signalement : servie au support", async () => {
    const documents = await import("../server/admin-documents");
    const { token } = await sessionFor("support");
    const handle = (await db.getDb())!;
    const reportId = randomUUID();
    await handle.insert(schema.tikisDeliveryReports).values({ id: reportId, deliveryId: randomUUID(), reporterPhone: newPhone(), reporterRole: "sender", reason: "damaged", description: "Colis abîmé", attachmentKey: "tikis-reports/x/photo.png" });
    expect(await documents.resolveAdminDocument({ sessionToken: token, request: { kind: "report", reportId } }, fakeRead)).toMatchObject({ status: 200 });
    expect(reads.at(-1)).toBe("tikis-reports/x/photo.png");
  });
});

describe.skipIf(!TEST_DB)("lot 5 — traçabilité et pilotage", () => {
  async function adminCaller(role: "super_admin" | "support" | "finance" = "super_admin") {
    const admin = (await adminDb.createAdminUser({ email: `lot5-${randomUUID()}@tikis.test`, passwordHash: await adminAuth.hashAdminPassword("mot-de-passe-lot5"), fullName: "Audit", role }))!;
    const { token } = await adminDb.createAdminSession({ adminId: admin.id });
    const { tikisAdminRouter } = await import("../server/admin-router");
    const { createContext } = await import("../server/_core/context");
    const req = { headers: { "x-tikis-admin": "1", cookie: `tikis_admin_session=${token}` }, ip: "203.0.113.50", secure: true, socket: {} } as never;
    const res = { cookie: () => {}, clearCookie: () => {} } as never;
    return { admin, api: tikisAdminRouter.createCaller(await createContext({ req, res, info: {} as never })) };
  }

  async function auditRows(adminId: number) {
    const handle = (await db.getDb())!;
    const { desc, eq } = await import("drizzle-orm");
    return handle.select().from(schema.tikisAdminAuditLog).where(eq(schema.tikisAdminAuditLog.adminId, adminId)).orderBy(desc(schema.tikisAdminAuditLog.createdAt));
  }

  it("chaque modification laisse la demande, puis le détail avec la valeur avant et après", async () => {
    const { admin, api } = await adminCaller();
    const before = await db.getTikisCommissionRate();
    const next = before === 0.1 ? 0.12 : 0.1;
    try {
      await api.commission.update({ rate: next });
      const rows = await auditRows(admin.id);
      expect(rows.find((row) => row.targetType === "admin_request")).toMatchObject({ action: "commission.update" });
      const detail = rows.find((row) => row.action === "commission_rate_updated")!;
      expect(JSON.parse(detail.details!)).toEqual({ before, after: next });
    } finally {
      await adminDb.adminUpdateCommissionRate(before);
    }
  });

  it("si le journal est indisponible, la modification est refusée et n'a pas lieu", async () => {
    const { api } = await adminCaller();
    const before = await db.getTikisCommissionRate();
    const handle = (await db.getDb())!;
    const { sql } = await import("drizzle-orm");
    await handle.execute(sql`RENAME TABLE tikis_admin_audit_log TO tikis_admin_audit_log_offline`);
    try {
      await expect(api.commission.update({ rate: before === 0.1 ? 0.15 : 0.1 })).rejects.toThrow(/journal d’audit est indisponible/);
    } finally {
      await handle.execute(sql`RENAME TABLE tikis_admin_audit_log_offline TO tikis_admin_audit_log`);
    }
    expect(await db.getTikisCommissionRate()).toBe(before);
  });

  it("aucun code ni mot de passe n'est recopié dans le journal", async () => {
    const { admin, api } = await adminCaller("support");
    await expect(api.auth.totp.disable({ code: "123456" })).rejects.toThrow();
    const request = (await auditRows(admin.id)).find((row) => row.targetType === "admin_request")!;
    expect(request.details).not.toContain("123456");
    expect(JSON.parse(request.details!)).toEqual({ code: "[masqué]" });
  });

  it("le journal montre les actions ; les demandes brutes seulement sur demande", async () => {
    const { admin, api } = await adminCaller();
    await api.maintenance.set({ enabled: false });
    const shown = await adminDb.listAdminAuditLog({ limit: 200 });
    expect(shown.rows.some((row) => row.adminEmail === admin.email && row.targetType === "admin_request")).toBe(false);
    expect(shown.rows.some((row) => row.adminEmail === admin.email && row.action === "maintenance_mode_changed")).toBe(true);
    const all = await adminDb.listAdminAuditLog({ includeRequests: true, limit: 200 });
    expect(all.rows.some((row) => row.adminEmail === admin.email && row.targetType === "admin_request")).toBe(true);
  });

  it("KYC : un dossier ne se tranche qu'une fois", async () => {
    const { api } = await adminCaller("support");
    const { id } = await db.createKycSubmission({ driverPhone: newPhone(), idFrontKey: "tikis-kyc/x/f.jpg", idBackKey: "tikis-kyc/x/b.jpg", selfieKey: "tikis-kyc/x/s.jpg" });
    await api.kyc.review({ submissionId: id, decision: "approved" });
    // Avant correction : accepté, le dossier approuvé devenait refusé sans que le livreur le sache.
    await expect(api.kyc.review({ submissionId: id, decision: "rejected", rejectionReason: "Flou" })).rejects.toThrow(/déjà été approuvé/);
  });

  it("signalement : l'auteur est prévenu de la décision, un dossier clos se rouvre avant un autre verdict", async () => {
    const { api } = await adminCaller("support");
    const handle = (await db.getDb())!;
    const { and, eq } = await import("drizzle-orm");
    const reporterPhone = newPhone();
    const { id } = await adminDb.createDeliveryReport({ deliveryId: randomUUID(), reporterPhone, reporterRole: "sender", reason: "late", description: "Très en retard" });
    const decisions = async () => handle.select().from(schema.tikisDeliveryEvents).where(and(eq(schema.tikisDeliveryEvents.recipientPhone, reporterPhone), eq(schema.tikisDeliveryEvents.eventType, "report_decision")));

    await api.reports.resolve({ reportId: id, status: "resolved", resolutionNotes: "Livreur averti (interne)", replyToReporter: "Le livreur a été averti." });
    let events = await decisions();
    expect(events).toHaveLength(1);
    expect(events[0]!.body).toContain("Le livreur a été averti.");
    expect(events[0]!.body).not.toContain("interne");

    await expect(api.reports.resolve({ reportId: id, status: "dismissed" })).rejects.toThrow(/déjà clos/);
    await api.reports.resolve({ reportId: id, status: "reviewing" });
    expect((await adminDb.getDeliveryReportById(id))!.resolvedAt).toBeNull();
    await api.reports.resolve({ reportId: id, status: "dismissed" });
    events = await decisions();
    expect(events).toHaveLength(2);
  });

  it("tableau de bord : terminées comptées à leur date de fin, revenu net des commissions rendues", async () => {
    const handle = (await db.getDb())!;
    const before = (await adminDb.adminDashboardMetrics(30))!;
    const driverPhone = newPhone();
    // Publiée il y a 40 jours, terminée hier : elle compte dans les 30 derniers jours.
    await handle.insert(schema.tikisDeliveries).values({
      id: randomUUID(), senderPhone: newPhone(), pickupPlaceId: 1, dropoffPlaceId: 2, title: "Ancienne course", details: "",
      deliveryType: "Plis", distanceKm: "3.00", estimatedPrice: 3000, vehicleTypes: "Moto", status: "completed", driverPhone,
      createdAt: new Date(Date.now() - 40 * 86_400_000), completedAt: new Date(Date.now() - 86_400_000),
    });
    await handle.transaction(async (tx) => {
      await db.applyWalletMovement(tx, { profilePhone: driverPhone, operation: "credit", amount: 1000, availableDelta: 1000, heldDelta: 0, reason: "Solde (test)", idempotencyKey: `${driverPhone}:seed` });
      await db.applyWalletMovement(tx, { profilePhone: driverPhone, operation: "commission_debit", amount: 500, availableDelta: -500, heldDelta: 0, reason: "Commission (test)", idempotencyKey: `${driverPhone}:commission` });
      await db.applyWalletMovement(tx, { profilePhone: driverPhone, operation: "compensation", amount: 200, availableDelta: 200, heldDelta: 0, reason: "Commission rendue (test)", idempotencyKey: `${driverPhone}:refund` });
    });
    const after = (await adminDb.adminDashboardMetrics(30))!;
    expect(after.deliveriesCompleted - before.deliveriesCompleted).toBe(1);
    expect(after.commissionGross - before.commissionGross).toBe(500);
    expect(after.commissionRefunds - before.commissionRefunds).toBe(200);
    // Avant correction : +500, la commission rendue restait comptée comme revenu.
    expect(after.commissionRevenue - before.commissionRevenue).toBe(300);
  });

  it("transactions : recherche par téléphone (format local ou international) et par référence, filtre expirée, pagination", async () => {
    const { api } = await adminCaller("finance");
    const handle = (await db.getDb())!;
    const phone = newPhone();
    const ids: string[] = [];
    for (const status of ["succeeded", "expired", "failed"] as const) {
      const id = randomUUID();
      ids.push(id);
      await handle.insert(schema.tikisPaymentTransactions).values({ id, profilePhone: phone, type: "deposit", provider: "yengapay_live", amount: 1000, status, providerReference: `pi_lot5_${id}`, checkoutUrl: null, idempotencyKey: `lot5:${id}` });
    }
    const local = phone.replace("+226", "");
    expect((await api.finance.transactions({ query: local })).total).toBe(3);
    expect((await api.finance.transactions({ query: phone })).total).toBe(3);
    expect((await api.finance.transactions({ query: `pi_lot5_${ids[1]}` })).rows.map((row) => row.id)).toEqual([ids[1]]);
    expect((await api.finance.transactions({ query: local, status: "expired" })).rows.map((row) => row.id)).toEqual([ids[1]]);
    const firstPage = await api.finance.transactions({ query: local, limit: 2, offset: 0 });
    const secondPage = await api.finance.transactions({ query: local, limit: 2, offset: 2 });
    expect(firstPage.rows).toHaveLength(2);
    expect(secondPage.rows).toHaveLength(1);
    expect(firstPage.total).toBe(3);
  });
});
