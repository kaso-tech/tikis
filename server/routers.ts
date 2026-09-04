import { z } from "zod";
import { COOKIE_NAME } from "../shared/const";
import { randomInt, randomUUID } from "node:crypto";
import * as db from "./db";
import { publishDeliveryPositionBroadcast, publishDeliveryStatusBroadcast, syncDeliveryRealtimeMembers } from "./supabase-realtime";
import { isCoordinateInCountry } from "./_test-helpers/geo-fence";
import { storagePut } from "./storage";
import * as geography from "./geography";
import { getSessionCookieOptions, setTikisProfileCookie, clearTikisProfileCookie } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, tikisProtectedProcedure, tikisSessionProcedure } from "./_core/trpc";
import { findCountryForPhone } from "../lib/registration-rules";
import { createTikisProfileSession } from "./tikis-session";
import { recordGeographicMetric } from "./geography-observability";
import { isAllowedDeliveryText, sanitizeDeliveryText } from "../lib/tikis-engine";
import { isValidReviewText, sanitizeReviewText } from "../lib/review-rules";
import { canReviewDelivery } from "./_test-helpers/review-eligibility";
import { tikisAdminRouter } from "./admin-router";
import * as adminDb from "./admin-db";

const reportReasonSchema = z.enum(["comportement", "sécurité", "paiement", "objet_endommagé", "retard", "autre"]);
const reportDescriptionSchema = z.string().trim().min(10, "Décrivez le problème en quelques mots (10 caractères minimum).").max(1000);
const DELETION_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Numéro de téléphone international invalide.");

const OTP_MODE = (process.env.TIKIS_OTP_MODE ?? "sim") as "sim" | "real";
const SIMULATION_OTP = process.env.TIKIS_SIMULATION_OTP ?? "730512";
const simulationOtpSchema = z.string().superRefine((value, ctx) => {
  if (OTP_MODE === "real") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Le mode simulation est désactivé. Utilisez l’authentification Supabase." });
    return;
  }
  if (value !== SIMULATION_OTP) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Code OTP de simulation invalide." });
  }
});
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
  referredByCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,8}$/).optional(),
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

/** Seul un compte définitivement supprimé bloque la connexion elle-même : un compte banni/suspendu
 *  doit pouvoir se connecter pour voir l'écran dédié qui lui explique sa situation (voir tikisProtectedProcedure
 *  qui bloque ensuite toutes les autres actions). */
function assertProfileNotBlocked(profile: { deletedAt: Date | null }) {
  if (profile.deletedAt) throw new Error("Ce compte a été supprimé.");
}

async function assertCountryEnabled(countryCode: string) {
  const countries = await db.listSupportedCountries();
  if (!countries.some((country) => country.id === countryCode)) {
    throw new Error("L’inscription n’est pas encore disponible pour ce pays. Contactez le support Tikis.");
  }
}

type PerPhoneCounter = { count: number; windowStart: number; blockedUntil: number };
const perPhoneBuckets = new Map<string, PerPhoneCounter>();
const PER_PHONE_WINDOW_MS = 10 * 60_000;
const PER_PHONE_MAX = 5;
const PER_PHONE_BLOCK_MS = 30 * 60_000;

function enforcePerPhoneRateLimit(scope: string, phone: string) {
  const key = `${scope}:${phone}`;
  const now = Date.now();
  const entry = perPhoneBuckets.get(key);
  if (entry?.blockedUntil && entry.blockedUntil > now) {
    const minutes = Math.ceil((entry.blockedUntil - now) / 60_000);
    throw new Error(`Trop de tentatives pour ce numéro. Réessayez dans ${minutes} minute(s).`);
  }
  if (!entry || now - entry.windowStart > PER_PHONE_WINDOW_MS) {
    perPhoneBuckets.set(key, { count: 1, windowStart: now, blockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count > PER_PHONE_MAX) {
    entry.blockedUntil = now + PER_PHONE_BLOCK_MS;
    const minutes = Math.ceil(PER_PHONE_BLOCK_MS / 60_000);
    throw new Error(`Trop de tentatives pour ce numéro. Réessayez dans ${minutes} minute(s).`);
  }
}

const bucketCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of perPhoneBuckets.entries()) {
    if (now - entry.windowStart > PER_PHONE_WINDOW_MS * 2 && (!entry.blockedUntil || entry.blockedUntil < now)) {
      perPhoneBuckets.delete(key);
    }
  }
}, PER_PHONE_WINDOW_MS);
(bucketCleanupTimer as unknown as { unref?: () => void }).unref?.();

