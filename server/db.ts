import { isoCountry } from "../shared/iso-countries";
import { createHash, randomUUID } from "crypto";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, like, lt, lte, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertTikisseDelivery, InsertTikissePlace, InsertUser, TikisseAdminAuditLog, TikisseAdminUser, TikisseDelivery, TikisseDeliveryCandidate, TikisseDeliveryReport, TikissePlace, tikisseAdminAuditLog, tikisseAdminUsers, tikisseDeliveries, tikisseDeliveryCandidates, tikisseDeliveryEvents, tikisseDeliveryLiveLocations, tikisseDeliveryReports, tikisseDeliveryReviews, TikisseDriverPreferences, tikisseDriverPreferences, tikisseFavoritePlaces, tikisseKycSubmissions, tikissePaymentTransactions, tikissePlaces, tikissePlatformSettings, tikisseProfiles, tikissePushTokens, tikisseRateLimits, tikisseReferrals, tikisseSupportedCountries, tikisseWalletLedger, tikisseWallets, tikisseYengapayWebhookEvents, users } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { assertSimulatedSettlementAllowed, createYengapayPaymentIntent, readYengapayConfig, verifyYengapayPayment, YENGAPAY_TEST_PROVIDERS } from "./yengapay";
import { publishWalletBroadcast } from "./supabase-realtime";
import { sendPushToTokens, type PushMessage } from "./push";
import { isValidExpoPushTokenShape } from "./_test-helpers/push-token-shape";
import type { Delivery, DeliveryReview, DriverCandidate, FinancialRecord, InAppNotification, LocationLabel, SelectableVehicleType, WalletOperation, WalletSnapshot } from "../shared/tikisse-domain";
import { netDriverEarning } from "../shared/tikisse-domain";
import { candidateMovementVersion, computeReplacementSettlement } from "../shared/wallet-commission";
import { BASE_POSITION_MAX_AGE_MS, DEFAULT_DRIVER_PERIMETER, distanceKmBetween, evaluatePerimeter, isValidPerimeterRadius, MAX_PERIMETER_RADIUS_KM, MIN_PERIMETER_RADIUS_KM, type DriverPerimeterPreferences } from "../shared/driver-perimeter";
import { autoCompletionTimestamp, DELIVERY_EXPIRATION_MS, deliveryActivityTimestamp, deliveryExpirationOutcome } from "../shared/delivery-expiration";

let _db: ReturnType<typeof drizzle> | null = null;

/** Push des notifications d'une transaction : envoyés seulement une fois la transaction validée. Envoyés
 *  plus tôt, un utilisateur pouvait être notifié d'une action finalement annulée (erreur plus loin dans la
 *  transaction, conflit de verrou). Clé : l'objet transaction racine ; appendDeliveryEvent y dépose ses push. */
type DeferredPush = Parameters<typeof enqueuePushToPhone>[0];
const pushesAwaitingCommit = new WeakMap<object, DeferredPush[]>();

function deferPushesUntilCommit(db: NonNullable<typeof _db>) {
  const transaction = db.transaction.bind(db);
  db.transaction = (async (run: (tx: any) => Promise<unknown>, config?: unknown) => {
    let root: object | undefined;
    const result = await (transaction as any)(async (tx: any) => {
      root = tx;
      pushesAwaitingCommit.set(tx, []);
      return run(tx);
    }, config);
    // Ici seulement, la transaction est validée. Si elle a échoué, on n'arrive jamais à cette ligne.
    const pushes = root ? pushesAwaitingCommit.get(root) ?? [] : [];
    if (root) pushesAwaitingCommit.delete(root);
    for (const push of pushes) void enqueuePushToPhone(push).catch(() => {});
    return result;
  }) as typeof db.transaction;
  return db;
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = deferPushesUntilCommit(drizzle(process.env.DATABASE_URL));
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId, lastSignedIn: new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: new Date() };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export type PersistedTikisseProfile = {
  phone: string;
  fullName: string;
  accountType: "sender" | "driver";
  vehicles: string;
  photoKey?: string | null;
  email?: string | null;
  phoneVerified?: boolean;
  emailVerified?: boolean;
  referralCode?: string | null;
  supabaseUserId?: string | null;
  country?: string | null;
  city?: string | null;
};

export async function getTikisseProfileByPhone(phone: string) {
  const db = await getDb();
  if (!db) throw new Error("Le service des profils est temporairement indisponible.");
  const result = await db.select().from(tikisseProfiles).where(eq(tikisseProfiles.phone, phone)).limit(1);
  return result[0];
}

export async function getTikisseProfileByReferralCode(referralCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tikisseProfiles).where(eq(tikisseProfiles.referralCode, referralCode)).limit(1);
  return result[0];
}

/** Creates a profile once; an existing profile is returned untouched to preserve its account type. */
export async function createTikisseProfile(input: PersistedTikisseProfile) {
  const db = await getDb();
  if (!db) throw new Error("La base de données sécurisée est temporairement indisponible.");
  const existing = await getTikisseProfileByPhone(input.phone);
  if (existing) return existing;
  await db.insert(tikisseProfiles).values(input);
  const created = await getTikisseProfileByPhone(input.phone);
  if (!created) throw new Error("Le profil n’a pas pu être enregistré.");
  return created;
}

export async function updateTikisseProfile(phone: string, changes: Partial<Pick<PersistedTikisseProfile, "fullName" | "photoKey" | "email" | "phoneVerified" | "emailVerified" | "vehicles" | "country" | "city">>) {
  const db = await getDb();
  if (!db) throw new Error("La base de données sécurisée est temporairement indisponible.");
  await db.update(tikisseProfiles).set({ ...changes, updatedAt: new Date() }).where(eq(tikisseProfiles.phone, phone));
  const profile = await getTikisseProfileByPhone(phone);
  if (!profile) throw new Error("Le profil est introuvable.");
  return profile;
}

/** Links a profile only after the server has verified the matching Supabase phone session. */
export const ACCOUNT_DELETION_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** Démarre le délai de 30 jours avant suppression définitive. Idempotent : un second appel ne
 *  réinitialise pas le compteur si une demande est déjà en cours. */
export async function requestProfileDeletion(phone: string) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La base de données sécurisée est temporairement indisponible.");
  const profile = await getTikisseProfileByPhone(phone);
  if (!profile) throw new Error("Profil introuvable.");
  if (!profile.deletionRequestedAt) {
    const requestedAt = new Date();
    const scheduledAt = new Date(requestedAt.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_MS);
    await dbc.update(tikisseProfiles).set({ deletionRequestedAt: requestedAt, deletionScheduledAt: scheduledAt, updatedAt: requestedAt }).where(eq(tikisseProfiles.phone, phone));
  }
  const updated = await getTikisseProfileByPhone(phone);
  if (!updated) throw new Error("Profil introuvable.");
  return updated;
}

export async function cancelProfileDeletion(phone: string) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La base de données sécurisée est temporairement indisponible.");
  const profile = await getTikisseProfileByPhone(phone);
  if (!profile) throw new Error("Profil introuvable.");
  if (profile.deletedAt) throw new Error("Ce compte est déjà supprimé définitivement et ne peut plus être restauré ici.");
  await dbc.update(tikisseProfiles).set({ deletionRequestedAt: null, deletionScheduledAt: null, updatedAt: new Date() }).where(eq(tikisseProfiles.phone, phone));
  const updated = await getTikisseProfileByPhone(phone);
  if (!updated) throw new Error("Profil introuvable.");
  return updated;
}

// Suppression définitive des comptes arrivés à échéance : server/admin-deletions.ts (runAccountDeletionJobs).

export async function getMaintenanceStatus() {
  const dbc = await getDb();
  if (!dbc) return { enabled: false, message: undefined as string | undefined };
  await dbc.insert(tikissePlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const settings = (await dbc.select().from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1))[0];
  return { enabled: settings?.maintenanceEnabled ?? false, message: settings?.maintenanceMessage ?? undefined };
}

export async function createKycSubmission(input: { driverPhone: string; idFrontKey: string; idBackKey: string; selfieKey: string }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La vérification d’identité est temporairement indisponible.");
  const id = randomUUID();
  await dbc.insert(tikisseKycSubmissions).values({ id, ...input, status: "submitted" });
  return { id, status: "submitted" as const };
}

export async function getLatestKycSubmission(driverPhone: string) {
  const dbc = await getDb();
  if (!dbc) return undefined;
  const rows = await dbc.select().from(tikisseKycSubmissions).where(eq(tikisseKycSubmissions.driverPhone, driverPhone)).orderBy(desc(tikisseKycSubmissions.submittedAt)).limit(1);
  return rows[0];
}

export async function listReferralsForReferrer(referrerPhone: string) {
  const dbc = await getDb();
  if (!dbc) return [];
  const rows = await dbc.select({
    referral: tikisseReferrals,
    refereeName: tikisseProfiles.fullName,
  }).from(tikisseReferrals).innerJoin(tikisseProfiles, eq(tikisseReferrals.refereePhone, tikisseProfiles.phone)).where(eq(tikisseReferrals.referrerPhone, referrerPhone)).orderBy(desc(tikisseReferrals.createdAt));
  return rows;
}

export async function getReferralPublicSettings() {
  const dbc = await getDb();
  if (!dbc) return { rewardAmount: 1000, requiredDeliveries: 1, enabled: true };
  await dbc.insert(tikissePlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const settings = (await dbc.select().from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1))[0];
  return { rewardAmount: settings?.referralRewardAmount ?? 1000, requiredDeliveries: settings?.referralRequiredDeliveries ?? 1, enabled: settings?.referralEnabled ?? true };
}

export async function linkTikisseProfileToSupabaseUser(phone: string, supabaseUserId: string) {
  const database = await getDb();
  if (!database) throw new Error("La base de données sécurisée est temporairement indisponible.");
  const profile = await getTikisseProfileByPhone(phone);
  if (!profile) throw new Error("Profil introuvable.");
  const conflicting = await database.select({ phone: tikisseProfiles.phone }).from(tikisseProfiles).where(eq(tikisseProfiles.supabaseUserId, supabaseUserId)).limit(1);
  if (conflicting[0] && conflicting[0].phone !== phone) {
    await database.update(tikisseProfiles).set({ supabaseUserId: null, updatedAt: new Date() }).where(eq(tikisseProfiles.phone, conflicting[0].phone));
  }
  if (profile.supabaseUserId !== supabaseUserId) {
    await database.update(tikisseProfiles).set({ supabaseUserId, updatedAt: new Date() }).where(eq(tikisseProfiles.phone, phone));
  }
  return (await getTikisseProfileByPhone(phone))!;
}

export async function getTikissePlaceByGoogleId(googlePlaceId: string) {
  const db = await getDb();
  if (!db || !googlePlaceId) return undefined;
  const result = await db.select().from(tikissePlaces).where(eq(tikissePlaces.googlePlaceId, googlePlaceId)).limit(1);
  return result[0];
}

export async function getTikissePlaceByMapboxId(mapboxPlaceId: string) {
  const db = await getDb();
  if (!db || !mapboxPlaceId) return undefined;
  const result = await db.select().from(tikissePlaces).where(eq(tikissePlaces.mapboxPlaceId, mapboxPlaceId)).limit(1);
  return result[0];
}

export function coordinateCacheKey(latitude: string | number, longitude: string | number) {
  const safeLatitude = Number(latitude);
  const safeLongitude = Number(longitude);
  if (!Number.isFinite(safeLatitude) || !Number.isFinite(safeLongitude)) throw new Error("Coordonnées de lieu invalides.");
  // 5 décimales ≈ 1,1 m de précision : suffisant pour identifier "le même lieu" tout en laissant
  // deux positions de drag de carte proches (précision GPS/écran bien supérieure à 1 cm) retomber sur
  // la même clé. À 7 décimales (~1 cm), deux relâchements successifs du même marqueur ne matchaient
  // presque jamais, redéclenchant un appel Mapbox/OSM et créant une nouvelle ligne `tikisse_places` à
  // chaque fois — annulant en pratique l'intérêt du cache pour son cas d'usage principal.
  return `${safeLatitude.toFixed(5)}:${safeLongitude.toFixed(5)}`;
}

export function tikissePlaceToLocation(place: TikissePlace): LocationLabel {
  return {
    name: place.placeName,
    district: place.district ?? "",
    city: place.city ?? "",
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    ...(place.googlePlaceId ? { googlePlaceId: place.googlePlaceId } : {}),
    ...(place.mapboxPlaceId ? { mapboxId: place.mapboxPlaceId } : {}),
    ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}),
    ...(place.street ? { street: place.street } : {}),
    ...(place.province ? { province: place.province } : {}),
    ...(place.country ? { country: place.country } : {}),
    provider: place.provider === "mapbox" ? "mapbox" : place.provider === "openstreetmap" ? "openstreetmap" : place.provider === "manual" ? "manual" : "legacy",
    source: ["search", "retrieve", "reverse", "forward", "favorite", "manual", "legacy"].includes(place.source) ? place.source as LocationLabel["source"] : "legacy",
    featureType: ["address", "secondary_address", "poi", "street", "neighborhood", "locality", "place", "point", "unknown"].includes(place.featureType) ? place.featureType as LocationLabel["featureType"] : "unknown",
    precision: ["exact", "street", "area", "city", "unknown"].includes(place.precision) ? place.precision as LocationLabel["precision"] : "unknown",
  };
}

export async function getTikissePlaceByCoordinate(latitude: string | number, longitude: string | number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tikissePlaces).where(eq(tikissePlaces.coordinateKey, coordinateCacheKey(latitude, longitude))).limit(1);
  return result[0];
}

const NEARBY_PLACE_DEDUP_METERS = 50;
/** Marge large pour une pré-sélection SQL par bornes (pas un filtre définitif) : la distance réelle est
 *  ensuite recalculée en JS. ~0,0006° ≈ 65-67 m aux latitudes du Burkina Faso, une marge suffisante pour
 *  ne jamais exclure un candidat à 50 m tout en restant sélectif dans un index (latitude, longitude). */
const NEARBY_PLACE_BOUNDING_BOX_DEGREES = 0.0006;

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

/** Lieux saisis manuellement (sans identifiant fournisseur) uniquement : un pin posé à quelques mètres
 *  d'un lieu manuel déjà connu réutilise ce dernier plutôt que de créer un doublon quasi identique.
 *  Les lieux avec un identifiant fournisseur (Google/Mapbox) ne passent jamais par ici : ils dédupliquent
 *  déjà exactement par cet identifiant, ce qui est plus fiable qu'une proximité géographique. */
async function findNearbyManualTikissePlace(latitude: number, longitude: number) {
  const db = await getDb();
  if (!db) return undefined;
  const candidates = await db.select().from(tikissePlaces).where(and(
    isNull(tikissePlaces.googlePlaceId),
    isNull(tikissePlaces.mapboxPlaceId),
    gte(tikissePlaces.latitude, String(latitude - NEARBY_PLACE_BOUNDING_BOX_DEGREES)),
    lte(tikissePlaces.latitude, String(latitude + NEARBY_PLACE_BOUNDING_BOX_DEGREES)),
    gte(tikissePlaces.longitude, String(longitude - NEARBY_PLACE_BOUNDING_BOX_DEGREES)),
    lte(tikissePlaces.longitude, String(longitude + NEARBY_PLACE_BOUNDING_BOX_DEGREES)),
  )).limit(25);
  let closest: { place: (typeof candidates)[number]; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = haversineMeters(latitude, longitude, Number(candidate.latitude), Number(candidate.longitude));
    if (distance <= NEARBY_PLACE_DEDUP_METERS && (!closest || distance < closest.distance)) closest = { place: candidate, distance };
  }
  return closest?.place;
}

function tikissePlaceQualityScore(precision: string, featureType: string) {
  return (precision === "exact" ? 40 : precision === "street" ? 30 : precision === "area" ? 20 : precision === "city" ? 10 : 0) + (featureType === "poi" ? 5 : 0);
}

export async function saveTikissePlace(input: Omit<InsertTikissePlace, "coordinateKey" | "resolvedAt">) {
  const db = await getDb();
  if (!db) throw new Error("La base de lieux est temporairement indisponible.");
  const isExactMapSelection = input.source === "reverse";
  if (!isExactMapSelection && input.googlePlaceId) {
    const cached = await getTikissePlaceByGoogleId(input.googlePlaceId);
    if (cached) return cached;
  }
  if (!isExactMapSelection && input.mapboxPlaceId) {
    const cached = await getTikissePlaceByMapboxId(input.mapboxPlaceId);
    if (cached) return cached;
  }
  // Sans identifiant fournisseur (pin manuel, ou résultat "reverse" dont l'id est de toute façon
  // ignoré ci-dessous) : au-delà de la clé de coordonnée exacte, un lieu à quelques mètres d'un lieu
  // manuel déjà connu le réutilise plutôt que de créer un doublon quasi identique dans `tikisse_places`.
  const isManualPlace = isExactMapSelection || (!input.googlePlaceId && !input.mapboxPlaceId);
  const existingPlace = (await getTikissePlaceByCoordinate(input.latitude, input.longitude))
    ?? (isManualPlace ? await findNearbyManualTikissePlace(Number(input.latitude), Number(input.longitude)) : undefined);
  if (existingPlace) {
    if (tikissePlaceQualityScore(existingPlace.precision, existingPlace.featureType) >= tikissePlaceQualityScore(input.precision ?? "unknown", input.featureType ?? "unknown")) return existingPlace;
    await db.update(tikissePlaces).set({ ...input, coordinateKey: coordinateCacheKey(input.latitude, input.longitude) }).where(eq(tikissePlaces.id, existingPlace.id));
    const updated = await db.select().from(tikissePlaces).where(eq(tikissePlaces.id, existingPlace.id)).limit(1);
    if (updated[0]) return updated[0];
  }
  const inserted = await db.insert(tikissePlaces).values({
    ...input,
    ...(isExactMapSelection ? { googlePlaceId: null, mapboxPlaceId: null } : {}),
    coordinateKey: coordinateCacheKey(input.latitude, input.longitude),
  });
  const result = await db.select().from(tikissePlaces).where(eq(tikissePlaces.id, Number(inserted[0].insertId))).limit(1);
  if (!result[0]) throw new Error("Le lieu n’a pas pu être enregistré.");
  return result[0];
}

export async function listFavoritePlaces(profilePhone: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: tikisseFavoritePlaces.id, label: tikisseFavoritePlaces.label, createdAt: tikisseFavoritePlaces.createdAt, place: tikissePlaces }).from(tikisseFavoritePlaces).innerJoin(tikissePlaces, eq(tikisseFavoritePlaces.placeId, tikissePlaces.id)).where(eq(tikisseFavoritePlaces.profilePhone, profilePhone));
}

export async function saveFavoritePlace(profilePhone: string, placeId: number, label: string) {
  const db = await getDb();
  if (!db) throw new Error("Les favoris sont temporairement indisponibles.");
  await db.insert(tikisseFavoritePlaces).values({ profilePhone, placeId, label }).onDuplicateKeyUpdate({ set: { label } });
  const result = await db.select().from(tikisseFavoritePlaces).where(and(eq(tikisseFavoritePlaces.profilePhone, profilePhone), eq(tikisseFavoritePlaces.placeId, placeId))).limit(1);
  return result[0];
}

