-- Persistance de la date de finalisation de suppression de compte.
-- Avant : `deletionScheduledAt` était calculé à la volée côté client (deletionRequestedAt + 30j),
-- ce qui faisait perdre le compte à rebours si l'utilisateur fermait/réinstallait l'app.
-- Maintenant : la date est figée côté serveur au moment de la demande, source de vérité unique.
--
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0025_deletion_scheduled_at.sql

ALTER TABLE `tikis_profiles`
  ADD COLUMN `deletionScheduledAt` timestamp NULL AFTER `deletionRequestedAt`;

-- Rétro-remplissage : pour les profils dont la suppression est déjà demandée mais pas encore finalisée,
-- on aligne la nouvelle colonne sur le calcul historique (request + 30j) pour ne pas casser l'UX existant.
UPDATE `tikis_profiles`
   SET `deletionScheduledAt` = DATE_ADD(`deletionRequestedAt`, INTERVAL 30 DAY)
 WHERE `deletionRequestedAt` IS NOT NULL
   AND `deletionScheduledAt` IS NULL
   AND `deletedAt` IS NULL;
