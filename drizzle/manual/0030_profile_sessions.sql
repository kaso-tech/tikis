-- Sessions actives multi-device : permet à un profil de voir la liste de ses
-- sessions connectées et d'en révoquer une (ou toutes les autres).
-- L'idempotence repose sur l'unicité du (phone, tokenHash).
--
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0030_profile_sessions.sql

CREATE TABLE IF NOT EXISTS `tikis_profile_sessions` (
  `id` varchar(40) NOT NULL PRIMARY KEY,
  `phone` varchar(20) NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `tokenLast4` varchar(4) NOT NULL,
  `deviceName` varchar(120),
  `platform` enum('ios','android','web','unknown') NOT NULL DEFAULT 'unknown',
  `appVersion` varchar(40),
  `ipAddress` varchar(45),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revokedAt` timestamp NULL,
  KEY `tikis_profile_sessions_phone_index` (`phone`, `lastSeenAt`),
  UNIQUE KEY `tikis_profile_sessions_phone_token_unique` (`phone`, `tokenHash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
