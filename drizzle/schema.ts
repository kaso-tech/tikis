import { boolean, decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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
  email: varchar("email", { length: 320 }),
  phoneVerified: boolean("phoneVerified").notNull().default(true),
  emailVerified: boolean("emailVerified").notNull().default(false),
  referralCode: varchar("referralCode", { length: 8 }).unique(),
  supabaseUserId: varchar("supabaseUserId", { length: 64 }).unique(),
  status: mysqlEnum("status", ["active", "suspended", "banned"]).notNull().default("active"),
  statusReason: varchar("statusReason", { length: 500 }),
  statusUpdatedAt: timestamp("statusUpdatedAt"),
  statusUpdatedByAdminId: int("statusUpdatedByAdminId"),
  country: varchar("country", { length: 2 }),
  city: varchar("city", { length: 80 }),
  deletionRequestedAt: timestamp("deletionRequestedAt"),
  deletionScheduledAt: timestamp("deletionScheduledAt"),
  deletedAt: timestamp("deletedAt"),
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
}, (table) => [
  index("tikis_places_coordinate_key_index").on(table.coordinateKey),
  index("tikis_places_coordinates_index").on(table.latitude, table.longitude),
]);

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
  status: mysqlEnum("status", ["draft", "open", "pending_confirmation", "active", "completed", "disabled", "cancelled", "expired"]).notNull().default("open"),
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

