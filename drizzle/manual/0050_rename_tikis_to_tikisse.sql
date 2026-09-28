-- Renommage de la marque Tikis en Tikisse : toutes les tables applicatives passent du préfixe
-- `tikis_` au préfixe `tikisse_`.
--
-- MySQL ne fournit pas `RENAME TABLE ... IF EXISTS` ; le bloc ci-dessous le simule pour rester
-- idempotent (une deuxième exécution, ou une exécution sur une base déjà renommée, ne fait rien),
-- comme toutes les migrations manuelles de ce dossier.
--
-- ⚠️ À exécuter AVANT de déployer le code serveur de ce commit (drizzle/schema.ts ne connaît plus
-- que les noms `tikisse_*`) : le serveur échouera sur toute requête tant que cette migration n'a
-- pas tourné.
--
-- Appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0050_rename_tikis_to_tikisse.sql

DELIMITER $$
CREATE PROCEDURE tikisse_rename_if_exists(IN old_name VARCHAR(64), IN new_name VARCHAR(64))
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = old_name)
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = new_name) THEN
    SET @stmt = CONCAT('RENAME TABLE `', old_name, '` TO `', new_name, '`');
    PREPARE stmt FROM @stmt;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL tikisse_rename_if_exists('tikis_admin_approvals', 'tikisse_admin_approvals');
CALL tikisse_rename_if_exists('tikis_admin_audit_log', 'tikisse_admin_audit_log');
CALL tikisse_rename_if_exists('tikis_admin_sessions', 'tikisse_admin_sessions');
CALL tikisse_rename_if_exists('tikis_admin_users', 'tikisse_admin_users');
CALL tikisse_rename_if_exists('tikis_daily_metrics', 'tikisse_daily_metrics');
CALL tikisse_rename_if_exists('tikis_deleted_accounts', 'tikisse_deleted_accounts');
CALL tikisse_rename_if_exists('tikis_deliveries', 'tikisse_deliveries');
CALL tikisse_rename_if_exists('tikis_delivery_candidates', 'tikisse_delivery_candidates');
CALL tikisse_rename_if_exists('tikis_delivery_events', 'tikisse_delivery_events');
CALL tikisse_rename_if_exists('tikis_delivery_live_locations', 'tikisse_delivery_live_locations');
CALL tikisse_rename_if_exists('tikis_delivery_reports', 'tikisse_delivery_reports');
CALL tikisse_rename_if_exists('tikis_delivery_reviews', 'tikisse_delivery_reviews');
CALL tikisse_rename_if_exists('tikis_driver_preferences', 'tikisse_driver_preferences');
CALL tikisse_rename_if_exists('tikis_favorite_places', 'tikisse_favorite_places');
CALL tikisse_rename_if_exists('tikis_kyc_submissions', 'tikisse_kyc_submissions');
CALL tikisse_rename_if_exists('tikis_loyalty_grants', 'tikisse_loyalty_grants');
CALL tikisse_rename_if_exists('tikis_loyalty_programs', 'tikisse_loyalty_programs');
CALL tikisse_rename_if_exists('tikis_payment_transactions', 'tikisse_payment_transactions');
CALL tikisse_rename_if_exists('tikis_places', 'tikisse_places');
CALL tikisse_rename_if_exists('tikis_platform_settings', 'tikisse_platform_settings');
CALL tikisse_rename_if_exists('tikis_profile_notes', 'tikisse_profile_notes');
CALL tikisse_rename_if_exists('tikis_profile_sessions', 'tikisse_profile_sessions');
CALL tikisse_rename_if_exists('tikis_profiles', 'tikisse_profiles');
CALL tikisse_rename_if_exists('tikis_push_tokens', 'tikisse_push_tokens');
CALL tikisse_rename_if_exists('tikis_rate_limits', 'tikisse_rate_limits');
CALL tikisse_rename_if_exists('tikis_referrals', 'tikisse_referrals');
CALL tikisse_rename_if_exists('tikis_storage_erasures', 'tikisse_storage_erasures');
CALL tikisse_rename_if_exists('tikis_supported_countries', 'tikisse_supported_countries');
CALL tikisse_rename_if_exists('tikis_wallet_ledger', 'tikisse_wallet_ledger');
CALL tikisse_rename_if_exists('tikis_wallets', 'tikisse_wallets');
CALL tikisse_rename_if_exists('tikis_yengapay_webhook_events', 'tikisse_yengapay_webhook_events');

DROP PROCEDURE tikisse_rename_if_exists;
