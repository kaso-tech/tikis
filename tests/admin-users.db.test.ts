/**
 * Lot D — support utilisateur et suppression des comptes, contre une vraie base PostgreSQL, par le
 * vrai routeur admin.
 *
 *   TIKISSE_TEST_DATABASE_URL=<url> npx vitest run tests/admin-users.db.test.ts
 *
 * (schéma : drizzle/manual/0049_user_support_and_deletion.sql)
 *
 * Aucun super-admin n'est créé ici : tests/admin-governance.db.test.ts compte les super-admins actifs, et
 * les fichiers de tests tournent en parallèle sur la même base.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TIKISSE_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.TIKISSE_ADMIN_TOTP_KEY ??= "cle-totp-de-test-uniquement-0123456789abcdef";
process.env.TIKISSE_SESSION_SECRET ??= "secret-de-session-de-test-lot-d-0123456789";

type Role = "support" | "finance" | "viewer";
let db: typeof import("../server/db");
let adminDb: typeof import("../server/admin-db");
let adminAuth: typeof import("../server/admin-auth");
let approvals: typeof import("../server/admin-approvals");
let deletions: typeof import("../server/admin-deletions");
let schema: typeof import("../drizzle/schema");
let orm: typeof import("drizzle-orm");
let previousThreshold = 100_000;

beforeAll(async () => {
  if (!TEST_DB) return;
  db = await import("../server/db");
  adminDb = await import("../server/admin-db");
  adminAuth = await import("../server/admin-auth");
  approvals = await import("../server/admin-approvals");
  deletions = await import("../server/admin-deletions");
  schema = await import("../drizzle/schema");
  orm = await import("drizzle-orm");
  previousThreshold = await approvals.getApprovalThreshold();
  await approvals.setApprovalThreshold(100_000);
});

afterAll(async () => {
  if (TEST_DB) await approvals.setApprovalThreshold(previousThreshold);
});

const newPhone = () => `+22679${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function session(role: Role) {
  const admin = (await adminDb.createAdminUser({ email: `lot-d-${randomUUID()}@tikisse.test`, passwordHash: await adminAuth.hashAdminPassword("mot-de-passe-lot-d"), fullName: "Lot D", role }))!;
  const { token } = await adminDb.createAdminSession({ adminId: admin.id });
  const { tikisseAdminRouter } = await import("../server/admin-router");
  const { createContext } = await import("../server/_core/context");
  const req = { headers: { "x-tikisse-admin": "1", cookie: `tikisse_admin_session=${token}` }, ip: "198.51.100.9", secure: true, socket: {} } as never;
  const res = { cookie: () => {}, clearCookie: () => {} } as never;
  return { admin, api: tikisseAdminRouter.createCaller(await createContext({ req, res, info: {} as never })) };
}

/** Le numéro que le serveur reconnaît pour ce jeton de session d'application (null : refusé). */
async function appPhoneFor(token: string) {
  const { createContext } = await import("../server/_core/context");
  const req = { headers: { "x-tikisse-session": token }, socket: {} } as never;
  return (await createContext({ req, res: {} as never, info: {} as never })).tikisseProfilePhone;
}

async function profile(accountType: "sender" | "driver" = "driver", extra: Partial<typeof schema.tikisseProfiles.$inferInsert> = {}) {
  const phone = newPhone();
  const handle = (await db.getDb())!;
  await handle.insert(schema.tikisseProfiles).values({ phone, fullName: "Mariam Kaboré", accountType, vehicles: "[\"Moto\"]", email: "mariam@example.test", photoKey: `tikisse-profiles/${phone}/photo.jpg`, city: "Ouagadougou", ...extra });
  return phone;
}

async function fund(phone: string, amount: number) {
  const handle = (await db.getDb())!;
  await handle.transaction(async (tx) => {
    await db.applyWalletMovement(tx, { profilePhone: phone, operation: "credit", amount, availableDelta: amount, heldDelta: 0, reason: "Recharge (test)", idempotencyKey: `direct:${phone}:${randomUUID()}`.slice(0, 100) });
  });
}

async function wallet(phone: string) {
  const handle = (await db.getDb())!;
  const row = (await handle.select().from(schema.tikisseWallets).where(orm.eq(schema.tikisseWallets.profilePhone, phone)).limit(1))[0];
  return { available: row?.availableBalance ?? 0, held: row?.heldBalance ?? 0 };
}

