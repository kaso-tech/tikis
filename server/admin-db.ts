import { randomUUID } from "crypto";
import { and, count, desc, eq, gte, inArray, isNull, like, lte, or, sql } from "drizzle-orm";
import { countryDraftIssue, countryPlanWarning } from "../shared/iso-countries";
import { ADMIN_SESSION_TTL_SECONDS, hashAdminSessionToken, newAdminSessionToken, type AdminRole } from "./admin-auth";
import { getDb } from "./db";
import * as db from "./db";
import {
  tikisAdminAuditLog,
  tikisAdminSessions,
  tikisAdminUsers,
  tikisDeliveries,
  tikisDeliveryCandidates,
  tikisDeliveryEvents,
  tikisDeliveryLiveLocations,
  tikisDeliveryReports,
  tikisKycSubmissions,
  tikisLoyaltyGrants,
  tikisLoyaltyPrograms,
  tikisPaymentTransactions,
  tikisPlatformSettings,
  tikisProfiles,
  tikisRateLimits,
  tikisReferrals,
  tikisSupportedCountries,
  tikisWalletLedger,
  tikisWallets,
  type TikisAdminUser,
  type TikisDelivery,
} from "../drizzle/schema";

// ————————————————————————————————————————————————————————————————————————
// Comptes admin
// ————————————————————————————————————————————————————————————————————————

export async function getAdminByEmail(email: string): Promise<TikisAdminUser | undefined> {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  const rows = await db.select().from(tikisAdminUsers).where(eq(tikisAdminUsers.email, email.trim().toLowerCase())).limit(1);
  return rows[0];
}

export async function touchAdminLastLogin(adminId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(tikisAdminUsers).set({ lastLoginAt: new Date() }).where(eq(tikisAdminUsers.id, adminId));
}

/** Réservé au bootstrap (script one-off ou premier compte) — jamais exposé sur une route publique. */
export async function createAdminUser(input: { email: string; passwordHash: string; fullName: string; role: "super_admin" | "support" | "finance" }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  await db.insert(tikisAdminUsers).values({ email: input.email.trim().toLowerCase(), passwordHash: input.passwordHash, fullName: input.fullName, role: input.role });
  return getAdminByEmail(input.email);
}

export async function listAdminUsers() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: tikisAdminUsers.id, email: tikisAdminUsers.email, fullName: tikisAdminUsers.fullName, role: tikisAdminUsers.role, active: tikisAdminUsers.active, lastLoginAt: tikisAdminUsers.lastLoginAt, createdAt: tikisAdminUsers.createdAt }).from(tikisAdminUsers).orderBy(desc(tikisAdminUsers.createdAt));
  return rows;
}

/**
 * Suspendre ou réactiver un compte admin. Deux verrous empêchent de perdre la main sur la console :
 * personne ne se suspend soi-même, et le dernier super-admin actif ne peut pas être suspendu — sans
 * lui, plus personne ne pourrait réactiver un compte ni gérer l'équipe autrement qu'en base.
 */
export async function setAdminUserActive(input: { actorAdminId: number; adminId: number; active: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  await db.transaction(async (tx) => {
    const target = (await tx.select().from(tikisAdminUsers).where(eq(tikisAdminUsers.id, input.adminId)).limit(1).for("update"))[0];
    if (!target) throw new Error("Compte admin introuvable.");
    if (!input.active) {
      if (input.actorAdminId === input.adminId) throw new Error("Vous ne pouvez pas suspendre votre propre compte vous-même.");
      if (target.role === "super_admin" && target.active) {
        const others = await tx.select({ id: tikisAdminUsers.id }).from(tikisAdminUsers).where(and(eq(tikisAdminUsers.role, "super_admin"), eq(tikisAdminUsers.active, true))).for("update");
        if (others.filter((row) => row.id !== target.id).length === 0) throw new Error("Impossible de suspendre le dernier super-admin actif.");
      }
    }
    await tx.update(tikisAdminUsers).set({ active: input.active }).where(eq(tikisAdminUsers.id, input.adminId));
    // Le compte inactif suffit déjà à refuser ses sessions ; les révoquer en plus garantit qu'une
    // réactivation ultérieure ne ressuscite pas une session ouverte avant la suspension.
    if (!input.active) await revokeAllAdminSessions(input.adminId, tx);
  });
}

/** Ouvre une session : le jeton part dans le cookie, la base n'en garde que l'empreinte. */
export async function createAdminSession(input: { adminId: number; ipAddress?: string; userAgent?: string }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  const token = newAdminSessionToken();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000);
  await db.insert(tikisAdminSessions).values({
    id: randomUUID(), adminId: input.adminId, tokenHash: hashAdminSessionToken(token),
    ipAddress: input.ipAddress?.slice(0, 64) ?? null, userAgent: input.userAgent?.slice(0, 255) ?? null, expiresAt,
  });
  return { token, expiresAt };
}

const LAST_SEEN_REFRESH_MS = 5 * 60_000;

/**
 * Identité admin effective d'une requête. La session doit exister, ne pas être révoquée ni expirée, et le
 * compte doit être actif ; le rôle appliqué est celui du compte à cet instant. Sans base, aucune session
 * n'est acceptée — rien n'y fonctionnerait de toute façon.
 */
export async function authenticateAdminSession(token: string | undefined): Promise<{ adminId: number; email: string; role: AdminRole } | null> {
  if (!token || token.length > 200) return null;
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select({
    sessionId: tikisAdminSessions.id, expiresAt: tikisAdminSessions.expiresAt, revokedAt: tikisAdminSessions.revokedAt, lastSeenAt: tikisAdminSessions.lastSeenAt,
    id: tikisAdminUsers.id, email: tikisAdminUsers.email, role: tikisAdminUsers.role, active: tikisAdminUsers.active,
  }).from(tikisAdminSessions).innerJoin(tikisAdminUsers, eq(tikisAdminSessions.adminId, tikisAdminUsers.id))
    .where(eq(tikisAdminSessions.tokenHash, hashAdminSessionToken(token))).limit(1))[0];
  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now() || !row.active) return null;
  if (Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    void db.update(tikisAdminSessions).set({ lastSeenAt: new Date() }).where(eq(tikisAdminSessions.id, row.sessionId)).catch(() => {});
  }
  return { adminId: row.id, email: row.email, role: row.role };
}

/** Déconnexion : la session ne vaut plus rien, même si quelqu'un a copié le cookie. */
export async function revokeAdminSession(token: string | undefined) {
  if (!token) return;
  const db = await getDb();
  if (!db) return;
  await db.update(tikisAdminSessions).set({ revokedAt: new Date() }).where(and(eq(tikisAdminSessions.tokenHash, hashAdminSessionToken(token)), isNull(tikisAdminSessions.revokedAt)));
}