export async function renameFavoritePlace(profilePhone: string, favoriteId: number, label: string) {
  const db = await getDb();
  if (!db) throw new Error("Les favoris sont temporairement indisponibles.");
  await db.update(tikisseFavoritePlaces).set({ label }).where(and(eq(tikisseFavoritePlaces.id, favoriteId), eq(tikisseFavoritePlaces.profilePhone, profilePhone)));
  const result = await db.select().from(tikisseFavoritePlaces).where(and(eq(tikisseFavoritePlaces.id, favoriteId), eq(tikisseFavoritePlaces.profilePhone, profilePhone))).limit(1);
  if (!result[0]) throw new Error("Ce favori est introuvable ou ne vous appartient pas.");
  return result[0];
}

export async function deleteFavoritePlace(profilePhone: string, favoriteId: number) {
  const db = await getDb();
  if (!db) throw new Error("Les favoris sont temporairement indisponibles.");
  await db.delete(tikisseFavoritePlaces).where(and(eq(tikisseFavoritePlaces.id, favoriteId), eq(tikisseFavoritePlaces.profilePhone, profilePhone)));
  return { success: true } as const;
}

function parseVehicles(value: string): SelectableVehicleType[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is SelectableVehicleType => item === "Vélo" || item === "Moto" || item === "Tricycle" || item === "Voiture") : [];
  } catch { return []; }
}

type DeliveryJoin = {
  delivery: TikisseDelivery;
  pickup: TikissePlace;
  dropoff: TikissePlace;
  senderName: string;
  driverName?: string;
};

function deliveryToView(join: DeliveryJoin): Delivery {
  const row = join.delivery;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    type: row.deliveryType,
    pickup: tikissePlaceToLocation(join.pickup),
    dropoff: tikissePlaceToLocation(join.dropoff),
    distanceKm: Number(row.distanceKm),
    routeSource: row.routeSource,
    estimatedPrice: row.estimatedPrice,
    ...(row.offeredPrice ? { offeredPrice: row.offeredPrice } : {}),
    vehicleTypes: parseVehicles(row.vehicleTypes),
    createdAt: row.createdAt.toISOString(),
    scheduledAt: row.createdAt.toISOString(),
    ...(row.selectedAt ? { selectedAt: row.selectedAt.toISOString() } : {}),
    ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.toISOString() } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    senderName: join.senderName,
    ...(row.driverPhone ? { driverId: row.driverPhone } : {}),
    ...(join.driverName ? { driverName: join.driverName } : {}),
    ...(row.status === "active" || row.status === "completed" ? { senderPhone: row.senderPhone, driverPhone: row.driverPhone ?? undefined } : {}),
    ...(row.previousDriverPhone ? { previousDriverId: row.previousDriverPhone } : {}),
    details: row.details,
    ...(row.weightKg !== null ? { weightKg: Number(row.weightKg) } : {}),
    ...(row.lengthCm || row.widthCm || row.heightCm ? { dimensions: { ...(row.lengthCm ? { lengthCm: row.lengthCm } : {}), ...(row.widthCm ? { widthCm: row.widthCm } : {}), ...(row.heightCm ? { heightCm: row.heightCm } : {}) } } : {}),
    ...(row.passengers ? { passengers: row.passengers } : {}),
  };
}

async function deliveryJoins(rows: TikisseDelivery[]): Promise<Delivery[]> {
  if (!rows.length) return [];
  const db = await getDb();
  if (!db) return [];
  const placeIds = [...new Set(rows.flatMap((row) => [row.pickupPlaceId, row.dropoffPlaceId]))];
  const profilePhones = [...new Set(rows.flatMap((row) => row.driverPhone ? [row.senderPhone, row.driverPhone] : [row.senderPhone]))];
  const [places, profiles] = await Promise.all([
    db.select().from(tikissePlaces).where(inArray(tikissePlaces.id, placeIds)),
    db.select().from(tikisseProfiles).where(inArray(tikisseProfiles.phone, profilePhones)),
  ]);
  const placesById = new Map(places.map((place) => [place.id, place]));
  const namesByPhone = new Map(profiles.map((profile) => [profile.phone, profile.fullName]));
  return rows.flatMap((row) => {
    const pickup = placesById.get(row.pickupPlaceId);
    const dropoff = placesById.get(row.dropoffPlaceId);
    const senderName = namesByPhone.get(row.senderPhone);
    if (!pickup || !dropoff || !senderName) return [];
    return [deliveryToView({ delivery: row, pickup, dropoff, senderName, ...(row.driverPhone && namesByPhone.get(row.driverPhone) ? { driverName: namesByPhone.get(row.driverPhone) } : {}) })];
  });
}

const MAX_COMPATIBLE_DRIVERS_NOTIFIED = 200;

/** Livreurs actifs dont au moins un engin correspond à la livraison — même règle de compatibilité que
 *  `deliveries.list` (server/routers.ts), juste appliquée dans l'autre sens. Pas de correspondance JSON
 *  au niveau SQL (`vehicles` est stocké en texte) : filtrage en JS, comme ailleurs dans ce fichier.
 *  Bornée à `MAX_COMPATIBLE_DRIVERS_NOTIFIED` par défense contre un volume de livreurs très important. */
// Borne la lecture SQL elle-même (pas seulement l'accumulateur JS ci-dessous) : sans cette limite, la
// requête chargeait la table des livreurs actifs en entier en mémoire, à l'intérieur de la même
// transaction que la création/réactivation de la livraison, pour chaque publication. `vehicles` étant
// stocké en texte (pas de correspondance JSON possible au niveau SQL), le compromis accepté est de ne
// considérer que les `MAX_DRIVERS_SCANNED_FOR_COMPATIBILITY` profils actifs les plus récents : au-delà de
// ce volume de livreurs actifs, certains ne recevront pas cette notification précise (l'app reste malgré
// tout découvrable via `deliveries.list`, qui n'a pas cette limite).
const MAX_DRIVERS_SCANNED_FOR_COMPATIBILITY = 2_000;

function driverPreferencesToView(row: TikisseDriverPreferences): DriverPerimeterPreferences {
  return {
    opportunityPushEnabled: Boolean(row.opportunityPushEnabled),
    alertRadiusKm: row.alertRadiusKm ?? null,
    discoveryRadiusKm: row.discoveryRadiusKm ?? null,
    baseLatitude: row.baseLatitude === null ? null : Number(row.baseLatitude),
    baseLongitude: row.baseLongitude === null ? null : Number(row.baseLongitude),
    baseUpdatedAt: row.baseUpdatedAt ? row.baseUpdatedAt.toISOString() : null,
  };
}

/** Préférences de périmètre d'un livreur. Aucune ligne en base = réglages par défaut : alertes push
 *  désactivées, périmètre limité à la ville du profil (cf. shared/driver-perimeter.ts). */
export async function getDriverPerimeterPreferences(profilePhone: string): Promise<DriverPerimeterPreferences> {
  const db = await getDb();
  if (!db) return DEFAULT_DRIVER_PERIMETER;
  const rows = await db.select().from(tikisseDriverPreferences).where(eq(tikisseDriverPreferences.profilePhone, profilePhone)).limit(1);
  const row = rows[0];
  return row ? driverPreferencesToView(row) : DEFAULT_DRIVER_PERIMETER;
}

/** Met à jour les réglages choisis par le livreur. Les champs absents restent inchangés ; un rayon
 *  explicitement `null` signifie « ma ville » et est donc bien écrit, pas ignoré. */
export async function updateDriverPerimeterPreferences(profilePhone: string, patch: {
  opportunityPushEnabled?: boolean;
  alertRadiusKm?: number | null;
  discoveryRadiusKm?: number | null;
}): Promise<DriverPerimeterPreferences> {
  const db = await getDb();
  if (!db) throw new Error("Les réglages de notifications sont temporairement indisponibles.");
  for (const radius of [patch.alertRadiusKm, patch.discoveryRadiusKm]) {
    if (radius !== undefined && radius !== null && !isValidPerimeterRadius(radius)) {
      throw new Error(`Le rayon doit être compris entre ${MIN_PERIMETER_RADIUS_KM} et ${MAX_PERIMETER_RADIUS_KM} km.`);
    }
  }
  const values: Record<string, unknown> = {};
  if (patch.opportunityPushEnabled !== undefined) values.opportunityPushEnabled = patch.opportunityPushEnabled;
  if (patch.alertRadiusKm !== undefined) values.alertRadiusKm = patch.alertRadiusKm;
  if (patch.discoveryRadiusKm !== undefined) values.discoveryRadiusKm = patch.discoveryRadiusKm;
  await db.insert(tikisseDriverPreferences).values({ profilePhone, ...values })
    // `profilePhone` dans le SET garantit un UPDATE non vide même si `values` est vide (aucun champ
    // fourni) : MySQL rejette un `ON DUPLICATE KEY UPDATE` sans affectation.
    .onDuplicateKeyUpdate({ set: { profilePhone, ...values } });
  return getDriverPerimeterPreferences(profilePhone);
}

/** Enregistre la position de référence servant de centre aux rayons. Publiée par l'app du livreur
 *  quand elle dispose d'un point GPS ; sans elle, les rayons retombent sur le périmètre « ma ville ». */
export async function updateDriverBasePosition(profilePhone: string, latitude: number, longitude: number): Promise<DriverPerimeterPreferences> {
  const db = await getDb();
  if (!db) throw new Error("La position de référence est temporairement indisponible.");
  const baseUpdatedAt = new Date();
  const position = { baseLatitude: String(latitude), baseLongitude: String(longitude), baseUpdatedAt };
  await db.insert(tikisseDriverPreferences).values({ profilePhone, ...position })
    .onDuplicateKeyUpdate({ set: position });
  return getDriverPerimeterPreferences(profilePhone);
}

type CompatibleDriver = { phone: string; city: string | null };

async function getCompatibleDrivers(tx: any, vehicleTypes: SelectableVehicleType[]): Promise<CompatibleDriver[]> {
  if (vehicleTypes.length === 0) return [];
  const drivers = await tx.select({ phone: tikisseProfiles.phone, vehicles: tikisseProfiles.vehicles, city: tikisseProfiles.city })
    .from(tikisseProfiles)
    .where(and(eq(tikisseProfiles.accountType, "driver"), eq(tikisseProfiles.status, "active")))
    .orderBy(desc(tikisseProfiles.id))
    .limit(MAX_DRIVERS_SCANNED_FOR_COMPATIBILITY);
  // Aucun plafond ici : c'est le filtre de périmètre, appliqué ensuite, qui doit décider qui mérite
  // une notification. Tronquer dès la compatibilité d'engin — l'ordre étant « profils les plus
  // récents » — pouvait ne retenir que des livreurs d'une seule ville et laisser une course publiée
  // ailleurs sans aucun destinataire. Le plafond d'envoi s'applique donc après le périmètre.
  return drivers
    .filter((driver: { vehicles: string }) => parseVehicles(driver.vehicles).some((vehicle) => vehicleTypes.includes(vehicle)))
    .map((driver: { phone: string; city: string | null }) => ({ phone: driver.phone, city: driver.city ?? null }));
}

/** Préférences de périmètre de plusieurs livreurs en une requête, complétées par les valeurs par
 *  défaut pour ceux qui n'ont jamais ouvert leurs réglages (aucune ligne en base). */
async function getDriverPerimetersByPhone(tx: any, phones: string[]): Promise<Map<string, DriverPerimeterPreferences>> {
  const perimeters = new Map<string, DriverPerimeterPreferences>();
  if (phones.length === 0) return perimeters;
  const rows = await tx.select().from(tikisseDriverPreferences).where(inArray(tikisseDriverPreferences.profilePhone, phones));
  for (const row of rows) perimeters.set(row.profilePhone, driverPreferencesToView(row));
  for (const phone of phones) if (!perimeters.has(phone)) perimeters.set(phone, DEFAULT_DRIVER_PERIMETER);
  return perimeters;
}

/** Informe chaque livreur compatible qu'une livraison est disponible (publication ou réactivation) —
 *  spec §1 : "informer les livreurs compatibles". Avant ce correctif, aucun chemin ne le faisait : la
 *  seule découverte possible était le polling manuel de `deliveries.list`.
 *
 *  Deux filtres se cumulent, dans cet ordre : compatibilité de l'engin, puis périmètre d'alerte du
 *  livreur (sa ville par défaut, ou son rayon s'il en a choisi un). Hors périmètre, aucune
 *  notification n'est créée du tout : envoyer une alerte pour une course à l'autre bout du pays est
 *  du bruit, pas de l'information. Dans le périmètre, la notification in-app est toujours créée ;
 *  le push, lui, n'est envoyé qu'aux livreurs qui l'ont explicitement activé. */
async function notifyCompatibleDriversOfDelivery(
  tx: any,
  delivery: { id: string; title: string; vehicleTypes: string; pickupPlaceId: number },
  eventType: "delivery_published" | "delivery_reactivated_for_drivers",
  announcement: string,
) {
  const compatibleDrivers = await getCompatibleDrivers(tx, parseVehicles(delivery.vehicleTypes));
  if (compatibleDrivers.length === 0) return;
  const [pickup] = await tx.select({ latitude: tikissePlaces.latitude, longitude: tikissePlaces.longitude, city: tikissePlaces.city, district: tikissePlaces.district, province: tikissePlaces.province })
    .from(tikissePlaces).where(eq(tikissePlaces.id, delivery.pickupPlaceId)).limit(1);
  if (!pickup) return;
  const pickupPoint = {
    latitude: Number(pickup.latitude),
    longitude: Number(pickup.longitude),
    city: pickup.city ?? null,
    district: pickup.district ?? null,
    province: pickup.province ?? null,
  };
  const perimeters = await getDriverPerimetersByPhone(tx, compatibleDrivers.map((driver) => driver.phone));

  let notified = 0;
  for (const driver of compatibleDrivers) {
    if (notified >= MAX_COMPATIBLE_DRIVERS_NOTIFIED) break;
    const perimeter = perimeters.get(driver.phone) ?? DEFAULT_DRIVER_PERIMETER;
    const decision = evaluatePerimeter({
      radiusKm: perimeter.alertRadiusKm,
      driverCity: driver.city,
      base: { latitude: perimeter.baseLatitude, longitude: perimeter.baseLongitude, updatedAt: perimeter.baseUpdatedAt },
      pickup: pickupPoint,
    });
    if (!decision.matches) continue;
    await appendDeliveryEvent(tx, {
      deliveryId: delivery.id,
      eventType,
      status: "open",
      recipientPhone: driver.phone,
      title: "Nouvelle livraison disponible",
      body: `${announcement} : ${delivery.title}`,
      tone: "info",
      idempotencyKey: `${delivery.id}:${eventType}:${driver.phone}`,
      push: perimeter.opportunityPushEnabled,
    });
    notified += 1;
  }
}

export async function createTikisseDelivery(input: InsertTikisseDelivery) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    await tx.insert(tikisseDeliveries).values(input);
    await notifyCompatibleDriversOfDelivery(tx, { id: input.id, title: input.title, vehicleTypes: input.vehicleTypes, pickupPlaceId: input.pickupPlaceId }, "delivery_published", "Une livraison compatible avec votre engin a été publiée");
  });
  return getTikisseDeliveryById(input.id);
}

export async function getTikisseDeliveryById(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(tikisseDeliveries).where(eq(tikisseDeliveries.id, id)).limit(1);
  return (await deliveryJoins(rows))[0];
}

export async function getTikisseDeliveryRecordById(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(tikisseDeliveries).where(eq(tikisseDeliveries.id, id)).limit(1);
  return rows[0];
}

export type TikisseLiveDeliveryPosition = {
  latitude: number;
  longitude: number;
  heading: number;
  recordedAt: string;
};

export async function saveTikisseDeliveryLiveLocation(input: {
  deliveryId: string;
  driverPhone: string;
  latitude: number;
  longitude: number;
  heading: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Le suivi en direct est temporairement indisponible.");
  return db.transaction(async (tx) => {
    const [delivery] = await tx.select().from(tikisseDeliveries).where(eq(tikisseDeliveries.id, input.deliveryId)).limit(1).for("update");
    if (!delivery || delivery.status !== "active" || delivery.driverPhone !== input.driverPhone) {
      throw new Error("Cette position ne peut pas être publiée pour cette livraison.");
    }
    const recordedAt = new Date();
    await tx.insert(tikisseDeliveryLiveLocations).values({
      deliveryId: input.deliveryId,
      driverPhone: input.driverPhone,
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      heading: String(input.heading),
      recordedAt,
    }).onDuplicateKeyUpdate({
      set: {
        driverPhone: input.driverPhone,
        latitude: String(input.latitude),
        longitude: String(input.longitude),
        heading: String(input.heading),
        recordedAt,
      },
    });
    return { latitude: input.latitude, longitude: input.longitude, heading: input.heading, recordedAt: recordedAt.toISOString() } satisfies TikisseLiveDeliveryPosition;
  });
}

export async function getTikisseDeliveryLiveLocation(deliveryId: string): Promise<TikisseLiveDeliveryPosition | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(tikisseDeliveryLiveLocations).where(eq(tikisseDeliveryLiveLocations.deliveryId, deliveryId)).limit(1);
  const location = rows[0];
  if (!location) return null;
  return {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    heading: Number(location.heading),
    recordedAt: location.recordedAt.toISOString(),
  };
}

export async function listTikisseDeliveriesForProfile(profilePhone: string, role: "sender" | "driver") {
  const db = await getDb();
  if (!db) return [];
  let predicate;
  let driverCandidacyDeliveryIds: string[] = [];
  if (role === "sender") {
    predicate = eq(tikisseDeliveries.senderPhone, profilePhone);
  } else {
    // Un candidat non retenu (statut "applied"/"withdrawn"/"replaced") doit pouvoir retrouver sa
    // candidature dans son propre historique même une fois qu'un autre livreur a été sélectionné —
    // sans cette clause, la livraison disparaissait silencieusement dès que `status` quittait "open"
    // et que `driverPhone` pointait vers quelqu'un d'autre.
    const candidacies = await db.select({ deliveryId: tikisseDeliveryCandidates.deliveryId }).from(tikisseDeliveryCandidates).where(eq(tikisseDeliveryCandidates.driverPhone, profilePhone));
    const candidacyDeliveryIds = candidacies.map((row) => row.deliveryId);
    driverCandidacyDeliveryIds = candidacyDeliveryIds;
    predicate = candidacyDeliveryIds.length > 0
      ? or(eq(tikisseDeliveries.status, "open"), eq(tikisseDeliveries.driverPhone, profilePhone), inArray(tikisseDeliveries.id, candidacyDeliveryIds))
      : or(eq(tikisseDeliveries.status, "open"), eq(tikisseDeliveries.driverPhone, profilePhone));
  }
  const rows = await db.select().from(tikisseDeliveries).where(predicate).orderBy(desc(tikisseDeliveries.createdAt));
  const deliveries = await deliveryJoins(rows);
  if (role !== "driver") return deliveries;
  return filterDeliveriesToDriverPerimeter(profilePhone, deliveries, driverCandidacyDeliveryIds);
}

/** Restreint les opportunités « open » au périmètre d'affichage du livreur (sa ville par défaut).
 *  Ne s'applique qu'aux courses ouvertes auxquelles il n'est pas déjà lié : une course qu'il a déjà
 *  acceptée, ou sur laquelle il a candidaté, reste toujours visible même hors périmètre — sinon elle
 *  disparaîtrait de son écran dès qu'il change de rayon ou de ville, sans qu'il puisse la retrouver. */
