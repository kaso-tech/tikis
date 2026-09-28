-- Sessions révocables de la console d'administration.
--
-- La console ne reçoit plus de jeton signé stocké dans le navigateur (localStorage, lisible par tout script
-- injecté, et valable 8 h quoi qu'il arrive). Elle reçoit un jeton aléatoire dans un cookie httpOnly ; la
-- base n'en conserve que l'empreinte SHA-256, jamais le jeton lui-même. Se déconnecter, ou suspendre le
-- compte, révoque la session côté serveur.
--
-- Après déploiement, chaque admin doit se reconnecter une fois. TIKIS_ADMIN_SESSION_SECRET n'est plus lu.
--
-- Idempotente. Appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0044_admin_sessions.sql
CREATE TABLE IF NOT EXISTS `tikis_admin_sessions` (
  `id` varchar(40) NOT NULL,
  `adminId` int NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `ipAddress` varchar(64) DEFAULT NULL,
  `userAgent` varchar(255) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiresAt` timestamp NOT NULL,
  `revokedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tikis_admin_sessions_tokenHash_unique` (`tokenHash`),
  KEY `tikis_admin_sessions_admin_index` (`adminId`, `revokedAt`)
);
