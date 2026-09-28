-- Outils de support sur les utilisateurs et traitement des suppressions de compte.
--
--  - tikis_profiles.sessionsRevokedAt : déconnexion forcée par l'équipe ; tout jeton de session émis avant
--    est refusé, appareil enregistré ou non.
--  - tikis_profile_notes : notes internes du support sur une fiche (jamais montrées à l'utilisateur).
--  - tikis_deleted_accounts : à la suppression définitive, le numéro est remplacé partout par un pseudonyme
--    et libéré pour une nouvelle inscription. Cette table garde la correspondance numéro ↔ pseudonyme
--    pendant 10 ans (conservation des pièces comptables), puis la ligne est effacée : l'historique restant
--    n'est plus rattachable à personne.
--  - tikis_storage_erasures : fichiers à effacer du stockage (photos KYC, photo de profil), traités en
--    tâche de fond avec reprise en cas d'échec.
--  - tikis_kyc_submissions.documentsErasedAt : les photos de la pièce d'identité ont été effacées ; la
--    décision (date, statut, admin) reste.
--  - tikis_payment_transactions.provider 'manual_payout' : versement du solde restant fait à la main par
--    l'équipe avant la suppression d'un compte.
--    Il suit le circuit des retraits : référence de versement exigée, double validation au-delà du seuil.
--
-- Idempotente. Appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0049_user_support_and_deletion.sql
ALTER TABLE `tikis_profiles`
  ADD COLUMN IF NOT EXISTS `sessionsRevokedAt` timestamp NULL DEFAULT NULL AFTER `deletedAt`;

CREATE TABLE IF NOT EXISTS `tikis_profile_notes` (
  `id` varchar(40) NOT NULL,
  `profilePhone` varchar(20) NOT NULL,
  `body` varchar(1000) NOT NULL,
  `adminId` int NOT NULL,
  `adminEmail` varchar(180) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `tikis_profile_notes_profile_index` (`profilePhone`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `tikis_deleted_accounts` (
  `pseudonym` varchar(20) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `accountType` enum('sender','driver') NOT NULL,
  `deletedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `purgeAfter` timestamp NOT NULL,
  `finalizedByAdminId` int DEFAULT NULL,
  PRIMARY KEY (`pseudonym`),
  KEY `tikis_deleted_accounts_phone_index` (`phone`),
  KEY `tikis_deleted_accounts_purge_index` (`purgeAfter`)
);

CREATE TABLE IF NOT EXISTS `tikis_storage_erasures` (
  `id` varchar(40) NOT NULL,
  `storageKey` varchar(512) NOT NULL,
  `reason` varchar(80) NOT NULL,
  `attempts` int NOT NULL DEFAULT 0,
  `lastError` varchar(300) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `erasedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `tikis_storage_erasures_pending_index` (`erasedAt`, `createdAt`)
);

ALTER TABLE `tikis_kyc_submissions`
  ADD COLUMN IF NOT EXISTS `documentsErasedAt` timestamp NULL DEFAULT NULL AFTER `reviewedByAdminId`;

ALTER TABLE `tikis_payment_transactions`
  MODIFY COLUMN `provider` enum('ligdi_simulated','yengapay_test','yengapay_sandbox','yengapay_live','yengapay_direct_test','yengapay_direct_sandbox','yengapay_direct_live','manual_payout') NOT NULL DEFAULT 'yengapay_test';
