import { decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Core Manus user table kept for the template OAuth layer. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/**
 * Tikis phone-based profile. The phone number is unique and the account type
 * is intentionally immutable after first registration.
 */
export const tikisProfiles = mysqlTable("tikis_profiles", {
  id: int("id").autoincrement().primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  fullName: varchar("fullName", { length: 70 }).notNull(),
  accountType: mysqlEnum("accountType", ["sender", "driver"]).notNull(),
  vehicles: text("vehicles").notNull(),
  photoKey: varchar("photoKey", { length: 512 }),
  referralCode: varchar("referralCode", { length: 8 }).unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Canonical GPS-first place cache. Coordinates remain the source of truth for all geographic calculations. */
export const tikisPlaces = mysqlTable("tikis_places", {
  id: int("id").autoincrement().primaryKey(),
  googlePlaceId: varchar("googlePlaceId", { length: 255 }).unique(),
  mapboxPlaceId: varchar("mapboxPlaceId", { length: 255 }).unique(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  formattedAddress: varchar("formattedAddress", { length: 255 }).notNull(),
  placeName: varchar("placeName", { length: 140 }).notNull(),
  street: varchar("street", { length: 160 }),
  district: varchar("district", { length: 120 }),
  city: varchar("city", { length: 120 }),
  province: varchar("province", { length: 120 }),
  country: varchar("country", { length: 120 }),
  provider: varchar("provider", { length: 16 }).notNull().default("legacy"),
  source: varchar("source", { length: 16 }).notNull().default("legacy"),
  featureType: varchar("featureType", { length: 32 }).notNull().default("unknown"),
  precision: varchar("precision", { length: 16 }).notNull().default("unknown"),
  coordinateKey: varchar("coordinateKey", { length: 32 }).notNull().default("legacy"),
  resolvedAt: timestamp("resolvedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("tikis_places_coordinate_key_index").on(table.coordinateKey)]);

/** Sender-owned shortcuts to canonical places; natural labels make favourites recognisable in the form. */
export const tikisFavoritePlaces = mysqlTable("tikis_favorite_places", {
  id: int("id").autoincrement().primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  placeId: int("placeId").notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("tikis_favorite_places_profile_place_unique").on(table.profilePhone, table.placeId)]);

/** Delivery records are owned by a phone-verified Tikis profile and reference canonical GPS places. */
export const tikisDeliveries = mysqlTable("tikis_deliveries", {
  id: varchar("id", { length: 40 }).primaryKey(),
  senderPhone: varchar("senderPhone", { length: 20 }).notNull(),
  pickupPlaceId: int("pickupPlaceId").notNull(),
  dropoffPlaceId: int("dropoffPlaceId").notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  details: varchar("details", { length: 450 }).notNull(),
  deliveryType: mysqlEnum("deliveryType", ["Plis", "Personne", "Autre"]).notNull(),
  status: mysqlEnum("status", ["draft", "open", "pending_confirmation", "active", "completed", "disabled", "cancelled"]).notNull().default("open"),
  distanceKm: decimal("distanceKm", { precision: 10, scale: 2 }).notNull(),
  routeSource: mysqlEnum("routeSource", ["routes", "provisional"]).notNull().default("provisional"),
  estimatedPrice: int("estimatedPrice").notNull(),
  offeredPrice: int("offeredPrice"),
  accruedCommission: int("accruedCommission"),
  vehicleTypes: varchar("vehicleTypes", { length: 120 }).notNull(),
  weightKg: decimal("weightKg", { precision: 8, scale: 2 }),
  lengthCm: int("lengthCm"),
  widthCm: int("widthCm"),
  heightCm: int("heightCm"),
  passengers: int("passengers"),
  driverPhone: varchar("driverPhone", { length: 20 }),
  previousDriverPhone: varchar("previousDriverPhone", { length: 20 }),
  selectedAt: timestamp("selectedAt"),
  confirmedAt: timestamp("confirmedAt"),
  completedAt: timestamp("completedAt"),
  cancelledAt: timestamp("cancelledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("tikis_deliveries_sender_status_index").on(table.senderPhone, table.status),
  index("tikis_deliveries_driver_status_index").on(table.driverPhone, table.status),
  index("tikis_deliveries_status_created_index").on(table.status, table.createdAt),
]);

/** A driver can have one candidacy per delivery. Historical status is retained, never deleted. */
export const tikisDeliveryCandidates = mysqlTable("tikis_delivery_candidates", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  offerPrice: int("offerPrice"),
  status: mysqlEnum("status", ["applied", "selected", "confirmed", "withdrawn", "replaced"]).notNull().default("applied"),
  commissionBlocked: int("commissionBlocked").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("tikis_delivery_candidates_delivery_driver_unique").on(table.deliveryId, table.driverPhone),
  index("tikis_delivery_candidates_delivery_status_index").on(table.deliveryId, table.status),
  index("tikis_delivery_candidates_driver_status_index").on(table.driverPhone, table.status),
]);

/** Sender reviews are retained with the completed delivery and may be submitted once. */
export const tikisDeliveryReviews = mysqlTable("tikis_delivery_reviews", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  reviewerPhone: varchar("reviewerPhone", { length: 20 }).notNull(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  rating: int("rating").notNull(),
  comment: varchar("comment", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tikis_delivery_reviews_delivery_reviewer_unique").on(table.deliveryId, table.reviewerPhone),
  index("tikis_delivery_reviews_driver_index").on(table.driverPhone),
]);

/** One Wallet per Tikis profile. Amounts are stored in XOF minor units (whole FCFA). */
export const tikisWallets = mysqlTable("tikis_wallets", {
  id: int("id").autoincrement().primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull().unique(),
  availableBalance: int("availableBalance").notNull().default(0),
  heldBalance: int("heldBalance").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("XOF"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Singleton administration setting read by all commission calculations on the server. */
export const tikisPlatformSettings = mysqlTable("tikis_platform_settings", {
  id: int("id").primaryKey(),
  commissionRate: decimal("commissionRate", { precision: 6, scale: 5 }).notNull().default("0.10000"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Immutable financial ledger. An idempotency key prevents duplicate movements under retries. */
export const tikisWalletLedger = mysqlTable("tikis_wallet_ledger", {
  id: varchar("id", { length: 40 }).primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  deliveryId: varchar("deliveryId", { length: 40 }),
  operation: mysqlEnum("operation", ["block", "unblock", "debit", "compensation", "credit", "refund", "deposit_request", "withdrawal_request"]).notNull(),
  amount: int("amount").notNull(),
  availableBefore: int("availableBefore").notNull(),
  availableAfter: int("availableAfter").notNull(),
  heldBefore: int("heldBefore").notNull(),
  heldAfter: int("heldAfter").notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 100 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("tikis_wallet_ledger_profile_created_index").on(table.profilePhone, table.createdAt),
  index("tikis_wallet_ledger_delivery_index").on(table.deliveryId),
]);

/** Durable, recipient-scoped activity stream used by the in-app and realtime notification layers. */
export const tikisDeliveryEvents = mysqlTable("tikis_delivery_events", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  eventType: varchar("eventType", { length: 48 }).notNull(),
  status: mysqlEnum("status", ["draft", "open", "pending_confirmation", "active", "completed", "disabled", "cancelled"]),
  actorPhone: varchar("actorPhone", { length: 20 }),
  recipientPhone: varchar("recipientPhone", { length: 20 }).notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  body: varchar("body", { length: 300 }).notNull(),
  tone: mysqlEnum("tone", ["info", "success", "warning"]).notNull().default("info"),
  metadata: text("metadata"),
  idempotencyKey: varchar("idempotencyKey", { length: 100 }).notNull().unique(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("tikis_delivery_events_recipient_created_index").on(table.recipientPhone, table.createdAt),
  index("tikis_delivery_events_delivery_created_index").on(table.deliveryId, table.createdAt),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type TikisProfile = typeof tikisProfiles.$inferSelect;
export type InsertTikisProfile = typeof tikisProfiles.$inferInsert;
export type TikisPlace = typeof tikisPlaces.$inferSelect;
export type InsertTikisPlace = typeof tikisPlaces.$inferInsert;
export type TikisFavoritePlace = typeof tikisFavoritePlaces.$inferSelect;
export type TikisDelivery = typeof tikisDeliveries.$inferSelect;
export type InsertTikisDelivery = typeof tikisDeliveries.$inferInsert;
export type TikisDeliveryCandidate = typeof tikisDeliveryCandidates.$inferSelect;
export type TikisDeliveryReview = typeof tikisDeliveryReviews.$inferSelect;
export type TikisWallet = typeof tikisWallets.$inferSelect;
export type TikisPlatformSettings = typeof tikisPlatformSettings.$inferSelect;
export type TikisWalletLedger = typeof tikisWalletLedger.$inferSelect;
export type TikisDeliveryEvent = typeof tikisDeliveryEvents.$inferSelect;