export async function revokeAllAdminSessions(adminId: number, tx?: any) {
  const handle = tx ?? await getDb();
  if (!handle) return;
  await handle.update(tikisAdminSessions).set({ revokedAt: new Date() }).where(and(eq(tikisAdminSessions.adminId, adminId), isNull(tikisAdminSessions.revokedAt)));
}

// ————————————————————————————————————————————————————————————————————————
// Limiteur de connexion admin, partagé entre instances (tikis_rate_limits)
// ————————————————————————————————————————————————————————————————————————

/**
 * Échecs de connexion tolérés par fenêtre de 15 minutes. Trois compteurs, parce qu'un seul ne suffit pas :
 *  - email + IP : l'essai de mots de passe classique, bloqué vite ;
 *  - email seul : le même compte attaqué depuis de nombreuses IP (l'ancien limiteur, clé IP + email, se
 *    contournait en changeant d'IP) ;
 *  - IP seule : une même machine qui essaie de nombreux emails.
 * Stocké en base et non plus dans la mémoire du processus : un redémarrage ne remet plus les compteurs à
 * zéro, et plusieurs instances partagent les mêmes.
 */
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60_000;
export const ADMIN_LOGIN_LIMITS = { emailIp: 5, email: 20, ip: 30 } as const;

function adminLoginKeys(email: string, ip: string, now = Date.now()) {
  const bucket = Math.floor(now / ADMIN_LOGIN_WINDOW_MS);
  const normalizedEmail = email.trim().toLowerCase();
  return {
    emailIp: `admin-login:email-ip:${normalizedEmail}:${ip}:${bucket}`.slice(0, 191),
    email: `admin-login:email:${normalizedEmail}:${bucket}`.slice(0, 191),
    ip: `admin-login:ip:${ip}:${bucket}`.slice(0, 191),
  };
}

export async function assertAdminLoginAllowed(email: string, ip: string) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  const keys = adminLoginKeys(email, ip);
  const rows = await db.select().from(tikisRateLimits).where(inArray(tikisRateLimits.rateLimitKey, Object.values(keys)));
  const failures = (key: string) => rows.find((row) => row.rateLimitKey === key)?.count ?? 0;
  if (failures(keys.emailIp) >= ADMIN_LOGIN_LIMITS.emailIp || failures(keys.email) >= ADMIN_LOGIN_LIMITS.email || failures(keys.ip) >= ADMIN_LOGIN_LIMITS.ip) {
    throw new Error("Trop de tentatives de connexion. Réessayez dans quelques minutes.");
  }
}

export async function recordAdminLoginFailure(email: string, ip: string) {
  const db = await getDb();
  if (!db) return;
  for (const rateLimitKey of Object.values(adminLoginKeys(email, ip))) {
    await db.insert(tikisRateLimits).values({ rateLimitKey, count: 1 }).onDuplicateKeyUpdate({ set: { count: sql`${tikisRateLimits.count} + 1` } });
  }
}

/** Une connexion réussie efface les échecs de ce couple email + IP, pas les compteurs globaux. */
export async function recordAdminLoginSuccess(email: string, ip: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(tikisRateLimits).where(eq(tikisRateLimits.rateLimitKey, adminLoginKeys(email, ip).emailIp));
}

// ————————————————————————————————————————————————————————————————————————
// Journal d'audit (append-only : jamais d'update/delete depuis l'application)
// ————————————————————————————————————————————————————————————————————————

