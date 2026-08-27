import { and, desc, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertTikisDelivery, InsertTikisPlace, InsertUser, TikisDelivery, TikisPlace, tikisDeliveries, tikisDeliveryCandidates, tikisDeliveryReviews, tikisFavoritePlaces, tikisPlaces, tikisProfiles, users } from "../drizzle/schema";
import { ENV } from "./_core/env";
import type { Delivery, DeliveryReview, DriverCandidate, LocationLabel, SelectableVehicleType } from "../shared/tikis-domain";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
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

export type PersistedTikisProfile = {
  phone: string;
  fullName: string;
  accountType: "sender" | "driver";
  vehicles: string;
  photoKey?: string | null;
  referralCode?: string | null;
};

export async function getTikisProfileByPhone(phone: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tikisProfiles).where(eq(tikisProfiles.phone, phone)).limit(1);
  return result[0];
}

export async function getTikisProfileByReferralCode(referralCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tikisProfiles).where(eq(tikisProfiles.referralCode, referralCode)).limit(1);
  return result[0];
}

/** Creates a profile once; an existing profile is returned untouched to preserve its account type. */
export async function createTikisProfile(input: PersistedTikisProfile) {
  const db = await getDb();
  if (!db) throw new Error("La base de données sécurisée est temporairement indisponible.");
  const existing = await getTikisProfileByPhone(input.phone);
  if (existing) return existing;
  await db.insert(tikisProfiles).values(input);
  const created = await getTikisProfileByPhone(input.phone);
  if (!created) throw new Error("Le profil n’a pas pu être enregistré.");
  return created;
}

export async function updateTikisProfile(phone: string, changes: Pick<PersistedTikisProfile, "fullName" | "photoKey">) {
  const db = await getDb();
  if (!db) throw new Error("La base de données sécurisée est temporairement indisponible.");
  await db.update(tikisProfiles).set({ ...changes, updatedAt: new Date() }).where(eq(tikisProfiles.phone, phone));
  const profile = await getTikisProfileByPhone(phone);
  if (!profile) throw new Error("Le profil est introuvable.");
  return profile;
}

export async function getTikisPlaceByGoogleId(googlePlaceId: string) {
  const db = await getDb();
  if (!db || !googlePlaceId) return undefined;
  const result = await db.select().from(tikisPlaces).where(eq(tikisPlaces.googlePlaceId, googlePlaceId)).limit(1);
  return result[0];
}

export async function getTikisPlaceByMapboxId(mapboxPlaceId: string) {
  const db = await getDb();
  if (!db || !mapboxPlaceId) return undefined;
  const result = await db.select().from(tikisPlaces).where(eq(tikisPlaces.mapboxPlaceId, mapboxPlaceId)).limit(1);
  return result[0];
}

export function coordinateCacheKey(latitude: string | number, longitude: string | number) {
  const safeLatitude = Number(latitude);
  const safeLongitude = Number(longitude);
  if (!Number.isFinite(safeLatitude) || !Number.isFinite(safeLongitude)) throw new Error("Coordonnées de lieu invalides.");
  return `${safeLatitude.toFixed(5)}:${safeLongitude.toFixed(5)}`;
}

export function tikisPlaceToLocation(place: TikisPlace): LocationLabel {
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
    provider: place.provider === "mapbox" ? "mapbox" : place.provider === "manual" ? "manual" : "legacy",
    source: ["retrieve", "reverse", "forward", "favorite", "manual", "legacy"].includes(place.source) ? place.source as LocationLabel["source"] : "legacy",
    featureType: ["address", "secondary_address", "poi", "street", "neighborhood", "locality", "place", "point", "unknown"].includes(place.featureType) ? place.featureType as LocationLabel["featureType"] : "unknown",
    precision: ["exact", "street", "area", "city", "unknown"].includes(place.precision) ? place.precision as LocationLabel["precision"] : "unknown",
  };
}

export async function getTikisPlaceByCoordinate(latitude: string | number, longitude: string | number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tikisPlaces).where(eq(tikisPlaces.coordinateKey, coordinateCacheKey(latitude, longitude))).limit(1);
  return result[0];
}

