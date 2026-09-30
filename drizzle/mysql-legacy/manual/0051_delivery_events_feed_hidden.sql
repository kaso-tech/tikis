-- Allègement des notifications.
--
-- `feedHidden` : l'événement reste enregistré (chronologie de la livraison, instruction des litiges dans
-- la console) mais n'apparaît pas dans le fil de notifications de l'utilisateur et ne déclenche aucun
-- push. Sert aux échos de sa propre action (« Livraison mise à jour » à l'expéditeur qui vient de la
-- modifier…) et aux écritures internes (complément ou surplus de commission côté plateforme).
--
-- Idempotente. Appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0051_delivery_events_feed_hidden.sql
ALTER TABLE `tikisse_delivery_events`
  ADD COLUMN IF NOT EXISTS `feedHidden` boolean NOT NULL DEFAULT false AFTER `metadata`;
