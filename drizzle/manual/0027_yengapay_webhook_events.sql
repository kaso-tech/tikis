-- Ajout du provider "yengapay_live" + table d'événements webhook YengaPay.
-- À exécuter après la mise à jour du schéma Drizzle + redémarrage du backend.
--
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0027_yengapay_webhook_events.sql

-- 1) Élargir l'enum provider de tikis_payment_transactions
ALTER TABLE `tikis_payment_transactions`
  MODIFY COLUMN `provider` enum('ligdi_simulated','yengapay_test','yengapay_live') NOT NULL DEFAULT 'yengapay_test';

-- 2) Table d'événements webhook (idempotence + audit)
CREATE TABLE IF NOT EXISTS `tikis_yengapay_webhook_events` (
  `id` varchar(40) NOT NULL PRIMARY KEY,
  `provider` enum('yengapay_live') NOT NULL DEFAULT 'yengapay_live',
  `providerEventId` varchar(120) NOT NULL,
  `eventType` varchar(60) NOT NULL,
  `paymentTransactionId` varchar(40),
  `payload` text NOT NULL,
  `signature` varchar(200),
  `processedAt` timestamp NULL,
  `status` enum('received','processed','failed','ignored') NOT NULL DEFAULT 'received',
  `failureReason` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `tikis_yengapay_webhook_events_provider_event_unique` (`provider`, `providerEventId`),
  KEY `tikis_yengapay_webhook_events_status_index` (`status`, `createdAt`),
  KEY `tikis_yengapay_webhook_events_payment_index` (`paymentTransactionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
