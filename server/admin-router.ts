import { z } from "zod";
import { router, publicProcedure, tikisAdminProcedure, requireTikisAdminRole, invalidateTikisProfileCache } from "./_core/trpc";
import { assertLoginAllowed, createAdminSession, recordLoginFailure, recordLoginSuccess, verifyAdminPassword } from "./admin-auth";
import * as adminDb from "./admin-db";
import * as db from "./db";
import { publishDeliveryStatusBroadcast } from "./supabase-realtime";

function clientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }) {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (typeof value === "string" ? value.split(",")[0].trim() : undefined) ?? req.socket?.remoteAddress ?? "unknown";
}

async function audit(ctx: { tikisAdmin: { adminId: number; email: string } | null; req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } } }, action: string, targetType: string, targetId: string, details?: unknown) {
  if (!ctx.tikisAdmin) return;
  await adminDb.writeAdminAuditLog({ adminId: ctx.tikisAdmin.adminId, adminEmail: ctx.tikisAdmin.email, action, targetType, targetId, details, ipAddress: clientIp(ctx.req) });
}

export const tikisAdminRouter = router({
  auth: router({
    login: publicProcedure.input(z.object({ email: z.string().email(), password: z.string().min(1) })).mutation(async ({ input, ctx }) => {
      const key = `${clientIp(ctx.req)}:${input.email.toLowerCase()}`;
      assertLoginAllowed(key);
      const admin = await adminDb.getAdminByEmail(input.email);
      const valid = admin ? await verifyAdminPassword(input.password, admin.passwordHash) : false;
      if (!admin || !valid || !admin.active) {
        recordLoginFailure(key);
        throw new Error("Identifiants invalides.");
      }
      recordLoginSuccess(key);
      await adminDb.touchAdminLastLogin(admin.id);
      await adminDb.writeAdminAuditLog({ adminId: admin.id, adminEmail: admin.email, action: "login", targetType: "admin_session", targetId: String(admin.id), ipAddress: clientIp(ctx.req) });
      const sessionToken = await createAdminSession(admin.id, admin.email, admin.role);
      return { sessionToken, admin: { id: admin.id, email: admin.email, fullName: admin.fullName, role: admin.role } };
    }),
    me: tikisAdminProcedure.query(({ ctx }) => ctx.tikisAdmin),
  }),

  dashboard: router({
    metrics: tikisAdminProcedure.input(z.object({ periodDays: z.number().int().min(1).max(365).default(30) })).query(({ input }) => adminDb.adminDashboardMetrics(input.periodDays)),
  }),

  commission: router({
    get: tikisAdminProcedure.query(() => db.getTikisCommissionRate()),
    update: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ rate: z.number().min(0.001).max(0.9) })).mutation(async ({ ctx, input }) => {
      const result = await adminDb.adminUpdateCommissionRate(input.rate);
      await audit(ctx, "commission_rate_updated", "platform_settings", "commissionRate", { newRate: input.rate });
      return result;
    }),
  }),

  reports: router({
    list: tikisAdminProcedure.input(z.object({ status: z.enum(["open", "reviewing", "resolved", "dismissed"]).optional() })).query(({ input }) => adminDb.listDeliveryReports({ status: input.status })),
    resolve: tikisAdminProcedure.input(z.object({ reportId: z.string(), status: z.enum(["reviewing", "resolved", "dismissed"]), resolutionNotes: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.resolveDeliveryReport({ reportId: input.reportId, status: input.status, resolutionNotes: input.resolutionNotes, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "report_resolved", "delivery_report", input.reportId, { status: input.status, notes: input.resolutionNotes });
      return result;
    }),
  }),

  disputes: router({
    searchDeliveries: tikisAdminProcedure.input(z.object({ query: z.string().max(120).optional(), status: z.string().optional() })).query(({ input }) => adminDb.adminSearchDeliveries(input)),
    timeline: tikisAdminProcedure.input(z.object({ deliveryId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const timeline = await adminDb.adminGetDeliveryTimeline(input.deliveryId);
      await audit(ctx, "delivery_timeline_viewed", "delivery", input.deliveryId);
      return timeline;
    }),
  }),

  users: router({
    search: tikisAdminProcedure.input(z.object({
      query: z.string().trim().min(2).max(120).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(10_000).optional(),
    })).query(async ({ input }) => {
      const result = await adminDb.adminSearchProfiles({ query: input.query, limit: input.limit ?? 25, offset: input.offset ?? 0 });
      return { rows: result.rows, total: result.total, limit: input.limit ?? 25, offset: input.offset ?? 0 };
    }),
    detail: tikisAdminProcedure.input(z.object({ phone: z.string() })).query(async ({ ctx, input }) => {
      const detail = await adminDb.adminGetProfileDetail(input.phone);
      await audit(ctx, "profile_viewed", "profile", input.phone);
      return detail;
    }),
    setStatus: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "support")).input(z.object({ phone: z.string(), status: z.enum(["active", "suspended", "banned"]), reason: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminSetProfileStatus({ phone: input.phone, status: input.status, reason: input.reason, adminId: ctx.tikisAdmin.adminId });
      invalidateTikisProfileCache(input.phone);
      await audit(ctx, "profile_status_changed", "profile", input.phone, { status: input.status, reason: input.reason });
      return result;
    }),
    changeRole: tikisAdminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ phone: z.string(), role: z.enum(["sender", "driver"]) })).mutation(async ({ ctx, input }) => {
      const result = await adminDb.adminChangeProfileRole(input);
      invalidateTikisProfileCache(input.phone);
      await audit(ctx, "profile_role_changed", "profile", input.phone, { role: input.role });
      return result;
    }),
    reward: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ phone: z.string(), amount: z.number().int().positive(), reason: z.string().max(300) })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminRewardWallet({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "wallet_bonus_credited", "profile", input.phone, { amount: input.amount, reason: input.reason });
      return result;
    }),
    penalize: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ phone: z.string(), amount: z.number().int().positive(), reason: z.string().max(300) })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminPenalizeWallet({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "wallet_penalty_applied", "profile", input.phone, { amount: input.amount, reason: input.reason });
      return result;
    }),
  }),

  deliveriesOps: router({
    list: tikisAdminProcedure.input(z.object({
      query: z.string().max(120).optional(),
      status: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })).query(({ input }) => adminDb.adminListDeliveries({ ...input, from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined })),
    forceCancel: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "support")).input(z.object({ deliveryId: z.string().uuid(), reason: z.string().max(500) })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminForceCancelDelivery({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "delivery_force_cancelled", "delivery", input.deliveryId, { reason: input.reason });
      void publishDeliveryStatusBroadcast({
        deliveryId: input.deliveryId,
        status: "cancelled",
        title: "Livraison annulée par l’administration",
        body: input.reason || "Cette livraison a été annulée après examen par l’équipe Tikis.",
        occurredAt: new Date().toISOString(),
      });
      return result;
    }),
    liveLocations: tikisAdminProcedure.input(z.object({
      maxAgeSeconds: z.number().int().min(10).max(3600).default(120),
    })).query(({ input }) => adminDb.adminListLiveLocations(input)),
  }),

  referrals: router({
    list: tikisAdminProcedure.input(z.object({ status: z.enum(["invited", "qualified", "rewarded", "voided"]).optional() })).query(({ input }) => adminDb.adminListReferrals(input)),
    reward: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ referralId: z.string() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminRewardReferral({ referralId: input.referralId, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "referral_rewarded", "referral", input.referralId);
      return result;
    }),
    settings: router({
      get: tikisAdminProcedure.query(() => adminDb.adminGetReferralSettings()),
      update: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ rewardAmount: z.number().int().min(0).max(100000), enabled: z.boolean(), requiredDeliveries: z.number().int().min(1).max(100) })).mutation(async ({ ctx, input }) => {
        const result = await adminDb.adminUpdateReferralSettings(input);
        await audit(ctx, "referral_settings_updated", "platform_settings", "referral", input);
        return result;
      }),
    }),
  }),

  finance: router({
    settings: router({
      get: tikisAdminProcedure.query(() => adminDb.adminGetFinanceSettings()),
      update: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ minWithdrawal: z.number().int().min(0), maxWithdrawal: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        const result = await adminDb.adminUpdateFinanceSettings(input);
        await audit(ctx, "finance_settings_updated", "platform_settings", "withdrawal_limits", input);
        return result;
      }),
    }),
    transactions: tikisAdminProcedure.input(z.object({ type: z.enum(["deposit", "withdrawal"]).optional(), status: z.enum(["pending", "succeeded", "failed", "cancelled"]).optional() })).query(({ input }) => adminDb.adminListPaymentTransactions(input)),
    settleTransaction: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ paymentId: z.string(), outcome: z.enum(["succeeded", "failed"]), notes: z.string().max(300).optional() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await db.adminSettlePaymentTransaction({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "payment_transaction_settled", "payment_transaction", input.paymentId, { outcome: input.outcome, notes: input.notes });
      return result;
    }),
    sendBonus: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ phone: z.string(), amount: z.number().int().positive().max(1000000), reason: z.string().max(300) })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminRewardWallet({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "wallet_bonus_credited", "profile", input.phone, { amount: input.amount, reason: input.reason });
      return result;
    }),
  }),

  pricing: router({
    get: tikisAdminProcedure.query(() => adminDb.adminGetPricingConfig()),
    update: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({
      vehicles: z.record(z.string(), z.object({ minimum: z.number().min(0).max(100000), perKm: z.number().min(0).max(10000) })),
      typeAdjustment: z.object({ plis: z.number().min(0).max(100000), personnePerPassenger: z.number().min(0).max(100000) }),
      cargo: z.object({ base: z.number().min(0).max(100000), perKg: z.number().min(0).max(100000), perKgCap: z.number().min(0).max(100000), perM3: z.number().min(0).max(100000), perM3Cap: z.number().min(0).max(100000) }),
    })).mutation(async ({ ctx, input }) => {
      const result = await adminDb.adminUpdatePricingConfig(input);
      await audit(ctx, "pricing_config_updated", "platform_settings", "pricing", input);
      return result;
    }),
  }),

  countries: router({
    list: tikisAdminProcedure.query(() => adminDb.adminListCountries()),
    upsert: tikisAdminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({
      id: z.string().length(2), name: z.string().min(2).max(80), dialCode: z.string().min(2).max(6),
      digits: z.number().int().min(4).max(15), groups: z.array(z.number().int().positive()).min(1),
      timeZones: z.array(z.string().min(1)).min(1), enabled: z.boolean(), sortOrder: z.number().int().default(0),
    })).mutation(async ({ ctx, input }) => {
      const result = await adminDb.adminUpsertCountry(input);
      await audit(ctx, "country_upserted", "platform_settings", input.id, input);
      return result;
    }),
    setEnabled: tikisAdminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ id: z.string().length(2), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      const result = await adminDb.adminSetCountryEnabled(input.id, input.enabled);
      await audit(ctx, "country_enabled_changed", "platform_settings", input.id, { enabled: input.enabled });
      return result;
    }),
  }),

  maintenance: router({
    get: tikisAdminProcedure.query(() => db.getMaintenanceStatus()),
    set: tikisAdminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ enabled: z.boolean(), message: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
      const result = await adminDb.adminSetMaintenance(input);
      await audit(ctx, "maintenance_mode_changed", "platform_settings", "maintenance", input);
      return result;
    }),
  }),

  accountDeletions: router({
    list: tikisAdminProcedure.query(() => adminDb.adminListPendingDeletions()),
  }),

  kyc: router({
    list: tikisAdminProcedure.input(z.object({ status: z.enum(["submitted", "approved", "rejected"]).optional() })).query(({ input }) => adminDb.adminListKycSubmissions(input.status)),
    review: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "support")).input(z.object({ submissionId: z.string(), decision: z.enum(["approved", "rejected"]), rejectionReason: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminReviewKyc({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "kyc_reviewed", "kyc_submission", input.submissionId, { decision: input.decision, rejectionReason: input.rejectionReason });
      return result;
    }),
  }),

  admins: router({
    list: tikisAdminProcedure.use(requireTikisAdminRole("super_admin")).query(() => adminDb.listAdminUsers()),
    setActive: tikisAdminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ adminId: z.number().int(), active: z.boolean() })).mutation(async ({ ctx, input }) => {
      await adminDb.setAdminUserActive(input.adminId, input.active);
      await audit(ctx, input.active ? "admin_reactivated" : "admin_suspended", "admin_user", String(input.adminId));
      return { success: true } as const;
    }),
  }),

  auditLog: router({
    list: tikisAdminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ targetType: z.string().optional(), targetId: z.string().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).max(10_000).optional() })).query(async ({ input }) => {
      const result = await adminDb.listAdminAuditLog({ ...input, limit: input.limit ?? 50, offset: input.offset ?? 0 });
      return { rows: result.rows, total: result.total, limit: input.limit ?? 50, offset: input.offset ?? 0 };
    }),
  }),

  loyalty: router({
    listPrograms: tikisAdminProcedure.query(() => adminDb.adminListLoyaltyPrograms()),
    upsertProgram: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({
      id: z.string().min(3).max(40).optional(),
      name: z.string().min(3).max(80),
      description: z.string().max(300).optional(),
      role: z.enum(["sender", "driver"]),
      requiredDeliveries: z.number().int().min(1).max(10_000),
      bonusAmount: z.number().int().min(100).max(1_000_000),
      windowDays: z.number().int().min(1).max(365).default(90),
      autoCredit: z.boolean().default(false),
      autoCreditMaxAmount: z.number().int().min(0).max(1_000_000).default(0),
      enabled: z.boolean().default(true),
    })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminUpsertLoyaltyProgram({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "loyalty_program_upserted", "loyalty_program", result.id, { name: input.name, role: input.role, requiredDeliveries: input.requiredDeliveries, bonusAmount: input.bonusAmount, enabled: input.enabled, autoCredit: input.autoCredit, autoCreditMaxAmount: input.autoCreditMaxAmount });
      return result;
    }),
    setProgramEnabled: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ id: z.string(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      await adminDb.adminSetLoyaltyProgramEnabled(input);
      await audit(ctx, "loyalty_program_toggled", "loyalty_program", input.id, { enabled: input.enabled });
      return { id: input.id, enabled: input.enabled };
    }),
    listPendingGrants: tikisAdminProcedure.input(z.object({ limit: z.number().int().min(1).max(200).optional() })).query(({ input }) => adminDb.adminListPendingLoyaltyGrants(input.limit ?? 50)),
    creditGrant: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ grantId: z.string() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminCreditLoyaltyGrant({ grantId: input.grantId, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "loyalty_grant_credited", "loyalty_grant", input.grantId, { profilePhone: result.profilePhone, bonusAmount: result.bonusAmount });
      return result;
    }),
    cancelGrant: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ grantId: z.string(), reason: z.string().max(300) })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      await adminDb.adminCancelLoyaltyGrant({ grantId: input.grantId, reason: input.reason, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "loyalty_grant_cancelled", "loyalty_grant", input.grantId, { reason: input.reason });
      return { id: input.grantId };
    }),
  }),
});
