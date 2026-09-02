import { z } from "zod";
import { router, publicProcedure, tikisAdminProcedure, requireTikisAdminRole } from "./_core/trpc";
import { assertLoginAllowed, createAdminSession, recordLoginFailure, recordLoginSuccess, verifyAdminPassword } from "./admin-auth";
import * as adminDb from "./admin-db";
import * as db from "./db";

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
    search: tikisAdminProcedure.input(z.object({ query: z.string().min(2).max(120) })).query(({ input }) => adminDb.adminSearchProfiles(input)),
    detail: tikisAdminProcedure.input(z.object({ phone: z.string() })).query(async ({ ctx, input }) => {
      const detail = await adminDb.adminGetProfileDetail(input.phone);
      await audit(ctx, "profile_viewed", "profile", input.phone);
      return detail;
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
    list: tikisAdminProcedure.use(requireTikisAdminRole("super_admin")).input(z.object({ targetType: z.string().optional(), targetId: z.string().optional() })).query(({ input }) => adminDb.listAdminAuditLog(input)),
  }),
});
