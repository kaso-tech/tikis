-- Nouvelles tables pour l'administration Tikis : signalements, comptes admin, journal d'audit.
-- Cette base étant en MySQL (voir drizzle.config.ts), exécuter via drizzle-kit une fois la
-- connexion DB disponible (`pnpm drizzle-kit generate` régénérera ce fichier proprement dans
-- drizzle/ avec son snapshot), ou appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0020_admin_console.sql

CREATE TABLE IF NOT EXISTS `tikis_delivery_reports` (
  `id` varchar(40) NOT NULL,
  `deliveryId` varchar(40) NOT NULL,
  `reporterPhone` varchar(20) NOT NULL,
  `reporterRole` enum('sender','driver') NOT NULL,
  `reason` varchar(80) NOT NULL,
  `description` varchar(1000) NOT NULL,
  `attachmentKey` varchar(255),
  `status` enum('open','reviewing','resolved','dismissed') NOT NULL DEFAULT 'open',
  `resolutionNotes` varchar(1000),
  `resolvedByAdminId` int,
  `resolvedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `tikis_delivery_reports_status_created_index` (`status`, `createdAt`),
  KEY `tikis_delivery_reports_delivery_index` (`deliveryId`),
  KEY `tikis_delivery_reports_reporter_index` (`reporterPhone`)
);

CREATE TABLE IF NOT EXISTS `tikis_admin_users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(180) NOT NULL,
  `passwordHash` varchar(255) NOT NULL,
  `fullName` varchar(120) NOT NULL,
  `role` enum('super_admin','support','finance') NOT NULL DEFAULT 'support',
  `active` boolean NOT NULL DEFAULT true,
  `lastLoginAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tikis_admin_users_email_unique` (`email`)
);

CREATE TABLE IF NOT EXISTS `tikis_admin_audit_log` (
  `id` varchar(40) NOT NULL,
  `adminId` int NOT NULL,
  `adminEmail` varchar(180) NOT NULL,
  `action` varchar(80) NOT NULL,
  `targetType` varchar(40) NOT NULL,
  `targetId` varchar(80) NOT NULL,
  `details` text,
  `ipAddress` varchar(64),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `tikis_admin_audit_log_target_index` (`targetType`, `targetId`),
  KEY `tikis_admin_audit_log_admin_created_index` (`adminId`, `createdAt`)
);

-- Immuabilité du journal d'audit admin, même logique que 0016_wallet_ledger_immutability.sql
DROP TRIGGER IF EXISTS tikis_admin_audit_log_no_update;
DROP TRIGGER IF EXISTS tikis_admin_audit_log_no_delete;

DELIMITER $$

CREATE TRIGGER tikis_admin_audit_log_no_update
BEFORE UPDATE ON tikis_admin_audit_log
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'tikis_admin_audit_log est immuable : la modification d’une entrée du journal d’audit est interdite.';
END$$

CREATE TRIGGER tikis_admin_audit_log_no_delete
BEFORE DELETE ON tikis_admin_audit_log
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'tikis_admin_audit_log est immuable : la suppression d’une entrée du journal d’audit est interdite.';
END$$

DELIMITER ;

-- IMPORTANT : créez le premier compte super_admin manuellement après application de cette migration.
-- Ne jamais insérer de mot de passe en clair : générez le hash avec la même fonction que
-- server/admin-auth.ts (scrypt Node natif), par exemple via un script one-off, puis :
--   INSERT INTO tikis_admin_users (email, passwordHash, fullName, role)
--   VALUES ('vous@kasotech.com', '<hash généré>', 'Votre nom', 'super_admin');
