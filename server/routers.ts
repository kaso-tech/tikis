import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { LIVE_POSITION_GPS_JUMP_ERR_MSG, LIVE_POSITION_OUT_OF_ZONE_ERR_MSG } from "../shared/const";
import type { DriverCandidate } from "../shared/tikisse-domain";
import { randomInt, randomUUID } from "node:crypto";
import * as db from "./db";
import { publishDeliveryPositionBroadcast, publishDeliveryStatusBroadcast, syncDeliveryRealtimeMembers } from "./supabase-realtime";
import { sortDriverOpportunities } from "../shared/driver-opportunities";
import { concealPlaceForDriver } from "./_test-helpers/delivery-visibility";
import { isCoordinateInCountry } from "./_test-helpers/geo-fence";
import { publicFileUrl, storagePut } from "./storage";
import * as geography from "./geography";
import { setTikisseProfileCookie, clearTikisseProfileCookie } from "./_core/cookies";
import { getTikisseSessionTokenFromHeaders, pickTikisseSessionToken } from "./_core/context";
import { clientIp } from "./_core/security";
import { publicProcedure, router, tikisseProtectedProcedure, tikisseSessionProcedure } from "./_core/trpc";
import { findCountryForPhone } from "../lib/registration-rules";
import { COUNTRIES } from "../lib/registration-rules";
import { createTikisseProfileSession, shouldRenewSession, verifyTikisseProfileSessionClaims } from "./tikisse-session";
import { recordGeographicMetric } from "./geography-observability";
import { isAllowedDeliveryText, sanitizeDeliveryText } from "../lib/tikisse-engine";
import { sanitizePlaceText } from "../lib/geo-rules";
import { MAX_PERIMETER_RADIUS_KM, MIN_PERIMETER_RADIUS_KM } from "../shared/driver-perimeter";
import { isValidReviewText, sanitizeReviewText } from "../lib/review-rules";
import { canReviewDelivery } from "./_test-helpers/review-eligibility";
import { tikisseAdminRouter } from "./admin-router";
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

const OTP_MODE = (process.env.TIKISSE_OTP_MODE ?? process.env.TIKIS_OTP_MODE ?? "sim") as "sim" | "real";
const SIMULATION_OTP = process.env.TIKISSE_SIMULATION_OTP ?? process.env.TIKIS_SIMULATION_OTP ?? "730512";
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
  city: z.string().trim().min(2).max(80).optional(),
});

function validateProfileRole(value: z.infer<typeof profileFieldsSchema>, ctx: z.RefinementCtx) {
  if (value.role === "driver" && value.vehicles.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vehicles"], message: "Au moins un engin est requis pour un livreur." });
  if (value.role === "sender" && value.vehicles.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vehicles"], message: "Un expéditeur ne renseigne pas d’engin." });
}

const profileInputSchema = profileFieldsSchema.superRefine(validateProfileRole);
const registrationInputSchema = profileFieldsSchema.extend({ otp: simulationOtpSchema }).superRefine(validateProfileRole);

/** Même numéro, au « + » près : Supabase Auth l'omet, Tikisse le garde. */
export function samePhoneNumber(a: string, b: string) {
  const digits = (value: string) => value.replace(/\D/g, "");
  return digits(a).length > 0 && digits(a) === digits(b);
}

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
    // Supabase Auth enregistre le numéro sans « + » (22670000000) ; Tikisse le garde en E.164 (+22670000000).
    if (typeof user.id !== "string" || typeof user.phone !== "string" || !samePhoneNumber(user.phone, phone)) throw new Error("La session Supabase ne correspond pas à ce numéro Tikisse.");
    return user.id;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("La vérification Supabase a expiré. Réessayez.");
    throw error;
  } finally { clearTimeout(timeout); }
}

/** Seul un compte définitivement supprimé bloque la connexion elle-même : un compte banni/suspendu
 *  doit pouvoir se connecter pour voir l'écran dédié qui lui explique sa situation (voir tikisseProtectedProcedure
 *  qui bloque ensuite toutes les autres actions). */
function assertProfileNotBlocked(profile: { deletedAt: Date | null }) {
  if (profile.deletedAt) throw new Error("Ce compte a été supprimé.");
}

async function assertCountryEnabled(countryCode: string) {
  const countries = await db.listSupportedCountries();
  if (!countries.some((country) => country.id === countryCode)) {
    throw new Error("L’inscription n’est pas encore disponible pour ce pays. Contactez le support Tikisse.");
  }
}

async function enforcePerPhoneRateLimit(scope: string, phone: string) {
  const verdict = await db.checkPhoneAttemptLimit(scope, phone);
  if (!verdict.allowed) throw new Error(`Trop de tentatives pour ce numéro. Réessayez dans ${verdict.retryInMinutes} minute(s).`);
}

/**
 * Complète la limite par numéro d'une limite par IP, distribuée entre les
 * instances (`checkDistributedRateLimit`, table partagée).
 *
 * `enforcePerPhoneRateLimit` remet un compteur à zéro pour chaque nouveau
 * numéro : sans ce garde-fou, un même client pouvait tenter des dizaines de
 * numéros différents à la cadence qu'il voulait, chacun avec son propre
 * budget de 5 tentatives. Un seul espace partagé, `profiles-auth`, couvre
 * toutes les mutations publiques de `profiles` : mélanger `lookup`,
 * `register` et `requestContactOtp` depuis la même IP ne redonne pas de
 * budget neuf à chaque bascule.
 */
const IP_AUTH_SCOPE = "profiles-auth";
const IP_AUTH_WINDOW_MS = 10 * 60_000;
const IP_AUTH_MAX = 30;

async function enforcePerIpRateLimit(req: { ip?: string; socket?: { remoteAddress?: string } } | undefined) {
  const ip = clientIp(req ?? {});
  // Sans IP identifiable (contexte hors HTTP, par ex. en test) : rien à limiter par ce biais,
  // la limite par numéro reste seule à s'appliquer.
  if (ip === "unknown") return;
  const allowed = await db.checkDistributedRateLimit(IP_AUTH_SCOPE, ip, IP_AUTH_WINDOW_MS, IP_AUTH_MAX);
  if (!allowed) throw new Error("Trop de tentatives depuis cette connexion. Réessayez plus tard.");
}


/** Comptes créés avant que l'inscription enregistre le pays : celui de l'indicatif, à la connexion. */
async function withCountryFromPhone<T extends { phone: string; country?: string | null }>(profile: T) {
  if (profile.country) return profile;
  try {
    return { ...profile, ...(await db.updateTikisseProfile(profile.phone, { country: findCountryForPhone(profile.phone).id })) };
  } catch {
    return profile;
  }
}

function toPublicProfile(profile: { phone: string; fullName: string; accountType: "sender" | "driver"; vehicles: string; photoKey?: string | null; email?: string | null; phoneVerified?: boolean; emailVerified?: boolean; referralCode?: string | null; status?: "active" | "suspended" | "banned"; statusReason?: string | null; country?: string | null; city?: string | null; deletionRequestedAt?: Date | null; deletionScheduledAt?: Date | null }) {
  let vehicles: ValidVehicle[] = [];
  try {
    const parsed = JSON.parse(profile.vehicles) as unknown;
    if (Array.isArray(parsed)) vehicles = parsed.filter((item): item is ValidVehicle => vehicleSchema.safeParse(item).success);
  } catch { vehicles = []; }
  const deletionScheduledAt = profile.deletionScheduledAt ?? (profile.deletionRequestedAt ? new Date(profile.deletionRequestedAt.getTime() + DELETION_GRACE_PERIOD_MS) : undefined);
  return { phone: profile.phone, fullName: profile.fullName, countryCode: findCountryForPhone(profile.phone).id, role: profile.accountType, vehicles, roleLocked: true as const, photoUrl: profile.photoKey ? publicFileUrl(profile.photoKey) : undefined, email: profile.email ?? undefined, phoneVerified: profile.phoneVerified ?? true, emailVerified: profile.emailVerified ?? false, referralCode: profile.accountType === "driver" ? profile.referralCode ?? undefined : undefined, country: profile.country ?? undefined, city: profile.city ?? undefined, accountStatus: profile.status ?? "active", accountStatusReason: profile.statusReason ?? undefined, deletionRequestedAt: profile.deletionRequestedAt?.toISOString(), deletionScheduledAt: deletionScheduledAt?.toISOString() };
}

