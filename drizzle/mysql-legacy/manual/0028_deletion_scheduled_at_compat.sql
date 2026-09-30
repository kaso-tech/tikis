-- Compatibilité du schéma Tikisse : les installations ayant appliqué 0023
-- avant l’ajout du calendrier de suppression doivent recevoir cette colonne.
ALTER TABLE `tikisse_profiles`
  ADD COLUMN `deletionScheduledAt` timestamp NULL;
