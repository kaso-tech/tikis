-- Table des push tokens Expo pour les notifications push device-to-device.
-- Un profil peut avoir plusieurs tokens (iOS natif, Android natif, web — mais Expo Go surtout).
-- L'idempotence est garantie par la contrainte unique (phone, token).
--
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0028_push_tokens.sql

CREATE TABLE IF NOT EXISTS `tikis_push_tokens` (
  `id` varchar(40) NOT NULL PRIMARY KEY,
  `phone` varchar(20) NOT NULL,
  `token` varchar(200) NOT NULL,
  `platform` enum('ios','android','web') NOT NULL DEFAULT 'android',
  `appVersion` varchar(40),
  `deviceName` varchar(120),
  `lastSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `tikis_push_tokens_phone_token_unique` (`phone`, `token`),
  KEY `tikis_push_tokens_phone_index` (`phone`),
  KEY `tikis_push_tokens_last_seen_index` (`lastSeenAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
