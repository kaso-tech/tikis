-- Validation manuelle des retraits : la console exige désormais la référence du versement Mobile Money
-- fait hors application, et garde la note et l'auteur de toute décision manuelle.
--
-- `payoutReference` est unique : une même preuve de versement ne peut pas justifier deux retraits. Les
-- lignes existantes restent à NULL, que l'index unique autorise plusieurs fois.
--
-- Idempotente (IF NOT EXISTS). Appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0043_withdrawal_payout_reference.sql
ALTER TABLE `tikis_payment_transactions`
  ADD COLUMN IF NOT EXISTS `payoutReference` varchar(80) DEFAULT NULL AFTER `settledAt`,
  ADD COLUMN IF NOT EXISTS `adminNotes` varchar(300) DEFAULT NULL AFTER `payoutReference`,
  ADD COLUMN IF NOT EXISTS `settledByAdminId` int DEFAULT NULL AFTER `adminNotes`;

CREATE UNIQUE INDEX IF NOT EXISTS `tikis_payment_transactions_payoutReference_unique`
  ON `tikis_payment_transactions` (`payoutReference`);
