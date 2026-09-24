-- Paiement Mobile Money direct (in-app) : colonnes supplémentaires sur tikis_payment_transactions
-- pour stocker le code USSD, le numéro E.164, l'opérateur et le pays.
-- Le checkoutUrl reste utilisé pour les paiements "checkout web" (provider=yengapay_sandbox/live
-- + URL checkout.yengapay.com) ; pour les paiements directs (provider=yengapay_direct), on stocke
-- une URL factice de type "tel:*144*4*6*<montant>#" dans checkoutUrl pour réutiliser le champ
-- existant, et on stocke le code USSD "humain" dans `ussdCode` pour l'affichage côté client.
--
-- Cette migration est idempotente (IF NOT EXISTS sur les colonnes / indexes).

ALTER TABLE `tikis_payment_transactions`
  MODIFY COLUMN `provider` enum('ligdi_simulated','yengapay_test','yengapay_sandbox','yengapay_live','yengapay_direct_test','yengapay_direct_sandbox','yengapay_direct_live') NOT NULL DEFAULT 'yengapay_test';

ALTER TABLE `tikis_payment_transactions`
  ADD COLUMN IF NOT EXISTS `ussdCode` varchar(64) DEFAULT NULL AFTER `checkoutUrl`,
  ADD COLUMN IF NOT EXISTS `phoneE164` varchar(24) DEFAULT NULL AFTER `ussdCode`,
  ADD COLUMN IF NOT EXISTS `operatorCode` varchar(16) DEFAULT NULL AFTER `phoneE164`,
  ADD COLUMN IF NOT EXISTS `countryCode` varchar(4) DEFAULT NULL AFTER `operatorCode`,
  ADD COLUMN IF NOT EXISTS `expiresAt` timestamp NULL DEFAULT NULL AFTER `countryCode`;

-- Index pour le polling des paiements directs en attente.
CREATE INDEX IF NOT EXISTS `tikis_payment_transactions_operator_status_index`
  ON `tikis_payment_transactions` (`operatorCode`, `status`, `createdAt`);
