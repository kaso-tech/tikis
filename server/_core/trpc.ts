import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getTikisProfileByPhone } from "../db";

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
  // Vérifié à chaque appel (pas seulement à la connexion) : une suspension/un bannissement décidé
  // par l'administration doit couper l'accès immédiatement, même si une session était déjà émise.
  const profile = await getTikisProfileByPhone(opts.ctx.tikisProfilePhone);
  if (!profile) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Profil introuvable. Connectez-vous de nouveau." });
  }
  if (profile.deletedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Ce compte a été supprimé." });
  }
  if (profile.status === "banned") {
    throw new TRPCError({ code: "FORBIDDEN", message: profile.statusReason ? `Compte banni : ${profile.statusReason}` : "Ce compte a été banni." });
  }
  if (profile.status === "suspended") {
    throw new TRPCError({ code: "FORBIDDEN", message: profile.statusReason ? `Compte suspendu : ${profile.statusReason}` : "Ce compte est temporairement suspendu." });
  }
  return opts.next({ ctx: { ...opts.ctx, tikisProfilePhone: opts.ctx.tikisProfilePhone } });
});

export const tikisProtectedProcedure = t.procedure.use(requireTikisProfile);

/** Vérifie uniquement la validité de la session (pas le statut actif/suspendu/banni) — réservé aux
 *  procédures qu'un compte banni/suspendu/en cours de suppression doit pouvoir appeler malgré tout
 *  (connaître son propre statut, annuler une suppression demandée). */
const requireTikisSessionOnly = t.middleware(async (opts) => {
  if (!opts.ctx.tikisProfilePhone) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Votre session Tikis a expiré. Connectez-vous de nouveau." });
  }
  return opts.next({ ctx: { ...opts.ctx, tikisProfilePhone: opts.ctx.tikisProfilePhone } });
});

export const tikisSessionProcedure = t.procedure.use(requireTikisSessionOnly);

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
