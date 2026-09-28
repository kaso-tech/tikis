/**
 * Lot B — gouvernance de la console, exécuté contre une vraie base MySQL/MariaDB, par le vrai routeur.
 *
 *   DATABASE_URL=<url> npx drizzle-kit push --force
 *   TIKISSE_TEST_DATABASE_URL=<url> npx vitest run tests/admin-governance.db.test.ts
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

const newPhone = () => `+22673${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
const PASSWORD = "mot-de-passe-lot-b";

async function newAdmin(role: Role, password = PASSWORD) {
  const email = `lot-b-${randomUUID()}@tikisse.test`;
  return (await adminDb.createAdminUser({ email, passwordHash: await adminAuth.hashAdminPassword(password), fullName: "Lot B", role }))!;
}

/** Appelle le vrai routeur admin, avec la session donnée ; capture le cookie posé à la connexion. */
async function caller(token?: string) {
  const { tikisseAdminRouter } = await import("../server/admin-router");
  const { createContext } = await import("../server/_core/context");
  const cookies: string[] = [];
  const headers: Record<string, string> = { "x-tikisse-admin": "1" };
  if (token) headers.cookie = `tikisse_admin_session=${token}`;
  const req = { headers, ip: `198.51.100.${Math.floor(Math.random() * 250)}`, secure: true, socket: {} } as never;
  const res = { cookie: (_name: string, value: string) => { cookies.push(value); }, clearCookie: () => {} } as never;
  return { api: tikisseAdminRouter.createCaller(await createContext({ req, res, info: {} as never })), cookies };
}

async function session(role: Role) {
  const admin = await newAdmin(role);
  const { token } = await adminDb.createAdminSession({ adminId: admin.id });
  return { admin, token, api: (await caller(token)).api };
}

async function wallet(phone: string) {
  return (await db.getTikisseWalletSnapshot(phone)).total;
}

async function fund(phone: string, amount: number) {
  const handle = (await db.getDb())!;
  await handle.transaction(async (tx) => {
    await db.applyWalletMovement(tx, { profilePhone: phone, operation: "credit", amount, availableDelta: amount, heldDelta: 0, reason: "Solde (test)", idempotencyKey: `${phone}:fund:${randomUUID()}` });
  });
}

describe.skipIf(!TEST_DB)("rôles restreints", () => {
  it("lecture seule : consulte, ne modifie rien, sauf son propre compte", async () => {
    const { api } = await session("viewer");
    await expect(api.dashboard.metrics({ periodDays: 7 })).resolves.toBeTruthy();
    await expect(api.maintenance.set({ enabled: false })).rejects.toThrow(/rôle/);
    await expect(api.reports.resolve({ reportId: "x", status: "reviewing" })).rejects.toThrow(/rôle/);
    await expect(api.auth.sessions.list()).resolves.toHaveLength(1);
  });

  it("KYC seul : les vérifications d'identité, rien d'autre", async () => {
    const { api } = await session("kyc_reviewer");
    const { id } = await db.createKycSubmission({ driverPhone: newPhone(), idFrontKey: "tikisse-kyc/x/f.jpg", idBackKey: "tikisse-kyc/x/b.jpg", selfieKey: "tikisse-kyc/x/s.jpg" });
    await expect(api.kyc.list({ status: "submitted" })).resolves.toBeTruthy();
    await expect(api.kyc.review({ submissionId: id, decision: "approved" })).resolves.toMatchObject({ status: "approved" });
    await expect(api.dashboard.metrics({ periodDays: 7 })).rejects.toThrow(/rôle/);
    await expect(api.users.search({})).rejects.toThrow(/rôle/);
  });

  it("KYC seul : voit les pièces d'identité, pas les photos de signalement", async () => {
    const documents = await import("../server/admin-documents");
    const { token } = await session("kyc_reviewer");
    const { id } = await db.createKycSubmission({ driverPhone: newPhone(), idFrontKey: "tikisse-kyc/x/f.jpg", idBackKey: "tikisse-kyc/x/b.jpg", selfieKey: "tikisse-kyc/x/s.jpg" });
    const read = async () => ({ body: Buffer.from([1]), contentType: "image/jpeg" });
    expect(await documents.resolveAdminDocument({ sessionToken: token, request: { kind: "kyc", submissionId: id, side: "selfie" } }, read)).toMatchObject({ status: 200 });
    expect(await documents.resolveAdminDocument({ sessionToken: token, request: { kind: "report", reportId: randomUUID() } }, read)).toMatchObject({ status: 403 });
  });
});