function sessionCountryCode(profilePhone: string) {
  return findCountryForPhone(profilePhone).id;
}

async function syncDeliveryParticipants(delivery: Pick<ResolvedDelivery, "id" | "senderPhone" | "driverPhone">) {
  const [sender, driver] = await Promise.all([delivery.senderPhone ? db.getTikisseProfileByPhone(delivery.senderPhone) : Promise.resolve(undefined), delivery.driverPhone ? db.getTikisseProfileByPhone(delivery.driverPhone) : Promise.resolve(undefined)]);
  const members = [sender?.supabaseUserId ? { userId: sender.supabaseUserId, role: "sender" as const } : null, driver?.supabaseUserId ? { userId: driver.supabaseUserId, role: "driver" as const } : null].filter((member): member is { userId: string; role: "sender" | "driver" } => member !== null);
  void syncDeliveryRealtimeMembers(delivery.id, members);
}

const GEO_RATE_LIMIT_WINDOW_MS = 60_000;
const GEO_RATE_LIMIT_MAX_REQUESTS = 40;

// Distribué (table partagée entre toutes les instances du serveur) : un compteur en mémoire de
// processus ne protège que l'instance qui le détient — un client réparti sur plusieurs connexions
// pouvait multiplier la limite effective par le nombre d'instances derrière le load balancer.
async function enforceGeographyRateLimit(profilePhone: string) {
  const withinLimit = await db.checkDistributedRateLimit("geo", profilePhone, GEO_RATE_LIMIT_WINDOW_MS, GEO_RATE_LIMIT_MAX_REQUESTS);
  if (!withinLimit) {
    recordGeographicMetric("search", "rate_limited");
    throw new Error("Trop de demandes de lieux en cours. Réessayez dans une minute.");
  }
}

/**
 * Limites du paiement Mobile Money, par profil et par quart d'heure.
 *
 * Chaque demande de dépôt peut faire partir un SMS vers le numéro saisi — n'importe lequel, pas forcément
 * celui du compte —, le renvoi d'OTP aussi, et la saisie du code se prête aux essais en série. Sans limite,
 * un compte pouvait arroser de SMS le numéro d'un tiers, ou tenter des codes à la chaîne.
 */
const PAYMENT_RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const PAYMENT_RATE_LIMITS = { request: 6, resendOtp: 3, submitOtp: 8, checkout: 10 } as const;

async function enforcePaymentRateLimit(action: keyof typeof PAYMENT_RATE_LIMITS, profilePhone: string) {
  const withinLimit = await db.checkDistributedRateLimit(`payment:${action}`, profilePhone, PAYMENT_RATE_LIMIT_WINDOW_MS, PAYMENT_RATE_LIMITS[action]);
  if (!withinLimit) throw new Error("Trop de tentatives de paiement en peu de temps. Réessayez dans quelques minutes.");
}

const protectedGeographyProcedure = tikisseProtectedProcedure.use(async ({ ctx, next }) => {
  await enforceGeographyRateLimit(ctx.tikisseProfilePhone);
  return next();
});

function newReferralCode(fullName: string) {
  const prefix = fullName.normalize("NFC").replace(/[^\p{L}]/gu, "").toLocaleUpperCase("fr-FR").slice(0, 3);
  return `${prefix}${String(randomInt(0, 100000000)).padStart(8 - prefix.length, "0")}`.slice(0, 8);
}

async function generateUniqueReferralCode(fullName: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = newReferralCode(fullName);
    if (!await db.getTikisseProfileByReferralCode(code)) return code;
  }
  throw new Error("Impossible de générer un code de parrainage unique.");
}

const photoMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
const base64ImageSchema = z.string().min(32).max(1_600_000).regex(/^[A-Za-z0-9+/=]+$/, "Données d’image invalides.");
/** Schéma d'image KYC : 5 MB binaire max ≈ 6.7 MB base64 (4/3 expansion).
 *  3 images KYC = 20 MB max par soumission, contrôlé dans la mutation submit. */