async function filterDeliveriesToDriverPerimeter(profilePhone: string, deliveries: Delivery[], candidacyDeliveryIds: string[]): Promise<Delivery[]> {
  const linkedDeliveryIds = new Set(candidacyDeliveryIds);
  const filterable = deliveries.filter((delivery) => delivery.status === "open" && delivery.driverId !== profilePhone && !linkedDeliveryIds.has(delivery.id));
  if (filterable.length === 0) return deliveries;
  const [profile, perimeter] = await Promise.all([
    getTikisseProfileByPhone(profilePhone),
    getDriverPerimeterPreferences(profilePhone),
  ]);
  return deliveries.filter((delivery) => {
    if (delivery.status !== "open" || delivery.driverId === profilePhone) return true;
    if (linkedDeliveryIds.has(delivery.id)) return true;
    return evaluatePerimeter({
      radiusKm: perimeter.discoveryRadiusKm,
      driverCity: profile?.city ?? null,
      base: { latitude: perimeter.baseLatitude, longitude: perimeter.baseLongitude, updatedAt: perimeter.baseUpdatedAt },
      pickup: {
        latitude: delivery.pickup.latitude,
        longitude: delivery.pickup.longitude,
        city: delivery.pickup.city ?? null,
        district: delivery.pickup.district ?? null,
        province: delivery.pickup.province ?? null,
      },
    }).matches;
  });
}

export async function expireOpenTikisseDeliveries(now = new Date()) {
  const db = await getDb();
  if (!db) return { expiredCount: 0, completedCount: 0, expiredDeliveryIds: [], completedDeliveryIds: [] } as const;
  const cutoff = new Date(now.getTime() - DELIVERY_EXPIRATION_MS);
  return db.transaction(async (tx) => {
    const stale = await tx.select().from(tikisseDeliveries)
      .where(and(inArray(tikisseDeliveries.status, ["open", "pending_confirmation", "active", "disabled"]), lt(sql`GREATEST(${tikisseDeliveries.updatedAt}, ${tikisseDeliveries.createdAt})`, cutoff)))
      .for("update");
    let expiredCount = 0;
    let completedCount = 0;
    const expiredDeliveryIds: string[] = [];
    const completedDeliveryIds: string[] = [];
    for (const delivery of stale) {
      const activityAt = deliveryActivityTimestamp({ createdAt: delivery.createdAt, updatedAt: delivery.updatedAt });
      const outcome = deliveryExpirationOutcome(delivery.status as "open" | "pending_confirmation" | "active" | "disabled", activityAt ?? delivery.createdAt, now.getTime());
      if (outcome === "complete" && delivery.driverPhone) {
        // Paiement direct Sender ↔ livreur, hors application : aucun crédit de Wallet ici (cf. completeTikisseDeliveryWithEvents).
        // Datée à l'échéance des 24 h, pas à l'heure où cette tâche passe : voir `autoCompletionTimestamp`.
        const completedAt = new Date(autoCompletionTimestamp(activityAt ?? delivery.createdAt, now.getTime()));
        await tx.update(tikisseDeliveries).set({ status: "completed", completedAt, updatedAt: now }).where(eq(tikisseDeliveries.id, delivery.id));
        await appendDeliveryEvent(tx, { deliveryId: delivery.id, eventType: "delivery_completed", status: "completed", recipientPhone: delivery.senderPhone, title: "Livraison terminée automatiquement", body: "La course en cours a été clôturée automatiquement après 24 heures.", tone: "success", idempotencyKey: `${delivery.id}:auto-completed-sender` });
        await appendDeliveryEvent(tx, { deliveryId: delivery.id, eventType: "delivery_completed", status: "completed", recipientPhone: delivery.driverPhone, title: "Livraison terminée automatiquement", body: "La course a été clôturée après 24 heures.", tone: "success", idempotencyKey: `${delivery.id}:auto-completed-driver` });
        completedCount += 1;
        completedDeliveryIds.push(delivery.id);
        continue;
      }
      if (outcome !== "expire") continue;
      const candidates = await tx.select().from(tikisseDeliveryCandidates)
        .where(and(eq(tikisseDeliveryCandidates.deliveryId, delivery.id), inArray(tikisseDeliveryCandidates.status, ["applied", "selected"])))
        .for("update");
      for (const candidate of candidates) {
        const debits = await tx.select().from(tikisseWalletLedger).where(and(eq(tikisseWalletLedger.deliveryId, delivery.id), eq(tikisseWalletLedger.profilePhone, candidate.driverPhone), inArray(tikisseWalletLedger.operation, ["debit", "commission_debit"]))).for("update");
        const debitedAmount = debits.reduce((total: number, entry: { amount: number }) => total + Number(entry.amount), 0);
        if (debitedAmount > 0) {
          await applyWalletMovement(tx, { profilePhone: candidate.driverPhone, deliveryId: delivery.id, operation: "compensation", amount: debitedAmount, availableDelta: debitedAmount, heldDelta: 0, reason: "Commission compensée : livraison expirée avant départ", idempotencyKey: `${delivery.id}:expired-compensation:${candidate.id}` });
        } else if (candidate.commissionBlocked > 0) {
          await applyWalletMovement(tx, {
            profilePhone: candidate.driverPhone,
            deliveryId: delivery.id,
            operation: "unblock",
            amount: candidate.commissionBlocked,
            availableDelta: candidate.commissionBlocked,
            heldDelta: -candidate.commissionBlocked,
            reason: "Commission libérée : livraison expirée après 24 h",
            idempotencyKey: `delivery-expired:${delivery.id}:${candidate.id}`,
          });
        }
        await tx.update(tikisseDeliveryCandidates).set({ status: "withdrawn" }).where(eq(tikisseDeliveryCandidates.id, candidate.id));
        await appendDeliveryEvent(tx, {
          deliveryId: delivery.id,
          eventType: "delivery_expired",
          status: "expired",
          recipientPhone: candidate.driverPhone,
          title: "Livraison annulée automatiquement",
          body: "Cette livraison n’a pas démarré dans les 24 heures. Votre commission a été libérée ou compensée.",
          tone: "warning",
          idempotencyKey: `delivery-expired-candidate:${delivery.id}:${candidate.id}`,
        });
      }
      await tx.update(tikisseDeliveries).set({ status: "expired", cancelledAt: now }).where(eq(tikisseDeliveries.id, delivery.id));
      await appendDeliveryEvent(tx, {
        deliveryId: delivery.id,
        eventType: "delivery_expired",
        status: "expired",
        recipientPhone: delivery.senderPhone,
        title: "Livraison annulée automatiquement",
        body: "Votre livraison n’a pas démarré dans les 24 heures et est conservée dans l’historique comme non terminée.",
        tone: "warning",
        idempotencyKey: `delivery-expired-sender:${delivery.id}`,
      });
      expiredCount += 1;
      expiredDeliveryIds.push(delivery.id);
    }
    return { expiredCount, completedCount, expiredDeliveryIds, completedDeliveryIds } as const;
  });
}

type WalletMovement = {
  profilePhone: string;
  deliveryId?: string;
  operation: WalletOperation;
  amount: number;
  availableDelta: number;
  heldDelta: number;
  reason: string;
  idempotencyKey: string;
};

type DeliveryEventInput = {
  deliveryId: string;
  eventType: string;
  status?: "draft" | "open" | "pending_confirmation" | "active" | "completed" | "disabled" | "cancelled" | "expired";
  actorPhone?: string;
  recipientPhone: string;
  title: string;
  body: string;
  tone: "info" | "success" | "warning";
  idempotencyKey: string;
  /** `false` pour créer la notification in-app sans envoyer de push. Utilisé par les alertes de
   *  nouvelles courses, qui sont opt-in (cf. tikisse_driver_preferences) : le livreur retrouve toujours
   *  l'opportunité dans son centre de notifications, mais son téléphone ne sonne que s'il l'a demandé.
   *  Les notifications transactionnelles ne passent jamais `false` : elles sont toujours poussées. */
  push?: boolean;
  /** `false` : événement enregistré pour la chronologie de la livraison (console, litiges) mais absent du
   *  fil de l'utilisateur, et jamais poussé. Pour l'écho de sa propre action sans enjeu d'argent, et pour
   *  les écritures internes à la plateforme. Règle : on ne notifie pas quelqu'un de ce qu'il vient de faire. */
  feed?: boolean;
};

export async function ensureTikisseWallet(tx: any, profilePhone: string) {
  await tx.insert(tikisseWallets).values({ profilePhone }).onDuplicateKeyUpdate({ set: { profilePhone } });
  const rows = await tx.select().from(tikisseWallets).where(eq(tikisseWallets.profilePhone, profilePhone)).limit(1).for("update");
  if (!rows[0]) throw new Error("Le Wallet est temporairement indisponible.");
  return rows[0];
}

export async function applyWalletMovement(tx: any, movement: WalletMovement) {
  if (!Number.isSafeInteger(movement.amount) || movement.amount <= 0) throw new Error("Montant financier invalide.");
  const existing = await tx.select().from(tikisseWalletLedger).where(eq(tikisseWalletLedger.idempotencyKey, movement.idempotencyKey)).limit(1);
  if (existing[0]) {
    return { availableAfter: existing[0].availableAfter, heldAfter: existing[0].heldAfter, idempotencyKey: existing[0].idempotencyKey };
  }
  const wallet = await ensureTikisseWallet(tx, movement.profilePhone);
  const availableBefore = wallet.availableBalance;
  const heldBefore = wallet.heldBalance;
  const availableAfter = availableBefore + movement.availableDelta;
  const heldAfter = heldBefore + movement.heldDelta;
  if (availableAfter < 0 || heldAfter < 0) throw new Error("Solde Wallet insuffisant pour cette opération.");
  await tx.update(tikisseWallets).set({ availableBalance: availableAfter, heldBalance: heldAfter, updatedAt: new Date() }).where(eq(tikisseWallets.profilePhone, movement.profilePhone));
  await tx.insert(tikisseWalletLedger).values({
    id: randomUUID(), profilePhone: movement.profilePhone, deliveryId: movement.deliveryId ?? null, operation: movement.operation,
    amount: movement.amount, availableBefore, availableAfter, heldBefore, heldAfter, reason: movement.reason, idempotencyKey: movement.idempotencyKey,
  });
  // Best-effort, comme le push transactionnel d'appendDeliveryEvent plus bas : ne dépend jamais de
  // cette transaction, ne la retarde jamais. Seul point d'appel de tout le Wallet — un dépôt, un
  // retrait, une commission bloquée ou débloquée, un ajustement admin passent tous par ici, donc
  // le signal Realtime couvre tout, y compris les mouvements qui n'ont jamais fait de la livraison
  // à l'origine (rien, sinon le polling, n'annonçait jusqu'ici un dépôt YengaPay qui vient de se régler).
  void notifyWalletChanged(movement.profilePhone);
  return { availableAfter, heldAfter, idempotencyKey: movement.idempotencyKey };
}

async function notifyWalletChanged(profilePhone: string) {
  try {
    const profile = await getTikisseProfileByPhone(profilePhone);
    if (profile?.supabaseUserId) void publishWalletBroadcast(profile.supabaseUserId);
  } catch (cause) {
    console.error("[wallet] signal Realtime non envoyé", cause);
  }
}

export async function appendDeliveryEvent(tx: any, event: DeliveryEventInput) {
  const eventId = randomUUID();
  await tx.insert(tikisseDeliveryEvents).values({
    id: eventId, deliveryId: event.deliveryId, eventType: event.eventType, status: event.status ?? null,
    actorPhone: event.actorPhone ?? null, recipientPhone: event.recipientPhone, title: event.title, body: event.body,
    tone: event.tone, metadata: null, feedHidden: event.feed === false, idempotencyKey: event.idempotencyKey,
  }).onDuplicateKeyUpdate({ set: { idempotencyKey: event.idempotencyKey } });
  if (event.recipientPhone && event.push !== false && event.feed !== false) {
    const persisted = (await tx.select({ id: tikisseDeliveryEvents.id }).from(tikisseDeliveryEvents).where(eq(tikisseDeliveryEvents.idempotencyKey, event.idempotencyKey)).limit(1))[0];
    // Clé déjà connue : l'insertion vient d'être ignorée, la notification existait déjà. La repousser
    // faisait sonner le téléphone une seconde fois pour le même événement (offre modifiée, rejeu…).
    if (persisted && persisted.id !== eventId) return;
    const data: Record<string, unknown> = { notificationId: persisted?.id ?? eventId, deliveryId: event.deliveryId, eventType: event.eventType, screen: event.status === "active" ? "tracking" : "delivery" };
    if (event.status) data.status = event.status;
    const push = { phone: event.recipientPhone, title: event.title, body: event.body, data, channelId: "tikisse-transactional" };
    // Dans une transaction : envoyé à sa validation seulement (deferPushesUntilCommit). Hors transaction : tout de suite.
    const awaiting = pushesAwaitingCommit.get(tx);
    if (awaiting) awaiting.push(push);
    else void enqueuePushToPhone(push).catch(() => {});
  }
}

export async function listSupportedCountries(onlyEnabled = true) {
  const db = await getDb();
  if (!db) return [];
  const rows = onlyEnabled
    ? await db.select().from(tikisseSupportedCountries).where(eq(tikisseSupportedCountries.enabled, true))
    : await db.select().from(tikisseSupportedCountries);
  return rows.sort((a, b) => a.sortOrder - b.sortOrder).map((row) => ({
    id: row.id, name: row.name, flag: row.id, dialCode: row.dialCode, digits: row.digits,
    groups: row.groups.split(",").map(Number), timeZones: row.timeZones.split(","), enabled: row.enabled,
    // Règle structurelle, pas une valeur d'exploitation : elle ne se saisit pas
    // dans la console, elle se déduit du pays. Sans elle, la validation du
    // numéro rejetterait tous les numéros béninois, qui commencent par 01.
    allowsLeadingZero: isoCountry(row.id)?.allowsLeadingZero ?? false,
  }));
}

export async function getTikisseCommissionRate() {
  const db = await getDb();
  if (!db) throw new Error("La configuration de commission est temporairement indisponible.");
  await db.insert(tikissePlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const settings = await db.select().from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1);
  const rate = Number(settings[0]?.commissionRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) throw new Error("Le taux de commission configuré est invalide.");
  return rate;
}

export async function getTikisseWalletSnapshot(profilePhone: string): Promise<WalletSnapshot> {
  const db = await getDb();
  if (!db) return { total: 0, blocked: 0 };
  await db.insert(tikisseWallets).values({ profilePhone }).onDuplicateKeyUpdate({ set: { profilePhone } });
  const rows = await db.select().from(tikisseWallets).where(eq(tikisseWallets.profilePhone, profilePhone)).limit(1);
  const wallet = rows[0];
  if (!wallet) return { total: 0, blocked: 0 };
  return { total: wallet.availableBalance + wallet.heldBalance, blocked: wallet.heldBalance };
}

export async function listTikisseWalletLedger(profilePhone: string): Promise<FinancialRecord[]> {
  const db = await getDb();
  if (!db) return [];
  const entries = await db.select().from(tikisseWalletLedger).where(eq(tikisseWalletLedger.profilePhone, profilePhone)).orderBy(desc(tikisseWalletLedger.createdAt));
  return entries.map((entry) => ({ id: entry.id, deliveryId: entry.deliveryId ?? "", createdAt: entry.createdAt.toISOString(), operation: entry.operation as WalletOperation, amount: entry.amount, balanceBefore: entry.availableBefore + entry.heldBefore, balanceAfter: entry.availableAfter + entry.heldAfter, reason: entry.reason }));
}

/** Historique informatif des gains d'un livreur, calculé à partir des livraisons terminées — jamais depuis le
 *  Wallet, qui n'est jamais crédité par une livraison (le paiement de la course se fait hors application). Le
 *  format reprend celui de `FinancialRecord` pour rester compatible avec les écrans "Gains" existants.
 *
 *  Le gain est net de commission. Le livreur encaisse bien le prix de la course auprès de l'expéditeur, mais la
 *  commission Tikisse a déjà quitté son Wallet au moment où il a confirmé sa disponibilité (mouvement
 *  `commission_debit`) : une course à 2 000 FCFA commissionnée à 10 % lui rapporte 1 800 FCFA, pas 2 000.
 *  L'afficher brute surestimait chaque gain, et donc tous les totaux qui en découlent ("Gains du jour" de
 *  l'accueil, onglet Gains, meilleure journée).
 *
 *  Le calcul lui-même vit dans `netDriverEarning` (shared/tikisse-domain.ts), qui documente pourquoi on
 *  soustrait `accruedCommission` plutôt qu'une commission recalculée depuis le barème du jour. */
export async function getDriverCompletedDeliveryEarnings(driverPhone: string): Promise<FinancialRecord[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(tikisseDeliveries).where(and(eq(tikisseDeliveries.driverPhone, driverPhone), eq(tikisseDeliveries.status, "completed"))).orderBy(desc(tikisseDeliveries.completedAt));
  return rows.map((row) => {
    const gross = Math.round(row.offeredPrice ?? row.estimatedPrice);
    const commission = row.accruedCommission ?? 0;
    const amount = netDriverEarning(gross, commission);
    return {
      id: `${row.id}:earning`,
      deliveryId: row.id,
      createdAt: (row.completedAt ?? row.updatedAt).toISOString(),
      operation: "credit",
      amount,
      balanceBefore: 0,
      balanceAfter: 0,
      reason: commission > 0
        ? `Gain net : ${gross} FCFA encaissés moins ${commission} FCFA de commission Tikisse déjà prélevés sur votre Wallet`
        : "Gain de livraison (payé directement par l’expéditeur, non crédité au Wallet Tikisse)",
    } satisfies FinancialRecord;
  });
}

export async function requestTikisseWalletOperation(profilePhone: string, type: "deposit" | "withdrawal", amount: number, requestId: string) {
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 10_000_000) throw new Error("Le montant demandé est invalide.");
  const db = await getDb();
  if (!db) throw new Error("Le Wallet est temporairement indisponible.");
  await db.transaction(async (tx) => {
    // `requestId` est fourni par l'appelant (généré une seule fois par soumission) : une relance réseau
    // de la même demande ne doit pas créer une seconde ligne. On vérifie d'abord (comme le fait
    // `applyWalletMovement` partout ailleurs) plutôt que de s'appuyer sur `onDuplicateKeyUpdate`, qui
    // déclencherait une vraie clause UPDATE — bloquée par le trigger d'immuabilité de `tikisse_wallet_ledger`
    // (drizzle/manual/0034_wallet_ledger_hardening.sql), même pour ré-écrire la même valeur.
    const idempotencyKey = `${type}:${profilePhone}:${requestId}`;
    const existing = await tx.select({ id: tikisseWalletLedger.id }).from(tikisseWalletLedger).where(eq(tikisseWalletLedger.idempotencyKey, idempotencyKey)).limit(1);
    if (existing.length > 0) return;
    const wallet = await ensureTikisseWallet(tx, profilePhone);
    if (type === "withdrawal" && wallet.availableBalance < amount) throw new Error("Votre solde disponible est insuffisant pour ce retrait.");
    await tx.insert(tikisseWalletLedger).values({
      id: randomUUID(), profilePhone, deliveryId: null, operation: type === "deposit" ? "deposit_request" : "withdrawal_request", amount,
      availableBefore: wallet.availableBalance, availableAfter: wallet.availableBalance, heldBefore: wallet.heldBalance, heldAfter: wallet.heldBalance,
      reason: type === "deposit" ? "Demande de dépôt en attente d’un moyen de paiement autorisé" : "Demande de retrait en attente de traitement", idempotencyKey,
    });
  });
  return { success: true } as const;
}

