import { z } from "zod";
import { COOKIE_NAME } from "../shared/const";
import { randomInt } from "node:crypto";
import * as db from "./db";
import { storagePut } from "./storage";
import * as geography from "./geography";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, tikisProtectedProcedure } from "./_core/trpc";
import { findCountryForPhone } from "../lib/registration-rules";
import { createTikisProfileSession } from "./tikis-session";
import { recordGeographicMetric } from "./geography-observability";

const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Numéro de téléphone international invalide.");
const simulationOtpSchema = z.literal("730512", { error: "Code OTP de simulation invalide." });
const fullNameSchema = z.string().trim().min(3).max(70).regex(/^[\p{L}]+(?:[ '-][\p{L}]+)*$/u, "Nom invalide.");
const vehicleSchema = z.enum(["Vélo", "Moto", "Tricycle", "Voiture", "Fourgonnette"]);
type ValidVehicle = z.infer<typeof vehicleSchema>;
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Code pays ISO invalide.");
const profileFieldsSchema = z.object({
  phone: phoneSchema,
  fullName: fullNameSchema,
  countryCode: countryCodeSchema,
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
  return { phone: profile.phone, fullName: profile.fullName, countryCode: findCountryForPhone(profile.phone).id, role: profile.accountType, vehicles, roleLocked: true as const, photoUrl: profile.photoKey ? `/manus-storage/${profile.photoKey}` : undefined, referralCode: profile.accountType === "driver" ? profile.referralCode ?? undefined : undefined };
}

function sessionCountryCode(profilePhone: string) {
  return findCountryForPhone(profilePhone).id;
}

const GEO_RATE_LIMIT_WINDOW_MS = 60_000;
const GEO_RATE_LIMIT_MAX_REQUESTS = 40;
const geographyRequests = new Map<string, number[]>();

function enforceGeographyRateLimit(profilePhone: string) {
  const now = Date.now();
  const recent = (geographyRequests.get(profilePhone) ?? []).filter((timestamp) => now - timestamp < GEO_RATE_LIMIT_WINDOW_MS);
  if (recent.length >= GEO_RATE_LIMIT_MAX_REQUESTS) {
    recordGeographicMetric("search", "rate_limited");
    throw new Error("Trop de demandes de lieux en cours. Réessayez dans une minute.");
  }
  recent.push(now);
  geographyRequests.set(profilePhone, recent);
}

const protectedGeographyProcedure = tikisProtectedProcedure.use(async ({ ctx, next }) => {
  enforceGeographyRateLimit(ctx.tikisProfilePhone);
  return next();
});

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
      return profile ? { profile: toPublicProfile(profile), sessionToken: await createTikisProfileSession(profile.phone) } : null;
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
      return { profile: toPublicProfile(profile), sessionToken: await createTikisProfileSession(profile.phone) };
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
    search: protectedGeographyProcedure.input(z.object({ query: z.string().min(2).max(120), countryCode: countryCodeSchema.optional(), biasLatitude: coordinateSchema.min(-90).max(90).optional(), biasLongitude: coordinateSchema.min(-180).max(180).optional() })).mutation(async ({ ctx, input }) => geography.searchPlaces(input.query, input.biasLatitude !== undefined && input.biasLongitude !== undefined ? { latitude: input.biasLatitude, longitude: input.biasLongitude } : undefined, sessionCountryCode(ctx.tikisProfilePhone))),
    resolve: protectedGeographyProcedure.input(z.object({ mapboxId: z.string().min(1).max(255), mapboxSessionToken: z.string().uuid().optional() })).mutation(async ({ ctx, input }) => geography.resolveMapboxPlace(input.mapboxId, input.mapboxSessionToken, sessionCountryCode(ctx.tikisProfilePhone))),
    geocode: protectedGeographyProcedure.input(z.object({ address: z.string().min(3).max(180) })).mutation(async ({ ctx, input }) => geography.geocodeAddress(input.address, sessionCountryCode(ctx.tikisProfilePhone))),
    reverse: protectedGeographyProcedure.input(z.object({ latitude: coordinateSchema.min(-90).max(90), longitude: coordinateSchema.min(-180).max(180) })).mutation(async ({ ctx, input }) => geography.reverseGeocodeLocation(input.latitude, input.longitude, sessionCountryCode(ctx.tikisProfilePhone))),
    route: protectedGeographyProcedure.input(z.object({ origin: placeSchema, destination: placeSchema })).mutation(async ({ input }) => geography.computeRoute(input.origin, input.destination)),
    savePlace: protectedGeographyProcedure.input(placeSchema).mutation(async ({ input }) => db.saveTikisPlace({ googlePlaceId: input.googlePlaceId, mapboxPlaceId: input.mapboxId, latitude: String(input.latitude), longitude: String(input.longitude), formattedAddress: input.formattedAddress ?? input.name, placeName: input.name, street: input.street, district: input.district, city: input.city, province: input.province, country: input.country, provider: input.mapboxId ? "mapbox" : "manual", source: input.mapboxId ? "retrieve" : "manual", featureType: "unknown", precision: "unknown" })),
    favorites: router({
      list: tikisProtectedProcedure.query(({ ctx }) => db.listFavoritePlaces(ctx.tikisProfilePhone)),
      add: tikisProtectedProcedure.input(z.object({ placeId: z.number().int().positive(), label: favoriteLabelSchema })).mutation(async ({ ctx, input }) => db.saveFavoritePlace(ctx.tikisProfilePhone, input.placeId, input.label)),
      rename: tikisProtectedProcedure.input(z.object({ favoriteId: z.number().int().positive(), label: favoriteLabelSchema })).mutation(async ({ ctx, input }) => db.renameFavoritePlace(ctx.tikisProfilePhone, input.favoriteId, input.label)),
      remove: tikisProtectedProcedure.input(z.object({ favoriteId: z.number().int().positive() })).mutation(async ({ ctx, input }) => db.deleteFavoritePlace(ctx.tikisProfilePhone, input.favoriteId)),
    }),
  }),
});

export type AppRouter = typeof appRouter;