export async function writeAdminAuditLog(entry: { adminId: number; adminEmail: string; action: string; targetType: string; targetId: string; details?: unknown; ipAddress?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(tikisAdminAuditLog).values({
    id: randomUUID(),
    adminId: entry.adminId,
    adminEmail: entry.adminEmail,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    details: entry.details !== undefined ? JSON.stringify(entry.details) : null,
    ipAddress: entry.ipAddress ?? null,
  });
}

export async function listAdminAuditLog(input: { targetType?: string; targetId?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return { rows: [] as Array<{ id: string; adminEmail: string; action: string; targetType: string; targetId: string; details: string | null; createdAt: Date }>, total: 0 };
  const limit = Math.min(input.limit ?? 50, 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const conditions = [
    input.targetType ? eq(tikisAdminAuditLog.targetType, input.targetType) : undefined,
    input.targetId ? eq(tikisAdminAuditLog.targetId, input.targetId) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, totalResult] = await Promise.all([
    db.select().from(tikisAdminAuditLog).where(where).orderBy(desc(tikisAdminAuditLog.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(tikisAdminAuditLog).where(where),
  ]);
  return { rows, total: Number(totalResult[0]?.count ?? 0) };
}

// ————————————————————————————————————————————————————————————————————————
// Configuration de la commission (CAS §3.1 : configurable depuis l'administration)
// ————————————————————————————————————————————————————————————————————————

export async function adminUpdateCommissionRate(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) throw new Error("Le taux de commission doit être strictement compris entre 0 et 1 (ex. 0.10 pour 10 %).");
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  await db.insert(tikisPlatformSettings).values({ id: 1, commissionRate: rate.toFixed(5) }).onDuplicateKeyUpdate({ set: { commissionRate: rate.toFixed(5) } });
  return { rate };
}

// ————————————————————————————————————————————————————————————————————————
// Signalements (CAS N°9)
// ————————————————————————————————————————————————————————————————————————

export async function createDeliveryReport(input: { deliveryId: string; reporterPhone: string; reporterRole: "sender" | "driver"; reason: string; description: string; attachmentKey?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Les signalements sont temporairement indisponibles.");
  const id = randomUUID();
  await db.insert(tikisDeliveryReports).values({ id, deliveryId: input.deliveryId, reporterPhone: input.reporterPhone, reporterRole: input.reporterRole, reason: input.reason, description: input.description, attachmentKey: input.attachmentKey ?? null });
  await db.insert(tikisDeliveryEvents).values({
    id: randomUUID(), deliveryId: input.deliveryId, eventType: "delivery_reported", status: null, actorPhone: input.reporterPhone,
    recipientPhone: input.reporterPhone, title: "Signalement envoyé", body: "Votre signalement a été transmis à l’administration Tikis.", tone: "info",
    idempotencyKey: `${id}:report-ack`,
  });
  return { id };
}

export async function listDeliveryReports(input: { status?: "open" | "reviewing" | "resolved" | "dismissed"; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const base = db.select({
    report: tikisDeliveryReports,
    delivery: { id: tikisDeliveries.id, title: tikisDeliveries.title, status: tikisDeliveries.status, senderPhone: tikisDeliveries.senderPhone, driverPhone: tikisDeliveries.driverPhone },
  }).from(tikisDeliveryReports).innerJoin(tikisDeliveries, eq(tikisDeliveryReports.deliveryId, tikisDeliveries.id));
  const filtered = input.status ? base.where(eq(tikisDeliveryReports.status, input.status)) : base;
  return filtered.orderBy(desc(tikisDeliveryReports.createdAt)).limit(Math.min(input.limit ?? 100, 500));
}

export async function getDeliveryReportById(reportId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(tikisDeliveryReports).where(eq(tikisDeliveryReports.id, reportId)).limit(1);
  return rows[0];
}

export async function resolveDeliveryReport(input: { reportId: string; status: "reviewing" | "resolved" | "dismissed"; resolutionNotes?: string; adminId: number }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  await db.update(tikisDeliveryReports).set({
    status: input.status,
    resolutionNotes: input.resolutionNotes ?? null,
    ...(input.status === "resolved" || input.status === "dismissed" ? { resolvedAt: new Date(), resolvedByAdminId: input.adminId } : {}),
  }).where(eq(tikisDeliveryReports.id, input.reportId));
  return getDeliveryReportById(input.reportId);
}

// ————————————————————————————————————————————————————————————————————————
// Console de litiges (CAS N°10) : chronologie complète d'une livraison
// ————————————————————————————————————————————————————————————————————————

export async function adminSearchDeliveries(input: { query?: string; status?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    input.query ? or(eq(tikisDeliveries.id, input.query), like(tikisDeliveries.senderPhone, `${input.query}%`), like(tikisDeliveries.driverPhone, `${input.query}%`), like(tikisDeliveries.title, `${input.query}%`)) : undefined,
    input.status ? eq(tikisDeliveries.status, input.status as TikisDelivery["status"]) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  return db.select().from(tikisDeliveries).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(tikisDeliveries.createdAt)).limit(Math.min(input.limit ?? 50, 200));
}

/** Chronologie complète d'une livraison pour instruction d'un litige : statut, candidatures,
 *  mouvements financiers de chaque partie prenante, événements/notifications, signalements. */
export async function adminGetDeliveryTimeline(deliveryId: string) {
  const db = await getDb();
  if (!db) return null;
  const delivery = (await db.select().from(tikisDeliveries).where(eq(tikisDeliveries.id, deliveryId)).limit(1))[0];
  if (!delivery) return null;
  const candidates = await db.select().from(tikisDeliveryCandidates).where(eq(tikisDeliveryCandidates.deliveryId, deliveryId)).orderBy(desc(tikisDeliveryCandidates.createdAt));
  const events = await db.select().from(tikisDeliveryEvents).where(eq(tikisDeliveryEvents.deliveryId, deliveryId)).orderBy(tikisDeliveryEvents.createdAt);
  const ledgerEntries = await db.select().from(tikisWalletLedger).where(eq(tikisWalletLedger.deliveryId, deliveryId)).orderBy(tikisWalletLedger.createdAt);
  const reports = await db.select().from(tikisDeliveryReports).where(eq(tikisDeliveryReports.deliveryId, deliveryId)).orderBy(desc(tikisDeliveryReports.createdAt));
  return { delivery, candidates, events, ledgerEntries, reports };
}

// ————————————————————————————————————————————————————————————————————————
// Utilisateurs et Wallets (support niveau 1, lecture + actions encadrées)
// ————————————————————————————————————————————————————————————————————————

export async function adminSearchProfiles(input: { query?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return { rows: [] as Array<{ phone: string; fullName: string; accountType: "sender" | "driver"; email: string | null; phoneVerified: boolean; emailVerified: boolean; status?: "active" | "suspended" | "banned"; statusReason?: string | null; createdAt: Date }>, total: 0 };
  const limit = Math.min(input.limit ?? 30, 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const query = input.query?.trim();
  const where = query
    ? or(like(tikisProfiles.phone, `${query}%`), like(tikisProfiles.fullName, `${query}%`), like(tikisProfiles.email, `${query}%`))
    : undefined;
  const [rows, totalResult] = await Promise.all([
    db.select().from(tikisProfiles).where(where).orderBy(desc(tikisProfiles.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(tikisProfiles).where(where),
  ]);
  return { rows, total: Number(totalResult[0]?.count ?? 0) };
}

export async function adminGetProfileDetail(phone: string) {
  const db = await getDb();
  if (!db) return null;
  const profile = (await db.select().from(tikisProfiles).where(eq(tikisProfiles.phone, phone)).limit(1))[0];
  if (!profile) return null;
  const wallet = (await db.select().from(tikisWallets).where(eq(tikisWallets.profilePhone, phone)).limit(1))[0] ?? null;
  const ledger = await db.select().from(tikisWalletLedger).where(eq(tikisWalletLedger.profilePhone, phone)).orderBy(desc(tikisWalletLedger.createdAt)).limit(100);
  const deliveriesAsSender = await db.select({ count: count() }).from(tikisDeliveries).where(eq(tikisDeliveries.senderPhone, phone));
  const deliveriesAsDriver = await db.select({ count: count() }).from(tikisDeliveries).where(eq(tikisDeliveries.driverPhone, phone));
  return { profile, wallet, ledger, deliveriesAsSenderCount: Number(deliveriesAsSender[0]?.count ?? 0), deliveriesAsDriverCount: Number(deliveriesAsDriver[0]?.count ?? 0) };
}

// ————————————————————————————————————————————————————————————————————————
// Tableau de bord : indicateurs agrégés
// ————————————————————————————————————————————————————————————————————————

export async function adminDashboardMetrics(sinceDays = 30) {
  const db = await getDb();
  if (!db) return null;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const [deliveriesTotal, deliveriesCompleted, openReports, activeDrivers, commissionRevenue, recentDeliveries] = await Promise.all([
    db.select({ count: count() }).from(tikisDeliveries).where(gte(tikisDeliveries.createdAt, since)),
    db.select({ count: count() }).from(tikisDeliveries).where(and(eq(tikisDeliveries.status, "completed"), gte(tikisDeliveries.createdAt, since))),
    db.select({ count: count() }).from(tikisDeliveryReports).where(eq(tikisDeliveryReports.status, "open")),
    db.select({ count: sql<number>`count(distinct ${tikisDeliveries.driverPhone})` }).from(tikisDeliveries).where(and(gte(tikisDeliveries.createdAt, since), eq(tikisDeliveries.status, "completed"))),
    // "commission_debit" est le seul mouvement qui correspond à un revenu réel de Tikis ; "debit" générique
    // couvre aussi les retraits (argent des utilisateurs qui sort de leur propre Wallet), à ne jamais compter ici.
    db.select({ total: sql<number>`coalesce(sum(${tikisWalletLedger.amount}), 0)` }).from(tikisWalletLedger).where(and(eq(tikisWalletLedger.operation, "commission_debit"), gte(tikisWalletLedger.createdAt, since), lte(tikisWalletLedger.createdAt, new Date()))),
    db.select({ createdAt: tikisDeliveries.createdAt, status: tikisDeliveries.status, vehicleTypes: tikisDeliveries.vehicleTypes }).from(tikisDeliveries).where(gte(tikisDeliveries.createdAt, since)),
  ]);

  // Timeseries par jour
  const byDay = new Map<string, { published: number; completed: number }>();
  for (let i = 0; i < sinceDays; i += 1) {
    const d = new Date(Date.now() - (sinceDays - 1 - i) * 24 * 60 * 60 * 1000);
    byDay.set(d.toISOString().slice(0, 10), { published: 0, completed: 0 });
  }
  for (const d of recentDeliveries) {
    const day = d.createdAt.toISOString().slice(0, 10);
    const slot = byDay.get(day);
    if (slot) {
      slot.published += 1;
      if (d.status === "completed") slot.completed += 1;
    }
  }
  const timeseries = Array.from(byDay.entries()).map(([date, slot]) => ({ date, ...slot }));

  // Vehicle breakdown
  const vehicleCounts = new Map<string, number>();
  for (const d of recentDeliveries) {
    const first = d.vehicleTypes?.split(",")[0]?.trim();
    if (!first) continue;
    vehicleCounts.set(first, (vehicleCounts.get(first) ?? 0) + 1);
  }
  const vehicleBreakdown = Array.from(vehicleCounts.entries())
    .map(([vehicle, count]) => ({ vehicle, count }))
    .sort((a, b) => b.count - a.count);

  return {
    periodDays: sinceDays,
    deliveriesTotal: Number(deliveriesTotal[0]?.count ?? 0),
    deliveriesCompleted: Number(deliveriesCompleted[0]?.count ?? 0),
    openReports: Number(openReports[0]?.count ?? 0),
    activeDrivers: Number(activeDrivers[0]?.count ?? 0),
    commissionRevenue: Number(commissionRevenue[0]?.total ?? 0),
    timeseries,
    vehicleBreakdown,
  };
}

// ————————————————————————————————————————————————————————————————————————
// Gestion complète des utilisateurs : rôle, statut (suspension/bannissement/interdiction)
// ————————————————————————————————————————————————————————————————————————

export type ProfileStatus = "active" | "suspended" | "banned";

export type ProfileEngagement = { deliveryId: string; title: string; status: TikisDelivery["status"]; role: "sender" | "driver" };

/** Courses où ce profil est engagé et qu'une décision d'admin ne peut pas trancher à sa place. */
async function profileEngagements(tx: any, phone: string): Promise<ProfileEngagement[]> {
  const asDriver = await tx.select({ deliveryId: tikisDeliveries.id, title: tikisDeliveries.title, status: tikisDeliveries.status }).from(tikisDeliveries)
    .where(and(eq(tikisDeliveries.driverPhone, phone), inArray(tikisDeliveries.status, ["pending_confirmation", "active"])));
  const asSender = await tx.select({ deliveryId: tikisDeliveries.id, title: tikisDeliveries.title, status: tikisDeliveries.status }).from(tikisDeliveries)
    .where(and(eq(tikisDeliveries.senderPhone, phone), inArray(tikisDeliveries.status, ["open", "pending_confirmation", "active", "disabled"])));
  return [
    ...asDriver.map((row: Omit<ProfileEngagement, "role">) => ({ ...row, role: "driver" as const })),
    ...asSender.map((row: Omit<ProfileEngagement, "role">) => ({ ...row, role: "sender" as const })),
  ];
}

/**
 * Suspendre ou bannir retire aussi les candidatures ouvertes du profil et libère leur commission (voir
 * `withdrawCandidaciesOfSuspendedDriver`), dans la même transaction que le changement de statut. Les courses
 * déjà attribuées ou publiées sont renvoyées dans `engagements` : l'admin décide de les annuler ou non.
 */
export async function adminSetProfileStatus(input: { phone: string; status: ProfileStatus; reason?: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  return dbc.transaction(async (tx) => {
    const profile = (await tx.select().from(tikisProfiles).where(eq(tikisProfiles.phone, input.phone)).limit(1).for("update"))[0];
    if (!profile) throw new Error("Profil introuvable.");
    await tx.update(tikisProfiles).set({
      status: input.status,
      statusReason: input.status === "active" ? null : (input.reason?.trim() || null),
      statusUpdatedAt: new Date(),
      statusUpdatedByAdminId: input.adminId,
    }).where(eq(tikisProfiles.phone, input.phone));
    const releasedCandidacies = input.status === "active" ? 0 : await db.withdrawCandidaciesOfSuspendedDriver(tx, input.phone);
    const engagements = input.status === "active" ? [] : await profileEngagements(tx, input.phone);
    return { phone: input.phone, status: input.status, releasedCandidacies, engagements };
  });
}

/** Le rôle (sender/driver) est normalement immuable côté app ; ce changement est réservé aux super-admins
 *  pour corriger une erreur d'inscription ou une demande explicite de l'utilisateur. */
export async function adminChangeProfileRole(input: { phone: string; role: "sender" | "driver" }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  return dbc.transaction(async (tx) => {
    const profile = (await tx.select().from(tikisProfiles).where(eq(tikisProfiles.phone, input.phone)).limit(1).for("update"))[0];
    if (!profile) throw new Error("Profil introuvable.");
    // Tout ce qui lie encore ce profil à son rôle actuel bloque le changement. Ne regarder que les courses
    // « en cours » laissait passer un livreur avec des candidatures ouvertes : devenu expéditeur, il n'avait
    // plus aucun écran pour les retirer, et leur commission restait réservée pour toujours.
    const candidacies = await tx.select({ count: count() }).from(tikisDeliveryCandidates)
      .where(and(eq(tikisDeliveryCandidates.driverPhone, input.phone), inArray(tikisDeliveryCandidates.status, ["applied", "selected", "confirmed"])));
    if (Number(candidacies[0]?.count ?? 0) > 0) throw new Error("Impossible de changer le rôle : ce livreur a une candidature en cours. Elle doit d’abord être retirée ou la course terminée.");
    const engagements = await profileEngagements(tx, input.phone);
    if (engagements.length > 0) throw new Error(`Impossible de changer le rôle : ce profil a ${engagements.length} course(s) non terminée(s).`);
    const wallet = (await tx.select().from(tikisWallets).where(eq(tikisWallets.profilePhone, input.phone)).limit(1))[0];
    if (wallet && wallet.heldBalance > 0) throw new Error("Impossible de changer le rôle : une partie du Wallet de ce profil est encore bloquée.");
    await tx.update(tikisProfiles).set({ accountType: input.role, vehicles: input.role === "sender" ? "[]" : profile.vehicles }).where(eq(tikisProfiles.phone, input.phone));
    return { phone: input.phone, role: input.role };
  });
}

export async function adminRewardWallet(input: { phone: string; amount: number; reason: string; adminId: number; requestId: string }) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1_000_000) throw new Error("Montant de récompense invalide.");
  // `requestId` est généré une seule fois côté client au moment du clic : un double-clic ou une
  // relance réseau renvoie le même identifiant et ne produit donc jamais un second crédit réel.
  // La clé porte aussi le numéro : `applyWalletMovement` rend le mouvement déjà enregistré sous une clé
  // connue sans regarder à qui il appartenait. Un identifiant réutilisé pour un autre profil (brouillon
  // conservé d'une fiche à l'autre) aurait « réussi » sans rien créditer à ce profil-là.
  return db.adminAdjustWallet({ profilePhone: input.phone, amount: input.amount, direction: "credit", operation: "bonus", reason: input.reason || "Bonus accordé par l’administration", idempotencyKey: `admin-reward:${input.phone}:${input.requestId}` });
}

export async function adminPenalizeWallet(input: { phone: string; amount: number; reason: string; adminId: number; requestId: string }) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1_000_000) throw new Error("Montant de pénalité invalide.");
  return db.adminAdjustWallet({ profilePhone: input.phone, amount: input.amount, direction: "debit", operation: "penalty", reason: input.reason || "Pénalité appliquée par l’administration", idempotencyKey: `admin-penalty:${input.phone}:${input.requestId}` });
}

// ————————————————————————————————————————————————————————————————————————
// Gestion complète des livraisons
// ————————————————————————————————————————————————————————————————————————

export async function adminListDeliveries(input: { query?: string; status?: string; role?: "sender" | "driver"; from?: Date; to?: Date; limit?: number }) {
  const dbc = await getDb();
  if (!dbc) return [];
  const conditions = [
    input.query ? or(eq(tikisDeliveries.id, input.query), like(tikisDeliveries.senderPhone, `%${input.query}%`), like(tikisDeliveries.driverPhone, `%${input.query}%`), like(tikisDeliveries.title, `%${input.query}%`)) : undefined,
    input.status ? eq(tikisDeliveries.status, input.status as TikisDelivery["status"]) : undefined,
    input.from ? gte(tikisDeliveries.createdAt, input.from) : undefined,
    input.to ? lte(tikisDeliveries.createdAt, input.to) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  return dbc.select().from(tikisDeliveries).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(tikisDeliveries.createdAt)).limit(Math.min(input.limit ?? 50, 200));
}

/** Liste les positions GPS encore fraiches des livraisons en cours.
 *  Utilisé par la page admin "Carte temps réel" (projection bounding box SVG). */
export async function adminListLiveLocations(input: { maxAgeSeconds: number }) {
  const dbc = await getDb();
  if (!dbc) return [];
  const minUpdatedAt = new Date(Date.now() - input.maxAgeSeconds * 1000);
  const rows = await dbc
    .select({
      deliveryId: tikisDeliveryLiveLocations.deliveryId,
      driverPhone: tikisDeliveryLiveLocations.driverPhone,
      latitude: tikisDeliveryLiveLocations.latitude,
      longitude: tikisDeliveryLiveLocations.longitude,
      heading: tikisDeliveryLiveLocations.heading,
      recordedAt: tikisDeliveryLiveLocations.recordedAt,
      updatedAt: tikisDeliveryLiveLocations.updatedAt,
    })
    .from(tikisDeliveryLiveLocations)
    .where(gte(tikisDeliveryLiveLocations.updatedAt, minUpdatedAt))
    .orderBy(desc(tikisDeliveryLiveLocations.updatedAt))
    .limit(200);
  return rows.map((row) => ({
    deliveryId: row.deliveryId,
    driverPhone: row.driverPhone,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    heading: Number(row.heading),
    recordedAt: row.recordedAt instanceof Date ? row.recordedAt.toISOString() : String(row.recordedAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }));
}

/** Annulation forcée par l'administration : libère toute commission bloquée/prélevée, quel que soit
 *  le statut (y compris active/pending_confirmation), contrairement à l'annulation Sender classique
 *  qui est bloquée après mise en relation (CAS N°6). Réservé aux litiges tranchés par un admin. */
export async function adminForceCancelDelivery(input: { deliveryId: string; reason: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  return dbc.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisDeliveries).where(eq(tikisDeliveries.id, input.deliveryId)).limit(1).for("update"))[0];
    if (!delivery) throw new Error("Livraison introuvable.");
    if (delivery.status === "completed" || delivery.status === "cancelled" || delivery.status === "expired") throw new Error("Cette livraison est déjà clôturée.");
    // Libère la commission de tout candidat encore engagé (selected/confirmed/applied).
    const candidates = await tx.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.deliveryId, input.deliveryId), or(eq(tikisDeliveryCandidates.status, "applied"), eq(tikisDeliveryCandidates.status, "selected"), eq(tikisDeliveryCandidates.status, "confirmed")))).for("update");
    for (const candidate of candidates) {
      // Deux situations très différentes, à ne jamais confondre (même règle que l'expiration automatique,
      // `expireOpenTikisDeliveries`) :
      //  - commission réellement prélevée (candidat confirmé) : elle a quitté le Wallet, on la rembourse ;
      //  - commission seulement réservée (candidat postulé ou sélectionné) : elle est encore dans le solde
      //    bloqué, on la débloque. La créditer au disponible sans vider la réserve fabriquait de l'argent :
      //    le livreur retrouvait sa commission ET la gardait bloquée, sans aucun parcours pour la libérer.
      // Même transaction que les mises à jour de statut ci-dessous (via `tx`) : si une étape échoue plus
      // loin, ce mouvement fait partie du rollback. Clés déterministes par candidat : une relance ne peut
      // jamais rembourser ni débloquer deux fois.
      const debits = await tx.select().from(tikisWalletLedger).where(and(eq(tikisWalletLedger.deliveryId, input.deliveryId), eq(tikisWalletLedger.profilePhone, candidate.driverPhone), inArray(tikisWalletLedger.operation, ["debit", "commission_debit"]))).for("update");
      const debitedAmount = debits.reduce((total, entry) => total + Number(entry.amount), 0);
      if (debitedAmount > 0) {
        await db.applyWalletMovement(tx, { profilePhone: candidate.driverPhone, deliveryId: input.deliveryId, operation: "compensation", amount: debitedAmount, availableDelta: debitedAmount, heldDelta: 0, reason: `Annulation administrative de la livraison ${input.deliveryId} : commission remboursée`, idempotencyKey: `${input.deliveryId}:admin-force-cancel:${candidate.id}` });
      } else if (candidate.commissionBlocked > 0) {
        await db.applyWalletMovement(tx, { profilePhone: candidate.driverPhone, deliveryId: input.deliveryId, operation: "unblock", amount: candidate.commissionBlocked, availableDelta: candidate.commissionBlocked, heldDelta: -candidate.commissionBlocked, reason: `Annulation administrative de la livraison ${input.deliveryId} : commission libérée`, idempotencyKey: `${input.deliveryId}:admin-force-cancel-unblock:${candidate.id}` });
      }
      await tx.update(tikisDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(tikisDeliveryCandidates.id, candidate.id));
    }
    await tx.update(tikisDeliveries).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(tikisDeliveries.id, input.deliveryId));
    await tx.insert(tikisDeliveryEvents).values({ id: randomUUID(), deliveryId: input.deliveryId, eventType: "admin_cancelled", status: "cancelled", actorPhone: null, recipientPhone: delivery.senderPhone, title: "Livraison annulée par l’administration", body: input.reason || "Cette livraison a été annulée après examen par l’équipe Tikis.", tone: "warning", idempotencyKey: `${input.deliveryId}:admin-cancel` }).onDuplicateKeyUpdate({ set: { idempotencyKey: `${input.deliveryId}:admin-cancel` } });
    if (delivery.driverPhone) {
      await tx.insert(tikisDeliveryEvents).values({ id: randomUUID(), deliveryId: input.deliveryId, eventType: "admin_cancelled", status: "cancelled", actorPhone: null, recipientPhone: delivery.driverPhone, title: "Livraison annulée par l’administration", body: input.reason || "Cette livraison a été annulée après examen par l’équipe Tikis.", tone: "warning", idempotencyKey: `${input.deliveryId}:admin-cancel-driver` }).onDuplicateKeyUpdate({ set: { idempotencyKey: `${input.deliveryId}:admin-cancel-driver` } });
    }
    return { id: input.deliveryId, status: "cancelled" as const };
  });
}

// ————————————————————————————————————————————————————————————————————————
// Parrainage
// ————————————————————————————————————————————————————————————————————————

export async function adminListReferrals(input: { status?: "invited" | "qualified" | "rewarded" | "voided"; limit?: number }) {
  const dbc = await getDb();
  if (!dbc) return [];
  const base = dbc.select().from(tikisReferrals);
  const filtered = input.status ? base.where(eq(tikisReferrals.status, input.status)) : base;
  return filtered.orderBy(desc(tikisReferrals.createdAt)).limit(Math.min(input.limit ?? 100, 500));
}

export async function adminRewardReferral(input: { referralId: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  return dbc.transaction(async (tx) => {
    const referral = (await tx.select().from(tikisReferrals).where(eq(tikisReferrals.id, input.referralId)).limit(1).for("update"))[0];
    if (!referral) throw new Error("Parrainage introuvable.");
    if (referral.status !== "qualified") throw new Error("Ce parrainage n’est pas (ou plus) éligible à une récompense.");
    await tx.update(tikisReferrals).set({ status: "rewarded", rewardedAt: new Date(), rewardedByAdminId: input.adminId }).where(eq(tikisReferrals.id, referral.id));
    // Même transaction que la mise à jour du statut : si le crédit échoue, le parrainage reste "qualified"
    // (rollback complet) plutôt que "rewarded" sans que l'argent n'ait jamais été crédité.
    await db.adminAdjustWallet({ profilePhone: referral.referrerPhone, amount: referral.rewardAmount, direction: "credit", operation: "bonus", reason: `Récompense de parrainage — filleul ${referral.refereePhone}`, idempotencyKey: `${referral.id}:admin-reward` }, tx);
    return { referralId: referral.id, status: "rewarded" as const };
  });
}

export async function adminGetReferralSettings() {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikisPlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const settings = (await dbc.select().from(tikisPlatformSettings).where(eq(tikisPlatformSettings.id, 1)).limit(1))[0];
  return { rewardAmount: settings?.referralRewardAmount ?? 1000, enabled: settings?.referralEnabled ?? true, requiredDeliveries: settings?.referralRequiredDeliveries ?? 1 };
}

export async function adminUpdateReferralSettings(input: { rewardAmount: number; enabled: boolean; requiredDeliveries: number }) {
  if (!Number.isSafeInteger(input.rewardAmount) || input.rewardAmount < 0 || input.rewardAmount > 100_000) throw new Error("Montant de récompense invalide.");
  if (!Number.isSafeInteger(input.requiredDeliveries) || input.requiredDeliveries < 1 || input.requiredDeliveries > 100) throw new Error("Le nombre de courses requis doit être compris entre 1 et 100.");
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikisPlatformSettings).values({ id: 1, referralRewardAmount: input.rewardAmount, referralEnabled: input.enabled, referralRequiredDeliveries: input.requiredDeliveries }).onDuplicateKeyUpdate({ set: { referralRewardAmount: input.rewardAmount, referralEnabled: input.enabled, referralRequiredDeliveries: input.requiredDeliveries } });
  return input;
}

// ————————————————————————————————————————————————————————————————————————
// Gestion financière complète
// ————————————————————————————————————————————————————————————————————————

export async function adminGetFinanceSettings() {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikisPlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const settings = (await dbc.select().from(tikisPlatformSettings).where(eq(tikisPlatformSettings.id, 1)).limit(1))[0];
  // Réutilise la même validation stricte que le taux appliqué en production (db.getTikisCommissionRate) :
  // si la configuration est absente ou invalide, l'admin doit voir une erreur explicite plutôt qu'un
  // taux par défaut silencieux de 10 % qui masquerait un vrai problème de configuration.
  return {
    commissionRate: await db.getTikisCommissionRate(),
    minWithdrawal: settings?.minWithdrawal ?? 500,
    maxWithdrawal: settings?.maxWithdrawal ?? 500000,
  };
}

export async function adminUpdateFinanceSettings(input: { minWithdrawal: number; maxWithdrawal: number }) {
  if (!Number.isSafeInteger(input.minWithdrawal) || input.minWithdrawal < 0) throw new Error("Montant minimum de retrait invalide.");
  if (!Number.isSafeInteger(input.maxWithdrawal) || input.maxWithdrawal <= input.minWithdrawal) throw new Error("Le montant maximum doit être supérieur au minimum.");
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikisPlatformSettings).values({ id: 1, minWithdrawal: input.minWithdrawal, maxWithdrawal: input.maxWithdrawal }).onDuplicateKeyUpdate({ set: { minWithdrawal: input.minWithdrawal, maxWithdrawal: input.maxWithdrawal } });
  return input;
}

