-- Les demandes directes expirées sont conservées pour permettre une reprise
-- cohérente côté Wallet sans les confondre avec un refus opérateur.
ALTER TABLE `tikis_payment_transactions`
  MODIFY COLUMN `status` enum('pending','succeeded','failed','cancelled','expired') NOT NULL DEFAULT 'pending';
