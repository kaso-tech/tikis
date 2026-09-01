import { z } from "zod";
import { COOKIE_NAME } from "../shared/const";
import { randomInt, randomUUID } from "node:crypto";
import * as db from "./db";
import { publishDeliveryPositionBroadcast, publishDeliveryStatusBroadcast, syncDeliveryRealtimeMembers } from "./supabase-realtime";
import { storagePut } from "./storage";
import * as geography from "./geography";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, tikisProtectedProcedure } from "./_core/trpc";
import { findCountryForPhone } from "../lib/registration-rules";
import { createTikisProfileSession } from "./tikis-session";
import { recordGeographicMetric } from "./geography-observability";
import { isAllowedDeliveryText, sanitizeDeliveryText } from "../lib/tikis-engine";
import { isValidReviewText, sanitizeReviewText } from "../lib/review-rules";

const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Numéro de téléphone international invalide.");
const simulationOtpSchema = z.literal("730512", { error: "Code OTP de simulation invalide." });
const fullNameSchema = z.string().trim().min(3).max(70).regex(/^[\p{L}]+(?:[ '-][\p{L}]+)*$/u, "Nom invalide.");
const vehicleSchema = z.enum(["Vélo", "Moto", "Tricycle", "Voiture", "Fourgonnette"]);
type ValidVehicle = z.infer<typeof vehicleSchema>;
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Code pays ISO invalide.");
const supabaseAccessTokenSchema = z.string().min(80).max(8_000, "Session Supabase invalide.");
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

async function verifySupabasePhoneSession(phone: string, accessToken: string) {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase Auth n’est pas configuré pour le moment.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` }, signal: controller.signal });
    if (!response.ok) throw new Error("La session Supabase a expiré ou n’est pas valide.");
    const user = await response.json() as { id?: unknown; phone?: unknown };
    if (typeof user.id !== "string" || typeof user.phone !== "string" || user.phone !== phone) throw new Error("La session Supabase ne correspond pas à ce numéro Tikis.");
    return user.id;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("La vérification Supabase a expiré. Réessayez.");
    throw error;
  } finally { clearTimeout(timeout); }
}

function toPublicProfile(profile: { phone: string; fullName: string; accountType: "sender" | "driver"; vehicles: string; photoKey?: string | null; email?: string | null; phoneVerified?: boolean; emailVerified?: boolean; referralCode?: string | null }) {
  let vehicles: ValidVehicle[] = [];
  try {
    const parsed = JSON.parse(profile.vehicles) as unknown;
    if (Array.isArray(parsed)) vehicles = parsed.filter((item): item is ValidVehicle => vehicleSchema.safeParse(item).success);
  } catch { vehicles = []; }
  return { phone: profile.phone, fullName: profile.fullName, countryCode: findCountryForPhone(profile.phone).id, role: profile.accountType, vehicles, roleLocked: true as const, photoUrl: profile.photoKey ? `/manus-storage/${profile.photoKey}` : undefined, email: profile.email ?? undefined, phoneVerified: profile.phoneVerified ?? true, emailVerified: profile.emailVerified ?? false, referralCode: profile.accountType === "driver" ? profile.referralCode ?? undefined : undefined };
}

function sessionCountryCode(profilePhone: string) {
  return findCountryForPhone(profilePhone).id;
}

async function syncDeliveryParticipants(delivery: Pick<ResolvedDelivery, "id" | "senderPhone" | "driverPhone">) {
  const [sender, driver] = await Promise.all([delivery.senderPhone ? db.getTikisProfileByPhone(delivery.senderPhone) : Promise.resolve(undefined), delivery.driverPhone ? db.getTikisProfileByPhone(delivery.driverPhone) : Promise.resolve(undefined)]);
  const members = [sender?.supabaseUserId ? { userId: sender.supabaseUserId, role: "sender" as const } : null, driver?.supabaseUserId ? { userId: driver.supabaseUserId, role: "driver" as const } : null].filter((member): member is { userId: string; role: "sender" | "driver" } => member !== null);
  void syncDeliveryRealtimeMembers(delivery.id, members);
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
const placeSchema = z.object({ name: z.string().max(140), district: z.string().max(120), city: z.string().max(120), latitude: coordinateSchema.min(-90).max(90), longitude: coordinateSchema.min(-180).max(180), googlePlaceId: z.string().max(255).optional(), mapboxId: z.string().max(255).optional(), mapboxSessionToken: z.string().uuid().optional(), formattedAddress: z.string().max(255).optional(), street: z.string().max(160).optional(), province: z.string().max(120).optional(), country: z.string().max(120).optional(), source: z.enum(["search", "retrieve", "reverse", "forward", "favorite", "manual", "legacy"]).optional() });
const favoriteLabelSchema = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}]+(?:[ .,'’()\-][\p{L}\p{N}]+)*$/u, "Libellé de favori invalide.");
const deliveryTextSchema = z.string().trim().min(3).max(450);
const deliveryVehicleSchema = z.enum(["Vélo", "Moto", "Tricycle", "Voiture"]);
const deliveryInputSchema = z.object({
  title: deliveryTextSchema.max(120),
  details: deliveryTextSchema,
  type: z.enum(["Plis", "Personne", "Autre"]),
  pickup: placeSchema,
  dropoff: placeSchema,
  distanceKm: z.number().finite().positive().max(20_000),
  routeSource: z.enum(["routes", "provisional"]),
  estimatedPrice: z.number().int().positive().max(10_000_000),
  offeredPrice: z.number().int().positive().max(10_000_000).optional(),
  vehicleTypes: z.array(deliveryVehicleSchema).length(1),
  weightKg: z.number().finite().positive().max(500).optional(),
  dimensions: z.object({ lengthCm: z.number().int().positive().max(500).optional(), widthCm: z.number().int().positive().max(500).optional(), heightCm: z.number().int().positive().max(500).optional() }).optional(),
  passengers: z.number().int().min(1).max(4).optional(),
}).superRefine((value, ctx) => {
  if (!isAllowedDeliveryText(value.title) || !isAllowedDeliveryText(value.details)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Les informations de livraison contiennent des caractères non autorisés." });
  if (value.type === "Personne" && !value.passengers) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["passengers"], message: "Le nombre de personnes est requis." });
  if (value.type !== "Personne" && value.passengers) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["passengers"], message: "Le nombre de personnes concerne uniquement un déplacement." });
  if (value.type !== "Autre" && (value.weightKg || value.dimensions)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Le poids et les dimensions concernent uniquement les colis." });
});

async function currentTikisProfile(phone: string) {
  const profile = await db.getTikisProfileByPhone(phone);
  if (!profile) throw new Error("Votre profil Tikis est introuvable. Connectez-vous de nouveau.");
  return profile;
}

async function saveDeliveryPlace(place: z.infer<typeof placeSchema>) {
  return db.saveTikisPlace({
    googlePlaceId: place.googlePlaceId,
    mapboxPlaceId: place.mapboxId,
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    formattedAddress: place.formattedAddress ?? place.name,
    placeName: place.name,
    street: place.street,
    district: place.district,
    city: place.city,
    province: place.province,
    country: place.country,
    provider: place.mapboxId ? "mapbox" : "manual",
    source: place.source ?? (place.mapboxId ? "retrieve" : "manual"),
    featureType: "unknown",
    precision: "unknown",
  });
}

type ResolvedDelivery = NonNullable<Awaited<ReturnType<typeof db.getTikisDeliveryById>>>;

function deliveryForProfile(delivery: ResolvedDelivery, profile: Awaited<ReturnType<typeof currentTikisProfile>>): ResolvedDelivery {
  if (profile.accountType === "sender") return { ...delivery, routeVisibility: "exact" };
  const maySeeExactRoute = delivery.driverId === profile.phone && (delivery.status === "active" || delivery.status === "completed");
  if (maySeeExactRoute) return { ...delivery, routeVisibility: "exact" };
  const concealPlace = (place: ResolvedDelivery["pickup"]) => ({
    ...place,
    name: place.city || "Zone indicative",
    district: "",
    formattedAddress: place.city || "Zone indicative",
    street: undefined,
    googlePlaceId: undefined,
    mapboxId: undefined,
    mapboxSessionToken: undefined,
    latitude: Math.round(place.latitude * 10) / 10,
    longitude: Math.round(place.longitude * 10) / 10,
    precision: "area" as const,
  });
  return {
    ...delivery,
    pickup: concealPlace(delivery.pickup),
    dropoff: concealPlace(delivery.dropoff),
    senderName: "Expéditeur Tikis",
    senderPhone: undefined,
    driverName: undefined,
    driverPhone: undefined,
    routeVisibility: "approximate",
  };
}

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
    lookupSupabase: publicProcedure.input(z.object({ phone: phoneSchema, accessToken: supabaseAccessTokenSchema })).mutation(async ({ input }) => {
      const supabaseUserId = await verifySupabasePhoneSession(input.phone, input.accessToken);
      const profile = await db.getTikisProfileByPhone(input.phone);
      if (!profile) return null;
      const linked = await db.linkTikisProfileToSupabaseUser(profile.phone, supabaseUserId);
      return { profile: toPublicProfile(linked), sessionToken: await createTikisProfileSession(linked.phone) };
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
    registerSupabase: publicProcedure.input(profileFieldsSchema.extend({ accessToken: supabaseAccessTokenSchema }).superRefine(validateProfileRole)).mutation(async ({ input }) => {
      const supabaseUserId = await verifySupabasePhoneSession(input.phone, input.accessToken);
      const referralCode = input.role === "driver" ? await generateUniqueReferralCode(input.fullName) : undefined;
      const profile = await db.createTikisProfile({ phone: input.phone, fullName: input.fullName, accountType: input.role, vehicles: JSON.stringify(input.role === "driver" ? input.vehicles : []), referralCode, supabaseUserId });
      const linked = await db.linkTikisProfileToSupabaseUser(profile.phone, supabaseUserId);
      return { profile: toPublicProfile(linked), sessionToken: await createTikisProfileSession(linked.phone) };
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
    updateVehicles: tikisProtectedProcedure.input(z.object({ vehicles: z.array(vehicleSchema).min(1).max(5) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seuls les livreurs peuvent gérer leurs engins.");
      const updated = await db.updateTikisProfile(profile.phone, { vehicles: JSON.stringify(input.vehicles) });
      return toPublicProfile(updated);
    }),
    requestContactOtp: publicProcedure.input(z.object({
      kind: z.enum(["phone", "email"]),
      value: z.string().min(3).max(180),
      phone: phoneSchema,
    })).mutation(async ({ input }) => {
      if (input.kind === "phone") {
        if (!/^\+?[0-9 ]{8,20}$/.test(input.value.trim())) throw new Error("Numéro de téléphone invalide.");
      } else {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) throw new Error("Adresse e-mail invalide.");
      }
      return { ok: true, demoOtp: "730512" };
    }),
    updateContact: publicProcedure.input(z.object({
      kind: z.enum(["phone", "email"]),
      value: z.string().min(3).max(180),
      otp: z.string().min(6).max(6),
      phone: phoneSchema,
      sessionOtp: simulationOtpSchema,
    })).mutation(async ({ input }) => {
      if (input.otp !== input.sessionOtp) throw new Error("Code de confirmation invalide.");
      const current = await db.getTikisProfileByPhone(input.phone);
      if (!current) throw new Error("Profil introuvable.");
      if (input.kind === "phone") {
        if (!/^\+?[0-9 ]{8,20}$/.test(input.value.trim())) throw new Error("Numéro de téléphone invalide.");
        if (input.value.trim() !== current.phone) throw new Error("La modification du numéro de connexion nécessite une vérification d’identité. Contactez l’assistance Tikis.");
        return toPublicProfile(current);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) throw new Error("Adresse e-mail invalide.");
      const updated = await db.updateTikisProfile(input.phone, { email: input.value.trim().toLocaleLowerCase("fr-FR"), emailVerified: true, phoneVerified: true });
      return toPublicProfile(updated);
    }),
  }),
  geography: router({
    search: protectedGeographyProcedure.input(z.object({ query: z.string().min(2).max(120), countryCode: countryCodeSchema.optional(), biasLatitude: coordinateSchema.min(-90).max(90).optional(), biasLongitude: coordinateSchema.min(-180).max(180).optional(), includeCommunityFallback: z.boolean().optional() })).mutation(async ({ ctx, input }) => geography.searchPlaces(input.query, input.biasLatitude !== undefined && input.biasLongitude !== undefined ? { latitude: input.biasLatitude, longitude: input.biasLongitude } : undefined, sessionCountryCode(ctx.tikisProfilePhone), input.includeCommunityFallback === true)),
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
  deliveries: router({
    list: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const deliveries = await db.listTikisDeliveriesForProfile(profile.phone, profile.accountType);
      const compatible = profile.accountType === "driver"
        ? deliveries.filter((delivery) => delivery.driverId === profile.phone || delivery.vehicleTypes.some((vehicle) => {
          try { return JSON.parse(profile.vehicles).includes(vehicle); } catch { return false; }
        }))
        : deliveries;
      if (profile.accountType !== "driver") {
        const candidateCounts = await db.countTikisDeliveryCandidates(compatible.map((delivery) => delivery.id));
        return compatible.map((delivery) => ({ ...deliveryForProfile(delivery, profile), candidateCount: candidateCounts.get(delivery.id) ?? 0 }));
      }
      const candidatesByDelivery = await db.listTikisDeliveryCandidateStatesForDriver(compatible.map((delivery) => delivery.id), profile.phone);
      return compatible.map((delivery) => {
        const candidate = candidatesByDelivery.get(delivery.id);
        return { ...deliveryForProfile(delivery, profile), ...(candidate ? { ownCandidateStatus: candidate.status } : {}) };
      });
    }),
    get: tikisProtectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const record = await db.getTikisDeliveryRecordById(input.id);
      const delivery = await db.getTikisDeliveryById(input.id);
      if (!record || !delivery) throw new Error("Livraison introuvable.");
      if (profile.accountType === "sender" && record.senderPhone !== profile.phone) throw new Error("Cette livraison ne vous appartient pas.");
      if (profile.accountType === "driver" && record.status !== "open" && record.driverPhone !== profile.phone) {
        const candidate = await db.getTikisDeliveryCandidateForDriver(delivery.id, profile.phone);
        if (!candidate || candidate.status === "withdrawn") throw new Error("Cette livraison n’est pas accessible.");
      }
      return deliveryForProfile(delivery, profile);
    }),
    livePosition: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const record = await db.getTikisDeliveryRecordById(input.deliveryId);
      if (!record || record.status !== "active" || !record.driverPhone) return null;
      const isParticipant = profile.accountType === "sender"
        ? record.senderPhone === profile.phone
        : record.driverPhone === profile.phone;
      if (!isParticipant) throw new Error("Cette position n’est pas accessible.");
      return db.getTikisDeliveryLiveLocation(input.deliveryId);
    }),
    updateLivePosition: tikisProtectedProcedure.input(z.object({
      deliveryId: z.string().uuid(),
      latitude: coordinateSchema.min(-90).max(90),
      longitude: coordinateSchema.min(-180).max(180),
      heading: z.number().finite().min(0).max(360),
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seul le livreur assigné peut partager sa position.");
      const position = await db.saveTikisDeliveryLiveLocation({ ...input, driverPhone: profile.phone });
      void publishDeliveryPositionBroadcast({ deliveryId: input.deliveryId, ...position });
      return position;
    }),
    create: tikisProtectedProcedure.input(deliveryInputSchema).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul un expéditeur peut publier une livraison.");
      try {
        const [pickup, dropoff] = await Promise.all([saveDeliveryPlace(input.pickup), saveDeliveryPlace(input.dropoff)]);
        const delivery = await db.createTikisDelivery({
          id: randomUUID(),
          senderPhone: profile.phone,
          pickupPlaceId: pickup.id,
          dropoffPlaceId: dropoff.id,
          title: sanitizeDeliveryText(input.title),
          details: sanitizeDeliveryText(input.details),
          deliveryType: input.type,
          status: "open",
          distanceKm: String(input.distanceKm),
          routeSource: input.routeSource,
          estimatedPrice: input.estimatedPrice,
          offeredPrice: input.offeredPrice ?? null,
          vehicleTypes: JSON.stringify(input.vehicleTypes),
          weightKg: input.weightKg ? String(input.weightKg) : null,
          lengthCm: input.dimensions?.lengthCm ?? null,
          widthCm: input.dimensions?.widthCm ?? null,
          heightCm: input.dimensions?.heightCm ?? null,
          passengers: input.passengers ?? null,
        });
        if (!delivery) throw new Error("La livraison n’a pas pu être enregistrée.");
        return delivery;
      } catch (cause) {
        console.error("[deliveries.create] failed", cause);
        if (cause instanceof Error) throw cause;
        throw new Error("Publication indisponible. Vérifiez votre connexion puis réessayez.");
      }
    }),
    candidates: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const record = await db.getTikisDeliveryRecordById(input.deliveryId);
      const delivery = await db.getTikisDeliveryById(input.deliveryId);
      if (!record || !delivery) throw new Error("Livraison introuvable.");
      const candidates = await db.listTikisDeliveryCandidates(input.deliveryId);
      if (profile.accountType === "sender") {
        if (record.senderPhone !== profile.phone) throw new Error("Cette livraison ne vous appartient pas.");
        return candidates;
      }
      return candidates.filter((candidate) => candidate.driverId === profile.phone);
    }),
    submitApplication: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid(), confirmedCommission: z.number().int().positive().max(10_000_000), offerPrice: z.number().int().positive().max(10_000_000).optional() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seul un livreur peut candidater.");
      if (!profile.photoKey) throw new Error("Votre profil doit être vérifié (photo + pièce d'identité) avant de candidater à une livraison.");
      return db.applyForTikisDelivery({ id: randomUUID(), deliveryId: input.deliveryId, driverPhone: profile.phone, confirmedCommission: input.confirmedCommission, ...(input.offerPrice ? { offerPrice: input.offerPrice } : {}) });
    }),
    update: tikisProtectedProcedure.input(deliveryInputSchema.safeExtend({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut modifier une livraison.");
      const [pickup, dropoff] = await Promise.all([saveDeliveryPlace(input.pickup), saveDeliveryPlace(input.dropoff)]);
      const delivery = await db.updateTikisDeliveryFromSender({
        deliveryId: input.deliveryId,
        senderPhone: profile.phone,
        pickupPlaceId: pickup.id,
        dropoffPlaceId: dropoff.id,
        title: sanitizeDeliveryText(input.title),
        details: sanitizeDeliveryText(input.details),
        deliveryType: input.type,
        distanceKm: String(input.distanceKm),
        routeSource: input.routeSource,
        estimatedPrice: input.estimatedPrice,
        offeredPrice: input.offeredPrice ?? null,
        vehicleTypes: JSON.stringify(input.vehicleTypes),
        weightKg: input.type === "Autre" && input.weightKg ? String(input.weightKg) : null,
        lengthCm: input.type === "Autre" ? input.dimensions?.lengthCm ?? null : null,
        widthCm: input.type === "Autre" ? input.dimensions?.widthCm ?? null : null,
        heightCm: input.type === "Autre" ? input.dimensions?.heightCm ?? null : null,
        passengers: input.type === "Personne" ? input.passengers ?? null : null,
      });
      if (delivery) {
        const record = await db.getTikisDeliveryRecordById(delivery.id);
        if (record) await syncDeliveryParticipants({ id: delivery.id, senderPhone: record.senderPhone, driverPhone: record.driverPhone ?? undefined } as ResolvedDelivery);
        void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livraison mise à jour", body: "Les informations de la livraison ont été actualisées.", occurredAt: new Date().toISOString() });
      }
      return delivery;
    }),
    disable: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut désactiver une livraison.");
      const delivery = await db.disableTikisDeliveryFromSender(input.deliveryId, profile.phone);
      if (delivery) void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livraison désactivée", body: "La livraison n’accepte plus de candidatures.", occurredAt: new Date().toISOString() });
      return delivery;
    }),
    reactivate: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut activer une livraison.");
      const delivery = await db.reactivateTikisDeliveryFromSender(input.deliveryId, profile.phone);
      if (delivery) void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livraison activée", body: "La livraison est à nouveau disponible pour les livreurs compatibles.", occurredAt: new Date().toISOString() });
      return delivery;
    }),
    cancel: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut annuler une livraison.");
      const delivery = await db.cancelTikisDeliveryFromSender(input.deliveryId, profile.phone);
      if (delivery) void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livraison annulée", body: "Cette livraison a été annulée par l’expéditeur.", occurredAt: new Date().toISOString() });
      return delivery;
    }),
    withdraw: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seul un livreur peut retirer sa candidature.");
      return db.withdrawTikisDeliveryCandidateWithWallet(input.deliveryId, profile.phone);
    }),
    selectCandidate: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid(), candidateId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut choisir un livreur.");
      const delivery = await db.selectTikisDeliveryCandidateWithWallet(input.deliveryId, input.candidateId, profile.phone);
      if (delivery) { await syncDeliveryParticipants(delivery); void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livreur sélectionné", body: "La livraison attend la confirmation du livreur.", occurredAt: new Date().toISOString() }); }
      return delivery;
    }),
    confirm: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seul le livreur sélectionné peut confirmer.");
      const result = await db.confirmTikisDeliveryWithEvents(input.deliveryId, profile.phone);
      if (result.delivery) { await syncDeliveryParticipants(result.delivery); void publishDeliveryStatusBroadcast({ deliveryId: result.delivery.id, status: result.delivery.status, title: "Livraison activée", body: "Le livreur a confirmé sa disponibilité.", occurredAt: new Date().toISOString() }); }
      return result;
    }),
    complete: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const result = await db.completeTikisDeliveryWithEvents(input.deliveryId, profile.phone);
      if (result.delivery) { await syncDeliveryParticipants(result.delivery); void publishDeliveryStatusBroadcast({ deliveryId: result.delivery.id, status: result.delivery.status, title: "Livraison terminée", body: "La livraison a été déclarée terminée.", occurredAt: new Date().toISOString() }); }
      return result;
    }),
  }),
  wallet: router({
    snapshot: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const [wallet, journal, commissionRate] = await Promise.all([db.getTikisWalletSnapshot(profile.phone), db.listTikisWalletLedger(profile.phone), db.getTikisCommissionRate()]);
      return { wallet, journal, commissionRate };
    }),
    requestOperation: tikisProtectedProcedure.input(z.object({ type: z.enum(["deposit", "withdrawal"]), amount: z.number().int().min(100).max(10_000_000) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.requestTikisWalletOperation(profile.phone, input.type, input.amount);
    }),
    initiateYengaPayTest: tikisProtectedProcedure.input(z.object({ type: z.enum(["deposit", "withdrawal"]), amount: z.number().int().min(100).max(10_000_000), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.initiateYengaPayTestPayment({ ...input, profilePhone: profile.phone });
    }),
    settleYengaPayTest: tikisProtectedProcedure.input(z.object({ paymentId: z.string().uuid(), outcome: z.enum(["succeeded", "failed"]) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.settleYengaPayTestPayment({ ...input, profilePhone: profile.phone });
    }),
  }),
  notifications: router({
    list: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.listTikisDeliveryEvents(profile.phone);
    }),
    markRead: tikisProtectedProcedure.mutation(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.markTikisDeliveryEventsRead(profile.phone);
    }),
    markOneRead: tikisProtectedProcedure.input(z.object({ notificationId: z.string().min(1).max(40) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.markTikisDeliveryEventRead(input.notificationId, profile.phone);
    }),
  }),
  reviews: router({
    list: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.listTikisDeliveryReviewsForProfile(profile.phone, profile.accountType);
    }),
    getForDelivery: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const record = await db.getTikisDeliveryRecordById(input.deliveryId);
      if (!record || (record.senderPhone !== profile.phone && record.driverPhone !== profile.phone)) throw new Error("Cet avis n’est pas accessible.");
      const reviewerPhone = profile.accountType === "sender" ? profile.phone : record.senderPhone;
      const review = await db.getTikisDeliveryReview(input.deliveryId, reviewerPhone);
      return review ? db.deliveryReviewToView(review) : null;
    }),
    submit: tikisProtectedProcedure.input(z.object({ deliveryId: z.string().uuid(), rating: z.number().int().min(1).max(5), comment: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const delivery = await db.getTikisDeliveryRecordById(input.deliveryId);
      if (!delivery || delivery.senderPhone !== profile.phone || profile.accountType !== "sender" || delivery.status !== "completed" || !delivery.driverPhone) throw new Error("Cette livraison ne peut pas encore être évaluée.");
      if (input.comment && !isValidReviewText(input.comment)) throw new Error("Caractères non autorisés");
      const existing = await db.getTikisDeliveryReview(input.deliveryId, profile.phone);
      if (existing) throw new Error("Un avis a déjà été enregistré pour cette livraison.");
      const review = await db.saveTikisDeliveryReview({ id: randomUUID(), deliveryId: delivery.id, reviewerPhone: profile.phone, driverPhone: delivery.driverPhone, rating: input.rating, ...(input.comment?.trim() ? { comment: sanitizeReviewText(input.comment) } : {}) });
      if (!review) throw new Error("L’avis n’a pas pu être enregistré.");
      return db.deliveryReviewToView(review);
    }),
  }),
});

export type AppRouter = typeof appRouter;
