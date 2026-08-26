import { z } from "zod";
import { COOKIE_NAME } from "../shared/const";
import * as db from "./db";
import { storagePut } from "./storage";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Numéro de téléphone international invalide.");
const simulationOtpSchema = z.literal("730512", { error: "Code OTP de simulation invalide." });
const fullNameSchema = z.string().trim().min(3).max(70).regex(/^[\p{L}]+(?:[ '-][\p{L}]+)+(?:[ '-][\p{L}]+)*$/u, "Nom complet invalide.");
const vehicleSchema = z.enum(["Vélo", "Moto", "Tricycle", "Voiture", "Fourgonnette"]);
type ValidVehicle = z.infer<typeof vehicleSchema>;
const profileFieldsSchema = z.object({
  phone: phoneSchema,
  fullName: fullNameSchema,
  role: z.enum(["sender", "driver"]),
  vehicles: z.array(vehicleSchema).max(5),
});

function validateProfileRole(value: z.infer<typeof profileFieldsSchema>, ctx: z.RefinementCtx) {
  if (value.role === "driver" && value.vehicles.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vehicles"], message: "Au moins un engin est requis pour un livreur." });
  if (value.role === "sender" && value.vehicles.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vehicles"], message: "Un expéditeur ne renseigne pas d’engin." });
}

const profileInputSchema = profileFieldsSchema.superRefine(validateProfileRole);
const registrationInputSchema = profileFieldsSchema.extend({ otp: simulationOtpSchema }).superRefine(validateProfileRole);

function toPublicProfile(profile: { phone: string; fullName: string; accountType: "sender" | "driver"; vehicles: string; photoKey?: string | null }) {
  let vehicles: ValidVehicle[] = [];
  try {
    const parsed = JSON.parse(profile.vehicles) as unknown;
    if (Array.isArray(parsed)) vehicles = parsed.filter((item): item is ValidVehicle => vehicleSchema.safeParse(item).success);
  } catch { vehicles = []; }
  return { phone: profile.phone, fullName: profile.fullName, role: profile.accountType, vehicles, roleLocked: true as const, photoUrl: profile.photoKey ? `/manus-storage/${profile.photoKey}` : undefined };
}

const photoMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
const base64ImageSchema = z.string().min(32).max(1_600_000).regex(/^[A-Za-z0-9+/=]+$/, "Données d’image invalides.");

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  profiles: router({
    /** Called after local OTP verification in the simulation flow. A production build must verify OTP server-side before this query. */
    lookup: publicProcedure.input(z.object({ phone: phoneSchema, otp: simulationOtpSchema })).mutation(async ({ input }) => {
      const profile = await db.getTikisProfileByPhone(input.phone);
      return profile ? toPublicProfile(profile) : null;
    }),
    register: publicProcedure.input(registrationInputSchema).mutation(async ({ input }) => {
      const profile = await db.createTikisProfile({
        phone: input.phone,
        fullName: input.fullName,
        accountType: input.role,
        vehicles: JSON.stringify(input.role === "driver" ? input.vehicles : []),
      });
      return toPublicProfile(profile);
    }),
    update: publicProcedure.input(z.object({ phone: phoneSchema, otp: simulationOtpSchema, fullName: fullNameSchema.optional(), photoBase64: base64ImageSchema.optional(), photoMime: photoMimeSchema.optional() }).superRefine((value, ctx) => {
      if (!value.fullName && !value.photoBase64) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Aucune modification à enregistrer." });
      if (value.photoBase64 && !value.photoMime) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["photoMime"], message: "Type d’image requis." });
    })).mutation(async ({ input }) => {
      let photoKey: string | null | undefined;
      if (input.photoBase64 && input.photoMime) {
        const bytes = Buffer.from(input.photoBase64, "base64");
        if (bytes.length > 1_000_000) throw new Error("La photo est trop volumineuse.");
        const extension = input.photoMime === "image/png" ? "png" : input.photoMime === "image/webp" ? "webp" : "jpg";
        const safePhone = input.phone.replace(/[^0-9]/g, "");
        const stored = await storagePut(`tikis-profiles/${safePhone}/avatar.${extension}`, bytes, input.photoMime);
        photoKey = stored.key;
      }
      const current = await db.getTikisProfileByPhone(input.phone);
      if (!current) throw new Error("Profil introuvable. Connectez-vous de nouveau pour le créer.");
      const profile = await db.updateTikisProfile(input.phone, { fullName: input.fullName ?? current.fullName, photoKey: photoKey ?? current.photoKey });
      return toPublicProfile(profile);
    }),
  }),
});

export type AppRouter = typeof appRouter;
