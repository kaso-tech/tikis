import { randomUUID } from "crypto";
import { and, count, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import * as db from "./db";
import {
  tikisAdminAuditLog,
  tikisAdminUsers,
  tikisDeliveries,
  tikisDeliveryCandidates,
  tikisDeliveryEvents,
  tikisDeliveryReports,
  tikisPaymentTransactions,
  tikisPlatformSettings,
  tikisProfiles,
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

export async function adminSearchProfiles(input: { query?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(input.limit ?? 30, 100);
  const query = input.query?.trim();
  if (!query) return db.select().from(tikisProfiles).orderBy(desc(tikisProfiles.createdAt)).limit(limit);
  const term = `%${query}%`;
  return db.select().from(tikisProfiles).where(or(like(tikisProfiles.phone, term), like(tikisProfiles.fullName, term), like(tikisProfiles.email, term))).orderBy(desc(tikisProfiles.createdAt)).limit(limit);
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
    db.select({ total: sql<number>`coalesce(sum(${tikisWalletLedger.amount}), 0)` }).from(tikisWalletLedger).where(and(eq(tikisWalletLedger.operation, "debit"), gte(tikisWalletLedger.createdAt, since), lte(tikisWalletLedger.createdAt, new Date()))),
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

export async function adminSetProfileStatus(input: { phone: string; status: ProfileStatus; reason?: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const profile = (await dbc.select().from(tikisProfiles).where(eq(tikisProfiles.phone, input.phone)).limit(1))[0];
  if (!profile) throw new Error("Profil introuvable.");
  await dbc.update(tikisProfiles).set({
    status: input.status,
    statusReason: input.status === "active" ? null : (input.reason?.trim() || null),
    statusUpdatedAt: new Date(),
    statusUpdatedByAdminId: input.adminId,
  }).where(eq(tikisProfiles.phone, input.phone));
  return { phone: input.phone, status: input.status };
}

/** Le rôle (sender/driver) est normalement immuable côté app ; ce changement est réservé aux super-admins
 *  pour corriger une erreur d'inscription ou une demande explicite de l'utilisateur. */
export async function adminChangeProfileRole(input: { phone: string; role: "sender" | "driver" }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const profile = (await dbc.select().from(tikisProfiles).where(eq(tikisProfiles.phone, input.phone)).limit(1))[0];
  if (!profile) throw new Error("Profil introuvable.");
  const activeDeliveries = await dbc.select({ count: count() }).from(tikisDeliveries).where(and(
    or(eq(tikisDeliveries.senderPhone, input.phone), eq(tikisDeliveries.driverPhone, input.phone)),
    or(eq(tikisDeliveries.status, "active"), eq(tikisDeliveries.status, "pending_confirmation")),
  ));
  if (Number(activeDeliveries[0]?.count ?? 0) > 0) throw new Error("Impossible de changer le rôle : ce profil a une livraison en cours.");
  await dbc.update(tikisProfiles).set({ accountType: input.role, vehicles: input.role === "sender" ? "[]" : profile.vehicles }).where(eq(tikisProfiles.phone, input.phone));
  return { phone: input.phone, role: input.role };
}

export async function adminRewardWallet(input: { phone: string; amount: number; reason: string; adminId: number }) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1_000_000) throw new Error("Montant de récompense invalide.");
  return db.adminAdjustWallet({ profilePhone: input.phone, amount: input.amount, direction: "credit", operation: "bonus", reason: input.reason || "Bonus accordé par l’administration", adminId: input.adminId });
}

export async function adminPenalizeWallet(input: { phone: string; amount: number; reason: string; adminId: number }) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1_000_000) throw new Error("Montant de pénalité invalide.");
  return db.adminAdjustWallet({ profilePhone: input.phone, amount: input.amount, direction: "debit", operation: "penalty", reason: input.reason || "Pénalité appliquée par l’administration", adminId: input.adminId });
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
    const candidates = await tx.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.deliveryId, input.deliveryId), or(eq(tikisDeliveryCandidates.status, "applied"), eq(tikisDeliveryCandidates.status, "selected"), eq(tikisDeliveryCandidates.status, "confirmed"))));
    for (const candidate of candidates) {
      if (candidate.commissionBlocked > 0) {
        await db.adminAdjustWallet({ profilePhone: candidate.driverPhone, amount: candidate.commissionBlocked, direction: "credit", operation: "credit", reason: `Annulation administrative de la livraison ${input.deliveryId} : commission libérée`, adminId: input.adminId });
      }
      await tx.update(tikisDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(tikisDeliveryCandidates.id, candidate.id));
    }
    await tx.update(tikisDeliveries).set({ status: "cancelled", updatedAt: new Date() }).where(eq(tikisDeliveries.id, input.deliveryId));
    await tx.insert(tikisDeliveryEvents).values({ id: randomUUID(), deliveryId: input.deliveryId, eventType: "admin_cancelled", status: "cancelled", actorPhone: null, recipientPhone: delivery.senderPhone, title: "Livraison annulée par l’administration", body: input.reason || "Cette livraison a été annulée après examen par l’équipe Tikis.", tone: "warning", idempotencyKey: `${input.deliveryId}:admin-cancel:${randomUUID()}` });
    if (delivery.driverPhone) {
      await tx.insert(tikisDeliveryEvents).values({ id: randomUUID(), deliveryId: input.deliveryId, eventType: "admin_cancelled", status: "cancelled", actorPhone: null, recipientPhone: delivery.driverPhone, title: "Livraison annulée par l’administration", body: input.reason || "Cette livraison a été annulée après examen par l’équipe Tikis.", tone: "warning", idempotencyKey: `${input.deliveryId}:admin-cancel-driver:${randomUUID()}` });
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
    return referral;
  }).then(async (referral) => {
    await db.adminAdjustWallet({ profilePhone: referral.referrerPhone, amount: referral.rewardAmount, direction: "credit", operation: "bonus", reason: `Récompense de parrainage — filleul ${referral.refereePhone}`, adminId: input.adminId });
    return { referralId: referral.id, status: "rewarded" as const };
  });
}

