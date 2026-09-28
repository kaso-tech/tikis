-- Gouvernance de la console d'administration.
--
--  - Deux rôles restreints : `viewer` (lecture seule) et `kyc_reviewer` (vérifications d'identité seules).
--  - `mustChangePassword` : un compte créé ou réinitialisé depuis la console reçoit un mot de passe
--    provisoire, qu'il doit remplacer avant d'accéder au reste de la console.
--  - `adminApprovalThreshold` : au-delà de ce montant (100 000 FCFA par défaut), un bonus, une pénalité ou
--    un retrait attend la validation d'un second admin (table tikisse_admin_approvals).
--
-- Idempotente. Appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0047_admin_governance.sql
ALTER TABLE `tikisse_admin_users`
  MODIFY COLUMN `role` enum('super_admin','support','finance','viewer','kyc_reviewer') NOT NULL DEFAULT 'support';

ALTER TABLE `tikisse_admin_users`
  ADD COLUMN IF NOT EXISTS `mustChangePassword` boolean NOT NULL DEFAULT false AFTER `active`;

ALTER TABLE `tikisse_platform_settings`
  ADD COLUMN IF NOT EXISTS `adminApprovalThreshold` int NOT NULL DEFAULT 100000 AFTER `adminTotpRequired`;

CREATE TABLE IF NOT EXISTS `tikisse_admin_approvals` (
  `id` varchar(40) NOT NULL,
  `action` enum('wallet_bonus','wallet_penalty','withdrawal_settle') NOT NULL,
  `amount` int NOT NULL,
  `targetPhone` varchar(20) NOT NULL,
  `targetRef` varchar(80) NOT NULL,
  `payload` text NOT NULL,
  `status` enum('pending','approved','executed','failed','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `requestedByAdminId` int NOT NULL,
  `requestedByEmail` varchar(180) NOT NULL,
  `decidedByAdminId` int DEFAULT NULL,
  `decidedByEmail` varchar(180) DEFAULT NULL,
  `decisionNote` varchar(300) DEFAULT NULL,
  `failureReason` varchar(500) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decidedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `tikisse_admin_approvals_status_index` (`status`, `createdAt`),
  KEY `tikisse_admin_approvals_target_index` (`targetRef`, `status`)
);
