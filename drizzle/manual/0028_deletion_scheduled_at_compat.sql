-- Compatibilité du schéma Tikis : les installations ayant appliqué 0023
-- avant l’ajout du calendrier de suppression doivent recevoir cette colonne.
ALTER TABLE `tikis_profiles`
  ADD COLUMN `deletionScheduledAt` timestamp NULL;
