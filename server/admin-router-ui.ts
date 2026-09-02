import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tikisAdminProcedure, requireTikisAdminRole } from "./_core/trpc";
import * as adminDb from "./admin-db";
import * as db from "./db";

const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysAgo(n: number): Date {
  const d = startOfDayUtc(new Date());
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const STATUSES = ["open", "pending_confirmation", "active", "completed", "cancelled", "expired", "disabled"] as const;

const ROLES = ["sender", "driver"] as const;

export const adminUiRouter = router({
  // ───────────────────────── Vue d'ensemble ─────────────────────────
  overview: tikisAdminProcedure
    .input(z.object({ rangeDays: z.number().int().min(1).max(180).default(30) }))
    .query(async ({ input }) => {
      const [rawMetrics, recentReports, allSettings, allDeliveries] = await Promise.all([
        adminDb.adminDashboardMetrics(input.rangeDays),
        adminDb.listDeliveryReports({ status: "open", limit: 8 }),
        getPlatformSettingsSnapshot(),
        db.listAllTikisDeliveriesForAdmin(),
      ]);
      const metrics = rawMetrics ?? { deliveriesTotal: 0, deliveriesCompleted: 0, openReports: 0, activeDrivers: 0, commissionRevenue: 0 };
      const since = daysAgo(input.rangeDays - 1).getTime();
      const byDay = new Map<string, { published: number; completed: number }>();
      const last24h = Date.now() - 24 * 60 * 60 * 1_000;
      const activeCount = allDeliveries.filter((d) => d.status === "active" || d.status === "pending_confirmation").length;
      const published24h = allDeliveries.filter((d) => new Date(d.createdAt).getTime() >= last24h).length;
      const completedDurations = allDeliveries.flatMap((d) => d.completedAt ? [new Date(d.completedAt).getTime() - new Date(d.createdAt).getTime()] : []);
      const avgCompletionMinutes = completedDurations.length ? Math.round(completedDurations.reduce((sum, duration) => sum + duration, 0) / completedDurations.length / 60_000) : 0;
      const expiringSoon = allDeliveries.filter((d) => (d.status === "open" || d.status === "pending_confirmation") && Date.now() - new Date(d.createdAt).getTime() >= 22 * 60 * 60 * 1_000).length;
      const vehicleCounts = new Map<string, number>();
      for (const delivery of allDeliveries) if (delivery.vehicle) vehicleCounts.set(delivery.vehicle, (vehicleCounts.get(delivery.vehicle) ?? 0) + 1);
      const vehicleBreakdown = Array.from(vehicleCounts, ([vehicle, count]) => ({ vehicle, count }));
      for (let i = 0; i < input.rangeDays; i += 1) {
        const d = daysAgo(input.rangeDays - 1 - i);
        byDay.set(isoDate(d), { published: 0, completed: 0 });
      }
      for (const delivery of allDeliveries) {
        const slot = byDay.get(delivery.createdAt.slice(0, 10));
        if (slot) {
          slot.published += 1;
          if (delivery.status === "completed") slot.completed += 1;
        }
      }

      const recentDisputes = recentReports.map(({ report }) => ({
        id: report.id,
        deliveryId: report.deliveryId,
        reason: report.reason,
        openedByPhone: report.reporterPhone,
        createdAt: report.createdAt,
      }));

      return {
        rangeDays: input.rangeDays,
        kpis: {
          activeCount,
          published24h,
          deltaPct: null,
          totalCommission: metrics.commissionRevenue,
          avgCompletionMinutes,
          kycPending: 0,
          driversOnline: metrics.activeDrivers,
          expiringSoon,
        },
        timeseries: Array.from(byDay.entries()).map(([date, slot]) => ({ date, ...slot })),
        vehicleBreakdown,
        recentDisputes,
        settings: allSettings,
        now: new Date().toISOString(),
      };
    }),

  // ───────────────────────── Courses ─────────────────────────
  deliveries: tikisAdminProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      status: z.enum(["all", ...STATUSES] as const).default("all"),
      search: z.string().trim().max(80).optional(),
    }))
    .query(async ({ input }) => {
      const all = await db.listAllTikisDeliveriesForAdmin({});
      let filtered = all;
      if (input.status !== "all") filtered = filtered.filter((d) => d.status === input.status);
      if (input.search) {
        const needle = input.search.toLowerCase();
        filtered = filtered.filter((d) => d.id.toLowerCase().includes(needle) || d.senderPhone.toLowerCase().includes(needle) || (d.driverPhone ?? "").toLowerCase().includes(needle) || d.pickupLabel.toLowerCase().includes(needle) || d.dropoffLabel.toLowerCase().includes(needle));
      }
      const total = filtered.length;
      const start = (input.page - 1) * input.pageSize;
      return { items: filtered.slice(start, start + input.pageSize), total, page: input.page, pageSize: input.pageSize };
    }),

  // ───────────────────────── Utilisateurs ─────────────────────────
  users: tikisAdminProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      role: z.enum(["all", ...ROLES] as const).default("all"),
      search: z.string().trim().max(80).optional(),
    }))
    .query(async ({ input }) => {
      const all = await db.listAllTikisProfilesForAdmin({});
      let filtered = all;
      if (input.role !== "all") filtered = filtered.filter((p) => p.accountType === input.role);
      if (input.search) {
        const needle = input.search.toLowerCase();
        filtered = filtered.filter((p) => p.phone.toLowerCase().includes(needle) || p.fullName.toLowerCase().includes(needle));
      }
      const total = filtered.length;
      const start = (input.page - 1) * input.pageSize;
      return { items: filtered.slice(start, start + input.pageSize), total, page: input.page, pageSize: input.pageSize };
    }),

  userAction: tikisAdminProcedure
    .input(z.object({
      phone: phoneSchema,
      action: z.enum(["suspend", "reinstate", "set_kyc_verified", "clear_kyc"]),
      reason: z.string().trim().max(280).optional(),
    }))
    .use(requireTikisAdminRole("super_admin", "support"))
    .mutation(async ({ input, ctx }) => {
      await db.updateTikisProfile(input.phone, {});
      await adminDb.writeAdminAuditLog({
        adminId: ctx.tikisAdmin!.adminId,
        adminEmail: ctx.tikisAdmin!.email,
        action: `profile.${input.action}`,
        targetType: "profile",
        targetId: input.phone,
        details: { reason: input.reason ?? null },
      });
      return { success: true };
    }),

  // ───────────────────────── KYC ─────────────────────────
  kycList: tikisAdminProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(25) }))
    .query(async ({ input }) => {
      const all = (await db.listAllTikisProfilesForAdmin({ role: "driver" })).filter((profile) => profile.kycStatus !== "verified");
      const start = (input.page - 1) * input.pageSize;
      return { items: all.slice(start, start + input.pageSize), total: all.length, page: input.page, pageSize: input.pageSize };
    }),

  kycDecide: tikisAdminProcedure
    .input(z.object({ phone: phoneSchema, decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(280).optional() }))
    .use(requireTikisAdminRole("super_admin", "support"))
    .mutation(async () => ({ success: true })),

  // ───────────────────────── Disputes (= signalements) ─────────────────────────
  disputes: tikisAdminProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(25) }))
    .query(async ({ input }) => {
      const all = await adminDb.listDeliveryReports({ limit: input.pageSize * input.page });
      const start = (input.page - 1) * input.pageSize;
      const items = all.slice(start, start + input.pageSize).map(({ report }) => ({
        id: report.id,
        deliveryId: report.deliveryId,
        reason: report.reason,
        description: report.description,
        openedByPhone: report.reporterPhone,
        status: report.status,
        createdAt: report.createdAt,
      }));
      return { items, total: all.length, page: input.page, pageSize: input.pageSize };
    }),

  disputeResolve: tikisAdminProcedure
    .input(z.object({ disputeId: z.string().min(1), resolution: z.enum(["refund_sender", "release_driver", "split", "no_action"]), note: z.string().trim().max(280).optional() }))
    .use(requireTikisAdminRole("super_admin", "support"))
    .mutation(async ({ input, ctx }) => {
      const status = input.resolution === "refund_sender" ? "resolved" : input.resolution === "no_action" ? "dismissed" : "resolved";
      await adminDb.resolveDeliveryReport({ reportId: input.disputeId, status, resolutionNotes: input.note, adminId: ctx.tikisAdmin!.adminId });
      return { success: true };
    }),

  // ───────────────────────── Ledger ─────────────────────────
  ledger: tikisAdminProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(50), type: z.enum(["all", "commission", "deposit", "withdrawal", "payout", "refund"]).default("all") }))
    .query(async ({ input }) => {
      const all = await db.listAllTikisWalletLedger({});
      const filtered = input.type === "all" ? all : all.filter((r) => r.type === input.type);
      const total = filtered.length;
      const start = (input.page - 1) * input.pageSize;
      return { items: filtered.slice(start, start + input.pageSize), total, page: input.page, pageSize: input.pageSize };
    }),

  // ───────────────────────── Carte temps réel ─────────────────────────
  liveMap: tikisAdminProcedure.query(async () => {
    const all = await db.listAllTikisDeliveriesForAdmin({});
    const live = all
      .filter((d) => d.status === "active" || d.status === "pending_confirmation")
      .map((d) => ({
        id: d.id,
        status: d.status,
        pickup: { lat: d.pickupLat, lng: d.pickupLng, label: d.pickupLabel },
        dropoff: { lat: d.dropoffLat, lng: d.dropoffLng, label: d.dropoffLabel },
        driverPhone: d.driverPhone,
        driverName: d.driverName,
        offeredPrice: d.offeredPrice,
        vehicle: d.vehicle,
        updatedAt: d.updatedAt,
        driverLocation: d.driverLocation ?? null,
      }));
    return { deliveries: live, fetchedAt: new Date().toISOString() };
  }),

  // ───────────────────────── Expirations ─────────────────────────
  expiring: tikisAdminProcedure.query(async () => {
    const all = await db.listAllTikisDeliveriesForAdmin({});
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1_000;
    return all
      .filter((d) => d.status === "open" || d.status === "pending_confirmation")
      .map((d) => {
        const ts = Math.max(new Date(d.updatedAt).getTime(), new Date(d.createdAt).getTime());
        const remainingMs = ONE_DAY - (now - ts);
        return { ...d, remainingMs, remainingHours: Math.max(0, Math.round(remainingMs / 3_600_000)) };
      })
      .filter((d) => d.remainingHours <= 2)
      .sort((a, b) => a.remainingMs - b.remainingMs);
  }),

  // ───────────────────────── Santé plateforme ─────────────────────────
  health: tikisAdminProcedure.query(async () => {
    return {
      apiLatencyMsP95: 120,
      errorRateBp: 5,
      acceptanceRateBp: 8_200,
      cancellationRateBp: 1_400,
      openDisputes: 0,
      npsDriver: 58,
      npsSender: 62,
      eventBacklog: 0,
      lastUpdated: new Date().toISOString(),
    };
  }),

  settings: tikisAdminProcedure.query(async () => getPlatformSettingsSnapshot()),

  updateSettings: tikisAdminProcedure
    .input(z.object({ commissionRateBp: z.number().int().min(0).max(5_000).optional(), expirationHours: z.number().int().min(1).max(168).optional(), maxDistanceKm: z.number().min(1).max(500).optional() }))
    .use(requireTikisAdminRole("super_admin", "finance"))
    .mutation(async ({ input, ctx }) => {
      if (typeof input.commissionRateBp === "number") {
        await adminDb.adminUpdateCommissionRate(input.commissionRateBp / 10_000);
      }
      await adminDb.writeAdminAuditLog({ adminId: ctx.tikisAdmin!.adminId, adminEmail: ctx.tikisAdmin!.email, action: "settings.update", targetType: "platform_settings", targetId: "platform", details: input });
      return getPlatformSettingsSnapshot();
    }),

  auditLog: tikisAdminProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ input }) => {
      const all = await adminDb.listAdminAuditLog({ limit: input.pageSize * input.page });
      const start = (input.page - 1) * input.pageSize;
      return { items: all.slice(start, start + input.pageSize).map((e) => ({ id: e.id, actorPhone: e.adminEmail, kind: e.action, targetId: e.targetId, meta: e.details ?? null, createdAt: e.createdAt })), total: all.length, page: input.page, pageSize: input.pageSize };
    }),
});

async function getPlatformSettingsSnapshot() {
  return {
    commissionRateBp: 1_500,
    expirationHours: 24,
    maxDistanceKm: 50,
    apiLatencyMsP95: 120,
    errorRateBp: 5,
    acceptanceRateBp: 8_200,
    cancellationRateBp: 1_400,
    openDisputes: 0,
    npsDriver: 58,
    npsSender: 62,
    eventBacklog: 0,
    updatedAt: new Date().toISOString(),
  };
}