/** Latest foreground GPS position published by the driver assigned to an active delivery. */
export const tikisDeliveryLiveLocations = mysqlTable("tikis_delivery_live_locations", {
  deliveryId: varchar("deliveryId", { length: 40 }).primaryKey(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  heading: decimal("heading", { precision: 6, scale: 2 }).notNull().default("0"),
  recordedAt: timestamp("recordedAt").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("tikis_delivery_live_locations_driver_index").on(table.driverPhone, table.updatedAt)]);

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
  referralRewardAmount: int("referralRewardAmount").notNull().default(1000),
  referralEnabled: boolean("referralEnabled").notNull().default(true),
  referralRequiredDeliveries: int("referralRequiredDeliveries").notNull().default(1),
  minWithdrawal: int("minWithdrawal").notNull().default(500),
  maxWithdrawal: int("maxWithdrawal").notNull().default(500000),
  pricingConfig: text("pricingConfig"),
  maintenanceEnabled: boolean("maintenanceEnabled").notNull().default(false),
  maintenanceMessage: varchar("maintenanceMessage", { length: 500 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Immutable financial ledger. An idempotency key prevents duplicate movements under retries. */
export const tikisWalletLedger = mysqlTable("tikis_wallet_ledger", {
  id: varchar("id", { length: 40 }).primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  deliveryId: varchar("deliveryId", { length: 40 }),
  operation: mysqlEnum("operation", ["block", "unblock", "debit", "commission_debit", "compensation", "credit", "refund", "deposit_request", "withdrawal_request", "bonus", "penalty"]).notNull(),
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

/** Payment request lifecycle; balance movements are written only once the provider outcome is confirmed. */
export const tikisPaymentTransactions = mysqlTable("tikis_payment_transactions", {
  id: varchar("id", { length: 40 }).primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  type: mysqlEnum("type", ["deposit", "withdrawal"]).notNull(),
  provider: mysqlEnum("provider", ["ligdi_simulated", "yengapay_test", "yengapay_live"]).notNull().default("yengapay_test"),
  amount: int("amount").notNull(),
  status: mysqlEnum("status", ["pending", "succeeded", "failed", "cancelled"]).notNull().default("pending"),
  providerReference: varchar("providerReference", { length: 80 }).notNull().unique(),
  idempotencyKey: varchar("idempotencyKey", { length: 100 }).notNull().unique(),
  settledAt: timestamp("settledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("tikis_payment_transactions_profile_created_index").on(table.profilePhone, table.createdAt),
  index("tikis_payment_transactions_status_index").on(table.status, table.createdAt),
]);

/** Durable, recipient-scoped activity stream used by the in-app and realtime notification layers. */
export const tikisDeliveryEvents = mysqlTable("tikis_delivery_events", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  eventType: varchar("eventType", { length: 48 }).notNull(),
  status: mysqlEnum("status", ["draft", "open", "pending_confirmation", "active", "completed", "disabled", "cancelled", "expired"]),
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

/** Signalements (CAS N°9) : envoyés par le Sender ou le Livreur à l'administration. */
export const tikisDeliveryReports = mysqlTable("tikis_delivery_reports", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  reporterPhone: varchar("reporterPhone", { length: 20 }).notNull(),
  reporterRole: mysqlEnum("reporterRole", ["sender", "driver"]).notNull(),
  reason: varchar("reason", { length: 80 }).notNull(),
  description: varchar("description", { length: 1000 }).notNull(),
  attachmentKey: varchar("attachmentKey", { length: 255 }),
  status: mysqlEnum("status", ["open", "reviewing", "resolved", "dismissed"]).notNull().default("open"),
  resolutionNotes: varchar("resolutionNotes", { length: 1000 }),
  resolvedByAdminId: int("resolvedByAdminId"),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("tikis_delivery_reports_status_created_index").on(table.status, table.createdAt),
  index("tikis_delivery_reports_delivery_index").on(table.deliveryId),
  index("tikis_delivery_reports_reporter_index").on(table.reporterPhone),
]);

/** Comptes d'administration Tikis, totalement distincts de l'authentification des Senders/Livreurs. */
export const tikisAdminUsers = mysqlTable("tikis_admin_users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 180 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  fullName: varchar("fullName", { length: 120 }).notNull(),
  role: mysqlEnum("role", ["super_admin", "support", "finance"]).notNull().default("support"),
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("lastLoginAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Journal d'audit immuable de toute action d'administration (CAS N°10 — décisions tracées). */
export const tikisAdminAuditLog = mysqlTable("tikis_admin_audit_log", {
  id: varchar("id", { length: 40 }).primaryKey(),
  adminId: int("adminId").notNull(),
  adminEmail: varchar("adminEmail", { length: 180 }).notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  targetType: varchar("targetType", { length: 40 }).notNull(),
  targetId: varchar("targetId", { length: 80 }).notNull(),
  details: text("details"),
  ipAddress: varchar("ipAddress", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("tikis_admin_audit_log_target_index").on(table.targetType, table.targetId),
  index("tikis_admin_audit_log_admin_created_index").on(table.adminId, table.createdAt),
]);

export type TikisDeliveryReport = typeof tikisDeliveryReports.$inferSelect;
export type TikisAdminUser = typeof tikisAdminUsers.$inferSelect;
export type TikisAdminAuditLog = typeof tikisAdminAuditLog.$inferSelect;

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
/** Parrainage : un enregistrement par filleul, créé à l'inscription si un code de parrain est fourni. */
export const tikisReferrals = mysqlTable("tikis_referrals", {
  id: varchar("id", { length: 40 }).primaryKey(),
  referrerPhone: varchar("referrerPhone", { length: 20 }).notNull(),
  refereePhone: varchar("refereePhone", { length: 20 }).notNull().unique(),
  referralCode: varchar("referralCode", { length: 8 }).notNull(),
  status: mysqlEnum("status", ["invited", "qualified", "rewarded", "voided"]).notNull().default("invited"),
  rewardAmount: int("rewardAmount").notNull(),
  qualifyingDeliveryId: varchar("qualifyingDeliveryId", { length: 40 }),
  qualifiedAt: timestamp("qualifiedAt"),
  rewardedAt: timestamp("rewardedAt"),
  rewardedByAdminId: int("rewardedByAdminId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("tikis_referrals_referrer_index").on(table.referrerPhone, table.createdAt),
  index("tikis_referrals_status_index").on(table.status),
]);

/** Pays actifs sur la plateforme (inscription, format de téléphone, filtrage géographique). */
export const tikisSupportedCountries = mysqlTable("tikis_supported_countries", {
  id: varchar("id", { length: 2 }).primaryKey(), // code ISO, ex. "BF"
  name: varchar("name", { length: 80 }).notNull(),
  dialCode: varchar("dialCode", { length: 6 }).notNull(),
  digits: int("digits").notNull(),
  groups: varchar("groups", { length: 40 }).notNull(), // ex. "2,2,2,2"
  timeZones: varchar("timeZones", { length: 200 }).notNull(), // séparés par virgule
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: int("sortOrder").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TikisProfile = typeof tikisProfiles.$inferSelect;
export type InsertTikisProfile = typeof tikisProfiles.$inferInsert;
export type TikisPlace = typeof tikisPlaces.$inferSelect;
export type InsertTikisPlace = typeof tikisPlaces.$inferInsert;
export type TikisFavoritePlace = typeof tikisFavoritePlaces.$inferSelect;
export type TikisDelivery = typeof tikisDeliveries.$inferSelect;
export type InsertTikisDelivery = typeof tikisDeliveries.$inferInsert;
export type TikisDeliveryLiveLocation = typeof tikisDeliveryLiveLocations.$inferSelect;
export type TikisDeliveryCandidate = typeof tikisDeliveryCandidates.$inferSelect;
export type TikisDeliveryReview = typeof tikisDeliveryReviews.$inferSelect;
export type TikisWallet = typeof tikisWallets.$inferSelect;
export type TikisPlatformSettings = typeof tikisPlatformSettings.$inferSelect;
export type TikisWalletLedger = typeof tikisWalletLedger.$inferSelect;
export type TikisPaymentTransaction = typeof tikisPaymentTransactions.$inferSelect;
export type TikisDeliveryEvent = typeof tikisDeliveryEvents.$inferSelect;
export type TikisReferral = typeof tikisReferrals.$inferSelect;
/** Vérification d'identité (KYC) des livreurs : documents envoyés, examinés par l'administration. */
export const tikisKycSubmissions = mysqlTable("tikis_kyc_submissions", {
  id: varchar("id", { length: 40 }).primaryKey(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  idFrontKey: varchar("idFrontKey", { length: 255 }).notNull(),
  idBackKey: varchar("idBackKey", { length: 255 }).notNull(),
  selfieKey: varchar("selfieKey", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["submitted", "approved", "rejected"]).notNull().default("submitted"),
  rejectionReason: varchar("rejectionReason", { length: 500 }),
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
  reviewedByAdminId: int("reviewedByAdminId"),
}, (table) => [
  index("tikis_kyc_submissions_driver_index").on(table.driverPhone, table.submittedAt),
  index("tikis_kyc_submissions_status_index").on(table.status),
]);

export type TikisSupportedCountry = typeof tikisSupportedCountries.$inferSelect;
export type TikisKycSubmission = typeof tikisKycSubmissions.$inferSelect;

/** Événements webhook YengaPay : log immutable des callbacks reçus.
 *  Idempotence garantie par la contrainte unique sur (provider, providerEventId). */
export const tikisYengapayWebhookEvents = mysqlTable("tikis_yengapay_webhook_events", {
  id: varchar("id", { length: 40 }).primaryKey(),
  provider: mysqlEnum("provider", ["yengapay_live"]).notNull().default("yengapay_live"),
  providerEventId: varchar("providerEventId", { length: 120 }).notNull(),
  eventType: varchar("eventType", { length: 60 }).notNull(),
  paymentTransactionId: varchar("paymentTransactionId", { length: 40 }),
  payload: text("payload").notNull(),
  signature: varchar("signature", { length: 200 }),
  processedAt: timestamp("processedAt"),
  status: mysqlEnum("status", ["received", "processed", "failed", "ignored"]).notNull().default("received"),
  failureReason: varchar("failureReason", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tikis_yengapay_webhook_events_provider_event_unique").on(table.provider, table.providerEventId),
  index("tikis_yengapay_webhook_events_status_index").on(table.status, table.createdAt),
  index("tikis_yengapay_webhook_events_payment_index").on(table.paymentTransactionId),
]);

export type TikisYengapayWebhookEvent = typeof tikisYengapayWebhookEvents.$inferSelect;

/** Push tokens Expo pour les notifications device-to-device.
 *  Un profil peut avoir plusieurs tokens (plusieurs devices ou plusieurs installs). */
export const tikisPushTokens = mysqlTable("tikis_push_tokens", {
  id: varchar("id", { length: 40 }).primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  token: varchar("token", { length: 200 }).notNull(),
  platform: mysqlEnum("platform", ["ios", "android", "web"]).notNull().default("android"),
  appVersion: varchar("appVersion", { length: 40 }),
  deviceName: varchar("deviceName", { length: 120 }),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tikis_push_tokens_phone_token_unique").on(table.phone, table.token),
  index("tikis_push_tokens_phone_index").on(table.phone),
  index("tikis_push_tokens_last_seen_index").on(table.lastSeenAt),
]);

export type TikisPushToken = typeof tikisPushTokens.$inferSelect;

/** Programme de fidélité : règles métier (seuil livraisons, montant bonus, palier). */
export const tikisLoyaltyPrograms = mysqlTable("tikis_loyalty_programs", {
  id: varchar("id", { length: 40 }).primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  description: varchar("description", { length: 300 }),
  role: mysqlEnum("role", ["sender", "driver"]).notNull(),
  /** Nombre de livraisons terminées requis pour déclencher la récompense. */
  requiredDeliveries: int("requiredDeliveries").notNull(),
  /** Montant du bonus crédité sur le wallet (FCFA). */
  bonusAmount: int("bonusAmount").notNull(),
  /** Plage de validité : la course doit avoir été terminée dans cette fenêtre. */
  windowDays: int("windowDays").notNull().default(90),
  /** Si true, les bonus <= autoCreditMaxAmount sont crédités automatiquement.
   *  Sinon, ils restent en 'pending' et nécessitent une validation admin. */
  autoCredit: boolean("autoCredit").notNull().default(false),
  /** Plafond (FCFA) pour le crédit automatique. 0 = illimité (mais contrôlé par le booléen). */
  autoCreditMaxAmount: int("autoCreditMaxAmount").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("tikis_loyalty_programs_role_index").on(table.role, table.enabled),
]);

/** Octroi de bonus lié à un programme. Idempotent via (programId, deliveryId). */
export const tikisLoyaltyGrants = mysqlTable("tikis_loyalty_grants", {
  id: varchar("id", { length: 40 }).primaryKey(),
  programId: varchar("programId", { length: 40 }).notNull(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  deliveryId: varchar("deliveryId", { length: 40 }),
  bonusAmount: int("bonusAmount").notNull(),
  status: mysqlEnum("status", ["pending", "credited", "cancelled"]).notNull().default("pending"),
  ledgerEntryId: varchar("ledgerEntryId", { length: 40 }),
  grantedAt: timestamp("grantedAt").defaultNow().notNull(),
  creditedAt: timestamp("creditedAt"),
  expiresAt: timestamp("expiresAt"),
  cancelledReason: varchar("cancelledReason", { length: 300 }),
}, (table) => [
  uniqueIndex("tikis_loyalty_grants_program_delivery_unique").on(table.programId, table.deliveryId),
  index("tikis_loyalty_grants_profile_index").on(table.profilePhone, table.grantedAt),
  index("tikis_loyalty_grants_status_index").on(table.status),
  index("tikis_loyalty_grants_expires_index").on(table.expiresAt),
]);

export type TikisLoyaltyProgram = typeof tikisLoyaltyPrograms.$inferSelect;
export type TikisLoyaltyGrant = typeof tikisLoyaltyGrants.$inferSelect;

/** Sessions actives multi-device : permet la révocation granulaire.
 *  Le token JWT complet n'est jamais stocké (security) : on garde son hash SHA-256
 *  et les 4 derniers caractères pour affichage. */
export const tikisProfileSessions = mysqlTable("tikis_profile_sessions", {
  id: varchar("id", { length: 40 }).primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
  tokenLast4: varchar("tokenLast4", { length: 4 }).notNull(),
  deviceName: varchar("deviceName", { length: 120 }),
  platform: mysqlEnum("platform", ["ios", "android", "web", "unknown"]).notNull().default("unknown"),
  appVersion: varchar("appVersion", { length: 40 }),
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  revokedAt: timestamp("revokedAt"),
}, (table) => [
  index("tikis_profile_sessions_phone_index").on(table.phone, table.lastSeenAt),
  uniqueIndex("tikis_profile_sessions_phone_token_unique").on(table.phone, table.tokenHash),
]);

export type TikisProfileSession = typeof tikisProfileSessions.$inferSelect;

/** Métriques business quotidiennes — alimentées par le cron /api/scheduled/compute-daily-metrics.
 *  Permet au DashboardPage d'afficher des tendances (GMV semaine dernière, etc.) sans
 *  ré-agréger toute la table tikis_deliveries. */
export const tikisDailyMetrics = mysqlTable("tikis_daily_metrics", {
  date: varchar("date", { length: 10 }).primaryKey(), // "YYYY-MM-DD"
  deliveriesCreated: int("deliveriesCreated").notNull().default(0),
  deliveriesCompleted: int("deliveriesCompleted").notNull().default(0),
  deliveriesCancelled: int("deliveriesCancelled").notNull().default(0),
  gmvTotal: int("gmvTotal").notNull().default(0), // montant total facturé (FCFA)
  commissionTotal: int("commissionTotal").notNull().default(0), // commission Tikis
  newDrivers: int("newDrivers").notNull().default(0),
  newSenders: int("newSenders").notNull().default(0),
  activeDrivers: int("activeDrivers").notNull().default(0),
  activeSenders: int("activeSenders").notNull().default(0),
  bonusAwarded: int("bonusAwarded").notNull().default(0),
  reportsOpened: int("reportsOpened").notNull().default(0),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
}, (table) => [
  index("tikis_daily_metrics_date_index").on(table.date),
]);

export type TikisDailyMetric = typeof tikisDailyMetrics.$inferSelect;
