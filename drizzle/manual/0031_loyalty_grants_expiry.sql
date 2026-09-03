-- Expiration des grants de fidélité : un grant 'pending' non crédité après 30 jours
-- est annulé automatiquement (évite l'accumulation de bonus oubliés).
--
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0031_loyalty_grants_expiry.sql

ALTER TABLE `tikis_loyalty_grants`
  ADD COLUMN `expiresAt` timestamp NULL AFTER `creditedAt`,
  ADD COLUMN `cancelledReason` varchar(300) NULL AFTER `expiresAt`,
  ADD KEY `tikis_loyalty_grants_expires_index` (`expiresAt`);

-- Rétro-remplissage : tous les grants pending existants expirent 30j après grantedAt.
UPDATE `tikis_loyalty_grants`
   SET `expiresAt` = DATE_ADD(`grantedAt`, INTERVAL 30 DAY)
 WHERE `status` = 'pending' AND `expiresAt` IS NULL;
