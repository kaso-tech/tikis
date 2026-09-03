-- Auto-crédit des bonus de fidélité : un programme avec autoCredit=true et
-- un bonus <= autoCreditMaxAmount sera crédité automatiquement sans validation admin.
--
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0032_loyalty_auto_credit.sql

ALTER TABLE `tikis_loyalty_programs`
  ADD COLUMN `autoCredit` boolean NOT NULL DEFAULT false AFTER `windowDays`,
  ADD COLUMN `autoCreditMaxAmount` int NOT NULL DEFAULT 0 AFTER `autoCredit`;
