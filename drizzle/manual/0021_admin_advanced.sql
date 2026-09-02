-- Fonctionnalités avancées de la console admin : gestion des comptes (statut), parrainage réel,
-- réglages financiers étendus, mouvements de type bonus/pénalité.
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0021_admin_advanced.sql

ALTER TABLE `tikis_profiles`
  ADD COLUMN `status` enum('active','suspended','banned') NOT NULL DEFAULT 'active',
  ADD COLUMN `statusReason` varchar(500),
  ADD COLUMN `statusUpdatedAt` timestamp NULL,
  ADD COLUMN `statusUpdatedByAdminId` int;

ALTER TABLE `tikis_platform_settings`
  ADD COLUMN `referralRewardAmount` int NOT NULL DEFAULT 1000,
  ADD COLUMN `referralEnabled` boolean NOT NULL DEFAULT true,
  ADD COLUMN `minWithdrawal` int NOT NULL DEFAULT 500,
  ADD COLUMN `maxWithdrawal` int NOT NULL DEFAULT 500000,
  ADD COLUMN `pricingConfig` text;

ALTER TABLE `tikis_wallet_ledger`
  MODIFY COLUMN `operation` enum('block','unblock','debit','compensation','credit','refund','deposit_request','withdrawal_request','bonus','penalty') NOT NULL;

CREATE TABLE IF NOT EXISTS `tikis_referrals` (
  `id` varchar(40) NOT NULL,
  `referrerPhone` varchar(20) NOT NULL,
  `refereePhone` varchar(20) NOT NULL,
  `referralCode` varchar(8) NOT NULL,
  `status` enum('invited','qualified','rewarded','voided') NOT NULL DEFAULT 'invited',
  `rewardAmount` int NOT NULL,
  `qualifyingDeliveryId` varchar(40),
  `qualifiedAt` timestamp NULL,
  `rewardedAt` timestamp NULL,
  `rewardedByAdminId` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tikis_referrals_referee_unique` (`refereePhone`),
  KEY `tikis_referrals_referrer_index` (`referrerPhone`, `createdAt`),
  KEY `tikis_referrals_status_index` (`status`)
);