const kycBase64ImageSchema = z.string().min(32).max(6_700_000).regex(/^[A-Za-z0-9+/=]+$/, "Données d’image invalides.");
const coordinateSchema = z.number().finite();
// Mêmes valeurs que LocationLabel["featureType"]/["precision"] (shared/tikisse-domain.ts) : transmettre la
// classification déjà connue côté client évite qu'elle ne soit perdue (dégradée à "unknown") à la persistance
// pour les lieux issus du repli communautaire (OpenStreetMap/Mapbox direct), qui ne repassent jamais par
// resolve/reverse avant d'atteindre deliveries.create ou geography.savePlace.
const featureTypeSchema = z.enum(["address", "secondary_address", "poi", "street", "neighborhood", "locality", "place", "point", "unknown"]);
const precisionSchema = z.enum(["exact", "street", "area", "city", "unknown"]);
const placeSchema = z.object({ name: z.string().max(140), district: z.string().max(120), city: z.string().max(120), latitude: coordinateSchema.min(-90).max(90), longitude: coordinateSchema.min(-180).max(180), googlePlaceId: z.string().max(255).optional(), mapboxId: z.string().max(255).optional(), mapboxSessionToken: z.string().uuid().optional(), formattedAddress: z.string().max(255).optional(), street: z.string().max(160).optional(), province: z.string().max(120).optional(), country: z.string().max(120).optional(), source: z.enum(["search", "retrieve", "reverse", "forward", "favorite", "manual", "legacy"]).optional(), featureType: featureTypeSchema.optional(), precision: precisionSchema.optional() });
const favoriteLabelSchema = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}]+(?:[ .,'’()\-][\p{L}\p{N}]+)*$/u, "Libellé de favori invalide.");
const deliveryTextSchema = z.string().trim().min(3).max(450);
// Les consignes sont facultatives (voir "Consignes — facultatif" côté client) : ni le champ, ni la base
// (colonne NOT NULL mais sans longueur minimale) n'exigent de contenu. Un `min(3)` ici a longtemps fait
// échouer silencieusement toute publication où le champ était laissé vide.
const deliveryDetailsSchema = z.string().trim().max(450);
const deliveryVehicleSchema = z.enum(["Vélo", "Moto", "Tricycle", "Voiture"]);
const deliveryInputSchema = z.object({
  title: deliveryTextSchema.max(120),
  details: deliveryDetailsSchema,
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

async function currentTikisseProfile(phone: string) {
  const profile = await db.getTikisseProfileByPhone(phone);
  if (!profile) throw new Error("Votre profil Tikisse est introuvable. Connectez-vous de nouveau.");
  return profile;
}

async function saveDeliveryPlace(place: z.infer<typeof placeSchema>) {
  // `placeSchema` ne contrôle que la longueur, jamais le contenu : un appel API direct (hors app) pourrait
  // sinon persister des caractères de contrôle ou des espaces multiples, visibles ensuite par toute la
  // communauté d'utilisateurs qui reverrait ce lieu via le cache par coordonnée/mapboxId.
  const name = sanitizePlaceText(place.name);
  const formattedAddress = place.formattedAddress ? sanitizePlaceText(place.formattedAddress, 255) : undefined;
  return db.saveTikissePlace({
    googlePlaceId: place.googlePlaceId,
    mapboxPlaceId: place.mapboxId,
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    formattedAddress: formattedAddress ?? name,
    placeName: name,
    street: place.street ? sanitizePlaceText(place.street) : undefined,
    district: sanitizePlaceText(place.district),
    city: sanitizePlaceText(place.city),
    province: place.province ? sanitizePlaceText(place.province) : undefined,
    country: place.country ? sanitizePlaceText(place.country) : undefined,
    provider: place.mapboxId ? "mapbox" : "manual",
    source: place.source ?? (place.mapboxId ? "retrieve" : "manual"),
    featureType: place.featureType ?? "unknown",
    precision: place.precision ?? "unknown",
  });
}

type ResolvedDelivery = NonNullable<Awaited<ReturnType<typeof db.getTikisseDeliveryById>>>;

function deliveryForProfile(delivery: ResolvedDelivery, profile: Awaited<ReturnType<typeof currentTikisseProfile>>): ResolvedDelivery {
  if (profile.accountType === "sender") return { ...delivery, routeVisibility: "exact" };
  const maySeeExactRoute = delivery.driverId === profile.phone && (delivery.status === "active" || delivery.status === "completed");
  if (maySeeExactRoute) return { ...delivery, routeVisibility: "exact" };
  return {
    ...delivery,
    pickup: concealPlaceForDriver(delivery.pickup),
    dropoff: concealPlaceForDriver(delivery.dropoff),
    senderName: "Expéditeur Tikisse",
    senderPhone: undefined,
    driverName: undefined,
    driverPhone: undefined,
    routeVisibility: "approximate",
  };
}

/**
 * Le numéro d'un candidat n'est révélé à l'expéditeur qu'une fois attribué —
 * symétrique à `deliveryForProfile`, qui masque les coordonnées du côté
 * livreur jusqu'à l'attribution. Avant sa sélection, le candidat n'est encore
 * qu'une proposition parmi d'autres : rien dans le client n'a besoin de son
 * numéro pour l'afficher (l'écran de choix travaille sur `candidate.id`, la
 * sélection envoie `candidateId`, jamais le numéro) ni pour le sélectionner.
 * `candidate.id` tient lieu d'identifiant stable tant que le numéro reste caché.
 */
function candidateForSender(candidate: DriverCandidate): DriverCandidate {
  const attributed = candidate.status === "selected" || candidate.status === "confirmed";
  if (attributed) return candidate;
  return { ...candidate, driverId: candidate.id };
}

export const appRouter = router({
  adminConsole: tikisseAdminRouter,
  platform: router({
    maintenanceStatus: publicProcedure.query(() => db.getMaintenanceStatus()),
  }),
  loyalty: router({
    myProgress: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
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
    logout: publicProcedure.mutation(({ ctx }) => {
      clearTikisseProfileCookie(ctx.res, ctx.req);
      return { success: true } as const;
    }),
  }),
  sessions: router({
    /** Prolonge la session d'un an quand son jeton a plus d'une semaine (web : nouveau cookie ; mobile :
     *  nouveau jeton à stocker). Une session révoquée n'arrive pas jusqu'ici (tikisseProtectedProcedure). */
    renew: tikisseProtectedProcedure.mutation(async ({ ctx }) => {
      const token = pickTikisseSessionToken({ req: ctx.req, res: ctx.res } as Parameters<typeof pickTikisseSessionToken>[0]);
      const claims = await verifyTikisseProfileSessionClaims(token);
      if (!token || !claims || claims.phone !== ctx.tikisseProfilePhone || !shouldRenewSession(claims.issuedAt)) return { renewed: false as const };
      const sessionToken = await createTikisseProfileSession(claims.phone);
      const { replaceSessionToken } = await import("./sessions");
      await replaceSessionToken({ phone: claims.phone, oldToken: token, newToken: sessionToken }).catch(() => undefined);
      setTikisseProfileCookie(ctx.res, ctx.req, sessionToken);
      return { renewed: true as const, sessionToken };
    }),
    registerCurrent: tikisseProtectedProcedure.input(z.object({
      deviceName: z.string().max(120).optional(),
      platform: z.enum(["ios", "android", "web", "unknown"]).default("unknown"),
      appVersion: z.string().max(40).optional(),
    }).optional()).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      // Repli sur l'ancien nom d'en-tête inclus (app mobile pas encore mise à jour, cf. getTikisseSessionTokenFromHeaders).
      const token = getTikisseSessionTokenFromHeaders(ctx.req.headers);
      if (!token) return { id: null, created: false };
      const { recordSession } = await import("./sessions");
      const ipAddress = (ctx.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? ctx.req.socket?.remoteAddress ?? undefined;
      return recordSession({ phone: profile.phone, token, deviceName: input?.deviceName, platform: input?.platform, appVersion: input?.appVersion, ipAddress });
    }),
    list: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      // Repli sur l'ancien nom d'en-tête inclus (app mobile pas encore mise à jour, cf. getTikisseSessionTokenFromHeaders).
      const token = getTikisseSessionTokenFromHeaders(ctx.req.headers);
      if (!token) return [];
      const { hashSessionToken, listActiveSessions } = await import("./sessions");
      return listActiveSessions({ phone: profile.phone, currentTokenHash: hashSessionToken(token) });
    }),
    revoke: tikisseProtectedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      // Repli sur l'ancien nom d'en-tête inclus (app mobile pas encore mise à jour, cf. getTikisseSessionTokenFromHeaders).
      const token = getTikisseSessionTokenFromHeaders(ctx.req.headers);
      if (!token) throw new Error("Session non identifiée.");
      const { hashSessionToken, revokeSession } = await import("./sessions");
      return revokeSession({ phone: profile.phone, sessionId: input.sessionId, currentTokenHash: hashSessionToken(token) });
    }),
    revokeAllOthers: tikisseProtectedProcedure.mutation(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      // Repli sur l'ancien nom d'en-tête inclus (app mobile pas encore mise à jour, cf. getTikisseSessionTokenFromHeaders).
      const token = getTikisseSessionTokenFromHeaders(ctx.req.headers);
      if (!token) throw new Error("Session non identifiée.");
      const { hashSessionToken, revokeAllOtherSessions } = await import("./sessions");
      return revokeAllOtherSessions({ phone: profile.phone, currentTokenHash: hashSessionToken(token) });
    }),
  }),
  profiles: router({
    /** Called after local OTP verification in the simulation flow. A production build must verify OTP server-side before this query. */
    lookup: publicProcedure.input(z.object({ phone: phoneSchema, otp: simulationOtpSchema })).mutation(async ({ input, ctx }) => {
      await enforcePerIpRateLimit(ctx.req);
      await enforcePerPhoneRateLimit("lookup", input.phone);
      const found = await db.getTikisseProfileByPhone(input.phone);
      if (found) assertProfileNotBlocked(found);
      if (!found) return null;
      const profile = await withCountryFromPhone(found);
      const sessionToken = await createTikisseProfileSession(profile.phone);
      setTikisseProfileCookie(ctx.res, ctx.req, sessionToken);
      return { profile: toPublicProfile(profile), sessionToken };
    }),
    lookupSupabase: publicProcedure.input(z.object({ phone: phoneSchema, accessToken: supabaseAccessTokenSchema })).mutation(async ({ input, ctx }) => {
      await enforcePerIpRateLimit(ctx.req);
      await enforcePerPhoneRateLimit("lookupSupabase", input.phone);
      const supabaseUserId = await verifySupabasePhoneSession(input.phone, input.accessToken);
      const profile = await db.getTikisseProfileByPhone(input.phone);
      if (!profile) return null;
      assertProfileNotBlocked(profile);
      const linked = await withCountryFromPhone(await db.linkTikisseProfileToSupabaseUser(profile.phone, supabaseUserId));
      const sessionToken = await createTikisseProfileSession(linked.phone);
      setTikisseProfileCookie(ctx.res, ctx.req, sessionToken);
      return { profile: toPublicProfile(linked), sessionToken };
    }),
    register: publicProcedure.input(registrationInputSchema).mutation(async ({ input, ctx }) => {
      await enforcePerIpRateLimit(ctx.req);
      await enforcePerPhoneRateLimit("register", input.phone);
      await assertCountryEnabled(input.countryCode);
      const city = input.city ? await geography.resolveSignupCity(input.city, input.countryCode) : null;
      const referralCode = input.role === "driver" ? await generateUniqueReferralCode(input.fullName) : undefined;
      const profile = await db.createTikisseProfile({
        phone: input.phone,
        fullName: input.fullName,
        accountType: input.role,
        vehicles: JSON.stringify(input.role === "driver" ? input.vehicles : []),
        referralCode,
        country: input.countryCode,
        city,
      });
      await db.createReferralIfCodeProvided(profile.phone, input.referredByCode);
      const sessionToken = await createTikisseProfileSession(profile.phone);
      setTikisseProfileCookie(ctx.res, ctx.req, sessionToken);
      return { profile: toPublicProfile(profile), sessionToken };
    }),
    registerSupabase: publicProcedure.input(profileFieldsSchema.extend({ accessToken: supabaseAccessTokenSchema }).superRefine(validateProfileRole)).mutation(async ({ input, ctx }) => {
      await enforcePerIpRateLimit(ctx.req);
      await enforcePerPhoneRateLimit("registerSupabase", input.phone);
      await assertCountryEnabled(input.countryCode);
      const supabaseUserId = await verifySupabasePhoneSession(input.phone, input.accessToken);
      const city = input.city ? await geography.resolveSignupCity(input.city, input.countryCode) : null;
      const referralCode = input.role === "driver" ? await generateUniqueReferralCode(input.fullName) : undefined;
      const profile = await db.createTikisseProfile({ phone: input.phone, fullName: input.fullName, accountType: input.role, vehicles: JSON.stringify(input.role === "driver" ? input.vehicles : []), referralCode, supabaseUserId, country: input.countryCode, city });
      const linked = await db.linkTikisseProfileToSupabaseUser(profile.phone, supabaseUserId);
      await db.createReferralIfCodeProvided(linked.phone, input.referredByCode);
      const sessionToken = await createTikisseProfileSession(linked.phone);
      setTikisseProfileCookie(ctx.res, ctx.req, sessionToken);
      return { profile: toPublicProfile(linked), sessionToken };
    }),
    // Authentifiée par la session Tikisse, pas par le code de simulation : en mode « real » ce code est refusé,
    // et en simulation il est public — n'importe qui aurait pu modifier le profil d'un autre numéro.
    // `phone` et `otp` restent acceptés (anciennes versions de l'application) mais ne donnent aucun droit.
    update: tikisseProtectedProcedure.input(z.object({ phone: phoneSchema.optional(), otp: z.string().optional(), fullName: fullNameSchema.optional(), photoBase64: base64ImageSchema.optional(), photoMime: photoMimeSchema.optional(), country: z.string().length(2).optional(), city: z.string().trim().min(2).max(80).optional() }).superRefine((value, ctx) => {
      if (!value.fullName && !value.photoBase64 && !value.country && !value.city) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Aucune modification à enregistrer." });
      if (value.photoBase64 && !value.photoMime) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["photoMime"], message: "Type d’image requis." });
    })).mutation(async ({ input: rawInput, ctx }) => {
      if (rawInput.phone && rawInput.phone !== ctx.tikisseProfilePhone) throw new TRPCError({ code: "FORBIDDEN", message: "Ce profil n’est pas le vôtre." });
      const input = { ...rawInput, phone: ctx.tikisseProfilePhone };
      await enforcePerIpRateLimit(ctx.req);
      await enforcePerPhoneRateLimit("update", input.phone);
      let photoKey: string | null | undefined;
      if (input.photoBase64 && input.photoMime) {
        const bytes = Buffer.from(input.photoBase64, "base64");
        if (bytes.length > 1_000_000) throw new Error("La photo est trop volumineuse.");
        const extension = input.photoMime === "image/png" ? "png" : input.photoMime === "image/webp" ? "webp" : "jpg";
        const safePhone = input.phone.replace(/[^0-9]/g, "");
        const stored = await storagePut(`tikisse-profiles/${safePhone}/avatar.${extension}`, bytes, input.photoMime);
        photoKey = stored.key;
      }
      const current = await db.getTikisseProfileByPhone(input.phone);
      if (!current) throw new Error("Profil introuvable. Connectez-vous de nouveau pour le créer.");
      if (input.country) await assertCountryEnabled(input.country);
      const nextCountry = input.country ?? current.country;
      const countryChanged = Boolean(input.country && input.country !== current.country);
      const nextCity = countryChanged ? null : input.city ?? current.city;
      if (input.city && (!nextCountry || !(await geography.cityBelongsToCountry(input.city, nextCountry)))) {
        throw new Error("Cette ville n’appartient pas au pays sélectionné.");
      }
      const profile = await db.updateTikisseProfile(input.phone, { fullName: input.fullName ?? current.fullName, photoKey: photoKey ?? current.photoKey, country: nextCountry, city: nextCity });
      return toPublicProfile(profile);
    }),
    updateVehicles: tikisseProtectedProcedure.input(z.object({ vehicles: z.array(vehicleSchema).min(1).max(5) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seuls les livreurs peuvent gérer leurs engins.");
      const updated = await db.updateTikisseProfile(profile.phone, { vehicles: JSON.stringify(input.vehicles) });
      return toPublicProfile(updated);
    }),
    /** Établit (ou réutilise) une session Supabase Auth pour ce profil, quel que soit son parcours
     *  d'authentification Tikisse — voir server/supabase-admin-auth.ts. Le client l'appelle une fois
     *  au démarrage puis applique la session obtenue (supabase.auth.setSession) : sans elle, les
     *  canaux Realtime privés (server/supabase-realtime.ts) échouent à s'authentifier en silence.
     *  `null` quand Supabase n'est pas configuré ou que l'établissement échoue — jamais une erreur :
     *  rien côté Tikisse ne dépend de cette session, le client retombe sur le polling existant. */
    ensureRealtimeSession: tikisseProtectedProcedure.mutation(async ({ ctx }) => {
      const { ensureSupabaseRealtimeSession } = await import("./supabase-admin-auth");
      return ensureSupabaseRealtimeSession(ctx.tikisseProfilePhone);
    }),
    /** Accessible même si le compte est banni/suspendu : c'est ce qui permet à l'app de savoir
     *  quel écran dédié afficher (banni, suppression en cours) sans passer par les routes bloquées. */
    status: tikisseSessionProcedure.query(async ({ ctx }) => {
      const profile = await db.getTikisseProfileByPhone(ctx.tikisseProfilePhone);
      if (!profile) throw new Error("Profil introuvable.");
      return toPublicProfile(profile);
    }),
    requestDeletion: tikisseSessionProcedure.mutation(async ({ ctx }) => {
      const profile = await db.requestProfileDeletion(ctx.tikisseProfilePhone);
      return toPublicProfile(profile);
    }),
    cancelDeletion: tikisseSessionProcedure.mutation(async ({ ctx }) => {
      const profile = await db.cancelProfileDeletion(ctx.tikisseProfilePhone);
      return toPublicProfile(profile);
    }),
    requestContactOtp: publicProcedure.input(z.object({
      kind: z.enum(["phone", "email"]),
      value: z.string().min(3).max(180),
      phone: phoneSchema,
    })).mutation(async ({ input, ctx }) => {
      await enforcePerIpRateLimit(ctx.req);
      await enforcePerPhoneRateLimit("requestContactOtp", input.phone);
      if (input.kind === "phone") {
        if (!/^\+?[0-9 ]{8,20}$/.test(input.value.trim())) throw new Error("Numéro de téléphone invalide.");
      } else {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) throw new Error("Adresse e-mail invalide.");
      }
      return { ok: true, demoOtp: SIMULATION_OTP };
    }),
    // Authentifiée par la session Tikisse (avant : numéro + code de simulation public, refusé en mode « real »).
    // Aucun e-mail n'est encore envoyé pour confirmer l'adresse : en mode « real », elle est enregistrée
    // comme non vérifiée ; en simulation, le code de démonstration fait office de confirmation.
    updateContact: tikisseProtectedProcedure.input(z.object({
      kind: z.enum(["phone", "email"]),
      value: z.string().min(3).max(180),
      otp: z.string().min(6).max(6).optional(),
      phone: phoneSchema.optional(),
      sessionOtp: z.string().optional(),
    })).mutation(async ({ input: rawInput, ctx }) => {
      if (rawInput.phone && rawInput.phone !== ctx.tikisseProfilePhone) throw new TRPCError({ code: "FORBIDDEN", message: "Ce profil n’est pas le vôtre." });
      const input = { ...rawInput, phone: ctx.tikisseProfilePhone };
      await enforcePerIpRateLimit(ctx.req);
      await enforcePerPhoneRateLimit("updateContact", input.phone);
      if (OTP_MODE === "sim" && input.otp !== SIMULATION_OTP) throw new Error("Code de confirmation invalide.");
      const current = await db.getTikisseProfileByPhone(input.phone);
      if (!current) throw new Error("Profil introuvable.");
      if (input.kind === "phone") {
        if (!/^\+?[0-9 ]{8,20}$/.test(input.value.trim())) throw new Error("Numéro de téléphone invalide.");
        if (input.value.trim() !== current.phone) throw new Error("La modification du numéro de connexion nécessite une vérification d’identité. Contactez l’assistance Tikisse.");
        return toPublicProfile(current);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) throw new Error("Adresse e-mail invalide.");
      const updated = await db.updateTikisseProfile(input.phone, { email: input.value.trim().toLocaleLowerCase("fr-FR"), emailVerified: OTP_MODE === "sim" });
      return toPublicProfile(updated);
    }),
  }),
  geography: router({
    search: protectedGeographyProcedure.input(z.object({ query: z.string().min(2).max(120), countryCode: countryCodeSchema.optional(), biasLatitude: coordinateSchema.min(-90).max(90).optional(), biasLongitude: coordinateSchema.min(-180).max(180).optional(), includeCommunityFallback: z.boolean().optional() })).mutation(async ({ ctx, input }) => geography.searchPlaces(input.query, input.biasLatitude !== undefined && input.biasLongitude !== undefined ? { latitude: input.biasLatitude, longitude: input.biasLongitude } : undefined, sessionCountryCode(ctx.tikisseProfilePhone), input.includeCommunityFallback === true)),
    resolve: protectedGeographyProcedure.input(z.object({ mapboxId: z.string().min(1).max(255), mapboxSessionToken: z.string().uuid().optional() })).mutation(async ({ ctx, input }) => geography.resolveMapboxPlace(input.mapboxId, input.mapboxSessionToken, sessionCountryCode(ctx.tikisseProfilePhone))),
    geocode: protectedGeographyProcedure.input(z.object({ address: z.string().min(3).max(180) })).mutation(async ({ ctx, input }) => geography.geocodeAddress(input.address, sessionCountryCode(ctx.tikisseProfilePhone))),
    reverse: protectedGeographyProcedure.input(z.object({ latitude: coordinateSchema.min(-90).max(90), longitude: coordinateSchema.min(-180).max(180) })).mutation(async ({ ctx, input }) => geography.reverseGeocodeLocation(input.latitude, input.longitude, sessionCountryCode(ctx.tikisseProfilePhone))),
    route: protectedGeographyProcedure.input(z.object({ origin: placeSchema, destination: placeSchema })).mutation(async ({ input }) => geography.computeRoute(input.origin, input.destination)),
    pricingConfig: tikisseProtectedProcedure.query(() => adminDb.adminGetPricingConfig()),
    countries: publicProcedure.query(() => db.listSupportedCountries()),
    // Avant la connexion (étape « nom et ville » de l'inscription) : publique, donc limitée par adresse IP
    // — chaque recherche interroge le service de cartes, facturé.
    signupCities: publicProcedure.input(z.object({ query: z.string().min(2).max(80), countryCode: countryCodeSchema })).query(async ({ ctx, input }) => {
      const ip = clientIp(ctx.req ?? {});
      if (ip !== "unknown" && !(await db.checkDistributedRateLimit("signup-cities", ip, 10 * 60_000, 120))) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Trop de recherches. Réessayez dans quelques minutes." });
      }
      return geography.searchCities(input.query, input.countryCode);
    }),
    searchCities: tikisseProtectedProcedure.input(z.object({ query: z.string().min(2).max(80), countryCode: z.string().length(2) })).query(({ input }) => geography.searchCities(input.query, input.countryCode)),
    // Identique à `saveDeliveryPlace` (même schéma, même sanitization, même persistance) : un seul
    // chemin d'écriture des lieux, pour ne jamais laisser deux logiques diverger silencieusement.
    savePlace: protectedGeographyProcedure.input(placeSchema).mutation(async ({ input }) => saveDeliveryPlace(input)),
    favorites: router({
      list: tikisseProtectedProcedure.query(({ ctx }) => db.listFavoritePlaces(ctx.tikisseProfilePhone)),
      add: tikisseProtectedProcedure.input(z.object({ placeId: z.number().int().positive(), label: favoriteLabelSchema })).mutation(async ({ ctx, input }) => db.saveFavoritePlace(ctx.tikisseProfilePhone, input.placeId, input.label)),
      rename: tikisseProtectedProcedure.input(z.object({ favoriteId: z.number().int().positive(), label: favoriteLabelSchema })).mutation(async ({ ctx, input }) => db.renameFavoritePlace(ctx.tikisseProfilePhone, input.favoriteId, input.label)),
      remove: tikisseProtectedProcedure.input(z.object({ favoriteId: z.number().int().positive() })).mutation(async ({ ctx, input }) => db.deleteFavoritePlace(ctx.tikisseProfilePhone, input.favoriteId)),
    }),
  }),
  deliveries: router({
    list: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const deliveries = await db.listTikisseDeliveriesForProfile(profile.phone, profile.accountType);
      if (profile.accountType !== "driver") {
        const candidateCounts = await db.countTikisseDeliveryCandidates(deliveries.map((delivery) => delivery.id));
        return deliveries.map((delivery) => ({ ...deliveryForProfile(delivery, profile), candidateCount: candidateCounts.get(delivery.id) ?? 0 }));
      }
      // Calculé sur l'ensemble de `deliveries` (avant le filtre de compatibilité) : un candidat non
      // retenu doit retrouver sa propre candidature même si son engin ne correspondrait plus au filtre
      // (la compatibilité au moment de candidater suffit, elle ne se réévalue pas après coup).
      const candidatesByDelivery = await db.listTikisseDeliveryCandidateStatesForDriver(deliveries.map((delivery) => delivery.id), profile.phone);
      const compatible = deliveries.filter((delivery) => delivery.driverId === profile.phone || candidatesByDelivery.has(delivery.id) || delivery.vehicleTypes.some((vehicle) => {
        try { return JSON.parse(profile.vehicles).includes(vehicle); } catch { return false; }
      }));
      // L'ordre est arrêté ici, une fois `ownCandidateStatus` connu : c'est lui qui
      // distingue une annonce d'une course déjà engagée. Le classement lui-même
      // vit dans `shared/`, pour que les deux écrans d'accueil s'y réfèrent.
      return sortDriverOpportunities(compatible.map((delivery) => {
        const candidate = candidatesByDelivery.get(delivery.id);
        return { ...deliveryForProfile(delivery, profile), ...(candidate ? { ownCandidateStatus: candidate.status } : {}) };
      }));
    }),
    get: tikisseProtectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const record = await db.getTikisseDeliveryRecordById(input.id);
      const delivery = await db.getTikisseDeliveryById(input.id);
      if (!record || !delivery) throw new Error("Livraison introuvable.");
      if (profile.accountType === "sender" && record.senderPhone !== profile.phone) throw new Error("Cette livraison ne vous appartient pas.");
      if (profile.accountType === "driver" && record.status !== "open" && record.driverPhone !== profile.phone) {
        const candidate = await db.getTikisseDeliveryCandidateForDriver(delivery.id, profile.phone);
        if (!candidate || candidate.status === "withdrawn") throw new Error("Cette livraison n’est pas accessible.");
      }
      return deliveryForProfile(delivery, profile);
    }),
    livePosition: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const record = await db.getTikisseDeliveryRecordById(input.deliveryId);
      if (!record || record.status !== "active" || !record.driverPhone) return null;
      const isParticipant = profile.accountType === "sender"
        ? record.senderPhone === profile.phone
        : record.driverPhone === profile.phone;
      if (!isParticipant) throw new Error("Cette position n’est pas accessible.");
      return db.getTikisseDeliveryLiveLocation(input.deliveryId);
    }),
    driverStats: tikisseProtectedProcedure.input(z.object({ driverPhone: phoneSchema })).query(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const record = await db.getTikisseProfileByPhone(input.driverPhone);
      if (!record) throw new Error("Livreur introuvable.");
      if (record.accountType !== "driver") throw new Error("Ce profil n'est pas un livreur.");
      const isSelf = profile.phone === input.driverPhone;
      const isParticipant = isSelf || profile.accountType === "sender";
      if (!isParticipant) throw new Error("Accès non autorisé.");
      return db.getTikisseDriverStats(input.driverPhone);
    }),
    updateLivePosition: tikisseProtectedProcedure.input(z.object({
      deliveryId: z.string().uuid(),
      latitude: coordinateSchema.min(-90).max(90),
      longitude: coordinateSchema.min(-180).max(180),
      heading: z.number().finite().min(0).max(360),
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seul le livreur assigné peut partager sa position.");
      const countryCode = profile.country ?? findCountryForPhone(profile.phone).id;
      if (!isCoordinateInCountry(input.latitude, input.longitude, countryCode)) {
        throw new Error(LIVE_POSITION_OUT_OF_ZONE_ERR_MSG);
      }
      const previous = await db.getTikisseDeliveryLiveLocation(input.deliveryId);
      if (previous) {
        const distanceKm = haversineDistanceKm(previous.latitude, previous.longitude, input.latitude, input.longitude);
        const elapsedSec = (Date.now() - new Date(previous.recordedAt).getTime()) / 1000;
        const maxAllowedKm = Math.max(0.05, 0.055 * Math.max(elapsedSec, 1));
        if (distanceKm > maxAllowedKm) {
          throw new Error(LIVE_POSITION_GPS_JUMP_ERR_MSG);
        }
      }
      const position = await db.saveTikisseDeliveryLiveLocation({ ...input, driverPhone: profile.phone });
      void publishDeliveryPositionBroadcast({ deliveryId: input.deliveryId, ...position });
      return position;
    }),
    create: tikisseProtectedProcedure.input(deliveryInputSchema).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul un expéditeur peut publier une livraison.");
      try {
        const [pickup, dropoff] = await Promise.all([saveDeliveryPlace(input.pickup), saveDeliveryPlace(input.dropoff)]);
        const delivery = await db.createTikisseDelivery({
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
        // Sans ceci, l'expéditeur ne devient membre du canal Realtime privé qu'à la première
        // modification de la livraison (syncDeliveryParticipants n'était jusqu'ici appelé que par
        // `update`), laissant la phase "en attente de candidatures" sans mise à jour temps réel.
        await syncDeliveryParticipants({ id: delivery.id, senderPhone: delivery.senderPhone, driverPhone: delivery.driverPhone ?? undefined } as ResolvedDelivery);
        void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livraison publiée", body: "Votre livraison est visible par les livreurs compatibles.", occurredAt: new Date().toISOString() });
        return delivery;
      } catch (cause) {
        console.error("[deliveries.create] failed", cause);
        if (cause instanceof Error) throw cause;
        throw new Error("Publication indisponible. Vérifiez votre connexion puis réessayez.");
      }
    }),
    candidates: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const record = await db.getTikisseDeliveryRecordById(input.deliveryId);
      const delivery = await db.getTikisseDeliveryById(input.deliveryId);
      if (!record || !delivery) throw new Error("Livraison introuvable.");
      const candidates = await db.listTikisseDeliveryCandidates(input.deliveryId);
      if (profile.accountType === "sender") {
        if (record.senderPhone !== profile.phone) throw new Error("Cette livraison ne vous appartient pas.");
        return candidates.map(candidateForSender);
      }
      return candidates.filter((candidate) => candidate.driverId === profile.phone);
    }),
    submitApplication: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid(), confirmedCommission: z.number().int().positive().max(10_000_000), offerPrice: z.number().int().positive().max(10_000_000).optional() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seul un livreur peut candidater.");
      if (!profile.photoKey) throw new Error("Votre profil doit avoir une photo avant de candidater à une livraison.");
      // Avant ce contrôle, seule la photo de profil était exigée : le message promettait une
      // « pièce d'identité » vérifiée que rien ne vérifiait jamais. `kyc.submit` capture les
      // documents, mais un dossier `submitted` n'a encore été regardé par personne — seul
      // `approved` (décision d'un admin, `adminReviewKyc`) atteste réellement de l'identité.
      const kyc = await db.getLatestKycSubmission(profile.phone);
      if (kyc?.status !== "approved") throw new Error("Votre identité doit être vérifiée avant de candidater à une livraison. Soumettez vos documents depuis votre profil.");
      const result = await db.applyForTikisseDelivery({ id: randomUUID(), deliveryId: input.deliveryId, driverPhone: profile.phone, confirmedCommission: input.confirmedCommission, ...(input.offerPrice ? { offerPrice: input.offerPrice } : {}) });
      // Sans ce signal, la feuille de candidatures d'un Sender déjà ouverte sur l'écran détail ne
      // voyait jamais apparaître une nouvelle candidature sans rafraîchissement manuel.
      void publishDeliveryStatusBroadcast({ deliveryId: input.deliveryId, status: "open", title: "Nouvelle candidature", body: "Un livreur compatible s’est proposé pour votre livraison.", occurredAt: new Date().toISOString() });
      return result;
    }),
    update: tikisseProtectedProcedure.input(deliveryInputSchema.safeExtend({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut modifier une livraison.");
      const [pickup, dropoff] = await Promise.all([saveDeliveryPlace(input.pickup), saveDeliveryPlace(input.dropoff)]);
      const delivery = await db.updateTikisseDeliveryFromSender({
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
        const record = await db.getTikisseDeliveryRecordById(delivery.id);
        if (record) await syncDeliveryParticipants({ id: delivery.id, senderPhone: record.senderPhone, driverPhone: record.driverPhone ?? undefined } as ResolvedDelivery);
        void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livraison mise à jour", body: "Les informations de la livraison ont été actualisées.", occurredAt: new Date().toISOString() });
      }
      return delivery;
    }),
    disable: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut désactiver une livraison.");
      const delivery = await db.disableTikisseDeliveryFromSender(input.deliveryId, profile.phone);
      if (delivery) void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livraison désactivée", body: "La livraison n’accepte plus de candidatures.", occurredAt: new Date().toISOString() });
      return delivery;
    }),
    reactivate: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut activer une livraison.");
      const delivery = await db.reactivateTikisseDeliveryFromSender(input.deliveryId, profile.phone);
      if (delivery) void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livraison activée", body: "La livraison est à nouveau disponible pour les livreurs compatibles.", occurredAt: new Date().toISOString() });
      return delivery;
    }),
    cancel: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut annuler une livraison.");
      const delivery = await db.cancelTikisseDeliveryFromSender(input.deliveryId, profile.phone);
      if (delivery) void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livraison annulée", body: "Cette livraison a été annulée par l’expéditeur.", occurredAt: new Date().toISOString() });
      return delivery;
    }),
    withdraw: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seul un livreur peut retirer sa candidature.");
      const result = await db.withdrawTikisseDeliveryCandidateWithWallet(input.deliveryId, profile.phone);
      void publishDeliveryStatusBroadcast({ deliveryId: input.deliveryId, status: "open", title: "Candidature retirée", body: "Un livreur a retiré sa candidature.", occurredAt: new Date().toISOString() });
      return result;
    }),
    selectCandidate: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid(), candidateId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut choisir un livreur.");
      const delivery = await db.selectTikisseDeliveryCandidateWithWallet(input.deliveryId, input.candidateId, profile.phone);
      if (delivery) { await syncDeliveryParticipants(delivery); void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Livreur sélectionné", body: "La livraison attend la confirmation du livreur.", occurredAt: new Date().toISOString() }); }
      return delivery;
    }),
    unselectCandidate: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "sender") throw new Error("Seul l’expéditeur peut annuler son choix de livreur.");
      const delivery = await db.unselectTikisseDeliveryCandidateFromSender(input.deliveryId, profile.phone);
      if (delivery) { await syncDeliveryParticipants(delivery); void publishDeliveryStatusBroadcast({ deliveryId: delivery.id, status: delivery.status, title: "Choix annulé", body: "L’expéditeur a annulé son choix avant confirmation du livreur.", occurredAt: new Date().toISOString() }); }
      return delivery;
    }),
    confirm: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Seul le livreur sélectionné peut confirmer.");
      const result = await db.confirmTikisseDeliveryWithEvents(input.deliveryId, profile.phone);
      if (result.delivery) { await syncDeliveryParticipants(result.delivery); void publishDeliveryStatusBroadcast({ deliveryId: result.delivery.id, status: result.delivery.status, title: "Livraison activée", body: "Le livreur a confirmé sa disponibilité.", occurredAt: new Date().toISOString() }); }
      return result;
    }),
    complete: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const result = await db.completeTikisseDeliveryWithEvents(input.deliveryId, profile.phone);
      if (result.delivery) { await syncDeliveryParticipants(result.delivery); void publishDeliveryStatusBroadcast({ deliveryId: result.delivery.id, status: result.delivery.status, title: "Livraison terminée", body: "La livraison a été déclarée terminée.", occurredAt: new Date().toISOString() }); }
      return result;
    }),
  }),
  wallet: router({
    snapshot: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const [wallet, journal, commissionRate] = await Promise.all([db.getTikisseWalletSnapshot(profile.phone), db.listTikisseWalletLedger(profile.phone), db.getTikisseCommissionRate()]);
      return { wallet, journal, commissionRate };
    }),
    // Historique informatif des gains de courses d'un livreur : calculé depuis les livraisons terminées, jamais
    // depuis le Wallet (qui n'est jamais crédité par une livraison, le paiement se faisant hors application).
    driverEarningsHistory: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") return [];
      return db.getDriverCompletedDeliveryEarnings(profile.phone);
    }),
    requestOperation: tikisseProtectedProcedure.input(z.object({ type: z.enum(["deposit", "withdrawal"]), amount: z.number().int().min(100).max(10_000_000), requestId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      if (input.type === "withdrawal") throw new Error("Les retraits ne sont plus proposés : le Wallet sert uniquement à recharger votre compte pour effectuer des livraisons.");
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      return db.requestTikisseWalletOperation(profile.phone, input.type, input.amount, input.requestId);
    }),
    initiateYengaPayTest: tikisseProtectedProcedure.input(z.object({ type: z.enum(["deposit", "withdrawal"]), amount: z.number().int().min(100).max(10_000_000), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/) })).mutation(async ({ ctx, input }) => {
      if (input.type === "withdrawal") throw new Error("Les retraits ne sont plus proposés : le Wallet sert uniquement à recharger votre compte pour effectuer des livraisons.");
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      // Alias de `initiateYengaPay` (même fonction, conservée pour les anciens clients) : même limite.
      await enforcePaymentRateLimit("checkout", profile.phone);
      return db.initiateYengaPayTestPayment({ ...input, profilePhone: profile.phone });
    }),
    initiateYengaPay: tikisseProtectedProcedure.input(z.object({ type: z.enum(["deposit", "withdrawal"]), amount: z.number().int().min(100).max(10_000_000), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/) })).mutation(async ({ ctx, input }) => {
      if (input.type === "withdrawal") throw new Error("Les retraits ne sont plus proposés : le Wallet sert uniquement à recharger votre compte pour effectuer des livraisons.");
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      await enforcePaymentRateLimit("checkout", profile.phone);
      return db.initiateYengaPayPayment({ ...input, profilePhone: profile.phone });
    }),
    settleYengaPayTest: tikisseProtectedProcedure.input(z.object({ paymentId: z.string().uuid(), outcome: z.enum(["succeeded", "failed"]) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      return db.settleYengaPayTestPayment({ ...input, profilePhone: profile.phone });
    }),
    // ===== Paiement Mobile Money direct (in-app, sans redirection web) =====
    requestDirectDeposit: tikisseProtectedProcedure.input(z.object({
      amount: z.number().int().min(100).max(10_000_000),
      countryCode: z.string().length(2),
      phoneLocal: z.string().regex(/^[0-9]{6,12}$/),
      operator: z.enum(["orange_money", "moov_money"]),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,48}$/),
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      await enforcePaymentRateLimit("request", profile.phone);
      const country = COUNTRIES.find((c) => c.id === input.countryCode);
      if (!country) throw new Error("Pays non supporté.");
      if (input.phoneLocal.length !== country.digits) throw new Error(`Le numéro doit contenir ${country.digits} chiffres pour ${country.name}.`);
      const phone = `${country.dialCode}${input.phoneLocal.replace(/^0+/, "")}`;
      const { createYengapayDirectDeposit } = await import("./yengapay-direct");
      return createYengapayDirectDeposit({
        profilePhone: profile.phone,
        amount: input.amount,
        phone,
        operator: input.operator,
        countryCode: input.countryCode,
        idempotencyKey: input.idempotencyKey,
      });
    }),
    checkDirectDepositStatus: tikisseProtectedProcedure.input(z.object({ transactionId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const { getYengapayDirectDepositStatus } = await import("./yengapay-direct");
      return getYengapayDirectDepositStatus({ profilePhone: profile.phone, transactionId: input.transactionId });
    }),
    payDirectDeposit: tikisseProtectedProcedure.input(z.object({ transactionId: z.string().uuid(), otp: z.string().regex(/^[0-9]{4,12}$/) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      await enforcePaymentRateLimit("submitOtp", profile.phone);
      const { payYengapayDirectDeposit } = await import("./yengapay-direct");
      return payYengapayDirectDeposit({ profilePhone: profile.phone, transactionId: input.transactionId, otp: input.otp });
    }),
    resendDirectDepositOtp: tikisseProtectedProcedure.input(z.object({ transactionId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      await enforcePaymentRateLimit("resendOtp", profile.phone);
      const { resendYengapayDirectOtp } = await import("./yengapay-direct");
      return resendYengapayDirectOtp({ profilePhone: profile.phone, transactionId: input.transactionId });
    }),
    cancelDirectDeposit: tikisseProtectedProcedure.input(z.object({ transactionId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const { cancelYengapayDirectDeposit } = await import("./yengapay-direct");
      return cancelYengapayDirectDeposit({ profilePhone: profile.phone, transactionId: input.transactionId });
    }),
    // Liste les paiements directs encore en attente pour le profil courant. Sert à la reprise
    // côté client quand l'utilisateur a fermé l'app pendant le polling initial : le dépôt
    // reste en `pending` jusqu'à expiration ou webhook `payment.succeeded/failed/cancelled`.
    // Filtré par le serveur pour qu'un client malveillant ne voie pas les transactions d'un
    // autre profil.
    listPendingDirectDeposits: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      return db.listPendingDirectDeposits(profile.phone);
    }),
    settleDirectDepositTest: tikisseProtectedProcedure.input(z.object({ transactionId: z.string().uuid(), outcome: z.enum(["succeeded", "failed"]) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const { settleYengapayDirectDepositTest } = await import("./yengapay-direct");
      return settleYengapayDirectDepositTest({ profilePhone: profile.phone, ...input });
    }),
  }),
  notifications: router({
    list: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      return db.listTikisseDeliveryEvents(profile.phone);
    }),
    markRead: tikisseProtectedProcedure.mutation(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      return db.markTikisseDeliveryEventsRead(profile.phone);
    }),
    markOneRead: tikisseProtectedProcedure.input(z.object({ notificationId: z.string().min(1).max(40) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      return db.markTikisseDeliveryEventRead(input.notificationId, profile.phone);
    }),
    registerPushToken: tikisseProtectedProcedure.input(z.object({
      token: z.string().min(20).max(200),
      platform: z.enum(["ios", "android", "web"]),
      appVersion: z.string().max(40).optional(),
      deviceName: z.string().max(120).optional(),
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      return db.registerPushToken({ phone: profile.phone, token: input.token, platform: input.platform, appVersion: input.appVersion, deviceName: input.deviceName });
    }),
    unregisterPushToken: tikisseProtectedProcedure.input(z.object({ token: z.string().min(20).max(200) })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      return db.unregisterPushToken({ phone: profile.phone, token: input.token });
    }),
  }),
  /** Périmètre de travail du livreur : alertes push de nouvelles courses et rayon d'affichage des
   *  opportunités (cf. shared/driver-perimeter.ts). Réservé aux comptes livreurs — un expéditeur n'a
   *  ni opportunité à filtrer ni alerte de ce type à recevoir. */
  driverPerimeter: router({
    get: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Ces réglages sont réservés aux livreurs.");
      return { ...(await db.getDriverPerimeterPreferences(profile.phone)), city: profile.city ?? null };
    }),
    update: tikisseProtectedProcedure.input(z.object({
      opportunityPushEnabled: z.boolean().optional(),
      // `null` est une valeur métier à part entière (« ma ville »), à distinguer d'un champ absent
      // qui, lui, laisse le réglage inchangé — d'où `.nullable().optional()` et non `.optional()`.
      alertRadiusKm: z.number().int().min(MIN_PERIMETER_RADIUS_KM).max(MAX_PERIMETER_RADIUS_KM).nullable().optional(),
      discoveryRadiusKm: z.number().int().min(MIN_PERIMETER_RADIUS_KM).max(MAX_PERIMETER_RADIUS_KM).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Ces réglages sont réservés aux livreurs.");
      return { ...(await db.updateDriverPerimeterPreferences(profile.phone, input)), city: profile.city ?? null };
    }),
    /** Position de référence des rayons. Même géofencing que le suivi en direct : une position hors
     *  zone de service est refusée plutôt que d'être enregistrée comme centre du périmètre. */
    updateBasePosition: protectedGeographyProcedure.input(z.object({
      latitude: coordinateSchema.min(-90).max(90),
      longitude: coordinateSchema.min(-180).max(180),
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") throw new Error("Ces réglages sont réservés aux livreurs.");
      const countryCode = profile.country ?? findCountryForPhone(profile.phone).id;
      if (!isCoordinateInCountry(input.latitude, input.longitude, countryCode)) {
        throw new Error("La position détectée est en dehors de la zone de service. Vérifie ton GPS.");
      }
      return { ...(await db.updateDriverBasePosition(profile.phone, input.latitude, input.longitude)), city: profile.city ?? null };
    }),
  }),
  reviews: router({
    list: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      return db.listTikisseDeliveryReviewsForProfile(profile.phone, profile.accountType);
    }),
  }),
  analytics: router({
    myDriverEarningsTrend: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") {
        return null;
      }
      // Les mêmes enregistrements que l'historique de l'écran Gains : nets de commission, avec le même
      // repli sur le prix estimé. Une seule source, donc un seul chiffre pour « 7 derniers jours ».
      const { computeDriverEarningsTrend } = await import("./analytics");
      return computeDriverEarningsTrend(await db.getDriverCompletedDeliveryEarnings(profile.phone));
    }),
    getForDelivery: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const record = await db.getTikisseDeliveryRecordById(input.deliveryId);
      if (!record || (record.senderPhone !== profile.phone && record.driverPhone !== profile.phone)) throw new Error("Cet avis n’est pas accessible.");
      const reviewerPhone = profile.accountType === "sender" ? profile.phone : record.senderPhone;
      const review = await db.getTikisseDeliveryReview(input.deliveryId, reviewerPhone);
      return review ? db.deliveryReviewToView(review) : null;
    }),
    submit: tikisseProtectedProcedure.input(z.object({ deliveryId: z.string().uuid(), rating: z.number().int().min(1).max(5), comment: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const delivery = await db.getTikisseDeliveryRecordById(input.deliveryId);
      const existing = delivery ? await db.getTikisseDeliveryReview(input.deliveryId, profile.phone) : null;
      if (!canReviewDelivery({ status: delivery?.status ?? "missing", senderPhone: delivery?.senderPhone ?? "", driverPhone: delivery?.driverPhone ?? null }, profile.phone, profile.accountType, !existing)) {
        throw new Error("Cette livraison ne peut pas encore être évaluée.");
      }
      if (!delivery) throw new Error("Livraison introuvable.");
      if (input.comment && !isValidReviewText(input.comment)) throw new Error("Caractères non autorisés");
      const review = await db.saveTikisseDeliveryReview({ id: randomUUID(), deliveryId: delivery.id, reviewerPhone: profile.phone, driverPhone: delivery.driverPhone!, rating: input.rating, ...(input.comment?.trim() ? { comment: sanitizeReviewText(input.comment) } : {}) });
      if (!review) throw new Error("L’avis n’a pas pu être enregistré.");
      return db.deliveryReviewToView(review);
    }),
  }),
  referrals: router({
    myCode: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      return { code: profile.accountType === "driver" ? profile.referralCode ?? null : null };
    }),
    mine: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const rows = await db.listReferralsForReferrer(ctx.tikisseProfilePhone);
      return rows.map((row) => ({
        id: row.referral.id, fullName: row.refereeName, status: row.referral.status,
        rewardAmount: row.referral.rewardAmount, joinedAt: row.referral.createdAt.toISOString(),
      }));
    }),
    settings: publicProcedure.query(() => db.getReferralPublicSettings()),
  }),

  kyc: router({
    status: tikisseProtectedProcedure.query(async ({ ctx }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      if (profile.accountType !== "driver") return null;
      const submission = await db.getLatestKycSubmission(profile.phone);
      if (!submission) return null;
      return { status: submission.status, submittedAt: submission.submittedAt.toISOString(), rejectionReason: submission.rejectionReason ?? undefined };
    }),
    submit: tikisseProtectedProcedure.input(z.object({
      idFront: z.object({ base64: kycBase64ImageSchema, mime: photoMimeSchema }),
      idBack: z.object({ base64: kycBase64ImageSchema, mime: photoMimeSchema }),
      selfie: z.object({ base64: kycBase64ImageSchema, mime: photoMimeSchema }),
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
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
        storagePut(`tikisse-kyc/${safePhone}/${stamp}-id-front.${extensionOf(input.idFront.mime)}`, Buffer.from(input.idFront.base64, "base64"), input.idFront.mime),
        storagePut(`tikisse-kyc/${safePhone}/${stamp}-id-back.${extensionOf(input.idBack.mime)}`, Buffer.from(input.idBack.base64, "base64"), input.idBack.mime),
        storagePut(`tikisse-kyc/${safePhone}/${stamp}-selfie.${extensionOf(input.selfie.mime)}`, Buffer.from(input.selfie.base64, "base64"), input.selfie.mime),
      ]);
      return db.createKycSubmission({ driverPhone: profile.phone, idFrontKey: idFront.key, idBackKey: idBack.key, selfieKey: selfie.key });
    }),
  }),

  reports: router({
    create: tikisseProtectedProcedure.input(z.object({
      deliveryId: z.string().uuid(),
      reason: reportReasonSchema,
      description: reportDescriptionSchema,
      // La colonne `attachmentKey` existait déjà côté base et admin, mais aucun chemin ne permettait de
      // la remplir : le formulaire annonçait des pièces jointes "facultatives" sans jamais les accepter.
      attachmentBase64: base64ImageSchema.optional(),
      attachmentMime: photoMimeSchema.optional(),
    }).superRefine((value, ctx) => {
      if (value.attachmentBase64 && !value.attachmentMime) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["attachmentMime"], message: "Type d’image requis." });
    })).mutation(async ({ ctx, input }) => {
      const profile = await currentTikisseProfile(ctx.tikisseProfilePhone);
      const delivery = await db.getTikisseDeliveryRecordById(input.deliveryId);
      if (!delivery) throw new Error("Livraison introuvable.");
      const isSender = delivery.senderPhone === profile.phone;
      const isDriver = delivery.driverPhone === profile.phone;
      if (!isSender && !isDriver) throw new Error("Vous ne pouvez signaler qu’une livraison à laquelle vous participez.");
      let attachmentKey: string | undefined;
      if (input.attachmentBase64 && input.attachmentMime) {
        const safePhone = profile.phone.replace(/[^0-9]/g, "");
        const extension = input.attachmentMime === "image/png" ? "png" : input.attachmentMime === "image/webp" ? "webp" : "jpg";
        const bytes = Buffer.from(input.attachmentBase64, "base64");
        const stored = await storagePut(`tikisse-reports/${safePhone}/${Date.now()}-${randomUUID()}.${extension}`, bytes, input.attachmentMime);
        attachmentKey = stored.key;
      }
      return adminDb.createDeliveryReport({
        deliveryId: input.deliveryId,
        reporterPhone: profile.phone,
        reporterRole: isSender ? "sender" : "driver",
        reason: input.reason,
        description: sanitizeDeliveryText(input.description),
        ...(attachmentKey ? { attachmentKey } : {}),
      });
    }),
  }),
});

export type AppRouter = typeof appRouter;
