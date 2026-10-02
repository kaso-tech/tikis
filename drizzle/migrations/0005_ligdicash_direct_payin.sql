ALTER TYPE "public"."tikisse_payment_transactions_provider" ADD VALUE 'ligdicash_direct_sandbox';--> statement-breakpoint
ALTER TYPE "public"."tikisse_payment_transactions_provider" ADD VALUE 'ligdicash_direct_live';--> statement-breakpoint
ALTER TABLE "tikisse_payment_transactions" ADD COLUMN "providerToken" text;