export async function adminListPaymentTransactions(input: { type?: "deposit" | "withdrawal"; status?: "pending" | "succeeded" | "failed" | "cancelled"; limit?: number }) {
  const dbc = await getDb();
  if (!dbc) return [];
  const conditions = [
    input.type ? eq(tikisPaymentTransactions.type, input.type) : undefined,
    input.status ? eq(tikisPaymentTransactions.status, input.status) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  return dbc.select().from(tikisPaymentTransactions).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(tikisPaymentTransactions.createdAt)).limit(Math.min(input.limit ?? 100, 500));
}

// ————————————————————————————————————————————————————————————————————————
// Estimation intelligente des prix (paramètres par type d'engin)
// ————————————————————————————————————————————————————————————————————————

export type PricingConfig = {
  vehicles: Record<string, { minimum: number; perKm: number }>;
  typeAdjustment: { plis: number; personnePerPassenger: number };
  cargo: { base: number; perKg: number; perKgCap: number; perM3: number; perM3Cap: number };
};

const DEFAULT_PRICING_CONFIG: PricingConfig = {
  vehicles: {
    "Vélo": { minimum: 500, perKm: 115 },
    "Moto": { minimum: 750, perKm: 165 },
    "Tricycle": { minimum: 1100, perKm: 220 },
    "Voiture": { minimum: 1600, perKm: 290 },
  },
  typeAdjustment: { plis: 180, personnePerPassenger: 240 },
  cargo: { base: 280, perKg: 22, perKgCap: 1800, perM3: 5200, perM3Cap: 2600 },
};

