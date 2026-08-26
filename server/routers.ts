import { z } from "zod";
import { COOKIE_NAME } from "../shared/const";
import { randomInt } from "node:crypto";
import * as db from "./db";
import { storagePut } from "./storage";
import * as geography from "./geography";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Numéro de téléphone international invalide.");
const simulationOtpSchema = z.literal("730512", { error: "Code OTP de simulation invalide." });
const fullNameSchema = z.string().trim().min(3).max(70).regex(/^[\p{L}]+(?:[ '-][\p{L}]+)*$/u, "Nom invalide.");
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

function toPublicProfile(profile: { phone: string; fullName: string; accountType: "sender" | "driver"; vehicles: string; photoKey?: string | null; referralCode?: string | null }) {
  let vehicles: ValidVehicle[] = [];
  try {
    const parsed = JSON.parse(profile.vehicles) as unknown;
    if (Array.isArray(parsed)) vehicles = parsed.filter((item): item is ValidVehicle => vehicleSchema.safeParse(item).success);
  } catch { vehicles = []; }
  return { phone: profile.phone, fullName: profile.fullName, role: profile.accountType, vehicles, roleLocked: true as const, photoUrl: profile.photoKey ? `/manus-storage/${profile.photoKey}` : undefined, referralCode: profile.accountType === "driver" ? profile.referralCode ?? undefined : undefined };
}

function newReferralCode(fullName: string) {
  const prefix = fullName.normalize("NFC").replace(/[^\p{L}]/gu, "").toLocaleUpperCase("fr-FR").slice(0, 3);
  return `${prefix}${String(randomInt(0, 100000000)).padStart(8 - prefix.length, "0")}`.slice(0, 8);
}

async function generateUniqueReferralCode(fullName: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = newReferralCode(fullName);
    if (!await db.getTikisProfileByReferralCode(code)) return code;
  }
  throw new Error("Impossible de générer un code de parrainage unique.");
}

const photoMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
const base64ImageSchema = z.string().min(32).max(1_600_000).regex(/^[A-Za-z0-9+/=]+$/, "Données d’image invalides.");
const coordinateSchema = z.number().finite();
const placeSchema = z.object({ name: z.string().max(140), district: z.string().max(120), city: z.string().max(120), latitude: coordinateSchema.min(-90).max(90), longitude: coordinateSchema.min(-180).max(180), googlePlaceId: z.string().max(255).optional(), mapboxId: z.string().max(255).optional(), mapboxSessionToken: z.string().uuid().optional(), formattedAddress: z.string().max(255).optional(), street: z.string().max(160).optional(), province: z.string().max(120).optional(), country: z.string().max(120).optional() });
const favoriteLabelSchema = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}]+(?:[ .,'’()\-][\p{L}\p{N}]+)*$/u, "Libellé de favori invalide.");

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
      const referralCode = input.role === "driver" ? await generateUniqueReferralCode(input.fullName) : undefined;
      const profile = await db.createTikisProfile({
        phone: input.phone,
        fullName: input.fullName,
        accountType: input.role,
        vehicles: JSON.stringify(input.role === "driver" ? input.vehicles : []),
        referralCode,
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
  geography: router({
    search: publicProcedure.input(z.object({ query: z.string().min(2).max(120), biasLatitude: coordinateSchema.min(-90).max(90).optional(), biasLongitude: coordinateSchema.min(-180).max(180).optional() })).mutation(async ({ input }) => geography.searchPlaces(input.query, input.biasLatitude !== undefined && input.biasLongitude !== undefined ? { latitude: input.biasLatitude, longitude: input.biasLongitude } : undefined)),
    resolve: publicProcedure.input(z.object({ mapboxId: z.string().min(1).max(255), mapboxSessionToken: z.string().uuid().optional() })).mutation(async ({ input }) => geography.resolveMapboxPlace(input.mapboxId, input.mapboxSessionToken)),
    geocode: publicProcedure.input(z.object({ address: z.string().min(3).max(180) })).mutation(async ({ input }) => geography.geocodeAddress(input.address)),
    reverse: publicProcedure.input(z.object({ latitude: coordinateSchema.min(-90).max(90), longitude: coordinateSchema.min(-180).max(180) })).mutation(async ({ input }) => geography.reverseGeocodeLocation(input.latitude, input.longitude)),
    route: publicProcedure.input(z.object({ origin: placeSchema, destination: placeSchema })).mutation(async ({ input }) => geography.computeRoute(input.origin, input.destination)),
    savePlace: publicProcedure.input(placeSchema).mutation(async ({ input }) => db.saveTikisPlace({ googlePlaceId: input.googlePlaceId, mapboxPlaceId: input.mapboxId, latitude: String(input.latitude), longitude: String(input.longitude), formattedAddress: input.formattedAddress ?? input.name, placeName: input.name, street: input.street, district: input.district, city: input.city, province: input.province, country: input.country })),
    favorites: router({
      list: publicProcedure.input(z.object({ phone: phoneSchema })).query(async ({ input }) => db.listFavoritePlaces(input.phone)),
      add: publicProcedure.input(z.object({ phone: phoneSchema, placeId: z.number().int().positive(), label: favoriteLabelSchema })).mutation(async ({ input }) => db.saveFavoritePlace(input.phone, input.placeId, input.label)),
      rename: publicProcedure.input(z.object({ phone: phoneSchema, favoriteId: z.number().int().positive(), label: favoriteLabelSchema })).mutation(async ({ input }) => db.renameFavoritePlace(input.phone, input.favoriteId, input.label)),
      remove: publicProcedure.input(z.object({ phone: phoneSchema, favoriteId: z.number().int().positive() })).mutation(async ({ input }) => db.deleteFavoritePlace(input.phone, input.favoriteId)),
    }),
  }),
});

export type AppRouter = typeof appRouter;
