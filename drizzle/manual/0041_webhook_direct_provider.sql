-- Étend la table tikis_yengapay_webhook_events pour distinguer les paiements directs
-- (Mobile Money in-app, sans checkout web) des paiements checkout.
-- L'enum passe de ('yengapay_sandbox','yengapay_live') à
-- ('yengapay_sandbox','yengapay_live','yengapay_direct_sandbox','yengapay_direct_live').
-- Migration idempotente : on vérifie d'abord la définition actuelle.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'tikis_yengapay_webhook_events'
    AND column_name = 'provider'
);
SET @stmt := IF(
  @col_exists > 0
  AND LOCATE('yengapay_direct_sandbox', COLUMN_TYPE) = 0,
  'ALTER TABLE `tikis_yengapay_webhook_events` MODIFY COLUMN `provider` enum(''yengapay_sandbox'',''yengapay_live'',''yengapay_direct_sandbox'',''yengapay_direct_live'') NOT NULL DEFAULT ''yengapay_live''',
  'SELECT 1'
);
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
