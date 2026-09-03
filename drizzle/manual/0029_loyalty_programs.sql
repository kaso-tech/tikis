-- Programme de fidélité Tikis.
-- Une table de règles + une table d'octroi (ledger des bonus).
-- L'idempotence est garantie par (programId, deliveryId) — un même livraison ne peut
-- déclencher qu'un seul bonus par programme.
--
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0029_loyalty_programs.sql

CREATE TABLE IF NOT EXISTS `tikis_loyalty_programs` (
  `id` varchar(40) NOT NULL PRIMARY KEY,
  `name` varchar(80) NOT NULL,
  `description` varchar(300),
  `role` enum('sender','driver') NOT NULL,
  `requiredDeliveries` int NOT NULL,
  `bonusAmount` int NOT NULL,
  `windowDays` int NOT NULL DEFAULT 90,
  `enabled` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `tikis_loyalty_programs_role_index` (`role`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tikis_loyalty_grants` (
  `id` varchar(40) NOT NULL PRIMARY KEY,
  `programId` varchar(40) NOT NULL,
  `profilePhone` varchar(20) NOT NULL,
  `deliveryId` varchar(40),
  `bonusAmount` int NOT NULL,
  `status` enum('pending','credited','cancelled') NOT NULL DEFAULT 'pending',
  `ledgerEntryId` varchar(40),
  `grantedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `creditedAt` timestamp NULL,
  UNIQUE KEY `tikis_loyalty_grants_program_delivery_unique` (`programId`, `deliveryId`),
  KEY `tikis_loyalty_grants_profile_index` (`profilePhone`, `grantedAt`),
  KEY `tikis_loyalty_grants_status_index` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Programme par défaut : un driver qui termine 50 courses en 90 jours reçoit 5000 FCFA.
INSERT INTO `tikis_loyalty_programs` (`id`, `name`, `description`, `role`, `requiredDeliveries`, `bonusAmount`, `windowDays`, `enabled`)
VALUES ('default-driver-50', 'Fidélité livreur 50 courses', 'Bonus de 5 000 FCFA offert aux livreurs qui terminent 50 courses en 90 jours.', 'driver', 50, 5000, 90, true)
ON DUPLICATE KEY UPDATE `updatedAt` = CURRENT_TIMESTAMP;
