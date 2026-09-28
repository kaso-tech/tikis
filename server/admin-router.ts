import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, publicProcedure, tikisAdminProcedure, tikisAdminEnrollmentProcedure, requireTikisAdminRole, invalidateTikisProfileCache } from "./_core/trpc";
import { clientIp } from "./_core/security";
import { verifyAdminPasswordOrDecoy } from "./admin-auth";
import { clearAdminSessionCookie, setAdminSessionCookie } from "./_core/cookies";
import { pickAdminSessionToken } from "./_core/context";
import * as adminDb from "./admin-db";
import * as financeControl from "./admin-finance-control";
import * as accounts from "./admin-accounts";
import * as approvals from "./admin-approvals";
import { ADMIN_ROLES } from "../shared/admin-roles";
import { replayYengapayWebhookEvent } from "./yengapay-webhook";
import * as db from "./db";
import { publishDeliveryStatusBroadcast } from "./supabase-realtime";

/**
 * Détail d'une action, écrit après qu'elle a réussi. Ne fait jamais échouer la requête : l'action est faite,
 * et la trace de la demande existe déjà (`adminProcedure`). Faire croire à l'admin qu'une action réussie a
 * échoué l'inciterait à la relancer.
 */
async function audit(ctx: { tikisAdmin?: { adminId: number; email: string } | null; req: { ip?: string; socket?: { remoteAddress?: string } } }, action: string, targetType: string, targetId: string, details?: unknown) {
  if (!ctx.tikisAdmin) return;
  try {
    await adminDb.writeAdminAuditLog({ adminId: ctx.tikisAdmin.adminId, adminEmail: ctx.tikisAdmin.email, action, targetType, targetId, details, ipAddress: clientIp(ctx.req) });
  } catch (cause) {
    console.error("[admin-audit] détail non enregistré après une action réussie", { action, targetType, targetId }, cause);
  }
}

const SENSITIVE_INPUT_KEY = /password|code|token|secret/i;

/** Copie de l'entrée d'une requête, sans mot de passe, code ni jeton, bornée en profondeur. */
export function auditableInput(value: unknown, depth = 0): unknown {
  if (depth > 4) return "…";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => auditableInput(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE_INPUT_KEY.test(key) ? "[masqué]" : auditableInput(item, depth + 1)]));
  }
  return value;
}

/**
 * Toute modification demandée depuis la console est inscrite au journal AVANT d'être exécutée ; si
 * l'inscription échoue, la modification est refusée. Aucune action ne peut donc avoir lieu sans trace,
 * même si le détail écrit après coup (`audit`) venait à manquer. Les tentatives refusées faute de droits
 * sont tracées aussi.
 */
const adminProcedure = tikisAdminProcedure.use(async ({ ctx, type, path, getRawInput, next }) => {
  if (type !== "mutation") return next();
  try {
    await adminDb.writeAdminAuditLog({
      adminId: ctx.tikisAdmin.adminId, adminEmail: ctx.tikisAdmin.email, action: path.slice(0, 80),
      targetType: "admin_request", targetId: path.slice(0, 80), details: auditableInput(await getRawInput()), ipAddress: clientIp(ctx.req),
    });
  } catch (cause) {
    console.error("[admin-audit] demande non tracée : refusée", path, cause);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Le journal d’audit est indisponible : action refusée par précaution. Réessayez dans un instant." });
  }
  return next();
});

function requestUserAgent(req: { headers: Record<string, string | string[] | undefined> }) {
  const value = req.headers["user-agent"];
  return Array.isArray(value) ? value[0] : value;
}

const AUDIT_EXPORT_MAX_ROWS = 10_000;