/** Demande de suppression faite il y a `daysAgo` jours (délai de 30 jours). */
async function requestDeletion(phone: string, daysAgo = 31) {
  const handle = (await db.getDb())!;
  const requestedAt = new Date(Date.now() - daysAgo * 86_400_000);
  await handle.update(schema.tikisseProfiles).set({ deletionRequestedAt: requestedAt, deletionScheduledAt: new Date(requestedAt.getTime() + 30 * 86_400_000) }).where(orm.eq(schema.tikisseProfiles.phone, phone));
}

describe.skipIf(!TEST_DB)("déconnexion forcée", () => {
  it("refuse tout jeton émis avant, qu'il ait été enregistré comme appareil ou non ; la reconnexion reste possible", async () => {
    const { createTikisseProfileSession } = await import("../server/tikisse-session");
    const { recordSession } = await import("../server/sessions");
    const phone = await profile();
    const registered = await createTikisseProfileSession(phone);
    const unregistered = await createTikisseProfileSession(phone);
    await recordSession({ phone, token: registered, deviceName: "Tecno Spark", platform: "android" });
    const handle = (await db.getDb())!;
    await handle.insert(schema.tikissePushTokens).values({ id: randomUUID(), phone, token: `ExponentPushToken[${randomUUID()}]`, platform: "android" });
    expect(await appPhoneFor(registered)).toBe(phone);
    expect(await appPhoneFor(unregistered)).toBe(phone);

    const { api } = await session("support");
    const devices = await api.users.devices({ phone });
    expect(devices.sessions).toHaveLength(1);
    expect(devices.sessions[0]).toMatchObject({ deviceName: "Tecno Spark", active: true });
    expect(devices.pushTokens).toHaveLength(1);

    await sleep(1100); // les jetons portent leur date d'émission à la seconde
    await expect(api.users.forceLogout({ phone, reason: "Téléphone volé" })).resolves.toMatchObject({ revokedSessions: 1, removedPushTokens: 1 });
    expect(await appPhoneFor(registered)).toBeNull();
    expect(await appPhoneFor(unregistered)).toBeNull();
    expect(await appPhoneFor(await createTikisseProfileSession(phone))).toBe(phone);
    expect((await api.users.devices({ phone })).sessions[0]).toMatchObject({ active: false });
    expect((await api.users.history({ phone })).map((row) => row.action)).toContain("user_force_logout");
  });

  it("déconnecte un seul appareil enregistré", async () => {
    const { recordSession } = await import("../server/sessions");
    const phone = await profile();
    const first = await recordSession({ phone, token: `jeton-a-${randomUUID()}`, deviceName: "Appareil A" });
    await recordSession({ phone, token: `jeton-b-${randomUUID()}`, deviceName: "Appareil B" });
    const { api } = await session("support");
    await api.users.revokeSession({ phone, sessionId: first!.id });
    const states = Object.fromEntries((await api.users.devices({ phone })).sessions.map((row) => [row.deviceName, row.active]));
    expect(states).toEqual({ "Appareil A": false, "Appareil B": true });
  });
});

describe.skipIf(!TEST_DB)("notes internes et historique", () => {
  it("les notes s'ajoutent et se lisent ; l'historique garde les décisions, pas les consultations", async () => {
    const phone = await profile();
    const support = (await session("support")).api;
    await support.users.addNote({ phone, body: "A appelé le support : colis perdu le 12/09, dossier transmis." });
    await support.users.detail({ phone }).catch(() => undefined);
    await support.users.setStatus({ phone, status: "suspended", reason: "Enquête en cours" });
    const notes = await support.users.notes({ phone });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ body: "A appelé le support : colis perdu le 12/09, dossier transmis." });
    const actions = (await support.users.history({ phone })).map((row) => row.action);
    expect(actions).toContain("profile_status_changed");
    expect(actions).not.toContain("profile_viewed");
    expect(actions).not.toContain("profile_note_added");
    const viewer = (await session("viewer")).api;
    await expect(viewer.users.notes({ phone })).rejects.toThrow(/rôle/);
  });
});

