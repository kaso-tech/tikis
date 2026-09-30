-- Montant annoncé par YengaPay à la confirmation d'un paiement (webhook ou réconciliation).
--
-- Le Wallet est toujours crédité du montant enregistré à la création de l'intention, jamais de celui
-- du webhook. Un écart entre les deux n'était jusqu'ici écrit que dans les journaux du serveur ; il est
-- désormais conservé sur la transaction et listé dans la console (Finance → Contrôle financier).
--
-- Idempotente. Appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0046_payment_reported_amount.sql
ALTER TABLE `tikisse_payment_transactions`
  ADD COLUMN IF NOT EXISTS `providerReportedAmount` int DEFAULT NULL AFTER `settledByAdminId`;
