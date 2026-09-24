-- Active les transactions YengaPay Sandbox et mémorise l’URL de checkout renvoyée par le PSP.
-- À exécuter après 0027_yengapay_webhook_events.sql :
-- mysql -u <user> -p <database> < drizzle/manual/0039_yengapay_sandbox_checkout.sql

ALTER TABLE `tikis_payment_transactions`
  MODIFY COLUMN `provider` enum('ligdi_simulated','yengapay_test','yengapay_sandbox','yengapay_live') NOT NULL DEFAULT 'yengapay_test',
  ADD COLUMN `checkoutUrl` varchar(1000) NULL AFTER `providerReference`;

ALTER TABLE `tikis_yengapay_webhook_events`
  MODIFY COLUMN `provider` enum('yengapay_sandbox','yengapay_live') NOT NULL DEFAULT 'yengapay_live';