export async function saveTikisPlace(input: Omit<InsertTikisPlace, "coordinateKey" | "resolvedAt">) {
  const db = await getDb();
  if (!db) throw new Error("La base de lieux est temporairement indisponible.");
  if (input.googlePlaceId) {
    const cached = await getTikisPlaceByGoogleId(input.googlePlaceId);
    if (cached) return cached;
  }
  if (input.mapboxPlaceId) {
    const cached = await getTikisPlaceByMapboxId(input.mapboxPlaceId);
    if (cached) return cached;
  }
  const cachedByCoordinate = await getTikisPlaceByCoordinate(input.latitude, input.longitude);
  if (cachedByCoordinate) return cachedByCoordinate;
  const inserted = await db.insert(tikisPlaces).values({ ...input, coordinateKey: coordinateCacheKey(input.latitude, input.longitude) });
  const result = await db.select().from(tikisPlaces).where(eq(tikisPlaces.id, Number(inserted[0].insertId))).limit(1);
  if (!result[0]) throw new Error("Le lieu n’a pas pu être enregistré.");
  return result[0];
}

export async function listFavoritePlaces(profilePhone: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: tikisFavoritePlaces.id, label: tikisFavoritePlaces.label, createdAt: tikisFavoritePlaces.createdAt, place: tikisPlaces }).from(tikisFavoritePlaces).innerJoin(tikisPlaces, eq(tikisFavoritePlaces.placeId, tikisPlaces.id)).where(eq(tikisFavoritePlaces.profilePhone, profilePhone));
}

export async function saveFavoritePlace(profilePhone: string, placeId: number, label: string) {
  const db = await getDb();
  if (!db) throw new Error("Les favoris sont temporairement indisponibles.");
  await db.insert(tikisFavoritePlaces).values({ profilePhone, placeId, label }).onDuplicateKeyUpdate({ set: { label } });
  const result = await db.select().from(tikisFavoritePlaces).where(and(eq(tikisFavoritePlaces.profilePhone, profilePhone), eq(tikisFavoritePlaces.placeId, placeId))).limit(1);
  return result[0];
}

export async function renameFavoritePlace(profilePhone: string, favoriteId: number, label: string) {
  const db = await getDb();
  if (!db) throw new Error("Les favoris sont temporairement indisponibles.");
  await db.update(tikisFavoritePlaces).set({ label }).where(and(eq(tikisFavoritePlaces.id, favoriteId), eq(tikisFavoritePlaces.profilePhone, profilePhone)));
  const result = await db.select().from(tikisFavoritePlaces).where(and(eq(tikisFavoritePlaces.id, favoriteId), eq(tikisFavoritePlaces.profilePhone, profilePhone))).limit(1);
  if (!result[0]) throw new Error("Ce favori est introuvable ou ne vous appartient pas.");
  return result[0];
}

export async function deleteFavoritePlace(profilePhone: string, favoriteId: number) {
  const db = await getDb();
  if (!db) throw new Error("Les favoris sont temporairement indisponibles.");
  await db.delete(tikisFavoritePlaces).where(and(eq(tikisFavoritePlaces.id, favoriteId), eq(tikisFavoritePlaces.profilePhone, profilePhone)));
  return { success: true } as const;
}

function parseVehicles(value: string): SelectableVehicleType[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is SelectableVehicleType => item === "Vélo" || item === "Moto" || item === "Tricycle" || item === "Voiture") : [];
  } catch { return []; }
}

