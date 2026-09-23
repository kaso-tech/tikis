-- Redate les courses clôturées automatiquement à l'échéance de leurs 24 h, et non à l'heure où la tâche
-- planifiée est passée.
--
-- `expireOpenTikisDeliveries` enregistrait `completedAt = now`. Quand le serveur était resté arrêté, ou que
-- le planificateur avait pris du retard, une course terminée le 31 août se retrouvait datée du jour où la
-- tâche avait enfin tourné — et comptait dans les « Gains du jour » de ce jour-là, « il y a 15 h ». Le code
-- corrige les clôtures à venir (shared/delivery-expiration.ts, `autoCompletionTimestamp`) ; ce script
-- répare celles déjà enregistrées.
--
-- L'heure d'activité qui a déclenché la clôture n'est plus dans `updatedAt`, écrasé au même moment. On la
-- reconstitue par le dernier événement de la course antérieur à sa clôture automatique : chaque changement
-- d'état (sélection, confirmation…) en écrit un dans la même transaction. L'échéance vaut cette heure plus
-- 24 h, comme dans la règle (shared/delivery-expiration.ts).
--
-- Sûr à rejouer : `LEAST` ne fait jamais qu'avancer la date vers le passé, et la seconde exécution retrouve
-- la même valeur. `updatedAt = updatedAt` empêche `ON UPDATE CURRENT_TIMESTAMP` de réécrire l'horodatage de
-- chaque ligne touchée. Seules les courses portant l'événement `:auto-completed-driver` sont concernées :
-- une course terminée à la main par le livreur garde sa vraie date.
--
-- Cette base étant en MySQL (voir drizzle.config.ts), appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0038_backfill_auto_completed_at.sql
UPDATE `tikis_deliveries` AS d
JOIN `tikis_delivery_events` AS closing
  ON closing.`idempotencyKey` = CONCAT(d.`id`, ':auto-completed-driver')
SET d.`completedAt` = LEAST(
      d.`completedAt`,
      GREATEST(
        d.`createdAt`,
        COALESCE(
          (SELECT MAX(previous.`createdAt`)
             FROM `tikis_delivery_events` AS previous
            WHERE previous.`deliveryId` = d.`id`
              AND previous.`createdAt` < closing.`createdAt`),
          d.`createdAt`
        )
      ) + INTERVAL 24 HOUR
    ),
    d.`updatedAt` = d.`updatedAt`
WHERE d.`status` = 'completed';