describe.skipIf(!TEST_DB)("comptes admin gérés depuis la console", () => {
  it("un compte créé reçoit un mot de passe provisoire, qu'il doit changer avant tout accès", async () => {
    const { api } = await session("super_admin");
    const email = `lot-b-new-${randomUUID()}@tikisse.test`;
    const created = await api.admins.create({ email, fullName: "Nouvel admin", role: "support" });
    expect(created.temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);

    const login = await caller();
    await login.api.auth.login({ email, password: created.temporaryPassword });
    const fresh = await caller(login.cookies[0]);
    expect(await fresh.api.auth.me()).toMatchObject({ mustChangePassword: true });
    await expect(fresh.api.dashboard.metrics({ periodDays: 7 })).rejects.toThrow(/mot de passe/);
    await expect(fresh.api.auth.changePassword({ currentPassword: "faux", newPassword: "un-nouveau-mot-de-passe" })).rejects.toThrow(/actuel incorrect/);
    await expect(fresh.api.auth.changePassword({ currentPassword: created.temporaryPassword, newPassword: "court" })).rejects.toThrow(/12 caractères/);
    await fresh.api.auth.changePassword({ currentPassword: created.temporaryPassword, newPassword: "un-nouveau-mot-de-passe" });
    // Requête suivante : la session relit le compte, le mot de passe provisoire n'y est plus.
    await expect((await caller(login.cookies[0])).api.dashboard.metrics({ periodDays: 7 })).resolves.toBeTruthy();
  });

  it("le mot de passe provisoire n'est pas recopié dans le journal", async () => {
    const { api, admin } = await session("super_admin");
    const created = await api.admins.create({ email: `lot-b-log-${randomUUID()}@tikisse.test`, fullName: "Journal", role: "viewer" });
    const log = await adminDb.listAdminAuditLog({ adminEmail: admin.email, includeRequests: true, limit: 50 });
    expect(JSON.stringify(log.rows)).not.toContain(created.temporaryPassword);
  });

  it("réinitialiser le mot de passe coupe les sessions et impose un changement", async () => {
    const boss = await session("super_admin");
    const target = await newAdmin("finance");
    const { token } = await adminDb.createAdminSession({ adminId: target.id });
    const { temporaryPassword } = await boss.api.admins.resetPassword({ adminId: target.id });
    expect(await adminDb.authenticateAdminSession(token)).toBeNull();
    const login = await caller();
    await expect(login.api.auth.login({ email: target.email, password: PASSWORD })).rejects.toThrow(/Identifiants invalides/);
    await login.api.auth.login({ email: target.email, password: temporaryPassword });
    expect(await (await caller(login.cookies[0])).api.auth.me()).toMatchObject({ mustChangePassword: true });
    await expect(boss.api.admins.resetPassword({ adminId: boss.admin.id })).rejects.toThrow(/Mon compte/);
  });

  it("changer de rôle : jamais le sien, jamais le dernier super-admin", async () => {
    const handle = (await db.getDb())!;
    await handle.update(schema.tikisseAdminUsers).set({ active: false }).where(orm.eq(schema.tikisseAdminUsers.role, "super_admin"));
    const boss = await session("super_admin");
    await expect(boss.api.admins.changeRole({ adminId: boss.admin.id, role: "viewer" })).rejects.toThrow(/propre rôle/);
    const other = await session("super_admin");
    // Deux super-admins actifs : l'un peut rétrograder l'autre, mais plus le dernier.
    await expect(boss.api.admins.changeRole({ adminId: other.admin.id, role: "finance" })).resolves.toEqual({ before: "super_admin", after: "finance" });
    const lastOne = await newAdmin("super_admin");
    await handle.update(schema.tikisseAdminUsers).set({ active: false }).where(orm.eq(schema.tikisseAdminUsers.id, boss.admin.id));
    const reviewer = await session("super_admin");
    await handle.update(schema.tikisseAdminUsers).set({ active: false }).where(orm.eq(schema.tikisseAdminUsers.id, reviewer.admin.id));
    // `reviewer` est suspendu : sa session ne vaut plus. On vérifie la règle directement.
    const accounts = await import("../server/admin-accounts");
    await expect(accounts.changeAdminRole({ actorAdminId: reviewer.admin.id, adminId: lastOne.id, role: "support" })).rejects.toThrow(/dernier super-admin/);
  });
});