export async function adminGetPricingConfig(): Promise<PricingConfig> {
  const dbc = await getDb();
  if (!dbc) return DEFAULT_PRICING_CONFIG;
  await dbc.insert(tikisPlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const settings = (await dbc.select().from(tikisPlatformSettings).where(eq(tikisPlatformSettings.id, 1)).limit(1))[0];
  if (!settings?.pricingConfig) return DEFAULT_PRICING_CONFIG;
  try {
    const parsed = JSON.parse(settings.pricingConfig) as Partial<PricingConfig>;
    return { vehicles: { ...DEFAULT_PRICING_CONFIG.vehicles, ...parsed.vehicles }, typeAdjustment: { ...DEFAULT_PRICING_CONFIG.typeAdjustment, ...parsed.typeAdjustment }, cargo: { ...DEFAULT_PRICING_CONFIG.cargo, ...parsed.cargo } };
  } catch {
    return DEFAULT_PRICING_CONFIG;
  }
}

export async function adminUpdatePricingConfig(config: PricingConfig) {
  for (const [vehicle, rate] of Object.entries(config.vehicles)) {
    if (!Number.isFinite(rate.minimum) || rate.minimum < 0 || rate.minimum > 100_000) throw new Error(`Tarif minimum invalide pour ${vehicle}.`);
    if (!Number.isFinite(rate.perKm) || rate.perKm < 0 || rate.perKm > 10_000) throw new Error(`Tarif au kilomètre invalide pour ${vehicle}.`);
  }
  for (const [key, value] of Object.entries(config.cargo)) {
    if (!Number.isFinite(value) || value < 0 || value > 100_000) throw new Error(`Valeur invalide pour le paramètre poids/volume « ${key} ».`);
  }
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const serialized = JSON.stringify(config);
  await dbc.insert(tikisPlatformSettings).values({ id: 1, pricingConfig: serialized }).onDuplicateKeyUpdate({ set: { pricingConfig: serialized } });
  return config;
}

// ————————————————————————————————————————————————————————————————————————
// Réglage des pays
// ————————————————————————————————————————————————————————————————————————

export async function adminListCountries() {
  const dbc = await getDb();
  if (!dbc) return [];
  const rows = await dbc.select().from(tikisSupportedCountries);
  // `issue` rend visibles les lignes enregistrées avant que la cohérence soit
  // vérifiée : la console les signale au lieu de les laisser passer pour bonnes.
  return rows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => ({
      ...row,
      issue: countryDraftIssue({ id: row.id, name: row.name, dialCode: row.dialCode }),
      planWarning: countryPlanWarning({
        id: row.id, name: row.name, dialCode: row.dialCode,
        digits: row.digits, groups: row.groups.split(",").map(Number),
      }),
    }));
}

