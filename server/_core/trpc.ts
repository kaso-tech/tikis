import { isAdminPathAllowed, type AdminRole } from "../../shared/admin-roles";
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getCachedTikisseProfile, invalidateTikisseProfileCache } from "./profile-cache";
import { isSessionRevoked } from "../sessions";

export { invalidateTikisseProfileCache };

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

const requireTikisseProfile = t.middleware(async (opts) => {
  if (!opts.ctx.tikisseProfilePhone) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Votre session Tikisse a expiré. Connectez-vous de nouveau." });
  }
  // Vérification révocation multi-device : si l'utilisateur a déconnecté cet appareil
  // depuis un autre device, on rejette immédiatement la requête.
  const sessionHeader = opts.ctx.req?.headers?.["x-tikisse-session"];
  const sessionToken = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
  if (sessionToken) {
    if (await isSessionRevoked({ phone: opts.ctx.tikisseProfilePhone, token: sessionToken })) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Cette session a été déconnectée depuis un autre appareil." });
    }
  }
  // Vérifié à chaque appel (pas seulement à la connexion) : une suspension/un bannissement décidé
  // par l'administration doit couper l'accès immédiatement, même si une session était déjà émise.
  // Cache LRU TTL 10s : on tolère 10s de latence entre une décision admin et sa prise d'effet
  // (cf. commentaire `invalidateTikisseProfileCache` à appeler après `setStatus` / `changeRole`).
  const profile = await getCachedTikisseProfile(opts.ctx.tikisseProfilePhone);
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
  return opts.next({ ctx: { ...opts.ctx, tikisseProfilePhone: opts.ctx.tikisseProfilePhone } });
});

export const tikisseProtectedProcedure = t.procedure.use(requireTikisseProfile);

/** Vérifie uniquement la validité de la session (pas le statut actif/suspendu/banni) — réservé aux
 *  procédures qu'un compte banni/suspendu/en cours de suppression doit pouvoir appeler malgré tout
 *  (connaître son propre statut, annuler une suppression demandée). */
const requireTikisseSessionOnly = t.middleware(async (opts) => {
  if (!opts.ctx.tikisseProfilePhone) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Votre session Tikisse a expiré. Connectez-vous de nouveau." });
  }
  return opts.next({ ctx: { ...opts.ctx, tikisseProfilePhone: opts.ctx.tikisseProfilePhone } });
});

export const tikisseSessionProcedure = t.procedure.use(requireTikisseSessionOnly);

const requireTikisseAdminSession = t.middleware(async (opts) => {
  if (!opts.ctx.tikisseAdmin) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session d’administration Tikisse invalide ou expirée." });
  }
  return opts.next({ ctx: { ...opts.ctx, tikisseAdmin: opts.ctx.tikisseAdmin } });
});

const requireTikisseAdmin = t.middleware(async (opts) => {
  if (!opts.ctx.tikisseAdmin) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session d’administration Tikisse invalide ou expirée." });
  }
  // Mot de passe provisoire, ou double authentification exigée et pas encore activée : seule la mise en
  // place du compte reste ouverte (`tikisseAdminEnrollmentProcedure`), rien d'autre de la console.
  if (opts.ctx.tikisseAdmin.mustChangePassword) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Choisissez votre mot de passe depuis « Mon compte » pour accéder à la console." });
  }
  if (opts.ctx.tikisseAdmin.mustEnrollTotp) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Activez la double authentification depuis « Mon compte » pour accéder à la console." });
  }
  // Rôles restreints (lecture seule, KYC seul) : encadrés ici pour toutes les procédures, y compris
  // celles ajoutées plus tard (shared/admin-roles.ts).
  if (!isAdminPathAllowed(opts.ctx.tikisseAdmin.role, opts.path, opts.type)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Votre rôle d’administration ne permet pas cette action." });
  }
  return opts.next({ ctx: { ...opts.ctx, tikisseAdmin: opts.ctx.tikisseAdmin } });
});

/** Procédure pour la console d'administration Tikisse — distincte de `adminProcedure` (plateforme interne). */
export const tikisseAdminProcedure = t.procedure.use(requireTikisseAdmin);

/** Session admin valide, même si le mot de passe provisoire ou l'enrôlement à la double authentification reste à faire. */
export const tikisseAdminEnrollmentProcedure = t.procedure.use(requireTikisseAdminSession);

export function requireTikisseAdminRole(...roles: AdminRole[]) {
  return t.middleware(async (opts) => {
    if (!opts.ctx.tikisseAdmin || !roles.includes(opts.ctx.tikisseAdmin.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Votre rôle d’administration ne permet pas cette action." });
    }
    return opts.next({ ctx: { ...opts.ctx, tikisseAdmin: opts.ctx.tikisseAdmin } });
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
