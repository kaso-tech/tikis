import { randomUUID } from "crypto";
import { and, count, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  tikisAdminAuditLog,
  tikisAdminUsers,
  tikisDeliveries,
  tikisDeliveryCandidates,
  tikisDeliveryEvents,
  tikisDeliveryReports,
  tikisPlatformSettings,
  tikisProfiles,
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

export async function setAdminUserActive(adminId: number, active: boolean) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  await db.update(tikisAdminUsers).set({ active }).where(eq(tikisAdminUsers.id, adminId));
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

export async function listAdminAuditLog(input: { targetType?: string; targetId?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    input.targetType ? eq(tikisAdminAuditLog.targetType, input.targetType) : undefined,
    input.targetId ? eq(tikisAdminAuditLog.targetId, input.targetId) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  return db.select().from(tikisAdminAuditLog).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(tikisAdminAuditLog.createdAt)).limit(Math.min(input.limit ?? 100, 500));
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
    input.query ? or(eq(tikisDeliveries.id, input.query), like(tikisDeliveries.senderPhone, `%${input.query}%`), like(tikisDeliveries.driverPhone, `%${input.query}%`), like(tikisDeliveries.title, `%${input.query}%`)) : undefined,
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

export async function adminSearchProfiles(input: { query: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const term = `%${input.query.trim()}%`;
  return db.select().from(tikisProfiles).where(or(like(tikisProfiles.phone, term), like(tikisProfiles.fullName, term), like(tikisProfiles.email, term))).limit(Math.min(input.limit ?? 30, 100));
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
  const [deliveriesTotal, deliveriesCompleted, openReports, activeDrivers, commissionRevenue] = await Promise.all([
    db.select({ count: count() }).from(tikisDeliveries).where(gte(tikisDeliveries.createdAt, since)),
    db.select({ count: count() }).from(tikisDeliveries).where(and(eq(tikisDeliveries.status, "completed"), gte(tikisDeliveries.createdAt, since))),
    db.select({ count: count() }).from(tikisDeliveryReports).where(eq(tikisDeliveryReports.status, "open")),
    db.select({ count: sql<number>`count(distinct ${tikisDeliveries.driverPhone})` }).from(tikisDeliveries).where(and(gte(tikisDeliveries.createdAt, since), eq(tikisDeliveries.status, "completed"))),
    db.select({ total: sql<number>`coalesce(sum(${tikisWalletLedger.amount}), 0)` }).from(tikisWalletLedger).where(and(eq(tikisWalletLedger.operation, "debit"), gte(tikisWalletLedger.createdAt, since), lte(tikisWalletLedger.createdAt, new Date()))),
  ]);
  return {
    periodDays: sinceDays,
    deliveriesTotal: Number(deliveriesTotal[0]?.count ?? 0),
    deliveriesCompleted: Number(deliveriesCompleted[0]?.count ?? 0),
    openReports: Number(openReports[0]?.count ?? 0),
    activeDrivers: Number(activeDrivers[0]?.count ?? 0),
    commissionRevenue: Number(commissionRevenue[0]?.total ?? 0),
  };
}