function toPublicProfile(profile: { phone: string; fullName: string; accountType: "sender" | "driver"; vehicles: string; photoKey?: string | null; email?: string | null; phoneVerified?: boolean; emailVerified?: boolean; referralCode?: string | null; status?: "active" | "suspended" | "banned"; statusReason?: string | null; country?: string | null; city?: string | null; deletionRequestedAt?: Date | null; deletionScheduledAt?: Date | null }) {
  let vehicles: ValidVehicle[] = [];
  try {
    const parsed = JSON.parse(profile.vehicles) as unknown;
    if (Array.isArray(parsed)) vehicles = parsed.filter((item): item is ValidVehicle => vehicleSchema.safeParse(item).success);
  } catch { vehicles = []; }
  const deletionScheduledAt = profile.deletionScheduledAt ?? (profile.deletionRequestedAt ? new Date(profile.deletionRequestedAt.getTime() + DELETION_GRACE_PERIOD_MS) : undefined);
  return { phone: profile.phone, fullName: profile.fullName, countryCode: findCountryForPhone(profile.phone).id, role: profile.accountType, vehicles, roleLocked: true as const, photoUrl: profile.photoKey ? `/manus-storage/${profile.photoKey}` : undefined, email: profile.email ?? undefined, phoneVerified: profile.phoneVerified ?? true, emailVerified: profile.emailVerified ?? false, referralCode: profile.accountType === "driver" ? profile.referralCode ?? undefined : undefined, country: profile.country ?? undefined, city: profile.city ?? undefined, accountStatus: profile.status ?? "active", accountStatusReason: profile.statusReason ?? undefined, deletionRequestedAt: profile.deletionRequestedAt?.toISOString(), deletionScheduledAt: deletionScheduledAt?.toISOString() };
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
/** Schéma d'image KYC : 5 MB binaire max ≈ 6.7 MB base64 (4/3 expansion).
 *  3 images KYC = 20 MB max par soumission, contrôlé dans la mutation submit. */
const kycBase64ImageSchema = z.string().min(32).max(6_700_000).regex(/^[A-Za-z0-9+/=]+$/, "Données d’image invalides.");
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
  adminConsole: tikisAdminRouter,
  platform: router({
    maintenanceStatus: publicProcedure.query(() => db.getMaintenanceStatus()),
  }),
  loyalty: router({
    myProgress: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const role = profile.accountType;
      const { computeLoyaltyProgress } = await import("./loyalty");
      const result = await computeLoyaltyProgress({ profilePhone: profile.phone, role });
      return result.map((entry) => ({
        programId: entry.program.id,
        programName: entry.program.name,
        programDescription: entry.program.description,
        bonusAmount: entry.program.bonusAmount,
        requiredDeliveries: entry.program.requiredDeliveries,
        windowDays: entry.program.windowDays,
        completedCount: entry.completedCount,
        remaining: Math.max(0, entry.program.requiredDeliveries - entry.completedCount),
        progressPct: Math.min(100, Math.round((entry.completedCount / entry.program.requiredDeliveries) * 100)),
        justQualified: entry.justQualified,
        alreadyGranted: entry.alreadyGranted,
      }));
    }),
  }),
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      clearTikisProfileCookie(ctx.res, ctx.req);
      return { success: true } as const;
    }),
  }),
  sessions: router({
    registerCurrent: tikisProtectedProcedure.input(z.object({
      deviceName: z.string().max(120).optional(),
      platform: z.enum(["ios", "android", "web", "unknown"]).default("unknown"),
      appVersion: z.string().max(40).optional(),
    }).optional()).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const sessionHeader = ctx.req.headers["x-tikis-session"];
      const token = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      if (!token) return { id: null, created: false };
      const { recordSession } = await import("./sessions");
      const ipAddress = (ctx.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? ctx.req.socket?.remoteAddress ?? undefined;
      return recordSession({ phone: profile.phone, token, deviceName: input?.deviceName, platform: input?.platform, appVersion: input?.appVersion, ipAddress });
    }),
    list: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const sessionHeader = ctx.req.headers["x-tikis-session"];
      const token = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      if (!token) return [];
      const { hashSessionToken, listActiveSessions } = await import("./sessions");
      return listActiveSessions({ phone: profile.phone, currentTokenHash: hashSessionToken(token) });
    }),
    revoke: tikisProtectedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const sessionHeader = ctx.req.headers["x-tikis-session"];
      const token = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      if (!token) throw new Error("Session non identifiée.");
      const { hashSessionToken, revokeSession } = await import("./sessions");
      return revokeSession({ phone: profile.phone, sessionId: input.sessionId, currentTokenHash: hashSessionToken(token) });
    }),
    revokeAllOthers: tikisProtectedProcedure.mutation(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const sessionHeader = ctx.req.headers["x-tikis-session"];
      const token = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      if (!token) throw new Error("Session non identifiée.");
      const { hashSessionToken, revokeAllOtherSessions } = await import("./sessions");
      return revokeAllOtherSessions({ phone: profile.phone, currentTokenHash: hashSessionToken(token) });
    }),
  }),
  profiles: router({
    /** Called after local OTP verification in the simulation flow. A production build must verify OTP server-side before this query. */
    lookup: publicProcedure.input(z.object({ phone: phoneSchema, otp: simulationOtpSchema })).mutation(async ({ input, ctx }) => {
      enforcePerPhoneRateLimit("lookup", input.phone);
      const profile = await db.getTikisProfileByPhone(input.phone);
      if (profile) assertProfileNotBlocked(profile);
      if (!profile) return null;
      const sessionToken = await createTikisProfileSession(profile.phone);
      setTikisProfileCookie(ctx.res, ctx.req, sessionToken);
      return { profile: toPublicProfile(profile), sessionToken };
    }),
    lookupSupabase: publicProcedure.input(z.object({ phone: phoneSchema, accessToken: supabaseAccessTokenSchema })).mutation(async ({ input, ctx }) => {
      enforcePerPhoneRateLimit("lookupSupabase", input.phone);
      const supabaseUserId = await verifySupabasePhoneSession(input.phone, input.accessToken);
      const profile = await db.getTikisProfileByPhone(input.phone);
      if (!profile) return null;
      assertProfileNotBlocked(profile);
      const linked = await db.linkTikisProfileToSupabaseUser(profile.phone, supabaseUserId);
      const sessionToken = await createTikisProfileSession(linked.phone);
      setTikisProfileCookie(ctx.res, ctx.req, sessionToken);
      return { profile: toPublicProfile(linked), sessionToken };
    }),
    register: publicProcedure.input(registrationInputSchema).mutation(async ({ input, ctx }) => {
      enforcePerPhoneRateLimit("register", input.phone);
      await assertCountryEnabled(input.countryCode);
      const referralCode = input.role === "driver" ? await generateUniqueReferralCode(input.fullName) : undefined;
      const profile = await db.createTikisProfile({
        phone: input.phone,
        fullName: input.fullName,
        accountType: input.role,
        vehicles: JSON.stringify(input.role === "driver" ? input.vehicles : []),
        referralCode,
      });
      await db.createReferralIfCodeProvided(profile.phone, input.referredByCode);
      const sessionToken = await createTikisProfileSession(profile.phone);
      setTikisProfileCookie(ctx.res, ctx.req, sessionToken);
      return { profile: toPublicProfile(profile), sessionToken };
    }),
    registerSupabase: publicProcedure.input(profileFieldsSchema.extend({ accessToken: supabaseAccessTokenSchema }).superRefine(validateProfileRole)).mutation(async ({ input, ctx }) => {
      enforcePerPhoneRateLimit("registerSupabase", input.phone);
      await assertCountryEnabled(input.countryCode);
      const supabaseUserId = await verifySupabasePhoneSession(input.phone, input.accessToken);
      const referralCode = input.role === "driver" ? await generateUniqueReferralCode(input.fullName) : undefined;
      const profile = await db.createTikisProfile({ phone: input.phone, fullName: input.fullName, accountType: input.role, vehicles: JSON.stringify(input.role === "driver" ? input.vehicles : []), referralCode, supabaseUserId });
      const linked = await db.linkTikisProfileToSupabaseUser(profile.phone, supabaseUserId);
      await db.createReferralIfCodeProvided(linked.phone, input.referredByCode);
      const sessionToken = await createTikisProfileSession(linked.phone);
      setTikisProfileCookie(ctx.res, ctx.req, sessionToken);
      return { profile: toPublicProfile(linked), sessionToken };
    }),
    update: publicProcedure.input(z.object({ phone: phoneSchema, otp: simulationOtpSchema, fullName: fullNameSchema.optional(), photoBase64: base64ImageSchema.optional(), photoMime: photoMimeSchema.optional(), country: z.string().length(2).optional(), city: z.string().trim().min(2).max(80).optional() }).superRefine((value, ctx) => {
      if (!value.fullName && !value.photoBase64 && !value.country && !value.city) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Aucune modification à enregistrer." });
      if (value.photoBase64 && !value.photoMime) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["photoMime"], message: "Type d’image requis." });
    })).mutation(async ({ input }) => {
      enforcePerPhoneRateLimit("update", input.phone);
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
      if (input.country) await assertCountryEnabled(input.country);
      const profile = await db.updateTikisProfile(input.phone, { fullName: input.fullName ?? current.fullName, photoKey: photoKey ?? current.photoKey, country: input.country ?? current.country, city: input.city ?? current.city });
      return toPublicProfile(profile);
    }),
    updateVehicles: tikisProtectedProcedure.input(z.object({ vehicles: z.array(vehicleSchema).min(1).max(5) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seuls les livreurs peuvent gérer leurs engins.");
      const updated = await db.updateTikisProfile(profile.phone, { vehicles: JSON.stringify(input.vehicles) });
      return toPublicProfile(updated);
    }),
    /** Accessible même si le compte est banni/suspendu : c'est ce qui permet à l'app de savoir
     *  quel écran dédié afficher (banni, suppression en cours) sans passer par les routes bloquées. */
    status: tikisSessionProcedure.query(async ({ ctx }) => {
      const profile = await db.getTikisProfileByPhone(ctx.tikisProfilePhone);
      if (!profile) throw new Error("Profil introuvable.");
      return toPublicProfile(profile);
    }),
    requestDeletion: tikisSessionProcedure.mutation(async ({ ctx }) => {
      const profile = await db.requestProfileDeletion(ctx.tikisProfilePhone);
      return toPublicProfile(profile);
    }),
    cancelDeletion: tikisSessionProcedure.mutation(async ({ ctx }) => {
      const profile = await db.cancelProfileDeletion(ctx.tikisProfilePhone);
      return toPublicProfile(profile);
    }),
    requestContactOtp: publicProcedure.input(z.object({
      kind: z.enum(["phone", "email"]),
      value: z.string().min(3).max(180),
      phone: phoneSchema,
    })).mutation(async ({ input }) => {
      enforcePerPhoneRateLimit("requestContactOtp", input.phone);
      if (input.kind === "phone") {
        if (!/^\+?[0-9 ]{8,20}$/.test(input.value.trim())) throw new Error("Numéro de téléphone invalide.");
      } else {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) throw new Error("Adresse e-mail invalide.");
      }
      return { ok: true, demoOtp: SIMULATION_OTP };
    }),
    updateContact: publicProcedure.input(z.object({
      kind: z.enum(["phone", "email"]),
      value: z.string().min(3).max(180),
      otp: z.string().min(6).max(6),
      phone: phoneSchema,
      sessionOtp: simulationOtpSchema,
    })).mutation(async ({ input }) => {
      enforcePerPhoneRateLimit("updateContact", input.phone);
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
    pricingConfig: tikisProtectedProcedure.query(() => adminDb.adminGetPricingConfig()),
    countries: publicProcedure.query(() => db.listSupportedCountries()),
    searchCities: tikisProtectedProcedure.input(z.object({ query: z.string().min(2).max(80), countryCode: z.string().length(2) })).query(({ input }) => geography.searchCities(input.query, input.countryCode)),
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
    driverStats: tikisProtectedProcedure.input(z.object({ driverPhone: phoneSchema })).query(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const record = await db.getTikisProfileByPhone(input.driverPhone);
      if (!record) throw new Error("Livreur introuvable.");
      if (record.accountType !== "driver") throw new Error("Ce profil n'est pas un livreur.");
      const isSelf = profile.phone === input.driverPhone;
      const isParticipant = isSelf || profile.accountType === "sender" || profile.accountType === "admin";
      if (!isParticipant) throw new Error("Accès non autorisé.");
      return db.getTikisDriverStats(input.driverPhone);
    }),
    updateLivePosition: tikisProtectedProcedure.input(z.object({
      deliveryId: z.string().uuid(),
      latitude: coordinateSchema.min(-90).max(90),
      longitude: coordinateSchema.min(-180).max(180),
      heading: z.number().finite().min(0).max(360),
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seul le livreur assigné peut partager sa position.");
      const countryCode = profile.country ?? findCountryForPhone(profile.phone).id;
      if (!isCoordinateInCountry(input.latitude, input.longitude, countryCode)) {
        throw new Error("La position partagée est en dehors de la zone de service. Vérifie ton GPS.");
      }
      const previous = await db.getTikisDeliveryLiveLocation(input.deliveryId);
      if (previous) {
        const distanceKm = haversineDistanceKm(previous.latitude, previous.longitude, input.latitude, input.longitude);
        const elapsedSec = (Date.now() - new Date(previous.recordedAt).getTime()) / 1000;
        const maxAllowedKm = Math.max(0.05, 0.055 * Math.max(elapsedSec, 1));
        if (distanceKm > maxAllowedKm) {
          throw new Error("Le saut de position détecté est trop important. Vérifie ta connexion GPS et réessaie.");
        }
      }
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
      if (input.type === "withdrawal") throw new Error("Les retraits ne sont plus proposés : le Wallet sert uniquement à recharger votre compte pour effectuer des livraisons.");
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.requestTikisWalletOperation(profile.phone, input.type, input.amount);
    }),
    initiateYengaPayTest: tikisProtectedProcedure.input(z.object({ type: z.enum(["deposit", "withdrawal"]), amount: z.number().int().min(100).max(10_000_000), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/) })).mutation(async ({ ctx, input }) => {
      if (input.type === "withdrawal") throw new Error("Les retraits ne sont plus proposés : le Wallet sert uniquement à recharger votre compte pour effectuer des livraisons.");
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
    registerPushToken: tikisProtectedProcedure.input(z.object({
      token: z.string().min(20).max(200),
      platform: z.enum(["ios", "android", "web"]),
      appVersion: z.string().max(40).optional(),
      deviceName: z.string().max(120).optional(),
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.registerPushToken({ phone: profile.phone, token: input.token, platform: input.platform, appVersion: input.appVersion, deviceName: input.deviceName });
    }),
    unregisterPushToken: tikisProtectedProcedure.input(z.object({ token: z.string().min(20).max(200) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.unregisterPushToken({ phone: profile.phone, token: input.token });
    }),
  }),
  reviews: router({
    list: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return db.listTikisDeliveryReviewsForProfile(profile.phone, profile.accountType);
    }),
  }),
  analytics: router({
    mySenderStats: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "sender") {
        return null;
      }
      const handle = await db.getDb();
      if (!handle) return null;
      const { computeSenderStats } = await import("./analytics");
      return computeSenderStats(handle, profile.phone);
    }),
    myDriverEarningsProjection: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "driver") {
        return null;
      }
      const handle = await db.getDb();
      if (!handle) return null;
      const { computeDriverEarningsProjection } = await import("./analytics");
      return computeDriverEarningsProjection(handle, profile.phone);
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
      const existing = delivery ? await db.getTikisDeliveryReview(input.deliveryId, profile.phone) : null;
      if (!canReviewDelivery({ status: delivery?.status ?? "missing", senderPhone: delivery?.senderPhone ?? "", driverPhone: delivery?.driverPhone ?? null }, profile.phone, profile.accountType, !existing)) {
        throw new Error("Cette livraison ne peut pas encore être évaluée.");
      }
      if (!delivery) throw new Error("Livraison introuvable.");
      if (input.comment && !isValidReviewText(input.comment)) throw new Error("Caractères non autorisés");
      const review = await db.saveTikisDeliveryReview({ id: randomUUID(), deliveryId: delivery.id, reviewerPhone: profile.phone, driverPhone: delivery.driverPhone!, rating: input.rating, ...(input.comment?.trim() ? { comment: sanitizeReviewText(input.comment) } : {}) });
      if (!review) throw new Error("L’avis n’a pas pu être enregistré.");
      return db.deliveryReviewToView(review);
    }),
  }),
  referrals: router({
    myCode: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      return { code: profile.accountType === "driver" ? profile.referralCode ?? null : null };
    }),
    mine: tikisProtectedProcedure.query(async ({ ctx }) => {
      const rows = await db.listReferralsForReferrer(ctx.tikisProfilePhone);
      return rows.map((row) => ({
        id: row.referral.id, fullName: row.refereeName, status: row.referral.status,
        rewardAmount: row.referral.rewardAmount, joinedAt: row.referral.createdAt.toISOString(),
      }));
    }),
    settings: publicProcedure.query(() => db.getReferralPublicSettings()),
  }),

  kyc: router({
    status: tikisProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "driver") return null;
      const submission = await db.getLatestKycSubmission(profile.phone);
      if (!submission) return null;
      return { status: submission.status, submittedAt: submission.submittedAt.toISOString(), rejectionReason: submission.rejectionReason ?? undefined };
    }),
    submit: tikisProtectedProcedure.input(z.object({
      idFront: z.object({ base64: kycBase64ImageSchema, mime: photoMimeSchema }),
      idBack: z.object({ base64: kycBase64ImageSchema, mime: photoMimeSchema }),
      selfie: z.object({ base64: kycBase64ImageSchema, mime: photoMimeSchema }),
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      if (profile.accountType !== "driver") throw new Error("La vérification d’identité concerne uniquement les comptes livreurs.");
      const existing = await db.getLatestKycSubmission(profile.phone);
      if (existing?.status === "submitted") throw new Error("Un dossier est déjà en cours d’examen.");
      if (existing?.status === "approved") throw new Error("Votre identité est déjà vérifiée.");
      const totalBytes = input.idFront.base64.length + input.idBack.base64.length + input.selfie.base64.length;
      if (totalBytes > 18_000_000) {
        throw new Error("Les 3 images combinées dépassent la taille maximale autorisée (15 MB). Réduis la résolution avant de renvoyer.");
      }
      const safePhone = profile.phone.replace(/[^0-9]/g, "");
      const stamp = Date.now();
      const extensionOf = (mime: string) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");
      const [idFront, idBack, selfie] = await Promise.all([
        storagePut(`tikis-kyc/${safePhone}/${stamp}-id-front.${extensionOf(input.idFront.mime)}`, Buffer.from(input.idFront.base64, "base64"), input.idFront.mime),
        storagePut(`tikis-kyc/${safePhone}/${stamp}-id-back.${extensionOf(input.idBack.mime)}`, Buffer.from(input.idBack.base64, "base64"), input.idBack.mime),
        storagePut(`tikis-kyc/${safePhone}/${stamp}-selfie.${extensionOf(input.selfie.mime)}`, Buffer.from(input.selfie.base64, "base64"), input.selfie.mime),
      ]);
      return db.createKycSubmission({ driverPhone: profile.phone, idFrontKey: idFront.key, idBackKey: idBack.key, selfieKey: selfie.key });
    }),
  }),

  reports: router({
    create: tikisProtectedProcedure.input(z.object({
      deliveryId: z.string().uuid(),
      reason: reportReasonSchema,
      description: reportDescriptionSchema,
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisProfile(ctx.tikisProfilePhone);
      const delivery = await db.getTikisDeliveryRecordById(input.deliveryId);
      if (!delivery) throw new Error("Livraison introuvable.");
      const isSender = delivery.senderPhone === profile.phone;
      const isDriver = delivery.driverPhone === profile.phone;
      if (!isSender && !isDriver) throw new Error("Vous ne pouvez signaler qu’une livraison à laquelle vous participez.");
      return adminDb.createDeliveryReport({
        deliveryId: input.deliveryId,
        reporterPhone: profile.phone,
        reporterRole: isSender ? "sender" : "driver",
        reason: input.reason,
        description: sanitizeDeliveryText(input.description),
      });
    }),
  }),
});

export type AppRouter = typeof appRouter;