export async function adminGetReferralSettings() {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikisPlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const settings = (await dbc.select().from(tikisPlatformSettings).where(eq(tikisPlatformSettings.id, 1)).limit(1))[0];
  return { rewardAmount: settings?.referralRewardAmount ?? 1000, enabled: settings?.referralEnabled ?? true };
}

export async function adminUpdateReferralSettings(input: { rewardAmount: number; enabled: boolean }) {
  if (!Number.isSafeInteger(input.rewardAmount) || input.rewardAmount < 0 || input.rewardAmount > 100_000) throw new Error("Montant de récompense invalide.");
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikisPlatformSettings).values({ id: 1, referralRewardAmount: input.rewardAmount, referralEnabled: input.enabled }).onDuplicateKeyUpdate({ set: { referralRewardAmount: input.rewardAmount, referralEnabled: input.enabled } });
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
  return {
    commissionRate: Number(settings?.commissionRate ?? "0.1"),
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
};

const DEFAULT_PRICING_CONFIG: PricingConfig = {
  vehicles: {
    "Vélo": { minimum: 500, perKm: 115 },
    "Moto": { minimum: 750, perKm: 165 },
    "Tricycle": { minimum: 1100, perKm: 220 },
    "Voiture": { minimum: 1600, perKm: 290 },
  },
  typeAdjustment: { plis: 180, personnePerPassenger: 240 },
};

export async function adminGetPricingConfig(): Promise<PricingConfig> {
  const dbc = await getDb();
  if (!dbc) return DEFAULT_PRICING_CONFIG;
  await dbc.insert(tikisPlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const settings = (await dbc.select().from(tikisPlatformSettings).where(eq(tikisPlatformSettings.id, 1)).limit(1))[0];
  if (!settings?.pricingConfig) return DEFAULT_PRICING_CONFIG;
  try {
    const parsed = JSON.parse(settings.pricingConfig) as Partial<PricingConfig>;
    return { vehicles: { ...DEFAULT_PRICING_CONFIG.vehicles, ...parsed.vehicles }, typeAdjustment: { ...DEFAULT_PRICING_CONFIG.typeAdjustment, ...parsed.typeAdjustment } };
  } catch {
    return DEFAULT_PRICING_CONFIG;
  }
}

export async function adminUpdatePricingConfig(config: PricingConfig) {
  for (const [vehicle, rate] of Object.entries(config.vehicles)) {
    if (!Number.isFinite(rate.minimum) || rate.minimum < 0 || rate.minimum > 100_000) throw new Error(`Tarif minimum invalide pour ${vehicle}.`);
    if (!Number.isFinite(rate.perKm) || rate.perKm < 0 || rate.perKm > 10_000) throw new Error(`Tarif au kilomètre invalide pour ${vehicle}.`);
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
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function adminUpsertCountry(input: { id: string; name: string; dialCode: string; digits: number; groups: number[]; timeZones: string[]; enabled: boolean; sortOrder: number }) {
  if (!/^[A-Z]{2}$/.test(input.id)) throw new Error("Le code pays doit être un code ISO à 2 lettres (ex. BF).");
  if (!/^\+\d{1,4}$/.test(input.dialCode)) throw new Error("Indicatif téléphonique invalide (ex. +226).");
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
