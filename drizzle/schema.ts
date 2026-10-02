import { bigint, boolean, index, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/**
 * Types énumérés PostgreSQL. Ajouter une valeur : `ALTER TYPE … ADD VALUE`, que `pnpm db:generate` écrit
 * seul à partir de ce fichier.
 */
export const tikisseProfilesAccountTypeEnum = pgEnum("tikisse_profiles_account_type", ["sender", "driver"]);
export const tikisseProfilesStatusEnum = pgEnum("tikisse_profiles_status", ["active", "suspended", "banned"]);
export const tikisseDeliveriesDeliveryTypeEnum = pgEnum("tikisse_deliveries_delivery_type", ["Plis", "Personne", "Autre"]);
export const tikisseDeliveriesStatusEnum = pgEnum("tikisse_deliveries_status", ["draft", "open", "pending_confirmation", "active", "completed", "disabled", "cancelled", "expired"]);
export const tikisseDeliveriesRouteSourceEnum = pgEnum("tikisse_deliveries_route_source", ["routes", "provisional"]);
export const tikisseDeliveryCandidatesStatusEnum = pgEnum("tikisse_delivery_candidates_status", ["applied", "selected", "confirmed", "withdrawn", "replaced"]);
export const tikisseWalletLedgerOperationEnum = pgEnum("tikisse_wallet_ledger_operation", ["block", "unblock", "debit", "commission_debit", "compensation", "credit", "refund", "deposit_request", "withdrawal_request", "bonus", "penalty"]);
export const tikissePaymentTransactionsTypeEnum = pgEnum("tikisse_payment_transactions_type", ["deposit", "withdrawal"]);
export const tikissePaymentTransactionsProviderEnum = pgEnum("tikisse_payment_transactions_provider", ["ligdi_simulated", "yengapay_test", "yengapay_sandbox", "yengapay_live", "yengapay_direct_test", "yengapay_direct_sandbox", "yengapay_direct_live", "manual_payout", "ligdicash_direct_sandbox", "ligdicash_direct_live"]);
export const tikissePaymentTransactionsStatusEnum = pgEnum("tikisse_payment_transactions_status", ["pending", "succeeded", "failed", "cancelled", "expired"]);
export const tikisseDeliveryEventsStatusEnum = pgEnum("tikisse_delivery_events_status", ["draft", "open", "pending_confirmation", "active", "completed", "disabled", "cancelled", "expired"]);
export const tikisseDeliveryEventsToneEnum = pgEnum("tikisse_delivery_events_tone", ["info", "success", "warning"]);
export const tikisseDeliveryReportsReporterRoleEnum = pgEnum("tikisse_delivery_reports_reporter_role", ["sender", "driver"]);
export const tikisseDeliveryReportsStatusEnum = pgEnum("tikisse_delivery_reports_status", ["open", "reviewing", "resolved", "dismissed"]);
export const tikisseAdminUsersRoleEnum = pgEnum("tikisse_admin_users_role", ["super_admin", "support", "finance", "viewer", "kyc_reviewer"]);
export const tikisseAdminSessionsStageEnum = pgEnum("tikisse_admin_sessions_stage", ["pending_totp", "active"]);
export const tikisseAdminApprovalsActionEnum = pgEnum("tikisse_admin_approvals_action", ["wallet_bonus", "wallet_penalty", "withdrawal_settle", "delivery_refund"]);
export const tikisseAdminApprovalsStatusEnum = pgEnum("tikisse_admin_approvals_status", ["pending", "approved", "executed", "failed", "rejected", "cancelled"]);
export const tikisseReferralsStatusEnum = pgEnum("tikisse_referrals_status", ["invited", "qualified", "rewarded", "voided"]);
export const tikisseKycSubmissionsStatusEnum = pgEnum("tikisse_kyc_submissions_status", ["submitted", "approved", "rejected"]);
export const tikisseYengapayWebhookEventsProviderEnum = pgEnum("tikisse_yengapay_webhook_events_provider", ["yengapay_sandbox", "yengapay_live", "yengapay_direct_sandbox", "yengapay_direct_live"]);
export const tikisseYengapayWebhookEventsStatusEnum = pgEnum("tikisse_yengapay_webhook_events_status", ["received", "processed", "failed", "ignored"]);
export const tikissePushTokensPlatformEnum = pgEnum("tikisse_push_tokens_platform", ["ios", "android", "web"]);
export const tikisseLoyaltyProgramsRoleEnum = pgEnum("tikisse_loyalty_programs_role", ["sender", "driver"]);
export const tikisseLoyaltyGrantsStatusEnum = pgEnum("tikisse_loyalty_grants_status", ["pending", "credited", "cancelled"]);
export const tikisseProfileSessionsPlatformEnum = pgEnum("tikisse_profile_sessions_platform", ["ios", "android", "web", "unknown"]);
export const tikisseScheduledJobRunsStatusEnum = pgEnum("tikisse_scheduled_job_runs_status", ["running", "succeeded", "failed"]);
export const tikisseScheduledJobRunsTriggerEnum = pgEnum("tikisse_scheduled_job_runs_trigger", ["schedule", "manual"]);
export const tikisseDeletedAccountsAccountTypeEnum = pgEnum("tikisse_deleted_accounts_account_type", ["sender", "driver"]);

/**
 * Tikisse phone-based profile. The phone number is unique and the account type
 * is intentionally immutable after first registration.
 */
export const tikisseProfiles = pgTable("tikisse_profiles", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  fullName: varchar("fullName", { length: 70 }).notNull(),
  accountType: tikisseProfilesAccountTypeEnum("accountType").notNull(),
  vehicles: text("vehicles").notNull(),
  photoKey: varchar("photoKey", { length: 512 }),
  email: varchar("email", { length: 320 }),
  phoneVerified: boolean("phoneVerified").notNull().default(true),
  emailVerified: boolean("emailVerified").notNull().default(false),
  referralCode: varchar("referralCode", { length: 8 }).unique(),
  supabaseUserId: varchar("supabaseUserId", { length: 64 }).unique(),
  status: tikisseProfilesStatusEnum("status").notNull().default("active"),
  statusReason: varchar("statusReason", { length: 500 }),
  statusUpdatedAt: timestamp("statusUpdatedAt", { withTimezone: true }),
  statusUpdatedByAdminId: integer("statusUpdatedByAdminId"),
  country: varchar("country", { length: 2 }),
  city: varchar("city", { length: 80 }),
  deletionRequestedAt: timestamp("deletionRequestedAt", { withTimezone: true }),
  deletionScheduledAt: timestamp("deletionScheduledAt", { withTimezone: true }),
  deletedAt: timestamp("deletedAt", { withTimezone: true }),
  /** Déconnexion forcée par l'équipe : tout jeton de session émis avant cette date est refusé. */
  sessionsRevokedAt: timestamp("sessionsRevokedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

/** Canonical GPS-first place cache. Coordinates remain the source of truth for all geographic calculations. */
export const tikissePlaces = pgTable("tikisse_places", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  googlePlaceId: varchar("googlePlaceId", { length: 255 }).unique(),
  mapboxPlaceId: varchar("mapboxPlaceId", { length: 255 }).unique(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
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
  resolvedAt: timestamp("resolvedAt", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  index("tikisse_places_coordinate_key_index").on(table.coordinateKey),
  index("tikisse_places_coordinates_index").on(table.latitude, table.longitude),
]);

/** Sender-owned shortcuts to canonical places; natural labels make favourites recognisable in the form. */
export const tikisseFavoritePlaces = pgTable("tikisse_favorite_places", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  placeId: integer("placeId").notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("tikisse_favorite_places_profile_place_unique").on(table.profilePhone, table.placeId)]);

/** Delivery records are owned by a phone-verified Tikisse profile and reference canonical GPS places. */
export const tikisseDeliveries = pgTable("tikisse_deliveries", {
  id: varchar("id", { length: 40 }).primaryKey(),
  senderPhone: varchar("senderPhone", { length: 20 }).notNull(),
  pickupPlaceId: integer("pickupPlaceId").notNull(),
  dropoffPlaceId: integer("dropoffPlaceId").notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  details: varchar("details", { length: 450 }).notNull(),
  deliveryType: tikisseDeliveriesDeliveryTypeEnum("deliveryType").notNull(),
  status: tikisseDeliveriesStatusEnum("status").notNull().default("open"),
  distanceKm: numeric("distanceKm", { precision: 10, scale: 2 }).notNull(),
  routeSource: tikisseDeliveriesRouteSourceEnum("routeSource").notNull().default("provisional"),
  estimatedPrice: integer("estimatedPrice").notNull(),
  offeredPrice: integer("offeredPrice"),
  accruedCommission: integer("accruedCommission"),
  vehicleTypes: varchar("vehicleTypes", { length: 120 }).notNull(),
  weightKg: numeric("weightKg", { precision: 8, scale: 2 }),
  lengthCm: integer("lengthCm"),
  widthCm: integer("widthCm"),
  heightCm: integer("heightCm"),
  passengers: integer("passengers"),
  driverPhone: varchar("driverPhone", { length: 20 }),
  previousDriverPhone: varchar("previousDriverPhone", { length: 20 }),
  selectedAt: timestamp("selectedAt", { withTimezone: true }),
  confirmedAt: timestamp("confirmedAt", { withTimezone: true }),
  completedAt: timestamp("completedAt", { withTimezone: true }),
  cancelledAt: timestamp("cancelledAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  index("tikisse_deliveries_sender_status_index").on(table.senderPhone, table.status),
  index("tikisse_deliveries_driver_status_index").on(table.driverPhone, table.status),
  index("tikisse_deliveries_status_created_index").on(table.status, table.createdAt),
]);

/** Latest foreground GPS position published by the driver assigned to an active delivery. */
export const tikisseDeliveryLiveLocations = pgTable("tikisse_delivery_live_locations", {
  deliveryId: varchar("deliveryId", { length: 40 }).primaryKey(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
  heading: numeric("heading", { precision: 6, scale: 2 }).notNull().default("0"),
  recordedAt: timestamp("recordedAt", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [index("tikisse_delivery_live_locations_driver_index").on(table.driverPhone, table.updatedAt)]);

/** A driver can have one candidacy per delivery. Historical status is retained, never deleted. */
export const tikisseDeliveryCandidates = pgTable("tikisse_delivery_candidates", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  offerPrice: integer("offerPrice"),
  status: tikisseDeliveryCandidatesStatusEnum("status").notNull().default("applied"),
  commissionBlocked: integer("commissionBlocked").notNull().default(0),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  uniqueIndex("tikisse_delivery_candidates_delivery_driver_unique").on(table.deliveryId, table.driverPhone),
  index("tikisse_delivery_candidates_delivery_status_index").on(table.deliveryId, table.status),
  index("tikisse_delivery_candidates_driver_status_index").on(table.driverPhone, table.status),
]);

/** Sender reviews are retained with the completed delivery and may be submitted once. */
export const tikisseDeliveryReviews = pgTable("tikisse_delivery_reviews", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  reviewerPhone: varchar("reviewerPhone", { length: 20 }).notNull(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  rating: integer("rating").notNull(),
  comment: varchar("comment", { length: 500 }),
  /** Avis masqué par la modération : il ne s'affiche plus et ne compte plus dans la note du livreur. */
  hiddenAt: timestamp("hiddenAt", { withTimezone: true }),
  hiddenReason: varchar("hiddenReason", { length: 300 }),
  hiddenByAdminId: integer("hiddenByAdminId"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tikisse_delivery_reviews_delivery_reviewer_unique").on(table.deliveryId, table.reviewerPhone),
  index("tikisse_delivery_reviews_driver_index").on(table.driverPhone),
]);

/** One Wallet per Tikisse profile. Amounts are stored in XOF minor units (whole FCFA). */
export const tikisseWallets = pgTable("tikisse_wallets", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull().unique(),
  availableBalance: integer("availableBalance").notNull().default(0),
  heldBalance: integer("heldBalance").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("XOF"),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

/** Singleton administration setting read by all commission calculations on the server. */
export const tikissePlatformSettings = pgTable("tikisse_platform_settings", {
  id: integer("id").primaryKey(),
  commissionRate: numeric("commissionRate", { precision: 6, scale: 5 }).notNull().default("0.10000"),
  referralRewardAmount: integer("referralRewardAmount").notNull().default(1000),
  referralEnabled: boolean("referralEnabled").notNull().default(true),
  referralRequiredDeliveries: integer("referralRequiredDeliveries").notNull().default(1),
  minWithdrawal: integer("minWithdrawal").notNull().default(500),
  maxWithdrawal: integer("maxWithdrawal").notNull().default(500000),
  pricingConfig: text("pricingConfig"),
  maintenanceEnabled: boolean("maintenanceEnabled").notNull().default(false),
  maintenanceMessage: varchar("maintenanceMessage", { length: 500 }),
  /** Double authentification exigée pour les rôles super_admin et finance. */
  adminTotpRequired: boolean("adminTotpRequired").notNull().default(false),
  /** Montant (FCFA) à partir duquel un bonus, une pénalité ou un retrait attend la validation d'un second admin. */
  adminApprovalThreshold: integer("adminApprovalThreshold").notNull().default(100000),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

/** Immutable financial ledger. An idempotency key prevents duplicate movements under retries. */
export const tikisseWalletLedger = pgTable("tikisse_wallet_ledger", {
  id: varchar("id", { length: 40 }).primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  deliveryId: varchar("deliveryId", { length: 40 }),
  operation: tikisseWalletLedgerOperationEnum("operation").notNull(),
  amount: integer("amount").notNull(),
  availableBefore: integer("availableBefore").notNull(),
  availableAfter: integer("availableAfter").notNull(),
  heldBefore: integer("heldBefore").notNull(),
  heldAfter: integer("heldAfter").notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 100 }).notNull().unique(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tikisse_wallet_ledger_profile_created_index").on(table.profilePhone, table.createdAt),
  index("tikisse_wallet_ledger_delivery_index").on(table.deliveryId),
]);

/** Payment request lifecycle; balance movements are written only once the provider outcome is confirmed. */
export const tikissePaymentTransactions = pgTable("tikisse_payment_transactions", {
  id: varchar("id", { length: 40 }).primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  type: tikissePaymentTransactionsTypeEnum("type").notNull(),
  provider: tikissePaymentTransactionsProviderEnum("provider").notNull().default("yengapay_test"),
  amount: integer("amount").notNull(),
  status: tikissePaymentTransactionsStatusEnum("status").notNull().default("pending"),
  providerReference: varchar("providerReference", { length: 80 }).notNull().unique(),
  /** Jeton de transaction LigdiCash (JWT, trop long pour `providerReference`) : sert à vérifier le statut. */
  providerToken: text("providerToken"),
  checkoutUrl: varchar("checkoutUrl", { length: 1000 }),
  ussdCode: varchar("ussdCode", { length: 64 }),
  phoneE164: varchar("phoneE164", { length: 24 }),
  operatorCode: varchar("operatorCode", { length: 16 }),
  countryCode: varchar("countryCode", { length: 4 }),
  expiresAt: timestamp("expiresAt", { withTimezone: true }),
  idempotencyKey: varchar("idempotencyKey", { length: 100 }).notNull().unique(),
  settledAt: timestamp("settledAt", { withTimezone: true }),
  /** Référence du versement Mobile Money fait hors application, exigée pour valider un retrait à la main.
   *  Unique : une même preuve de versement ne peut justifier deux retraits. */
  payoutReference: varchar("payoutReference", { length: 80 }).unique(),
  /** Note laissée par l'admin qui a tranché la transaction à la main. */
  adminNotes: varchar("adminNotes", { length: 300 }),
  settledByAdminId: integer("settledByAdminId"),
  /** Montant annoncé par YengaPay à la confirmation. Un écart avec `amount` est listé dans la console. */
  providerReportedAmount: integer("providerReportedAmount"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tikisse_payment_transactions_profile_created_index").on(table.profilePhone, table.createdAt),
  index("tikisse_payment_transactions_status_index").on(table.status, table.createdAt),
  index("tikisse_payment_transactions_operator_status_index").on(table.operatorCode, table.status, table.createdAt),
]);

/** Durable, recipient-scoped activity stream used by the in-app and realtime notification layers. */
export const tikisseDeliveryEvents = pgTable("tikisse_delivery_events", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  eventType: varchar("eventType", { length: 48 }).notNull(),
  status: tikisseDeliveryEventsStatusEnum("status"),
  actorPhone: varchar("actorPhone", { length: 20 }),
  recipientPhone: varchar("recipientPhone", { length: 20 }).notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  body: varchar("body", { length: 300 }).notNull(),
  tone: tikisseDeliveryEventsToneEnum("tone").notNull().default("info"),
  metadata: text("metadata"),
  /** Enregistré pour la chronologie (console, litiges) mais absent du fil de l'utilisateur, sans push. */
  feedHidden: boolean("feedHidden").notNull().default(false),
  idempotencyKey: varchar("idempotencyKey", { length: 100 }).notNull().unique(),
  readAt: timestamp("readAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tikisse_delivery_events_recipient_created_index").on(table.recipientPhone, table.createdAt),
  index("tikisse_delivery_events_delivery_created_index").on(table.deliveryId, table.createdAt),
]);

/** Signalements (CAS N°9) : envoyés par le Sender ou le Livreur à l'administration. */
export const tikisseDeliveryReports = pgTable("tikisse_delivery_reports", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deliveryId: varchar("deliveryId", { length: 40 }).notNull(),
  reporterPhone: varchar("reporterPhone", { length: 20 }).notNull(),
  reporterRole: tikisseDeliveryReportsReporterRoleEnum("reporterRole").notNull(),
  reason: varchar("reason", { length: 80 }).notNull(),
  description: varchar("description", { length: 1000 }).notNull(),
  attachmentKey: varchar("attachmentKey", { length: 255 }),
  status: tikisseDeliveryReportsStatusEnum("status").notNull().default("open"),
  resolutionNotes: varchar("resolutionNotes", { length: 1000 }),
  resolvedByAdminId: integer("resolvedByAdminId"),
  resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  index("tikisse_delivery_reports_status_created_index").on(table.status, table.createdAt),
  index("tikisse_delivery_reports_delivery_index").on(table.deliveryId),
  index("tikisse_delivery_reports_reporter_index").on(table.reporterPhone),
]);

/** Comptes d'administration Tikisse, totalement distincts de l'authentification des Senders/Livreurs. */
export const tikisseAdminUsers = pgTable("tikisse_admin_users", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  email: varchar("email", { length: 180 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  fullName: varchar("fullName", { length: 120 }).notNull(),
  /** Voir shared/admin-roles.ts : `viewer` lit sans rien modifier, `kyc_reviewer` ne voit que les vérifications d'identité. */
  role: tikisseAdminUsersRoleEnum("role").notNull().default("support"),
  active: boolean("active").notNull().default(true),
  /** Mot de passe provisoire (compte créé ou réinitialisé depuis la console) : à changer avant tout accès. */
  mustChangePassword: boolean("mustChangePassword").notNull().default(false),
  /** Double authentification (server/admin-totp.ts). Secret chiffré AES-256-GCM, jamais en clair. */
  totpSecret: varchar("totpSecret", { length: 255 }),
  /** Secret proposé à l'enrôlement, pas encore confirmé par un premier code. */
  totpPendingSecret: varchar("totpPendingSecret", { length: 255 }),
  totpEnabledAt: timestamp("totpEnabledAt", { withTimezone: true }),
  /** Dernier pas TOTP accepté : un code ne sert qu'une fois. */
  totpLastUsedStep: bigint("totpLastUsedStep", { mode: "number" }),
  /** Empreintes SHA-256 (JSON) des codes de secours restants. */
  totpRecoveryCodes: text("totpRecoveryCodes"),
  lastLoginAt: timestamp("lastLoginAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

/**
 * Sessions de la console d'administration. Le navigateur ne détient qu'un jeton aléatoire opaque, dans un
 * cookie httpOnly ; la base n'en garde que l'empreinte SHA-256. Une session se révoque à la déconnexion,
 * à la suspension du compte, ou expire au bout de 8 h.
 */
export const tikisseAdminSessions = pgTable("tikisse_admin_sessions", {
  id: varchar("id", { length: 40 }).primaryKey(),
  adminId: integer("adminId").notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  ipAddress: varchar("ipAddress", { length: 64 }),
  userAgent: varchar("userAgent", { length: 255 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revokedAt", { withTimezone: true }),
  /** `pending_totp` : mot de passe vérifié, code de double authentification attendu (5 min au plus). */
  stage: tikisseAdminSessionsStageEnum("stage").notNull().default("active"),
}, (table) => [
  index("tikisse_admin_sessions_admin_index").on(table.adminId, table.revokedAt),
]);

/**
 * Double validation : un bonus, une pénalité ou un retrait au-delà du seuil n'est pas exécuté par l'admin qui
 * le demande, mais mis en attente jusqu'à ce qu'un autre admin le valide (server/admin-approvals.ts).
 */
export const tikisseAdminApprovals = pgTable("tikisse_admin_approvals", {
  id: varchar("id", { length: 40 }).primaryKey(),
  action: tikisseAdminApprovalsActionEnum("action").notNull(),
  amount: integer("amount").notNull(),
  targetPhone: varchar("targetPhone", { length: 20 }).notNull(),
  /** Ce que la demande vise précisément (transaction de retrait, identifiant d'opération) : une seule demande en attente par cible. */
  targetRef: varchar("targetRef", { length: 80 }).notNull(),
  payload: text("payload").notNull(),
  status: tikisseAdminApprovalsStatusEnum("status").notNull().default("pending"),
  requestedByAdminId: integer("requestedByAdminId").notNull(),
  requestedByEmail: varchar("requestedByEmail", { length: 180 }).notNull(),
  decidedByAdminId: integer("decidedByAdminId"),
  decidedByEmail: varchar("decidedByEmail", { length: 180 }),
  decisionNote: varchar("decisionNote", { length: 300 }),
  failureReason: varchar("failureReason", { length: 500 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decidedAt", { withTimezone: true }),
}, (table) => [
  index("tikisse_admin_approvals_status_index").on(table.status, table.createdAt),
  index("tikisse_admin_approvals_target_index").on(table.targetRef, table.status),
]);

/** Journal d'audit immuable de toute action d'administration (CAS N°10 — décisions tracées). */
export const tikisseAdminAuditLog = pgTable("tikisse_admin_audit_log", {
  id: varchar("id", { length: 40 }).primaryKey(),
  adminId: integer("adminId").notNull(),
  adminEmail: varchar("adminEmail", { length: 180 }).notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  targetType: varchar("targetType", { length: 40 }).notNull(),
  targetId: varchar("targetId", { length: 80 }).notNull(),
  details: text("details"),
  ipAddress: varchar("ipAddress", { length: 64 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tikisse_admin_audit_log_target_index").on(table.targetType, table.targetId),
  index("tikisse_admin_audit_log_admin_created_index").on(table.adminId, table.createdAt),
]);

export type TikisseDeliveryReport = typeof tikisseDeliveryReports.$inferSelect;
export type TikisseAdminUser = typeof tikisseAdminUsers.$inferSelect;
export type TikisseAdminSession = typeof tikisseAdminSessions.$inferSelect;
export type TikisseAdminApproval = typeof tikisseAdminApprovals.$inferSelect;
export type TikisseAdminAuditLog = typeof tikisseAdminAuditLog.$inferSelect;

/** Parrainage : un enregistrement par filleul, créé à l'inscription si un code de parrain est fourni. */
export const tikisseReferrals = pgTable("tikisse_referrals", {
  id: varchar("id", { length: 40 }).primaryKey(),
  referrerPhone: varchar("referrerPhone", { length: 20 }).notNull(),
  refereePhone: varchar("refereePhone", { length: 20 }).notNull().unique(),
  referralCode: varchar("referralCode", { length: 8 }).notNull(),
  status: tikisseReferralsStatusEnum("status").notNull().default("invited"),
  rewardAmount: integer("rewardAmount").notNull(),
  qualifyingDeliveryId: varchar("qualifyingDeliveryId", { length: 40 }),
  qualifiedAt: timestamp("qualifiedAt", { withTimezone: true }),
  rewardedAt: timestamp("rewardedAt", { withTimezone: true }),
  rewardedByAdminId: integer("rewardedByAdminId"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tikisse_referrals_referrer_index").on(table.referrerPhone, table.createdAt),
  index("tikisse_referrals_status_index").on(table.status),
]);

/** Pays actifs sur la plateforme (inscription, format de téléphone, filtrage géographique). */
export const tikisseSupportedCountries = pgTable("tikisse_supported_countries", {
  id: varchar("id", { length: 2 }).primaryKey(), // code ISO, ex. "BF"
  name: varchar("name", { length: 80 }).notNull(),
  dialCode: varchar("dialCode", { length: 6 }).notNull(),
  digits: integer("digits").notNull(),
  groups: varchar("groups", { length: 40 }).notNull(), // ex. "2,2,2,2"
  timeZones: varchar("timeZones", { length: 200 }).notNull(), // séparés par virgule
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sortOrder").notNull().default(0),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
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
export const tikisseKycSubmissions = pgTable("tikisse_kyc_submissions", {
  id: varchar("id", { length: 40 }).primaryKey(),
  driverPhone: varchar("driverPhone", { length: 20 }).notNull(),
  idFrontKey: varchar("idFrontKey", { length: 255 }).notNull(),
  idBackKey: varchar("idBackKey", { length: 255 }).notNull(),
  selfieKey: varchar("selfieKey", { length: 255 }).notNull(),
  status: tikisseKycSubmissionsStatusEnum("status").notNull().default("submitted"),
  rejectionReason: varchar("rejectionReason", { length: 500 }),
  submittedAt: timestamp("submittedAt", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt", { withTimezone: true }),
  reviewedByAdminId: integer("reviewedByAdminId"),
  /** Photos effacées du stockage (suppression du compte) ; la décision de vérification reste. */
  documentsErasedAt: timestamp("documentsErasedAt", { withTimezone: true }),
}, (table) => [
  index("tikisse_kyc_submissions_driver_index").on(table.driverPhone, table.submittedAt),
  index("tikisse_kyc_submissions_status_index").on(table.status),
]);

export type TikisseSupportedCountry = typeof tikisseSupportedCountries.$inferSelect;
export type TikisseKycSubmission = typeof tikisseKycSubmissions.$inferSelect;

/** Événements webhook YengaPay : log immutable des callbacks reçus.
 *  Idempotence garantie par la contrainte unique sur (provider, providerEventId). */
export const tikisseYengapayWebhookEvents = pgTable("tikisse_yengapay_webhook_events", {
  id: varchar("id", { length: 40 }).primaryKey(),
  provider: tikisseYengapayWebhookEventsProviderEnum("provider").notNull().default("yengapay_live"),
  providerEventId: varchar("providerEventId", { length: 120 }).notNull(),
  eventType: varchar("eventType", { length: 60 }).notNull(),
  paymentTransactionId: varchar("paymentTransactionId", { length: 40 }),
  payload: text("payload").notNull(),
  signature: varchar("signature", { length: 200 }),
  processedAt: timestamp("processedAt", { withTimezone: true }),
  status: tikisseYengapayWebhookEventsStatusEnum("status").notNull().default("received"),
  failureReason: varchar("failureReason", { length: 500 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tikisse_yengapay_webhook_events_provider_event_unique").on(table.provider, table.providerEventId),
  index("tikisse_yengapay_webhook_events_status_index").on(table.status, table.createdAt),
  index("tikisse_yengapay_webhook_events_payment_index").on(table.paymentTransactionId),
]);

export type TikisseYengapayWebhookEvent = typeof tikisseYengapayWebhookEvents.$inferSelect;

/** Push tokens Expo pour les notifications device-to-device.
 *  Un profil peut avoir plusieurs tokens (plusieurs devices ou plusieurs installs). */
export const tikissePushTokens = pgTable("tikisse_push_tokens", {
  id: varchar("id", { length: 40 }).primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  token: varchar("token", { length: 200 }).notNull(),
  platform: tikissePushTokensPlatformEnum("platform").notNull().default("android"),
  appVersion: varchar("appVersion", { length: 40 }),
  deviceName: varchar("deviceName", { length: 120 }),
  lastSeenAt: timestamp("lastSeenAt", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tikisse_push_tokens_phone_token_unique").on(table.phone, table.token),
  index("tikisse_push_tokens_phone_index").on(table.phone),
  index("tikisse_push_tokens_last_seen_index").on(table.lastSeenAt),
]);

export type TikissePushToken = typeof tikissePushTokens.$inferSelect;

/** Périmètre de travail d'un livreur : quelles courses lui sont affichées, et pour lesquelles il
 *  reçoit une alerte push. Absence de ligne = réglages par défaut (cf. shared/driver-perimeter.ts) :
 *  alertes push désactivées, périmètre limité à la ville du profil. */
export const tikisseDriverPreferences = pgTable("tikisse_driver_preferences", {
  profilePhone: varchar("profilePhone", { length: 20 }).primaryKey(),
  /** Opt-in explicite aux alertes push de nouvelles courses. Les notifications transactionnelles
   *  (candidature retenue, mission confirmée, course annulée…) ne sont jamais concernées. */
  opportunityPushEnabled: boolean("opportunityPushEnabled").notNull().default(false),
  /** NULL = périmètre « ma ville ». Sinon rayon max en km autour de la position de référence. */
  alertRadiusKm: integer("alertRadiusKm"),
  /** NULL = périmètre « ma ville ». Sinon rayon max en km autour de la position de référence. */
  discoveryRadiusKm: integer("discoveryRadiusKm"),
  /** Position de référence des deux rayons : dernière position GPS publiée par le livreur. */
  baseLatitude: numeric("baseLatitude", { precision: 10, scale: 7 }),
  baseLongitude: numeric("baseLongitude", { precision: 10, scale: 7 }),
  baseUpdatedAt: timestamp("baseUpdatedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type TikisseDriverPreferences = typeof tikisseDriverPreferences.$inferSelect;

/** Programme de fidélité : règles métier (seuil livraisons, montant bonus, palier). */
export const tikisseLoyaltyPrograms = pgTable("tikisse_loyalty_programs", {
  id: varchar("id", { length: 40 }).primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  description: varchar("description", { length: 300 }),
  role: tikisseLoyaltyProgramsRoleEnum("role").notNull(),
  /** Nombre de livraisons terminées requis pour déclencher la récompense. */
  requiredDeliveries: integer("requiredDeliveries").notNull(),
  /** Montant du bonus crédité sur le wallet (FCFA). */
  bonusAmount: integer("bonusAmount").notNull(),
  /** Plage de validité : la course doit avoir été terminée dans cette fenêtre. */
  windowDays: integer("windowDays").notNull().default(90),
  /** Si true, les bonus <= autoCreditMaxAmount sont crédités automatiquement.
   *  Sinon, ils restent en 'pending' et nécessitent une validation admin. */
  autoCredit: boolean("autoCredit").notNull().default(false),
  /** Plafond (FCFA) pour le crédit automatique. 0 = illimité (mais contrôlé par le booléen). */
  autoCreditMaxAmount: integer("autoCreditMaxAmount").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  index("tikisse_loyalty_programs_role_index").on(table.role, table.enabled),
]);

/** Octroi de bonus lié à un programme. Idempotent via (programId, deliveryId). */
export const tikisseLoyaltyGrants = pgTable("tikisse_loyalty_grants", {
  id: varchar("id", { length: 40 }).primaryKey(),
  programId: varchar("programId", { length: 40 }).notNull(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  deliveryId: varchar("deliveryId", { length: 40 }),
  bonusAmount: integer("bonusAmount").notNull(),
  status: tikisseLoyaltyGrantsStatusEnum("status").notNull().default("pending"),
  ledgerEntryId: varchar("ledgerEntryId", { length: 40 }),
  grantedAt: timestamp("grantedAt", { withTimezone: true }).defaultNow().notNull(),
  creditedAt: timestamp("creditedAt", { withTimezone: true }),
  expiresAt: timestamp("expiresAt", { withTimezone: true }),
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
export const tikisseProfileSessions = pgTable("tikisse_profile_sessions", {
  id: varchar("id", { length: 40 }).primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
  tokenLast4: varchar("tokenLast4", { length: 4 }).notNull(),
  deviceName: varchar("deviceName", { length: 120 }),
  platform: tikisseProfileSessionsPlatformEnum("platform").notNull().default("unknown"),
  appVersion: varchar("appVersion", { length: 40 }),
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revokedAt", { withTimezone: true }),
}, (table) => [
  index("tikisse_profile_sessions_phone_index").on(table.phone, table.lastSeenAt),
  uniqueIndex("tikisse_profile_sessions_phone_token_unique").on(table.phone, table.tokenHash),
]);

export type TikisseProfileSession = typeof tikisseProfileSessions.$inferSelect;

/** Métriques business quotidiennes — alimentées par le cron /api/scheduled/compute-daily-metrics.
 *  Permet au DashboardPage d'afficher des tendances (GMV semaine dernière, etc.) sans
 *  ré-agréger toute la table tikisse_deliveries. */
export const tikisseDailyMetrics = pgTable("tikisse_daily_metrics", {
  date: varchar("date", { length: 10 }).primaryKey(), // "YYYY-MM-DD"
  deliveriesCreated: integer("deliveriesCreated").notNull().default(0),
  deliveriesCompleted: integer("deliveriesCompleted").notNull().default(0),
  deliveriesCancelled: integer("deliveriesCancelled").notNull().default(0),
  gmvTotal: integer("gmvTotal").notNull().default(0), // montant total facturé (FCFA)
  commissionTotal: integer("commissionTotal").notNull().default(0), // commission Tikisse
  newDrivers: integer("newDrivers").notNull().default(0),
  newSenders: integer("newSenders").notNull().default(0),
  activeDrivers: integer("activeDrivers").notNull().default(0),
  activeSenders: integer("activeSenders").notNull().default(0),
  bonusAwarded: integer("bonusAwarded").notNull().default(0),
  reportsOpened: integer("reportsOpened").notNull().default(0),
  computedAt: timestamp("computedAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tikisse_daily_metrics_date_index").on(table.date),
]);

export type TikisseDailyMetric = typeof tikisseDailyMetrics.$inferSelect;

/** Rate-limit distribué (partagé entre toutes les instances du serveur, contrairement à un compteur en
 *  mémoire de processus) : fenêtre fixe identifiée par `rateLimitKey` = "<portée>:<identifiant>:<fenêtre>"
 *  (ex. "geo:+22670000000:29234561"), incrémentée atomiquement via INSERT … ON CONFLICT DO UPDATE. */
export const tikisseRateLimits = pgTable("tikisse_rate_limits", {
  rateLimitKey: varchar("rateLimitKey", { length: 191 }).primaryKey(),
  count: integer("count").notNull().default(0),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  index("tikisse_rate_limits_updated_at_index").on(table.updatedAt),
]);

export type TikisseRateLimit = typeof tikisseRateLimits.$inferSelect;

/** Notes internes du support sur une fiche utilisateur. Jamais montrées à l'utilisateur. */
export const tikisseProfileNotes = pgTable("tikisse_profile_notes", {
  id: varchar("id", { length: 40 }).primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  body: varchar("body", { length: 1000 }).notNull(),
  adminId: integer("adminId").notNull(),
  adminEmail: varchar("adminEmail", { length: 180 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tikisse_profile_notes_profile_index").on(table.profilePhone, table.createdAt),
]);

export type TikisseProfileNote = typeof tikisseProfileNotes.$inferSelect;

/**
 * Comptes supprimés : correspondance numéro ↔ pseudonyme, gardée 10 ans pour la comptabilité, puis
 * effacée. Le numéro lui-même est remplacé par le pseudonyme dans toutes les autres tables.
 */
export const tikisseDeletedAccounts = pgTable("tikisse_deleted_accounts", {
  pseudonym: varchar("pseudonym", { length: 20 }).primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  accountType: tikisseDeletedAccountsAccountTypeEnum("accountType").notNull(),
  deletedAt: timestamp("deletedAt", { withTimezone: true }).defaultNow().notNull(),
  purgeAfter: timestamp("purgeAfter", { withTimezone: true }).notNull(),
  finalizedByAdminId: integer("finalizedByAdminId"),
}, (table) => [
  index("tikisse_deleted_accounts_phone_index").on(table.phone),
  index("tikisse_deleted_accounts_purge_index").on(table.purgeAfter),
]);

export type TikisseDeletedAccount = typeof tikisseDeletedAccounts.$inferSelect;

/** Fichiers à effacer du stockage, traités en tâche de fond avec reprise. */
export const tikisseStorageErasures = pgTable("tikisse_storage_erasures", {
  id: varchar("id", { length: 40 }).primaryKey(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  reason: varchar("reason", { length: 80 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: varchar("lastError", { length: 300 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  erasedAt: timestamp("erasedAt", { withTimezone: true }),
}, (table) => [
  index("tikisse_storage_erasures_pending_index").on(table.erasedAt, table.createdAt),
]);

/**
 * Exécutions des tâches planifiées (server/scheduled-jobs.ts). Une ligne par tâche et par créneau : l'index
 * unique garantit qu'un créneau ne tourne qu'une fois, même avec plusieurs serveurs. Sert aussi d'historique.
 */
export const tikisseScheduledJobRuns = pgTable("tikisse_scheduled_job_runs", {
  id: varchar("id", { length: 40 }).primaryKey(),
  jobName: varchar("jobName", { length: 60 }).notNull(),
  /** Heure prévue (ISO, UTC) pour une exécution planifiée ; « manual:<id> » pour un déclenchement à la main. */
  slot: varchar("slot", { length: 60 }).notNull(),
  trigger: tikisseScheduledJobRunsTriggerEnum("trigger").notNull().default("schedule"),
  status: tikisseScheduledJobRunsStatusEnum("status").notNull().default("running"),
  attempts: integer("attempts").notNull().default(1),
  startedAt: timestamp("startedAt", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finishedAt", { withTimezone: true }),
  /** Résumé JSON renvoyé par la tâche (nombre de courses clôturées, de comptes supprimés…). */
  result: text("result"),
  error: varchar("error", { length: 500 }),
}, (table) => [
  uniqueIndex("tikisse_scheduled_job_runs_job_slot_unique").on(table.jobName, table.slot),
  index("tikisse_scheduled_job_runs_job_started_index").on(table.jobName, table.startedAt),
]);

export type TikisseScheduledJobRun = typeof tikisseScheduledJobRuns.$inferSelect;