describe.skipIf(!TEST_DB)("limites anti-abus", () => {
  it("au-delà de 5 tentatives, le numéro est bloqué 30 min ; le support lève le blocage", async () => {
    const phone = newPhone();
    for (let attempt = 0; attempt < 5; attempt += 1) expect(await db.checkPhoneAttemptLimit("lookup", phone)).toEqual({ allowed: true });
    expect(await db.checkPhoneAttemptLimit("lookup", phone)).toEqual({ allowed: false, retryInMinutes: 30 });
    expect(await db.checkPhoneAttemptLimit("lookup", phone)).toMatchObject({ allowed: false });
    expect(await db.checkPhoneAttemptLimit("register", phone)).toEqual({ allowed: true });

    const { api } = await session("support");
    const limits = await api.users.rateLimits({ phone });
    expect(limits.find((row) => row.kind === "block")).toMatchObject({ scope: "lookup", label: "Connexion", blockedForMinutes: 30 });
    await expect((await session("finance")).api.users.clearRateLimits({ phone, reason: "Essai" })).rejects.toThrow(/rôle/);
    await expect(api.users.clearRateLimits({ phone, reason: "Utilisateur de bonne foi" })).resolves.toMatchObject({ cleared: 3 });
    expect(await db.checkPhoneAttemptLimit("lookup", phone)).toEqual({ allowed: true });
    expect(await api.users.rateLimits({ phone })).toHaveLength(1);
  });
});