describe.skipIf(!TEST_DB)("sessions et codes de secours", () => {
  it("on voit ses sessions, on ferme les autres ; jamais celles d'un autre compte", async () => {
    const me = await session("support");
    const other = await adminDb.createAdminSession({ adminId: me.admin.id });
    const list = await me.api.auth.sessions.list();
    expect(list).toHaveLength(2);
    expect(list.filter((row) => row.current)).toHaveLength(1);
    const otherId = list.find((row) => !row.current)!.id;
    await me.api.auth.sessions.revoke({ sessionId: otherId });
    expect(await adminDb.authenticateAdminSession(other.token)).toBeNull();
    const stranger = await session("support");
    const strangerSessionId = (await stranger.api.auth.sessions.list())[0]!.id;
    await expect(me.api.auth.sessions.revoke({ sessionId: strangerSessionId })).rejects.toThrow(/introuvable/);
  });

  it("changer son mot de passe ferme les autres sessions et garde la sienne", async () => {
    const me = await session("support");
    const other = await adminDb.createAdminSession({ adminId: me.admin.id });
    await me.api.auth.changePassword({ currentPassword: PASSWORD, newPassword: "encore-un-autre-mot-de-passe" });
    expect(await adminDb.authenticateAdminSession(other.token)).toBeNull();
    expect(await adminDb.authenticateAdminSession(me.token)).toMatchObject({ adminId: me.admin.id });
  });

  it("régénérer les codes de secours : les anciens cessent de fonctionner", async () => {
    const totp = await import("../server/admin-totp");
    const me = await session("support");
    const { secret } = await me.api.auth.totp.begin();
    const { recoveryCodes: oldCodes } = await me.api.auth.totp.confirm({ code: totp.totpCode(secret) });
    await expect(me.api.auth.totp.regenerateRecoveryCodes({ code: "000000" })).rejects.toThrow(/Code invalide/);
    const { recoveryCodes } = await me.api.auth.totp.regenerateRecoveryCodes({ code: oldCodes[0]! });
    expect(recoveryCodes).toHaveLength(10);
    await expect(me.api.auth.totp.regenerateRecoveryCodes({ code: oldCodes[1]! })).rejects.toThrow(/Code invalide/);
    await expect(me.api.auth.totp.regenerateRecoveryCodes({ code: recoveryCodes[0]! })).resolves.toBeTruthy();
  });
});