// ===== Paiement Mobile Money direct (in-app, sans redirection web) =====
// On réutilise la table tikisse_payment_transactions avec le provider yengapay_direct_* et on ajoute
// les colonnes ussdCode / phoneE164 / operatorCode / countryCode / expiresAt via la migration
// drizzle/manual/0040_direct_deposit_metadata.sql.

export type DirectDepositRecord = {
  transactionId: string;
  profilePhone: string;
  amount: number;
  phone: string;
  operator: "orange_money" | "moov_money";
  countryCode: string;
  ussdCode: string;
  providerReference: string;
  status: "pending" | "succeeded" | "failed" | "cancelled" | "expired";
  expiresAt: string;
  createdAt: string;
  settledAt: string | null;
  /** Mode dérivé du provider : utile au client pour adapter l'UI (ex: carte __DEV__). */
  mode: "test" | "sandbox" | "live";
};

function paymentTransactionToDirectDeposit(record: typeof tikissePaymentTransactions.$inferSelect): DirectDepositRecord {
  const isLive = record.provider === "yengapay_direct_live";
  const isSandbox = record.provider === "yengapay_direct_sandbox";
  const mode: DirectDepositRecord["mode"] = isLive ? "live" : isSandbox ? "sandbox" : "test";
  return {
    transactionId: record.id,
    profilePhone: record.profilePhone,
    amount: record.amount,
    phone: record.phoneE164 ?? "",
    operator: (record.operatorCode as "orange_money" | "moov_money" | null) ?? "orange_money",
    countryCode: record.countryCode ?? "",
    ussdCode: record.ussdCode ?? "",
    providerReference: record.providerReference,
    status: record.status,
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : new Date(Date.now() + 60_000).toISOString(),
    createdAt: record.createdAt.toISOString(),
    settledAt: record.settledAt ? record.settledAt.toISOString() : null,
    mode,
  };
}

/** Crée un record de paiement direct, sans créditer le Wallet avant confirmation PSP. */
export async function recordDirectDepositIntent(input: {
  transactionId: string;
  profilePhone: string;
  amount: number;
  phone: string;
  operator: "orange_money" | "moov_money";
  countryCode: string;
  ussdCode: string;
  expiresAt: string;
  idempotencyKey: string;
  providerReference?: string;
  mode?: "test" | "sandbox" | "live";
}) {
  const db = await getDb();
  if (!db) throw new Error("Le paiement direct est temporairement indisponible.");
  const providerName = input.mode === "sandbox" ? "yengapay_direct_sandbox" as const : input.mode === "live" ? "yengapay_direct_live" as const : "yengapay_direct_test" as const;
  await db.insert(tikissePaymentTransactions).values({
    id: input.transactionId,
    profilePhone: input.profilePhone,
    type: "deposit",
    provider: providerName,
    amount: input.amount,
    status: "pending",
    providerReference: input.providerReference ?? `direct_test_${input.transactionId}`,
    checkoutUrl: null,
    ussdCode: input.ussdCode,
    phoneE164: input.phone,
    operatorCode: input.operator,
    countryCode: input.countryCode,
    expiresAt: new Date(input.expiresAt),
    idempotencyKey: `direct:${input.profilePhone}:${input.idempotencyKey}`,
  });
}

/** @deprecated Utiliser recordDirectDepositIntent avec un mode explicite. */
export const recordDirectDepositTestIntent = recordDirectDepositIntent;

/** Lit le record d'un paiement direct par transactionId. */
export async function getDirectDepositIntent(transactionId: string, profilePhone: string): Promise<DirectDepositRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("Le paiement direct est temporairement indisponible.");
  const record = (await db.select().from(tikissePaymentTransactions).where(and(eq(tikissePaymentTransactions.id, transactionId), eq(tikissePaymentTransactions.profilePhone, profilePhone))).limit(1))[0];
  if (!record) return null;
  return paymentTransactionToDirectDeposit(record);
}

/** Retrouve une intention déjà créée après une relance réseau de la même demande. */
export async function getDirectDepositByIdempotencyKey(profilePhone: string, idempotencyKey: string): Promise<DirectDepositRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("Le paiement direct est temporairement indisponible.");
  const record = (await db.select().from(tikissePaymentTransactions).where(and(
    eq(tikissePaymentTransactions.profilePhone, profilePhone),
    eq(tikissePaymentTransactions.idempotencyKey, `direct:${profilePhone}:${idempotencyKey}`),
  )).limit(1))[0];
  return record ? paymentTransactionToDirectDeposit(record) : null;
}

/** Met à jour le statut d'un paiement direct (test uniquement, sandbox/live passe par le webhook). */
export async function settleDirectDeposit(input: { transactionId: string; status: "succeeded" | "failed" }) {
  const db = await getDb();
  if (!db) throw new Error("Le paiement direct est temporairement indisponible.");
  await db.update(tikissePaymentTransactions).set({ status: input.status, settledAt: new Date() }).where(eq(tikissePaymentTransactions.id, input.transactionId));
}

/**
 * Liste les paiements directs encore en attente pour un profil donné. Sert à la reprise côté
 * client quand l'utilisateur a fermé l'app pendant le polling : on ne perd pas le dépôt, il
 * reste interrogeable tant qu'il n'a pas expiré et que le webhook n'a pas fired.
 *
 * Filtre : provider LIKE 'yengapay_direct_%' AND status='pending' AND expiresAt > NOW().
 * On exclut les expirés — ils sont déjà rattrapés par le webhook handler (qui les passe à
 * `failed`) ou bien le client les verra dans son journal comme échoués.
 *
 * Tri : du plus récent au plus ancien, pour que la bannière wallet montre en priorité le dernier
 * dépôt initié.
 */
export async function listPendingDirectDeposits(profilePhone: string): Promise<DirectDepositRecord[]> {
  const db = await getDb();
  if (!db) return [];
  const records = await db
    .select()
    .from(tikissePaymentTransactions)
    .where(and(
      eq(tikissePaymentTransactions.profilePhone, profilePhone),
      eq(tikissePaymentTransactions.type, "deposit"),
      eq(tikissePaymentTransactions.status, "pending"),
      // `provider` est un enum MySQL, pas un LIKE arbitraire : on teste les 3 valeurs direct
      // explicitement. Si on ajoute un nouveau provider direct un jour, mettre à jour ici aussi.
      inArray(tikissePaymentTransactions.provider, ["yengapay_direct_test", "yengapay_direct_sandbox", "yengapay_direct_live"]),
      // Expiré = `expiresAt` est dans le passé. SQL brut : comparaison directe avec NOW().
      // On garde les rows dont expiresAt est NULL OU dans le futur — un expiresAt NULL signifie
      // "pas d'expiration" (cas dégénéré, mais on reste permissif).
      or(sql`${tikissePaymentTransactions.expiresAt} IS NULL`, sql`${tikissePaymentTransactions.expiresAt} > NOW()`),
    ))
    .orderBy(desc(tikissePaymentTransactions.createdAt))
    .limit(10);
  return records.map(paymentTransactionToDirectDeposit);
}

/**
 * Un dépôt que YengaPay déclare réussi est crédité, quel que soit son statut local — sauf s'il l'est déjà.
 *
 * L'argent a quitté le compte Mobile Money du client : c'est cette confirmation qui fait foi, pas une
 * expiration décidée par notre horloge ni une annulation tapée dans l'app. Seul un statut `pending` était
 * accepté ; un paiement confirmé après 15 minutes, ou après un « Annuler » pendant que l'opérateur
 * traitait encore le code, était perdu pour le client.
 */
export function mayCreditConfirmedDeposit(status: string): boolean {
  return status !== "succeeded";
}

/**
 * Clé du crédit d'un dépôt, commune au webhook et au suivi côté app : quel que soit le chemin qui confirme
 * le premier, le second retrouve cette clé dans le journal et ne crédite pas une seconde fois.
 */
function depositCreditKey(paymentId: string) {
  return `${paymentId}:settled`;
}

/** Crédite le Wallet suite à un dépôt direct réussi. */
export async function settleTikisseWalletDepositRequest(input: { profilePhone: string; transactionId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Le Wallet est temporairement indisponible.");
  return db.transaction(async (tx) => {
    const payment = (await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, input.transactionId)).limit(1).for("update"))[0];
    if (!payment) throw new Error("Transaction de dépôt direct introuvable.");
    if (payment.profilePhone !== input.profilePhone) throw new Error("Cette transaction n'appartient pas à ce profil.");
    if (!mayCreditConfirmedDeposit(payment.status)) return; // déjà crédité (le webhook est passé avant)
    await applyWalletMovement(tx, {
      profilePhone: payment.profilePhone,
      operation: "credit",
      amount: payment.amount,
      availableDelta: payment.amount,
      heldDelta: 0,
      reason: "Dépôt Mobile Money direct confirmé",
      idempotencyKey: depositCreditKey(payment.id),
    });
    await tx.update(tikissePaymentTransactions).set({ status: "succeeded", settledAt: new Date() }).where(eq(tikissePaymentTransactions.id, payment.id));
  });
}

/** Refuse un dépôt direct (le client a annulé ou l'opérateur a rejeté). */
export async function refuseTikisseWalletDepositRequest(input: { profilePhone: string; transactionId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Le Wallet est temporairement indisponible.");
  return db.transaction(async (tx) => {
    const payment = (await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, input.transactionId)).limit(1).for("update"))[0];
    if (!payment) return;
    if (payment.profilePhone !== input.profilePhone) throw new Error("Cette transaction n'appartient pas à ce profil.");
    if (payment.status !== "pending") return;
    await tx.update(tikissePaymentTransactions).set({ status: "failed", settledAt: new Date() }).where(eq(tikissePaymentTransactions.id, payment.id));
  });
}

/** Ferme explicitement une demande directe sans modifier le solde. */
export async function cancelTikisseWalletDirectDeposit(input: { profilePhone: string; transactionId: string; status: "cancelled" | "expired" }) {
  const db = await getDb();
  if (!db) throw new Error("Le paiement direct est temporairement indisponible.");
  return db.transaction(async (tx) => {
    const payment = (await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, input.transactionId)).limit(1).for("update"))[0];
    if (!payment) throw new Error("Transaction de dépôt direct introuvable.");
    if (payment.profilePhone !== input.profilePhone) throw new Error("Cette transaction n'appartient pas à ce profil.");
    if (payment.status === "pending") {
      await tx.update(tikissePaymentTransactions).set({ status: input.status, settledAt: new Date() }).where(eq(tikissePaymentTransactions.id, payment.id));
    }
    return paymentTransactionToDirectDeposit((await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, payment.id)).limit(1))[0]);
  });
}

type YengaPayTestPaymentView = { id: string; type: "deposit" | "withdrawal"; amount: number; status: "pending" | "succeeded" | "failed" | "cancelled" | "expired"; providerReference: string; checkoutUrl?: string; mode: "test" | "sandbox" | "live"; createdAt: string; settledAt?: string };
type YengaPayTestPaymentSettlement = { payment: YengaPayTestPaymentView; wallet: WalletSnapshot };

function yengaPayTestPaymentToView(payment: { id: string; type: "deposit" | "withdrawal"; amount: number; status: "pending" | "succeeded" | "failed" | "cancelled" | "expired"; provider: typeof tikissePaymentTransactions.$inferSelect.provider; providerReference: string; checkoutUrl: string | null; createdAt: Date; settledAt: Date | null }): YengaPayTestPaymentView {
  // Un versement manuel (clôture de compte) est de l'argent réel, comme un retrait live.
  const mode = payment.provider.endsWith("_sandbox") ? "sandbox" : payment.provider.endsWith("_live") || payment.provider === "manual_payout" ? "live" : "test";
  return { id: payment.id, type: payment.type, amount: payment.amount, status: payment.status, providerReference: payment.providerReference, mode, ...(payment.checkoutUrl ? { checkoutUrl: payment.checkoutUrl } : {}), createdAt: payment.createdAt.toISOString(), ...(payment.settledAt ? { settledAt: payment.settledAt.toISOString() } : {}) };
}

function walletSnapshotFromRecord(wallet: { availableBalance: number; heldBalance: number }): WalletSnapshot {
  return { total: wallet.availableBalance + wallet.heldBalance, blocked: wallet.heldBalance };
}