export async function adminUpsertCountry(input: { id: string; name: string; dialCode: string; digits: number; groups: number[]; timeZones: string[]; enabled: boolean; sortOrder: number }) {
  if (!/^[A-Z]{2}$/.test(input.id)) throw new Error("Le code pays doit être un code ISO à 2 lettres (ex. BF).");
  if (!/^\+\d{1,4}$/.test(input.dialCode)) throw new Error("Indicatif téléphonique invalide (ex. +226).");
  // Le code, le nom et l'indicatif doivent désigner le même pays. Sans cette
  // vérification, « Bénin / BN / +229 » s'enregistrait sans broncher — et BN est
  // le Brunei, dont l'application affichait ensuite le drapeau et les villes.
  const inconsistency = countryDraftIssue({ id: input.id, name: input.name, dialCode: input.dialCode });
  if (inconsistency) throw new Error(inconsistency);
  if (!Number.isInteger(input.digits) || input.digits < 4 || input.digits > 15) throw new Error("Nombre de chiffres invalide.");
  if (input.groups.reduce((a, b) => a + b, 0) !== input.digits) throw new Error("La somme des groupes d’affichage doit être égale au nombre de chiffres.");
  if (input.timeZones.length === 0) throw new Error("Au moins un fuseau horaire est requis.");
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const values = {
    id: input.id, name: input.name.trim(), dialCode: input.dialCode, digits: input.digits,
    groups: input.groups.join(","), timeZones: input.timeZones.join(","), enabled: input.enabled, sortOrder: input.sortOrder,
  };
  await dbc.insert(tikisSupportedCountries).values(values).onDuplicateKeyUpdate({ set: values });
  return values;
}

