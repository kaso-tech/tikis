-- Table de support pour un rate-limit distribué (partagé entre toutes les instances du serveur), à la
-- place des compteurs en mémoire de processus qui ne protègent que l'instance qui les détient.
-- Cette base étant en MySQL (voir drizzle.config.ts), appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0036_rate_limits.sql
CREATE TABLE IF NOT EXISTS `tikis_rate_limits` (
  `rateLimitKey` varchar(191) NOT NULL,
  `count` int NOT NULL DEFAULT 0,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`rateLimitKey`),
  KEY `tikis_rate_limits_updated_at_index` (`updatedAt`)
);