describe.skipIf(!TEST_DB)("double validation au-delà du seuil", () => {
  it("sous le seuil, le bonus est immédiat", async () => {
    const { api } = await session("finance");
    const phone = newPhone();
    await api.finance.sendBonus({ phone, amount: 99_999, reason: "Geste", requestId: randomUUID() });
    expect(await wallet(phone)).toBe(99_999);
  });

  it("au seuil, le bonus attend un second admin ; le demandeur ne peut pas le valider lui-même", async () => {
    const requester = await session("finance");
    const approver = await session("super_admin");
    const phone = newPhone();
    const result = await requester.api.finance.sendBonus({ phone, amount: 100_000, reason: "Gros geste", requestId: randomUUID() });
    expect(result).toMatchObject({ approvalRequired: true });
    expect(await wallet(phone)).toBe(0);
    const approvalId = (result as { approvalId: string }).approvalId;
    await expect(requester.api.approvals.approve({ approvalId })).rejects.toThrow(/propre demande/);
    await expect(approver.api.approvals.approve({ approvalId })).resolves.toEqual({ status: "executed", failureReason: null });
    expect(await wallet(phone)).toBe(100_000);
    await expect(approver.api.approvals.approve({ approvalId })).rejects.toThrow(/déjà été traitée/);
    expect(await wallet(phone)).toBe(100_000);
  });

  it("deux validations simultanées n'exécutent qu'une fois", async () => {
    const requester = await session("finance");
    const first = await session("finance");
    const second = await session("super_admin");
    const phone = newPhone();
    const { approvalId } = await requester.api.users.reward({ phone, amount: 150_000, reason: "Simultané", requestId: randomUUID() }) as { approvalId: string };
    const outcomes = await Promise.allSettled([first.api.approvals.approve({ approvalId }), second.api.approvals.approve({ approvalId })]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await wallet(phone)).toBe(150_000);
  });

  it("une pénalité refusée par un autre admin n'est pas appliquée ; le demandeur peut retirer la sienne", async () => {
    const requester = await session("finance");
    const other = await session("finance");
    const phone = newPhone();
    await fund(phone, 300_000);
    const refused = await requester.api.users.penalize({ phone, amount: 200_000, reason: "Fraude supposée", requestId: randomUUID() }) as { approvalId: string };
    await expect(other.api.approvals.close({ approvalId: refused.approvalId, note: "Pas de preuve" })).resolves.toEqual({ status: "rejected" });
    const withdrawn = await requester.api.users.penalize({ phone, amount: 200_000, reason: "Erreur", requestId: randomUUID() }) as { approvalId: string };
    await expect(requester.api.approvals.close({ approvalId: withdrawn.approvalId })).resolves.toEqual({ status: "cancelled" });
    expect(await wallet(phone)).toBe(300_000);
  });

  it("retrait au-delà du seuil : une seule demande par retrait, exécutée avec sa référence de versement", async () => {
    const requester = await session("finance");
    const approver = await session("super_admin");
    const phone = newPhone();
    await fund(phone, 500_000);
    const handle = (await db.getDb())!;
    const paymentId = randomUUID();
    await handle.insert(schema.tikissePaymentTransactions).values({ id: paymentId, profilePhone: phone, type: "withdrawal", provider: "yengapay_test", amount: 250_000, status: "pending", providerReference: `wd_lot_b_${paymentId}`, checkoutUrl: null, idempotencyKey: `lot-b:${paymentId}` });
    const payoutReference = `OM-LOTB-${paymentId.slice(0, 8)}`;
    const request = await requester.api.finance.settleTransaction({ paymentId, outcome: "succeeded", payoutReference, notes: "Versé par Orange Money" }) as { approvalId: string };
    expect(request).toMatchObject({ approvalRequired: true });
    await expect(approver.api.finance.settleTransaction({ paymentId, outcome: "succeeded", payoutReference, notes: "Encore" })).rejects.toThrow(/déjà en attente/);
    expect(await wallet(phone)).toBe(500_000);
    await approver.api.approvals.approve({ approvalId: request.approvalId });
    expect(await wallet(phone)).toBe(250_000);
    const payment = await adminDb.adminGetPaymentTransaction(paymentId);
    expect(payment).toMatchObject({ status: "succeeded", payoutReference, settledByAdminId: approver.admin.id });
  });

  it("si l'exécution échoue à la validation, rien ne bouge et la raison est gardée", async () => {
    const requester = await session("finance");
    const approver = await session("finance");
    const phone = newPhone();
    await fund(phone, 120_000);
    const { approvalId } = await requester.api.users.penalize({ phone, amount: 110_000, reason: "Pénalité", requestId: randomUUID() }) as { approvalId: string };
    // Entre la demande et la validation, le solde a fondu.
    await requester.api.users.penalize({ phone, amount: 50_000, reason: "Autre pénalité", requestId: randomUUID() });
    const result = await approver.api.approvals.approve({ approvalId });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toMatch(/insuffisant/);
    expect(await wallet(phone)).toBe(70_000);
  });

  it("le seuil se règle par un super-admin seulement", async () => {
    const finance = await session("finance");
    const boss = await session("super_admin");
    await expect(finance.api.approvals.threshold.set({ threshold: 50_000 })).rejects.toThrow(/rôle/);
    await boss.api.approvals.threshold.set({ threshold: 250_000 });
    expect(await approvals.getApprovalThreshold()).toBe(250_000);
    await approvals.setApprovalThreshold(100_000);
  });
});

describe.skipIf(!TEST_DB)("journal d'audit filtrable et exportable", () => {
  it("filtre par admin, par action (préfixe) et par période ; l'export est tracé", async () => {
    const { api, admin } = await session("super_admin");
    await api.maintenance.set({ enabled: false });
    await api.approvals.threshold.set({ threshold: 100_000 });
    const byAdmin = await api.auditLog.list({ adminEmail: admin.email });
    expect(byAdmin.rows.every((row) => row.adminEmail === admin.email)).toBe(true);
    expect(byAdmin.total).toBe(2);
    const byAction = await api.auditLog.list({ adminEmail: admin.email, action: "maintenance" });
    expect(byAction.rows.map((row) => row.action)).toEqual(["maintenance_mode_changed"]);
    const future = await api.auditLog.list({ adminEmail: admin.email, from: new Date(Date.now() + 86_400_000).toISOString() });
    expect(future.total).toBe(0);
    const exported = await api.auditLog.export({ adminEmail: admin.email });
    expect(exported.rows).toHaveLength(2);
    expect((await api.auditLog.list({ adminEmail: admin.email, action: "audit_log_exported" })).total).toBe(1);
  });
});
