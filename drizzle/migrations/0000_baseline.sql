CREATE TYPE "public"."tikisse_admin_approvals_action" AS ENUM('wallet_bonus', 'wallet_penalty', 'withdrawal_settle', 'delivery_refund');--> statement-breakpoint
CREATE TYPE "public"."tikisse_admin_approvals_status" AS ENUM('pending', 'approved', 'executed', 'failed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tikisse_admin_sessions_stage" AS ENUM('pending_totp', 'active');--> statement-breakpoint
CREATE TYPE "public"."tikisse_admin_users_role" AS ENUM('super_admin', 'support', 'finance', 'viewer', 'kyc_reviewer');--> statement-breakpoint
CREATE TYPE "public"."tikisse_deleted_accounts_account_type" AS ENUM('sender', 'driver');--> statement-breakpoint
CREATE TYPE "public"."tikisse_deliveries_delivery_type" AS ENUM('Plis', 'Personne', 'Autre');--> statement-breakpoint
CREATE TYPE "public"."tikisse_deliveries_route_source" AS ENUM('routes', 'provisional');--> statement-breakpoint
CREATE TYPE "public"."tikisse_deliveries_status" AS ENUM('draft', 'open', 'pending_confirmation', 'active', 'completed', 'disabled', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."tikisse_delivery_candidates_status" AS ENUM('applied', 'selected', 'confirmed', 'withdrawn', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."tikisse_delivery_events_status" AS ENUM('draft', 'open', 'pending_confirmation', 'active', 'completed', 'disabled', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."tikisse_delivery_events_tone" AS ENUM('info', 'success', 'warning');--> statement-breakpoint
CREATE TYPE "public"."tikisse_delivery_reports_reporter_role" AS ENUM('sender', 'driver');--> statement-breakpoint
CREATE TYPE "public"."tikisse_delivery_reports_status" AS ENUM('open', 'reviewing', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."tikisse_kyc_submissions_status" AS ENUM('submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."tikisse_loyalty_grants_status" AS ENUM('pending', 'credited', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tikisse_loyalty_programs_role" AS ENUM('sender', 'driver');--> statement-breakpoint
CREATE TYPE "public"."tikisse_payment_transactions_provider" AS ENUM('ligdi_simulated', 'yengapay_test', 'yengapay_sandbox', 'yengapay_live', 'yengapay_direct_test', 'yengapay_direct_sandbox', 'yengapay_direct_live', 'manual_payout');--> statement-breakpoint
CREATE TYPE "public"."tikisse_payment_transactions_status" AS ENUM('pending', 'succeeded', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."tikisse_payment_transactions_type" AS ENUM('deposit', 'withdrawal');--> statement-breakpoint
CREATE TYPE "public"."tikisse_profile_sessions_platform" AS ENUM('ios', 'android', 'web', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."tikisse_profiles_account_type" AS ENUM('sender', 'driver');--> statement-breakpoint
CREATE TYPE "public"."tikisse_profiles_status" AS ENUM('active', 'suspended', 'banned');--> statement-breakpoint
CREATE TYPE "public"."tikisse_push_tokens_platform" AS ENUM('ios', 'android', 'web');--> statement-breakpoint
CREATE TYPE "public"."tikisse_referrals_status" AS ENUM('invited', 'qualified', 'rewarded', 'voided');--> statement-breakpoint
CREATE TYPE "public"."tikisse_wallet_ledger_operation" AS ENUM('block', 'unblock', 'debit', 'commission_debit', 'compensation', 'credit', 'refund', 'deposit_request', 'withdrawal_request', 'bonus', 'penalty');--> statement-breakpoint
CREATE TYPE "public"."tikisse_yengapay_webhook_events_provider" AS ENUM('yengapay_sandbox', 'yengapay_live', 'yengapay_direct_sandbox', 'yengapay_direct_live');--> statement-breakpoint
CREATE TYPE "public"."tikisse_yengapay_webhook_events_status" AS ENUM('received', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."users_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "tikisse_admin_approvals" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"action" "tikisse_admin_approvals_action" NOT NULL,
	"amount" integer NOT NULL,
	"targetPhone" varchar(20) NOT NULL,
	"targetRef" varchar(80) NOT NULL,
	"payload" text NOT NULL,
	"status" "tikisse_admin_approvals_status" DEFAULT 'pending' NOT NULL,
	"requestedByAdminId" integer NOT NULL,
	"requestedByEmail" varchar(180) NOT NULL,
	"decidedByAdminId" integer,
	"decidedByEmail" varchar(180),
	"decisionNote" varchar(300),
	"failureReason" varchar(500),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"decidedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tikisse_admin_audit_log" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"adminId" integer NOT NULL,
	"adminEmail" varchar(180) NOT NULL,
	"action" varchar(80) NOT NULL,
	"targetType" varchar(40) NOT NULL,
	"targetId" varchar(80) NOT NULL,
	"details" text,
	"ipAddress" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_admin_sessions" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"adminId" integer NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"ipAddress" varchar(64),
	"userAgent" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone,
	"stage" "tikisse_admin_sessions_stage" DEFAULT 'active' NOT NULL,
	CONSTRAINT "tikisse_admin_sessions_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "tikisse_admin_users" (
	"id" integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "tikisse_admin_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" varchar(180) NOT NULL,
	"passwordHash" varchar(255) NOT NULL,
	"fullName" varchar(120) NOT NULL,
	"role" "tikisse_admin_users_role" DEFAULT 'support' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"mustChangePassword" boolean DEFAULT false NOT NULL,
	"totpSecret" varchar(255),
	"totpPendingSecret" varchar(255),
	"totpEnabledAt" timestamp with time zone,
	"totpLastUsedStep" bigint,
	"totpRecoveryCodes" text,
	"lastLoginAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tikisse_admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "tikisse_daily_metrics" (
	"date" varchar(10) PRIMARY KEY NOT NULL,
	"deliveriesCreated" integer DEFAULT 0 NOT NULL,
	"deliveriesCompleted" integer DEFAULT 0 NOT NULL,
	"deliveriesCancelled" integer DEFAULT 0 NOT NULL,
	"gmvTotal" integer DEFAULT 0 NOT NULL,
	"commissionTotal" integer DEFAULT 0 NOT NULL,
	"newDrivers" integer DEFAULT 0 NOT NULL,
	"newSenders" integer DEFAULT 0 NOT NULL,
	"activeDrivers" integer DEFAULT 0 NOT NULL,
	"activeSenders" integer DEFAULT 0 NOT NULL,
	"bonusAwarded" integer DEFAULT 0 NOT NULL,
	"reportsOpened" integer DEFAULT 0 NOT NULL,
	"computedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_deleted_accounts" (
	"pseudonym" varchar(20) PRIMARY KEY NOT NULL,
	"phone" varchar(20) NOT NULL,
	"accountType" "tikisse_deleted_accounts_account_type" NOT NULL,
	"deletedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"purgeAfter" timestamp with time zone NOT NULL,
	"finalizedByAdminId" integer
);
--> statement-breakpoint
CREATE TABLE "tikisse_deliveries" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"senderPhone" varchar(20) NOT NULL,
	"pickupPlaceId" integer NOT NULL,
	"dropoffPlaceId" integer NOT NULL,
	"title" varchar(120) NOT NULL,
	"details" varchar(450) NOT NULL,
	"deliveryType" "tikisse_deliveries_delivery_type" NOT NULL,
	"status" "tikisse_deliveries_status" DEFAULT 'open' NOT NULL,
	"distanceKm" numeric(10, 2) NOT NULL,
	"routeSource" "tikisse_deliveries_route_source" DEFAULT 'provisional' NOT NULL,
	"estimatedPrice" integer NOT NULL,
	"offeredPrice" integer,
	"accruedCommission" integer,
	"vehicleTypes" varchar(120) NOT NULL,
	"weightKg" numeric(8, 2),
	"lengthCm" integer,
	"widthCm" integer,
	"heightCm" integer,
	"passengers" integer,
	"driverPhone" varchar(20),
	"previousDriverPhone" varchar(20),
	"selectedAt" timestamp with time zone,
	"confirmedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"cancelledAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_delivery_candidates" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"deliveryId" varchar(40) NOT NULL,
	"driverPhone" varchar(20) NOT NULL,
	"offerPrice" integer,
	"status" "tikisse_delivery_candidates_status" DEFAULT 'applied' NOT NULL,
	"commissionBlocked" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_delivery_events" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"deliveryId" varchar(40) NOT NULL,
	"eventType" varchar(48) NOT NULL,
	"status" "tikisse_delivery_events_status",
	"actorPhone" varchar(20),
	"recipientPhone" varchar(20) NOT NULL,
	"title" varchar(120) NOT NULL,
	"body" varchar(300) NOT NULL,
	"tone" "tikisse_delivery_events_tone" DEFAULT 'info' NOT NULL,
	"metadata" text,
	"feedHidden" boolean DEFAULT false NOT NULL,
	"idempotencyKey" varchar(100) NOT NULL,
	"readAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tikisse_delivery_events_idempotencyKey_unique" UNIQUE("idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE "tikisse_delivery_live_locations" (
	"deliveryId" varchar(40) PRIMARY KEY NOT NULL,
	"driverPhone" varchar(20) NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"heading" numeric(6, 2) DEFAULT '0' NOT NULL,
	"recordedAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_delivery_reports" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"deliveryId" varchar(40) NOT NULL,
	"reporterPhone" varchar(20) NOT NULL,
	"reporterRole" "tikisse_delivery_reports_reporter_role" NOT NULL,
	"reason" varchar(80) NOT NULL,
	"description" varchar(1000) NOT NULL,
	"attachmentKey" varchar(255),
	"status" "tikisse_delivery_reports_status" DEFAULT 'open' NOT NULL,
	"resolutionNotes" varchar(1000),
	"resolvedByAdminId" integer,
	"resolvedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_delivery_reviews" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"deliveryId" varchar(40) NOT NULL,
	"reviewerPhone" varchar(20) NOT NULL,
	"driverPhone" varchar(20) NOT NULL,
	"rating" integer NOT NULL,
	"comment" varchar(500),
	"hiddenAt" timestamp with time zone,
	"hiddenReason" varchar(300),
	"hiddenByAdminId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_driver_preferences" (
	"profilePhone" varchar(20) PRIMARY KEY NOT NULL,
	"opportunityPushEnabled" boolean DEFAULT false NOT NULL,
	"alertRadiusKm" integer,
	"discoveryRadiusKm" integer,
	"baseLatitude" numeric(10, 7),
	"baseLongitude" numeric(10, 7),
	"baseUpdatedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_favorite_places" (
	"id" integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "tikisse_favorite_places_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"profilePhone" varchar(20) NOT NULL,
	"placeId" integer NOT NULL,
	"label" varchar(80) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_kyc_submissions" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"driverPhone" varchar(20) NOT NULL,
	"idFrontKey" varchar(255) NOT NULL,
	"idBackKey" varchar(255) NOT NULL,
	"selfieKey" varchar(255) NOT NULL,
	"status" "tikisse_kyc_submissions_status" DEFAULT 'submitted' NOT NULL,
	"rejectionReason" varchar(500),
	"submittedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewedAt" timestamp with time zone,
	"reviewedByAdminId" integer,
	"documentsErasedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tikisse_loyalty_grants" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"programId" varchar(40) NOT NULL,
	"profilePhone" varchar(20) NOT NULL,
	"deliveryId" varchar(40),
	"bonusAmount" integer NOT NULL,
	"status" "tikisse_loyalty_grants_status" DEFAULT 'pending' NOT NULL,
	"ledgerEntryId" varchar(40),
	"grantedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"creditedAt" timestamp with time zone,
	"expiresAt" timestamp with time zone,
	"cancelledReason" varchar(300)
);
--> statement-breakpoint
CREATE TABLE "tikisse_loyalty_programs" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(300),
	"role" "tikisse_loyalty_programs_role" NOT NULL,
	"requiredDeliveries" integer NOT NULL,
	"bonusAmount" integer NOT NULL,
	"windowDays" integer DEFAULT 90 NOT NULL,
	"autoCredit" boolean DEFAULT false NOT NULL,
	"autoCreditMaxAmount" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_payment_transactions" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"profilePhone" varchar(20) NOT NULL,
	"type" "tikisse_payment_transactions_type" NOT NULL,
	"provider" "tikisse_payment_transactions_provider" DEFAULT 'yengapay_test' NOT NULL,
	"amount" integer NOT NULL,
	"status" "tikisse_payment_transactions_status" DEFAULT 'pending' NOT NULL,
	"providerReference" varchar(80) NOT NULL,
	"checkoutUrl" varchar(1000),
	"ussdCode" varchar(64),
	"phoneE164" varchar(24),
	"operatorCode" varchar(16),
	"countryCode" varchar(4),
	"expiresAt" timestamp with time zone,
	"idempotencyKey" varchar(100) NOT NULL,
	"settledAt" timestamp with time zone,
	"payoutReference" varchar(80),
	"adminNotes" varchar(300),
	"settledByAdminId" integer,
	"providerReportedAmount" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tikisse_payment_transactions_providerReference_unique" UNIQUE("providerReference"),
	CONSTRAINT "tikisse_payment_transactions_idempotencyKey_unique" UNIQUE("idempotencyKey"),
	CONSTRAINT "tikisse_payment_transactions_payoutReference_unique" UNIQUE("payoutReference")
);
--> statement-breakpoint
CREATE TABLE "tikisse_places" (
	"id" integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "tikisse_places_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"googlePlaceId" varchar(255),
	"mapboxPlaceId" varchar(255),
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"formattedAddress" varchar(255) NOT NULL,
	"placeName" varchar(140) NOT NULL,
	"street" varchar(160),
	"district" varchar(120),
	"city" varchar(120),
	"province" varchar(120),
	"country" varchar(120),
	"provider" varchar(16) DEFAULT 'legacy' NOT NULL,
	"source" varchar(16) DEFAULT 'legacy' NOT NULL,
	"featureType" varchar(32) DEFAULT 'unknown' NOT NULL,
	"precision" varchar(16) DEFAULT 'unknown' NOT NULL,
	"coordinateKey" varchar(32) DEFAULT 'legacy' NOT NULL,
	"resolvedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tikisse_places_googlePlaceId_unique" UNIQUE("googlePlaceId"),
	CONSTRAINT "tikisse_places_mapboxPlaceId_unique" UNIQUE("mapboxPlaceId")
);
--> statement-breakpoint
CREATE TABLE "tikisse_platform_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"commissionRate" numeric(6, 5) DEFAULT '0.10000' NOT NULL,
	"referralRewardAmount" integer DEFAULT 1000 NOT NULL,
	"referralEnabled" boolean DEFAULT true NOT NULL,
	"referralRequiredDeliveries" integer DEFAULT 1 NOT NULL,
	"minWithdrawal" integer DEFAULT 500 NOT NULL,
	"maxWithdrawal" integer DEFAULT 500000 NOT NULL,
	"pricingConfig" text,
	"maintenanceEnabled" boolean DEFAULT false NOT NULL,
	"maintenanceMessage" varchar(500),
	"adminTotpRequired" boolean DEFAULT false NOT NULL,
	"adminApprovalThreshold" integer DEFAULT 100000 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_profile_notes" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"profilePhone" varchar(20) NOT NULL,
	"body" varchar(1000) NOT NULL,
	"adminId" integer NOT NULL,
	"adminEmail" varchar(180) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_profile_sessions" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"phone" varchar(20) NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"tokenLast4" varchar(4) NOT NULL,
	"deviceName" varchar(120),
	"platform" "tikisse_profile_sessions_platform" DEFAULT 'unknown' NOT NULL,
	"appVersion" varchar(40),
	"ipAddress" varchar(45),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"revokedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tikisse_profiles" (
	"id" integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "tikisse_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"phone" varchar(20) NOT NULL,
	"fullName" varchar(70) NOT NULL,
	"accountType" "tikisse_profiles_account_type" NOT NULL,
	"vehicles" text NOT NULL,
	"photoKey" varchar(512),
	"email" varchar(320),
	"phoneVerified" boolean DEFAULT true NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"referralCode" varchar(8),
	"supabaseUserId" varchar(64),
	"status" "tikisse_profiles_status" DEFAULT 'active' NOT NULL,
	"statusReason" varchar(500),
	"statusUpdatedAt" timestamp with time zone,
	"statusUpdatedByAdminId" integer,
	"country" varchar(2),
	"city" varchar(80),
	"deletionRequestedAt" timestamp with time zone,
	"deletionScheduledAt" timestamp with time zone,
	"deletedAt" timestamp with time zone,
	"sessionsRevokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tikisse_profiles_phone_unique" UNIQUE("phone"),
	CONSTRAINT "tikisse_profiles_referralCode_unique" UNIQUE("referralCode"),
	CONSTRAINT "tikisse_profiles_supabaseUserId_unique" UNIQUE("supabaseUserId")
);
--> statement-breakpoint
CREATE TABLE "tikisse_push_tokens" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"phone" varchar(20) NOT NULL,
	"token" varchar(200) NOT NULL,
	"platform" "tikisse_push_tokens_platform" DEFAULT 'android' NOT NULL,
	"appVersion" varchar(40),
	"deviceName" varchar(120),
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_rate_limits" (
	"rateLimitKey" varchar(191) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_referrals" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"referrerPhone" varchar(20) NOT NULL,
	"refereePhone" varchar(20) NOT NULL,
	"referralCode" varchar(8) NOT NULL,
	"status" "tikisse_referrals_status" DEFAULT 'invited' NOT NULL,
	"rewardAmount" integer NOT NULL,
	"qualifyingDeliveryId" varchar(40),
	"qualifiedAt" timestamp with time zone,
	"rewardedAt" timestamp with time zone,
	"rewardedByAdminId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tikisse_referrals_refereePhone_unique" UNIQUE("refereePhone")
);
--> statement-breakpoint
CREATE TABLE "tikisse_storage_erasures" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"storageKey" varchar(512) NOT NULL,
	"reason" varchar(80) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" varchar(300),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"erasedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tikisse_supported_countries" (
	"id" varchar(2) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"dialCode" varchar(6) NOT NULL,
	"digits" integer NOT NULL,
	"groups" varchar(40) NOT NULL,
	"timeZones" varchar(200) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tikisse_wallet_ledger" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"profilePhone" varchar(20) NOT NULL,
	"deliveryId" varchar(40),
	"operation" "tikisse_wallet_ledger_operation" NOT NULL,
	"amount" integer NOT NULL,
	"availableBefore" integer NOT NULL,
	"availableAfter" integer NOT NULL,
	"heldBefore" integer NOT NULL,
	"heldAfter" integer NOT NULL,
	"reason" varchar(255) NOT NULL,
	"idempotencyKey" varchar(100) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tikisse_wallet_ledger_idempotencyKey_unique" UNIQUE("idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE "tikisse_wallets" (
	"id" integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "tikisse_wallets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"profilePhone" varchar(20) NOT NULL,
	"availableBalance" integer DEFAULT 0 NOT NULL,
	"heldBalance" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'XOF' NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tikisse_wallets_profilePhone_unique" UNIQUE("profilePhone")
);
--> statement-breakpoint
CREATE TABLE "tikisse_yengapay_webhook_events" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"provider" "tikisse_yengapay_webhook_events_provider" DEFAULT 'yengapay_live' NOT NULL,
	"providerEventId" varchar(120) NOT NULL,
	"eventType" varchar(60) NOT NULL,
	"paymentTransactionId" varchar(40),
	"payload" text NOT NULL,
	"signature" varchar(200),
	"processedAt" timestamp with time zone,
	"status" "tikisse_yengapay_webhook_events_status" DEFAULT 'received' NOT NULL,
	"failureReason" varchar(500),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "users_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE INDEX "tikisse_admin_approvals_status_index" ON "tikisse_admin_approvals" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_admin_approvals_target_index" ON "tikisse_admin_approvals" USING btree ("targetRef","status");--> statement-breakpoint
CREATE INDEX "tikisse_admin_audit_log_target_index" ON "tikisse_admin_audit_log" USING btree ("targetType","targetId");--> statement-breakpoint
CREATE INDEX "tikisse_admin_audit_log_admin_created_index" ON "tikisse_admin_audit_log" USING btree ("adminId","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_admin_sessions_admin_index" ON "tikisse_admin_sessions" USING btree ("adminId","revokedAt");--> statement-breakpoint
CREATE INDEX "tikisse_daily_metrics_date_index" ON "tikisse_daily_metrics" USING btree ("date");--> statement-breakpoint
CREATE INDEX "tikisse_deleted_accounts_phone_index" ON "tikisse_deleted_accounts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "tikisse_deleted_accounts_purge_index" ON "tikisse_deleted_accounts" USING btree ("purgeAfter");--> statement-breakpoint
CREATE INDEX "tikisse_deliveries_sender_status_index" ON "tikisse_deliveries" USING btree ("senderPhone","status");--> statement-breakpoint
CREATE INDEX "tikisse_deliveries_driver_status_index" ON "tikisse_deliveries" USING btree ("driverPhone","status");--> statement-breakpoint
CREATE INDEX "tikisse_deliveries_status_created_index" ON "tikisse_deliveries" USING btree ("status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "tikisse_delivery_candidates_delivery_driver_unique" ON "tikisse_delivery_candidates" USING btree ("deliveryId","driverPhone");--> statement-breakpoint
CREATE INDEX "tikisse_delivery_candidates_delivery_status_index" ON "tikisse_delivery_candidates" USING btree ("deliveryId","status");--> statement-breakpoint
CREATE INDEX "tikisse_delivery_candidates_driver_status_index" ON "tikisse_delivery_candidates" USING btree ("driverPhone","status");--> statement-breakpoint
CREATE INDEX "tikisse_delivery_events_recipient_created_index" ON "tikisse_delivery_events" USING btree ("recipientPhone","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_delivery_events_delivery_created_index" ON "tikisse_delivery_events" USING btree ("deliveryId","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_delivery_live_locations_driver_index" ON "tikisse_delivery_live_locations" USING btree ("driverPhone","updatedAt");--> statement-breakpoint
CREATE INDEX "tikisse_delivery_reports_status_created_index" ON "tikisse_delivery_reports" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_delivery_reports_delivery_index" ON "tikisse_delivery_reports" USING btree ("deliveryId");--> statement-breakpoint
CREATE INDEX "tikisse_delivery_reports_reporter_index" ON "tikisse_delivery_reports" USING btree ("reporterPhone");--> statement-breakpoint
CREATE UNIQUE INDEX "tikisse_delivery_reviews_delivery_reviewer_unique" ON "tikisse_delivery_reviews" USING btree ("deliveryId","reviewerPhone");--> statement-breakpoint
CREATE INDEX "tikisse_delivery_reviews_driver_index" ON "tikisse_delivery_reviews" USING btree ("driverPhone");--> statement-breakpoint
CREATE UNIQUE INDEX "tikisse_favorite_places_profile_place_unique" ON "tikisse_favorite_places" USING btree ("profilePhone","placeId");--> statement-breakpoint
CREATE INDEX "tikisse_kyc_submissions_driver_index" ON "tikisse_kyc_submissions" USING btree ("driverPhone","submittedAt");--> statement-breakpoint
CREATE INDEX "tikisse_kyc_submissions_status_index" ON "tikisse_kyc_submissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tikisse_loyalty_grants_program_delivery_unique" ON "tikisse_loyalty_grants" USING btree ("programId","deliveryId");--> statement-breakpoint
CREATE INDEX "tikisse_loyalty_grants_profile_index" ON "tikisse_loyalty_grants" USING btree ("profilePhone","grantedAt");--> statement-breakpoint
CREATE INDEX "tikisse_loyalty_grants_status_index" ON "tikisse_loyalty_grants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tikisse_loyalty_grants_expires_index" ON "tikisse_loyalty_grants" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "tikisse_loyalty_programs_role_index" ON "tikisse_loyalty_programs" USING btree ("role","enabled");--> statement-breakpoint
CREATE INDEX "tikisse_payment_transactions_profile_created_index" ON "tikisse_payment_transactions" USING btree ("profilePhone","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_payment_transactions_status_index" ON "tikisse_payment_transactions" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_payment_transactions_operator_status_index" ON "tikisse_payment_transactions" USING btree ("operatorCode","status","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_places_coordinate_key_index" ON "tikisse_places" USING btree ("coordinateKey");--> statement-breakpoint
CREATE INDEX "tikisse_places_coordinates_index" ON "tikisse_places" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "tikisse_profile_notes_profile_index" ON "tikisse_profile_notes" USING btree ("profilePhone","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_profile_sessions_phone_index" ON "tikisse_profile_sessions" USING btree ("phone","lastSeenAt");--> statement-breakpoint
CREATE UNIQUE INDEX "tikisse_profile_sessions_phone_token_unique" ON "tikisse_profile_sessions" USING btree ("phone","tokenHash");--> statement-breakpoint
CREATE UNIQUE INDEX "tikisse_push_tokens_phone_token_unique" ON "tikisse_push_tokens" USING btree ("phone","token");--> statement-breakpoint
CREATE INDEX "tikisse_push_tokens_phone_index" ON "tikisse_push_tokens" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "tikisse_push_tokens_last_seen_index" ON "tikisse_push_tokens" USING btree ("lastSeenAt");--> statement-breakpoint
CREATE INDEX "tikisse_rate_limits_updated_at_index" ON "tikisse_rate_limits" USING btree ("updatedAt");--> statement-breakpoint
CREATE INDEX "tikisse_referrals_referrer_index" ON "tikisse_referrals" USING btree ("referrerPhone","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_referrals_status_index" ON "tikisse_referrals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tikisse_storage_erasures_pending_index" ON "tikisse_storage_erasures" USING btree ("erasedAt","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_wallet_ledger_profile_created_index" ON "tikisse_wallet_ledger" USING btree ("profilePhone","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_wallet_ledger_delivery_index" ON "tikisse_wallet_ledger" USING btree ("deliveryId");--> statement-breakpoint
CREATE UNIQUE INDEX "tikisse_yengapay_webhook_events_provider_event_unique" ON "tikisse_yengapay_webhook_events" USING btree ("provider","providerEventId");--> statement-breakpoint
CREATE INDEX "tikisse_yengapay_webhook_events_status_index" ON "tikisse_yengapay_webhook_events" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "tikisse_yengapay_webhook_events_payment_index" ON "tikisse_yengapay_webhook_events" USING btree ("paymentTransactionId");