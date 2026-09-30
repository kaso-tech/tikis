-- Données de référence, règles d'immuabilité et verrouillage de l'accès direct.
-- Écrit à la main (drizzle-kit generate --custom) : rien de ceci ne se déduit de drizzle/schema.ts.

-- ─── Données de référence ────────────────────────────────────────────────────────────────────────
-- Les pays desservis au lancement (repris de mysql-legacy/manual/0022) et le programme de fidélité par
-- défaut (0029). Sans effet sur une base qui les a déjà : les réglages faits depuis la console priment.
INSERT INTO "tikisse_supported_countries" ("id", "name", "dialCode", "digits", "groups", "timeZones", "enabled", "sortOrder") VALUES
  ('BF', 'Burkina Faso', '+226', 8, '2,2,2,2', 'Africa/Ouagadougou', true, 1),
  ('CI', 'Côte d’Ivoire', '+225', 10, '2,2,2,2,2', 'Africa/Abidjan', true, 2),
  ('ML', 'Mali', '+223', 8, '2,2,2,2', 'Africa/Bamako', true, 3),
  ('SN', 'Sénégal', '+221', 9, '2,3,2,2', 'Africa/Dakar', true, 4),
  ('TG', 'Togo', '+228', 8, '2,2,2,2', 'Africa/Lome', true, 5),
  ('GH', 'Ghana', '+233', 9, '2,3,4', 'Africa/Accra', true, 6),
  ('FR', 'France', '+33', 9, '1,2,2,2,2', 'Europe/Paris', true, 7)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "tikisse_loyalty_programs" ("id", "name", "description", "role", "requiredDeliveries", "bonusAmount", "windowDays", "enabled") VALUES
  ('default-driver-50', 'Fidélité livreur 50 courses', 'Bonus de 5 000 FCFA offert aux livreurs qui terminent 50 courses en 90 jours.', 'driver', 50, 5000, 90, true)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "tikisse_platform_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- ─── Journal d'audit : immuable ──────────────────────────────────────────────────────────────────
-- Sous TiDB, ces déclencheurs n'avaient jamais pu être posés (non pris en charge) : l'immuabilité ne
-- reposait que sur le code. PostgreSQL l'impose enfin à la base elle-même.
CREATE OR REPLACE FUNCTION tikisse_forbid_audit_log_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tikisse_admin_audit_log est immuable : % d’une entrée du journal d’audit interdite.',
    CASE TG_OP WHEN 'DELETE' THEN 'la suppression' ELSE 'la modification' END
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS tikisse_admin_audit_log_immutable ON "tikisse_admin_audit_log";--> statement-breakpoint
CREATE TRIGGER tikisse_admin_audit_log_immutable BEFORE UPDATE OR DELETE ON "tikisse_admin_audit_log"
  FOR EACH ROW EXECUTE FUNCTION tikisse_forbid_audit_log_change();--> statement-breakpoint

-- ─── Grand livre financier : immuable, sauf la pseudonymisation d'un compte supprimé ─────────────
-- server/admin-deletions.ts remplace le numéro par un pseudonyme « del-… » (colonne profilePhone et clé
-- anti-doublon) : c'est la seule modification admise. Montants, soldes, opération, motif et date ne
-- bougent jamais ; une écriture ne se supprime pas.
CREATE OR REPLACE FUNCTION tikisse_guard_wallet_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tikisse_wallet_ledger est immuable : la suppression d’une écriture du journal financier est interdite.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."id", NEW."deliveryId", NEW."operation", NEW."amount", NEW."availableBefore", NEW."availableAfter",
      NEW."heldBefore", NEW."heldAfter", NEW."reason", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."deliveryId", OLD."operation", OLD."amount", OLD."availableBefore", OLD."availableAfter",
      OLD."heldBefore", OLD."heldAfter", OLD."reason", OLD."createdAt")
     OR NOT (NEW."profilePhone" LIKE 'del-%' OR NEW."idempotencyKey" LIKE '%del-%') THEN
    RAISE EXCEPTION 'tikisse_wallet_ledger est immuable : la modification d’une écriture du journal financier est interdite.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS tikisse_wallet_ledger_immutable ON "tikisse_wallet_ledger";--> statement-breakpoint
CREATE TRIGGER tikisse_wallet_ledger_immutable BEFORE UPDATE OR DELETE ON "tikisse_wallet_ledger"
  FOR EACH ROW EXECUTE FUNCTION tikisse_guard_wallet_ledger();--> statement-breakpoint

-- ─── Aucun accès direct depuis l'API publique de Supabase ───────────────────────────────────────
-- Supabase expose le schéma public par son API REST à quiconque détient la clé « anon » — présente
-- dans l'application, donc publique. Toutes les données passent par le serveur Tikisse, qui se
-- connecte en propriétaire des tables et n'est pas concerné par la sécurité au niveau des lignes.
-- RLS activée sans aucune politique : l'API publique ne lit ni n'écrit rien.
ALTER TABLE "tikisse_admin_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_admin_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_admin_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_admin_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_daily_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_deleted_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_delivery_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_delivery_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_delivery_live_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_delivery_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_delivery_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_driver_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_favorite_places" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_kyc_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_loyalty_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_loyalty_programs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_payment_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_places" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_platform_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_profile_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_profile_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_push_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_referrals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_storage_erasures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_supported_countries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_wallet_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_wallets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tikisse_yengapay_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    -- tikisse_delivery_channel_members (supabase/realtime_auth_phone_rls.sql) garde ses propres droits.
    EXECUTE (
      SELECT coalesce(string_agg(format('REVOKE ALL ON TABLE public.%I FROM authenticated', tablename), '; '), 'SELECT 1')
      FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'tikisse_delivery_channel_members'
    );
  END IF;
END;
$$;
