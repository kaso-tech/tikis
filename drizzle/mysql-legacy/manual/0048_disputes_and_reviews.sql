-- Litiges et modération des avis.
--
--  - tikisse_delivery_reviews : un avis peut être masqué par la modération, avec son motif et l'admin qui l'a
--    masqué. Un avis masqué ne s'affiche plus et ne compte plus dans la note du livreur ; il reste en base.
--  - tikisse_admin_approvals.action : les dédommagements décidés depuis un litige passent eux aussi par la
--    double validation au-delà du seuil.
--
-- Idempotente. Appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0048_disputes_and_reviews.sql
ALTER TABLE `tikisse_delivery_reviews`
  ADD COLUMN IF NOT EXISTS `hiddenAt` timestamp NULL DEFAULT NULL AFTER `comment`,
  ADD COLUMN IF NOT EXISTS `hiddenReason` varchar(300) DEFAULT NULL AFTER `hiddenAt`,
  ADD COLUMN IF NOT EXISTS `hiddenByAdminId` int DEFAULT NULL AFTER `hiddenReason`;

ALTER TABLE `tikisse_admin_approvals`
  MODIFY COLUMN `action` enum('wallet_bonus','wallet_penalty','withdrawal_settle','delivery_refund') NOT NULL;
