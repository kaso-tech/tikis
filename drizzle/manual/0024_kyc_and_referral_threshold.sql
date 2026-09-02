-- Table KYC (vérification d'identité des livreurs) + seuil de qualification du parrainage.
-- Fichier manquant dans l'archive d'origine mais nécessaire car :
--  - sans la table tikis_kyc_submissions, l'upload KYC côté mobile plante dès qu'un livreur envoie ses documents
--  - sans la colonne referralRequiredDeliveries, la console admin ne peut pas configurer le seuil de qualification
-- Reproduit le schéma Drizzle (drizzle/schema.ts) au moment de la livraison.
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0024_kyc_and_referral_threshold.sql

ALTER TABLE `tikis_platform_settings`
  ADD COLUMN `referralRequiredDeliveries` int NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS `tikis_kyc_submissions` (
  `id` varchar(40) NOT NULL,
  `driverPhone` varchar(20) NOT NULL,
  `idFrontKey` varchar(255) NOT NULL,
  `idBackKey` varchar(255) NOT NULL,
  `selfieKey` varchar(255) NOT NULL,
  `status` enum('submitted','approved','rejected') NOT NULL DEFAULT 'submitted',
  `rejectionReason` varchar(500),
  `submittedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewedAt` timestamp NULL,
  `reviewedByAdminId` int,
  PRIMARY KEY (`id`),
  KEY `tikis_kyc_submissions_driver_index` (`driverPhone`, `submittedAt`),
  KEY `tikis_kyc_submissions_status_index` (`status`)
);