type DeliveryJoin = {
  delivery: TikisDelivery;
  pickup: TikisPlace;
  dropoff: TikisPlace;
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
    pickup: tikisPlaceToLocation(join.pickup),
    dropoff: tikisPlaceToLocation(join.dropoff),
    distanceKm: Number(row.distanceKm),
    routeSource: row.routeSource,
    estimatedPrice: row.estimatedPrice,
    ...(row.offeredPrice ? { offeredPrice: row.offeredPrice } : {}),
    vehicleTypes: parseVehicles(row.vehicleTypes),
    createdAt: row.createdAt.toISOString(),
    scheduledAt: row.createdAt.toISOString(),
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

async function deliveryJoins(rows: TikisDelivery[]): Promise<Delivery[]> {
  if (!rows.length) return [];
  const db = await getDb();
  if (!db) return [];
  const placeIds = [...new Set(rows.flatMap((row) => [row.pickupPlaceId, row.dropoffPlaceId]))];
  const profilePhones = [...new Set(rows.flatMap((row) => row.driverPhone ? [row.senderPhone, row.driverPhone] : [row.senderPhone]))];
  const [places, profiles] = await Promise.all([
    db.select().from(tikisPlaces).where(inArray(tikisPlaces.id, placeIds)),
    db.select().from(tikisProfiles).where(inArray(tikisProfiles.phone, profilePhones)),
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

export async function createTikisDelivery(input: InsertTikisDelivery) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.insert(tikisDeliveries).values(input);
  return getTikisDeliveryById(input.id);
}

export async function getTikisDeliveryById(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(tikisDeliveries).where(eq(tikisDeliveries.id, id)).limit(1);
  return (await deliveryJoins(rows))[0];
}

export async function getTikisDeliveryRecordById(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(tikisDeliveries).where(eq(tikisDeliveries.id, id)).limit(1);
  return rows[0];
}

export async function listTikisDeliveriesForProfile(profilePhone: string, role: "sender" | "driver") {
  const db = await getDb();
  if (!db) return [];
  const predicate = role === "sender"
    ? eq(tikisDeliveries.senderPhone, profilePhone)
    : or(eq(tikisDeliveries.status, "open"), eq(tikisDeliveries.driverPhone, profilePhone));
  const rows = await db.select().from(tikisDeliveries).where(predicate).orderBy(desc(tikisDeliveries.createdAt));
  return deliveryJoins(rows);
}

export async function createOrUpdateCandidate(input: { id: string; deliveryId: string; driverPhone: string; offerPrice?: number; commissionBlocked: number }) {
  const db = await getDb();
  if (!db) throw new Error("Les candidatures sont temporairement indisponibles.");
  const existing = await db.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.deliveryId, input.deliveryId), eq(tikisDeliveryCandidates.driverPhone, input.driverPhone))).limit(1);
  if (existing[0]) {
    if (existing[0].status === "selected" || existing[0].status === "confirmed") throw new Error("Cette candidature ne peut plus être modifiée.");
    await db.update(tikisDeliveryCandidates).set({ status: "applied", offerPrice: input.offerPrice ?? null, commissionBlocked: input.commissionBlocked, updatedAt: new Date() }).where(eq(tikisDeliveryCandidates.id, existing[0].id));
    return existing[0].id;
  }
  await db.insert(tikisDeliveryCandidates).values({ ...input, offerPrice: input.offerPrice ?? null, status: "applied" });
  return input.id;
}

export async function listTikisDeliveryCandidates(deliveryId: string): Promise<DriverCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ candidate: tikisDeliveryCandidates, profile: tikisProfiles }).from(tikisDeliveryCandidates).innerJoin(tikisProfiles, eq(tikisDeliveryCandidates.driverPhone, tikisProfiles.phone)).where(eq(tikisDeliveryCandidates.deliveryId, deliveryId)).orderBy(desc(tikisDeliveryCandidates.createdAt));
  return rows.map(({ candidate, profile }) => ({
    id: candidate.id,
    deliveryId: candidate.deliveryId,
    driverId: candidate.driverPhone,
    name: profile.fullName,
    initials: profile.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    rating: 0,
    completedDeliveries: 0,
    vehicles: parseVehicles(profile.vehicles),
    ...(candidate.offerPrice ? { offerPrice: candidate.offerPrice } : {}),
    status: candidate.status,
    commissionBlocked: candidate.commissionBlocked,
    isVerified: true,
  }));
}

export async function getTikisDeliveryCandidateForDriver(deliveryId: string, driverPhone: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.driverPhone, driverPhone))).limit(1);
  return rows[0];
}

export async function withdrawTikisDeliveryCandidate(deliveryId: string, driverPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les candidatures sont temporairement indisponibles.");
  const result = await db.update(tikisDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(and(eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.driverPhone, driverPhone), eq(tikisDeliveryCandidates.status, "applied")));
  if (result[0].affectedRows !== 1) throw new Error("Cette candidature ne peut plus être retirée.");
  return { success: true } as const;
}

