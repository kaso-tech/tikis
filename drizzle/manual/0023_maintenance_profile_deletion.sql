-- Mode maintenance, pays/ville du profil, suppression de compte différée (30 jours).
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0023_maintenance_profile_deletion.sql

ALTER TABLE `tikis_profiles`
  ADD COLUMN `country` varchar(2),
  ADD COLUMN `city` varchar(80),
  ADD COLUMN `deletionRequestedAt` timestamp NULL,
  ADD COLUMN `deletedAt` timestamp NULL;

ALTER TABLE `tikis_platform_settings`
  ADD COLUMN `maintenanceEnabled` boolean NOT NULL DEFAULT false,
  ADD COLUMN `maintenanceMessage` varchar(500);