export async function adminSetCountryEnabled(id: string, enabled: boolean) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const country = (await dbc.select().from(tikisSupportedCountries).where(eq(tikisSupportedCountries.id, id)).limit(1))[0];
  if (!country) throw new Error("Pays introuvable.");
  if (!enabled) {
    const remainingEnabled = await dbc.select({ count: count() }).from(tikisSupportedCountries).where(and(eq(tikisSupportedCountries.enabled, true), sql`${tikisSupportedCountries.id} != ${id}`));
    if (Number(remainingEnabled[0]?.count ?? 0) === 0) throw new Error("Impossible de désactiver le dernier pays actif.");
  }
  await dbc.update(tikisSupportedCountries).set({ enabled }).where(eq(tikisSupportedCountries.id, id));
  return { id, enabled };
}

// ————————————————————————————————————————————————————————————————————————
// Mode maintenance
// ————————————————————————————————————————————————————————————————————————

export async function adminSetMaintenance(input: { enabled: boolean; message?: string }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikisPlatformSettings).values({ id: 1, maintenanceEnabled: input.enabled, maintenanceMessage: input.message?.trim() || null }).onDuplicateKeyUpdate({ set: { maintenanceEnabled: input.enabled, maintenanceMessage: input.message?.trim() || null } });
  return { enabled: input.enabled, message: input.message?.trim() || undefined };
}