export async function initiateYengaPayPayment(input: { profilePhone: string; type: "deposit" | "withdrawal"; amount: number; idempotencyKey: string }) {
  if (!Number.isSafeInteger(input.amount) || input.amount < 100 || input.amount > 10_000_000) throw new Error("Le montant demandé est invalide.");
  if (!/^[A-Za-z0-9_-]{16,96}$/.test(input.idempotencyKey)) throw new Error("Référence de paiement invalide.");
  const db = await getDb();
  if (!db) throw new Error("Le paiement est temporairement indisponible.");
  const config = readYengapayConfig();
  return db.transaction(async (tx) => {
    const existing = (await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.idempotencyKey, input.idempotencyKey)).limit(1).for("update"))[0];
    if (existing) {
      if (existing.profilePhone !== input.profilePhone) throw new Error("Référence de paiement invalide.");
      return yengaPayTestPaymentToView(existing);
    }
    const wallet = await ensureTikisseWallet(tx, input.profilePhone);
    if (input.type === "withdrawal" && wallet.availableBalance < input.amount) throw new Error("Votre solde disponible est insuffisant pour ce retrait.");
    const id = randomUUID();
    let providerReference = `YENGA-TEST-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
    let checkoutUrl: string | null = null;
    let providerName: "yengapay_test" | "yengapay_sandbox" | "yengapay_live" = "yengapay_test";
    if (config.mode !== "test") {
      try {
        const intent = await createYengapayPaymentIntent({ paymentTransactionId: id, amount: input.amount, type: input.type, phone: input.profilePhone });
        providerReference = intent.providerReference;
        checkoutUrl = intent.checkoutUrl ?? null;
        providerName = config.mode === "sandbox" ? "yengapay_sandbox" : "yengapay_live";
      } catch (cause) {
        throw cause instanceof Error ? cause : new Error("Le paiement Mobile Money est momentanément indisponible. Réessayez dans quelques instants.");
      }
    }
    await tx.insert(tikissePaymentTransactions).values({ id, profilePhone: input.profilePhone, type: input.type, provider: providerName, amount: input.amount, status: "pending", providerReference, checkoutUrl, idempotencyKey: input.idempotencyKey });
    const providerMode = providerName === "yengapay_sandbox" ? "sandbox" : providerName === "yengapay_live" ? "live" : "test";
    await tx.insert(tikisseWalletLedger).values({ id: randomUUID(), profilePhone: input.profilePhone, deliveryId: null, operation: input.type === "deposit" ? "deposit_request" : "withdrawal_request", amount: input.amount, availableBefore: wallet.availableBalance, availableAfter: wallet.availableBalance, heldBefore: wallet.heldBalance, heldAfter: wallet.heldBalance, reason: `Demande ${input.type === "deposit" ? "de dépôt" : "de retrait"} YengaPay en mode ${providerMode}`, idempotencyKey: `${id}:requested` });
    const created = (await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, id)).limit(1))[0];
    if (!created) throw new Error("La demande de paiement n’a pas pu être créée.");
    return yengaPayTestPaymentToView(created);
  });
}

/** @deprecated Utiliser initiateYengaPayPayment. Conservé pour les clients déjà déployés. */
export const initiateYengaPayTestPayment = initiateYengaPayPayment;

export async function settleYengaPayTestPayment(input: { profilePhone: string; paymentId: string; outcome: "succeeded" | "failed" }) {
  const db = await getDb();
  if (!db) throw new Error("Le paiement est temporairement indisponible.");
  return db.transaction(async (tx) => {
    const payment = (await tx.select().from(tikissePaymentTransactions).where(and(eq(tikissePaymentTransactions.id, input.paymentId), eq(tikissePaymentTransactions.profilePhone, input.profilePhone))).limit(1).for("update"))[0];
    if (!payment) throw new Error("Transaction YengaPay introuvable.");
    // Sans ce contrôle, n'importe quel utilisateur créait une transaction live — jamais payée — puis la
    // déclarait « réussie » ici : son Wallet était crédité du montant demandé, jusqu'à 10 000 000 FCFA.
    assertSimulatedSettlementAllowed(payment.provider);
    if (payment.status !== "pending") {
      const wallet = await ensureTikisseWallet(tx, payment.profilePhone);
      return { payment: yengaPayTestPaymentToView(payment), wallet: walletSnapshotFromRecord(wallet) } satisfies YengaPayTestPaymentSettlement;
    }
    if (input.outcome === "failed") {
      await tx.update(tikissePaymentTransactions).set({ status: "failed", settledAt: new Date() }).where(eq(tikissePaymentTransactions.id, payment.id));
    } else if (payment.type === "deposit") {
      await applyWalletMovement(tx, { profilePhone: payment.profilePhone, operation: "credit", amount: payment.amount, availableDelta: payment.amount, heldDelta: 0, reason: "Dépôt YengaPay en mode test confirmé", idempotencyKey: `${payment.id}:settled` });
      await tx.update(tikissePaymentTransactions).set({ status: "succeeded", settledAt: new Date() }).where(eq(tikissePaymentTransactions.id, payment.id));
    } else {
      await applyWalletMovement(tx, { profilePhone: payment.profilePhone, operation: "debit", amount: payment.amount, availableDelta: -payment.amount, heldDelta: 0, reason: "Retrait YengaPay en mode test confirmé", idempotencyKey: `${payment.id}:settled` });
      await tx.update(tikissePaymentTransactions).set({ status: "succeeded", settledAt: new Date() }).where(eq(tikissePaymentTransactions.id, payment.id));
    }
    const settled = (await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, payment.id)).limit(1))[0];
    if (!settled) throw new Error("La transaction n’a pas pu être finalisée.");
    const wallet = await ensureTikisseWallet(tx, payment.profilePhone);
    return { payment: yengaPayTestPaymentToView(settled), wallet: walletSnapshotFromRecord(wallet) } satisfies YengaPayTestPaymentSettlement;
  });
}

/** Crédit/débit manuel décidé par l'administration (récompense, bonus, pénalité, correction).
 *  `idempotencyKey` doit être déterministe côté appelant (lié à l'action logique, pas généré à
 *  chaque appel) pour qu'un double-clic ou une relance réseau ne produise jamais un second
 *  mouvement réel — `applyWalletMovement` renvoie alors simplement le résultat déjà enregistré.
 *  `tx` est optionnel : le fournir permet d'inclure ce mouvement dans une transaction plus large
 *  (ex. `adminForceCancelDelivery`) afin qu'un échec ultérieur fasse un rollback complet plutôt
 *  que de laisser un crédit déjà validé à côté d'un état non mis à jour. */
export async function adminAdjustWallet(
  input: { profilePhone: string; amount: number; direction: "credit" | "debit"; operation: "bonus" | "penalty" | "credit" | "debit"; reason: string; idempotencyKey: string },
  tx?: any,
) {
  const run = async (activeTx: any) => {
    await applyWalletMovement(activeTx, {
      profilePhone: input.profilePhone,
      operation: input.operation,
      amount: input.amount,
      availableDelta: input.direction === "credit" ? input.amount : -input.amount,
      heldDelta: 0,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
    return walletSnapshotFromRecord(await ensureTikisseWallet(activeTx, input.profilePhone));
  };
  if (tx) return { wallet: await run(tx) };
  const db = await getDb();
  if (!db) throw new Error("Le Wallet est temporairement indisponible.");
  const wallet = await db.transaction(run);
  return { wallet };
}

/** Traitement admin d'une demande de dépôt/retrait YengaPay en attente (validation manuelle du provider). */
export async function adminSettlePaymentTransaction(input: { paymentId: string; outcome: "succeeded" | "failed"; adminId: number; notes?: string; payoutReference?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Le paiement est temporairement indisponible.");
  const notes = input.notes?.trim() || null;
  const payoutReference = input.payoutReference?.trim() || null;
  // Qui a tranché, et pourquoi : gardé sur la transaction elle-même, pas seulement dans le journal d'audit.
  const decision = { adminNotes: notes, settledByAdminId: input.adminId };
  return db.transaction(async (tx) => {
    const payment = (await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, input.paymentId)).limit(1).for("update"))[0];
    if (!payment) throw new Error("Transaction introuvable.");
    if (payment.status !== "pending") {
      const wallet = await ensureTikisseWallet(tx, payment.profilePhone);
      return { payment: yengaPayTestPaymentToView(payment), wallet: walletSnapshotFromRecord(wallet) } satisfies YengaPayTestPaymentSettlement;
    }
    if (input.outcome === "failed") {
      await tx.update(tikissePaymentTransactions).set({ status: "failed", settledAt: new Date(), ...decision }).where(eq(tikissePaymentTransactions.id, payment.id));
    } else if (payment.type === "deposit") {
      // Un dépôt YengaPay réel n'est crédité que sur la parole de YengaPay (webhook ou réconciliation).
      // Un clic « Valider » sur une intention restée en attente — l'utilisateur a pu ne jamais payer —
      // créditait sans aucune preuve de paiement. Le rejet, lui, reste permis : si YengaPay confirme
      // plus tard, le dépôt est crédité quand même (`mayCreditConfirmedDeposit`).
      if (!(YENGAPAY_TEST_PROVIDERS as readonly string[]).includes(payment.provider)) {
        throw new Error("Ce dépôt passe par YengaPay : seul YengaPay peut en confirmer le paiement. Utilisez « Vérifier auprès de YengaPay ».");
      }
      await applyWalletMovement(tx, { profilePhone: payment.profilePhone, operation: "credit", amount: payment.amount, availableDelta: payment.amount, heldDelta: 0, reason: "Dépôt validé manuellement par l’administration", idempotencyKey: `${payment.id}:admin-settled` });
      await tx.update(tikissePaymentTransactions).set({ status: "succeeded", settledAt: new Date(), ...decision }).where(eq(tikissePaymentTransactions.id, payment.id));
    } else {
      // Le versement Mobile Money se fait hors application : valider un retrait, c'est attester qu'il a eu
      // lieu. Sans référence, rien ne distinguait un retrait réellement versé d'un clic distrait — et rien
      // n'empêchait de justifier deux retraits par le même versement (index unique sur la colonne).
      if (!payoutReference || payoutReference.length < 4 || payoutReference.length > 80) throw new Error("Indiquez la référence du versement Mobile Money (4 à 80 caractères) pour valider ce retrait.");
      if (!notes) throw new Error("Ajoutez une note sur le versement (opérateur, numéro crédité…) pour valider ce retrait.");
      const reused = (await tx.select({ id: tikissePaymentTransactions.id }).from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.payoutReference, payoutReference)).limit(1))[0];
      if (reused) throw new Error("Cette référence de versement est déjà utilisée pour un autre retrait.");
      const wallet = await ensureTikisseWallet(tx, payment.profilePhone);
      if (wallet.availableBalance < payment.amount) throw new Error("Le solde disponible de l’utilisateur est désormais insuffisant pour ce retrait.");
      await applyWalletMovement(tx, { profilePhone: payment.profilePhone, operation: "debit", amount: payment.amount, availableDelta: -payment.amount, heldDelta: 0, reason: `Retrait versé (réf. ${payoutReference}) et validé par l’administration`, idempotencyKey: `${payment.id}:admin-settled` });
      try {
        await tx.update(tikissePaymentTransactions).set({ status: "succeeded", settledAt: new Date(), payoutReference, ...decision }).where(eq(tikissePaymentTransactions.id, payment.id));
      } catch (cause) {
        // Deux validations simultanées avec la même référence : l'index unique tranche, la transaction entière
        // (débit compris) est annulée.
        if ((cause as { code?: string; cause?: { code?: string } })?.code === "ER_DUP_ENTRY" || (cause as { cause?: { code?: string } })?.cause?.code === "ER_DUP_ENTRY") {
          throw new Error("Cette référence de versement est déjà utilisée pour un autre retrait.");
        }
        throw cause;
      }
    }
    const settled = (await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, payment.id)).limit(1))[0];
    if (!settled) throw new Error("La transaction n’a pas pu être finalisée.");
    const wallet = await ensureTikisseWallet(tx, payment.profilePhone);
    return { payment: yengaPayTestPaymentToView(settled), wallet: walletSnapshotFromRecord(wallet) } satisfies YengaPayTestPaymentSettlement;
  });
}

export async function listTikisseDeliveryEvents(profilePhone: string): Promise<InAppNotification[]> {
  const db = await getDb();
  if (!db) return [];
  const events = await db.select({
    id: tikisseDeliveryEvents.id, deliveryId: tikisseDeliveryEvents.deliveryId, title: tikisseDeliveryEvents.title,
    body: tikisseDeliveryEvents.body, createdAt: tikisseDeliveryEvents.createdAt, readAt: tikisseDeliveryEvents.readAt, tone: tikisseDeliveryEvents.tone,
    deliveryStatus: tikisseDeliveries.status,
  }).from(tikisseDeliveryEvents).leftJoin(tikisseDeliveries, eq(tikisseDeliveryEvents.deliveryId, tikisseDeliveries.id))
    .where(and(eq(tikisseDeliveryEvents.recipientPhone, profilePhone), eq(tikisseDeliveryEvents.feedHidden, false))).orderBy(desc(tikisseDeliveryEvents.createdAt));
  return events.map((event) => ({ id: event.id, deliveryId: event.deliveryId, deliveryStatus: event.deliveryStatus ?? undefined, title: event.title, body: event.body, createdAt: event.createdAt.toISOString(), read: Boolean(event.readAt), tone: event.tone }));
}

export async function markTikisseDeliveryEventsRead(profilePhone: string) {
  const db = await getDb();
  if (!db) return { success: true } as const;
  await db.update(tikisseDeliveryEvents).set({ readAt: new Date() }).where(and(eq(tikisseDeliveryEvents.recipientPhone, profilePhone), eq(tikisseDeliveryEvents.feedHidden, false), isNull(tikisseDeliveryEvents.readAt)));
  return { success: true } as const;
}

export async function markTikisseDeliveryEventRead(notificationId: string, profilePhone: string) {
  const db = await getDb();
  if (!db) return { success: false } as const;
  await db.update(tikisseDeliveryEvents).set({ readAt: new Date() }).where(and(eq(tikisseDeliveryEvents.id, notificationId), eq(tikisseDeliveryEvents.recipientPhone, profilePhone), isNull(tikisseDeliveryEvents.readAt)));
  return { success: true } as const;
}

const MAX_OPEN_APPLICATIONS_PER_DRIVER = 50;
const MAX_APPLICATIONS_PER_DAY = 200;

type DbHandle = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function enforceDriverApplicationRateLimit(driverPhone: string, db: DbHandle) {
  const openCount = (await db.select({ count: count() }).from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.driverPhone, driverPhone), inArray(tikisseDeliveryCandidates.status, ["applied", "selected"]))))[0]?.count ?? 0;
  if (Number(openCount) >= MAX_OPEN_APPLICATIONS_PER_DRIVER) {
    throw new Error(`Vous avez déjà ${MAX_OPEN_APPLICATIONS_PER_DRIVER} candidatures en cours. Annulez-en avant d’en proposer une nouvelle.`);
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayCount = (await db.select({ count: count() }).from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.driverPhone, driverPhone), gte(tikisseDeliveryCandidates.createdAt, since))))[0]?.count ?? 0;
  if (Number(dayCount) >= MAX_APPLICATIONS_PER_DAY) {
    throw new Error(`Limite quotidienne de ${MAX_APPLICATIONS_PER_DAY} candidatures atteinte. Réessaie demain.`);
  }
}

/** Rate-limit partagé entre toutes les instances du serveur, via une table plutôt qu'un compteur en
 *  mémoire de processus (qui ne protège que l'instance qui le détient — un attaquant réparti sur
 *  plusieurs connexions peut alors multiplier la limite effective par le nombre d'instances).
 *  Fenêtre fixe (bucket = fenêtre temporelle entière, pas une fenêtre glissante) : plus simple et
 *  suffisamment précis pour du rate-limiting anti-abus, sans nécessiter un magasin partagé type Redis.
 *  Incrément atomique via `ON DUPLICATE KEY UPDATE count = count + 1` (sûr sous concurrence). */
export async function checkDistributedRateLimit(scope: string, identifier: string, windowMs: number, maxRequests: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return true; // Panne DB : ne jamais bloquer l'usage à cause d'un souci d'infrastructure du rate-limit lui-même.
  const bucket = Math.floor(Date.now() / windowMs);
  const rateLimitKey = `${scope}:${identifier}:${bucket}`.slice(0, 191);
  await db.insert(tikisseRateLimits).values({ rateLimitKey, count: 1 }).onDuplicateKeyUpdate({ set: { count: sql`${tikisseRateLimits.count} + 1` } });
  const row = (await db.select({ count: tikisseRateLimits.count }).from(tikisseRateLimits).where(eq(tikisseRateLimits.rateLimitKey, rateLimitKey)).limit(1))[0];
  if (Math.random() < 0.01) {
    // Seulement les compteurs de cette limite : le nettoyage d'une limite à fenêtre courte (1 min pour les
    // lieux) effaçait aussi les compteurs des limites à fenêtre longue (15 min pour les paiements).
    const staleBefore = new Date(Date.now() - windowMs * 4);
    void db.delete(tikisseRateLimits).where(and(like(tikisseRateLimits.rateLimitKey, `${scope}:%`), lt(tikisseRateLimits.updatedAt, staleBefore))).catch(() => {});
  }
  return (row?.count ?? 0) <= maxRequests;
}

export const PHONE_ATTEMPT_WINDOW_MS = 10 * 60_000;
export const PHONE_ATTEMPT_MAX = 5;
export const PHONE_ATTEMPT_BLOCK_MINUTES = 30;

/**
 * Tentatives d'authentification par numéro : au-delà de 5 en 10 minutes, le numéro est bloqué 30 minutes
 * pour cette action. En base, partagé entre les instances et levable depuis la console (`clearRateLimitsForPhone`)
 * — gardé en mémoire de processus, il ne protégeait qu'une instance et restait hors de portée du support.
 * Le blocage est une ligne `phone-block:<action>:<numéro>` dont `count` porte la minute de fin (epoch).
 */
export async function checkPhoneAttemptLimit(scope: string, phone: string): Promise<{ allowed: true } | { allowed: false; retryInMinutes: number }> {
  const db = await getDb();
  if (!db) return { allowed: true };
  const nowMinute = Math.floor(Date.now() / 60_000);
  const blockKey = `phone-block:${scope}:${phone}`.slice(0, 191);
  const block = (await db.select({ until: tikisseRateLimits.count }).from(tikisseRateLimits).where(eq(tikisseRateLimits.rateLimitKey, blockKey)).limit(1))[0];
  if (block && block.until > nowMinute) return { allowed: false, retryInMinutes: block.until - nowMinute };
  if (Math.random() < 0.01) void db.delete(tikisseRateLimits).where(and(like(tikisseRateLimits.rateLimitKey, "phone-block:%"), lt(tikisseRateLimits.count, nowMinute))).catch(() => {});
  if (await checkDistributedRateLimit(`phone:${scope}`, phone, PHONE_ATTEMPT_WINDOW_MS, PHONE_ATTEMPT_MAX)) return { allowed: true };
  const until = nowMinute + PHONE_ATTEMPT_BLOCK_MINUTES;
  await db.insert(tikisseRateLimits).values({ rateLimitKey: blockKey, count: until }).onDuplicateKeyUpdate({ set: { count: until } });
  return { allowed: false, retryInMinutes: PHONE_ATTEMPT_BLOCK_MINUTES };
}

export async function applyForTikisseDelivery(input: { id: string; deliveryId: string; driverPhone: string; confirmedCommission: number; offerPrice?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Les candidatures sont temporairement indisponibles.");
  await enforceDriverApplicationRateLimit(input.driverPhone, db);
  const wallet = await db.transaction(async (tx) => {
    const deliveries = await tx.select().from(tikisseDeliveries).where(and(eq(tikisseDeliveries.id, input.deliveryId), eq(tikisseDeliveries.status, "open"))).limit(1).for("update");
    const delivery = deliveries[0];
    if (!delivery) throw new Error("Cette livraison n’accepte plus de candidatures.");
    if (delivery.senderPhone === input.driverPhone) throw new Error("Vous ne pouvez pas candidater à votre propre livraison.");
    await tx.insert(tikissePlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
    const rateRows = await tx.select().from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1);
    const rate = Number(rateRows[0]?.commissionRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) throw new Error("Le taux de commission configuré est invalide.");
    const price = input.offerPrice ?? delivery.offeredPrice ?? delivery.estimatedPrice;
    const commission = Math.round(price * rate);
    // Le montant affiché dans le popup de confirmation côté client doit correspondre exactement à ce qui sera
    // réellement bloqué : si le taux de commission a changé entre l'affichage et l'envoi, on rejette plutôt que
    // de bloquer silencieusement un montant différent de celui que le livreur a confirmé.
    if (input.confirmedCommission !== commission) {
      throw new Error("Le montant de la commission a changé entre-temps. Veuillez recharger et confirmer à nouveau.");
    }
    const walletBefore = await ensureTikisseWallet(tx, input.driverPhone);
    const existingBlocked = (await tx.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.deliveryId, input.deliveryId), eq(tikisseDeliveryCandidates.driverPhone, input.driverPhone), eq(tikisseDeliveryCandidates.status, "applied"))).limit(1))[0]?.commissionBlocked ?? 0;
    // Solde qui serait réellement disponible pour cette candidature : le disponible actuel + ce qui est déjà bloqué pour cette même candidature (remplacée, pas cumulée).
    if (walletBefore.availableBalance + existingBlocked < commission) {
      throw new Error("Vous n’avez pas assez de crédit pour proposer ce montant. Veuillez saisir un montant inférieur.");
    }
    const candidates = await tx.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.deliveryId, input.deliveryId), eq(tikisseDeliveryCandidates.driverPhone, input.driverPhone))).limit(1).for("update");
    const existing = candidates[0];
    if (existing && (existing.status === "selected" || existing.status === "confirmed")) throw new Error("Cette candidature ne peut plus être modifiée.");
    const candidateId = existing?.id ?? input.id;
    const previousCommission = existing?.status === "applied" ? existing.commissionBlocked : 0;
    const delta = commission - previousCommission;
    const movementVersion = candidateMovementVersion(existing);
    if (delta > 0) await applyWalletMovement(tx, { profilePhone: input.driverPhone, deliveryId: input.deliveryId, operation: "block", amount: delta, availableDelta: -delta, heldDelta: delta, reason: "Commission temporairement bloquée pour candidature", idempotencyKey: `${candidateId}:block:${movementVersion}:${commission}` });
    if (delta < 0) await applyWalletMovement(tx, { profilePhone: input.driverPhone, deliveryId: input.deliveryId, operation: "unblock", amount: -delta, availableDelta: -delta, heldDelta: delta, reason: "Ajustement de la commission bloquée", idempotencyKey: `${candidateId}:unblock:${movementVersion}:${commission}` });
    if (existing) await tx.update(tikisseDeliveryCandidates).set({ status: "applied", offerPrice: input.offerPrice ?? null, commissionBlocked: commission, updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, existing.id));
    else await tx.insert(tikisseDeliveryCandidates).values({ id: candidateId, deliveryId: input.deliveryId, driverPhone: input.driverPhone, offerPrice: input.offerPrice ?? null, commissionBlocked: commission, status: "applied" });
    // Une offre modifiée n'est pas une nouvelle candidature : l'expéditeur n'en est pas prévenu.
    if (existing?.status !== "applied") await notifySenderOfApplications(tx, { deliveryId: input.deliveryId, senderPhone: delivery.senderPhone, driverPhone: input.driverPhone });
    await appendDeliveryEvent(tx, { deliveryId: input.deliveryId, eventType: "candidate_applied", status: "open", actorPhone: input.driverPhone, recipientPhone: input.driverPhone, title: "Candidature envoyée", body: `La commission de ${commission} FCFA est temporairement bloquée.`, tone: "warning", idempotencyKey: `${candidateId}:driver-applied`, push: false });
    return walletSnapshotFromRecord(await ensureTikisseWallet(tx, input.driverPhone));
  });
  return { success: true, wallet } as const;
}

async function releaseCandidateCommission(tx: any, candidate: { id: string; deliveryId: string; driverPhone: string; commissionBlocked: number }, reason: string, suffix: string) {
  if (candidate.commissionBlocked <= 0) return;
  await applyWalletMovement(tx, { profilePhone: candidate.driverPhone, deliveryId: candidate.deliveryId, operation: "unblock", amount: candidate.commissionBlocked, availableDelta: candidate.commissionBlocked, heldDelta: -candidate.commissionBlocked, reason, idempotencyKey: `${candidate.id}:${suffix}` });
}

type SenderDeliveryUpdate = {
  deliveryId: string;
  senderPhone: string;
  pickupPlaceId: number;
  dropoffPlaceId: number;
  title: string;
  details: string;
  deliveryType: "Plis" | "Personne" | "Autre";
  distanceKm: string;
  routeSource: "routes" | "provisional";
  estimatedPrice: number;
  offeredPrice: number | null;
  vehicleTypes: string;
  weightKg: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  passengers: number | null;
};

async function releaseAppliedCandidatesForSenderAction(
  tx: any,
  delivery: TikisseDelivery,
  action: "updated" | "disabled" | "cancelled",
  changedSummary?: string,
) {
  const candidates = await tx
    .select()
    .from(tikisseDeliveryCandidates)
    .where(and(eq(tikisseDeliveryCandidates.deliveryId, delivery.id), eq(tikisseDeliveryCandidates.status, "applied")))
    .for("update");

  const messages = {
    updated: {
      title: "Livraison mise à jour",
      body: `Les éléments mis à jour sont : ${changedSummary ?? "les informations de la course"}. Votre candidature est annulée et votre commission est libérée.`,
      reason: "Commission débloquée après modification de la livraison",
    },
    disabled: {
      title: "Livraison désactivée",
      body: "Cette livraison est temporairement indisponible. Votre candidature est annulée et votre commission est libérée.",
      reason: "Commission débloquée après désactivation de la livraison",
    },
    cancelled: {
      title: "Livraison annulée",
      body: "Cette livraison a été annulée. Votre candidature est annulée et votre commission est libérée.",
      reason: "Commission débloquée après annulation de la livraison",
    },
  } as const;
  const message = messages[action];
  for (const candidate of candidates) {
    await releaseCandidateCommission(tx, candidate, message.reason, `${action}:release:${candidate.updatedAt.getTime()}`);
    await tx.update(tikisseDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, candidate.id));
    await appendDeliveryEvent(tx, {
      deliveryId: delivery.id,
      eventType: `delivery_${action}`,
      status: action === "disabled" ? "disabled" : action === "cancelled" ? "cancelled" : "open",
      actorPhone: delivery.senderPhone,
      recipientPhone: candidate.driverPhone,
      title: message.title,
      body: message.body,
      tone: action === "updated" ? "info" : "warning",
      idempotencyKey: `${candidate.id}:${action}:driver`,
    });
  }
}

export async function updateTikisseDeliveryFromSender(input: SenderDeliveryUpdate) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisseDeliveries).where(and(eq(tikisseDeliveries.id, input.deliveryId), eq(tikisseDeliveries.senderPhone, input.senderPhone))).limit(1).for("update"))[0];
    if (!delivery || !["open", "disabled"].includes(delivery.status)) throw new Error("Cette livraison ne peut plus être modifiée.");
    const changedFields = [
      delivery.title !== input.title || delivery.details !== input.details ? "le contenu" : null,
      delivery.pickupPlaceId !== input.pickupPlaceId || delivery.dropoffPlaceId !== input.dropoffPlaceId ? "le trajet" : null,
      delivery.deliveryType !== input.deliveryType || delivery.weightKg !== input.weightKg || delivery.lengthCm !== input.lengthCm || delivery.widthCm !== input.widthCm || delivery.heightCm !== input.heightCm || delivery.passengers !== input.passengers ? "les caractéristiques" : null,
      delivery.distanceKm !== input.distanceKm || delivery.routeSource !== input.routeSource ? "la distance" : null,
      delivery.estimatedPrice !== input.estimatedPrice || delivery.offeredPrice !== input.offeredPrice ? "les frais" : null,
      delivery.vehicleTypes !== input.vehicleTypes ? "l’engin demandé" : null,
    ].filter((value): value is string => Boolean(value));
    await releaseAppliedCandidatesForSenderAction(tx, delivery, "updated", changedFields.join(", ") || "les informations de la course");
    await tx.update(tikisseDeliveries).set({
      pickupPlaceId: input.pickupPlaceId,
      dropoffPlaceId: input.dropoffPlaceId,
      title: input.title,
      details: input.details,
      deliveryType: input.deliveryType,
      distanceKm: input.distanceKm,
      routeSource: input.routeSource,
      estimatedPrice: input.estimatedPrice,
      offeredPrice: input.offeredPrice,
      vehicleTypes: input.vehicleTypes,
      weightKg: input.weightKg,
      lengthCm: input.lengthCm,
      widthCm: input.widthCm,
      heightCm: input.heightCm,
      passengers: input.passengers,
      status: "open",
      updatedAt: new Date(),
    }).where(eq(tikisseDeliveries.id, input.deliveryId));
    await appendDeliveryEvent(tx, {
      deliveryId: input.deliveryId,
      eventType: "delivery_updated",
      status: "open",
      actorPhone: input.senderPhone,
      recipientPhone: input.senderPhone,
      title: "Livraison mise à jour",
      body: "Les informations de votre livraison ont été actualisées et elle est de nouveau disponible.",
      tone: "success",
      feed: false,
      idempotencyKey: `${input.deliveryId}:updated:${delivery.updatedAt.getTime()}`,
    });
  });
  return getTikisseDeliveryById(input.deliveryId);
}

export async function disableTikisseDeliveryFromSender(deliveryId: string, senderPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisseDeliveries).where(and(eq(tikisseDeliveries.id, deliveryId), eq(tikisseDeliveries.senderPhone, senderPhone))).limit(1).for("update"))[0];
    if (!delivery || delivery.status !== "open") throw new Error("Seule une livraison disponible peut être désactivée.");
    await releaseAppliedCandidatesForSenderAction(tx, delivery, "disabled");
    await tx.update(tikisseDeliveries).set({ status: "disabled", updatedAt: new Date() }).where(eq(tikisseDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_disabled", status: "disabled", actorPhone: senderPhone, recipientPhone: senderPhone, title: "Livraison désactivée", body: "Votre livraison n’est plus visible aux nouveaux livreurs.", tone: "warning", idempotencyKey: `${deliveryId}:disabled:${delivery.updatedAt.getTime()}`, feed: false });
  });
  return getTikisseDeliveryById(deliveryId);
}

export async function reactivateTikisseDeliveryFromSender(deliveryId: string, senderPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisseDeliveries).where(and(eq(tikisseDeliveries.id, deliveryId), eq(tikisseDeliveries.senderPhone, senderPhone))).limit(1).for("update"))[0];
    if (!delivery || delivery.status !== "disabled") throw new Error("Seule une livraison désactivée peut être activée.");
    await tx.update(tikisseDeliveries).set({ status: "open", updatedAt: new Date() }).where(eq(tikisseDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_reactivated", status: "open", actorPhone: senderPhone, recipientPhone: senderPhone, title: "Livraison activée", body: "Votre livraison est à nouveau visible pour les livreurs compatibles.", tone: "success", idempotencyKey: `${deliveryId}:reactivated:${delivery.updatedAt.getTime()}`, feed: false });
    await notifyCompatibleDriversOfDelivery(tx, { id: deliveryId, title: delivery.title, vehicleTypes: delivery.vehicleTypes, pickupPlaceId: delivery.pickupPlaceId }, "delivery_reactivated_for_drivers", "Une livraison compatible avec votre engin est de nouveau disponible");
  });
  return getTikisseDeliveryById(deliveryId);
}

export async function cancelTikisseDeliveryFromSender(deliveryId: string, senderPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisseDeliveries).where(and(eq(tikisseDeliveries.id, deliveryId), eq(tikisseDeliveries.senderPhone, senderPhone))).limit(1).for("update"))[0];
    // Un livreur "selected"/"confirmed" implique toujours le statut "pending_confirmation" ou "active" —
    // jamais "open"/"disabled" — donc cette garde suffit à elle seule à exclure tout candidat déjà engagé
    // (aucun autre cas à traiter ici : `releaseAppliedCandidatesForSenderAction` couvre les candidats "applied").
    if (!delivery || !["open", "disabled"].includes(delivery.status)) throw new Error("Cette livraison ne peut plus être annulée : un livreur a déjà été sélectionné.");
    await releaseAppliedCandidatesForSenderAction(tx, delivery, "cancelled");
    await tx.update(tikisseDeliveries).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(tikisseDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_cancelled", status: "cancelled", actorPhone: senderPhone, recipientPhone: senderPhone, title: "Livraison annulée", body: "Votre livraison est conservée dans l’historique avec son statut d’annulation.", tone: "warning", idempotencyKey: `${deliveryId}:cancelled:sender`, feed: false });
  });
  return getTikisseDeliveryById(deliveryId);
}

/**
 * Retire toutes les candidatures encore ouvertes d'un livreur que l'administration suspend ou bannit, et lui
 * rend la commission réservée pour chacune. Sans ça, ses candidatures restaient proposées aux expéditeurs —
 * qui pouvaient choisir un livreur qui ne peut plus se connecter — et sa réserve restait bloquée.
 * Seules les candidatures « applied » sont concernées : une course déjà attribuée engage aussi l'expéditeur,
 * c'est à l'admin d'en décider (annulation forcée), elle est seulement renvoyée dans `engagements`.
 */
export async function withdrawCandidaciesOfSuspendedDriver(tx: any, driverPhone: string) {
  const candidates = await tx.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.driverPhone, driverPhone), eq(tikisseDeliveryCandidates.status, "applied"))).for("update");
  for (const candidate of candidates) {
    const delivery = (await tx.select().from(tikisseDeliveries).where(eq(tikisseDeliveries.id, candidate.deliveryId)).limit(1))[0];
    // La version de la candidature (updatedAt) fait partie des clés : une candidature reposée après une
    // réactivation, puis suspendue de nouveau, doit être libérée une seconde fois, pas reconnue comme déjà faite.
    const version = candidate.updatedAt.getTime();
    await releaseCandidateCommission(tx, candidate, "Commission libérée : compte suspendu par l’administration", `admin-suspend:release:${version}`);
    await tx.update(tikisseDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, candidate.id));
    await appendDeliveryEvent(tx, { deliveryId: candidate.deliveryId, eventType: "candidate_withdrawn", status: delivery?.status ?? "open", recipientPhone: driverPhone, title: "Candidature retirée", body: "Votre compte a été suspendu : cette candidature est retirée et sa commission libérée.", tone: "warning", idempotencyKey: `${candidate.id}:admin-suspend-driver:${version}` });
    if (delivery) await appendDeliveryEvent(tx, { deliveryId: candidate.deliveryId, eventType: "candidate_withdrawn", status: delivery.status, recipientPhone: delivery.senderPhone, title: "Candidature retirée", body: "Un livreur n’est plus disponible pour votre livraison.", tone: "info", idempotencyKey: `${candidate.id}:admin-suspend-sender:${version}` });
  }
  return candidates.length as number;
}

/**
 * Candidatures reçues, côté expéditeur : une seule notification par livraison. La première candidature
 * est poussée ; les suivantes mettent à jour la même ligne (« 3 livreurs se sont proposés »), remise en
 * tête et non lue, sans refaire sonner le téléphone — dix candidatures faisaient dix push.
 */
async function notifySenderOfApplications(tx: any, input: { deliveryId: string; senderPhone: string; driverPhone: string }) {
  const key = `${input.deliveryId}:applications`;
  const applied = Number((await tx.select({ count: count() }).from(tikisseDeliveryCandidates)
    .where(and(eq(tikisseDeliveryCandidates.deliveryId, input.deliveryId), eq(tikisseDeliveryCandidates.status, "applied"))))[0]?.count ?? 1);
  const existing = (await tx.select({ id: tikisseDeliveryEvents.id }).from(tikisseDeliveryEvents).where(eq(tikisseDeliveryEvents.idempotencyKey, key)).limit(1))[0];
  const single = "Un livreur compatible s’est proposé pour votre livraison.";
  if (!existing) {
    await appendDeliveryEvent(tx, { deliveryId: input.deliveryId, eventType: "candidate_applied", status: "open", actorPhone: input.driverPhone, recipientPhone: input.senderPhone, title: "Nouvelle candidature", body: single, tone: "info", idempotencyKey: key });
    return;
  }
  await tx.update(tikisseDeliveryEvents).set({
    title: applied > 1 ? "Nouvelles candidatures" : "Nouvelle candidature",
    body: applied > 1 ? `${applied} livreurs se sont proposés pour votre livraison.` : single,
    actorPhone: input.driverPhone, readAt: null, createdAt: new Date(),
  }).where(eq(tikisseDeliveryEvents.id, existing.id));
}

export async function withdrawTikisseDeliveryCandidateWithWallet(deliveryId: string, driverPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les candidatures sont temporairement indisponibles.");
  const wallet = await db.transaction(async (tx) => {
    const candidates = await tx.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.deliveryId, deliveryId), eq(tikisseDeliveryCandidates.driverPhone, driverPhone), eq(tikisseDeliveryCandidates.status, "applied"))).limit(1).for("update");
    const candidate = candidates[0];
    if (!candidate) throw new Error("Cette candidature ne peut plus être retirée.");
    const delivery = (await tx.select().from(tikisseDeliveries).where(eq(tikisseDeliveries.id, deliveryId)).limit(1))[0];
    if (!delivery) throw new Error("Livraison introuvable.");
    await releaseCandidateCommission(tx, candidate, "Commission débloquée après retrait de candidature", `withdraw:${candidate.updatedAt.getTime()}`);
    await tx.update(tikisseDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, candidate.id));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "candidate_withdrawn", status: "open", actorPhone: driverPhone, recipientPhone: driverPhone, title: "Candidature retirée", body: "Votre commission bloquée a été immédiatement libérée.", tone: "success", idempotencyKey: `${candidate.id}:withdraw-driver`, push: false });
    await appendDeliveryEvent(tx, { deliveryId, eventType: "candidate_withdrawn", status: "open", actorPhone: driverPhone, recipientPhone: delivery.senderPhone, title: "Candidature retirée", body: "Un livreur a retiré sa candidature.", tone: "info", idempotencyKey: `${candidate.id}:withdraw-sender`, feed: false });
    return walletSnapshotFromRecord(await ensureTikisseWallet(tx, driverPhone));
  });
  return { success: true, wallet } as const;
}

export async function selectTikisseDeliveryCandidateWithWallet(deliveryId: string, candidateId: string, senderPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisseDeliveries).where(and(eq(tikisseDeliveries.id, deliveryId), eq(tikisseDeliveries.senderPhone, senderPhone))).limit(1).for("update"))[0];
    if (!delivery || !["open", "active", "pending_confirmation"].includes(delivery.status)) throw new Error("Cette livraison ne peut pas recevoir de sélection.");
    const chosen = (await tx.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.id, candidateId), eq(tikisseDeliveryCandidates.deliveryId, deliveryId), eq(tikisseDeliveryCandidates.status, "applied"))).limit(1).for("update"))[0];
    if (!chosen) throw new Error("Cette candidature n’est plus sélectionnable.");
    const priorDriverPhone = delivery.driverPhone;
    const targetCommission = chosen.commissionBlocked;
    const appliedCandidates = await tx.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.deliveryId, deliveryId), eq(tikisseDeliveryCandidates.status, "applied"))).for("update");
    for (const candidate of appliedCandidates) if (candidate.id !== chosen.id) {
      await releaseCandidateCommission(tx, candidate, "Commission débloquée après sélection d’un autre livreur", `release:${chosen.id}:${candidate.updatedAt.getTime()}`);
      await appendDeliveryEvent(tx, { deliveryId, eventType: "candidate_not_selected", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: candidate.driverPhone, title: "Livreur non retenu", body: "Un autre livreur a été sélectionné ; votre commission bloquée a été libérée.", tone: "info", idempotencyKey: `${candidate.id}:not-selected:${chosen.id}` });
    }
    if (priorDriverPhone) {
      // Source de vérité = le statut réel du candidat précédent, pas `delivery.accruedCommission` (renseigné dès la
      // simple sélection, avant toute confirmation). Un candidat "selected" n'a jamais été débité : sa commission est
      // encore intégralement dans `heldBalance`. Le confondre avec un candidat "confirmed" (réellement débité) crée
      // un double crédit (l'ancien montant réservé n'est jamais retiré du held, mais une "compensation" est quand
      // même ajoutée au disponible) et laisse deux candidats actifs simultanément sur la même livraison.
      const priorCandidate = (await tx.select().from(tikisseDeliveryCandidates)
        .where(and(eq(tikisseDeliveryCandidates.deliveryId, deliveryId), eq(tikisseDeliveryCandidates.driverPhone, priorDriverPhone), inArray(tikisseDeliveryCandidates.status, ["selected", "confirmed"])))
        .limit(1)
        .for("update"))[0];
      // La décision (déblocage simple vs compensation réelle, plafonnée par construction — voir
      // `computeReplacementSettlement`) est centralisée dans `shared/wallet-commission.ts` et testée
      // indépendamment (`tests/replacement-settlement.test.ts`), pour que le code réel ne puisse pas
      // diverger silencieusement de la logique vérifiée par les tests.
      const settlement = computeReplacementSettlement(
        priorCandidate ? { status: priorCandidate.status as "selected" | "confirmed", commissionBlocked: priorCandidate.commissionBlocked } : null,
        targetCommission,
      );
      if (settlement.kind === "compensate" && priorCandidate) {
        await applyWalletMovement(tx, { profilePhone: priorDriverPhone, deliveryId, operation: "compensation", amount: settlement.amountOwedToPriorDriver, availableDelta: settlement.amountOwedToPriorDriver, heldDelta: 0, reason: settlement.platformTopUp > 0 ? "Remboursement de commission après remplacement (complété par la plateforme)" : "Remboursement de commission après remplacement", idempotencyKey: `${deliveryId}:compensate:${priorDriverPhone}:${chosen.id}` });
        if (settlement.platformTopUp > 0) {
          // La nouvelle commission ne suffisait pas à couvrir l'ancienne : traçé explicitement pour la comptabilité plateforme.
          await appendDeliveryEvent(tx, { deliveryId, eventType: "platform_topup", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: senderPhone, title: "Complément plateforme", body: `La plateforme a complété ${settlement.platformTopUp} FCFA pour rembourser intégralement l’ancien livreur (nouvelle commission insuffisante).`, tone: "info", idempotencyKey: `${deliveryId}:platform-topup:${priorDriverPhone}:${chosen.id}`, feed: false });
        } else if (settlement.platformSurplus > 0) {
          // La nouvelle commission dépasse ce qui était dû à l'ancien livreur : le surplus reste acquis à la plateforme (aucune double perception, mais aucune sur-compensation du livreur remplacé non plus).
          await appendDeliveryEvent(tx, { deliveryId, eventType: "platform_surplus", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: senderPhone, title: "Surplus de commission conservé", body: `${settlement.platformSurplus} FCFA de la nouvelle commission dépassent le remboursement dû à l’ancien livreur et restent acquis à la plateforme.`, tone: "info", idempotencyKey: `${deliveryId}:platform-surplus:${priorDriverPhone}:${chosen.id}`, feed: false });
        }
        await tx.update(tikisseDeliveryCandidates).set({ status: "replaced", updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, priorCandidate.id));
        await appendDeliveryEvent(tx, { deliveryId, eventType: "driver_replaced", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: priorDriverPhone, title: "Vous avez été remplacé", body: "Votre commission Tikisse a été intégralement compensée.", tone: "warning", idempotencyKey: `${deliveryId}:replaced:${priorDriverPhone}:${chosen.id}` });
      } else if (settlement.kind === "release" && priorCandidate) {
        // Statut "selected" : jamais confirmé, jamais débité. Un simple déblocage suffit, aucune compensation ni
        // complément plateforme n'a de sens puisqu'aucun montant réel n'a quitté le Wallet de ce candidat.
        await releaseCandidateCommission(tx, priorCandidate, "Commission libérée : remplacé avant confirmation de disponibilité", `replaced-before-confirm:${chosen.id}`);
        await tx.update(tikisseDeliveryCandidates).set({ status: "replaced", updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, priorCandidate.id));
        await appendDeliveryEvent(tx, { deliveryId, eventType: "driver_replaced", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: priorDriverPhone, title: "Vous avez été remplacé", body: "Vous n’aviez pas encore confirmé votre disponibilité : votre commission bloquée a été intégralement libérée, sans pénalité.", tone: "info", idempotencyKey: `${deliveryId}:replaced-unconfirmed:${priorDriverPhone}:${chosen.id}` });
      }
    }
    await tx.update(tikisseDeliveryCandidates).set({ status: "selected", commissionBlocked: targetCommission, updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, chosen.id));
    await tx.update(tikisseDeliveries).set({ status: "pending_confirmation", driverPhone: chosen.driverPhone, ...(priorDriverPhone ? { previousDriverPhone: priorDriverPhone } : {}), ...(chosen.offerPrice ? { offeredPrice: chosen.offerPrice } : {}), accruedCommission: targetCommission, selectedAt: new Date(), updatedAt: new Date() }).where(eq(tikisseDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: priorDriverPhone ? "driver_replaced" : "driver_selected", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: senderPhone, title: priorDriverPhone ? "Livreur remplacé" : "Livreur sélectionné", body: "Aucun montant n’est demandé au Wallet de l’expéditeur. Le livreur doit confirmer sa disponibilité.", tone: "success", idempotencyKey: `${deliveryId}:sender-selected:${chosen.id}`, feed: false });
    await appendDeliveryEvent(tx, { deliveryId, eventType: priorDriverPhone ? "driver_replaced" : "driver_selected", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: chosen.driverPhone, title: priorDriverPhone ? "Vous êtes le nouveau livreur" : "Vous avez été sélectionné", body: "Votre commission reste réservée et sera prélevée lorsque vous confirmerez votre disponibilité.", tone: "success", idempotencyKey: `${deliveryId}:driver-selected:${chosen.id}` });
  });
  return getTikisseDeliveryById(deliveryId);
}

/** Le Sender annule son choix avant que le livreur ait confirmé sa disponibilité : retour à "sans livreur",
 *  sans aucune incidence financière (la commission n'a jamais été débitée, elle est simplement libérée).
 *  Différent d'un remplacement (aucun autre candidat n'est sélectionné à la place) et différent d'une annulation
 *  de la livraison entière (les autres candidatures "applied" restent intactes, la livraison redevient "open"). */
export async function unselectTikisseDeliveryCandidateFromSender(deliveryId: string, senderPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisseDeliveries).where(and(eq(tikisseDeliveries.id, deliveryId), eq(tikisseDeliveries.senderPhone, senderPhone))).limit(1).for("update"))[0];
    if (!delivery || delivery.status !== "pending_confirmation" || !delivery.driverPhone) throw new Error("Cette livraison n’a pas de choix de livreur à annuler.");
    const candidate = (await tx.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.deliveryId, deliveryId), eq(tikisseDeliveryCandidates.driverPhone, delivery.driverPhone), eq(tikisseDeliveryCandidates.status, "selected"))).limit(1).for("update"))[0];
    if (!candidate) throw new Error("Ce choix ne peut plus être annulé.");
    await releaseCandidateCommission(tx, candidate, "Commission libérée : choix du livreur annulé avant confirmation", `unselected:${candidate.updatedAt.getTime()}`);
    await tx.update(tikisseDeliveryCandidates).set({ status: "applied", updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, candidate.id));
    await tx.update(tikisseDeliveries).set({ status: "open", driverPhone: null, accruedCommission: null, selectedAt: null, updatedAt: new Date() }).where(eq(tikisseDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "driver_unselected", status: "open", actorPhone: senderPhone, recipientPhone: senderPhone, title: "Choix annulé", body: "Vous avez annulé votre choix, sans frais. La livraison est de nouveau ouverte aux candidatures.", tone: "info", idempotencyKey: `${deliveryId}:unselected:sender:${candidate.id}`, feed: false });
    await appendDeliveryEvent(tx, { deliveryId, eventType: "driver_unselected", status: "open", actorPhone: senderPhone, recipientPhone: candidate.driverPhone, title: "Vous n’êtes plus sélectionné", body: "L’expéditeur a annulé son choix avant votre confirmation. Votre commission bloquée a été libérée, sans pénalité. Votre candidature reste active.", tone: "info", idempotencyKey: `${deliveryId}:unselected:driver:${candidate.id}` });
  });
  return getTikisseDeliveryById(deliveryId);
}

/** Commission réellement prélevée à ce livreur pour cette livraison, moins ce qui lui a déjà été rendu. */
export async function netCommissionPaid(tx: any, deliveryId: string, driverPhone: string) {
  const rows = await tx.select({ operation: tikisseWalletLedger.operation, amount: tikisseWalletLedger.amount }).from(tikisseWalletLedger)
    .where(and(eq(tikisseWalletLedger.deliveryId, deliveryId), eq(tikisseWalletLedger.profilePhone, driverPhone), inArray(tikisseWalletLedger.operation, ["commission_debit", "compensation"]))).for("update");
  return rows.reduce((total: number, row: { operation: string; amount: number }) => total + (row.operation === "commission_debit" ? Number(row.amount) : -Number(row.amount)), 0);
}

/**
 * Litige : l'administration retire le livreur d'une livraison attribuée ou en cours, qui redevient ouverte
 * pour que l'expéditeur en choisisse un autre parmi les candidats. Le livreur retiré retrouve sa commission :
 * débloquée s'il n'avait pas encore confirmé, remboursée s'il l'avait déjà payée.
 */
export async function adminRemoveDriverFromDelivery(input: { deliveryId: string; reason: string }) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  const outcome = await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisseDeliveries).where(eq(tikisseDeliveries.id, input.deliveryId)).limit(1).for("update"))[0];
    if (!delivery || !delivery.driverPhone || (delivery.status !== "pending_confirmation" && delivery.status !== "active")) {
      throw new Error("Seule une livraison attribuée ou en cours a un livreur à retirer.");
    }
    const driverPhone = delivery.driverPhone;
    const candidate = (await tx.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.deliveryId, input.deliveryId), eq(tikisseDeliveryCandidates.driverPhone, driverPhone), inArray(tikisseDeliveryCandidates.status, ["selected", "confirmed"]))).limit(1).for("update"))[0];
    let released = 0;
    let refunded = 0;
    if (candidate?.status === "selected") {
      released = candidate.commissionBlocked;
      await releaseCandidateCommission(tx, candidate, "Commission libérée : retiré de la livraison par l’administration", `admin-removed:${candidate.updatedAt.getTime()}`);
    } else {
      refunded = await netCommissionPaid(tx, input.deliveryId, driverPhone);
      if (refunded > 0) {
        await applyWalletMovement(tx, { profilePhone: driverPhone, deliveryId: input.deliveryId, operation: "compensation", amount: refunded, availableDelta: refunded, heldDelta: 0, reason: "Commission remboursée : retiré de la livraison par l’administration", idempotencyKey: `admin-removed-refund:${candidate?.id ?? driverPhone}:${candidate?.updatedAt.getTime() ?? 0}` });
      }
    }
    if (candidate) await tx.update(tikisseDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, candidate.id));
    await tx.update(tikisseDeliveries).set({ status: "open", driverPhone: null, previousDriverPhone: driverPhone, accruedCommission: null, selectedAt: null, confirmedAt: null, updatedAt: new Date() }).where(eq(tikisseDeliveries.id, input.deliveryId));
    const stamp = Date.now();
    const money = released > 0 ? ` Votre commission de ${released} FCFA a été débloquée.` : refunded > 0 ? ` Votre commission de ${refunded} FCFA vous a été remboursée.` : "";
    await appendDeliveryEvent(tx, { deliveryId: input.deliveryId, eventType: "admin_driver_removed", status: "open", recipientPhone: driverPhone, title: "Retiré de la livraison", body: `L’équipe Tikisse vous a retiré de cette livraison : ${input.reason}.${money}`, tone: "warning", idempotencyKey: `${input.deliveryId}:admin-removed-driver:${stamp}` });
    await appendDeliveryEvent(tx, { deliveryId: input.deliveryId, eventType: "admin_driver_removed", status: "open", recipientPhone: delivery.senderPhone, title: "Choisissez un autre livreur", body: `L’équipe Tikisse a retiré le livreur de votre livraison : ${input.reason}. Elle est de nouveau ouverte aux candidatures.`, tone: "warning", idempotencyKey: `${input.deliveryId}:admin-removed-sender:${stamp}` });
    return { driverPhone, released, refunded };
  });
  return outcome;
}

export async function confirmTikisseDeliveryWithEvents(deliveryId: string, driverPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  const wallet = await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisseDeliveries).where(and(eq(tikisseDeliveries.id, deliveryId), eq(tikisseDeliveries.driverPhone, driverPhone), eq(tikisseDeliveries.status, "pending_confirmation"))).limit(1).for("update"))[0];
    if (!delivery) throw new Error("Cette livraison ne peut pas être confirmée.");
    const candidate = (await tx.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.deliveryId, deliveryId), eq(tikisseDeliveryCandidates.driverPhone, driverPhone), eq(tikisseDeliveryCandidates.status, "selected"))).limit(1).for("update"))[0];
    if (!candidate) throw new Error("Votre candidature ne peut pas être confirmée.");
    const commission = delivery.accruedCommission ?? candidate.commissionBlocked;
    if (commission > 0) {
      const wallet = await ensureTikisseWallet(tx, driverPhone);
      const usesReservation = wallet.heldBalance >= commission;
      await applyWalletMovement(tx, {
        profilePhone: driverPhone,
        deliveryId,
        // Type dédié, distinct du "debit" générique utilisé pour les retraits : permet au KPI de revenu
        // administrateur (commissionRevenue) et à l'affichage Wallet de ne compter que le vrai revenu Tikisse.
        operation: "commission_debit",
        amount: commission,
        availableDelta: usesReservation ? 0 : -commission,
        heldDelta: usesReservation ? -commission : 0,
        reason: "Commission Tikisse prélevée après confirmation de disponibilité",
        idempotencyKey: `${deliveryId}:${usesReservation ? "commission-debit" : "commission-direct-debit"}:${candidate.id}`,
      });
    }
    await tx.update(tikisseDeliveryCandidates).set({ status: "confirmed", updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, candidate.id));
    await tx.update(tikisseDeliveries).set({ status: "active", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(tikisseDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_active", status: "active", actorPhone: driverPhone, recipientPhone: driverPhone, title: "Livraison activée", body: "Votre disponibilité est confirmée. Le suivi de la livraison est actif.", tone: "success", idempotencyKey: `${deliveryId}:active-driver`, feed: false });
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_active", status: "active", actorPhone: driverPhone, recipientPhone: delivery.senderPhone, title: "Livreur en route", body: "Le livreur a confirmé sa disponibilité ; le suivi est maintenant actif.", tone: "success", idempotencyKey: `${deliveryId}:active-sender` });
    return walletSnapshotFromRecord(await ensureTikisseWallet(tx, driverPhone));
  });
  return { delivery: await getTikisseDeliveryById(deliveryId), wallet };
}

/** Crée un enregistrement de parrainage « invité » si un code de parrain valide est fourni à l'inscription. */
export async function createReferralIfCodeProvided(refereePhone: string, referredByCode?: string | null) {
  if (!referredByCode) return;
  const db = await getDb();
  if (!db) return;
  const referrer = await getTikisseProfileByReferralCode(referredByCode);
  if (!referrer || referrer.phone === refereePhone) return;
  await db.insert(tikissePlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const settings = (await db.select().from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1))[0];
  if (!settings?.referralEnabled) return;
  await db.insert(tikisseReferrals).values({
    id: randomUUID(), referrerPhone: referrer.phone, refereePhone, referralCode: referredByCode,
    status: "invited", rewardAmount: settings.referralRewardAmount,
  }).onDuplicateKeyUpdate({ set: { refereePhone } }); // no-op update: unique(refereePhone) makes this idempotent
}

/** Qualifie un parrainage « invité » dès que le filleul termine sa première livraison (comme Sender ou Livreur). */
async function qualifyReferralIfEligible(tx: any, phone: string | null, deliveryId: string) {
  if (!phone) return;
  const referral = (await tx.select().from(tikisseReferrals).where(and(eq(tikisseReferrals.refereePhone, phone), eq(tikisseReferrals.status, "invited"))).limit(1).for("update"))[0];
  if (!referral) return;
  const settings = (await tx.select().from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1))[0];
  const requiredDeliveries = settings?.referralRequiredDeliveries ?? 1;
  const totalCompleted = await tx.select({ count: sql<number>`count(*)` }).from(tikisseDeliveries).where(and(or(eq(tikisseDeliveries.senderPhone, phone), eq(tikisseDeliveries.driverPhone, phone)), eq(tikisseDeliveries.status, "completed")));
  if (Number(totalCompleted[0]?.count ?? 0) < requiredDeliveries) return; // seuil de courses terminées pas encore atteint
  await tx.update(tikisseReferrals).set({ status: "qualified", qualifiedAt: new Date(), qualifyingDeliveryId: deliveryId }).where(eq(tikisseReferrals.id, referral.id));
}

/**
 * Clôture d'une livraison active : par le Sender ou le livreur (`profilePhone`), ou par l'administration
 * (`admin`) quand la course a été faite mais que personne ne l'a marquée comme livrée. Mêmes effets dans
 * les deux cas (parrainage, fidélité) ; seuls l'auteur et les messages changent.
 */
export async function completeTikisseDeliveryWithEvents(deliveryId: string, profilePhone: string | null, admin?: { reason: string }) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  const completedDelivery = await db.transaction(async (tx) => {
    const byParticipant = profilePhone ? or(eq(tikisseDeliveries.senderPhone, profilePhone), eq(tikisseDeliveries.driverPhone, profilePhone)) : undefined;
    if (!byParticipant && !admin) throw new Error("Cette livraison ne peut pas être terminée.");
    const delivery = (await tx.select().from(tikisseDeliveries).where(and(eq(tikisseDeliveries.id, deliveryId), eq(tikisseDeliveries.status, "active"), byParticipant)).limit(1).for("update"))[0];
    if (!delivery || !delivery.driverPhone) throw new Error(admin ? "Seule une livraison en cours, livreur confirmé, peut être clôturée." : "Cette livraison ne peut pas être terminée.");
    // Le paiement de la course est effectué directement entre le Sender et le livreur, hors application (cf. spec
    // Partie 2 — introduction). Tikisse ne gère jamais ce paiement : aucun crédit n'est appliqué au Wallet du livreur
    // ici. Le Wallet ne sert qu'à réserver/débiter la commission Tikisse ; il n'est jamais crédité par une livraison.
    await tx.update(tikisseDeliveries).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(tikisseDeliveries.id, deliveryId));
    const adminNote = admin ? ` Clôturée par l’équipe Tikisse : ${admin.reason}` : "";
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_completed", status: "completed", actorPhone: profilePhone ?? undefined, recipientPhone: delivery.senderPhone, title: "Livraison terminée", body: `Votre livraison est terminée. Vous pouvez maintenant évaluer le livreur.${adminNote}`, tone: "success", idempotencyKey: `${deliveryId}:completed-sender`, feed: profilePhone !== delivery.senderPhone });
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_completed", status: "completed", actorPhone: profilePhone ?? undefined, recipientPhone: delivery.driverPhone, title: "Course terminée", body: `La course est ajoutée à votre historique.${adminNote}`, tone: "success", idempotencyKey: `${deliveryId}:completed-driver`, feed: profilePhone !== delivery.driverPhone });
    await qualifyReferralIfEligible(tx, delivery.driverPhone, deliveryId);
    await qualifyReferralIfEligible(tx, delivery.senderPhone, deliveryId);
    const wallet = walletSnapshotFromRecord(await ensureTikisseWallet(tx, delivery.driverPhone));
    return { delivery, wallet };
  });
  // Évaluation du programme de fidélité, hors transaction wallet.
  // Best-effort : si la fonction échoue, on log mais on ne fait pas échouer la complétion.
  try {
    const { evaluateAndNotifyLoyaltyGrants } = await import("./loyalty");
    if (completedDelivery.delivery.driverPhone) {
      await evaluateAndNotifyLoyaltyGrants({ deliveryId, driverPhone: completedDelivery.delivery.driverPhone, senderPhone: completedDelivery.delivery.senderPhone });
    }
  } catch (cause) {
    console.error("[loyalty] evaluateAndNotifyLoyaltyGrants failed", cause);
  }
  return { delivery: await getTikisseDeliveryById(deliveryId), wallet: completedDelivery.wallet };
}

export async function listTikisseDeliveryCandidates(deliveryId: string): Promise<DriverCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ candidate: tikisseDeliveryCandidates, profile: tikisseProfiles }).from(tikisseDeliveryCandidates).innerJoin(tikisseProfiles, eq(tikisseDeliveryCandidates.driverPhone, tikisseProfiles.phone)).where(eq(tikisseDeliveryCandidates.deliveryId, deliveryId)).orderBy(desc(tikisseDeliveryCandidates.createdAt));
  if (rows.length === 0) return [];
  const driverPhones = Array.from(new Set(rows.map((r) => r.candidate.driverPhone)));
  // Les avis masqués par la modération ne comptent plus dans la note (lot C, modération des avis).
  const reviewRows = await db.select({ driverPhone: tikisseDeliveryReviews.driverPhone, rating: tikisseDeliveryReviews.rating }).from(tikisseDeliveryReviews).where(and(inArray(tikisseDeliveryReviews.driverPhone, driverPhones), isNull(tikisseDeliveryReviews.hiddenAt)));
  const completedRows = await db.select({ driverPhone: tikisseDeliveries.driverPhone }).from(tikisseDeliveries).where(and(eq(tikisseDeliveries.status, "completed"), inArray(tikisseDeliveries.driverPhone, driverPhones)));
  const ratingByDriver = new Map<string, { sum: number; count: number }>();
  for (const r of reviewRows) {
    const cur = ratingByDriver.get(r.driverPhone) ?? { sum: 0, count: 0 };
    cur.sum += r.rating;
    cur.count += 1;
    ratingByDriver.set(r.driverPhone, cur);
  }
  const completedByDriver = new Map<string, number>();
  for (const c of completedRows) {
    if (!c.driverPhone) continue;
    completedByDriver.set(c.driverPhone, (completedByDriver.get(c.driverPhone) ?? 0) + 1);
  }
  // `kyc.submit` refuse une nouvelle soumission une fois `approved` obtenu (« Votre identité
  // est déjà vérifiée ») : un livreur ne peut jamais avoir à la fois un dossier approuvé et un
  // autre plus récent d'un statut différent. Un simple test d'existence suffit donc — pas besoin
  // de ne retenir que la soumission la plus récente par livreur.
  const approvedKycRows = await db.select({ driverPhone: tikisseKycSubmissions.driverPhone }).from(tikisseKycSubmissions).where(and(inArray(tikisseKycSubmissions.driverPhone, driverPhones), eq(tikisseKycSubmissions.status, "approved")));
  const approvedDrivers = new Set(approvedKycRows.map((r) => r.driverPhone));
  const distanceByDriver = await distancesFromPickup(db, deliveryId, driverPhones);
  return rows.map(({ candidate, profile }) => {
    const stats = ratingByDriver.get(candidate.driverPhone);
    const rating = stats && stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : 0;
    const completedDeliveries = completedByDriver.get(candidate.driverPhone) ?? 0;
    const isCertified = completedDeliveries >= 100 && rating >= 4.5;
    return {
      id: candidate.id,
      deliveryId: candidate.deliveryId,
      driverId: candidate.driverPhone,
      name: profile.fullName,
      initials: profile.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
      rating,
      completedDeliveries,
      vehicles: parseVehicles(profile.vehicles),
      ...(candidate.offerPrice ? { offerPrice: candidate.offerPrice } : {}),
      status: candidate.status,
      commissionBlocked: candidate.commissionBlocked,
      // `submitApplication` (server/routers.ts) exige déjà un KYC approuvé avant de candidater :
      // ce drapeau devrait donc toujours valoir `true` ici pour une candidature nouvellement créée.
      // Il reste calculé, et non supposé, pour rester vrai aussi pour les candidatures posées avant
      // ce contrôle, ou si une révision administrative révoque une approbation après coup.
      isVerified: approvedDrivers.has(candidate.driverPhone),
      isCertified,
      distanceFromPickupKm: distanceByDriver.get(candidate.driverPhone) ?? null,
      createdAt: candidate.createdAt.toISOString(),
    };
  });
}

/**
 * À quelle distance du point de récupération se trouve chaque livreur candidat.
 *
 * La valeur est absente — jamais remplacée par une approximation — dès que l'une des
 * conditions manque : point de récupération introuvable, livreur sans position de
 * référence, ou position plus ancienne que `BASE_POSITION_MAX_AGE_MS`. Un livreur qui
 * n'a pas ouvert l'application depuis une semaine n'est plus forcément là où sa
 * dernière position le dit, et l'expéditeur mérite de le savoir plutôt que de lire un
 * chiffre faux.
 *
 * Lecture de confort : un incident sur ces requêtes ne doit pas priver l'expéditeur de
 * la liste de ses candidats, qui est l'information réellement attendue à cet instant.
 */
async function distancesFromPickup(db: any, deliveryId: string, driverPhones: string[]): Promise<Map<string, number>> {
  const distances = new Map<string, number>();
  if (driverPhones.length === 0) return distances;
  try {
    const [pickup] = await db
      .select({ latitude: tikissePlaces.latitude, longitude: tikissePlaces.longitude })
      .from(tikisseDeliveries)
      .innerJoin(tikissePlaces, eq(tikisseDeliveries.pickupPlaceId, tikissePlaces.id))
      .where(eq(tikisseDeliveries.id, deliveryId))
      .limit(1);
    if (!pickup) return distances;
    const pickupPoint = { latitude: Number(pickup.latitude), longitude: Number(pickup.longitude) };
    if (!Number.isFinite(pickupPoint.latitude) || !Number.isFinite(pickupPoint.longitude)) return distances;

    const perimeters = await getDriverPerimetersByPhone(db, driverPhones);
    const now = Date.now();
    for (const phone of driverPhones) {
      const perimeter = perimeters.get(phone);
      // Comparaison à `null`, jamais falsy : la latitude 0 est une coordonnée valide.
      if (perimeter?.baseLatitude == null || perimeter.baseLongitude == null) continue;
      if (perimeter.baseUpdatedAt && now - new Date(perimeter.baseUpdatedAt).getTime() > BASE_POSITION_MAX_AGE_MS) continue;
      const distance = distanceKmBetween({ latitude: perimeter.baseLatitude, longitude: perimeter.baseLongitude }, pickupPoint);
      if (Number.isFinite(distance)) distances.set(phone, Math.round(distance * 10) / 10);
    }
  } catch (cause) {
    console.error("[candidates] Distances indisponibles, candidats affichés sans position", cause);
  }
  return distances;
}

export async function getTikisseDeliveryCandidateForDriver(deliveryId: string, driverPhone: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.deliveryId, deliveryId), eq(tikisseDeliveryCandidates.driverPhone, driverPhone))).limit(1);
  return rows[0];
}

export async function getTikisseDriverStats(driverPhone: string): Promise<{ rating: number; completedDeliveries: number; reviewsCount: number }> {
  const db = await getDb();
  if (!db) return { rating: 0, completedDeliveries: 0, reviewsCount: 0 };
  const [ratingRow] = await db.select({ sum: sql<number>`COALESCE(SUM(${tikisseDeliveryReviews.rating}), 0)`, count: sql<number>`COUNT(*)` })
    .from(tikisseDeliveryReviews)
    .where(and(eq(tikisseDeliveryReviews.driverPhone, driverPhone), isNull(tikisseDeliveryReviews.hiddenAt)));
  const [completedRow] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(tikisseDeliveries)
    .where(and(eq(tikisseDeliveries.driverPhone, driverPhone), eq(tikisseDeliveries.status, "completed")));
  const sum = Number(ratingRow?.sum ?? 0);
  const reviewsCount = Number(ratingRow?.count ?? 0);
  const completedDeliveries = Number(completedRow?.count ?? 0);
  const rating = reviewsCount > 0 ? Math.round((sum / reviewsCount) * 10) / 10 : 0;
  return { rating, completedDeliveries, reviewsCount };
}

export async function listTikisseDeliveryCandidateStatesForDriver(deliveryIds: string[], driverPhone: string) {
  const db = await getDb();
  if (!db || deliveryIds.length === 0) return new Map<string, TikisseDeliveryCandidate>();
  const rows = await db.select().from(tikisseDeliveryCandidates).where(and(inArray(tikisseDeliveryCandidates.deliveryId, deliveryIds), eq(tikisseDeliveryCandidates.driverPhone, driverPhone)));
  return new Map(rows.map((candidate) => [candidate.deliveryId, candidate]));
}

export async function countTikisseDeliveryCandidates(deliveryIds: string[]) {
  const db = await getDb();
  if (!db || deliveryIds.length === 0) return new Map<string, number>();
  const rows = await db.select({ deliveryId: tikisseDeliveryCandidates.deliveryId, total: count() }).from(tikisseDeliveryCandidates).where(inArray(tikisseDeliveryCandidates.deliveryId, deliveryIds)).groupBy(tikisseDeliveryCandidates.deliveryId);
  return new Map(rows.map((row) => [row.deliveryId, Number(row.total)]));
}

export async function getTikisseDeliveryReview(deliveryId: string, reviewerPhone: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(tikisseDeliveryReviews).where(and(eq(tikisseDeliveryReviews.deliveryId, deliveryId), eq(tikisseDeliveryReviews.reviewerPhone, reviewerPhone))).limit(1);
  return rows[0];
}

export async function saveTikisseDeliveryReview(input: { id: string; deliveryId: string; reviewerPhone: string; driverPhone: string; rating: number; comment?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Les avis sont temporairement indisponibles.");
  await db.insert(tikisseDeliveryReviews).values({ ...input, comment: input.comment ?? null });
  return getTikisseDeliveryReview(input.deliveryId, input.reviewerPhone);
}

export async function deliveryReviewToView(review: NonNullable<Awaited<ReturnType<typeof getTikisseDeliveryReview>>>): Promise<DeliveryReview> {
  const profile = await getTikisseProfileByPhone(review.driverPhone);
  return { id: review.id, deliveryId: review.deliveryId, driverName: profile?.fullName ?? "Livreur Tikisse", rating: review.rating as DeliveryReview["rating"], ...(review.comment ? { comment: review.comment } : {}), createdAt: review.createdAt.toISOString() };
}

export async function listTikisseDeliveryReviewsForProfile(profilePhone: string, role: "sender" | "driver") {
  const db = await getDb();
  if (!db) return [];
  // L'auteur retrouve toujours ses propres avis ; un avis masqué par la modération n'apparaît plus côté livreur.
  const condition = role === "sender" ? eq(tikisseDeliveryReviews.reviewerPhone, profilePhone) : and(eq(tikisseDeliveryReviews.driverPhone, profilePhone), isNull(tikisseDeliveryReviews.hiddenAt));
  const reviews = await db.select().from(tikisseDeliveryReviews).where(condition).orderBy(desc(tikisseDeliveryReviews.createdAt));
  return Promise.all(reviews.map((review) => deliveryReviewToView(review)));
}

/** YengaPay : enregistrement idempotent d'un événement webhook. */
/**
 * Enregistre un événement webhook et dit s'il reste à traiter.
 *
 * Deux défauts faisaient perdre des paiements confirmés :
 * - la clé ne tenait pas compte du statut. Les webhooks sans `transId` prennent `paymentIntentId` comme
 *   identifiant d'événement : « en attente » puis « réussi » pour un même paiement portaient le même, et
 *   le succès était jeté comme doublon ;
 * - tout événement déjà vu était un doublon, même si son règlement avait échoué. Le serveur répondait
 *   pourtant « réessaie plus tard » (202) : la relivraison était ignorée, le paiement jamais crédité.
 * Un événement n'est donc plus considéré comme traité qu'une fois marqué `processed`.
 */
export function webhookEventKey(providerEventId: string, eventType: string) {
  const key = `${providerEventId}:${eventType}`;
  // La colonne fait 120 caractères : au-delà, une empreinte stable plutôt qu'une troncature qui
  // pourrait confondre deux événements.
  return key.length <= 120 ? key : createHash("sha256").update(key).digest("hex");
}

export async function recordYengapayWebhookEvent(input: { provider: "yengapay_sandbox" | "yengapay_live" | "yengapay_direct_sandbox" | "yengapay_direct_live"; providerEventId: string; eventType: string; paymentTransactionId: string | null; payload: string; signature: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Le paiement est temporairement indisponible.");
  const providerEventId = webhookEventKey(input.providerEventId, input.eventType);
  const find = async () => (await db.select().from(tikisseYengapayWebhookEvents).where(and(eq(tikisseYengapayWebhookEvents.provider, input.provider), eq(tikisseYengapayWebhookEvents.providerEventId, providerEventId))).limit(1))[0];
  const existing = await find();
  if (existing) return { duplicate: true, alreadyProcessed: existing.status === "processed" || existing.status === "ignored", id: existing.id };
  const id = randomUUID();
  try {
    await db.insert(tikisseYengapayWebhookEvents).values({ id, provider: input.provider, providerEventId, eventType: input.eventType, paymentTransactionId: input.paymentTransactionId, payload: input.payload, signature: input.signature, status: "received" });
  } catch (cause) {
    // Deux livraisons simultanées du même événement : la seconde bute sur l'index unique. Le règlement
    // est lui-même idempotent, on la laisse donc poursuivre comme un doublon non encore traité.
    const concurrent = await find();
    if (!concurrent) throw cause;
    return { duplicate: true, alreadyProcessed: concurrent.status === "processed" || concurrent.status === "ignored", id: concurrent.id };
  }
  return { duplicate: false, alreadyProcessed: false, id };
}

export async function getYengapayWebhookEvent(id: string) {
  const db = await getDb();
  if (!db) throw new Error("Le paiement est temporairement indisponible.");
  return (await db.select().from(tikisseYengapayWebhookEvents).where(eq(tikisseYengapayWebhookEvents.id, id)).limit(1))[0];
}

/** Clôt un événement webhook : `processed`/`ignored` ne seront plus retraités, `failed` le sera à la relivraison. */
export async function markYengapayWebhookEvent(id: string, status: "processed" | "ignored" | "failed", details: { paymentTransactionId?: string | null; failureReason?: string } = {}) {
  const db = await getDb();
  if (!db) return;
  await db.update(tikisseYengapayWebhookEvents).set({
    status,
    processedAt: status === "failed" ? null : new Date(),
    failureReason: details.failureReason ? details.failureReason.slice(0, 500) : null,
    ...(details.paymentTransactionId ? { paymentTransactionId: details.paymentTransactionId } : {}),
  }).where(eq(tikisseYengapayWebhookEvents.id, id));
}

/** YengaPay : lookup rapide par providerReference pour le webhook handler. Renvoie le `provider`
 *  de la transaction (utile pour distinguer checkout web vs paiement direct) et la FK. Si la
 *  transaction n'existe pas encore (race webhook arrive avant la confirmation API), renvoie null
 *  — le webhook handler tombera sur le provider par défaut et le settle échouera proprement. */
export async function lookupTikissePaymentByProviderReference(providerReference: string): Promise<{ id: string; provider: typeof tikissePaymentTransactions.$inferSelect.provider; type: "deposit" | "withdrawal"; profilePhone: string } | null> {
  const db = await getDb();
  if (!db) throw new Error("Le paiement est temporairement indisponible.");
  const record = (await db.select({ id: tikissePaymentTransactions.id, provider: tikissePaymentTransactions.provider, type: tikissePaymentTransactions.type, profilePhone: tikissePaymentTransactions.profilePhone }).from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.providerReference, providerReference)).limit(1))[0];
  return record ?? null;
}

/** YengaPay : applique un événement de paiement sur le wallet (succeeded / failed / cancelled). */
export async function settleYengapayLivePayment(input: { providerReference: string; outcome: "succeeded" | "failed" | "cancelled"; reportedAmount?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Le paiement est temporairement indisponible.");
  return db.transaction(async (tx) => {
    const payment = (await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.providerReference, input.providerReference)).limit(1).for("update"))[0];
    if (!payment) throw new Error(`Transaction YengaPay introuvable pour la référence ${input.providerReference}.`);
    // Un succès crédite même une transaction expirée ou annulée localement (voir `mayCreditConfirmedDeposit`) ;
    // un échec ou une annulation, eux, ne touchent qu'une transaction encore en attente — jamais un dépôt
    // déjà crédité, qu'ils ne reprennent pas.
    const settles = input.outcome === "succeeded" ? mayCreditConfirmedDeposit(payment.status) : payment.status === "pending";
    if (!settles) {
      const wallet = await ensureTikisseWallet(tx, payment.profilePhone);
      return { payment: yengaPayTestPaymentToView(payment), wallet: walletSnapshotFromRecord(wallet) } satisfies YengaPayTestPaymentSettlement;
    }
    // On crédite le montant enregistré à la création de l'intention, jamais celui du webhook ; un écart
    // est signalé pour vérification, sans bloquer un paiement que YengaPay a confirmé. Le montant annoncé
    // par YengaPay est conservé sur la transaction : la console liste les écarts (Contrôle financier),
    // qui n'apparaissaient jusqu'ici que dans les journaux du serveur.
    if (input.outcome === "succeeded" && input.reportedAmount && input.reportedAmount !== payment.amount) {
      console.error("[yengapay] montant confirmé différent du montant de l'intention", { paymentId: payment.id, attendu: payment.amount, confirme: input.reportedAmount });
    }
    const reported = input.outcome === "succeeded" && input.reportedAmount ? { providerReportedAmount: input.reportedAmount } : {};
    if (input.outcome === "failed" || input.outcome === "cancelled") {
      await tx.update(tikissePaymentTransactions).set({ status: input.outcome, settledAt: new Date() }).where(eq(tikissePaymentTransactions.id, payment.id));
    } else if (payment.type === "deposit") {
      await applyWalletMovement(tx, { profilePhone: payment.profilePhone, operation: "credit", amount: payment.amount, availableDelta: payment.amount, heldDelta: 0, reason: "Dépôt YengaPay live confirmé", idempotencyKey: depositCreditKey(payment.id) });
      await tx.update(tikissePaymentTransactions).set({ status: "succeeded", settledAt: new Date(), ...reported }).where(eq(tikissePaymentTransactions.id, payment.id));
    } else {
      await applyWalletMovement(tx, { profilePhone: payment.profilePhone, operation: "debit", amount: payment.amount, availableDelta: -payment.amount, heldDelta: 0, reason: "Retrait YengaPay live confirmé", idempotencyKey: `${payment.id}:settled` });
      await tx.update(tikissePaymentTransactions).set({ status: "succeeded", settledAt: new Date(), ...reported }).where(eq(tikissePaymentTransactions.id, payment.id));
    }
    const settled = (await tx.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, payment.id)).limit(1))[0];
    if (!settled) throw new Error("La transaction n’a pas pu être finalisée.");
    const wallet = await ensureTikisseWallet(tx, payment.profilePhone);
    return { payment: yengaPayTestPaymentToView(settled), wallet: walletSnapshotFromRecord(wallet) } satisfies YengaPayTestPaymentSettlement;
  });
}

/** YengaPay : réconciliation manuelle — vérifie l'état réel d'un intent en cas d'incident webhook. */
export async function reconcileYengapayPayment(providerReference: string) {
  const config = readYengapayConfig();
  if (config.mode === "test") throw new Error("La réconciliation YengaPay nécessite le mode sandbox ou live.");
  const remote = await verifyYengapayPayment({ providerReference });
  if (remote.status === "pending") return { pending: true, providerReference };
  return settleYengapayLivePayment({ providerReference, outcome: remote.status, reportedAmount: remote.amount > 0 ? remote.amount : undefined });
}

/** Push tokens Expo : enregistrement idempotent. Met à jour lastSeenAt si le token existe déjà. */
export async function registerPushToken(input: { phone: string; token: string; platform: "ios" | "android" | "web"; appVersion?: string; deviceName?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Les notifications push sont temporairement indisponibles.");
  if (!isValidExpoPushTokenShape(input.token)) {
    throw new Error("Format de token push invalide.");
  }
  // Un token représente une installation active, pas un compte permanent. Si le même
  // appareil change de compte, on retire l’ancienne association avant de l’enregistrer.
  await db.delete(tikissePushTokens).where(and(eq(tikissePushTokens.token, input.token), ne(tikissePushTokens.phone, input.phone)));
  const now = new Date();
  const existing = (await db.select().from(tikissePushTokens).where(and(eq(tikissePushTokens.phone, input.phone), eq(tikissePushTokens.token, input.token))).limit(1))[0];
  if (existing) {
    await db.update(tikissePushTokens).set({ lastSeenAt: now, platform: input.platform, appVersion: input.appVersion ?? existing.appVersion, deviceName: input.deviceName ?? existing.deviceName }).where(eq(tikissePushTokens.id, existing.id));
    return { id: existing.id, created: false };
  }
  const id = randomUUID();
  await db.insert(tikissePushTokens).values({ id, phone: input.phone, token: input.token, platform: input.platform, appVersion: input.appVersion ?? null, deviceName: input.deviceName ?? null, lastSeenAt: now });
  return { id, created: true };
}

export async function unregisterPushToken(input: { phone: string; token: string }) {
  const db = await getDb();
  if (!db) return { removed: 0 };
  const result = await db.delete(tikissePushTokens).where(and(eq(tikissePushTokens.phone, input.phone), eq(tikissePushTokens.token, input.token)));
  return { removed: (result as unknown as { affectedRows?: number }).affectedRows ?? 0 };
}

export async function listActivePushTokens(phone: string) {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return db.select().from(tikissePushTokens).where(and(eq(tikissePushTokens.phone, phone), gte(tikissePushTokens.lastSeenAt, cutoff)));
}

/** Envoie un push à tous les tokens actifs d'un phone. Best-effort : ne lève pas en cas d'échec. */
export async function enqueuePushToPhone(input: { phone: string; title: string; body: string; data?: Record<string, unknown>; channelId?: string }) {
  const tokens = await listActivePushTokens(input.phone);
  if (tokens.length === 0) return { sent: 0, failed: 0, errors: [] as string[] };
  const messages: PushMessage[] = tokens.map((token) => ({
    to: token.token,
    title: input.title,
    body: input.body,
    data: input.data,
    channelId: input.channelId ?? "tikisse-default",
  }));
  const result = await sendPushToTokens(messages);
  const db = await getDb();
  if (!db) return result;
  // Expo renvoie un ticket par message valide. Les tokens désactivés sont purgés
  // immédiatement pour ne pas dégrader le taux de livraison des prochaines alertes.
  for (const invalidToken of result.invalidTokens) {
    await db.delete(tikissePushTokens).where(and(eq(tikissePushTokens.phone, input.phone), eq(tikissePushTokens.token, invalidToken)));
  }
  return result;
}