describe.skipIf(!TEST_DB)("suppression des comptes", () => {
  it("attend tant qu'il reste un solde ; une fois versé, supprime, pseudonymise et libère le numéro", async () => {
    const phone = await profile("driver");
    await fund(phone, 3500);
    const handle = (await db.getDb())!;
    const submissionId = randomUUID();
    await handle.insert(schema.tikisseKycSubmissions).values({ id: submissionId, driverPhone: phone, idFrontKey: `tikisse-kyc/${phone}/recto.jpg`, idBackKey: `tikisse-kyc/${phone}/verso.jpg`, selfieKey: `tikisse-kyc/${phone}/selfie.jpg`, status: "approved" });
    await handle.insert(schema.tikisseFavoritePlaces).values({ profilePhone: phone, placeId: 1, label: "Maison" });
    const support = (await session("support")).api;
    const finance = (await session("finance")).api;
    await support.users.addNote({ phone, body: "Demande de suppression confirmée par téléphone." });
    await requestDeletion(phone);

    const listed = (await support.accountDeletions.list()).requests.find((row) => row.phone === phone);
    expect(listed).toMatchObject({ state: "blocked", available: 3500 });
    expect(listed?.blockers.map((blocker) => blocker.code)).toEqual(["balance"]);
    await expect(support.accountDeletions.finalize({ phone })).rejects.toThrow(/Solde de 3\s500 FCFA à verser/);

    await expect(support.accountDeletions.payoutBalance({ phone, payoutReference: "OM-CLOT-1", notes: "Orange Money", requestId: randomUUID() })).rejects.toThrow(/rôle/);
    const reference = `OM-${randomUUID().slice(0, 8)}`;
    await expect(finance.accountDeletions.payoutBalance({ phone, payoutReference: reference, notes: "Orange Money, même numéro", requestId: randomUUID() })).resolves.toMatchObject({ approvalRequired: false, amount: 3500, status: "succeeded" });
    expect(await wallet(phone)).toEqual({ available: 0, held: 0 });
    const payout = (await handle.select().from(schema.tikissePaymentTransactions).where(orm.eq(schema.tikissePaymentTransactions.payoutReference, reference)))[0];
    expect(payout).toMatchObject({ type: "withdrawal", provider: "manual_payout", status: "succeeded", amount: 3500 });

    const { pseudonym, purgeAfter } = await support.accountDeletions.finalize({ phone });
    expect(pseudonym).toMatch(/^del-[0-9a-f]{16}$/);
    expect(new Date(purgeAfter).getFullYear()).toBe(new Date().getFullYear() + 10);

    // Le numéro est libre ; l'historique reste, sous pseudonyme.
    expect(await db.getTikisseProfileByPhone(phone)).toBeUndefined();
    const anonymized = await db.getTikisseProfileByPhone(pseudonym);
    expect(anonymized).toMatchObject({ fullName: "Compte supprimé", email: null, photoKey: null, city: null });
    expect(anonymized?.deletedAt).toBeTruthy();
    const ledger = await handle.select().from(schema.tikisseWalletLedger).where(orm.eq(schema.tikisseWalletLedger.profilePhone, pseudonym));
    expect(ledger.length).toBeGreaterThanOrEqual(3);
    expect(ledger.some((row) => row.idempotencyKey.includes(phone))).toBe(false);
    expect(ledger.some((row) => row.idempotencyKey.startsWith(`direct:${pseudonym}:`))).toBe(true);
    expect((await handle.select().from(schema.tikissePaymentTransactions).where(orm.eq(schema.tikissePaymentTransactions.id, payout!.id)))[0]?.profilePhone).toBe(pseudonym);

    // Pièce d'identité effacée (la décision reste), données sans valeur comptable supprimées.
    const kyc = (await handle.select().from(schema.tikisseKycSubmissions).where(orm.eq(schema.tikisseKycSubmissions.id, submissionId)))[0];
    expect(kyc).toMatchObject({ driverPhone: pseudonym, idFrontKey: "", idBackKey: "", selfieKey: "", status: "approved" });
    expect(kyc?.documentsErasedAt).toBeTruthy();
    expect(await handle.select().from(schema.tikisseFavoritePlaces).where(orm.eq(schema.tikisseFavoritePlaces.profilePhone, pseudonym))).toHaveLength(0);
    expect(await support.users.notes({ phone: pseudonym })).toHaveLength(0);
    const queued = await handle.select().from(schema.tikisseStorageErasures).where(orm.like(schema.tikisseStorageErasures.storageKey, `%${phone}%`));
    expect(queued.map((row) => row.storageKey).sort()).toEqual([`tikisse-kyc/${phone}/recto.jpg`, `tikisse-kyc/${phone}/selfie.jpg`, `tikisse-kyc/${phone}/verso.jpg`, `tikisse-profiles/${phone}/photo.jpg`]);

    // Retrouvable par l'ancien numéro pendant 10 ans, puis plus du tout.
    expect(await finance.accountDeletions.findByPhone({ phone })).toEqual([expect.objectContaining({ pseudonym, accountType: "driver" })]);

    // Le numéro peut servir à une nouvelle inscription.
    await expect(db.createTikisseProfile({ phone, fullName: "Nouveau titulaire", accountType: "sender", vehicles: "[]" })).resolves.toMatchObject({ phone, fullName: "Nouveau titulaire" });
    await expect(support.accountDeletions.finalize({ phone: pseudonym })).rejects.toThrow(/déjà supprimé/);
  });

  it("au-delà du seuil, le versement du solde attend un second admin", async () => {
    const phone = await profile("sender");
    await fund(phone, 150_000);
    await requestDeletion(phone);
    const requester = (await session("finance")).api;
    const approver = (await session("finance")).api;
    const request = await requester.accountDeletions.payoutBalance({ phone, payoutReference: `WAVE-${randomUUID().slice(0, 8)}`, notes: "Wave", requestId: randomUUID() });
    expect(request).toMatchObject({ approvalRequired: true, amount: 150_000 });
    expect(await wallet(phone)).toEqual({ available: 150_000, held: 0 });
    const support = (await session("support")).api;
    await expect(support.accountDeletions.finalize({ phone })).rejects.toThrow(/paiement\(s\) en attente/);
    if (!("approvalId" in request)) throw new Error("demande attendue");
    await expect(approver.approvals.approve({ approvalId: request.approvalId })).resolves.toMatchObject({ status: "executed" });
    expect(await wallet(phone)).toEqual({ available: 0, held: 0 });
    await expect(support.accountDeletions.finalize({ phone })).resolves.toMatchObject({ pseudonym: expect.stringMatching(/^del-/) });
  });

  it("une référence de versement déjà utilisée n'annule rien et ne bloque pas une nouvelle tentative", async () => {
    const phone = await profile("sender");
    await fund(phone, 2000);
    await requestDeletion(phone);
    const finance = (await session("finance")).api;
    const other = await profile("sender");
    await fund(other, 1000);
    await requestDeletion(other);
    const reference = `OM-${randomUUID().slice(0, 8)}`;
    await finance.accountDeletions.payoutBalance({ phone: other, payoutReference: reference, notes: "Orange Money", requestId: randomUUID() });
    await expect(finance.accountDeletions.payoutBalance({ phone, payoutReference: reference, notes: "Orange Money", requestId: randomUUID() })).rejects.toThrow(/déjà utilisée/);
    expect(await wallet(phone)).toEqual({ available: 2000, held: 0 });
    await expect(finance.accountDeletions.payoutBalance({ phone, payoutReference: `${reference}-B`, notes: "Orange Money", requestId: randomUUID() })).resolves.toMatchObject({ status: "succeeded" });
  });

  it("jamais avant la fin du délai de 30 jours, ni avec une livraison en cours ; l'annulation reste possible", async () => {
    const support = (await session("support")).api;
    const early = await profile("sender");
    await requestDeletion(early, 5);
    await expect(support.accountDeletions.finalize({ phone: early })).rejects.toThrow(/délai de rétractation/);
    await expect(support.accountDeletions.cancel({ phone: early, reason: "L'utilisateur a changé d'avis" })).resolves.toEqual({ phone: early });
    expect((await db.getTikisseProfileByPhone(early))?.deletionRequestedAt).toBeNull();

    const sender = await profile("sender");
    const handle = (await db.getDb())!;
    await handle.insert(schema.tikisseDeliveries).values({ id: randomUUID(), senderPhone: sender, pickupPlaceId: 1, dropoffPlaceId: 2, title: "Plis lot D", details: "", deliveryType: "Plis", distanceKm: "2.00", estimatedPrice: 2000, vehicleTypes: "Moto", status: "open" });
    await requestDeletion(sender);
    await expect(support.accountDeletions.finalize({ phone: sender })).rejects.toThrow(/1 livraison\(s\) en cours/);
  });

  it("la tâche planifiée supprime les comptes prêts, laisse les bloqués, efface les fichiers et purge à 10 ans", async () => {
    const ready = await profile("driver");
    const blocked = await profile("driver");
    await fund(blocked, 500);
    await requestDeletion(ready);
    await requestDeletion(blocked);
    const result = await deletions.runAccountDeletionJobs();
    expect(result.finalized).toBeGreaterThanOrEqual(1);
    expect(result.blocked).toBeGreaterThanOrEqual(1);
    expect(await db.getTikisseProfileByPhone(ready)).toBeUndefined();
    expect((await db.getTikisseProfileByPhone(blocked))?.deletedAt).toBeNull();

    const erased: string[] = [];
    await deletions.processStorageErasures(500, async (key) => { erased.push(key); });
    expect(erased).toContain(`tikisse-profiles/${ready}/photo.jpg`);
    const handle = (await db.getDb())!;
    const row = (await handle.select().from(schema.tikisseStorageErasures).where(orm.eq(schema.tikisseStorageErasures.storageKey, `tikisse-profiles/${ready}/photo.jpg`)))[0];
    expect(row?.erasedAt).toBeTruthy();

    const [mapping] = await deletions.findDeletedAccount(ready);
    await deletions.purgeExpiredDeletedAccounts(new Date(new Date(mapping!.purgeAfter).getTime() + 1000));
    expect(await deletions.findDeletedAccount(ready)).toEqual([]);
  });

  it("un échec d'effacement est retenté au passage suivant", async () => {
    const handle = (await db.getDb())!;
    const storageKey = `tikisse-kyc/test-${randomUUID()}/recto.jpg`;
    await handle.insert(schema.tikisseStorageErasures).values({ id: randomUUID(), storageKey, reason: "account_deletion" });
    await deletions.processStorageErasures(500, async (key) => { if (key === storageKey) throw new Error("Stockage indisponible"); });
    let row = (await handle.select().from(schema.tikisseStorageErasures).where(orm.eq(schema.tikisseStorageErasures.storageKey, storageKey)))[0];
    expect(row).toMatchObject({ attempts: 1, lastError: "Stockage indisponible", erasedAt: null });
    await deletions.processStorageErasures(500, async () => {});
    row = (await handle.select().from(schema.tikisseStorageErasures).where(orm.eq(schema.tikisseStorageErasures.storageKey, storageKey)))[0];
    expect(row?.erasedAt).toBeTruthy();
  });
});
