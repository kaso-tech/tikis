import { bigint, boolean, decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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
 * Tikisse phone-based profile. The phone number is unique and the account type
 * is intentionally immutable after first registration.
 */
export const tikisseProfiles = mysqlTable("tikisse_profiles", {
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
  /** Déconnexion forcée par l'équipe : tout jeton de session émis avant cette date est refusé. */
  sessionsRevokedAt: timestamp("sessionsRevokedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Canonical GPS-first place cache. Coordinates remain the source of truth for all geographic calculations. */
export const tikissePlaces = mysqlTable("tikisse_places", {
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
  index("tikisse_places_coordinate_key_index").on(table.coordinateKey),
  index("tikisse_places_coordinates_index").on(table.latitude, table.longitude),
]);

/** Sender-owned shortcuts to canonical places; natural labels make favourites recognisable in the form. */
export const tikisseFavoritePlaces = mysqlTable("tikisse_favorite_places", {
  id: int("id").autoincrement().primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  placeId: int("placeId").notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("tikisse_favorite_places_profile_place_unique").on(table.profilePhone, table.placeId)]);

/** Delivery records are owned by a phone-verified Tikisse profile and reference canonical GPS places. */
export const tikisseDeliveries = mysqlTable("tikisse_deliveries", {
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
  index("tikisse_deliveries_sender_status_index").on(table.senderPhone, table.status),
  index("tikisse_deliveries_driver_status_index").on(table.driverPhone, table.status),
  index("tikisse_deliveries_status_created_index").on(table.status, table.createdAt),
]);

/** Latest foreground GPS position published by the driver assigned to an active delivery. */
export const tikisseDeliveryLiveLocations = mysqlTable("tikisse_delivery_live_locations", {
  deliveryId: varchar("deliveryId", { length: 40 }).primaryKey(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  heading: decimal("heading", { precision: 6, scale: 2 }).notNull().default("0"),
  recordedAt: timestamp("recordedAt").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("tikisse_delivery_live_locations_driver_index").on(table.driverPhone, table.updatedAt)]);

/** A driver can have one candidacy per delivery. Historical status is retained, never deleted. */
export const tikisseDeliveryCandidates = mysqlTable("tikisse_delivery_candidates", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  offerPrice: int("offerPrice"),
  status: mysqlEnum("status", ["applied", "selected", "confirmed", "withdrawn", "replaced"]).notNull().default("applied"),
  commissionBlocked: int("commissionBlocked").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("tikisse_delivery_candidates_delivery_driver_unique").on(table.deliveryId, table.driverPhone),
  index("tikisse_delivery_candidates_delivery_status_index").on(table.deliveryId, table.status),
  index("tikisse_delivery_candidates_driver_status_index").on(table.driverPhone, table.status),
]);

/** Sender reviews are retained with the completed delivery and may be submitted once. */
export const tikisseDeliveryReviews = mysqlTable("tikisse_delivery_reviews", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  reviewerPhone: varchar("reviewerPhone", { length: 20 }).notNull(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  rating: int("rating").notNull(),
  comment: varchar("comment", { length: 500 }),
  /** Avis masqué par la modération : il ne s'affiche plus et ne compte plus dans la note du livreur. */
  hiddenAt: timestamp("hiddenAt"),
  hiddenReason: varchar("hiddenReason", { length: 300 }),
  hiddenByAdminId: int("hiddenByAdminId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tikisse_delivery_reviews_delivery_reviewer_unique").on(table.deliveryId, table.reviewerPhone),
  index("tikisse_delivery_reviews_driver_index").on(table.driverPhone),
]);

/** One Wallet per Tikisse profile. Amounts are stored in XOF minor units (whole FCFA). */
export const tikisseWallets = mysqlTable("tikisse_wallets", {
  id: int("id").autoincrement().primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull().unique(),
  availableBalance: int("availableBalance").notNull().default(0),
  heldBalance: int("heldBalance").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("XOF"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Singleton administration setting read by all commission calculations on the server. */
export const tikissePlatformSettings = mysqlTable("tikisse_platform_settings", {
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
  /** Double authentification exigée pour les rôles super_admin et finance. */
  adminTotpRequired: boolean("adminTotpRequired").notNull().default(false),
  /** Montant (FCFA) à partir duquel un bonus, une pénalité ou un retrait attend la validation d'un second admin. */
  adminApprovalThreshold: int("adminApprovalThreshold").notNull().default(100000),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Immutable financial ledger. An idempotency key prevents duplicate movements under retries. */
export const tikisseWalletLedger = mysqlTable("tikisse_wallet_ledger", {
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
  index("tikisse_wallet_ledger_profile_created_index").on(table.profilePhone, table.createdAt),
  index("tikisse_wallet_ledger_delivery_index").on(table.deliveryId),
]);

/** Payment request lifecycle; balance movements are written only once the provider outcome is confirmed. */
export const tikissePaymentTransactions = mysqlTable("tikisse_payment_transactions", {
  id: varchar("id", { length: 40 }).primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  type: mysqlEnum("type", ["deposit", "withdrawal"]).notNull(),
  provider: mysqlEnum("provider", ["ligdi_simulated", "yengapay_test", "yengapay_sandbox", "yengapay_live", "yengapay_direct_test", "yengapay_direct_sandbox", "yengapay_direct_live", "manual_payout"]).notNull().default("yengapay_test"),
  amount: int("amount").notNull(),
  status: mysqlEnum("status", ["pending", "succeeded", "failed", "cancelled", "expired"]).notNull().default("pending"),
  providerReference: varchar("providerReference", { length: 80 }).notNull().unique(),
  checkoutUrl: varchar("checkoutUrl", { length: 1000 }),
  ussdCode: varchar("ussdCode", { length: 64 }),
  phoneE164: varchar("phoneE164", { length: 24 }),
  operatorCode: varchar("operatorCode", { length: 16 }),
  countryCode: varchar("countryCode", { length: 4 }),
  expiresAt: timestamp("expiresAt"),
  idempotencyKey: varchar("idempotencyKey", { length: 100 }).notNull().unique(),
  settledAt: timestamp("settledAt"),
  /** Référence du versement Mobile Money fait hors application, exigée pour valider un retrait à la main.
   *  Unique : une même preuve de versement ne peut justifier deux retraits. */
  payoutReference: varchar("payoutReference", { length: 80 }).unique(),
  /** Note laissée par l'admin qui a tranché la transaction à la main. */
  adminNotes: varchar("adminNotes", { length: 300 }),
  settledByAdminId: int("settledByAdminId"),
  /** Montant annoncé par YengaPay à la confirmation. Un écart avec `amount` est listé dans la console. */
  providerReportedAmount: int("providerReportedAmount"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("tikisse_payment_transactions_profile_created_index").on(table.profilePhone, table.createdAt),
  index("tikisse_payment_transactions_status_index").on(table.status, table.createdAt),
  index("tikisse_payment_transactions_operator_status_index").on(table.operatorCode, table.status, table.createdAt),
]);

/** Durable, recipient-scoped activity stream used by the in-app and realtime notification layers. */
export const tikisseDeliveryEvents = mysqlTable("tikisse_delivery_events", {
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
  index("tikisse_delivery_events_recipient_created_index").on(table.recipientPhone, table.createdAt),
  index("tikisse_delivery_events_delivery_created_index").on(table.deliveryId, table.createdAt),
]);

/** Signalements (CAS N°9) : envoyés par le Sender ou le Livreur à l'administration. */
export const tikisseDeliveryReports = mysqlTable("tikisse_delivery_reports", {
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
  index("tikisse_delivery_reports_status_created_index").on(table.status, table.createdAt),
  index("tikisse_delivery_reports_delivery_index").on(table.deliveryId),
  index("tikisse_delivery_reports_reporter_index").on(table.reporterPhone),
]);

/** Comptes d'administration Tikisse, totalement distincts de l'authentification des Senders/Livreurs. */
export const tikisseAdminUsers = mysqlTable("tikisse_admin_users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 180 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  fullName: varchar("fullName", { length: 120 }).notNull(),
  /** Voir shared/admin-roles.ts : `viewer` lit sans rien modifier, `kyc_reviewer` ne voit que les vérifications d'identité. */
  role: mysqlEnum("role", ["super_admin", "support", "finance", "viewer", "kyc_reviewer"]).notNull().default("support"),
  active: boolean("active").notNull().default(true),
  /** Mot de passe provisoire (compte créé ou réinitialisé depuis la console) : à changer avant tout accès. */
  mustChangePassword: boolean("mustChangePassword").notNull().default(false),
  /** Double authentification (server/admin-totp.ts). Secret chiffré AES-256-GCM, jamais en clair. */
  totpSecret: varchar("totpSecret", { length: 255 }),
  /** Secret proposé à l'enrôlement, pas encore confirmé par un premier code. */
  totpPendingSecret: varchar("totpPendingSecret", { length: 255 }),
  totpEnabledAt: timestamp("totpEnabledAt"),
  /** Dernier pas TOTP accepté : un code ne sert qu'une fois. */
  totpLastUsedStep: bigint("totpLastUsedStep", { mode: "number" }),
  /** Empreintes SHA-256 (JSON) des codes de secours restants. */
  totpRecoveryCodes: text("totpRecoveryCodes"),
  lastLoginAt: timestamp("lastLoginAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Sessions de la console d'administration. Le navigateur ne détient qu'un jeton aléatoire opaque, dans un
 * cookie httpOnly ; la base n'en garde que l'empreinte SHA-256. Une session se révoque à la déconnexion,
 * à la suspension du compte, ou expire au bout de 8 h.
 */
export const tikisseAdminSessions = mysqlTable("tikisse_admin_sessions", {
  id: varchar("id", { length: 40 }).primaryKey(),
  adminId: int("adminId").notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  ipAddress: varchar("ipAddress", { length: 64 }),
  userAgent: varchar("userAgent", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  revokedAt: timestamp("revokedAt"),
  /** `pending_totp` : mot de passe vérifié, code de double authentification attendu (5 min au plus). */
  stage: mysqlEnum("stage", ["pending_totp", "active"]).notNull().default("active"),
}, (table) => [
  index("tikisse_admin_sessions_admin_index").on(table.adminId, table.revokedAt),
]);

/**
 * Double validation : un bonus, une pénalité ou un retrait au-delà du seuil n'est pas exécuté par l'admin qui
 * le demande, mais mis en attente jusqu'à ce qu'un autre admin le valide (server/admin-approvals.ts).
 */
export const tikisseAdminApprovals = mysqlTable("tikisse_admin_approvals", {
  id: varchar("id", { length: 40 }).primaryKey(),
  action: mysqlEnum("action", ["wallet_bonus", "wallet_penalty", "withdrawal_settle", "delivery_refund"]).notNull(),
  amount: int("amount").notNull(),
  targetPhone: varchar("targetPhone", { length: 20 }).notNull(),
  /** Ce que la demande vise précisément (transaction de retrait, identifiant d'opération) : une seule demande en attente par cible. */
  targetRef: varchar("targetRef", { length: 80 }).notNull(),
  payload: text("payload").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "executed", "failed", "rejected", "cancelled"]).notNull().default("pending"),
  requestedByAdminId: int("requestedByAdminId").notNull(),
  requestedByEmail: varchar("requestedByEmail", { length: 180 }).notNull(),
  decidedByAdminId: int("decidedByAdminId"),
  decidedByEmail: varchar("decidedByEmail", { length: 180 }),
  decisionNote: varchar("decisionNote", { length: 300 }),
  failureReason: varchar("failureReason", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  decidedAt: timestamp("decidedAt"),
}, (table) => [
  index("tikisse_admin_approvals_status_index").on(table.status, table.createdAt),
  index("tikisse_admin_approvals_target_index").on(table.targetRef, table.status),
]);

/** Journal d'audit immuable de toute action d'administration (CAS N°10 — décisions tracées). */
export const tikisseAdminAuditLog = mysqlTable("tikisse_admin_audit_log", {
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
  index("tikisse_admin_audit_log_target_index").on(table.targetType, table.targetId),
  index("tikisse_admin_audit_log_admin_created_index").on(table.adminId, table.createdAt),
]);

export type TikisseDeliveryReport = typeof tikisseDeliveryReports.$inferSelect;
export type TikisseAdminUser = typeof tikisseAdminUsers.$inferSelect;
export type TikisseAdminSession = typeof tikisseAdminSessions.$inferSelect;
export type TikisseAdminApproval = typeof tikisseAdminApprovals.$inferSelect;
export type TikisseAdminAuditLog = typeof tikisseAdminAuditLog.$inferSelect;

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
/** Parrainage : un enregistrement par filleul, créé à l'inscription si un code de parrain est fourni. */
export const tikisseReferrals = mysqlTable("tikisse_referrals", {
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
  index("tikisse_referrals_referrer_index").on(table.referrerPhone, table.createdAt),
  index("tikisse_referrals_status_index").on(table.status),
]);

/** Pays actifs sur la plateforme (inscription, format de téléphone, filtrage géographique). */
export const tikisseSupportedCountries = mysqlTable("tikisse_supported_countries", {
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

export type TikisseProfile = typeof tikisseProfiles.$inferSelect;
export type InsertTikisseProfile = typeof tikisseProfiles.$inferInsert;
export type TikissePlace = typeof tikissePlaces.$inferSelect;
export type InsertTikissePlace = typeof tikissePlaces.$inferInsert;
export type TikisseFavoritePlace = typeof tikisseFavoritePlaces.$inferSelect;
export type TikisseDelivery = typeof tikisseDeliveries.$inferSelect;
export type InsertTikisseDelivery = typeof tikisseDeliveries.$inferInsert;
export type TikisseDeliveryLiveLocation = typeof tikisseDeliveryLiveLocations.$inferSelect;
export type TikisseDeliveryCandidate = typeof tikisseDeliveryCandidates.$inferSelect;
export type TikisseDeliveryReview = typeof tikisseDeliveryReviews.$inferSelect;
export type TikisseWallet = typeof tikisseWallets.$inferSelect;
export type TikissePlatformSettings = typeof tikissePlatformSettings.$inferSelect;
export type TikisseWalletLedger = typeof tikisseWalletLedger.$inferSelect;
export type TikissePaymentTransaction = typeof tikissePaymentTransactions.$inferSelect;
export type TikisseDeliveryEvent = typeof tikisseDeliveryEvents.$inferSelect;
export type TikisseReferral = typeof tikisseReferrals.$inferSelect;
/** Vérification d'identité (KYC) des livreurs : documents envoyés, examinés par l'administration. */
export const tikisseKycSubmissions = mysqlTable("tikisse_kyc_submissions", {
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
  /** Photos effacées du stockage (suppression du compte) ; la décision de vérification reste. */
  documentsErasedAt: timestamp("documentsErasedAt"),
}, (table) => [
  index("tikisse_kyc_submissions_driver_index").on(table.driverPhone, table.submittedAt),
  index("tikisse_kyc_submissions_status_index").on(table.status),
]);

export type TikisseSupportedCountry = typeof tikisseSupportedCountries.$inferSelect;
export type TikisseKycSubmission = typeof tikisseKycSubmissions.$inferSelect;

/** Événements webhook YengaPay : log immutable des callbacks reçus.
 *  Idempotence garantie par la contrainte unique sur (provider, providerEventId). */
export const tikisseYengapayWebhookEvents = mysqlTable("tikisse_yengapay_webhook_events", {
  id: varchar("id", { length: 40 }).primaryKey(),
  provider: mysqlEnum("provider", ["yengapay_sandbox", "yengapay_live", "yengapay_direct_sandbox", "yengapay_direct_live"]).notNull().default("yengapay_live"),
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
  uniqueIndex("tikisse_yengapay_webhook_events_provider_event_unique").on(table.provider, table.providerEventId),
  index("tikisse_yengapay_webhook_events_status_index").on(table.status, table.createdAt),
  index("tikisse_yengapay_webhook_events_payment_index").on(table.paymentTransactionId),
]);

export type TikisseYengapayWebhookEvent = typeof tikisseYengapayWebhookEvents.$inferSelect;

/** Push tokens Expo pour les notifications device-to-device.
 *  Un profil peut avoir plusieurs tokens (plusieurs devices ou plusieurs installs). */
export const tikissePushTokens = mysqlTable("tikisse_push_tokens", {
  id: varchar("id", { length: 40 }).primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  token: varchar("token", { length: 200 }).notNull(),
  platform: mysqlEnum("platform", ["ios", "android", "web"]).notNull().default("android"),
  appVersion: varchar("appVersion", { length: 40 }),
  deviceName: varchar("deviceName", { length: 120 }),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tikisse_push_tokens_phone_token_unique").on(table.phone, table.token),
  index("tikisse_push_tokens_phone_index").on(table.phone),
  index("tikisse_push_tokens_last_seen_index").on(table.lastSeenAt),
]);

export type TikissePushToken = typeof tikissePushTokens.$inferSelect;

/** Périmètre de travail d'un livreur : quelles courses lui sont affichées, et pour lesquelles il
 *  reçoit une alerte push. Absence de ligne = réglages par défaut (cf. shared/driver-perimeter.ts) :
 *  alertes push désactivées, périmètre limité à la ville du profil. */
export const tikisseDriverPreferences = mysqlTable("tikisse_driver_preferences", {
  profilePhone: varchar("profilePhone", { length: 20 }).primaryKey(),
  /** Opt-in explicite aux alertes push de nouvelles courses. Les notifications transactionnelles
   *  (candidature retenue, mission confirmée, course annulée…) ne sont jamais concernées. */
  opportunityPushEnabled: boolean("opportunityPushEnabled").notNull().default(false),
  /** NULL = périmètre « ma ville ». Sinon rayon max en km autour de la position de référence. */
  alertRadiusKm: int("alertRadiusKm"),
  /** NULL = périmètre « ma ville ». Sinon rayon max en km autour de la position de référence. */
  discoveryRadiusKm: int("discoveryRadiusKm"),
  /** Position de référence des deux rayons : dernière position GPS publiée par le livreur. */
  baseLatitude: decimal("baseLatitude", { precision: 10, scale: 7 }),
  baseLongitude: decimal("baseLongitude", { precision: 10, scale: 7 }),
  baseUpdatedAt: timestamp("baseUpdatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TikisseDriverPreferences = typeof tikisseDriverPreferences.$inferSelect;

/** Programme de fidélité : règles métier (seuil livraisons, montant bonus, palier). */
export const tikisseLoyaltyPrograms = mysqlTable("tikisse_loyalty_programs", {
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
  index("tikisse_loyalty_programs_role_index").on(table.role, table.enabled),
]);

/** Octroi de bonus lié à un programme. Idempotent via (programId, deliveryId). */
export const tikisseLoyaltyGrants = mysqlTable("tikisse_loyalty_grants", {
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
  uniqueIndex("tikisse_loyalty_grants_program_delivery_unique").on(table.programId, table.deliveryId),
  index("tikisse_loyalty_grants_profile_index").on(table.profilePhone, table.grantedAt),
  index("tikisse_loyalty_grants_status_index").on(table.status),
  index("tikisse_loyalty_grants_expires_index").on(table.expiresAt),
]);

export type TikisseLoyaltyProgram = typeof tikisseLoyaltyPrograms.$inferSelect;
export type TikisseLoyaltyGrant = typeof tikisseLoyaltyGrants.$inferSelect;

/** Sessions actives multi-device : permet la révocation granulaire.
 *  Le token JWT complet n'est jamais stocké (security) : on garde son hash SHA-256
 *  et les 4 derniers caractères pour affichage. */
export const tikisseProfileSessions = mysqlTable("tikisse_profile_sessions", {
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
  index("tikisse_profile_sessions_phone_index").on(table.phone, table.lastSeenAt),
  uniqueIndex("tikisse_profile_sessions_phone_token_unique").on(table.phone, table.tokenHash),
]);

export type TikisseProfileSession = typeof tikisseProfileSessions.$inferSelect;

/** Métriques business quotidiennes — alimentées par le cron /api/scheduled/compute-daily-metrics.
 *  Permet au DashboardPage d'afficher des tendances (GMV semaine dernière, etc.) sans
 *  ré-agréger toute la table tikisse_deliveries. */
export const tikisseDailyMetrics = mysqlTable("tikisse_daily_metrics", {
  date: varchar("date", { length: 10 }).primaryKey(), // "YYYY-MM-DD"
  deliveriesCreated: int("deliveriesCreated").notNull().default(0),
  deliveriesCompleted: int("deliveriesCompleted").notNull().default(0),
  deliveriesCancelled: int("deliveriesCancelled").notNull().default(0),
  gmvTotal: int("gmvTotal").notNull().default(0), // montant total facturé (FCFA)
  commissionTotal: int("commissionTotal").notNull().default(0), // commission Tikisse
  newDrivers: int("newDrivers").notNull().default(0),
  newSenders: int("newSenders").notNull().default(0),
  activeDrivers: int("activeDrivers").notNull().default(0),
  activeSenders: int("activeSenders").notNull().default(0),
  bonusAwarded: int("bonusAwarded").notNull().default(0),
  reportsOpened: int("reportsOpened").notNull().default(0),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
}, (table) => [
  index("tikisse_daily_metrics_date_index").on(table.date),
]);

export type TikisseDailyMetric = typeof tikisseDailyMetrics.$inferSelect;

/** Rate-limit distribué (partagé entre toutes les instances du serveur, contrairement à un compteur en
 *  mémoire de processus) : fenêtre fixe identifiée par `rateLimitKey` = "<portée>:<identifiant>:<fenêtre>"
 *  (ex. "geo:+22670000000:29234561"), incrémentée atomiquement via ON DUPLICATE KEY UPDATE. */
export const tikisseRateLimits = mysqlTable("tikisse_rate_limits", {
  rateLimitKey: varchar("rateLimitKey", { length: 191 }).primaryKey(),
  count: int("count").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("tikisse_rate_limits_updated_at_index").on(table.updatedAt),
]);

export type TikisseRateLimit = typeof tikisseRateLimits.$inferSelect;

/** Notes internes du support sur une fiche utilisateur. Jamais montrées à l'utilisateur. */
export const tikisseProfileNotes = mysqlTable("tikisse_profile_notes", {
  id: varchar("id", { length: 40 }).primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  body: varchar("body", { length: 1000 }).notNull(),
  adminId: int("adminId").notNull(),
  adminEmail: varchar("adminEmail", { length: 180 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("tikisse_profile_notes_profile_index").on(table.profilePhone, table.createdAt),
]);

export type TikisseProfileNote = typeof tikisseProfileNotes.$inferSelect;

/**
 * Comptes supprimés : correspondance numéro ↔ pseudonyme, gardée 10 ans pour la comptabilité, puis
 * effacée. Le numéro lui-même est remplacé par le pseudonyme dans toutes les autres tables.
 */
export const tikisseDeletedAccounts = mysqlTable("tikisse_deleted_accounts", {
  pseudonym: varchar("pseudonym", { length: 20 }).primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  accountType: mysqlEnum("accountType", ["sender", "driver"]).notNull(),
  deletedAt: timestamp("deletedAt").defaultNow().notNull(),
  purgeAfter: timestamp("purgeAfter").notNull(),
  finalizedByAdminId: int("finalizedByAdminId"),
}, (table) => [
  index("tikisse_deleted_accounts_phone_index").on(table.phone),
  index("tikisse_deleted_accounts_purge_index").on(table.purgeAfter),
]);

export type TikisseDeletedAccount = typeof tikisseDeletedAccounts.$inferSelect;

/** Fichiers à effacer du stockage, traités en tâche de fond avec reprise. */
export const tikisseStorageErasures = mysqlTable("tikisse_storage_erasures", {
  id: varchar("id", { length: 40 }).primaryKey(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  reason: varchar("reason", { length: 80 }).notNull(),
  attempts: int("attempts").notNull().default(0),
  lastError: varchar("lastError", { length: 300 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  erasedAt: timestamp("erasedAt"),
}, (table) => [
  index("tikisse_storage_erasures_pending_index").on(table.erasedAt, table.createdAt),
]);