const auditLogFilterSchema = z.object({
  includeRequests: z.boolean().optional(),
  targetType: z.string().max(40).optional(),
  targetId: z.string().max(80).optional(),
  adminEmail: z.string().max(180).optional(),
  action: z.string().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function auditLogFilter(input: z.infer<typeof auditLogFilterSchema>): adminDb.AuditLogFilter {
  return { ...input, from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined };
}

export const tikisAdminRouter = router({
  auth: router({
    login: publicProcedure.input(z.object({ email: z.string().email().max(180), password: z.string().min(1).max(200) })).mutation(async ({ input, ctx }) => {
      const ip = clientIp(ctx.req);
      await adminDb.assertAdminLoginAllowed(input.email, ip);
      const admin = await adminDb.getAdminByEmail(input.email);
      // Même calcul scrypt que l'email existe ou non : le temps de réponse ne révèle plus les comptes.
      const valid = await verifyAdminPasswordOrDecoy(input.password, admin?.passwordHash);
      if (!admin || !valid || !admin.active) {
        await adminDb.recordAdminLoginFailure(input.email, ip);
        throw new Error("Identifiants invalides.");
      }
      await adminDb.recordAdminLoginSuccess(input.email, ip);
      const userAgent = requestUserAgent(ctx.req);
      if (admin.totpEnabledAt) {
        // Mot de passe correct, mais ce n'est que la moitié : une session « en attente » de 5 minutes, qui
        // n'ouvre rien d'autre que la saisie du code (auth.verifyTotp).
        const pending = await adminDb.createAdminSession({ adminId: admin.id, ipAddress: ip, userAgent, stage: "pending_totp" });
        setAdminSessionCookie(ctx.res, ctx.req, pending.token, pending.expiresAt);
        return { status: "totp_required" as const };
      }
      await adminDb.touchAdminLastLogin(admin.id);
      const session = await adminDb.createAdminSession({ adminId: admin.id, ipAddress: ip, userAgent });
      await adminDb.writeAdminAuditLog({ adminId: admin.id, adminEmail: admin.email, action: "login", targetType: "admin_session", targetId: String(admin.id), ipAddress: ip });
      // Le jeton ne quitte le serveur que dans un cookie httpOnly : aucun script de la page ne le voit.
      setAdminSessionCookie(ctx.res, ctx.req, session.token, session.expiresAt);
      return { status: "ok" as const, admin: { id: admin.id, email: admin.email, fullName: admin.fullName, role: admin.role } };
    }),
    verifyTotp: publicProcedure.input(z.object({ code: z.string().trim().min(6).max(20) })).mutation(async ({ input, ctx }) => {
      const ip = clientIp(ctx.req);
      const result = await adminDb.completeTotpLogin({ token: pickAdminSessionToken(ctx), code: input.code, ipAddress: ip, userAgent: requestUserAgent(ctx.req) });
      setAdminSessionCookie(ctx.res, ctx.req, result.session.token, result.session.expiresAt);
      await adminDb.writeAdminAuditLog({ adminId: result.admin.id, adminEmail: result.admin.email, action: result.factor.method === "recovery_code" ? "login_recovery_code" : "login", targetType: "admin_session", targetId: String(result.admin.id), details: result.factor.method === "recovery_code" ? { remainingRecoveryCodes: result.factor.remainingRecoveryCodes } : { secondFactor: "totp" }, ipAddress: ip });
      return { status: "ok" as const, admin: result.admin, remainingRecoveryCodes: result.factor.method === "recovery_code" ? result.factor.remainingRecoveryCodes : undefined };
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await adminDb.revokeAdminSession(pickAdminSessionToken(ctx));
      clearAdminSessionCookie(ctx.res, ctx.req);
      await audit(ctx, "logout", "admin_session", String(ctx.tikisAdmin?.adminId ?? ""));
      return { success: true } as const;
    }),
    // Public : la console l'appelle au chargement pour savoir si une session existe (le cookie httpOnly
    // n'est pas lisible par la page). Sans session, `null` plutôt qu'une erreur.
    me: publicProcedure.query(({ ctx }) => ctx.tikisAdmin ?? null),
    // Mise en place du compte : accessible même avec un mot de passe provisoire ou une double
    // authentification exigée et pas encore faite.
    changePassword: tikisAdminEnrollmentProcedure.input(z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) })).mutation(async ({ ctx, input }) => {
      await accounts.changeOwnAdminPassword({ adminId: ctx.tikisAdmin.adminId, sessionId: ctx.tikisAdmin.sessionId, currentPassword: input.currentPassword, newPassword: input.newPassword });
      await audit(ctx, "password_changed", "admin_user", String(ctx.tikisAdmin.adminId));
      return { success: true } as const;
    }),
    sessions: router({
      list: adminProcedure.query(async ({ ctx }) => (await accounts.listAdminSessions(ctx.tikisAdmin.adminId)).map((session) => ({ ...session, current: session.id === ctx.tikisAdmin.sessionId }))),
      revoke: adminProcedure.input(z.object({ sessionId: z.string().min(1).max(40) })).mutation(async ({ ctx, input }) => {
        await accounts.revokeAdminSessionById({ sessionId: input.sessionId, ownerAdminId: ctx.tikisAdmin.adminId });
        await audit(ctx, "admin_session_revoked", "admin_session", input.sessionId, { own: true });
        return { success: true } as const;
      }),
    }),
    // Enrôlement accessible même quand la double authentification est exigée et pas encore faite.
    totp: router({
      begin: tikisAdminEnrollmentProcedure.mutation(async ({ ctx }) => adminDb.beginTotpEnrollment({ adminId: ctx.tikisAdmin.adminId, email: ctx.tikisAdmin.email })),
      confirm: tikisAdminEnrollmentProcedure.input(z.object({ code: z.string().trim().min(6).max(10) })).mutation(async ({ ctx, input }) => {
        const result = await adminDb.confirmTotpEnrollment({ adminId: ctx.tikisAdmin.adminId, code: input.code });
        await audit(ctx, "totp_enabled", "admin_user", String(ctx.tikisAdmin.adminId));
        return result;
      }),
      regenerateRecoveryCodes: adminProcedure.input(z.object({ code: z.string().trim().min(6).max(20) })).mutation(async ({ ctx, input }) => {
        const result = await accounts.regenerateRecoveryCodes({ adminId: ctx.tikisAdmin.adminId, code: input.code });
        await audit(ctx, "totp_recovery_codes_regenerated", "admin_user", String(ctx.tikisAdmin.adminId));
        return result;
      }),
      disable: adminProcedure.input(z.object({ code: z.string().trim().min(6).max(20) })).mutation(async ({ ctx, input }) => {
        await adminDb.disableOwnTotp({ adminId: ctx.tikisAdmin.adminId, role: ctx.tikisAdmin.role, code: input.code });
        await audit(ctx, "totp_disabled", "admin_user", String(ctx.tikisAdmin.adminId));
        return { success: true } as const;
      }),
    }),
  }),

  dashboard: router({
    metrics: adminProcedure.input(z.object({ periodDays: z.number().int().min(1).max(365).default(30) })).query(({ input }) => adminDb.adminDashboardMetrics(input.periodDays)),
  }),

  commission: router({
    get: adminProcedure.query(() => db.getTikisCommissionRate()),
    update: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ rate: z.number().min(0.001).max(0.9) })).mutation(async ({ ctx, input }) => {
      const before = await db.getTikisCommissionRate().catch(() => null);
      const result = await adminDb.adminUpdateCommissionRate(input.rate);
      await audit(ctx, "commission_rate_updated", "platform_settings", "commissionRate", { before, after: input.rate });
      return result;
    }),
  }),

  reports: router({
    list: adminProcedure.input(z.object({ status: z.enum(["open", "reviewing", "resolved", "dismissed"]).optional() })).query(({ input }) => adminDb.listDeliveryReports({ status: input.status })),
    resolve: adminProcedure.use(requireTikisAdminRole("super_admin", "support")).input(z.object({ reportId: z.string(), status: z.enum(["reviewing", "resolved", "dismissed"]), resolutionNotes: z.string().max(1000).optional(), replyToReporter: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const { report, previousStatus } = await adminDb.resolveDeliveryReport({ reportId: input.reportId, status: input.status, resolutionNotes: input.resolutionNotes, replyToReporter: input.replyToReporter, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "report_resolved", "delivery_report", input.reportId, { before: previousStatus, after: input.status, notes: input.resolutionNotes, replyToReporter: input.replyToReporter });
      return report;
    }),
  }),

  disputes: router({
    searchDeliveries: adminProcedure.input(z.object({ query: z.string().max(120).optional(), status: z.string().optional() })).query(({ input }) => adminDb.adminSearchDeliveries(input)),
    timeline: adminProcedure.input(z.object({ deliveryId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const timeline = await adminDb.adminGetDeliveryTimeline(input.deliveryId);
      await audit(ctx, "delivery_timeline_viewed", "delivery", input.deliveryId);
      return timeline;
    }),
  }),

  users: router({
    search: adminProcedure.input(z.object({
      query: z.string().trim().min(2).max(120).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(10_000).optional(),
    })).query(async ({ input }) => {
      const result = await adminDb.adminSearchProfiles({ query: input.query, limit: input.limit ?? 25, offset: input.offset ?? 0 });
      return { rows: result.rows, total: result.total, limit: input.limit ?? 25, offset: input.offset ?? 0 };
    }),
    detail: adminProcedure.input(z.object({ phone: z.string() })).query(async ({ ctx, input }) => {
      const detail = await adminDb.adminGetProfileDetail(input.phone);
      await audit(ctx, "profile_viewed", "profile", input.phone);
      return detail;
    }),
    setStatus: adminProcedure.use(requireTikisAdminRole("super_admin", "support")).input(z.object({ phone: z.string(), status: z.enum(["active", "suspended", "banned"]), reason: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const before = (await db.getTikisProfileByPhone(input.phone))?.status ?? null;
      const result = await adminDb.adminSetProfileStatus({ phone: input.phone, status: input.status, reason: input.reason, adminId: ctx.tikisAdmin.adminId });
      invalidateTikisProfileCache(input.phone);
      await audit(ctx, "profile_status_changed", "profile", input.phone, { before, after: input.status, reason: input.reason, releasedCandidacies: result.releasedCandidacies, engagements: result.engagements.map((engagement) => engagement.deliveryId) });
      return result;
    }),
    changeRole: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ phone: z.string(), role: z.enum(["sender", "driver"]) })).mutation(async ({ ctx, input }) => {
      const before = (await db.getTikisProfileByPhone(input.phone))?.accountType ?? null;
      const result = await adminDb.adminChangeProfileRole(input);
      invalidateTikisProfileCache(input.phone);
      await audit(ctx, "profile_role_changed", "profile", input.phone, { before, after: input.role });
      return result;
    }),
    reward: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ phone: z.string(), amount: z.number().int().positive(), reason: z.string().max(300), requestId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      if (await approvals.requiresApproval(input.amount)) {
        const request = await approvals.requestWalletAdjustment({ adminId: ctx.tikisAdmin.adminId, email: ctx.tikisAdmin.email }, { ...input, direction: "bonus" });
        await audit(ctx, "approval_requested", "admin_approval", request.approvalId, { action: "wallet_bonus", phone: input.phone, amount: input.amount, reason: input.reason });
        return request;
      }
      const result = await adminDb.adminRewardWallet({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "wallet_bonus_credited", "profile", input.phone, { amount: input.amount, reason: input.reason });
      return result;
    }),
    penalize: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ phone: z.string(), amount: z.number().int().positive(), reason: z.string().max(300), requestId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      if (await approvals.requiresApproval(input.amount)) {
        const request = await approvals.requestWalletAdjustment({ adminId: ctx.tikisAdmin.adminId, email: ctx.tikisAdmin.email }, { ...input, direction: "penalty" });
        await audit(ctx, "approval_requested", "admin_approval", request.approvalId, { action: "wallet_penalty", phone: input.phone, amount: input.amount, reason: input.reason });
        return request;
      }
      const result = await adminDb.adminPenalizeWallet({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "wallet_penalty_applied", "profile", input.phone, { amount: input.amount, reason: input.reason });
      return result;
    }),
  }),

  deliveriesOps: router({
    list: adminProcedure.input(z.object({
      query: z.string().max(120).optional(),
      status: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })).query(({ input }) => adminDb.adminListDeliveries({ ...input, from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined })),
    forceCancel: adminProcedure.use(requireTikisAdminRole("super_admin", "support")).input(z.object({ deliveryId: z.string().uuid(), reason: z.string().max(500) })).mutation(async ({ ctx, input }) => {
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
    // Positions GPS en direct des livreurs : utiles au support pour suivre une course, pas à la finance.
    liveLocations: adminProcedure.use(requireTikisAdminRole("super_admin", "support")).input(z.object({
      maxAgeSeconds: z.number().int().min(10).max(3600).default(120),
    })).query(({ input }) => adminDb.adminListLiveLocations(input)),
  }),

  referrals: router({
    list: adminProcedure.input(z.object({ status: z.enum(["invited", "qualified", "rewarded", "voided"]).optional() })).query(({ input }) => adminDb.adminListReferrals(input)),
    reward: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ referralId: z.string() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminRewardReferral({ referralId: input.referralId, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "referral_rewarded", "referral", input.referralId);
      return result;
    }),
    settings: router({
      get: adminProcedure.query(() => adminDb.adminGetReferralSettings()),
      update: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ rewardAmount: z.number().int().min(0).max(100000), enabled: z.boolean(), requiredDeliveries: z.number().int().min(1).max(100) })).mutation(async ({ ctx, input }) => {
        const before = await adminDb.adminGetReferralSettings().catch(() => null);
        const result = await adminDb.adminUpdateReferralSettings(input);
        await audit(ctx, "referral_settings_updated", "platform_settings", "referral", { before, after: input });
        return result;
      }),
    }),
  }),

  finance: router({
    settings: router({
      get: adminProcedure.query(() => adminDb.adminGetFinanceSettings()),
      update: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ minWithdrawal: z.number().int().min(0), maxWithdrawal: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        const previous = await adminDb.adminGetFinanceSettings().catch(() => null);
        const result = await adminDb.adminUpdateFinanceSettings(input);
        await audit(ctx, "finance_settings_updated", "platform_settings", "withdrawal_limits", { before: previous ? { minWithdrawal: previous.minWithdrawal, maxWithdrawal: previous.maxWithdrawal } : null, after: input });
        return result;
      }),
    }),
    transactions: adminProcedure.input(z.object({
      type: z.enum(["deposit", "withdrawal"]).optional(),
      status: z.enum(["pending", "succeeded", "failed", "cancelled", "expired"]).optional(),
      query: z.string().trim().max(80).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
    })).query(({ input }) => adminDb.adminListPaymentTransactions(input)),
    settleTransaction: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ paymentId: z.string(), outcome: z.enum(["succeeded", "failed"]), notes: z.string().max(300).optional(), payoutReference: z.string().max(80).optional() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      // Valider un retrait au-delà du seuil attend un second admin. Le rejet, lui, ne sort aucun argent.
      if (input.outcome === "succeeded") {
        const payment = await adminDb.adminGetPaymentTransaction(input.paymentId);
        if (payment?.type === "withdrawal" && await approvals.requiresApproval(payment.amount)) {
          const request = await approvals.requestWithdrawalSettlement({ adminId: ctx.tikisAdmin.adminId, email: ctx.tikisAdmin.email }, { paymentId: input.paymentId, payoutReference: input.payoutReference ?? "", notes: input.notes ?? "" });
          await audit(ctx, "approval_requested", "admin_approval", request.approvalId, { action: "withdrawal_settle", paymentId: input.paymentId, amount: payment.amount, payoutReference: input.payoutReference });
          return request;
        }
      }
      const result = await db.adminSettlePaymentTransaction({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "payment_transaction_settled", "payment_transaction", input.paymentId, { outcome: input.outcome, notes: input.notes, payoutReference: input.payoutReference });
      return result;
    }),
    // Réconciliation YengaPay : interroge le PSP pour connaître l'état réel d'une transaction
    // dont le webhook a échoué (503 YengaPay, signature invalide transitoire, timeout réseau,
    // DB temporairement indisponible au moment du settle). Le mode test renvoie une erreur —
    // il n'y a rien à réconcilier puisque aucun PSP n'est appelé. Réservé super_admin/finance.
    reconcileYengapayPayment: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ providerReference: z.string().min(8).max(80) })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await db.reconcileYengapayPayment(input.providerReference);
      await audit(ctx, "yengapay_payment_reconciled", "payment_transaction", input.providerReference, { result });
      return result;
    }),
    // Contrôle financier (server/admin-finance-control.ts) : réservé à qui répond de l'argent.
    control: router({
      webhooks: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({
        status: z.enum(["received", "processed", "failed", "ignored"]).optional(),
        query: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).max(100_000).optional(),
      })).query(({ input }) => financeControl.adminListWebhookEvents(input)),
      replayWebhook: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ eventId: z.string().min(1).max(40) })).mutation(async ({ ctx, input }) => {
        const before = (await db.getYengapayWebhookEvent(input.eventId))?.status ?? null;
        const result = await replayYengapayWebhookEvent(input.eventId);
        await audit(ctx, "yengapay_webhook_replayed", "yengapay_webhook_event", input.eventId, { before, after: result.status, failureReason: result.failureReason });
        return result;
      }),
      anomalies: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).query(() => financeControl.adminPaymentAnomalies()),
      walletCheck: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).query(() => financeControl.adminWalletCheck()),
      accounting: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })).query(async ({ ctx, input }) => {
        const statement = await financeControl.adminAccountingMonth(input.month);
        // Données financières de tous les utilisateurs : chaque consultation ou export est tracé.
        await audit(ctx, "accounting_statement_viewed", "accounting", input.month, { movements: statement.rows.length, truncated: statement.truncated });
        return statement;
      }),
    }),
    sendBonus: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ phone: z.string(), amount: z.number().int().positive().max(1000000), reason: z.string().max(300), requestId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      if (await approvals.requiresApproval(input.amount)) {
        const request = await approvals.requestWalletAdjustment({ adminId: ctx.tikisAdmin.adminId, email: ctx.tikisAdmin.email }, { ...input, direction: "bonus" });
        await audit(ctx, "approval_requested", "admin_approval", request.approvalId, { action: "wallet_bonus", phone: input.phone, amount: input.amount, reason: input.reason });
        return request;
      }
      const result = await adminDb.adminRewardWallet({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "wallet_bonus_credited", "profile", input.phone, { amount: input.amount, reason: input.reason });
      return result;
    }),
  }),

  pricing: router({
    get: adminProcedure.query(() => adminDb.adminGetPricingConfig()),
    update: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({
      vehicles: z.record(z.string(), z.object({ minimum: z.number().min(0).max(100000), perKm: z.number().min(0).max(10000) })),
      typeAdjustment: z.object({ plis: z.number().min(0).max(100000), personnePerPassenger: z.number().min(0).max(100000) }),
      cargo: z.object({ base: z.number().min(0).max(100000), perKg: z.number().min(0).max(100000), perKgCap: z.number().min(0).max(100000), perM3: z.number().min(0).max(100000), perM3Cap: z.number().min(0).max(100000) }),
    })).mutation(async ({ ctx, input }) => {
      const before = await adminDb.adminGetPricingConfig().catch(() => null);
      const result = await adminDb.adminUpdatePricingConfig(input);
      await audit(ctx, "pricing_config_updated", "platform_settings", "pricing", { before, after: input });
      return result;
    }),
  }),

  countries: router({
    list: adminProcedure.query(() => adminDb.adminListCountries()),
    upsert: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({
      id: z.string().length(2), name: z.string().min(2).max(80), dialCode: z.string().min(2).max(6),
      digits: z.number().int().min(4).max(15), groups: z.array(z.number().int().positive()).min(1),
      timeZones: z.array(z.string().min(1)).min(1), enabled: z.boolean(), sortOrder: z.number().int().default(0),
    })).mutation(async ({ ctx, input }) => {
      const before = (await adminDb.adminListCountries()).find((country) => country.id === input.id) ?? null;
      const result = await adminDb.adminUpsertCountry(input);
      await audit(ctx, "country_upserted", "platform_settings", input.id, { before, after: input });
      return result;
    }),
    setEnabled: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ id: z.string().length(2), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      const before = (await adminDb.adminListCountries()).find((country) => country.id === input.id)?.enabled ?? null;
      const result = await adminDb.adminSetCountryEnabled(input.id, input.enabled);
      await audit(ctx, "country_enabled_changed", "platform_settings", input.id, { before, after: input.enabled });
      return result;
    }),
  }),

  maintenance: router({
    get: adminProcedure.query(() => db.getMaintenanceStatus()),
    set: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ enabled: z.boolean(), message: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
      const before = await db.getMaintenanceStatus().catch(() => null);
      const result = await adminDb.adminSetMaintenance(input);
      await audit(ctx, "maintenance_mode_changed", "platform_settings", "maintenance", { before, after: input });
      return result;
    }),
  }),

  accountDeletions: router({
    list: adminProcedure.query(() => adminDb.adminListPendingDeletions()),
  }),

  kyc: router({
    list: adminProcedure.input(z.object({ status: z.enum(["submitted", "approved", "rejected"]).optional() })).query(({ input }) => adminDb.adminListKycSubmissions(input.status)),
    review: adminProcedure.use(requireTikisAdminRole("super_admin", "support", "kyc_reviewer")).input(z.object({ submissionId: z.string(), decision: z.enum(["approved", "rejected"]), rejectionReason: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminReviewKyc({ ...input, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "kyc_reviewed", "kyc_submission", input.submissionId, { decision: input.decision, rejectionReason: input.rejectionReason });
      return result;
    }),
  }),

  admins: router({
    list: adminProcedure.use(requireTikisAdminRole("super_admin")).query(() => adminDb.listAdminUsers()),
    create: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ email: z.string().trim().email().max(180), fullName: z.string().trim().min(2).max(120), role: z.enum(ADMIN_ROLES) })).mutation(async ({ ctx, input }) => {
      const result = await accounts.createAdminAccount(input);
      await audit(ctx, "admin_created", "admin_user", String(result.adminId), { email: result.email, role: input.role });
      // Le mot de passe provisoire n'est rendu qu'ici, une fois : il n'est ni journalisé ni stocké en clair.
      return result;
    }),
    changeRole: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ adminId: z.number().int(), role: z.enum(ADMIN_ROLES) })).mutation(async ({ ctx, input }) => {
      const result = await accounts.changeAdminRole({ actorAdminId: ctx.tikisAdmin.adminId, adminId: input.adminId, role: input.role });
      await audit(ctx, "admin_role_changed", "admin_user", String(input.adminId), result);
      return result;
    }),
    resetPassword: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ adminId: z.number().int() })).mutation(async ({ ctx, input }) => {
      const result = await accounts.resetAdminPassword({ actorAdminId: ctx.tikisAdmin.adminId, adminId: input.adminId });
      await audit(ctx, "admin_password_reset", "admin_user", String(input.adminId));
      return result;
    }),
    sessions: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ adminId: z.number().int() })).query(({ input }) => accounts.listAdminSessions(input.adminId)),
    revokeSession: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ sessionId: z.string().min(1).max(40) })).mutation(async ({ ctx, input }) => {
      const { adminId } = await accounts.revokeAdminSessionById({ sessionId: input.sessionId });
      await audit(ctx, "admin_session_revoked", "admin_session", input.sessionId, { adminId });
      return { success: true } as const;
    }),
    setActive: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ adminId: z.number().int(), active: z.boolean() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      await adminDb.setAdminUserActive({ actorAdminId: ctx.tikisAdmin.adminId, adminId: input.adminId, active: input.active });
      await audit(ctx, input.active ? "admin_reactivated" : "admin_suspended", "admin_user", String(input.adminId));
      return { success: true } as const;
    }),
  }),

  security: router({
    get: adminProcedure.use(requireTikisAdminRole("super_admin")).query(async () => ({ totpRequired: await adminDb.isAdminTotpRequired(), totpRequiredRoles: adminDb.TOTP_REQUIRED_ROLES })),
    setTotpRequired: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ required: z.boolean() })).mutation(async ({ ctx, input }) => {
      const before = await adminDb.isAdminTotpRequired();
      const result = await adminDb.setAdminTotpRequired({ actorAdminId: ctx.tikisAdmin.adminId, required: input.required });
      await audit(ctx, "totp_policy_changed", "platform_settings", "adminTotpRequired", { before, after: input.required });
      return result;
    }),
    resetTotp: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ adminId: z.number().int() })).mutation(async ({ ctx, input }) => {
      await adminDb.resetAdminTotp({ actorAdminId: ctx.tikisAdmin.adminId, adminId: input.adminId });
      await audit(ctx, "totp_reset", "admin_user", String(input.adminId));
      return { success: true } as const;
    }),
  }),

  approvals: router({
    list: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ status: z.enum(["open", "closed"]).optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).max(100_000).optional() })).query(({ input }) => approvals.listApprovals(input)),
    approve: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ approvalId: z.string().min(1).max(40) })).mutation(async ({ ctx, input }) => {
      const result = await approvals.approveRequest({ approvalId: input.approvalId, approver: { adminId: ctx.tikisAdmin.adminId, email: ctx.tikisAdmin.email } });
      await audit(ctx, result.status === "executed" ? "approval_executed" : "approval_failed", "admin_approval", input.approvalId, {
        action: result.approval.action, amount: result.approval.amount, targetPhone: result.approval.targetPhone, requestedBy: result.approval.requestedByEmail,
        ...(result.status === "failed" ? { failureReason: result.failureReason } : {}),
      });
      return { status: result.status, failureReason: result.status === "failed" ? result.failureReason : null };
    }),
    close: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ approvalId: z.string().min(1).max(40), note: z.string().max(300).optional() })).mutation(async ({ ctx, input }) => {
      const result = await approvals.closeRequest({ approvalId: input.approvalId, admin: { adminId: ctx.tikisAdmin.adminId, email: ctx.tikisAdmin.email }, note: input.note });
      await audit(ctx, result.status === "cancelled" ? "approval_cancelled" : "approval_rejected", "admin_approval", input.approvalId, { action: result.approval.action, amount: result.approval.amount, note: input.note });
      return { status: result.status };
    }),
    threshold: router({
      get: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).query(async () => ({ threshold: await approvals.getApprovalThreshold() })),
      set: adminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ threshold: z.number().int().min(approvals.MIN_APPROVAL_THRESHOLD).max(100_000_000) })).mutation(async ({ ctx, input }) => {
        const before = await approvals.getApprovalThreshold();
        const result = await approvals.setApprovalThreshold(input.threshold);
        await audit(ctx, "approval_threshold_changed", "platform_settings", "adminApprovalThreshold", { before, after: input.threshold });
        return result;
      }),
    }),
  }),

  auditLog: router({
    list: adminProcedure.use(requireTikisAdminRole("super_admin")).input(auditLogFilterSchema.extend({ limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).max(100_000).optional() })).query(async ({ input }) => {
      const result = await adminDb.listAdminAuditLog({ ...auditLogFilter(input), limit: input.limit ?? 50, offset: input.offset ?? 0 });
      return { rows: result.rows, total: result.total, limit: input.limit ?? 50, offset: input.offset ?? 0 };
    }),
    // Export du journal filtré (10 000 lignes au plus). L'export lui-même est tracé.
    export: adminProcedure.use(requireTikisAdminRole("super_admin")).input(auditLogFilterSchema).query(async ({ ctx, input }) => {
      const result = await adminDb.listAdminAuditLog({ ...auditLogFilter(input), limit: AUDIT_EXPORT_MAX_ROWS, offset: 0 }, AUDIT_EXPORT_MAX_ROWS);
      await audit(ctx, "audit_log_exported", "admin_audit_log", "export", { filter: input, rows: result.rows.length, total: result.total });
      return { rows: result.rows, total: result.total, truncated: result.total > result.rows.length };
    }),
  }),

  loyalty: router({
    listPrograms: adminProcedure.query(() => adminDb.adminListLoyaltyPrograms()),
    upsertProgram: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({
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
      const previous = input.id ? (await adminDb.adminListLoyaltyPrograms()).find((program) => program.id === input.id) ?? null : null;
      const result = await adminDb.adminUpsertLoyaltyProgram({ ...input, adminId: ctx.tikisAdmin.adminId });
      const loyaltyFields = (program: { name: string; role: string; requiredDeliveries: number; bonusAmount: number; enabled: boolean; autoCredit?: boolean | null; autoCreditMaxAmount?: number | null }) => ({ name: program.name, role: program.role, requiredDeliveries: program.requiredDeliveries, bonusAmount: program.bonusAmount, enabled: program.enabled, autoCredit: program.autoCredit, autoCreditMaxAmount: program.autoCreditMaxAmount });
      await audit(ctx, "loyalty_program_upserted", "loyalty_program", result.id, { before: previous ? loyaltyFields(previous) : null, after: loyaltyFields(input) });
      return result;
    }),
    setProgramEnabled: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ id: z.string(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const before = (await adminDb.adminListLoyaltyPrograms()).find((program) => program.id === input.id)?.enabled ?? null;
      await adminDb.adminSetLoyaltyProgramEnabled(input);
      await audit(ctx, "loyalty_program_toggled", "loyalty_program", input.id, { before, after: input.enabled });
      return { id: input.id, enabled: input.enabled };
    }),
    listPendingGrants: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(200).optional() })).query(({ input }) => adminDb.adminListPendingLoyaltyGrants(input.limit ?? 50)),
    creditGrant: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ grantId: z.string() })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      const result = await adminDb.adminCreditLoyaltyGrant({ grantId: input.grantId, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "loyalty_grant_credited", "loyalty_grant", input.grantId, { profilePhone: result.profilePhone, bonusAmount: result.bonusAmount });
      return result;
    }),
    cancelGrant: adminProcedure.use(requireTikisAdminRole("super_admin", "finance")).input(z.object({ grantId: z.string(), reason: z.string().max(300) })).mutation(async ({ ctx, input }) => {
      if (!ctx.tikisAdmin) throw new Error("Session invalide.");
      await adminDb.adminCancelLoyaltyGrant({ grantId: input.grantId, reason: input.reason, adminId: ctx.tikisAdmin.adminId });
      await audit(ctx, "loyalty_grant_cancelled", "loyalty_grant", input.grantId, { reason: input.reason });
      return { id: input.grantId };
    }),
  }),
});
