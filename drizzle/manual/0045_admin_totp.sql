-- Double authentification (TOTP) de la console d'administration.
--
--  - tikis_admin_users : secret TOTP chiffré (AES-256-GCM, clé TIKIS_ADMIN_TOTP_KEY côté serveur, jamais en
--    base), secret en cours d'enrôlement, date d'activation, dernier pas accepté (anti-rejeu), empreintes
--    SHA-256 des codes de secours.
--  - tikis_admin_sessions.stage : une session « pending_totp » (mot de passe vérifié, code attendu) ne donne
--    accès à rien ; elle est remplacée par une nouvelle session « active » une fois le code validé.
--  - tikis_platform_settings.adminTotpRequired : exigence pour super_admin et finance, désactivée par défaut.
--    La console refuse de l'activer tant qu'un de ces comptes n'est pas enrôlé.
--
-- Idempotente. Appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0045_admin_totp.sql
ALTER TABLE `tikis_admin_users`
  ADD COLUMN IF NOT EXISTS `totpSecret` varchar(255) DEFAULT NULL AFTER `active`,
  ADD COLUMN IF NOT EXISTS `totpPendingSecret` varchar(255) DEFAULT NULL AFTER `totpSecret`,
  ADD COLUMN IF NOT EXISTS `totpEnabledAt` timestamp NULL DEFAULT NULL AFTER `totpPendingSecret`,
  ADD COLUMN IF NOT EXISTS `totpLastUsedStep` bigint DEFAULT NULL AFTER `totpEnabledAt`,
  ADD COLUMN IF NOT EXISTS `totpRecoveryCodes` text DEFAULT NULL AFTER `totpLastUsedStep`;

ALTER TABLE `tikis_admin_sessions`
  ADD COLUMN IF NOT EXISTS `stage` enum('pending_totp','active') NOT NULL DEFAULT 'active' AFTER `revokedAt`;

ALTER TABLE `tikis_platform_settings`
  ADD COLUMN IF NOT EXISTS `adminTotpRequired` boolean NOT NULL DEFAULT false AFTER `maintenanceMessage`;
