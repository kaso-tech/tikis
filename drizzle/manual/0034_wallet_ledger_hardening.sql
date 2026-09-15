-- Durcissement du journal financier (tikis_wallet_ledger).
-- Cette base étant en MySQL/TiDB (voir drizzle.config.ts), appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0034_wallet_ledger_hardening.sql
--
-- Deux corrections indépendantes :
--
-- 1. Sépare le débit de commission Tikis (revenu réel de la plateforme) du débit générique
--    de retrait (argent d'un utilisateur qui sort de son propre Wallet). Auparavant les deux
--    partageaient la valeur "debit", ce qui gonflait le KPI "commissionRevenue" de l'admin dès
--    qu'un retrait avait lieu sur la période. Un backfill met à jour l'historique existant.
-- 2. Immuabilité du journal financier — voir la note TiDB ci-dessous : ni cette migration ni
--    aucune autre de ce dossier ne peut l'implémenter par trigger sur cette base.
--
-- Les deux étapes de la section 1 sont sûres à rejouer (ALTER vers le même enum, UPDATE dont le
-- WHERE ne matche plus rien une fois le backfill fait) : ce fichier peut être repassé sans risque.

-- 1a. Nouvelle valeur d'enum.
ALTER TABLE `tikis_wallet_ledger`
  MODIFY COLUMN `operation` enum('block','unblock','debit','commission_debit','compensation','credit','refund','deposit_request','withdrawal_request','bonus','penalty') NOT NULL;

-- 1b. Backfill : les seules écritures "debit" historiques correspondant à un prélèvement réel de
-- commission Tikis portent exactement ce motif (server/db.ts, confirmTikisDeliveryWithEvents).
-- Toutes les autres valeurs de "debit" (retraits YengaPay test/live, retraits validés par l'admin)
-- restent inchangées à juste titre : ce ne sont jamais des revenus de la plateforme.
UPDATE `tikis_wallet_ledger`
SET `operation` = 'commission_debit'
WHERE `operation` = 'debit'
  AND `reason` = 'Commission Tikis prélevée après confirmation de disponibilité';

-- 2. Immuabilité du journal financier.
--
-- NOTE TiDB — AUCUN TRIGGER DANS CE FICHIER, VOLONTAIREMENT.
-- Cette base est TiDB, qui ne supporte pas les triggers MySQL (CREATE TRIGGER échoue avec une
-- erreur de syntaxe : TiDB ne reconnaît même pas la construction, ce n'est pas une question de
-- variante SQL). C'est le même constat, déjà documenté pour tikis_admin_audit_log dans
-- admin/README.md (migration 0020) : ce fichier avait exactement les mêmes triggers, et ils
-- n'ont jamais pu être créés sur cette base non plus.
--
-- La mitigation retenue est donc au niveau des privilèges plutôt qu'au niveau du schéma : créer
-- (ou faire créer par l'opérateur de la base) un compte MySQL/TiDB dont les droits sur
-- `tikis_wallet_ledger` se limitent à INSERT et SELECT — sans UPDATE ni DELETE — et faire
-- utiliser ce compte par l'application en production. Exemple (à adapter aux identifiants réels,
-- à exécuter par un compte disposant des privilèges GRANT) :
--
--   REVOKE UPDATE, DELETE ON `tikis_wallet_ledger` FROM 'app_user'@'%';
--
-- Le code applicatif respecte déjà cette contrainte de son côté : aucun chemin n'émet de clause
-- SQL UPDATE ou DELETE contre cette table, y compris via `onDuplicateKeyUpdate` (qui compilerait
-- en UPDATE) — l'idempotence y est assurée par une lecture préalable (SELECT sur
-- `idempotencyKey`), jamais par un upsert. Voir server/db.ts, fonctions `applyWalletMovement` et
-- `requestTikisWalletOperation`. La restriction de privilèges ci-dessus est une défense en
-- profondeur : elle protège contre un bug futur, pas contre une faille déjà identifiée.
