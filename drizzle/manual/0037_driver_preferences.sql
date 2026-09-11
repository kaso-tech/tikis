-- Périmètre de travail du livreur : alertes push de nouvelles courses (opt-in) et rayon d'affichage
-- des opportunités. Absence de ligne = réglages par défaut appliqués côté serveur
-- (cf. shared/driver-perimeter.ts) : pas d'alerte push, périmètre limité à la ville du profil.
-- Cette base étant en MySQL (voir drizzle.config.ts), appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0037_driver_preferences.sql
CREATE TABLE IF NOT EXISTS `tikis_driver_preferences` (
  `profilePhone` varchar(20) NOT NULL,
  `opportunityPushEnabled` boolean NOT NULL DEFAULT false,
  `alertRadiusKm` int DEFAULT NULL,
  `discoveryRadiusKm` int DEFAULT NULL,
  `baseLatitude` decimal(10,7) DEFAULT NULL,
  `baseLongitude` decimal(10,7) DEFAULT NULL,
  `baseUpdatedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`profilePhone`)
);
