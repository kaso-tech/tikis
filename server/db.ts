import { randomUUID } from "crypto";
import { and, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertTikisDelivery, InsertTikisPlace, InsertUser, TikisDelivery, TikisDeliveryCandidate, TikisPlace, tikisDeliveries, tikisDeliveryCandidates, tikisDeliveryEvents, tikisDeliveryLiveLocations, tikisDeliveryReviews, tikisFavoritePlaces, tikisPaymentTransactions, tikisPlaces, tikisPlatformSettings, tikisProfiles, tikisWalletLedger, tikisWallets, users } from "../drizzle/schema";
import { ENV } from "./_core/env";
import type { Delivery, DeliveryReview, DriverCandidate, FinancialRecord, InAppNotification, LocationLabel, SelectableVehicleType, WalletOperation, WalletSnapshot } from "../shared/tikis-domain";
import { candidateMovementVersion } from "../shared/wallet-commission";
import { DELIVERY_EXPIRATION_MS, deliveryExpirationOutcome } from "../shared/delivery-expiration";

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
  supabaseUserId?: string | null;
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

/** Links a profile only after the server has verified the matching Supabase phone session. */
export async function linkTikisProfileToSupabaseUser(phone: string, supabaseUserId: string) {
  const database = await getDb();
  if (!database) throw new Error("La base de données sécurisée est temporairement indisponible.");
  const profile = await getTikisProfileByPhone(phone);
  if (!profile) throw new Error("Profil introuvable.");
  if (profile.supabaseUserId && profile.supabaseUserId !== supabaseUserId) throw new Error("Ce profil est déjà associé à une autre session sécurisée.");
  const conflicting = await database.select({ phone: tikisProfiles.phone }).from(tikisProfiles).where(eq(tikisProfiles.supabaseUserId, supabaseUserId)).limit(1);
  if (conflicting[0] && conflicting[0].phone !== phone) throw new Error("Cette session Supabase est déjà utilisée par un autre profil Tikis.");
  if (!profile.supabaseUserId) await database.update(tikisProfiles).set({ supabaseUserId, updatedAt: new Date() }).where(eq(tikisProfiles.phone, phone));
  return (await getTikisProfileByPhone(phone))!;
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
  return `${safeLatitude.toFixed(7)}:${safeLongitude.toFixed(7)}`;
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
    provider: place.provider === "mapbox" ? "mapbox" : place.provider === "openstreetmap" ? "openstreetmap" : place.provider === "manual" ? "manual" : "legacy",
    source: ["search", "retrieve", "reverse", "forward", "favorite", "manual", "legacy"].includes(place.source) ? place.source as LocationLabel["source"] : "legacy",
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
  const isExactMapSelection = input.source === "reverse";
  if (!isExactMapSelection && input.googlePlaceId) {
    const cached = await getTikisPlaceByGoogleId(input.googlePlaceId);
    if (cached) return cached;
  }
  if (!isExactMapSelection && input.mapboxPlaceId) {
    const cached = await getTikisPlaceByMapboxId(input.mapboxPlaceId);
    if (cached) return cached;
  }
  const cachedByCoordinate = await getTikisPlaceByCoordinate(input.latitude, input.longitude);
  if (cachedByCoordinate) {
    const quality = (precision: string, featureType: string) => (precision === "exact" ? 40 : precision === "street" ? 30 : precision === "area" ? 20 : precision === "city" ? 10 : 0) + (featureType === "poi" ? 5 : 0);
    if (quality(cachedByCoordinate.precision, cachedByCoordinate.featureType) >= quality(input.precision ?? "unknown", input.featureType ?? "unknown")) return cachedByCoordinate;
    await db.update(tikisPlaces).set({ ...input, coordinateKey: coordinateCacheKey(input.latitude, input.longitude) }).where(eq(tikisPlaces.id, cachedByCoordinate.id));
    const updated = await db.select().from(tikisPlaces).where(eq(tikisPlaces.id, cachedByCoordinate.id)).limit(1);
    if (updated[0]) return updated[0];
  }
  const inserted = await db.insert(tikisPlaces).values({
    ...input,
    ...(isExactMapSelection ? { googlePlaceId: null, mapboxPlaceId: null } : {}),
    coordinateKey: coordinateCacheKey(input.latitude, input.longitude),
  });
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

export type TikisLiveDeliveryPosition = {
  latitude: number;
  longitude: number;
  heading: number;
  recordedAt: string;
};

export async function saveTikisDeliveryLiveLocation(input: {
  deliveryId: string;
  driverPhone: string;
  latitude: number;
  longitude: number;
  heading: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Le suivi en direct est temporairement indisponible.");
  const delivery = await getTikisDeliveryRecordById(input.deliveryId);
  if (!delivery || delivery.status !== "active" || delivery.driverPhone !== input.driverPhone) {
    throw new Error("Cette position ne peut pas être publiée pour cette livraison.");
  }
  const recordedAt = new Date();
  await db.insert(tikisDeliveryLiveLocations).values({
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
  return { latitude: input.latitude, longitude: input.longitude, heading: input.heading, recordedAt: recordedAt.toISOString() } satisfies TikisLiveDeliveryPosition;
}

export async function getTikisDeliveryLiveLocation(deliveryId: string): Promise<TikisLiveDeliveryPosition | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(tikisDeliveryLiveLocations).where(eq(tikisDeliveryLiveLocations.deliveryId, deliveryId)).limit(1);
  const location = rows[0];
  if (!location) return null;
  return {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    heading: Number(location.heading),
    recordedAt: location.recordedAt.toISOString(),
  };
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

export async function expireOpenTikisDeliveries(now = new Date()) {
  const db = await getDb();
  if (!db) return { expiredCount: 0, completedCount: 0, expiredDeliveryIds: [], completedDeliveryIds: [] } as const;
  const cutoff = new Date(now.getTime() - DELIVERY_EXPIRATION_MS);
  return db.transaction(async (tx) => {
    const stale = await tx.select().from(tikisDeliveries)
      .where(and(inArray(tikisDeliveries.status, ["open", "pending_confirmation", "active", "disabled"]), lt(tikisDeliveries.createdAt, cutoff)))
      .for("update");
    let expiredCount = 0;
    let completedCount = 0;
    const expiredDeliveryIds: string[] = [];
    const completedDeliveryIds: string[] = [];
    for (const delivery of stale) {
      const outcome = deliveryExpirationOutcome(delivery.status as "open" | "pending_confirmation" | "active" | "disabled", delivery.createdAt, now.getTime());
      if (outcome === "complete" && delivery.driverPhone) {
        const earning = Math.round(delivery.offeredPrice ?? delivery.estimatedPrice);
        await applyWalletMovement(tx, {
          profilePhone: delivery.driverPhone,
          deliveryId: delivery.id,
          operation: "credit",
          amount: earning,
          availableDelta: earning,
          heldDelta: 0,
          reason: "Gain de livraison crédité après clôture automatique à 24 h",
          idempotencyKey: `${delivery.id}:delivery-earning`,
        });
        await tx.update(tikisDeliveries).set({ status: "completed", completedAt: now, updatedAt: now }).where(eq(tikisDeliveries.id, delivery.id));
        await appendDeliveryEvent(tx, { deliveryId: delivery.id, eventType: "delivery_completed", status: "completed", recipientPhone: delivery.senderPhone, title: "Livraison finalisée automatiquement", body: "La livraison en cours a été clôturée après 24 heures.", tone: "success", idempotencyKey: `${delivery.id}:auto-completed-sender` });
        await appendDeliveryEvent(tx, { deliveryId: delivery.id, eventType: "delivery_completed", status: "completed", recipientPhone: delivery.driverPhone, title: "Gain de livraison crédité", body: `Votre gain de ${earning} FCFA a été ajouté après la clôture automatique de la course.`, tone: "success", idempotencyKey: `${delivery.id}:auto-completed-driver` });
        completedCount += 1;
        completedDeliveryIds.push(delivery.id);
        continue;
      }
      if (outcome !== "expire") continue;
      const candidates = await tx.select().from(tikisDeliveryCandidates)
        .where(and(eq(tikisDeliveryCandidates.deliveryId, delivery.id), inArray(tikisDeliveryCandidates.status, ["applied", "selected"])))
        .for("update");
      for (const candidate of candidates) {
        const debits = await tx.select().from(tikisWalletLedger).where(and(eq(tikisWalletLedger.deliveryId, delivery.id), eq(tikisWalletLedger.profilePhone, candidate.driverPhone), eq(tikisWalletLedger.operation, "debit"))).for("update");
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
        await tx.update(tikisDeliveryCandidates).set({ status: "withdrawn" }).where(eq(tikisDeliveryCandidates.id, candidate.id));
        await appendDeliveryEvent(tx, {
          deliveryId: delivery.id,
          eventType: "delivery_expired",
          status: "expired",
          recipientPhone: candidate.driverPhone,
          title: "Livraison expirée",
          body: "Cette livraison n’est plus disponible après 24 heures.",
          tone: "warning",
          idempotencyKey: `delivery-expired-candidate:${delivery.id}:${candidate.id}`,
        });
      }
      await tx.update(tikisDeliveries).set({ status: "expired", cancelledAt: now }).where(eq(tikisDeliveries.id, delivery.id));
      await appendDeliveryEvent(tx, {
        deliveryId: delivery.id,
        eventType: "delivery_expired",
        status: "expired",
        recipientPhone: delivery.senderPhone,
        title: "Livraison expirée",
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
};

async function ensureTikisWallet(tx: any, profilePhone: string) {
  await tx.insert(tikisWallets).values({ profilePhone }).onDuplicateKeyUpdate({ set: { profilePhone } });
  const rows = await tx.select().from(tikisWallets).where(eq(tikisWallets.profilePhone, profilePhone)).limit(1).for("update");
  if (!rows[0]) throw new Error("Le Wallet est temporairement indisponible.");
  return rows[0];
}

async function applyWalletMovement(tx: any, movement: WalletMovement) {
  if (!Number.isSafeInteger(movement.amount) || movement.amount <= 0) throw new Error("Montant financier invalide.");
  const existing = await tx.select().from(tikisWalletLedger).where(eq(tikisWalletLedger.idempotencyKey, movement.idempotencyKey)).limit(1);
  if (existing[0]) return existing[0];
  const wallet = await ensureTikisWallet(tx, movement.profilePhone);
  const availableBefore = wallet.availableBalance;
  const heldBefore = wallet.heldBalance;
  const availableAfter = availableBefore + movement.availableDelta;
  const heldAfter = heldBefore + movement.heldDelta;
  if (availableAfter < 0 || heldAfter < 0) throw new Error("Solde Wallet insuffisant pour cette opération.");
  await tx.update(tikisWallets).set({ availableBalance: availableAfter, heldBalance: heldAfter, updatedAt: new Date() }).where(eq(tikisWallets.profilePhone, movement.profilePhone));
  await tx.insert(tikisWalletLedger).values({
    id: randomUUID(), profilePhone: movement.profilePhone, deliveryId: movement.deliveryId ?? null, operation: movement.operation,
    amount: movement.amount, availableBefore, availableAfter, heldBefore, heldAfter, reason: movement.reason, idempotencyKey: movement.idempotencyKey,
  });
  return { availableAfter, heldAfter };
}

async function appendDeliveryEvent(tx: any, event: DeliveryEventInput) {
  await tx.insert(tikisDeliveryEvents).values({
    id: randomUUID(), deliveryId: event.deliveryId, eventType: event.eventType, status: event.status ?? null,
    actorPhone: event.actorPhone ?? null, recipientPhone: event.recipientPhone, title: event.title, body: event.body,
    tone: event.tone, metadata: null, idempotencyKey: event.idempotencyKey,
  }).onDuplicateKeyUpdate({ set: { idempotencyKey: event.idempotencyKey } });
}

export async function getTikisCommissionRate() {
  const db = await getDb();
  if (!db) throw new Error("La configuration de commission est temporairement indisponible.");
  await db.insert(tikisPlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const settings = await db.select().from(tikisPlatformSettings).where(eq(tikisPlatformSettings.id, 1)).limit(1);
  const rate = Number(settings[0]?.commissionRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) throw new Error("Le taux de commission configuré est invalide.");
  return rate;
}

export async function getTikisWalletSnapshot(profilePhone: string): Promise<WalletSnapshot> {
  const db = await getDb();
  if (!db) return { total: 0, blocked: 0 };
  await db.insert(tikisWallets).values({ profilePhone }).onDuplicateKeyUpdate({ set: { profilePhone } });
  const rows = await db.select().from(tikisWallets).where(eq(tikisWallets.profilePhone, profilePhone)).limit(1);
  const wallet = rows[0];
  if (!wallet) return { total: 0, blocked: 0 };
  return { total: wallet.availableBalance + wallet.heldBalance, blocked: wallet.heldBalance };
}

export async function listTikisWalletLedger(profilePhone: string): Promise<FinancialRecord[]> {
  const db = await getDb();
  if (!db) return [];
  const entries = await db.select().from(tikisWalletLedger).where(eq(tikisWalletLedger.profilePhone, profilePhone)).orderBy(desc(tikisWalletLedger.createdAt));
  return entries.map((entry) => ({ id: entry.id, deliveryId: entry.deliveryId ?? "", createdAt: entry.createdAt.toISOString(), operation: entry.operation as WalletOperation, amount: entry.amount, balanceBefore: entry.availableBefore + entry.heldBefore, balanceAfter: entry.availableAfter + entry.heldAfter, reason: entry.reason }));
}

export async function requestTikisWalletOperation(profilePhone: string, type: "deposit" | "withdrawal", amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 10_000_000) throw new Error("Le montant demandé est invalide.");
  const db = await getDb();
  if (!db) throw new Error("Le Wallet est temporairement indisponible.");
  await db.transaction(async (tx) => {
    const wallet = await ensureTikisWallet(tx, profilePhone);
    if (type === "withdrawal" && wallet.availableBalance < amount) throw new Error("Votre solde disponible est insuffisant pour ce retrait.");
    await tx.insert(tikisWalletLedger).values({
      id: randomUUID(), profilePhone, deliveryId: null, operation: type === "deposit" ? "deposit_request" : "withdrawal_request", amount,
      availableBefore: wallet.availableBalance, availableAfter: wallet.availableBalance, heldBefore: wallet.heldBalance, heldAfter: wallet.heldBalance,
      reason: type === "deposit" ? "Demande de dépôt en attente d’un moyen de paiement autorisé" : "Demande de retrait en attente de traitement", idempotencyKey: `${type}:${profilePhone}:${randomUUID()}`,
    });
  });
  return { success: true } as const;
}

type SimulatedPaymentView = { id: string; type: "deposit" | "withdrawal"; amount: number; status: "pending" | "succeeded" | "failed" | "cancelled"; providerReference: string; createdAt: string; settledAt?: string };
type SimulatedPaymentSettlement = { payment: SimulatedPaymentView; wallet: WalletSnapshot };

function simulatedPaymentToView(payment: { id: string; type: "deposit" | "withdrawal"; amount: number; status: "pending" | "succeeded" | "failed" | "cancelled"; providerReference: string; createdAt: Date; settledAt: Date | null }): SimulatedPaymentView {
  return { id: payment.id, type: payment.type, amount: payment.amount, status: payment.status, providerReference: payment.providerReference, createdAt: payment.createdAt.toISOString(), ...(payment.settledAt ? { settledAt: payment.settledAt.toISOString() } : {}) };
}

function walletSnapshotFromRecord(wallet: { availableBalance: number; heldBalance: number }): WalletSnapshot {
  return { total: wallet.availableBalance + wallet.heldBalance, blocked: wallet.heldBalance };
}

export async function initiateSimulatedLigdiPayment(input: { profilePhone: string; type: "deposit" | "withdrawal"; amount: number; idempotencyKey: string }) {
  if (!Number.isSafeInteger(input.amount) || input.amount < 100 || input.amount > 10_000_000) throw new Error("Le montant demandé est invalide.");
  if (!/^[A-Za-z0-9_-]{16,96}$/.test(input.idempotencyKey)) throw new Error("Référence de paiement invalide.");
  const db = await getDb();
  if (!db) throw new Error("Le paiement est temporairement indisponible.");
  return db.transaction(async (tx) => {
    const existing = (await tx.select().from(tikisPaymentTransactions).where(eq(tikisPaymentTransactions.idempotencyKey, input.idempotencyKey)).limit(1).for("update"))[0];
    if (existing) {
      if (existing.profilePhone !== input.profilePhone) throw new Error("Référence de paiement invalide.");
      return simulatedPaymentToView(existing);
    }
    const wallet = await ensureTikisWallet(tx, input.profilePhone);
    if (input.type === "withdrawal" && wallet.availableBalance < input.amount) throw new Error("Votre solde disponible est insuffisant pour ce retrait.");
    const id = randomUUID();
    const providerReference = `LIGDI-SIM-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
    await tx.insert(tikisPaymentTransactions).values({ id, profilePhone: input.profilePhone, type: input.type, amount: input.amount, status: "pending", providerReference, idempotencyKey: input.idempotencyKey });
    await tx.insert(tikisWalletLedger).values({ id: randomUUID(), profilePhone: input.profilePhone, deliveryId: null, operation: input.type === "deposit" ? "deposit_request" : "withdrawal_request", amount: input.amount, availableBefore: wallet.availableBalance, availableAfter: wallet.availableBalance, heldBefore: wallet.heldBalance, heldAfter: wallet.heldBalance, reason: `Demande ${input.type === "deposit" ? "de dépôt" : "de retrait"} Ligdi Cash simulée`, idempotencyKey: `${id}:requested` });
    const created = (await tx.select().from(tikisPaymentTransactions).where(eq(tikisPaymentTransactions.id, id)).limit(1))[0];
    if (!created) throw new Error("La demande de paiement n’a pas pu être créée.");
    return simulatedPaymentToView(created);
  });
}

export async function settleSimulatedLigdiPayment(input: { profilePhone: string; paymentId: string; outcome: "succeeded" | "failed" }) {
  const db = await getDb();
  if (!db) throw new Error("Le paiement est temporairement indisponible.");
  return db.transaction(async (tx) => {
    const payment = (await tx.select().from(tikisPaymentTransactions).where(and(eq(tikisPaymentTransactions.id, input.paymentId), eq(tikisPaymentTransactions.profilePhone, input.profilePhone))).limit(1).for("update"))[0];
    if (!payment) throw new Error("Transaction Ligdi Cash introuvable.");
    if (payment.status !== "pending") {
      const wallet = await ensureTikisWallet(tx, payment.profilePhone);
      return { payment: simulatedPaymentToView(payment), wallet: walletSnapshotFromRecord(wallet) } satisfies SimulatedPaymentSettlement;
    }
    if (input.outcome === "failed") {
      await tx.update(tikisPaymentTransactions).set({ status: "failed", settledAt: new Date() }).where(eq(tikisPaymentTransactions.id, payment.id));
    } else if (payment.type === "deposit") {
      await applyWalletMovement(tx, { profilePhone: payment.profilePhone, operation: "credit", amount: payment.amount, availableDelta: payment.amount, heldDelta: 0, reason: "Dépôt Ligdi Cash simulé confirmé", idempotencyKey: `${payment.id}:settled` });
      await tx.update(tikisPaymentTransactions).set({ status: "succeeded", settledAt: new Date() }).where(eq(tikisPaymentTransactions.id, payment.id));
    } else {
      await applyWalletMovement(tx, { profilePhone: payment.profilePhone, operation: "debit", amount: payment.amount, availableDelta: -payment.amount, heldDelta: 0, reason: "Retrait Ligdi Cash simulé confirmé", idempotencyKey: `${payment.id}:settled` });
      await tx.update(tikisPaymentTransactions).set({ status: "succeeded", settledAt: new Date() }).where(eq(tikisPaymentTransactions.id, payment.id));
    }
    const settled = (await tx.select().from(tikisPaymentTransactions).where(eq(tikisPaymentTransactions.id, payment.id)).limit(1))[0];
    if (!settled) throw new Error("La transaction n’a pas pu être finalisée.");
    const wallet = await ensureTikisWallet(tx, payment.profilePhone);
    return { payment: simulatedPaymentToView(settled), wallet: walletSnapshotFromRecord(wallet) } satisfies SimulatedPaymentSettlement;
  });
}

export async function listTikisDeliveryEvents(profilePhone: string): Promise<InAppNotification[]> {
  const db = await getDb();
  if (!db) return [];
  const events = await db.select().from(tikisDeliveryEvents).where(eq(tikisDeliveryEvents.recipientPhone, profilePhone)).orderBy(desc(tikisDeliveryEvents.createdAt));
  return events.map((event) => ({ id: event.id, deliveryId: event.deliveryId, title: event.title, body: event.body, createdAt: event.createdAt.toISOString(), read: Boolean(event.readAt), tone: event.tone }));
}

export async function markTikisDeliveryEventsRead(profilePhone: string) {
  const db = await getDb();
  if (!db) return { success: true } as const;
  await db.update(tikisDeliveryEvents).set({ readAt: new Date() }).where(and(eq(tikisDeliveryEvents.recipientPhone, profilePhone), isNull(tikisDeliveryEvents.readAt)));
  return { success: true } as const;
}

export async function applyForTikisDelivery(input: { id: string; deliveryId: string; driverPhone: string; confirmedCommission: number; offerPrice?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Les candidatures sont temporairement indisponibles.");
  const wallet = await db.transaction(async (tx) => {
    const deliveries = await tx.select().from(tikisDeliveries).where(and(eq(tikisDeliveries.id, input.deliveryId), eq(tikisDeliveries.status, "open"))).limit(1).for("update");
    const delivery = deliveries[0];
    if (!delivery) throw new Error("Cette livraison n’accepte plus de candidatures.");
    if (delivery.senderPhone === input.driverPhone) throw new Error("Vous ne pouvez pas candidater à votre propre livraison.");
    await tx.insert(tikisPlatformSettings).values({ id: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
    const rateRows = await tx.select().from(tikisPlatformSettings).where(eq(tikisPlatformSettings.id, 1)).limit(1);
    const rate = Number(rateRows[0]?.commissionRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) throw new Error("Le taux de commission configuré est invalide.");
    const price = input.offerPrice ?? delivery.offeredPrice ?? delivery.estimatedPrice;
    const commission = Math.round(price * rate);
    if (input.confirmedCommission !== commission) throw new Error("La commission a changé. Vérifiez le montant puis confirmez à nouveau votre candidature.");
    const candidates = await tx.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.deliveryId, input.deliveryId), eq(tikisDeliveryCandidates.driverPhone, input.driverPhone))).limit(1).for("update");
    const existing = candidates[0];
    if (existing && (existing.status === "selected" || existing.status === "confirmed")) throw new Error("Cette candidature ne peut plus être modifiée.");
    const candidateId = existing?.id ?? input.id;
    const previousCommission = existing?.status === "applied" ? existing.commissionBlocked : 0;
    const delta = commission - previousCommission;
    const movementVersion = candidateMovementVersion(existing);
    if (delta > 0) await applyWalletMovement(tx, { profilePhone: input.driverPhone, deliveryId: input.deliveryId, operation: "block", amount: delta, availableDelta: -delta, heldDelta: delta, reason: "Commission temporairement bloquée pour candidature", idempotencyKey: `${candidateId}:block:${movementVersion}:${commission}` });
    if (delta < 0) await applyWalletMovement(tx, { profilePhone: input.driverPhone, deliveryId: input.deliveryId, operation: "unblock", amount: -delta, availableDelta: -delta, heldDelta: delta, reason: "Ajustement de la commission bloquée", idempotencyKey: `${candidateId}:unblock:${movementVersion}:${commission}` });
    if (existing) await tx.update(tikisDeliveryCandidates).set({ status: "applied", offerPrice: input.offerPrice ?? null, commissionBlocked: commission, updatedAt: new Date() }).where(eq(tikisDeliveryCandidates.id, existing.id));
    else await tx.insert(tikisDeliveryCandidates).values({ id: candidateId, deliveryId: input.deliveryId, driverPhone: input.driverPhone, offerPrice: input.offerPrice ?? null, commissionBlocked: commission, status: "applied" });
    await appendDeliveryEvent(tx, { deliveryId: input.deliveryId, eventType: "candidate_applied", status: "open", actorPhone: input.driverPhone, recipientPhone: delivery.senderPhone, title: "Nouvelle candidature", body: "Un livreur compatible s’est proposé pour votre livraison.", tone: "info", idempotencyKey: `${candidateId}:sender-applied` });
    await appendDeliveryEvent(tx, { deliveryId: input.deliveryId, eventType: "candidate_applied", status: "open", actorPhone: input.driverPhone, recipientPhone: input.driverPhone, title: "Candidature envoyée", body: `La commission de ${commission} FCFA est temporairement bloquée.`, tone: "warning", idempotencyKey: `${candidateId}:driver-applied` });
    return walletSnapshotFromRecord(await ensureTikisWallet(tx, input.driverPhone));
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
  delivery: TikisDelivery,
  action: "updated" | "disabled" | "cancelled",
  changedSummary?: string,
) {
  const candidates = await tx
    .select()
    .from(tikisDeliveryCandidates)
    .where(and(eq(tikisDeliveryCandidates.deliveryId, delivery.id), eq(tikisDeliveryCandidates.status, "applied")))
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
    await tx.update(tikisDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(tikisDeliveryCandidates.id, candidate.id));
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

export async function updateTikisDeliveryFromSender(input: SenderDeliveryUpdate) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisDeliveries).where(and(eq(tikisDeliveries.id, input.deliveryId), eq(tikisDeliveries.senderPhone, input.senderPhone))).limit(1).for("update"))[0];
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
    await tx.update(tikisDeliveries).set({
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
    }).where(eq(tikisDeliveries.id, input.deliveryId));
    await appendDeliveryEvent(tx, {
      deliveryId: input.deliveryId,
      eventType: "delivery_updated",
      status: "open",
      actorPhone: input.senderPhone,
      recipientPhone: input.senderPhone,
      title: "Livraison mise à jour",
      body: "Les informations de votre livraison ont été actualisées et elle est de nouveau disponible.",
      tone: "success",
      idempotencyKey: `${input.deliveryId}:updated:${delivery.updatedAt.getTime()}`,
    });
  });
  return getTikisDeliveryById(input.deliveryId);
}

export async function disableTikisDeliveryFromSender(deliveryId: string, senderPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisDeliveries).where(and(eq(tikisDeliveries.id, deliveryId), eq(tikisDeliveries.senderPhone, senderPhone))).limit(1).for("update"))[0];
    if (!delivery || delivery.status !== "open") throw new Error("Seule une livraison disponible peut être désactivée.");
    await releaseAppliedCandidatesForSenderAction(tx, delivery, "disabled");
    await tx.update(tikisDeliveries).set({ status: "disabled", updatedAt: new Date() }).where(eq(tikisDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_disabled", status: "disabled", actorPhone: senderPhone, recipientPhone: senderPhone, title: "Livraison désactivée", body: "Votre livraison n’est plus visible aux nouveaux livreurs.", tone: "warning", idempotencyKey: `${deliveryId}:disabled:${delivery.updatedAt.getTime()}` });
  });
  return getTikisDeliveryById(deliveryId);
}

export async function reactivateTikisDeliveryFromSender(deliveryId: string, senderPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisDeliveries).where(and(eq(tikisDeliveries.id, deliveryId), eq(tikisDeliveries.senderPhone, senderPhone))).limit(1).for("update"))[0];
    if (!delivery || delivery.status !== "disabled") throw new Error("Seule une livraison désactivée peut être activée.");
    await tx.update(tikisDeliveries).set({ status: "open", updatedAt: new Date() }).where(eq(tikisDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_reactivated", status: "open", actorPhone: senderPhone, recipientPhone: senderPhone, title: "Livraison activée", body: "Votre livraison est à nouveau visible pour les livreurs compatibles.", tone: "success", idempotencyKey: `${deliveryId}:reactivated:${delivery.updatedAt.getTime()}` });
  });
  return getTikisDeliveryById(deliveryId);
}

export async function cancelTikisDeliveryFromSender(deliveryId: string, senderPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisDeliveries).where(and(eq(tikisDeliveries.id, deliveryId), eq(tikisDeliveries.senderPhone, senderPhone))).limit(1).for("update"))[0];
    if (!delivery || !["open", "disabled", "pending_confirmation"].includes(delivery.status)) throw new Error("Cette livraison ne peut plus être annulée.");
    await releaseAppliedCandidatesForSenderAction(tx, delivery, "cancelled");
    if (delivery.status === "pending_confirmation" && delivery.driverPhone) {
      const selectedCandidate = (await tx.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.driverPhone, delivery.driverPhone), eq(tikisDeliveryCandidates.status, "selected"))).limit(1).for("update"))[0];
      if (selectedCandidate) {
        const legacyDebit = (await tx.select().from(tikisWalletLedger).where(eq(tikisWalletLedger.idempotencyKey, `${deliveryId}:commission-debit:${selectedCandidate.id}`)).limit(1))[0];
        if (legacyDebit) {
          await applyWalletMovement(tx, { profilePhone: delivery.driverPhone, deliveryId, operation: "compensation", amount: selectedCandidate.commissionBlocked, availableDelta: selectedCandidate.commissionBlocked, heldDelta: 0, reason: "Commission compensée après annulation de la livraison", idempotencyKey: `${deliveryId}:cancelled:compensation:${delivery.driverPhone}` });
        } else {
          await releaseCandidateCommission(tx, selectedCandidate, "Commission libérée après annulation de la livraison", "cancelled-release");
        }
        await tx.update(tikisDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(tikisDeliveryCandidates.id, selectedCandidate.id));
        await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_cancelled", status: "cancelled", actorPhone: senderPhone, recipientPhone: delivery.driverPhone, title: "Livraison annulée", body: "L’expéditeur a annulé la livraison avant votre départ. Votre commission Tikis a été libérée.", tone: "warning", idempotencyKey: `${deliveryId}:cancelled:selected-driver` });
      }
    }
    await tx.update(tikisDeliveries).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(tikisDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_cancelled", status: "cancelled", actorPhone: senderPhone, recipientPhone: senderPhone, title: "Livraison annulée", body: "Votre livraison est conservée dans l’historique avec son statut d’annulation.", tone: "warning", idempotencyKey: `${deliveryId}:cancelled:sender` });
  });
  return getTikisDeliveryById(deliveryId);
}

export async function withdrawTikisDeliveryCandidateWithWallet(deliveryId: string, driverPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les candidatures sont temporairement indisponibles.");
  const wallet = await db.transaction(async (tx) => {
    const candidates = await tx.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.driverPhone, driverPhone), eq(tikisDeliveryCandidates.status, "applied"))).limit(1).for("update");
    const candidate = candidates[0];
    if (!candidate) throw new Error("Cette candidature ne peut plus être retirée.");
    const delivery = (await tx.select().from(tikisDeliveries).where(eq(tikisDeliveries.id, deliveryId)).limit(1))[0];
    if (!delivery) throw new Error("Livraison introuvable.");
    await releaseCandidateCommission(tx, candidate, "Commission débloquée après retrait de candidature", `withdraw:${candidate.updatedAt.getTime()}`);
    await tx.update(tikisDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(tikisDeliveryCandidates.id, candidate.id));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "candidate_withdrawn", status: "open", actorPhone: driverPhone, recipientPhone: driverPhone, title: "Candidature retirée", body: "Votre commission bloquée a été immédiatement libérée.", tone: "success", idempotencyKey: `${candidate.id}:withdraw-driver` });
    await appendDeliveryEvent(tx, { deliveryId, eventType: "candidate_withdrawn", status: "open", actorPhone: driverPhone, recipientPhone: delivery.senderPhone, title: "Candidature retirée", body: "Un livreur a retiré sa candidature.", tone: "info", idempotencyKey: `${candidate.id}:withdraw-sender` });
    return walletSnapshotFromRecord(await ensureTikisWallet(tx, driverPhone));
  });
  return { success: true, wallet } as const;
}

export async function selectTikisDeliveryCandidateWithWallet(deliveryId: string, candidateId: string, senderPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisDeliveries).where(and(eq(tikisDeliveries.id, deliveryId), eq(tikisDeliveries.senderPhone, senderPhone))).limit(1).for("update"))[0];
    if (!delivery || !["open", "active", "pending_confirmation"].includes(delivery.status)) throw new Error("Cette livraison ne peut pas recevoir de sélection.");
    const chosen = (await tx.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.id, candidateId), eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.status, "applied"))).limit(1).for("update"))[0];
    if (!chosen) throw new Error("Cette candidature n’est plus sélectionnable.");
    const priorDriverPhone = delivery.driverPhone;
    const targetCommission = chosen.commissionBlocked;
    const appliedCandidates = await tx.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.status, "applied"))).for("update");
    for (const candidate of appliedCandidates) if (candidate.id !== chosen.id) {
      await releaseCandidateCommission(tx, candidate, "Commission débloquée après sélection d’un autre livreur", `release:${chosen.id}:${candidate.updatedAt.getTime()}`);
      await appendDeliveryEvent(tx, { deliveryId, eventType: "candidate_not_selected", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: candidate.driverPhone, title: "Livreur non retenu", body: "Un autre livreur a été sélectionné ; votre commission bloquée a été libérée.", tone: "info", idempotencyKey: `${candidate.id}:not-selected:${chosen.id}` });
    }
    if (priorDriverPhone && delivery.accruedCommission) {
      await applyWalletMovement(tx, { profilePhone: priorDriverPhone, deliveryId, operation: "compensation", amount: targetCommission, availableDelta: targetCommission, heldDelta: 0, reason: "Remboursement de commission après remplacement", idempotencyKey: `${deliveryId}:compensate:${priorDriverPhone}:${chosen.id}` });
      await tx.update(tikisDeliveryCandidates).set({ status: "replaced", updatedAt: new Date() }).where(and(eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.driverPhone, priorDriverPhone), eq(tikisDeliveryCandidates.status, "confirmed")));
      await appendDeliveryEvent(tx, { deliveryId, eventType: "driver_replaced", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: priorDriverPhone, title: "Vous avez été remplacé", body: "Votre commission Tikis a été intégralement compensée.", tone: "warning", idempotencyKey: `${deliveryId}:replaced:${priorDriverPhone}:${chosen.id}` });
    }
    await tx.update(tikisDeliveryCandidates).set({ status: "selected", commissionBlocked: targetCommission, updatedAt: new Date() }).where(eq(tikisDeliveryCandidates.id, chosen.id));
    await tx.update(tikisDeliveries).set({ status: "pending_confirmation", driverPhone: chosen.driverPhone, ...(priorDriverPhone ? { previousDriverPhone: priorDriverPhone } : {}), ...(chosen.offerPrice ? { offeredPrice: chosen.offerPrice } : {}), accruedCommission: targetCommission, selectedAt: new Date(), updatedAt: new Date() }).where(eq(tikisDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: priorDriverPhone ? "driver_replaced" : "driver_selected", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: senderPhone, title: priorDriverPhone ? "Livreur remplacé" : "Livreur sélectionné", body: "Aucun montant n’est demandé au Wallet de l’expéditeur. Le livreur doit confirmer sa disponibilité.", tone: "success", idempotencyKey: `${deliveryId}:sender-selected:${chosen.id}` });
    await appendDeliveryEvent(tx, { deliveryId, eventType: priorDriverPhone ? "driver_replaced" : "driver_selected", status: "pending_confirmation", actorPhone: senderPhone, recipientPhone: chosen.driverPhone, title: priorDriverPhone ? "Vous êtes le nouveau livreur" : "Vous avez été sélectionné", body: "Votre commission reste réservée et sera prélevée lorsque vous confirmerez votre disponibilité.", tone: "success", idempotencyKey: `${deliveryId}:driver-selected:${chosen.id}` });
  });
  return getTikisDeliveryById(deliveryId);
}

export async function confirmTikisDeliveryWithEvents(deliveryId: string, driverPhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  const wallet = await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisDeliveries).where(and(eq(tikisDeliveries.id, deliveryId), eq(tikisDeliveries.driverPhone, driverPhone), eq(tikisDeliveries.status, "pending_confirmation"))).limit(1).for("update"))[0];
    if (!delivery) throw new Error("Cette livraison ne peut pas être confirmée.");
    const candidate = (await tx.select().from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.driverPhone, driverPhone), eq(tikisDeliveryCandidates.status, "selected"))).limit(1).for("update"))[0];
    if (!candidate) throw new Error("Votre candidature ne peut pas être confirmée.");
    const commission = delivery.accruedCommission ?? candidate.commissionBlocked;
    if (commission > 0) {
      const wallet = await ensureTikisWallet(tx, driverPhone);
      const usesReservation = wallet.heldBalance >= commission;
      await applyWalletMovement(tx, {
        profilePhone: driverPhone,
        deliveryId,
        operation: "debit",
        amount: commission,
        availableDelta: usesReservation ? 0 : -commission,
        heldDelta: usesReservation ? -commission : 0,
        reason: "Commission Tikis prélevée après confirmation de disponibilité",
        idempotencyKey: `${deliveryId}:${usesReservation ? "commission-debit" : "commission-direct-debit"}:${candidate.id}`,
      });
    }
    await tx.update(tikisDeliveryCandidates).set({ status: "confirmed", updatedAt: new Date() }).where(eq(tikisDeliveryCandidates.id, candidate.id));
    await tx.update(tikisDeliveries).set({ status: "active", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(tikisDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_active", status: "active", actorPhone: driverPhone, recipientPhone: driverPhone, title: "Livraison activée", body: "Votre disponibilité est confirmée. Le suivi de la livraison est actif.", tone: "success", idempotencyKey: `${deliveryId}:active-driver` });
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_active", status: "active", actorPhone: driverPhone, recipientPhone: delivery.senderPhone, title: "Livreur en route", body: "Le livreur a confirmé sa disponibilité ; le suivi est maintenant actif.", tone: "success", idempotencyKey: `${deliveryId}:active-sender` });
    return walletSnapshotFromRecord(await ensureTikisWallet(tx, driverPhone));
  });
  return { delivery: await getTikisDeliveryById(deliveryId), wallet };
}

export async function completeTikisDeliveryWithEvents(deliveryId: string, profilePhone: string) {
  const db = await getDb();
  if (!db) throw new Error("Les livraisons sont temporairement indisponibles.");
  const wallet = await db.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisDeliveries).where(and(eq(tikisDeliveries.id, deliveryId), eq(tikisDeliveries.status, "active"), or(eq(tikisDeliveries.senderPhone, profilePhone), eq(tikisDeliveries.driverPhone, profilePhone)))).limit(1).for("update"))[0];
    if (!delivery || !delivery.driverPhone) throw new Error("Cette livraison ne peut pas être terminée.");
    const earning = Math.round(delivery.offeredPrice ?? delivery.estimatedPrice);
    await applyWalletMovement(tx, {
      profilePhone: delivery.driverPhone,
      deliveryId,
      operation: "credit",
      amount: earning,
      availableDelta: earning,
      heldDelta: 0,
      reason: "Gain de livraison crédité après confirmation de fin de course",
      idempotencyKey: `${deliveryId}:delivery-earning`,
    });
    await tx.update(tikisDeliveries).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(tikisDeliveries.id, deliveryId));
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_completed", status: "completed", actorPhone: profilePhone, recipientPhone: delivery.senderPhone, title: "Livraison terminée", body: "Votre livraison est terminée. Vous pouvez maintenant évaluer le livreur.", tone: "success", idempotencyKey: `${deliveryId}:completed-sender` });
    await appendDeliveryEvent(tx, { deliveryId, eventType: "delivery_completed", status: "completed", actorPhone: profilePhone, recipientPhone: delivery.driverPhone, title: "Course terminée", body: "La course est ajoutée à votre historique.", tone: "success", idempotencyKey: `${deliveryId}:completed-driver` });
    return walletSnapshotFromRecord(await ensureTikisWallet(tx, delivery.driverPhone));
  });
  return { delivery: await getTikisDeliveryById(deliveryId), wallet };
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

export async function listTikisDeliveryCandidateStatesForDriver(deliveryIds: string[], driverPhone: string) {
  const db = await getDb();
  if (!db || deliveryIds.length === 0) return new Map<string, TikisDeliveryCandidate>();
  const rows = await db.select().from(tikisDeliveryCandidates).where(and(inArray(tikisDeliveryCandidates.deliveryId, deliveryIds), eq(tikisDeliveryCandidates.driverPhone, driverPhone)));
  return new Map(rows.map((candidate) => [candidate.deliveryId, candidate]));
}

export async function countTikisDeliveryCandidates(deliveryIds: string[]) {
  const db = await getDb();
  if (!db || deliveryIds.length === 0) return new Map<string, number>();
  const rows = await db.select({ deliveryId: tikisDeliveryCandidates.deliveryId, total: count() }).from(tikisDeliveryCandidates).where(inArray(tikisDeliveryCandidates.deliveryId, deliveryIds)).groupBy(tikisDeliveryCandidates.deliveryId);
  return new Map(rows.map((row) => [row.deliveryId, Number(row.total)]));
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
