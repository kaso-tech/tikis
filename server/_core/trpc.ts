import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

const requireTikisProfile = t.middleware(async (opts) => {
  if (!opts.ctx.tikisProfilePhone) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Votre session Tikis a expiré. Connectez-vous de nouveau." });
  }
  return opts.next({ ctx: { ...opts.ctx, tikisProfilePhone: opts.ctx.tikisProfilePhone } });
});

export const tikisProtectedProcedure = t.procedure.use(requireTikisProfile);

const requireTikisAdmin = t.middleware(async (opts) => {
  if (!opts.ctx.tikisAdmin) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session d’administration Tikis invalide ou expirée." });
  }
  return opts.next({ ctx: { ...opts.ctx, tikisAdmin: opts.ctx.tikisAdmin } });
});

/** Procédure pour la console d'administration Tikis — distincte de `adminProcedure` (plateforme interne). */
export const tikisAdminProcedure = t.procedure.use(requireTikisAdmin);

export function requireTikisAdminRole(...roles: Array<"super_admin" | "support" | "finance">) {
  return t.middleware(async (opts) => {
    if (!opts.ctx.tikisAdmin || !roles.includes(opts.ctx.tikisAdmin.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Votre rôle d’administration ne permet pas cette action." });
    }
    return opts.next({ ctx: { ...opts.ctx, tikisAdmin: opts.ctx.tikisAdmin } });
  });
}

export const adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