export async function selectTikisDeliveryCandidate(deliveryId: string, candidateId: string, senderPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const deliveries = await tx.select().from(tikisDeliveries).where(and(eq(tikisDeliveries.id, deliveryId), eq(tikisDeliveries.senderPhone, senderPhone))).limit(1);
    const delivery = deliveries[0];
    if (!delivery || (delivery.status !== "open" && delivery.status !== "active" && delivery.status !== "pending_confirmation")) throw new Error("Cette livraison ne peut pas recevoir de sélection.");
    const candidates = await tx.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.id, candidateId), eq(tikisDeliveryCandidates.deliveryId, deliveryId))).limit(1);
    const candidate = candidates[0];
    if (!candidate || candidate.status !== "applied") throw new Error("Cette candidature n’est plus sélectionnable.");
    if (delivery.driverPhone) await tx.update(tikisDeliveryCandidates).set({ status: "replaced", updatedAt: new Date() }).where(and(eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.driverPhone, delivery.driverPhone), eq(tikisDeliveryCandidates.status, "confirmed")));
    await tx.update(tikisDeliveryCandidates).set({ status: "selected", updatedAt: new Date() }).where(eq(tikisDeliveryCandidates.id, candidateId));
    await tx.update(tikisDeliveries).set({ status: "pending_confirmation", driverPhone: candidate.driverPhone, ...(delivery.driverPhone ? { previousDriverPhone: delivery.driverPhone } : {}), ...(candidate.offerPrice ? { offeredPrice: candidate.offerPrice } : {}), selectedAt: new Date(), updatedAt: new Date() }).where(eq(tikisDeliveries.id, deliveryId));
  });
  return getTikisDeliveryById(deliveryId);
}

export async function confirmTikisDelivery(deliveryId: string, driverPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(tikisDeliveries).where(and(eq(tikisDeliveries.id, deliveryId), eq(tikisDeliveries.driverPhone, driverPhone), eq(tikisDeliveries.status, "pending_confirmation"))).limit(1);
    if (!rows[0]) throw new Error("Cette livraison ne peut pas être confirmée.");
    const result = await tx.update(tikisDeliveryCandidates).set({ status: "confirmed", updatedAt: new Date() }).where(and(eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.driverPhone, driverPhone), eq(tikisDeliveryCandidates.status, "selected")));
    if (result[0].affectedRows !== 1) throw new Error("Votre candidature ne peut pas être confirmée.");
    await tx.update(tikisDeliveries).set({ status: "active", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(tikisDeliveries.id, deliveryId));
  });
  return getTikisDeliveryById(deliveryId);
}

export async function completeTikisDelivery(deliveryId: string, profilePhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  const result = await db.update(tikisDeliveries).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(tikisDeliveries.id, deliveryId), eq(tikisDeliveries.status, "active"), or(eq(tikisDeliveries.senderPhone, profilePhone), eq(tikisDeliveries.driverPhone, profilePhone))));
  if (result[0].affectedRows !== 1) throw new Error("Cette livraison ne peut pas être terminée.");
  return getTikisDeliveryById(deliveryId);
}

export async function getTikisDeliveryReview(deliveryId: string, reviewerPhone: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(tikisDeliveryReviews).where(and(eq(tikisDeliveryReviews.deliveryId, deliveryId), eq(tikisDeliveryReviews.reviewerPhone, reviewerPhone))).limit(1);
  return rows[0];
}

export async function saveTikisDeliveryReview(input: { id: string; deliveryId: string; reviewerPhone: string; driverPhone: string; rating: number; comment?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Les avis sont temporairement indisponibles.");
  await db.insert(tikisDeliveryReviews).values({ ...input, comment: input.comment ?? null });
  return getTikisDeliveryReview(input.deliveryId, input.reviewerPhone);
}

export async function deliveryReviewToView(review: NonNullable<Awaited<ReturnType<typeof getTikisDeliveryReview>>>): Promise<DeliveryReview> {
  const profile = await getTikisProfileByPhone(review.driverPhone);
  return { id: review.id, deliveryId: review.deliveryId, driverName: profile?.fullName ?? "Livreur Tikis", rating: review.rating as DeliveryReview["rating"], ...(review.comment ? { comment: review.comment } : {}), createdAt: review.createdAt.toISOString() };
}

export async function listTikisDeliveryReviewsForProfile(profilePhone: string, role: "sender" | "driver") {
  const db = await getDb();
  if (!db) return [];
  const condition = role === "sender" ? eq(tikisDeliveryReviews.reviewerPhone, profilePhone) : eq(tikisDeliveryReviews.driverPhone, profilePhone);
  const reviews = await db.select().from(tikisDeliveryReviews).where(condition).orderBy(desc(tikisDeliveryReviews.createdAt));
  return Promise.all(reviews.map((review) => deliveryReviewToView(review)));
}