// ————————————————————————————————————————————————————————————————————————
// Suppression de compte — vue administrateur
// ————————————————————————————————————————————————————————————————————————

export async function adminListPendingDeletions() {
  const dbc = await getDb();
  if (!dbc) return [];
  return dbc.select({ phone: tikisProfiles.phone, fullName: tikisProfiles.fullName, accountType: tikisProfiles.accountType, deletionRequestedAt: tikisProfiles.deletionRequestedAt }).from(tikisProfiles).where(sql`${tikisProfiles.deletionRequestedAt} is not null and ${tikisProfiles.deletedAt} is null`).orderBy(desc(tikisProfiles.deletionRequestedAt));
}

// ————————————————————————————————————————————————————————————————————————
// Vérification d'identité (KYC)
// ————————————————————————————————————————————————————————————————————————

export async function adminListKycSubmissions(status?: "submitted" | "approved" | "rejected") {
  const dbc = await getDb();
  if (!dbc) return [];
  const base = dbc.select({
    submission: tikisKycSubmissions,
    driverName: tikisProfiles.fullName,
  }).from(tikisKycSubmissions).innerJoin(tikisProfiles, eq(tikisKycSubmissions.driverPhone, tikisProfiles.phone));
  const filtered = status ? base.where(eq(tikisKycSubmissions.status, status)) : base;
  return filtered.orderBy(desc(tikisKycSubmissions.submittedAt));
}

export async function adminReviewKyc(input: { submissionId: string; decision: "approved" | "rejected"; rejectionReason?: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const submission = (await dbc.select().from(tikisKycSubmissions).where(eq(tikisKycSubmissions.id, input.submissionId)).limit(1))[0];
  if (!submission) throw new Error("Dossier introuvable.");
  await dbc.update(tikisKycSubmissions).set({
    status: input.decision, rejectionReason: input.decision === "rejected" ? (input.rejectionReason?.trim() || "Documents non conformes.") : null,
    reviewedAt: new Date(), reviewedByAdminId: input.adminId,
  }).where(eq(tikisKycSubmissions.id, input.submissionId));
  return { id: input.submissionId, status: input.decision };
}

// ————————————————————————————————————————————————————————————————————————
// Programme de fidélité
// ————————————————————————————————————————————————————————————————————————

export async function adminListLoyaltyPrograms() {
  const dbc = await getDb();
  if (!dbc) return [];
  return dbc.select().from(tikisLoyaltyPrograms).orderBy(desc(tikisLoyaltyPrograms.updatedAt));
}

export async function adminUpsertLoyaltyProgram(input: {
  id?: string;
  name: string;
  description?: string;
  role: "sender" | "driver";
  requiredDeliveries: number;
  bonusAmount: number;
  windowDays: number;
  autoCredit?: boolean;
  autoCreditMaxAmount?: number;
  enabled: boolean;
  adminId: number;
}) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const { randomUUID } = await import("node:crypto");
  const id = input.id ?? `prog-${randomUUID().slice(0, 12)}`;
  const autoCredit = input.autoCredit ?? false;
  const autoCreditMaxAmount = input.autoCreditMaxAmount ?? 0;
  await dbc.insert(tikisLoyaltyPrograms).values({
    id,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    role: input.role,
    requiredDeliveries: input.requiredDeliveries,
    bonusAmount: input.bonusAmount,
    windowDays: input.windowDays,
    autoCredit,
    autoCreditMaxAmount,
    enabled: input.enabled,
  }).onDuplicateKeyUpdate({
    set: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      role: input.role,
      requiredDeliveries: input.requiredDeliveries,
      bonusAmount: input.bonusAmount,
      windowDays: input.windowDays,
      autoCredit,
      autoCreditMaxAmount,
      enabled: input.enabled,
    },
  });
  const row = (await dbc.select().from(tikisLoyaltyPrograms).where(eq(tikisLoyaltyPrograms.id, id)).limit(1))[0];
  return row;
}

export async function adminSetLoyaltyProgramEnabled(input: { id: string; enabled: boolean }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.update(tikisLoyaltyPrograms).set({ enabled: input.enabled }).where(eq(tikisLoyaltyPrograms.id, input.id));
}

export async function adminListPendingLoyaltyGrants(limit: number) {
  const dbc = await getDb();
  if (!dbc) return [];
  const rows = await dbc.select().from(tikisLoyaltyGrants).where(eq(tikisLoyaltyGrants.status, "pending")).orderBy(desc(tikisLoyaltyGrants.grantedAt)).limit(Math.min(limit, 200));
  return rows;
}

export async function adminCreditLoyaltyGrant(input: { grantId: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const { creditLoyaltyGrantOnWallet } = await import("./loyalty");
  const result = await creditLoyaltyGrantOnWallet(input.grantId);
  if (!result.credited) {
    const existing = (await dbc.select().from(tikisLoyaltyGrants).where(eq(tikisLoyaltyGrants.id, input.grantId)).limit(1))[0];
    if (existing && existing.status !== "pending") throw new Error("Cet octroi a déjà été traité.");
    throw new Error("Cet octroi a déjà été traité.");
  }
  const grant = (await dbc.select().from(tikisLoyaltyGrants).where(eq(tikisLoyaltyGrants.id, input.grantId)).limit(1))[0];
  return { id: input.grantId, profilePhone: grant?.profilePhone ?? "", bonusAmount: grant?.bonusAmount ?? 0, wallet: result.wallet };
}

export async function adminCancelLoyaltyGrant(input: { grantId: string; reason: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.update(tikisLoyaltyGrants).set({ status: "cancelled" }).where(and(eq(tikisLoyaltyGrants.id, input.grantId), eq(tikisLoyaltyGrants.status, "pending")));
}
